import assert from "node:assert/strict";
import { test } from "node:test";

const originalVercel = process.env.VERCEL;
const originalDatabaseUrl = process.env.NASAQ_PRIMARY_DATABASE_URL;
process.env.VERCEL = "1";
delete process.env.NASAQ_PRIMARY_DATABASE_URL;

const { ensureDbReady, getSql, normalizeDatabaseUrl } = await import("./db.ts");

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