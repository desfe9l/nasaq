#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * in ../migrations to NASAQ_PRIMARY_DATABASE_URL. Each file is applied in one transaction and
 * recorded in a `_migrations` table, so it runs once and is safe to re-run.
 *
 * No NASAQ_PRIMARY_DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";

function normalizeDatabaseUrl(connectionString) {
  if (!connectionString) return connectionString;
  const trimmed = connectionString.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode && ["require", "prefer", "verify-ca"].includes(sslmode.toLowerCase())) {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    /* invalid URL format */
  }
  return trimmed;
}

const databaseUrl = normalizeDatabaseUrl(process.env.NASAQ_PRIMARY_DATABASE_URL);
if (process.env.VERCEL_ENV === "preview") {
  // Preview shares the Production schema, so it never runs deploy-time
  // migrations. This is decided by the environment alone — a Preview build
  // without NASAQ_PRIMARY_DATABASE_URL is still a Preview build, not a
  // Production one missing its database.
  console.log(
    "[migrate] Vercel Preview — skipping deploy-time migrations; Preview shares the Production schema.",
  );
  process.exit(0);
}
if (!databaseUrl) {
  if (process.env.VERCEL === "1" || process.env.NASAQ_STRICT_ENV === "1") {
    console.error(
      "[migrate] NASAQ_PRIMARY_DATABASE_URL is required on a deployed runtime; refusing to ship without the primary database.",
    );
    process.exit(1);
  }
  console.log(
    "[migrate] NASAQ_PRIMARY_DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    entries = await readdir(migrationsDir);
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const applied = (await client.query("SELECT name FROM _migrations")).rows.map(
      (r) => r.name,
    );

    let count = 0;
    for (const { name } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, name), "utf8");
      try {
        await client.query("BEGIN");
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * SQLSTATEs and network codes that identify an unavailable primary database.
 *
 * Connection exceptions (class 08), resource exhaustion (53xxx), lock/connect
 * timeouts, and the usual socket errors all fall here.
 */
const INFRASTRUCTURE_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "53000", "53100", "53200", "53300", "53400",
  "55P03", "57P03", "57014",
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "EPIPE", "EHOSTUNREACH", "ENETUNREACH",
]);

function isInfrastructureFailure(err) {
  if (!err) return false;
  if (INFRASTRUCTURE_CODES.has(String(err.code ?? ""))) return true;
  return /quota|insufficient resources|too many (clients|connections)|terminating connection|connection (refused|reset|terminated)|timed out|timeout expired/i.test(
    String(err.message ?? ""),
  );
}

main().catch((err) => {
  // pg errors carry the context needed to debug a bad SQL file; a credential or
  // bookkeeping failure is quoted the same way.
  const detail = `[migrate] ${err?.message || err}`;
  const context = ["code", "detail", "hint", "position", "where"]
    .filter((key) => err?.[key] != null)
    .map((key) => `\n[migrate]   ${key}: ${err[key]}`)
    .join("");

  if (isInfrastructureFailure(err)) {
    // A deployed bundle must never reach traffic with an unverified schema.
    // Each file is transactional, so a failed run leaves the target consistent;
    // the operator can retry after fixing the independent provider resource.
    console.error("[migrate] ERROR: the primary database is unavailable; deployment is blocked and no writes were accepted.");
    console.error(detail + context);
    console.error("[migrate] Run `NASAQ_PRIMARY_DATABASE_URL=… npm run db:migrate` after restoring the primary resource.");
    process.exit(1);
  }

  console.error("[migrate] failed:" + context.replace(/^\n/, " "));
  console.error(detail);
  // A bad migration must stop the deploy: shipping a bundle that assumes a
  // schema which was never created breaks requests instead of the build.
  process.exit(1);
});
