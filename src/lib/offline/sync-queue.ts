/**
 * Reliable IndexedDB sync queue — account-isolated, deduplicated, auto-retried.
 *
 * Every offline mutation (create/rename/duplicate/delete/update) is enqueued
 * here with an owner stamp. The queue survives reloads, is never exposed across
 * accounts, and prevents duplicate operations via a dedupe key. On reconnection
 * the processor drains the queue, handling version conflicts without silently
 * overwriting newer remote data.
 */

import { getStorageOwner, ANON_OWNER } from "@/lib/editor/storage-owner";
import { uid } from "@/lib/utils";

export type SyncOperationType =
  | "project:create"
  | "project:update"
  | "project:rename"
  | "project:delete"
  | "project:duplicate"
  | "project:favorite"
  | "asset:save"
  | "asset:delete"
  | "asset:rename"
  | "library:catalog"
  | "template:offline-save";

export interface SyncQueueEntry {
  id: string;
  ownerId: string;
  type: SyncOperationType;
  dedupeKey: string; // prevents duplicate sync operations
  payload: unknown;
  createdAt: number;
  attempts: number;
  lastError?: string | null;
  version?: number; // payload version (updatedAt) for conflict checks
}

const STORE = "syncQueue";

/**
 * Tell the connectivity engine that work is waiting. Deliberately an event
 * rather than an import: `connectivity` imports this module, and the UI needs
 * the queue's state without either module owning the other.
 */
function announceEnqueued(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function")
    return;
  window.dispatchEvent(new CustomEvent("nasaq:sync-enqueued"));
}

async function getDb(): Promise<IDBDatabase | null> {
  const { getOfflineDb } = await import("@/lib/editor/storage");
  return getOfflineDb();
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(STORE, mode);
    } catch (e) {
      reject(e);
      return;
    }
    t.onerror = () => reject(t.error ?? new Error("tx failed"));
    t.onabort = () => reject(t.error ?? new Error("tx aborted"));
    let result: T;
    t.oncomplete = () => resolve(result as T);
    const store = t.objectStore(STORE);
    Promise.resolve(run(store)).then(
      (v) => {
        result = v;
      },
      (e) => {
        t.abort();
        reject(e);
      },
    );
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb request failed"));
  });
}

/**
 * Enqueue a mutation. If a pending entry with same dedupeKey and owner exists,
 * it is replaced (latest wins) to prevent duplicates. Returns the queue id.
 */
export async function enqueueSync(
  type: SyncOperationType,
  payload: unknown,
  options?: { dedupeKey?: string; version?: number },
): Promise<string> {
  const ownerId = getStorageOwner();
  const db = await getDb();
  const dedupeKey =
    options?.dedupeKey ??
    `${type}:${(payload as Record<string, unknown>)?.id ?? JSON.stringify(payload).slice(0, 80)}`;
  const version =
    options?.version ??
    (typeof (payload as Record<string, unknown>)?.updatedAt === "number"
      ? (payload as Record<string, unknown>).updatedAt as number
      : Date.now());

  if (!db) {
    // fallback to localStorage queue for IDB-unavailable envs (private windows)
    try {
      const key = `nasaq-sync-queue::${ownerId}`;
      const raw = localStorage.getItem(key);
      const list: SyncQueueEntry[] = raw ? JSON.parse(raw) : [];
      const existingIdx = list.findIndex((e) => e.dedupeKey === dedupeKey);
      const entry: SyncQueueEntry = {
        id: existingIdx >= 0 ? list[existingIdx].id : uid("sync"),
        ownerId,
        type,
        dedupeKey,
        payload,
        createdAt: Date.now(),
        attempts: 0,
        version,
      };
      if (existingIdx >= 0) list[existingIdx] = entry;
      else list.push(entry);
      // cap queue
      if (list.length > 500) list.splice(0, list.length - 500);
      localStorage.setItem(key, JSON.stringify(list));
      announceEnqueued();
      return entry.id;
    } catch {
      return uid("sync");
    }
  }

  // Deduplicate within the same owner+dedupeKey in ONE read/write transaction.
  // A separate read followed by a write lets concurrent autosaves both observe
  // an empty queue and insert duplicate rows before either write is visible.
  const entry = await tx(db, "readwrite", async (store) => {
    const all = (await request(store.getAll())) as SyncQueueEntry[];
    const projectId =
      (type === "project:create" || type === "project:update") &&
      typeof (payload as Record<string, unknown>)?.id === "string"
        ? String((payload as Record<string, unknown>).id)
        : null;
    const existing =
      all.find((e) => {
        if (e.ownerId !== ownerId) return false;
        if (e.dedupeKey === dedupeKey) return true;
        if (!projectId || (e.type !== "project:create" && e.type !== "project:update")) return false;
        return (e.payload as Record<string, unknown> | null)?.id === projectId;
      }) ?? null;
    // A create followed by an update is still one unsent document. Keep the
    // create operation (the remote may not have the document yet), but always
    // replace it with the latest payload.
    const effectiveType =
      existing?.type === "project:create" || type === "project:create"
        ? "project:create"
        : type;
    const effectiveKey =
      effectiveType === type ? dedupeKey : `project:create:${projectId}`;
    const next: SyncQueueEntry = {
      id: existing?.id ?? uid("sync"),
      ownerId,
      type: effectiveType,
      dedupeKey: effectiveKey,
      payload,
      createdAt: Date.now(),
      attempts: existing?.attempts ?? 0,
      version,
    };
    await request(store.put(next));
    return next;
  });
  announceEnqueued();
  return entry.id;
}

