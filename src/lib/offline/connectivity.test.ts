import "fake-indexeddb/auto";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { ANON_OWNER, setStorageOwner } from "@/lib/editor/storage-owner";
import { createProject } from "@/lib/editor/templates";
import { saveProject } from "@/lib/editor/storage";
import { enqueueSync, listPendingQueue } from "./sync-queue";
import {
  disposeConnectivity,
  getConnectivity,
  initConnectivity,
  notifyPendingWork,
  refreshPending,
  requestSync,
  retrySync,
  subscribeConnectivity,
  whenSyncSettled,
  type ConnectivitySnapshot,
} from "./connectivity";

/**
 * The background sync engine's contract.
 *
 * The regression it locks down: the old engine emitted `syncing` → `synced` →
 * `online` on a timer and drained at boot with an empty queue, so a document
 * that was already open (and had nothing to send) still flashed «جاري المزامنة»
 * and «تمت المزامنة» — repeatedly, on every load and every reconnect.
 */

function setOnline(value: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: value },
    configurable: true,
    writable: true,
  });
  /* The engine only probes in a real browser; here the navigator flag rules. */
  delete (globalThis as { document?: unknown }).document;
}

function record(): { seen: ConnectivitySnapshot[]; stop: () => void } {
  const seen: ConnectivitySnapshot[] = [];
  const stop = subscribeConnectivity((snapshot) => seen.push({ ...snapshot }));
  return { seen, stop };
}

/* The engine owns a heartbeat interval; a test process must not wait for it. */
after(() => disposeConnectivity());

test("offline is reported as offline, and nothing is drained", async () => {
  disposeConnectivity();
  setOnline(false);
  setStorageOwner("sync-state-user");
  initConnectivity();
  await whenSyncSettled();

  const { seen, stop } = record();
  requestSync(0);
  await whenSyncSettled();

  assert.equal(getConnectivity().online, false);
  assert.equal(getConnectivity().sync, "idle");
  assert.ok(
    seen.every((s) => s.sync === "idle"),
    "no drain may be announced while offline",
  );
  stop();
  setStorageOwner(ANON_OWNER);
});

test("an empty queue never reports syncing — the phantom cycle is gone", async () => {
  disposeConnectivity();
  setOnline(true);
  setStorageOwner("sync-empty-user");
  initConnectivity();
  await refreshPending();
  await whenSyncSettled();

  const { seen, stop } = record();
  requestSync(0);
  retrySync();
  await whenSyncSettled();

  const offline = getConnectivity();
  assert.equal(offline.sync, "idle");
  assert.equal(offline.pending, false);
  assert.equal(offline.lastSyncedAt, null, "nothing was synced, so nothing claims it");
  assert.ok(
    seen.every((s) => s.sync === "idle"),
    `no syncing/synced cycle without work: ${JSON.stringify(seen)}`,
  );
  stop();
  setStorageOwner(ANON_OWNER);
});

test("queued work: offline keeps it pending, reconnecting drains it once", async () => {
  disposeConnectivity();
  setStorageOwner("sync-drain-user");
  setOnline(false);
  // Mock fetch to simulate a working cloud server that confirms every push.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as typeof fetch;
  initConnectivity();

  const project = await saveProject({
    ...createProject("official"),
    id: "sync-drain-1",
    name: "مستند المزامنة",
  });
  await enqueueSync("project:update", project, {
    dedupeKey: `project:update:${project.id}`,
    version: project.updatedAt,
  });
  assert.equal(await listPendingQueue("sync-drain-user").then((q) => q.length), 1);

  const { seen, stop } = record();
  await refreshPending();
  assert.equal(getConnectivity().pending, true, "the queue is the pending fact");

  /* Offline drain attempt: still queued, still no false «تمت المزامنة». */
  requestSync(0);
  await whenSyncSettled();
  assert.equal(getConnectivity().online, false);
  assert.equal(getConnectivity().pending, true);

  /* Back online: ONE drain, and the queue really empties. */
  setOnline(true);
  const offlineSeen = seen.length;
  requestSync(0);
  await whenSyncSettled();

  const after = getConnectivity();
  assert.equal(after.online, true);
  assert.equal(after.sync, "idle");
  assert.equal(after.pending, false, "the queue must drain");
  assert.ok(after.lastSyncedAt, "a completed drain is recorded");
  const transitions = seen.slice(offlineSeen).map((s) => s.sync);
  assert.ok(transitions.includes("syncing"), `expected a real syncing: ${transitions}`);
  assert.equal(
    transitions.filter((s) => s === "syncing").length,
    1,
    "one request, one drain",
  );
  assert.equal((await listPendingQueue("sync-drain-user")).length, 0);
  stop();
  globalThis.fetch = originalFetch;
  setStorageOwner(ANON_OWNER);
});

