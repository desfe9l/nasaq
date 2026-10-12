import assert from "node:assert/strict";
import { test } from "node:test";

const originalVercel = process.env.VERCEL;
const originalDatabaseUrl = process.env.NASAQ_PRIMARY_DATABASE_URL;
process.env.VERCEL = "1";
delete process.env.NASAQ_PRIMARY_DATABASE_URL;

const { ensureDbReady, getSql, normalizeDatabaseUrl, preferTransactionPooler } = await import("./db.ts");

if (originalVercel === undefined) delete process.env.VERCEL;
else process.env.VERCEL = originalVercel;
if (originalDatabaseUrl === undefined) delete process.env.NASAQ_PRIMARY_DATABASE_URL;
else process.env.NASAQ_PRIMARY_DATABASE_URL = originalDatabaseUrl;

test("Vercel bootstrap stays renderable without a database but DB access fails closed", async () => {
  await assert.doesNotReject(ensureDbReady());
  await assert.rejects(
    getSql(),
    /NASAQ_PRIMARY_DATABASE_URL is not set on this deployment/,
  );
});

test("normalizeDatabaseUrl replaces ambiguous sslmodes with verify-full (generic PostgreSQL)", () => {
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@db.example.com/neondb?sslmode=require"),
    "postgres://user:pass@db.example.com/neondb?sslmode=verify-full",
  );
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@db.example.com/neondb?sslmode=prefer"),
    "postgres://user:pass@db.example.com/neondb?sslmode=verify-full",
  );
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@db.example.com/neondb?sslmode=verify-ca"),
    "postgres://user:pass@db.example.com/neondb?sslmode=verify-full",
  );
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@db.example.com/neondb?sslmode=verify-full"),
    "postgres://user:pass@db.example.com/neondb?sslmode=verify-full",
  );
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@db.example.com/neondb"),
    "postgres://user:pass@db.example.com/neondb",
  );
  assert.equal(
    normalizeDatabaseUrl("postgres://user:pass@my-custom-db.internal/db?sslmode=require"),
    "postgres://user:pass@my-custom-db.internal/db?sslmode=verify-full",
  );
  assert.equal(normalizeDatabaseUrl(undefined), undefined);
  assert.equal(normalizeDatabaseUrl("   "), undefined);
});
test("preferTransactionPooler moves the Supabase session pooler to the transaction pooler", () => {
  // Session pooler (5432) with a project-ref user becomes the transaction pooler (6543).
  assert.equal(
    preferTransactionPooler(
      "postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      {},
    ),
    "postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  );
  // Already on the transaction pooler: untouched.
  assert.equal(
    preferTransactionPooler(
      "postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
      {},
    ),
    "postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  );
  // Bare `postgres` user cannot be mapped to a tenant safely: left alone.
  assert.equal(
    preferTransactionPooler(
      "postgres://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      {},
    ),
    "postgres://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  );
  // Direct (non-pooler) host: untouched.
  assert.equal(
    preferTransactionPooler("postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres", {}),
    "postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres",
  );
  // Opt-out flag disables the rewrite.
  assert.equal(
    preferTransactionPooler(
      "postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
      { NASAQ_DB_POOLER_REWRITE: "0" },
    ),
    "postgres://postgres.abcdefgh:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  );
  // Non-Supabase / malformed / empty inputs pass through unchanged.
  assert.equal(
    preferTransactionPooler("postgres://u:p@db.example.com:5432/app", {}),
    "postgres://u:p@db.example.com:5432/app",
  );
  assert.equal(preferTransactionPooler(undefined, {}), undefined);
  assert.equal(preferTransactionPooler("not a url", {}), "not a url");
});
