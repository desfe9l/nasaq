/**
 * Cloud project mirror — server-side business logic, shared by BOTH surfaces:
 *
 *   · the TanStack Start server functions (`./functions.ts`), and
 *   · the plain HTTP endpoints at `/api/offline/*` (`src/routes/api/offline/$.ts`).
 *
 * WHY TWO SURFACES: the offline sync queue pushes from the browser with plain
 * `fetch()` (so a sync attempt is one honest HTTP request with a status code,
 * a timeout and no framework serialization in between). The endpoints used to
 * be missing entirely — the client POSTed to `/api/offline/saveCloudProject`
 * while only the server FUNCTIONS existed — so every push fell into the SPA
 * fallback, parsed no JSON, and the queue never drained: "synchronization
 * does not work". The logic now lives here once; neither surface can drift.
 *
 * Local IndexedDB stays the source of truth on the device; this mirror is the
 * cross-session/cross-device copy with a version-conflict guard. It never
 * silently overwrites a newer remote document.
 */
import type { Sql } from "@/lib/db";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type CloudProjectRow = {
  id: string;
  payload: JsonObject;
  version: number;
  updatedAt: string;
};

export type SaveCloudProjectInput = {
  id: string;
  payload: JsonObject;
  updatedAt: number;
  version?: number;
};

export type SaveCloudProjectResult =
  | { ok: true }
  | { ok: false; conflict: true; remoteVersion: number; remoteUpdatedAt: number }
  | { ok: false; reason: string; service?: string };

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export async function listCloudProjects(
  sql: Sql,
  userId: string,
): Promise<CloudProjectRow[]> {
  const rows = await sql<{ id: string; payload: JsonObject; version: number; updated_at: string }>`
    select id, payload, version, updated_at from cloud_projects
    where user_id = ${userId} order by updated_at desc
  `;
  return rows.map((r) => ({
    id: r.id,
    payload: r.payload,
    version: Number(r.version),
    updatedAt: toIso(r.updated_at),
  }));
}

export async function getCloudProjectRow(
  sql: Sql,
  userId: string,
  id: string,
): Promise<CloudProjectRow | null> {
  const rows = await sql<{ id: string; payload: JsonObject; version: number; updated_at: string }>`
    select id, payload, version, updated_at from cloud_projects
    where id = ${id} and user_id = ${userId} limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    payload: row.payload,
    version: Number(row.version),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getCloudProjectVersionInfo(
  sql: Sql,
  userId: string,
  id: string,
): Promise<{ updatedAt: number | null; version: number | null }> {
  const rows = await sql<{ updated_at: string; version: number }>`
    select updated_at, version from cloud_projects
    where id = ${id} and user_id = ${userId} limit 1
  `;
  if (!rows[0]) return { updatedAt: null, version: null };
  return { updatedAt: new Date(rows[0].updated_at).getTime(), version: Number(rows[0].version) };
}

/**
 * Upsert one document into the mirror with the conflict guard:
 *   · a remote document more than 2 s NEWER than the incoming one wins — the
 *     older write is refused with `conflict: true`, never applied;
 *   · a caller-supplied version lower than the remote version is refused too;
 *   · otherwise the payload replaces the row and the version increments.
 */
export async function saveCloudProjectRow(
  sql: Sql,
  userId: string,
  data: SaveCloudProjectInput,
): Promise<SaveCloudProjectResult> {
  const existing = await sql<{ version: number; updated_at: string }>`
    select version, updated_at from cloud_projects
    where id = ${data.id} and user_id = ${userId} limit 1
  `;
  const remote = existing[0];
  const incomingVersion = data.updatedAt;
  if (remote) {
    const remoteTs = new Date(remote.updated_at).getTime();
    if (remoteTs - incomingVersion > 2000) {
      return {
        ok: false,
        conflict: true,
        remoteVersion: Number(remote.version),
        remoteUpdatedAt: remoteTs,
      };
    }
    if (typeof data.version === "number" && data.version < Number(remote.version)) {
      return {
        ok: false,
        conflict: true,
        remoteVersion: Number(remote.version),
        remoteUpdatedAt: remoteTs,
      };
    }
  }
  const payloadJson = JSON.stringify(data.payload);
  await sql`
    insert into cloud_projects (id, user_id, payload, version, updated_at, created_at)
    values (${data.id}, ${userId}, ${payloadJson}::jsonb, ${remote ? Number(remote.version) + 1 : 1}, to_timestamp(${incomingVersion} / 1000.0), now())
    on conflict (id) do update set
      payload = excluded.payload,
      version = cloud_projects.version + 1,
      updated_at = excluded.updated_at
    where cloud_projects.user_id = ${userId}
  `;
  return { ok: true };
}

export async function deleteCloudProjectRow(
  sql: Sql,
  userId: string,
  id: string,
): Promise<{ ok: boolean }> {
  await sql`delete from cloud_projects where id = ${id} and user_id = ${userId}`;
  return { ok: true };
}

/** True when a thrown error is the database running out of capacity/quota. */
export async function classifyAndNoteDatabaseFailure(error: unknown): Promise<{
  reason: "provider_limited" | "database_unavailable";
}> {
  const { classifyDatabaseFailure } = await import("@/lib/control-plane/decisions");
  const { noteProviderSignal } = await import("@/lib/control-plane/snapshot");
  const kind = classifyDatabaseFailure(error);
  noteProviderSignal("database", kind);
  return { reason: kind === "quota" ? "provider_limited" : "database_unavailable" };
}
