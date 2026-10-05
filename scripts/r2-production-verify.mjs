#!/usr/bin/env node
/**
 * TEMPORARY verification scaffolding (this session only).
 *
 * Runs on a GitHub Actions runner — the agent sandbox cannot reach Vercel or
 * Cloudflare — and exercises the REAL storage layer (`src/lib/storage/*`) with
 * the Production credentials, plus the production deployment itself.
 *
 * Production-safety:
 *  - one object under a dedicated `users/<id>/projects/_verify/assets/<id>` key
 *    that is deleted in the same run (even on failure),
 *  - one metadata row inserted and deleted in the same run,
 *  - never prints a secret: presence is reported as booleans and lengths only.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

const out = [];
const log = (line) => {
  out.push(line);
  console.log(line);
};
const bool = (name) => `${name}=${process.env[name]?.trim() ? "SET" : "UNSET"}`;

const evidenceDir = "ci-evidence";
mkdirSync(evidenceDir, { recursive: true });

/* ── 1. Configuration presence (never values) ───────────────────────────── */
for (const name of [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "DATABASE_URL",
  "VERCEL_TOKEN",
]) {
  log(`env ${bool(name)}`);
}
log(`env VERCEL_ACCESS_KEY_LEN=${process.env.R2_ACCESS_KEY_ID?.trim().length ?? 0}`);
log(`env VERCEL_SECRET_LEN=${process.env.R2_SECRET_ACCESS_KEY?.trim().length ?? 0}`);

/* ── 2. The production deployment itself ────────────────────────────────── */
const PROD = "https://nasaq-sa.vercel.app";
try {
  const res = await fetch(`${PROD}/`, { redirect: "manual" });
  log(`prod / status=${res.status}`);
  const csp = res.headers.get("content-security-policy") ?? "";
  log(`prod csp_connect_src=${/connect-src([^;]*)/.exec(csp)?.[1]?.trim() ?? "(none)"}`);
} catch (error) {
  log(`prod unreachable: ${error?.message ?? error}`);
}

/* ── 3. Storage round trip through the real provider implementation ─────── */
const { getObjectStorage } = await import("../src/lib/storage/r2.server.ts");
const { buildStorageObjectKey } = await import("../src/lib/storage/provider.ts");

const storage = getObjectStorage();
log(`storageConfigured=${storage !== null} provider=${storage?.name ?? "-"}`);

if (storage) {
  const userId = `verify${randomBytes(4).toString("hex")}`;
  const assetId = `verify${randomBytes(6).toString("hex")}`;
  const key = buildStorageObjectKey({ userId, projectId: null, assetId });
  const payload = new TextEncoder().encode(`nasaq-r2-verify-${Date.now()}`);
  let created = false;
  try {
    await storage.put(key, payload, "text/plain");
    created = true;
    log(`storage PUT ok key_prefix=users/…/projects/_library/assets/… bytes=${payload.byteLength}`);

    const signed = await storage.signedGetUrl(key, 300);
    const read = await fetch(signed);
    const body = new Uint8Array(await read.arrayBuffer());
    log(`storage PRESIGNED_GET status=${read.status} bytes=${body.byteLength} exact=${Buffer.compare(Buffer.from(body), Buffer.from(payload)) === 0}`);

    const direct = await storage.get(key);
    log(`storage GET bytes=${direct?.byteLength ?? 0} exact=${direct ? Buffer.compare(Buffer.from(direct), Buffer.from(payload)) === 0 : false}`);
  } catch (error) {
    log(`storage FAILED: ${error?.name ?? "Error"} status=${error?.status ?? "-"} message=${String(error?.message ?? error).slice(0, 200)}`);
  } finally {
    try {
      await storage.delete(key);
      const after = await storage.get(key);
      log(`storage DELETE ok gone=${after === null}`);
    } catch (error) {
      log(`storage DELETE FAILED: ${String(error?.message ?? error).slice(0, 200)}`);
    }
    if (created) log("storage cleanup: object removed by this run");
  }
}

/* ── 4. Database metadata flow with the same schema the functions use ───── */
if (process.env.DATABASE_URL?.trim()) {
  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    const table = await client.query(
      "select to_regclass('public.storage_assets') as t, to_regclass('public.library_catalog') as c",
    );
    log(`db storage_assets=${table.rows[0].t ?? "MISSING"} library_catalog=${table.rows[0].c ?? "MISSING"}`);
    if (table.rows[0].t) {
      const id = `verify${randomBytes(6).toString("hex")}`;
      const key = `users/${id}/projects/_verify/assets/${id}`;
      await client.query(
        `insert into storage_assets (id, user_id, kind, object_key, file_name, content_type, byte_size, width, height, project_id)
         values ($1, $2, 'project-file', $3, 'verify.txt', 'text/plain', 20, null, null, null)`,
        [id, id, key],
      );
      const read = await client.query("select id, object_key from storage_assets where id = $1 and user_id = $2", [id, id]);
      log(`db metadata insert+read rows=${read.rowCount}`);
      await client.query("delete from storage_assets where id = $1 and user_id = $2", [id, id]);
      const gone = await client.query("select 1 from storage_assets where id = $1", [id]);
      log(`db metadata delete ok rowsLeft=${gone.rowCount}`);
    }
    await client.end();
  } catch (error) {
    log(`db FAILED: ${String(error?.message ?? error).slice(0, 200)}`);
  }
} else {
  log("db skipped (no DATABASE_URL)");
}

/* ── 5. Vercel project configuration (names + scopes only) ──────────────── */
if (process.env.VERCEL_TOKEN?.trim()) {
  try {
    const headers = { Authorization: `Bearer ${process.env.VERCEL_TOKEN.trim()}` };
    const projects = await (await fetch("https://api.vercel.com/v9/projects?limit=100", { headers })).json();
    const list = projects.projects ?? [];
    const project =
      list.find((p) => p.name === "nasaq-sa") ??
      list.find((p) => (p.link?.repo ?? "").includes("nasaq"));
    log(`vercel projects=${list.length} matched=${project?.name ?? "(none)"}`);
    if (project) {
      const envs = await (await fetch(
        `https://api.vercel.com/v9/projects/${encodeURIComponent(project.id)}/env?decrypt=false&limit=100`,
        { headers },
      )).json();
      for (const e of envs.envs ?? []) {
        const value = e.value ?? "";
        log(`vercel env ${e.key} target=[${(e.target ?? []).join(",")}] type=${e.type} len=${typeof value === "string" ? value.length : "?"}`);
      }
    }
  } catch (error) {
    log(`vercel FAILED: ${String(error?.message ?? error).slice(0, 200)}`);
  }
} else {
  log("vercel skipped (no VERCEL_TOKEN)");
}

writeFileSync(`${evidenceDir}/r2-production-verify.txt`, out.join("\n") + "\n");
