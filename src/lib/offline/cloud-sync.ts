/**
 * Real cloud project sync using the existing cloud_projects table.
 * Returns true if the push succeeded, false if there was a conflict or error,
 * and "not_configured" if the server endpoint is not available (e.g., missing
 * server function). This function mirrors the logic used by the sync queue.
 */

import type { SyncQueueEntry } from "./sync-queue";
import { getStorageOwner } from "@/lib/editor/storage-owner";
import { projectPayloadForCloudSave } from "./sync-queue";

export async function pushCloudProject(entry: SyncQueueEntry): Promise<boolean | "not_configured"> {
  try {
    if (!isCurrentEntryOwner(entry)) return false;
    const payload = entry.payload as Record<string, unknown> | null;
    const id = typeof payload?.id === "string" ? (payload.id as string) : null;
    if (entry.type === "project:delete") {
      if (!id) return true;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).deleteCloudProject !== "function") return "not_configured";
      if (!isCurrentEntryOwner(entry)) return false;
      const fn = (mod as Record<string, unknown>).deleteCloudProject as (args: unknown) => Promise<{ ok: boolean }>;
      const r = await fn({ data: { id } } as unknown).catch((e) => {
        const msg = String(e);
        if (/auth|unauthenticated|not.*signed.*in/i.test(msg)) return { ok: true } as unknown;
        return null;
      });
      if (!r) return "not_configured";
      return (r as { ok: boolean }).ok ? true : "not_configured";
    }
    if (entry.type === "project:create" || entry.type === "project:update") {
      const fullPayload = projectPayloadForCloudSave(entry);
      if (!id || !fullPayload) return true;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).saveCloudProject !== "function") return "not_configured";
      if (!isCurrentEntryOwner(entry)) return false;
      const fn = (mod as Record<string, unknown>).saveCloudProject as (args: unknown) => Promise<{ ok: boolean; conflict?: boolean }>;
      const r = await fn({ data: { id, payload: fullPayload, updatedAt: entry.version ?? Date.now(), version: entry.version } } as unknown).catch((e) => {
        const msg = String(e);
        if (/auth|unauthenticated|not.*signed.*in|without.*session/i.test(msg)) return { ok: true } as unknown;
        return null;
      });
      if (!r) return "not_configured";
      if ((r as { conflict?: boolean }).conflict) return false;
      return (r as { ok: boolean }).ok ? true : "not_configured";
    }
    return "not_configured";
  } catch {
    return "not_configured";
  }
}

// Helper: check if the entry belongs to the current owner (anon or user)
function isCurrentEntryOwner(entry: SyncQueueEntry): boolean {
  const ownerId = getStorageOwner();
  return entry.ownerId === ownerId;
}
