#!/usr/bin/env node
/**
 * Environment audit — every variable the code reads, compared with what the
 * project documents and what is safe to ship to the browser.
 *
 * WHY THIS EXISTS
 * ---------------
 * The environment is the one contract that fails silently. A missing
 * `BETTER_AUTH_SECRET` does not throw: it makes sessions unverifiable and the
 * visitor is randomly signed out. A `VITE_`-prefixed token does not warn: it
 * ends up in the client bundle. An undocumented variable cannot be provisioned by
 * whoever deploys next.
 *
 * WHAT IT CHECKS
 *   1. every `process.env.X` / `import.meta.env.X` (and every name read through
 *      the `env("X")` / `readEnv(env, "X")` helpers) is documented in
 *      `.env.example`;
 *   2. nothing secret is exposed through a public (`VITE_`) name;
 *   3. documented-but-unused variables are reported (they rot into lies).
 *
 * The rule is deliberately strict: a new variable cannot be added to the code
 * without being declared where the deployer looks for it.
 *
 * Usage: `node scripts/env-audit.mjs [--root .]`
 * Exit 0 clean, 1 findings, 2 could not scan.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./with-app-env.mjs";

/** Files/directories the scan never looks inside. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".output",
  ".vercel",
  ".nitro",
  ".tanstack",
  ".pglite-data",
  "coverage",
  "screenshots",
  ".grok",
  ".cache",
  ".vite",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Names injected by the platform/runtime, or read dynamically. They are real and
 * intentional, but they are not part of this project's configuration surface —
 * so they are not required in `.env.example`.
 */
export const PLATFORM_VARS = [
  "NODE_ENV",
  // Vite built-ins, injected by the bundler into `import.meta.env`.
  "DEV",
  "PROD",
  "MODE",
  "SSR",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "CI",
];

/** Grok-deployer variables. Injected on Grok; inert on Vercel. */
export const DEPLOYER_VARS = [
  "VITE_OG_SERVICE_URL",
  "VITE_PROJECT_ID",
  "X_CREATOR",
  "X_CREATOR_ID",
  "GROK_PROJECT_ID",
  "GROK_GATE_ORIGIN",
  "GROK_CONNECTORS_URL",
  "GROK_CONNECTOR_ACCESS_TOKEN",
];

/** Test/QA harness knobs — they configure scripts, never the product. */
export const HARNESS_VARS = [
  "AGENT_BROWSER",
  "AI_E2E_BASE",
  "AUTH_E2E_BASE",
  "BASE_URL",
  "BROWSER_ALLOW_EXTERNAL_HOST",
  "BROWSER_EXECUTABLE",
  "BROWSER_SMOKE_TIMEOUT_MS",
  "CHECK_TIMEOUT",
  "CHROME_PATH",
  "CHROMIUM_PATH",
  "DEVICE",
  "EDITOR_TEST_SESSION",
  "EDITOR_TEST_URL",
  "NASAQ_COMPAT_KEY",
  "NSQ_TEST_URL",
  "OFFLINE",
  "PERF_SCENARIOS",
  "PREVIEW_READY_TIMEOUT_MS",
  "PREVIEW_THUMBNAIL_TIMEOUT_MS",
  "PRICING_TEST_URL",
  "RENDER_TEST_URL",
  "TEST_FONT_FILE",
  "TOOLS_TEST_URL",
  "TOUCH",
];

/** Names accessed dynamically on purpose (a loop over a key list). */
export const DYNAMIC_VAR_ALLOWLIST = [
  "key", // owner vault: process.env[key] with a validated key name
  "name", // license/gumroad config: process.env[name] over a fixed list
];

/**
 * Substrings that make a `VITE_`-prefixed name a hard error: a public variable
 * is inlined into the browser bundle, so anything credential-shaped there is a
 * leak by construction.
 */
const SECRET_NAME_PATTERN = /(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE|CREDENTIAL)/i;

