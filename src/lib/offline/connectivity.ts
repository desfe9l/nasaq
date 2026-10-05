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

function emit(status: SyncStatus) {
  currentStatus = status;
  for (const fn of listeners) {
    try { fn(status, online); } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nasaq:offline-status", { detail: { status, online } }));
  }
}

/** Probe real connectivity beyond navigator.onLine (captive portal etc) */
async function probeOnline(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    // Use a cache-busted tiny fetch to same origin — succeeds when actually online
    const res = await fetch(`/api/app-version?probe=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    // Any response (even 404) means network is up
    return Boolean(res);
  } catch {
    return false;
  }
}

function scheduleSync(delay = 1200) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void drainQueue();
  }, delay);
}

async function drainQueue() {
  const wasOnline = online;
  online = await probeOnline();
  if (!online) {
    emit("offline");
    return;
  }
  if (!wasOnline && online) {
    // just came back online
  }
  emit("syncing");
  try {
    const { processSyncQueue, hasPendingSync } = await import("./sync-queue");
    const result = await processSyncQueue();
    lastSyncAt = Date.now();
    const stillPending = await hasPendingSync();
    if (stillPending && result.conflicts > 0) {
      emit("error");
    } else if (stillPending && result.failed > 0) {
      // will retry on next heartbeat
      emit("online");
      scheduleSync(5000);
    } else if (stillPending) {
      emit("online");
      scheduleSync(3000);
    } else {
      emit("synced");
      // stay synced for a moment then go to online
      setTimeout(() => {
        if (currentStatus === "synced") emit("online");
      }, 2500);
    }
  } catch {
    emit("error");
  }
}

function onOnline() {
  online = true;
  emit("online");
  void probeOnline().then((ok) => {
    online = ok;
    if (ok) scheduleSync(800);
    else emit("offline");
  });
}

function onOffline() {
  online = false;
  emit("offline");
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
    void probeOnline().then((ok) => {
      if (ok !== online) {
        online = ok;
        emit(ok ? "online" : "offline");
        if (ok) scheduleSync(600);
      }
    });
  }, 30_000);
  // Initial probe
  void probeOnline().then((ok) => {
    online = ok;
    emit(ok ? (currentStatus === "syncing" ? "syncing" : "online") : "offline");
    if (ok) scheduleSync(1500);
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
