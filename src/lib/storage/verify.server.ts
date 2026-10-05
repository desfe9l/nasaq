/**
 * Production-safe object-storage verification — server-only.
 *
 * The storage layer is deliberately silent: `uploadEditorAsset` answers
 * `not_configured` and the editor keeps its local-first library, so a
 * deployment whose R2 variables were never set looks exactly like a healthy
 * one. This module is the opposite of that default: it exercises the four real
 * operations (PUT, presigned GET, direct GET, DELETE) plus the database
 * metadata row, and reports which variable is missing when storage is off.
 *
 * It is safe to run against Production:
 *   - one object under a fresh server-minted key, deleted in the same call;
 *   - one metadata row, deleted in the same call;
 *   - on the admin path the caller's OWN user id is the namespace, so a
 *     verification can never touch another account's prefix;
 *   - only statuses, counts and variable NAMES are reported — never a
 *     credential, an endpoint, an account id or an object key.
 */
import { getObjectStorage, objectStorageMissingVariables, r2EndpointSource } from "./r2.server.ts";
import { buildStorageObjectKey } from "./provider.ts";

export interface StorageCheckStep {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface StorageRoundTripReport {
  configured: boolean;
  provider: string | null;
  bucketDefault: boolean;
  endpointSource: "R2_ENDPOINT" | "R2_ACCOUNT_ID" | "none";
  missingVariables: string[];
  steps: StorageCheckStep[];
  ok: boolean;
}

/** Server minted suffix: random and path-safe, so two runs never collide. */
function token(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

function failure(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const name = (error as { name?: string })?.name ?? "Error";
  // Provider messages can embed bucket names and keys; keep the classification.
  return status ? `${name}:${status}` : name;
}

/**
 * The storage half of the check. Runs the exact provider the editor uses, so a
 * pass here means upload/read/delete work for real — not that a mock did.
 */
export async function runStorageRoundTrip(): Promise<StorageRoundTripReport> {
  const storage = getObjectStorage();
  const report: StorageRoundTripReport = {
    configured: storage !== null,
    provider: storage?.name ?? null,
    bucketDefault: !process.env.R2_BUCKET_NAME?.trim(),
    endpointSource: r2EndpointSource(),
    missingVariables: objectStorageMissingVariables(),
    steps: [],
    ok: false,
  };
  if (!storage) {
    report.steps.push({ step: "configured", ok: false, detail: "not_configured" });
    return report;
  }
  report.steps.push({ step: "configured", ok: true, detail: storage.name });

  const suffix = token();
  const userId = `verify${suffix}`;
  const assetId = `verify${suffix}`;
  const key = buildStorageObjectKey({ userId, projectId: null, assetId });
  const bytes = new TextEncoder().encode(`nasaq-verify-${Date.now()}`);
  let written = false;

  try {
    await storage.put(key, bytes, "text/plain");
    written = true;
    report.steps.push({ step: "upload", ok: true, detail: `bytes=${bytes.byteLength}` });
  } catch (error) {
    report.steps.push({ step: "upload", ok: false, detail: failure(error) });
  }

  if (written) {
    try {
      const url = await storage.signedGetUrl(key, 300);
      const response = await fetch(url);
      const body = new Uint8Array(await response.arrayBuffer());
      const exact = Buffer.compare(Buffer.from(body), Buffer.from(bytes)) === 0;
      report.steps.push({
        step: "signed-url-read",
        ok: response.status === 200 && exact,
        detail: `status=${response.status} bytes=${body.byteLength} exact=${exact}`,
      });
    } catch (error) {
      report.steps.push({ step: "signed-url-read", ok: false, detail: failure(error) });
    }
    try {
      const body = await storage.get(key);
      const exact = Boolean(body) && Buffer.compare(Buffer.from(body!), Buffer.from(bytes)) === 0;
      report.steps.push({
        step: "read",
        ok: exact,
        detail: `bytes=${body?.byteLength ?? 0} exact=${exact}`,
      });
    } catch (error) {
      report.steps.push({ step: "read", ok: false, detail: failure(error) });
    }
  }

  try {
    await storage.delete(key);
    const after = await storage.get(key);
    report.steps.push({ step: "delete", ok: after === null, detail: `gone=${after === null}` });
  } catch (error) {
    report.steps.push({ step: "delete", ok: false, detail: failure(error) });
  }

  report.ok = report.steps.every((step) => step.ok);
  return report;
}

/** Minimal tag-template surface, so the CLI path needs no alias plumbing. */
export type SqlTag = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

export interface MetadataRoundTrip {
  steps: StorageCheckStep[];
  ok: boolean;
}

/**
 * The database half: the same insert → scoped read → delete `functions.ts`
 * performs around a real upload, under the caller's own `user_id`.
 */
export async function runMetadataRoundTrip(
  sql: SqlTag,
  userId: string,
  objectKey: string,
  byteSize: number,
): Promise<MetadataRoundTrip> {
  const steps: StorageCheckStep[] = [];
  let id: string | null = null;
  const suffix = token();
  try {
    const tables = await sql<{ assets: string | null; catalog: string | null; projects: string | null }>`
      select to_regclass('public.storage_assets') as assets,
             to_regclass('public.library_catalog') as catalog,
             to_regclass('public.storage_projects') as projects
    `;
    const row = tables[0];
    steps.push({
      step: "db-tables",
      ok: Boolean(row?.assets && row?.catalog && row?.projects),
      detail: `storage_assets=${row?.assets ? "ok" : "missing"} library_catalog=${row?.catalog ? "ok" : "missing"} storage_projects=${row?.projects ? "ok" : "missing"}`,
    });

    id = `verify${suffix}`;
    const fileName = "verify.txt";
    await sql`
      insert into storage_assets
        (id, user_id, kind, object_key, file_name, content_type, byte_size, width, height, project_id)
      values
        (${id}, ${userId}, 'project-file', ${objectKey}, ${fileName},
         'text/plain', ${byteSize}, null, null, null)
    `;
    const read = await sql<{ object_key: string }>`
      select object_key from storage_assets where id = ${id} and user_id = ${userId} limit 1
    `;
    steps.push({
      step: "db-metadata-insert+read",
      // The row must come back through the SAME ownership filter a real read
      // uses; anything else means the metadata flow is not wired to the caller.
      ok: read[0]?.object_key === objectKey,
    });
  } catch (error) {
    steps.push({ step: "db-metadata", ok: false, detail: failure(error) });
  }

  if (id) {
    try {
      await sql`delete from storage_assets where id = ${id} and user_id = ${userId}`;
      const left = await sql`select 1 from storage_assets where id = ${id}`;
      steps.push({ step: "db-metadata-delete", ok: left.length === 0 });
    } catch (error) {
      steps.push({ step: "db-metadata-delete", ok: false, detail: failure(error) });
    }
  }
  return { steps, ok: steps.every((step) => step.ok) };
}