/** Every env name a source file reads. */
export function envNamesInSource(source) {
  const names = new Set();
  const patterns = [
    /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\??\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
    /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /import\.meta\.env\??\.([A-Za-z_][A-Za-z0-9_]*)/g,
    /import\.meta\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) names.add(match[1]);
    }
  }

  /*
   * Names read through the project helpers, where the name is an ARGUMENT:
   *
   *   env("GUMROAD_PRODUCT_ID")
   *   readEnv(env, "BETTER_AUTH_URL")
   *   env(family === "individual" ? "GUMROAD_TIER_INDIVIDUAL_NAME" : "…")
   *
   * The whole call is scanned (balanced to its closing parenthesis, bounded), so
   * a ternary or a wrapped expression still registers both names.
   */
  for (const call of helperCalls(source)) {
    for (const match of call.matchAll(/["']([A-Z][A-Z0-9_]{2,})["']/g)) {
      names.add(match[1]);
    }
  }

  /*
   * Names assembled from a template literal — `KEYGEN_POLICY_${plan}_ID` — have
   * no single spelling in the source. They are returned as PREFIXES so the audit
   * can match the documented variables they generate.
   */
  return { names: [...names], prefixes: dynamicPrefixes(source) };
}

/** Prefixes of env names built at runtime from a template literal. */
export function dynamicPrefixes(source) {
  const prefixes = new Set();
  const patterns = [
    /process\.env\[\s*`([A-Z_][A-Z0-9_]*)\$\{/g,
    /import\.meta\.env\[\s*`([A-Z_][A-Z0-9_]*)\$\{/g,
    /(?:readEnv|env)\(\s*`([A-Z_][A-Z0-9_]*)\$\{/g,
    /*
     * A name assembled into a variable first:
     *   const envName = `KEYGEN_POLICY_${plan.toUpperCase()...}_ID`;
     * The literal still spells the prefix the configured variable must have.
     */
    /`([A-Z][A-Z0-9_]*)\$\{/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) prefixes.add(match[1]);
    }
  }
  return [...prefixes];
}

/** Argument text of every `env(…)` / `readEnv(…)` call, bounded and balanced. */
export function helperCalls(source) {
  const calls = [];
  const startPattern = /\b(?:readEnv|env)\(/g;
  for (const match of source.matchAll(startPattern)) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    const limit = Math.min(source.length, open + 400);
    for (let i = open; i < limit; i += 1) {
      const char = source[i];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    calls.push(source.slice(open + 1, end));
  }
  return calls;
}

/**
 * Names documented in `.env.example`: an active assignment (`KEY=`) or a
 * commented one (`# KEY=value`, which is how optional variables are documented
 * there without shipping a value).
 */
export function documentedNames(exampleText) {
  const names = new Set();
  for (const line of exampleText.split("\n")) {
    const match = line.match(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)\s*=/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/**
 * The audit itself — pure, so it is testable with hand-written inputs.
 * Returns findings grouped by kind; every entry carries the file that caused it.
 */
export function auditEnvironment({ used, documented, allowed, prefixes = [] }) {
  const allowedSet = new Set(allowed);
  const documentedSet = new Set(documented);
  const prefixList = [...prefixes];
  const undocumented = [];
  const secretsInClient = [];
  const seen = new Set();

  for (const { name, file } of used) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (name.startsWith("VITE_") && SECRET_NAME_PATTERN.test(name)) {
      secretsInClient.push({ name, file });
    }
    if (allowedSet.has(name) || documentedSet.has(name)) continue;
    undocumented.push({ name, file });
  }

  const usedNames = new Set(used.map((entry) => entry.name));
  const unused = documented.filter(
    (name) =>
      !usedNames.has(name) &&
      !allowedSet.has(name) &&
      !prefixList.some((prefix) => name.startsWith(prefix)),
  );

  return {
    ok: undocumented.length === 0 && secretsInClient.length === 0,
    undocumented: undocumented.sort((a, b) => a.name.localeCompare(b.name)),
    secretsInClient,
    unused,
  };
}

/** Walk the repository and collect every env name read by source files. */
export function scanRepository(root) {
  const used = [];
  const prefixes = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".") {
        if (SKIP_DIRS.has(entry.name) || entry.isDirectory()) continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.mjs")) continue;
      // The auditor documents example names in its own comments — skip itself.
      if (entry.name === "env-audit.mjs") continue;
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.size > 2_000_000) continue;
      const source = readFileSync(full, "utf8");
      const found = envNamesInSource(source);
      for (const name of found.names) {
        used.push({ name, file: relative(root, full) });
      }
      for (const prefix of found.prefixes) prefixes.add(prefix);
    }
  };
  for (const dir of ["src", "scripts", "server"]) {
    const full = join(root, dir);
    try {
      if (statSync(full).isDirectory()) walk(full);
    } catch {
      /* directory absent in this checkout — nothing to scan */
    }
  }
  return { used, prefixes: [...prefixes] };
}

export function projectRootFrom(moduleUrl) {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/** Run the audit against a checkout. Throws when `.env.example` is missing. */
export function auditProject(root) {
  const { used, prefixes } = scanRepository(root);
  const documented = documentedNames(readFileSync(join(root, ".env.example"), "utf8"));
  const allowed = [...PLATFORM_VARS, ...DEPLOYER_VARS, ...HARNESS_VARS, ...DYNAMIC_VAR_ALLOWLIST];
  return { ...auditEnvironment({ used, documented, allowed, prefixes }), documented };
}

function format(result) {
  const lines = [];
  for (const finding of result.undocumented) {
    lines.push(
      `[env-audit] UNDOCUMENTED ${finding.name} (read in ${finding.file}) — add it to .env.example`,
    );
  }
  for (const finding of result.secretsInClient) {
    lines.push(
      `[env-audit] PUBLIC-SECRET ${finding.name} (read in ${finding.file}) — a VITE_ variable is inlined into the client bundle; rename it and read it server-side`,
    );
  }
  return lines;
}

function main(argv) {
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? projectRootFrom(import.meta.url) : argv[rootFlag + 1];
  let result;
  try {
    result = auditProject(root);
  } catch (error) {
    console.error("[env-audit] could not scan:", error?.message ?? error);
    process.exit(2);
  }
  const lines = format(result);
  for (const line of lines) console.error(line);
  if (result.unused.length) {
    console.log(
      `[env-audit] documented but not read (${result.unused.length}): ${result.unused.join(", ")}`,
    );
  }
  if (result.ok) {
    console.log(
      `[env-audit] ok — ${result.documented.length} documented variables cover every read site.`,
    );
    process.exit(0);
  }
  process.exit(1);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2));
}
