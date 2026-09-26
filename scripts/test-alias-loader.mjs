/**
 * Test-only ESM resolver hook.
 *
 * Two things the app relies on Vite for, which `node --test` does not provide:
 *   1. the `@/…` path alias and extensionless relative imports;
 *   2. `src/lib/db.ts`, whose migration discovery uses `import.meta.glob`.
 *
 * This hook supplies both so a test can drive the REAL licensing modules
 * instead of re-implementing their logic: aliases resolve to `src/`, and any
 * import of the database module is redirected to `test-db-stub.ts`, which
 * hands back a real PGlite instance installed by the test.
 *
 * Used only by `node --test --import` for the licensing chain test. Nothing in
 * the application or the build ever loads it.
 */
import { pathToFileURL } from "node:url";

const SRC = pathToFileURL(`${process.cwd()}/src/`).href;
const DB_STUB = `${SRC}lib/license/test-db-stub.ts`;
const DB_SPECIFIERS = /(^|\/)(@\/lib\/db|lib\/db|\.\.?\/db|\.\.\/\.\.\/db)(\.ts)?$/;

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
  if (specifier === "@/lib/db" || DB_SPECIFIERS.test(specifier)) {
    return next(DB_STUB, context);
  }

  let spec = specifier.startsWith("@/") ? SRC + specifier.slice(2) : specifier;
  const candidates = [spec];
  if (!/\.(ts|tsx|js|mjs|cjs|json|css)$/.test(spec)) {
    candidates.push(`${spec}.ts`, `${spec}.tsx`, `${spec}/index.ts`);
  }
  return firstResolvable(candidates, context, next);
}
