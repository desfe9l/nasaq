/**
 * Connectivity + auto-sync on reconnection.
 * Shows compact Offline/Syncing/Synced status and drains the sync queue.
 */

export type SyncStatus = "offline" | "online" | "syncing" | "synced" | "error";

type Listener = (status: SyncStatus, online: boolean) => void;

const listeners = new Set<Listener>();
let currentStatus: SyncStatus = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
let online = typeof navigator !== "undefined" ? navigator.onLine : true;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncAt: number | null = null;

/** Subscribe to connectivity + sync status */
export function subscribeConnectivity(fn: Listener): () => void {
  listeners.add(fn);
  // immediate emit
  try { fn(currentStatus, online); } catch {}
  return () => listeners.delete(fn);
}

function emit(status: SyncStatus, nextOnline = online) {
  if (status === currentStatus && nextOnline === online) return;
  online = nextOnline;
  currentStatus = status;
  for (const fn of listeners) {
    try { fn(status, online); } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nasaq:offline-status", { detail: { status, online } }));
  }
}

/** Probe real connectivity beyond navigator.onLine (captive portal etc). */
async function probeOnline(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    // Any same-origin response (even 404) means the network is up.
    // The abort keeps a dead socket from pinning the sync pass open.
    const res = await fetch(`/api/app-version?probe=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
      signal: controller.signal,
    });
    return Boolean(res);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let drainFlight: Promise<void> | null = null;

function scheduleSync(delay = 1200) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void drainQueue();
  }, delay);
}

/**
 * One sync pass. An empty queue never enters "syncing" — autosave and
 * reconnect used to flash a loading/sync badge even when nothing was queued.
 * Failure stays on "error" until a later pass actually succeeds.
 */
async function drainQueue() {
  if (drainFlight) return drainFlight;
  const job = drainQueueBody().finally(() => {
    if (drainFlight === job) drainFlight = null;
  });
  drainFlight = job;
  return job;
}

async function drainQueueBody() {
  const probed = await probeOnline();
  if (!probed) {
    emit("offline", false);
    return;
  }
  const { processSyncQueue, hasPendingSync } = await import("./sync-queue");
  const pending = await hasPendingSync();
  if (!pending) {
    emit(settledOnlineStatus(currentStatus), true);
    return;
  }
  emit("syncing", true);
  try {
    const result = await processSyncQueue();
    const stillPending = await hasPendingSync();
    lastSyncAt = Date.now();
    if (!stillPending) {
      emit("synced", true);
      return;
    }
    if (result.conflicts > 0 || result.failed > 0) {
      emit("error", true);
      scheduleSync(8000);
      return;
    }
    scheduleSync(3000);
  } catch {
    emit("error", true);
    scheduleSync(8000);
  }
}

/** Online, with nothing left to push. Do not bounce synced → online → syncing. */
export function settledOnlineStatus(current: SyncStatus): SyncStatus {
  if (current === "syncing" || current === "error") return "synced";
  if (current === "synced") return "synced";
  return "online";
}

function onOnline() {
  online = true;
  emit("online", true);
  void probeOnline().then(async (ok) => {
    if (!ok) {
      emit("offline", false);
      return;
    }
    const { hasPendingSync } = await import("./sync-queue");
    if (await hasPendingSync()) scheduleSync(800);
  });
}

function onOffline() {
  emit("offline", false);
}

let initialized = false;

/** Start monitoring — call once at app boot (idempotent). */
export function initConnectivity(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined") return;
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // Periodic heartbeat to detect reconnection when events are unreliable
  heartbeatTimer = setInterval(() => {
    void probeOnline().then(async (ok) => {
      if (ok === online && (ok ? currentStatus !== "offline" : currentStatus === "offline")) return;
      if (!ok) {
        emit("offline", false);
        return;
      }
      emit(currentStatus === "offline" ? "online" : currentStatus, true);
      const { hasPendingSync } = await import("./sync-queue");
      if (await hasPendingSync()) scheduleSync(600);
    });
  }, 30_000);
  heartbeatTimer.unref?.();
  // Initial probe must not pretend a sync is running when the queue is empty.
  void probeOnline().then(async (ok) => {
    if (!ok) {
      emit("offline", false);
      return;
    }
    const { hasPendingSync } = await import("./sync-queue");
    if (await hasPendingSync()) scheduleSync(400);
    else emit(settledOnlineStatus(currentStatus), true);
  });

  // Re-sync when storage owner changes (account switch)
  try {
    const { subscribeStorageOwner } = require("@/lib/editor/storage-owner");
  } catch {}
}

export function getConnectivityStatus(): { status: SyncStatus; online: boolean; lastSyncAt: number | null } {
  return { status: currentStatus, online, lastSyncAt };
}

export function triggerSync(): void {
  scheduleSync(200);
}

/** Save phases the editor store already publishes. Kept local to avoid a store import cycle. */
export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Document open is a different machine from save and sync.
 * `loading` is only the first local open. It must not be reused for autosave.
 */
export type DocumentPhase = "idle" | "loading" | "ready";

export type EditorStatusCopy =
  | "جارٍ فتح المستند"
  | "محفوظ محليًا"
  | "تتم المزامنة"
  | "متزامن"
  | "متاح دون اتصال"
  | "تعذر التزامن"
  | "جارٍ الحفظ"
  | "تغييرات محلية"
  | "تعذر الحفظ";

/**
 * The one status the editor chrome shows. Loading is only document open.
 * Offline, local save, sync and sync failure never share a spinner.
 */
export function editorStatusLabel(
  save: SavePhase,
  sync: SyncStatus,
  isOnline: boolean,
  phase: DocumentPhase = "ready",
): EditorStatusCopy {
  if (phase === "loading") return "جارٍ فتح المستند";
  if (!isOnline || sync === "offline") return "متاح دون اتصال";
  if (sync === "error") return "تعذر التزامن";
  if (sync === "syncing") return "تتم المزامنة";
  if (save === "error") return "تعذر الحفظ";
  if (save === "saving") return "جارٍ الحفظ";
  if (save === "dirty") return "تغييرات محلية";
  if (sync === "synced") return "متزامن";
  return "محفوظ محليًا";
}
