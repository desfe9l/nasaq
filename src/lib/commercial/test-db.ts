/**
 * Test harness: a real Postgres (PGlite) with the real migrations applied.
 *
 * The ownership and authorization rules under test live in SQL, so testing them
 * against a hand-rolled fake would prove nothing — a stub can only confirm the
 * query I *meant* to write. This boots the same `migrations/*.sql` the app
 * applies and exposes the same `Sql` surface, so the assertions exercise the
 * actual WHERE clauses that decide whether one customer can see another's row.
 *
 * Not a `.test.ts` file: it has no cases of its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";

/** Project root — this file lives at `<root>/src/lib/commercial/`. */
const ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * Build an isolated in-memory database with the app's schema.
 *
 * Each call gets its own instance, so tests never share rows and can run in any
 * order. Migrations are applied verbatim from disk, which also means a broken
 * migration file fails these tests rather than only failing at deploy.
 */
export async function createTestSql(): Promise<{ sql: Sql; close: () => Promise<void> }> {
  const pg = new PGlite();
  await pg.waitReady;

  const dir = join(ROOT, "migrations");
  // Only the top-level `migrations/*.sql`, matching both real appliers — the
  // opt-in `migrations/auth/` subdirectory stays out of scope.
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    await pg.exec(readFileSync(join(dir, file), "utf8"));
  }

  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    const result = await pg.query<T>(text, values);
    return result.rows;
  }) as unknown as Sql;

  sql.query = async <T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    const result = await pg.query<T>(text, params);
    return result.rows;
  };

  return { sql, close: () => pg.close() };
}

/** Insert a Better Auth user row so `"user"` joins resolve. */
export async function createUser(
  sql: Sql,
  input: { id: string; email: string; name?: string },
): Promise<void> {
  await sql`
    insert into "user" (id, name, email, "emailVerified")
    values (${input.id}, ${input.name ?? input.id}, ${input.email}, true)
  `;
}

/** Insert an ACTIVE subscription directly, bypassing the approval flow. */
export async function giveSubscription(
  sql: Sql,
  input: {
    userId: string;
    planId?: string;
    status?: "ACTIVE" | "EXPIRED" | "SUSPENDED";
    expiresAt: string;
  },
): Promise<void> {
  await sql`
    insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
    values (
      ${`sub-${input.userId}-${Math.random().toString(36).slice(2)}`},
      ${input.userId}, ${input.planId ?? "monthly"}, ${input.status ?? "ACTIVE"},
      now(), ${input.expiresAt}
    )
  `;
}

export { ROOT };