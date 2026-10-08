import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/**
 * Cloud project mirror — local IndexedDB stays source of truth, server is
 * best-effort with version conflict guard. Never silently overwrites newer remote.
 */

type CloudRow = {
  id: string;
  user_id: string;
  payload: JsonObject;
  version: number;
  updated_at: string;
  created_at: string;
};

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export const getCloudProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ projects: Array<{ id: string; payload: JsonObject; version: number; updatedAt: string }> }> => {
    const sql = await getSql();
    const rows = await sql<CloudRow>`select id, payload, version, updated_at from cloud_projects where user_id = ${context.userId} order by updated_at desc`;
    return {
      projects: rows.map((r) => ({
        id: r.id,
        payload: r.payload,
        version: Number(r.version),
        updatedAt: toIso(r.updated_at),
      })),
    };
  });

export const getCloudProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown>)?.id === "string" ? String((input as Record<string, unknown>).id).trim() : "";
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<any> => {
    const sql = await getSql();
    const rows = await sql<CloudRow>`select id, payload, version, updated_at from cloud_projects where id = ${data.id} and user_id = ${context.userId} limit 1`;
    const row = rows[0];
    if (!row) return { project: null };
    return { project: { id: row.id, payload: row.payload, version: Number(row.version), updatedAt: toIso(row.updated_at) } };
  });

export const getCloudProjectVersion = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown>)?.id === "string" ? String((input as Record<string, unknown>).id).trim() : "";
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<any> => {
    const sql = await getSql();
    const rows = await sql<{ updated_at: string; version: number }>`select updated_at, version from cloud_projects where id = ${data.id} and user_id = ${context.userId} limit 1`;
    if (!rows[0]) return { updatedAt: null, version: null };
    return { updatedAt: new Date(rows[0].updated_at).getTime(), version: Number(rows[0].version) };
  });

export const saveCloudProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string; payload: JsonObject; updatedAt?: number; version?: number } => {
    const rec = input as Record<string, unknown>;
    const id = typeof rec?.id === "string" ? rec.id.trim() : "";
    if (!id || id.length > 120) throw new Error("id غير صالح");
    if (!rec?.payload || typeof rec.payload !== "object") throw new Error("payload غير صالح");
    return { id, payload: rec.payload as JsonObject, updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : Date.now(), version: typeof rec.version === "number" ? rec.version : undefined };
  })
  .handler(async ({ context, data }): Promise<any> => {
    const { refreshControlPlane } = await import("@/lib/control-plane/store.server");
    const { gateService } = await import("@/lib/control-plane/decisions");
    const { enforcementPlane, noteProviderSignal } = await import("@/lib/control-plane/snapshot");
    const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
    await refreshControlPlane();
    const access = await getAuthorizationContext({
      id: context.userId,
      email: context.userEmail,
      emailVerified: context.userEmailVerified,
    });
    const gate = gateService(enforcementPlane(), "documents", { privileged: access.isOwner || access.isAdmin });
    if (!gate.allowed) return { ok: false, reason: gate.code, service: "documents" };
    try {
    const sql = await getSql();
    // Conflict check: fetch existing version
    const existing = await sql<{ version: number; updated_at: string }>`select version, updated_at from cloud_projects where id = ${data.id} and user_id = ${context.userId} limit 1`;
    const remote = existing[0];
    const incomingVersion = data.updatedAt ?? Date.now();
    if (remote) {
      const remoteTs = new Date(remote.updated_at).getTime();
      // If remote is newer than incoming by >2s, don't overwrite
      if (remoteTs - incomingVersion > 2000) {
        return { ok: false, conflict: true, remoteVersion: Number(remote.version), remoteUpdatedAt: remoteTs };
      }
      // Check strict version if supplied
      if (typeof data.version === "number" && data.version < Number(remote.version)) {
        return { ok: false, conflict: true, remoteVersion: Number(remote.version), remoteUpdatedAt: remoteTs };
      }
    }
    const payloadJson = JSON.stringify(data.payload);
    // Upsert with version bump
    await sql`
      insert into cloud_projects (id, user_id, payload, version, updated_at, created_at)
      values (${data.id}, ${context.userId}, ${payloadJson}::jsonb, ${remote ? Number(remote.version) + 1 : 1}, to_timestamp(${incomingVersion} / 1000.0), now())
      on conflict (id) do update set
        payload = excluded.payload,
        version = cloud_projects.version + 1,
        updated_at = excluded.updated_at
      where cloud_projects.user_id = ${context.userId}
    `;
    return { ok: true };
    } catch {
      noteProviderSignal("database", "down");
      return { ok: false, reason: "database_unavailable", service: "database" };
    }
  });

export const deleteCloudProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown>)?.id === "string" ? String((input as Record<string, unknown>).id).trim() : "";
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const sql = await getSql();
    // Conflict: don't delete if remote newer than local delete timestamp? For now allow.
    await sql`delete from cloud_projects where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true };
  });
