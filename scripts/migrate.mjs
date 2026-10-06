#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * in ../migrations to DATABASE_URL. Each file is applied in one transaction and
 * recorded in a `_migrations` table, so it runs once and is safe to re-run.
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";

function normalizeDatabaseUrl(connectionString, options = {}) {
  if (!connectionString) return connectionString;
  const trimmed = connectionString.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    const sslmode = url.searchParams.get("sslmode");
    if (sslmode && ["require", "prefer", "verify-ca"].includes(sslmode.toLowerCase())) {
      url.searchParams.set("sslmode", "verify-full");
    }
    const usePooler = options.pooled !== false;
    if (usePooler && url.hostname.endsWith(".neon.tech")) {
      const parts = url.hostname.split(".");
      if (parts[0] && parts[0].startsWith("ep-") && !parts[0].endsWith("-pooler")) {
        parts[0] = `${parts[0]}-pooler`;
        url.hostname = parts.join(".");
      }
    }
    return url.toString();
  } catch {
    /* invalid URL format */
  }
  return trimmed;
}

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL, { pooled: false });
if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}
if (process.env.VERCEL_ENV === "preview") {
  console.log(
    "[migrate] Vercel Preview — skipping deploy-time migrations; Preview shares the Production schema.",
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

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  // Neon/Vercel Postgres answers 53000 when the project is over quota. The
  // schema cannot move until the plan is raised, but the app bundle above this
  // step is already built — failing the deploy only keeps production on the
  // previous broken release.
  const quota =
    String(err?.code ?? "") === "53000" ||
    /exceeded the quota/i.test(String(err?.message ?? ""));
  if (quota && process.env.VERCEL === "1") {
    console.error(
      "[migrate] database quota exceeded — shipping this build unchanged. Raise the database plan before the next migration.",
    );
    process.exit(0);
  }
  process.exit(1);
});
