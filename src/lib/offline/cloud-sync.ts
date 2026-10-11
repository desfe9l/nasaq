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
      const response = await fetch(`/api/offline/deleteCloudProject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { id } }),
        credentials: 'include', // important to send cookies for auth
      });
      if (!response.ok) {
        // If the endpoint is not found (404), treat as not_configured
        if (response.status === 404) return "not_configured";
        // For any other error (including auth errors, db errors, etc.), return false
        return false;
      }
      const result = await response.json();
      return result.ok ? true : false;
    }
    if (entry.type === "project:create" || entry.type === "project:update") {
      const fullPayload = projectPayloadForCloudSave(entry);
      if (!id || !fullPayload) return true;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).saveCloudProject !== "function") return "not_configured";
      if (!isCurrentEntryOwner(entry)) return false;
      const response = await fetch(`/api/offline/saveCloudProject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { id, payload: fullPayload, updatedAt: entry.version ?? Date.now(), version: entry.version } }),
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 404) return "not_configured";
        return false;
      }
      const result = await response.json();
      return result.ok ? true : false;
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
