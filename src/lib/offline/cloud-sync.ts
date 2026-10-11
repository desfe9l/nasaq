/**
 * Real cloud project sync using the existing cloud_projects table.
 * Returns true if the push succeeded, false if there was a conflict or error,
 * and "not_configured" if the server endpoint is not available (e.g., missing
 * server function). This function mirrors the logic used by the sync queue.
 */

import type { SyncQueueEntry } from "./sync-queue";
import { getStorageOwner } from "@/lib/editor/storage-owner";
import { projectPayloadForCloudSave } from "./sync-queue";

export async function pushCloudProject(entry: SyncQueueEntry): Promise<boolean> {
  try {
    if (!isCurrentEntryOwner(entry)) return false;
    const payload = entry.payload as Record<string, unknown> | null;
    const id = typeof payload?.id === "string" ? (payload.id as string) : null;
    if (entry.type === "project:delete") {
      // A delete entry with no ID is malformed; keep it queued rather than
      // silently acknowledging so the caller can inspect the corrupt entry.
      if (!id) return false;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).deleteCloudProject !== "function") return false;
      if (!isCurrentEntryOwner(entry)) return false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`/api/offline/deleteCloudProject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { id } }),
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          // If the endpoint is not found (404) or any other error, return false
          return false;
        }
        const result = await response.json();
        return result.ok ? true : false;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // timeout
          return false;
        }
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (entry.type === "project:create" || entry.type === "project:update") {
      const fullPayload = projectPayloadForCloudSave(entry);
      // A create/update entry that lacks an id or full pages payload is
      // malformed. Return false so it stays queued and the data-loss risk
      // (acknowledging without actually persisting) is avoided.
      if (!id || !fullPayload) return false;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).saveCloudProject !== "function") return false;
      if (!isCurrentEntryOwner(entry)) return false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`/api/offline/saveCloudProject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { id, payload: fullPayload, updatedAt: entry.version ?? Date.now(), version: entry.version } }),
          credentials: 'include',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          // If the endpoint is not found (404) or any other error, return false
          return false;
        }
        const result = await response.json();
        return result.ok ? true : false;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // timeout
          return false;
        }
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Helper: check if the entry belongs to the current owner (anon or user)
function isCurrentEntryOwner(entry: SyncQueueEntry): boolean {
  const ownerId = getStorageOwner();
  return entry.ownerId === ownerId;
}
