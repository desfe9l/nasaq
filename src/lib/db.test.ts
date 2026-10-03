import assert from "node:assert/strict";
import { test } from "node:test";

const originalVercel = process.env.VERCEL;
const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.VERCEL = "1";
delete process.env.DATABASE_URL;

const { ensureDbReady, getSql } = await import("./db.ts");

if (originalVercel === undefined) delete process.env.VERCEL;
else process.env.VERCEL = originalVercel;
if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = originalDatabaseUrl;

test("Vercel bootstrap stays renderable without a database but DB access fails closed", async () => {
  await assert.doesNotReject(ensureDbReady());
  await assert.rejects(
    getSql(),
    /DATABASE_URL is not set on this deployment/,
  );
});