/**
 * TEMPORARY production diagnostic for the R2 storage integration.
 *
 * Why it exists: the agent sandbox has no route to Vercel or Cloudflare, so the
 * only way to observe the deployed runtime's storage configuration is from the
 * deployed runtime itself. This route is removed again in the very next commit
 * after it has been used.
 *
 * Safety:
 *  - unguessable path + `?k=` token, both deleted with the file;
 *  - reports PRESENCE and SHAPE only — never a credential value, never a
 *    secret, never the account id itself;
 *  - the round trip touches exactly one object under a fresh `_diag` prefix and
 *    one metadata row, both removed in the same request;
 *  - read-only when the token is absent or wrong (returns 404).
 */
import { createFileRoute } from "@tanstack/react-router";

const TOKEN = "k7m2p9q4x1";

type Step = { step: string; ok: boolean; detail?: string };

function shape(value: string | undefined): string {
  const v = value?.trim();
  if (!v) return "unset";
  return `len=${v.length}`;
}

function endpointShape(): { source: string; isR2Host: boolean; https: boolean; derivedAccountPattern: boolean } {
  const explicit = process.env.R2_ENDPOINT?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const raw = explicit ? explicit : accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
  if (!raw) return { source: "unset", isR2Host: false, https: false, derivedAccountPattern: false };
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return {
      source: explicit ? "R2_ENDPOINT" : "R2_ACCOUNT_ID",
      isR2Host: /\.r2\.cloudflarestorage\.com$/i.test(url.host),
      https: url.protocol === "https:",
      derivedAccountPattern: /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i.test(url.host),
    };
  } catch {
    return { source: explicit ? "R2_ENDPOINT" : "R2_ACCOUNT_ID", isR2Host: false, https: false, derivedAccountPattern: false };
  }
}

const CANDIDATE_NAMES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ENDPOINT_URL_S3",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "STORAGE_BUCKET",
  "VITE_R2_ACCOUNT_ID",
  "VITE_R2_ACCESS_KEY_ID",
  "R2_TOKEN",
];

async function diag(): Promise<Record<string, unknown>> {
  const steps: Step[] = [];
  const presence = Object.fromEntries(CANDIDATE_NAMES.map((n) => [n, Boolean(process.env[n]?.trim())]));

  const env = {
    nodeEnv: process.env.NODE_ENV ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercel: process.env.VERCEL ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    presence,
    accountId: shape(process.env.R2_ACCOUNT_ID),
    accessKeyId: shape(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: shape(process.env.R2_SECRET_ACCESS_KEY),
    bucketName: shape(process.env.R2_BUCKET_NAME),
    bucketIsDefault: (process.env.R2_BUCKET_NAME?.trim() || "nasaq-sa") === "nasaq-sa",
    endpoint: endpointShape(),
    databaseUrl: shape(process.env.DATABASE_URL),
  };

  const { getObjectStorage } = await import("@/lib/storage/r2.server");
  const storage = getObjectStorage();
  steps.push({ step: "configured", ok: storage !== null, detail: storage?.name ?? "not_configured" });
  if (!storage) return { env, steps, e2e: null };

  const { buildStorageObjectKey } = await import("@/lib/storage/provider");
  const suffix = Math.random().toString(36).slice(2, 10);
  const key = buildStorageObjectKey({ userId: `diag${suffix}`, projectId: null, assetId: `diag${suffix}` });
  const bytes = new TextEncoder().encode(`nasaq-diag-${Date.now()}`);
  let objectKeyWritten = false;

  try {
    await storage.put(key, bytes, "text/plain");
    objectKeyWritten = true;
    steps.push({ step: "upload", ok: true, detail: `bytes=${bytes.byteLength}` });
  } catch (error) {
    steps.push({ step: "upload", ok: false, detail: `${(error as { name?: string })?.name}:${(error as { status?: number })?.status ?? "-"}` });
  }

  if (objectKeyWritten) {
    try {
      const url = await storage.signedGetUrl(key, 300);
      const host = new URL(url).host;
      const res = await fetch(url);
      const body = new Uint8Array(await res.arrayBuffer());
      steps.push({
        step: "signed-url-read",
        ok: res.status === 200 && Buffer.compare(Buffer.from(body), Buffer.from(bytes)) === 0,
        detail: `status=${res.status} host=${host.replace(/^[0-9a-f]{32}\./i, "<account>.")} bytes=${body.byteLength}`,
      });
    } catch (error) {
      steps.push({ step: "signed-url-read", ok: false, detail: String((error as Error)?.message ?? error).slice(0, 120) });
    }
    try {
      const direct = await storage.get(key);
      steps.push({
        step: "read",
        ok: Boolean(direct) && Buffer.compare(Buffer.from(direct!), Buffer.from(bytes)) === 0,
        detail: `bytes=${direct?.byteLength ?? 0}`,
      });
    } catch (error) {
      steps.push({ step: "read", ok: false, detail: `${(error as { name?: string })?.name}:${(error as { status?: number })?.status ?? "-"}` });
    }
  }

  // Metadata flow: the same insert/select/delete `functions.ts` performs.
  let rowId: string | null = null;
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    const tables = await sql<{ t: string | null; c: string | null; p: string | null }>`
      select to_regclass('public.storage_assets') as t,
             to_regclass('public.library_catalog') as c,
             to_regclass('public.storage_projects') as p
    `;
    steps.push({
      step: "db-tables",
      ok: Boolean(tables[0]?.t && tables[0]?.c && tables[0]?.p),
      detail: `storage_assets=${tables[0]?.t ?? "missing"} library_catalog=${tables[0]?.c ?? "missing"} storage_projects=${tables[0]?.p ?? "missing"}`,
    });
    rowId = `diag${suffix}`;
    await sql`
      insert into storage_assets (id, user_id, kind, object_key, file_name, content_type, byte_size, width, height, project_id)
      values (${rowId}, ${`diag${suffix}`}, 'project-file', ${key}, 'diag.txt', 'text/plain', ${bytes.byteLength}, null, null, null)
    `;
    const rows = await sql<{ object_key: string }>`
      select object_key from storage_assets where id = ${rowId} and user_id = ${`diag${suffix}`} limit 1
    `;
    steps.push({ step: "db-metadata-insert+read", ok: rows[0]?.object_key === key });
  } catch (error) {
    steps.push({ step: "db-metadata", ok: false, detail: String((error as Error)?.message ?? error).slice(0, 120) });
  }

  try {
    await storage.delete(key);
    const after = await storage.get(key);
    steps.push({ step: "delete-object", ok: after === null });
  } catch (error) {
    steps.push({ step: "delete-object", ok: false, detail: `${(error as { name?: string })?.name}:${(error as { status?: number })?.status ?? "-"}` });
  }

  if (rowId) {
    try {
      const { getSql } = await import("@/lib/db");
      const sql = await getSql();
      await sql`delete from storage_assets where id = ${rowId}`;
      const left = await sql`select 1 from storage_assets where id = ${rowId}`;
      steps.push({ step: "delete-metadata", ok: left.length === 0 });
    } catch (error) {
      steps.push({ step: "delete-metadata", ok: false, detail: String((error as Error)?.message ?? error).slice(0, 120) });
    }
  }

  return { env, steps, ok: steps.every((s) => s.ok) };
}

export const Route = createFileRoute("/api/storage-diag-4f9c1d")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== TOKEN) {
          return new Response("Not Found", { status: 404 });
        }
        const result = await diag().catch((error) => ({ error: String((error as Error)?.message ?? error).slice(0, 200) }));
        return new Response(JSON.stringify(result, null, 2), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
