import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  deleteCloudProjectRow,
  getCloudProjectRow,
  getCloudProjectVersionInfo,
  listCloudProjects,
  saveCloudProjectRow,
  classifyAndNoteDatabaseFailure,
  type JsonObject,
} from "./cloud-projects.server";

/**
 * Cloud project mirror — server functions. Local IndexedDB stays the source of
 * truth on the device; the mirror is best-effort with a version-conflict guard
 * and never silently overwrites a newer remote document.
 *
 * The business logic lives in `./cloud-projects.server.ts` and is shared with
 * the plain HTTP endpoints at `/api/offline/*`, which the offline sync queue
 * pushes through (see the module comment there for why both surfaces exist).
 */

export const getCloudProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ projects: Array<{ id: string; payload: JsonObject; version: number; updatedAt: string }> }> => {
    const sql = await getSql();
    return { projects: await listCloudProjects(sql, context.userId) };
  });

export const getCloudProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown>)?.id === "string" ? String((input as Record<string, unknown>).id).trim() : "";
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ project: { id: string; payload: JsonObject; version: number; updatedAt: string } | null }> => {
    const sql = await getSql();
    const row = await getCloudProjectRow(sql, context.userId, data.id);
    return { project: row };
  });

export const getCloudProjectVersion = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown>)?.id === "string" ? String((input as Record<string, unknown>).id).trim() : "";
    if (!id) throw new Error("id required");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ updatedAt: number | null; version: number | null }> => {
    const sql = await getSql();
    return getCloudProjectVersionInfo(sql, context.userId, data.id);
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
    const { enforcementPlane } = await import("@/lib/control-plane/snapshot");
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
      const result = await saveCloudProjectRow(sql, context.userId, {
        id: data.id,
        payload: data.payload,
        updatedAt: data.updatedAt ?? Date.now(),
        version: data.version,
      });
      return result;
    } catch (error) {
      const { reason } = await classifyAndNoteDatabaseFailure(error);
      return { ok: false, reason, service: "database" };
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
    return deleteCloudProjectRow(sql, context.userId, data.id);
  });
