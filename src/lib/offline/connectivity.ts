/**
 * Connectivity + background sync engine.
 *
 * The previous version reported a *narrative* instead of a state: it emitted
 * `syncing` → `synced` → (2.5 s later) `online` on a timer, and it drained at
 * boot even with an empty queue. So a document that had nothing to sync still
 * flashed «جاري المزامنة»/«تمت المزامنة» on every load, and again on every
 * reconnect heartbeat — the repeated, meaningless loading-looking cycles the
 * editor showed after a document was already open.
 *
 * This module now publishes facts only:
 *
 *   · `online`   — the network is usable (navigator + one real probe);
 *   · `sync`     — `idle` | `syncing` | `error`. `syncing` is emitted only
 *                  while a drain with real pending work is running, and the
 *                  result is kept as a fact (`lastSyncedAt`) instead of being
 *                  reverted by a timer;
 *   · `pending`  — the local queue holds this owner's operations, which is what
 *                  lets the UI say «محفوظ محليًا» instead of «متزامن»;
 *   · `error`    — the last failure, so the status chip can offer a retry.
 *
 * Nothing here can move the document phase: opening a document is the store's
 * business (see `src/lib/editor/document-status.ts`).
 */

export type SyncState = "idle" | "syncing" | "error";

export interface ConnectivitySnapshot {
  online: boolean;
  sync: SyncState;
  /** The local sync queue holds operations for the current owner. */
  pending: boolean;
  /** Set once a drain actually completed successfully. */
  lastSyncedAt: number | null;
  /** Last failure message (tooltip only — never a duplicate banner). */
  error: string | null;
}

type Listener = (snapshot: ConnectivitySnapshot) => void;

/** Bounded retry backoff for transient failures (never a hot loop). */
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 30_000;
/** Rows a burst of autosaves into ONE drain instead of one per save. */
const COALESCE_MS = 2_000;
/** Reconnection heartbeat: catches a captive portal that lies to us. */
const HEARTBEAT_MS = 30_000;

const listeners = new Set<Listener>();

/**
 * Long-lived timers must not hold a process open (unit tests, SSR bundles):
 * `unref` exists on Node's Timeout and is absent in the browser.
 */
function keepAliveOnlyInBrowser(timer: unknown): void {
  (timer as { unref?: () => void })?.unref?.();
}

let snapshot: ConnectivitySnapshot = {
  online:
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  sync: "idle",
  pending: false,
  lastSyncedAt: null,
  error: null,
};

let listenersInstalled = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let retryAttempt = 0;
let inFlightDrain: Promise<void> | null = null;

export const SYNC_ENQUEUED_EVENT = "nasaq:sync-enqueued";

/** Current facts. Cheap enough to read during render. */
export function getConnectivity(): ConnectivitySnapshot {
  return snapshot;
}

/** Subscribe to connectivity + sync facts. Emits the current value immediately. */
export function subscribeConnectivity(fn: Listener): () => void {
  listeners.add(fn);
  try {
    fn(snapshot);
  } catch {
    /* a broken subscriber must not break the engine */
  }
  return () => {
    listeners.delete(fn);
  };
}

function publish(patch: Partial<ConnectivitySnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (
    next.online === snapshot.online &&
    next.sync === snapshot.sync &&
    next.pending === snapshot.pending &&
    next.lastSyncedAt === snapshot.lastSyncedAt &&
    next.error === snapshot.error
  )
    return;
  snapshot = next;
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* one bad listener must not stop the others */
    }
  }
}

/* ── network probing ─────────────────────────────────────────────────────── */

function browserFetchAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof fetch === "function" &&
    typeof document !== "undefined"
  );
}

/**
 * Real connectivity, not just `navigator.onLine` (captive portals report
 * online while nothing resolves). Outside the browser — unit tests, SSR — the
 * navigator flag is the only truth we have, and no request is attempted.
 */
async function probeOnline(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (!browserFetchAvailable()) return true;
  try {
    const res = await fetch(`/api/app-version?probe=${Date.now()}`, {
      method: "GET",
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    return Boolean(res);
  } catch {
    return false;
  }
}

/* ── queue inspection ───────────────────────────────────────────────────── */

async function pendingCount(): Promise<number> {
  try {
    const { peekQueueSize } = await import("./sync-queue");
    return await peekQueueSize();
  } catch {
    return 0;
  }
}

/** Refresh the `pending` fact from the durable queue (used at boot). */
export async function refreshPending(): Promise<boolean> {
  const size = await pendingCount();
  const pending = size > 0;
  publish({ pending });
  return pending;
}

/**
 * Called (through `nasaq:sync-enqueued`) whenever a mutation is queued: the
 * document now has work waiting, so the status may honestly say
 * «محفوظ محليًا» until the drain finishes.
 */
export function notifyPendingWork(): void {
  publish({ pending: true });
  requestSync();
}

/* ── draining ───────────────────────────────────────────────────────────── */

function clearSyncTimer(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

/**
 * Ask for a background drain. Coalesced (a burst of autosaves becomes one
 * drain) and a no-op while offline or with an empty queue — which is what
 * removes the phantom «جاري المزامنة» cycle on every page load.
 */
export function requestSync(delay = COALESCE_MS): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    publish({ online: false });
    return;
  }
  if (syncTimer) return; // a drain is already scheduled; coalesce into it
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void drain();
  }, delay);
  keepAliveOnlyInBrowser(syncTimer);
}