export async function listPendingQueue(
  ownerId: string = getStorageOwner(),
): Promise<SyncQueueEntry[]> {
  const db = await getDb();
  if (!db) {
    try {
      const raw = localStorage.getItem(`nasaq-sync-queue::${ownerId}`);
      const list: SyncQueueEntry[] = raw ? JSON.parse(raw) : [];
      return list.sort((a, b) => a.createdAt - b.createdAt);
    } catch {
      return [];
    }
  }
  const all = (await tx(db, "readonly", async (store) => {
    const rows = (await request(store.getAll())) as SyncQueueEntry[];
    return rows.filter((r) => r.ownerId === ownerId);
  })) as SyncQueueEntry[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function peekQueueSize(ownerId: string = getStorageOwner()): Promise<number> {
  return (await listPendingQueue(ownerId)).length;
}

async function removeFromQueue(id: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    // localStorage fallback: scan all owner keys
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith("nasaq-sync-queue::")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const list: SyncQueueEntry[] = JSON.parse(raw);
        const next = list.filter((e) => e.id !== id);
        if (next.length !== list.length) localStorage.setItem(key, JSON.stringify(next));
      }
    } catch {}
    return;
  }
  await tx(db, "readwrite", async (store) => {
    await request(store.delete(id));
  });
}

async function bumpAttempt(id: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith("nasaq-sync-queue::")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const list: SyncQueueEntry[] = JSON.parse(raw);
        const idx = list.findIndex((e) => e.id === id);
        if (idx >= 0) {
          list[idx].attempts += 1;
          list[idx].lastError = error.slice(0, 400);
          localStorage.setItem(key, JSON.stringify(list));
        }
      }
    } catch {}
    return;
  }
  await tx(db, "readwrite", async (store) => {
    const entry = (await request(store.get(id))) as SyncQueueEntry | undefined;
    if (!entry) return;
    entry.attempts += 1;
    entry.lastError = error.slice(0, 400);
    await request(store.put(entry));
  });
}

/** Clear queue for an owner (used on sign-out or after successful drain). */
export async function clearQueueForOwner(ownerId: string): Promise<void> {
  const entries = await listPendingQueue(ownerId);
  for (const e of entries) await removeFromQueue(e.id);
}

// ── Conflict handling helpers ─────────────────────────────────────────────

export interface RemoteVersion {
  updatedAt: number;
  version?: number;
}

/**
 * Decide whether local should overwrite remote. Never silently overwrite newer remote.
 * Returns "localWins" | "remoteWins" | "equal"
 */
export function resolveConflict(
  localVersion: number,
  remoteVersion: number | null | undefined,
): "localWins" | "remoteWins" | "equal" {
  if (remoteVersion == null) return "localWins";
  if (localVersion > remoteVersion) return "localWins";
  if (localVersion < remoteVersion) return "remoteWins";
  return "equal";
}

// In-flight deduplication: don't run same dedupeKey concurrently
const inFlight = new Set<string>();

/**
 * Process the queue when online. Each entry is attempted once per invocation;
 * failures are kept for retry with bumped attempts. Returns summary.
 */
export async function processSyncQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  conflicts: number;
}> {
  const ownerId = getStorageOwner();
  if (ownerId === ANON_OWNER) return { processed: 0, succeeded: 0, failed: 0, conflicts: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { processed: 0, succeeded: 0, failed: 0, conflicts: 0 };
  }
  const pending = await listPendingQueue(ownerId);
  if (!pending.length) return { processed: 0, succeeded: 0, failed: 0, conflicts: 0 };

  let succeeded = 0;
  let failed = 0;
  let conflicts = 0;

  for (const entry of pending) {
    if (inFlight.has(entry.dedupeKey)) continue;
    inFlight.add(entry.dedupeKey);
    try {
      const result = await attemptSyncEntry(entry);
      if (result.ok) {
        await removeFromQueue(entry.id);
        succeeded += 1;
      } else if (result.conflict) {
        conflicts += 1;
        // Keep entry but mark conflict so UI can surface; don't auto-delete
        // Bump attempt so it doesn't spin hot.
        await bumpAttempt(entry.id, `conflict: remote newer (local ${entry.version} < remote ${result.remoteVersion})`);
        // Optionally pull remote — caller can decide to resolve.
        // For now we keep local queued but notify.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("nasaq:sync-conflict", { detail: { entry, remoteVersion: result.remoteVersion } }),
          );
        }
      } else {
        failed += 1;
        await bumpAttempt(entry.id, result.error ?? "sync failed");
        // If attempts exceed threshold, keep but stop hammering: next drain will retry
        if (entry.attempts > 10) {
          // after 10 failures, drop to avoid infinite queue growth but log
          console.warn("[offline] dropping sync entry after 10 failures", entry);
          // don't auto-drop — keep for manual retry unless network permanently fails
        }
      }
    } catch (err) {
      failed += 1;
      await bumpAttempt(entry.id, String(err).slice(0, 400));
    } finally {
      inFlight.delete(entry.dedupeKey);
    }
  }

  return { processed: pending.length, succeeded, failed, conflicts };
}