test("cloud endpoint failure: project:update stays queued and is never acknowledged", async () => {
  // Regression: the old code returned true for missing/failed cloud endpoint,
  // silently removing queue entries without server confirmation.
  // This test proves that when the server is unavailable or returns an error,
  // the project:update entry remains pending and is NOT removed from the queue.
  disposeConnectivity();
  setOnline(true);
  setStorageOwner("sync-fail-user");
  // Simulate a cloud endpoint that is unavailable (network error).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
  initConnectivity();
  await whenSyncSettled();

  const project = await saveProject({
    ...createProject("official"),
    id: "sync-fail-1",
    name: "مشروع فاشل",
  });
  await enqueueSync("project:update", project, {
    dedupeKey: `project:update:${project.id}`,
    version: project.updatedAt,
  });
  assert.equal(await listPendingQueue("sync-fail-user").then((q) => q.length), 1, "entry must be queued before sync");

  requestSync(0);
  await whenSyncSettled();

  // After a failed sync attempt, the entry must still be queued.
  // A missing server must NEVER be treated as successful persistence.
  const remaining = await listPendingQueue("sync-fail-user");
  assert.equal(remaining.length, 1, "cloud failure must leave entry queued — not acknowledged");
  // The deduplication logic promotes project:update → project:create for a new
  // document (no prior remote record), so the dedupeKey will be project:create:…
  assert.ok(
    remaining[0]!.dedupeKey.includes(project.id!),
    "the correct project's entry must remain queued",
  );

  // Also verify with a 500 server error.
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ error: "internal" }), { status: 500 }))) as typeof fetch;
  requestSync(0);
  await whenSyncSettled();
  const remainingAfter500 = await listPendingQueue("sync-fail-user");
  assert.equal(remainingAfter500.length, 1, "server 500 must leave entry queued — not acknowledged");

  // Also verify with ok:false (conflict or rejection from server).
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ ok: false, reason: "conflict" }), { status: 200 }))) as typeof fetch;
  requestSync(0);
  await whenSyncSettled();
  const remainingAfterConflict = await listPendingQueue("sync-fail-user");
  assert.equal(remainingAfterConflict.length, 1, "server ok:false must leave entry queued — not acknowledged");

  globalThis.fetch = originalFetch;
  setStorageOwner(ANON_OWNER);
});

test("enqueueing announces pending work without a second drain", async () => {
  disposeConnectivity();
  setOnline(true);
  setStorageOwner("sync-notify-user");
  // Mock fetch to simulate a working cloud server that confirms every push.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as typeof fetch;
  initConnectivity();
  await whenSyncSettled();

  const { seen, stop } = record();
  notifyPendingWork();
  assert.equal(getConnectivity().pending, true);

  const project = await saveProject({
    ...createProject("official"),
    id: "sync-notify-1",
    name: "إشعار",
  });
  await enqueueSync("project:update", project, { dedupeKey: "k" });
  await whenSyncSettled();
  await refreshPending();

  assert.equal(getConnectivity().pending, false);
  assert.equal(getConnectivity().sync, "idle");
  assert.ok(
    seen.filter((s) => s.pending).length > 0,
    "pending must be observable while work waits",
  );
  stop();
  globalThis.fetch = originalFetch;
  setStorageOwner(ANON_OWNER);
});
