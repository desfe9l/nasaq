#!/usr/bin/env node
/**
 * Guard the Vercel install command against production-mode devDependency pruning.
 *
 * The graph is rooted at the real npm `build` script, its Vite config and the
 * app entrypoints that TanStack Start/Nitro include. It follows local imports
 * (including the configured TS path aliases), records bare package imports,
 * and deliberately excludes test/spec files. No package is imported by this
 * guard, so it remains runnable even after a broken `npm ci` has omitted dev
 * tooling.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".css",
]);
const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
];
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".vercel",
  ".vite",
  ".tanstack",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);
const BUILTINS = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function slash(path) {
  return path.split(sep).join("/");
}

function isTestFile(path) {
  const normalized = slash(path);
  return (
    /(?:^|\/)(?:__tests__|tests)(?:\/|$)/.test(normalized) ||
    /\.(?:test|spec)\.[^.]+$/i.test(normalized)
  );
}

/** Small JS/TS lexer used only to find import declarations without dependencies. */
function tokenize(source) {
  const tokens = [];
  let index = 0;
  let line = 1;

  const push = (type, value, tokenLine) =>
    tokens.push({ type, value, line: tokenLine });

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length) {
        if (source[index] === "\n") line += 1;
        if (source[index] === "*" && source[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      const tokenLine = line;
      const quote = char;
      let value = "";
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === quote) {
          index += 1;
          break;
        }
        if (current === "\\") {
          const escaped = source[index + 1];
          if (escaped === "\n") {
            line += 1;
            index += 2;
            continue;
          }
          if (escaped !== undefined) {
            value += escaped;
            if (escaped === "\n") line += 1;
            index += 2;
            continue;
          }
        }
        if (current === "\n") line += 1;
        value += current;
        index += 1;
      }
      push("string", value, tokenLine);
      continue;
    }
    if (char === "`") {
      // Imports inside template interpolation are not static module edges. Skip
      // the complete template rather than mistaking its text for source code.
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          if (source[index + 1] === "\n") line += 1;
          index += 2;
          continue;
        }
        if (source[index] === "\n") line += 1;
        if (source[index] === "`") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const tokenLine = line;
      const start = index;
      index += 1;
      while (index < source.length && /[\w$]/.test(source[index])) index += 1;
      push("identifier", source.slice(start, index), tokenLine);
      continue;
    }
    push("punctuation", char, line);
    index += 1;
  }

  return tokens;
}

/** Extract static imports, literal dynamic imports, and literal CommonJS requires. */
export function collectImportSpecifiers(source, filename = "") {
  if (extname(filename).toLowerCase() === ".css") {
    const specifiers = [];
    const pattern =
      /@(?:import|plugin|reference)\s+(?:url\(\s*)?["']([^"']+)["']/g;
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
    return specifiers;
  }

  const tokens = tokenize(source);
  const specifiers = [];
  const add = (specifier) => {
    if (specifier && !specifier.startsWith("#")) specifiers.push(specifier);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;

    if (token.value === "import") {
      const next = tokens[index + 1];
      if (!next) continue;
      if (next.value === ".") continue; // import.meta
      if (next.value === "(") {
        if (tokens[index + 2]?.type === "string") add(tokens[index + 2].value);
        continue;
      }
      if (next.type === "string") {
        add(next.value); // side-effect import
        continue;
      }
      // `import type { ... } from "..."` has no runtime module edge.
      if (
        next.value === "type" &&
        ["{", "*"].includes(tokens[index + 2]?.value)
      )
        continue;
      const specifier = findFromSpecifier(tokens, index);
      if (specifier) add(specifier);
      continue;
    }

    if (token.value === "export") {
      const next = tokens[index + 1];
      if (
        next?.value === "type" &&
        ["{", "*"].includes(tokens[index + 2]?.value)
      )
        continue;
      const specifier = findFromSpecifier(tokens, index);
      if (specifier) add(specifier);
      continue;
    }

    if (token.value === "require" && tokens[index + 1]?.value === "(") {
      if (tokens[index + 2]?.type === "string") add(tokens[index + 2].value);
    }
  }

  return specifiers;
}

function findFromSpecifier(tokens, start) {
  const firstLine = tokens[start]?.line ?? 0;
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === ";") return null;
    if (
      index > start + 1 &&
      token.line > firstLine &&
      token.type === "identifier" &&
      ["import", "export"].includes(token.value)
    ) {
      return null;
    }
    if (
      token.type === "identifier" &&
      token.value === "from" &&
      tokens[index + 1]?.type === "string"
    ) {
      return tokens[index + 1].value;
    }
  }
  return null;
}

