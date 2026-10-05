/**
 * Placeholder cloud project sync. If a server endpoint exists, push there.
 * Gracefully degrades to "not_configured" when no cloud table is deployed,
 * so offline queue still drains locally and doesn't block the UX.
 */

import type { SyncQueueEntry } from "./sync-queue";

export async function pushCloudProject(entry: SyncQueueEntry): Promise<boolean | "not_configured"> {
  // Try to detect a real cloud endpoint via fetch. If 404, treat as not_configured.
  // Project payload is already durable locally; cloud is best-effort mirror.
  try {
    if (typeof fetch === "undefined") return "not_configured";
    const payload = entry.payload as Record<string, unknown> | null;
    // For now we don't have a cloud_projects API, so we report not_configured
    // This keeps local edits durable and queue drainable without a server.
    // When cloud_projects migration is added, implement POST /api/offline/projects
    void payload;
    return "not_configured";
  } catch {
    return "not_configured";
  }
}
