/**
 * Test-only stand-in for `@/lib/db`.
 *
 * `src/lib/db.ts` discovers migrations with `import.meta.glob`, which only
 * exists inside Vite, so a plain `node --test` process cannot boot the real
 * module. The licensing chain (`getAuthorizationContext` → `findLicensesByUserId`
 * → `getSubscription`) reaches the database through `getSql()` rather than a
 * parameter, so the only way to exercise the REAL chain end to end is to hand
 * those modules a real database through this stub.
 *
 * It is not a fake database: the test installs a genuine PGlite instance with
 * the app's own `migrations/*.sql` applied, so every WHERE clause under test is
 * the one production runs.
 *
 * Not a `.test.ts` file: it has no cases of its own, and nothing in the app
 * imports it — the loader in `scripts/test-alias-loader.mjs` substitutes it only for tests.
 */
import type { Sql } from "@/lib/db";

const ref = globalThis as typeof globalThis & { __NASAQ_TEST_SQL__?: Sql };

export function setTestSql(sql: Sql | undefined): void {
  ref.__NASAQ_TEST_SQL__ = sql;
}

export function getSql(): Promise<Sql> {
  const sql = ref.__NASAQ_TEST_SQL__;
  if (!sql) throw new Error("test SQL not installed — call setTestSql() first");
  return Promise.resolve(sql);
}

export type { Sql };