function stripJsonComments(text) {
  let result = "";
  let index = 0;
  let quote = null;
  let escaped = false;

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (quote) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"') {
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      )
        index += 1;
      index += 2;
      continue;
    }
    result += char;
    index += 1;
  }

  return result.replace(/,\s*([}\]])/g, "$1");
}

export function readAliases(root) {
  try {
    const config = JSON.parse(
      stripJsonComments(readFileSync(resolve(root, "tsconfig.json"), "utf8")),
    );
    const baseUrl = resolve(root, config.compilerOptions?.baseUrl ?? ".");
    const paths = config.compilerOptions?.paths ?? {};
    return Object.entries(paths).flatMap(([pattern, targets]) =>
      (Array.isArray(targets) ? targets : []).map((target) => ({
        pattern,
        target: resolve(baseUrl, target),
      })),
    );
  } catch {
    return [];
  }
}

function candidateFiles(base) {
  const exactExt = extname(base).toLowerCase();
  if (CODE_EXTENSIONS.has(exactExt)) {
    const candidates = [base];
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(exactExt)) {
      const stem = base.slice(0, -exactExt.length);
      candidates.push(
        `${stem}.ts`,
        `${stem}.tsx`,
        `${stem}.mts`,
        `${stem}.cts`,
      );
    }
    return candidates;
  }
  // A dotted basename such as `account.server` is still an extensionless TS
  // module. Try it as a stem after the exact-path candidate.
  return [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => resolve(base, `index${extension}`)),
  ];
}

export function resolveLocalSpecifier(
  specifier,
  importer,
  root,
  aliases = readAliases(root),
) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  let bases = [];

  if (cleanSpecifier.startsWith(".")) {
    bases = [resolve(dirname(importer), cleanSpecifier)];
  } else if (cleanSpecifier.startsWith("/")) {
    bases = [resolve(root, `.${cleanSpecifier}`)];
  } else {
    for (const alias of aliases) {
      const wildcard = alias.pattern.indexOf("*");
      const prefix =
        wildcard < 0 ? alias.pattern : alias.pattern.slice(0, wildcard);
      const suffix = wildcard < 0 ? "" : alias.pattern.slice(wildcard + 1);
      if (
        !cleanSpecifier.startsWith(prefix) ||
        !cleanSpecifier.endsWith(suffix)
      )
        continue;
      const middle = cleanSpecifier.slice(
        prefix.length,
        cleanSpecifier.length - suffix.length || undefined,
      );
      const targetText = alias.target;
      const target = targetText.includes("*")
        ? targetText.replace("*", middle)
        : targetText;
      bases.push(target);
    }
  }

  for (const base of bases) {
    for (const candidate of candidateFiles(base)) {
      try {
        if (!statSync(candidate).isFile()) continue;
        if (CODE_EXTENSIONS.has(extname(candidate).toLowerCase()))
          return resolve(candidate);
        return null; // assets are Vite inputs, but do not contain package imports
      } catch {
        // Try the next extension/index candidate.
      }
    }
  }
  return null;
}

function packageName(specifier) {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("virtual:") ||
    specifier.startsWith("\\0") ||
    /^[a-z][a-z\d+.-]*:/i.test(specifier)
  ) {
    return null;
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  if (BUILTINS.has(name) || name.startsWith("node:")) return null;
  return name;
}

function isCodeFile(path) {
  return CODE_EXTENSIONS.has(extname(path).toLowerCase()) && !isTestFile(path);
}

function filesUnder(directory) {
  const output = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        output.push(...filesUnder(resolve(directory, entry.name)));
      }
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isFile() && isCodeFile(path)) output.push(path);
  }
  return output;
}

