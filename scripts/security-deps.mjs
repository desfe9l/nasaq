/**
 * Dependency reachability report — the evidence behind `docs/dependency-security.md`.
 *
 * `npm audit` answers "which package declared a vulnerable dependency"; it cannot
 * answer "does our product ship that code". This script answers the second
 * question, deterministically, so the audit decisions can be re-checked after any
 * dependency change instead of being taken on trust:
 *
 *   1. print the audit summary (severity, path, fix availability),
 *   2. print the production dependency path for every flagged package,
 *   3. for each flagged package, look for its code in the built output
 *      (`.vercel/output`, produced by `npm run build`).
 *
 * It never fails the build: it is a report. What it flags as SHIPPED must be
 * resolved by a real fix (upgrade, or removing the dependency), never by
 * suppressing the check.
 *
 * Run:  npm run security:deps
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const run = (args) => {
  try {
    return execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return error.stdout || "";
  }
};

/** Signature strings a package's own bundle contains (path-agnostic markers). */
const SIGNATURES = {
  "image-size": ["unsupported file type", "isICNS", "isJXL"],
  braces: ["fill-range", "to-regex-range"],
  argparse: ["argument_parser", "sprintf_js"],
  "sprintf-js": ["sprintf_js"],
  wireit: ["wireit"],
  chokidar: ["chokidar"],
  micromatch: ["micromatch"],
};

const OUTPUT_DIRS = [".vercel/output/static/assets", ".vercel/output/functions"];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (/\.(js|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

console.log("── npm audit ──────────────────────────────────────────────────────────");
const audit = JSON.parse(run(["audit", "--json"]) || "{}");
const advisories = Object.values(audit.vulnerabilities || {});
if (!advisories.length) console.log("no advisories reported.");
for (const item of advisories) {
  const via = item.via.map((entry) => (typeof entry === "string" ? entry : `${entry.severity}:${entry.title}`));
  console.log(
    `${item.severity.padEnd(8)} ${item.name.padEnd(22)} ${item.isDirect ? "direct" : "transitive"}  ${via.join(" | ")}`,
  );
  console.log(
    `         fix: ${item.fixAvailable === false ? "none" : JSON.stringify(item.fixAvailable)}`,
  );
}

console.log("\n── production dependency paths ────────────────────────────────────────");
for (const name of ["image-size", "braces", "argparse", "sprintf-js", "wireit", "chokidar"]) {
  const tree = run(["ls", "--omit=dev", name]).trim() || `(${name} is not a production dependency)`;
  console.log(`\n${name}:\n${tree.split("\n").slice(1).join("\n") || "  —"}`);
}

console.log("\n── built output ───────────────────────────────────────────────────────");
const bundles = OUTPUT_DIRS.flatMap((dir) => walk(join(process.cwd(), dir)));
if (!bundles.length) {
  console.log("no build found — run `npm run build` first, then re-run this report.");
} else {
  const texts = bundles.map((file) => [file, readFileSync(file, "utf8")]);
  for (const [name, patterns] of Object.entries(SIGNATURES)) {
    const hits = [];
    for (const [file, text] of texts) {
      for (const pattern of patterns) {
        if (text.includes(pattern)) hits.push(`${file.replace(process.cwd() + "/", "")} (${pattern})`);
      }
    }
    console.log(
      `${name.padEnd(12)} ${hits.length ? `SHIPPED — review: ${hits.slice(0, 3).join(", ")}` : "not present in the built output"}`,
    );
  }
  console.log(
    `\n${bundles.length} bundles scanned in ${OUTPUT_DIRS.join(", ")}.`,
  );
}