/**
 * Cloud → local pull: the MISSING half of synchronization.
 *
 * The queue pushes local edits to the `cloud_projects` mirror; this module
 * brings the mirror back DOWN, so a document edited in one session becomes
 * visible in every other authorized session (other tab, device, or the same
 * browser after a profile-cleared refresh). Nothing called `getCloudProjects`
 * before this existed, which is why synced edits never showed up elsewhere.
 *
 * SAFETY RULES (data-loss prevention, mirroring the push side):
 *   · signed-in owners only — an anonymous library is never merged with an
 *     account mirror;
 *   · a document with a PENDING local sync entry is skipped: the local copy is
 *     still being pushed and must not be overwritten by what is already on the
 *     way up;
 *   · the remote copy wins only when it is strictly NEWER (`updatedAt`) than
 *     the local one, and never replaces a local document that has no remote
 *     counterpart being compared (a remote list never deletes local rows — a
 *     delete is expressed through the queue's `project:delete` push);
 *   · every fetch is bounded, and any failure resolves to `{ changed: 0 }` —
 *     pulling must never break the library it is enriching.
 */
import { ANON_OWNER, getStorageOwner } from "@/lib/editor/storage-owner";

export interface PullResult {
  /** Documents written into the local library. */
  changed: number;
  /** True when the mirror was read at all (vs. skipped/failed). */
  synced: boolean;
}

const PULL_TIMEOUT_MS = 15_000;

type RemoteProject = {
  id: string;
  payload: Record<string, unknown>;
  version: number;
  updatedAt: string;
};

/** Ids with pending queue entries — their local copies are mid-flight up. */
async function pendingProjectIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const { listPendingQueue } = await import("./sync-queue");
    const pending = await listPendingQueue();
    for (const entry of pending) {
      const payload = entry.payload as Record<string, unknown> | null;
      const id = typeof payload?.id === "string" ? payload.id : null;
      if (id) ids.add(id);
    }
  } catch {
    /* queue unreadable — treat as empty; skipping nothing is the safe side */
  }
  return ids;
}

async function fetchRemoteProjects(signal: AbortSignal): Promise<RemoteProject[] | null> {
  try {
    const response = await fetch("/api/offline/getCloudProjects", {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "include",
      signal,
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      projects?: RemoteProject[];
    } | null;
    if (!body?.ok || !Array.isArray(body.projects)) return null;
    return body.projects;
  } catch {
    return null;
  }
}

/**
 * Merge the account mirror into the local library. Returns how many documents
 * were updated. Best-effort by contract — callers fire-and-forget.
 */
export async function pullCloudProjects(): Promise<PullResult> {
  const owner = getStorageOwner();
  if (owner === ANON_OWNER) return { changed: 0, synced: false };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { changed: 0, synced: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  let remote: RemoteProject[] | null = null;
  try {
    remote = await fetchRemoteProjects(controller.signal);
  } finally {
    clearTimeout(timer);
  }
  if (!remote) return { changed: 0, synced: false };
  if (getStorageOwner() !== owner) return { changed: 0, synced: false };

  const [
    { getProject, putLocalProject },
    pendingIds,
  ] = await Promise.all([
    import("@/lib/editor/storage"),
    pendingProjectIds(),
  ]);

  let changed = 0;
  for (const item of remote) {
    try {
      if (getStorageOwner() !== owner) break;
      const id = String(item?.id ?? "");
      const payload = item?.payload;
      if (!id || !payload || typeof payload !== "object") continue;
      if (pendingIds.has(id)) continue; // local copy still being pushed up

      const remoteUpdatedAt =
        typeof (payload as { updatedAt?: unknown }).updatedAt === "number"
          ? (payload as { updatedAt: number }).updatedAt
          : Date.parse(item.updatedAt) || 0;

      const local = await getProject(id);
      if (local) {
        const localUpdatedAt = Number((local as { updatedAt?: unknown }).updatedAt ?? 0) || 0;
        if (remoteUpdatedAt <= localUpdatedAt) continue; // local is as fresh (or fresher)
      }

      // Land the remote document with its OWN timestamps (putLocalProject
      // never re-stamps), so the push/pull comparison stays stable.
      const merged = {
        ...payload,
        id,
        updatedAt: remoteUpdatedAt || Date.now(),
        createdAt:
          typeof (payload as { createdAt?: unknown }).createdAt === "number"
            ? (payload as { createdAt: number }).createdAt
            : Date.now(),
      };
      const written = await putLocalProject(merged as never);
      if (written) changed += 1;
    } catch {
      /* one corrupt remote row must not stop the rest of the merge */
    }
  }

  return { changed, synced: true };
}