function findViteConfig(root, buildScript) {
  const configured = buildScript.match(/--config(?:=|\s+)([^\s;&|]+)/)?.[1];
  const candidates = configured
    ? [resolve(root, configured)]
    : ["ts", "mts", "cts", "js", "mjs", "cjs"].map((extension) =>
        resolve(root, `vite.config.${extension}`),
      );
  return candidates.find((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

function buildCommandRoots(
  root,
  buildScript,
  packageNames,
  packageScripts = {},
) {
  const roots = [];
  const directPackages = new Map();
  const scriptPattern =
    /\bnode\s+(?:(?:--[\w-]+)(?:=\S+)?\s+)*((?:\.\/)?scripts\/[^\s;&|]+)(?:\s+([^;&|]+))?/g;
  const addNodeScriptRoots = (scriptText, sourceLabel) => {
    for (const match of scriptText.matchAll(scriptPattern)) {
      const scriptPath = resolve(root, match[1]);
      roots.push(scriptPath);
      const args = (match[2] ?? "").trim().split(/\s+/).filter(Boolean);
      const command = args.find((arg) => !arg.startsWith("-"));
      if (command && packageNames.has(command)) {
        directPackages.set(command, `${sourceLabel} -> ${match[1]}`);
      }
    }
  };

  addNodeScriptRoots(buildScript, "package.json#scripts.build");
  // The build runs this permanent guard before Vite. Include its own imports in
  // the graph, but never follow test scripts merely because the package has them.
  for (const match of buildScript.matchAll(
    /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g,
  )) {
    const nestedName = match[1];
    if (nestedName !== "check:deploy") continue;
    const nestedScript = packageScripts[nestedName];
    if (typeof nestedScript === "string") {
      addNodeScriptRoots(nestedScript, `package.json#scripts.${nestedName}`);
    }
  }

  // Vite is run as an argument to scripts/with-app-env.mjs, so its CLI is not
  // a JavaScript import in that wrapper. Record the executable named by build.
  if (/\bvite\s+build\b/.test(buildScript)) {
    directPackages.set("vite", "package.json#scripts.build executable");
  }
  return { roots, directPackages };
}

function readSource(root, path) {
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > 5_000_000) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Build an import graph from the files Vite/TanStack Start/Nitro actually load. */
export function collectBuildImportGraph(root, packageJson = null) {
  const projectRoot = resolve(root);
  const manifest =
    packageJson ??
    JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8"));
  const buildScript = manifest.scripts?.build ?? "";
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const { roots: commandRoots, directPackages } = buildCommandRoots(
    projectRoot,
    buildScript,
    declared,
    manifest.scripts ?? {},
  );
  const viteConfig = findViteConfig(projectRoot, buildScript);
  if (viteConfig) commandRoots.push(viteConfig);

  const configSource = viteConfig
    ? (readSource(projectRoot, viteConfig) ?? "")
    : "";
  const entryRoots = [...commandRoots];
  if (/\btanstackStart\s*\(/.test(configSource)) {
    for (const entry of ["src/router.tsx", "src/routeTree.gen.ts"]) {
      const path = resolve(projectRoot, entry);
      if (readSource(projectRoot, path) !== null) entryRoots.push(path);
    }
    // TanStack Start discovers route files from src/routes by default; include
    // them as build roots so a stale generated route tree cannot hide imports.
    entryRoots.push(...filesUnder(resolve(projectRoot, "src/routes")));
  }

  const serverDir = configSource.match(
    /\bserverDir\s*:\s*["']([^"']+)["']/,
  )?.[1];
  if (serverDir)
    entryRoots.push(...filesUnder(resolve(projectRoot, serverDir)));

  const aliases = readAliases(projectRoot);
  const queue = entryRoots.map((path) => resolve(path));
  const visited = new Set();
  const packages = new Map();
  const unresolvedLocal = [];

  for (const [name, from] of directPackages) {
    packages.set(name, [{ specifier: name, from }]);
  }

  while (queue.length) {
    const path = queue.pop();
    if (visited.has(path) || isTestFile(path)) continue;
    visited.add(path);
    const source = readSource(projectRoot, path);
    if (source === null) continue;

    for (const specifier of collectImportSpecifiers(source, path)) {
      if (/^(?:https?:|data:|#)/i.test(specifier)) continue;
      const localPath = resolveLocalSpecifier(
        specifier,
        path,
        projectRoot,
        aliases,
      );
      if (localPath) {
        if (!visited.has(localPath)) queue.push(localPath);
        continue;
      }
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        // Some local imports are non-code Vite assets; those were deliberately
        // ignored above. Keep unresolved source-module edges visible to the CLI.
        const clean = specifier.split(/[?#]/, 1)[0];
        const hasCodeExtension = SOURCE_EXTENSIONS.some((extension) =>
          clean.endsWith(extension),
        );
        if (hasCodeExtension)
          unresolvedLocal.push({
            from: slash(relative(projectRoot, path)),
            specifier,
          });
        continue;
      }
      const name = packageName(specifier);
      if (!name) continue;
      const refs = packages.get(name) ?? [];
      refs.push({ specifier, from: slash(relative(projectRoot, path)) });
      packages.set(name, refs);
    }
  }

  return {
    files: [...visited]
      .map((path) => slash(relative(projectRoot, path)))
      .sort(),
    packages: new Map([...packages].map(([name, refs]) => [name, refs])),
    unresolvedLocal,
  };
}

function shellWords(command) {
  const words = [];
  let word = "";
  let quote = null;
  let escaped = false;
  for (const char of String(command)) {
    if (escaped) {
      word += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (word) words.push(word);
      word = "";
      continue;
    }
    word += char;
  }
  if (word) words.push(word);
  return words;
}

function parseListOption(words, option) {
  const values = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.startsWith(`${option}=`))
      values.push(word.slice(option.length + 1));
    else if (word === option && words[index + 1]) values.push(words[index + 1]);
  }
  return new Set(
    values.flatMap((value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

/** Model npm's NODE_ENV=production omission rule for the Vercel install command. */
export function analyzeInstallCommand(command, productionEnv = true) {
  const words = shellWords(command);
  const npmIndex = words.findIndex((word) =>
    /(?:^|\/)npm(?:\.cmd)?$/.test(word),
  );
  if (npmIndex < 0 || !["ci", "install", "i"].includes(words[npmIndex + 1])) {
    return {
      supported: false,
      includesDev: false,
      reason:
        "Vercel installCommand is not a verifiable npm ci/install command.",
    };
  }

  const installWords = words.slice(npmIndex + 2);
  const include = parseListOption(installWords, "--include");
  const omit = parseListOption(installWords, "--omit");
  const envAssignments = words
    .slice(0, npmIndex)
    .filter((word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
  const env = Object.fromEntries(
    envAssignments.map((word) => {
      const separator = word.indexOf("=");
      return [word.slice(0, separator), word.slice(separator + 1)];
    }),
  );
  const productionFalse =
    installWords.includes("--production=false") ||
    env.NPM_CONFIG_PRODUCTION === "false" ||
    env.npm_config_production === "false";
  const configInclude = String(
    env.NPM_CONFIG_INCLUDE ?? env.npm_config_include ?? "",
  )
    .split(",")
    .map((entry) => entry.trim());
  const configOmit = String(env.NPM_CONFIG_OMIT ?? env.npm_config_omit ?? "")
    .split(",")
    .map((entry) => entry.trim());
  const includesDev =
    include.has("dev") ||
    configInclude.includes("dev") ||
    productionFalse ||
    (!productionEnv && !omit.has("dev") && !configOmit.includes("dev"));
  return {
    supported: true,
    includesDev,
    omittedDev:
      !includesDev &&
      (productionEnv || omit.has("dev") || configOmit.includes("dev")),
    reason: includesDev
      ? "devDependencies are explicitly included for the production build."
      : "npm omits devDependencies when NODE_ENV=production unless --include=dev is specified.",
  };
}

function packageLockIssues(root, manifest) {
  const issues = [];
  let lock;
  try {
    lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  } catch {
    return [
      "package-lock.json is missing or invalid; npm ci cannot reproduce this manifest.",
    ];
  }
  const lockedRoot = lock.packages?.[""];
  if (!lockedRoot) return ["package-lock.json has no root package record."];
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const declared = manifest[section] ?? {};
    const locked = lockedRoot[section] ?? {};
    const names = new Set([...Object.keys(declared), ...Object.keys(locked)]);
    for (const name of names) {
      if (declared[name] !== locked[name]) {
        issues.push(
          `package-lock.json ${section}.${name} does not match package.json.`,
        );
      }
    }
  }
  return issues;
}

/** Inspect the Vercel config, npm lock, and actual build import graph. */
export function inspectDeployConfig(root = rootDir) {
  const projectRoot = resolve(root);
  const issues = [];
  let manifest;
  let vercel;
  try {
    manifest = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8"),
    );
  } catch {
    return {
      ok: false,
      issues: ["package.json is missing or invalid."],
      graph: null,
      install: null,
    };
  }
  try {
    vercel = JSON.parse(
      readFileSync(resolve(projectRoot, "vercel.json"), "utf8"),
    );
  } catch {
    return {
      ok: false,
      issues: ["vercel.json is missing or invalid."],
      graph: null,
      install: null,
    };
  }

  if (
    typeof manifest.scripts?.build !== "string" ||
    !manifest.scripts.build.trim()
  ) {
    issues.push("package.json must define the production build script.");
  }
  if (typeof manifest.scripts?.["check:deploy"] !== "string") {
    issues.push("package.json must expose npm run check:deploy.");
  }
  if (
    typeof vercel.installCommand !== "string" ||
    !vercel.installCommand.trim()
  ) {
    issues.push("vercel.json must define installCommand explicitly.");
  }

  const install = analyzeInstallCommand(vercel.installCommand ?? "");
  if (!install.supported) issues.push(install.reason);

  issues.push(...packageLockIssues(projectRoot, manifest));

  const graph = collectBuildImportGraph(projectRoot, manifest);
  if (graph.files.length === 0)
    issues.push(
      "The production build import graph is empty; its entrypoints could not be resolved.",
    );
  if (graph.unresolvedLocal.length) {
    const detail = graph.unresolvedLocal
      .map(({ from, specifier }) => `${from} -> ${specifier}`)
      .join(", ");
    issues.push(
      `The build graph contains unresolved local source imports: ${detail}`,
    );
  }

  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const undeclared = [...graph.packages.keys()]
    .filter((name) => !declared.has(name))
    .sort();
  if (undeclared.length) {
    const details = undeclared.map((name) => {
      const reference = graph.packages.get(name)?.[0];
      return `${name} (imported by ${reference?.from ?? "the build graph"})`;
    });
    issues.push(
      `Build import graph uses undeclared package(s): ${details.join(", ")}.`,
    );
  }

  const devOnly = [...graph.packages.keys()]
    .filter(
      (name) =>
        manifest.devDependencies?.[name] &&
        !manifest.dependencies?.[name] &&
        !manifest.optionalDependencies?.[name],
    )
    .sort();
  if (install.supported && !install.includesDev && devOnly.length) {
    issues.push(
      `Vercel's production install would prune build-required devDependencies: ${devOnly.join(", ")}. ` +
        "Use `npm ci --include=dev` in vercel.json.",
    );
  }

  return { ok: issues.length === 0, issues, graph, install, devOnly };
}

function main() {
  const result = inspectDeployConfig();
  const packageList = result.graph
    ? [...result.graph.packages.keys()].sort()
    : [];
  if (result.ok) {
    console.log(
      `[check:deploy] OK — ${result.graph.files.length} build modules, ${packageList.length} imported packages; ` +
        `${result.install.reason}`,
    );
    if (result.devOnly?.length) {
      console.log(
        `[check:deploy] Vercel build tools found in the actual graph: ${result.devOnly.join(", ")}.`,
      );
    }
    return;
  }
  console.error("[check:deploy] FAILED");
  for (const issue of result.issues) console.error(`  - ${issue}`);
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