/** Manual retry from the status chip: skip the coalescing window. */
export function retrySync(): void {
  retryAttempt = 0;
  clearSyncTimer();
  publish({ error: null });
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void drain();
  }, 0);
  keepAliveOnlyInBrowser(syncTimer);
}

/**
 * Run whatever is scheduled and resolve when the engine is quiet: a leave-flush
 * and the lifecycle tests both need "no work is waiting any more" to be a fact
 * rather than a guess.
 */
export async function whenSyncSettled(): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    if (syncTimer) {
      clearSyncTimer();
      void drain();
    }
    if (!inFlightDrain) return;
    await inFlightDrain;
  }
}

async function drain(): Promise<void> {
  if (inFlightDrain) return inFlightDrain;
  const run = (async () => {
    const online = await probeOnline();
    if (!online) {
      publish({ online: false, sync: "idle" });
      return;
    }
    publish({ online: true });

    const size = await pendingCount();
    if (size === 0) {
      // Nothing to send: stay idle. No «syncing» blip, no fake «synced».
      publish({ pending: false, sync: "idle", error: null });
      return;
    }

    publish({ pending: true, sync: "syncing", error: null });
    try {
      const { processSyncQueue } = await import("./sync-queue");
      const result = await processSyncQueue();
      const stillPending = (await pendingCount()) > 0;
      if (result.conflicts > 0 || result.failed > 0) {
        retryAttempt += 1;
        publish({
          pending: stillPending,
          sync: "error",
          error:
            result.conflicts > 0
              ? "نسخة أحد العناصر أحدث على الخدمة؛ لم يُستبدل شيء"
              : "تعذر إرسال بعض التغييرات",
        });
        scheduleRetry();
        return;
      }
      retryAttempt = 0;
      publish({
        pending: stillPending,
        sync: "idle",
        lastSyncedAt: Date.now(),
        error: null,
      });
      // Work that arrived while we were draining: one more pass, coalesced.
      if (stillPending) requestSync(COALESCE_MS);
    } catch {
      retryAttempt += 1;
      publish({ sync: "error", error: "تعذر إكمال المزامنة" });
      scheduleRetry();
    }
  })();
  inFlightDrain = run;
  try {
    await run;
  } finally {
    if (inFlightDrain === run) inFlightDrain = null;
  }
}

function scheduleRetry(): void {
  if (syncTimer) return;
  const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.min(retryAttempt, 4));
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void drain();
  }, delay);
  keepAliveOnlyInBrowser(syncTimer);
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

function onOnline(): void {
  publish({ online: true });
  void probeOnline().then((ok) => {
    publish({ online: ok });
    if (ok) requestSync(1_000);
  });
}

function onOffline(): void {
  clearSyncTimer();
  publish({ online: false, sync: "idle" });
}

function onEnqueued(): void {
  notifyPendingWork();
}

function onVisible(): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  void refreshPending().then((pending) => {
    if (pending) requestSync();
  });
}

/**
 * Start monitoring — called once after the editor's document is on screen, so
 * a slow network can never delay it. Idempotent.
 */
export function initConnectivity(): void {
  if (listenersInstalled) return;
  if (typeof window === "undefined") return;
  listenersInstalled = true;

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener(SYNC_ENQUEUED_EVENT, onEnqueued);
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisible);

  // Heartbeat: only a *change* is published, and only real work drains.
  heartbeatTimer = setInterval(() => {
    void probeOnline().then((ok) => {
      if (ok === snapshot.online) return;
      publish({ online: ok });
      if (ok) requestSync(600);
    });
  }, HEARTBEAT_MS);
  keepAliveOnlyInBrowser(heartbeatTimer);

  // Boot: one probe (so a captive portal is not believed) and one queue read.
  // No drain unless something is actually waiting.
  void probeOnline().then(async (ok) => {
    publish({ online: ok });
    if (!ok) return;
    const size = await pendingCount();
    publish({ pending: size > 0 });
    if (size > 0) requestSync(1_500);
  });
}

/** Stops the timers (tests / teardown). */
export function disposeConnectivity(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  clearSyncTimer();
  if (typeof window !== "undefined") {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener(SYNC_ENQUEUED_EVENT, onEnqueued);
  }
  if (typeof document !== "undefined")
    document.removeEventListener("visibilitychange", onVisible);
  listenersInstalled = false;
  listeners.clear();
  snapshot = {
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    sync: "idle",
    pending: false,
    lastSyncedAt: null,
    error: null,
  };
  inFlightDrain = null;
  retryAttempt = 0;
}
