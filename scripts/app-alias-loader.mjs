/**
 * Production ESM resolver hook for operator CLIs.
 *
 * Gives plain Node the ONE thing the app relies on Vite for — the `@/…` path
 * alias — so scripts like `owner-migration-verify.mjs` can exercise the real
 * server modules against the real deployment database.
 *
 * Unlike `test-alias-loader.mjs`, this hook substitutes NOTHING ELSE: in
 * particular it never replaces `@/lib/db` with the test stub. A verification
 * script that silently read a stand-in database would be worse than useless —
 * it would certify a production state nobody checked.
 */
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(`${process.cwd()}/src/`).href;

async function firstResolvable(candidates, context, next) {
  let lastError;
  for (const candidate of candidates) {
    try {
      return await next(candidate, context);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function resolve(specifier, context, next) {
  let spec = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
  const candidates = [spec];
  if (
    !/node_modules/.test(spec) &&
    !/\.(ts|tsx|js|mjs|cjs|json|css)$/.test(spec) &&
    (spec.startsWith("/") || spec.startsWith("file:") || spec.startsWith("."))
  ) {
    candidates.push(`${spec}.ts`, `${spec}.tsx`, `${spec}/index.ts`);
  }
  return firstResolvable(candidates, context, next);
}
