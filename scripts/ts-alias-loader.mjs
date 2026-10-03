/**
 * Loader hook for running the app's TypeScript sources under `node --test`
 * and verification scripts: resolves the `@/` path alias to `src/` so modules
 * like `@/lib/db` load outside Vite. Type stripping is handled natively by
 * `node --experimental-strip-types`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, nextResolve) {
  const tryBase =
    specifier.startsWith("@/")
      ? path.join(SRC_ROOT, specifier.slice(2))
      : specifier.startsWith("./") || specifier.startsWith("../")
        ? path.resolve(path.dirname(context.parentURL ? fileURLToPath(context.parentURL) : process.cwd()), specifier)
        : null;
  if (tryBase) {
    for (const suffix of CANDIDATES) {
      const candidate = tryBase + suffix;
      if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

/**
 * `src/lib/db.ts` reads migrations with Vite's `import.meta.glob`, which does
 * not exist under plain node. Swap it for an fs-backed equivalent so the real
 * migration SQL still applies in verification scripts.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith("/src/lib/db.ts")) {
    const result = await nextLoad(url, context);
    const source = String(result.source).replace(
      /import\.meta\.glob\((?:[^)]|\)(?!\s*as))*\)/g,
      "globalThis.__nasaqMigrations()",
    );
    return { ...result, source };
  }
  return nextLoad(url, context);
}