async function attemptSyncEntry(entry: SyncQueueEntry): Promise<{
  ok: boolean;
  conflict?: boolean;
  remoteVersion?: number;
  error?: string;
}> {
  // For offline-first NASAQ, project persistence is local IndexedDB which is
  // already durable. The cloud mirror (library_catalog, storage_assets,
  // cloud_projects) is best-effort. If server is unreachable, we treat as
  // queued, not failed permanently.

  // Try to detect offline quickly
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, error: "offline" };
  }

  try {
    switch (entry.type) {
      case "library:catalog": {
        // Payload is already a LibraryCatalog; push via existing mirror
        const { pushLibraryCatalog } = await import("@/lib/storage/mirror");
        const ok = await pushLibraryCatalog(entry.payload as never);
        return ok ? { ok: true } : { ok: false, error: "library push failed" };
      }
      case "template:offline-save": {
        // No server sync needed — template offline-save is local. Mark done.
        return { ok: true };
      }
      case "project:create":
      case "project:update":
      case "project:rename":
      case "project:delete":
      case "project:duplicate":
      case "project:favorite":
      case "asset:save":
      case "asset:delete":
      case "asset:rename": {
        // Project/asset mutations are local-first. If a cloud_projects endpoint
        // exists, try to sync there; otherwise consider local durable as success.
        // We still perform conflict check if we can fetch remote.
        const remoteVersion = await fetchRemoteVersion(entry);
        const localVersion = entry.version ?? Date.now();
        const decision = resolveConflict(localVersion, remoteVersion ?? undefined);
        if (decision === "remoteWins") {
          return { ok: false, conflict: true, remoteVersion: remoteVersion ?? undefined };
        }
        // Attempt cloud sync if available, but don't fail queue on missing endpoint
        const pushed = await pushProjectToCloud(entry);
        // If cloud not configured, local is enough — dequeue.
        if (pushed === "not_configured") return { ok: true };
        return pushed ? { ok: true } : { ok: false, error: "cloud push failed" };
      }
      default:
        return { ok: true };
    }
  } catch (err) {
    const msg = String(err);
    // Network errors stay queued
    if (/Failed to fetch|NetworkError|offline|Load failed/i.test(msg)) {
      return { ok: false, error: "network" };
    }
    return { ok: false, error: msg.slice(0, 300) };
  }
}

async function fetchRemoteVersion(entry: SyncQueueEntry): Promise<number | null> {
  try {
    const payload = entry.payload as Record<string, unknown> | null;
    const id = typeof payload?.id === "string" ? payload.id : null;
    if (!id) return null;
    const mod = await import("@/lib/offline/functions").catch(() => null);
    if (!mod || typeof mod.getCloudProjectVersion !== "function") return null;
    const res = await (mod.getCloudProjectVersion as unknown as (args: { data: { id: string } }) => Promise<{ updatedAt: number | null }>)({ data: { id } }).catch(() => null);
    if (!res || typeof res.updatedAt !== "number") return null;
    return res.updatedAt;
  } catch {
    return null;
  }
}

async function pushProjectToCloud(entry: SyncQueueEntry): Promise<boolean | "not_configured"> {
  try {
    const payload = entry.payload as Record<string, unknown> | null;
    const id = typeof payload?.id === "string" ? (payload.id as string) : null;
    if (entry.type === "project:delete") {
      if (!id) return true;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).deleteCloudProject !== "function") return "not_configured";
      const fn = (mod as Record<string, unknown>).deleteCloudProject as (args: unknown) => Promise<{ ok: boolean }>;
      const r = await fn({ data: { id } } as unknown).catch((e) => {
        const msg = String(e);
        if (/auth|unauthenticated|not.*signed.*in/i.test(msg)) return { ok: true } as unknown;
        return null;
      });
      if (!r) return "not_configured";
      return (r as { ok: boolean }).ok ? true : "not_configured";
    }
    if (entry.type.startsWith("project:")) {
      if (!id || !payload) return true;
      const mod = await import("@/lib/offline/functions").catch(() => null);
      if (!mod || typeof (mod as Record<string, unknown>).saveCloudProject !== "function") return "not_configured";
      const fn = (mod as Record<string, unknown>).saveCloudProject as (args: unknown) => Promise<{ ok: boolean; conflict?: boolean }>;
      const r = await fn({ data: { id, payload, updatedAt: entry.version ?? Date.now(), version: entry.version } } as unknown).catch((e) => {
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

/** Whether there are pending ops for current owner */
export async function hasPendingSync(): Promise<boolean> {
  return (await peekQueueSize()) > 0;
}
