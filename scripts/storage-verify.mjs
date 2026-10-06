#!/usr/bin/env node
/**
 * `npm run storage:verify` — is object storage actually working here?
 *
 * The editor's asset library is local-first ON PURPOSE: when the R2 variables
 * are missing, every storage call answers `not_configured` and the app keeps
 * working from IndexedDB. That makes a broken deployment look healthy, which is
 * exactly what this command exists to prevent:
 *
 *   1. reports the variable NAMES that are missing (never a value);
 *   2. runs the real provider — upload, presigned read, direct read, delete;
 *   3. runs the `storage_assets` metadata insert → scoped read → delete flow;
 *   4. exits non-zero on the first failure, so CI and the owner can trust it.
 *
 * Production-safe: it writes ONE object under a fresh `verify…` prefix and one
 * metadata row, and removes both in the same run. Nothing else is touched.
 *
 * Usage:
 *   R2_* + DATABASE_URL in the environment (or in the deployment that runs it)
 *   npm run storage:verify
 *
 * Requires Node 22 (`--experimental-strip-types`, already the deployment
 * runtime). The same checks run in production through the admin-only
 * `verifyObjectStorage` server function (owner vault).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, "src/lib/storage/verify.server.ts");

if (!existsSync(target)) {
  console.error("✗ storage:verify must run from the NASAQ repository root.");
  process.exit(2);
}

const { runStorageRoundTrip, runMetadataRoundTrip } = await import(target);

const line = (step) =>
  `  ${step.ok ? "✓" : "✗"} ${step.step}${step.detail ? ` — ${step.detail}` : ""}`;

console.log("NASAQ object storage verification");
console.log(`  VERCEL_ENV=${process.env.VERCEL_ENV ?? "-"} NODE_ENV=${process.env.NODE_ENV ?? "-"}`);

const report = await runStorageRoundTrip();
console.log(`  configured=${report.configured} provider=${report.provider ?? "-"} endpoint=${report.endpointSource} bucketDefault=${report.bucketDefault}`);
if (!report.configured) {
  console.log(`  missing: ${report.missingVariables.join(", ")}`);
  console.log("  → set those in Vercel → Settings → Environment Variables (Production) and redeploy.");
  console.log("  → the integration needs an R2 API token with Object Read & Write on the bucket.");
}
for (const step of report.steps) console.log(line(step));

let metadataOk = true;
if (!report.configured) {
  metadataOk = false;
} else if (!process.env.DATABASE_URL?.trim()) {
  console.log("  ! metadata check skipped — DATABASE_URL is not set in this process.");
} else {
  const { default: pg } = await import("pg");
  function normalizeDatabaseUrl(connectionString) {
    if (!connectionString) return connectionString;
    const trimmed = connectionString.trim();
    if (!trimmed) return undefined;
    try {
      const url = new URL(trimmed);
      const sslmode = url.searchParams.get("sslmode");
      if (sslmode && ["require", "prefer", "verify-ca"].includes(sslmode.toLowerCase())) {
        url.searchParams.set("sslmode", "verify-full");
        return url.toString();
      }
    } catch {}
    return trimmed;
  }
  const client = new pg.Client({
    connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
  });
  try {
    await client.connect();
    const sql = async (strings, ...values) => {
      const text = strings.reduce((acc, part, index) => acc + (index ? `$${index}` : "") + part, "");
      const result = await client.query(text, values);
      return result.rows;
    };
    // A real, standalone object + row for the metadata half: the round trip in
    // `runStorageRoundTrip` already deleted its own object.
    const { getObjectStorage } = await import(join(root, "src/lib/storage/r2.server.ts"));
    const { buildStorageObjectKey } = await import(join(root, "src/lib/storage/provider.ts"));
    const storage = getObjectStorage();
    const suffix = Math.random().toString(16).slice(2, 12);
    const objectKey = buildStorageObjectKey({
      userId: `cli${suffix}`,
      projectId: null,
      assetId: `cli${suffix}`,
    });
    const bytes = new Uint8Array(Buffer.from(`nasaq-cli-verify-${Date.now()}`, "utf8"));
    let written = false;
    try {
      await storage.put(objectKey, bytes, "text/plain");
      written = true;
      const result = await runMetadataRoundTrip(sql, `cli${suffix}`, objectKey, bytes.byteLength);
      metadataOk = result.ok;
      for (const step of result.steps) console.log(line(step));
    } finally {
      if (written) {
        try {
          await storage.delete(objectKey);
        } catch {
          /* reported by the delete step above */
        }
      }
      await client.end();
    }
  } catch (error) {
    metadataOk = false;
    console.log(`  ✗ database — ${String(error?.message ?? error).slice(0, 160)}`);
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

const ok = report.ok && metadataOk;
console.log(ok ? "RESULT: storage OK" : "RESULT: storage NOT ready");
process.exit(ok ? 0 : 1);
