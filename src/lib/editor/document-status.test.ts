import test from "node:test";
import assert from "node:assert/strict";
import { documentStatus, type DocumentStatusInput } from "./document-status";

/**
 * The document lifecycle contract.
 *
 * These are the rules the editor UI is built on, and every one of them is a
 * regression the studio actually showed:
 *
 *   · a loading state that outlived the document;
 *   · a loading state that came back for a save or a sync;
 *   · two states painted at once (a chip + a badge + a toast for one event);
 *   · offline reported as "loading" instead of "workable here".
 */

const READY: DocumentStatusInput = {
  phase: "ready",
  save: "saved",
  saveArmed: false,
  online: true,
  sync: "idle",
  pendingSync: false,
  lastSyncedAt: null,
  persisted: true,
};

const kind = (override: Partial<DocumentStatusInput>) =>
  documentStatus({ ...READY, ...override }).kind;

test("idle → loading → ready, and only the document owns the loading state", () => {
  assert.equal(kind({ phase: "idle" }), "opening");
  assert.equal(kind({ phase: "loading" }), "opening");
  assert.equal(kind({ phase: "ready" }), "ready");

  // Nothing else can reach the loading state — not a save, not a sync, not
  // the connection, not a queue that is still draining.
  for (const override of [
    { save: "saving" },
    { save: "dirty", saveArmed: true },
    { save: "error" },
    { sync: "syncing" },
    { sync: "error" },
    { pendingSync: true },
    { online: false },
  ] as Partial<DocumentStatusInput>[]) {
    const status = documentStatus({ ...READY, ...override });
    assert.notEqual(status.kind, "opening", JSON.stringify(override));
    /* Only work that is really running may animate. */
    assert.equal(
      status.busy,
      status.kind === "pending-save" || status.kind === "syncing",
      JSON.stringify(override),
    );
  }
});

test("ready → saving → saved is the autosave arc, and it never loads", () => {
  const saving = documentStatus(READY);
  assert.equal(saving.kind, "ready");
  assert.equal(saving.busy, false);
  assert.equal(saving.label, "جاهز");

  const armed = documentStatus({ ...READY, save: "dirty", saveArmed: true });
  assert.equal(armed.kind, "pending-save");
  assert.equal(armed.label, "جارٍ الحفظ…");
  assert.equal(armed.busy, true);

  const inFlight = documentStatus({ ...READY, save: "saving" });
  assert.equal(inFlight.kind, "pending-save");

  const done = documentStatus({ ...READY, save: "saved", lastSyncedAt: 1 });
  assert.equal(done.kind, "synced");
  assert.equal(done.label, "متزامن");
  assert.equal(done.busy, false);
});

test("a dirty document with no armed write says so instead of faking a save", () => {
  const held = documentStatus({ ...READY, save: "dirty", saveArmed: false });
  assert.equal(held.kind, "unsaved");
  assert.equal(held.label, "غير محفوظ");
  assert.equal(held.busy, false);
  // The old header showed «جاري الحفظ» here forever; it is not a save.
  assert.doesNotMatch(held.label, /جارٍ/);
});

test("ready → syncing → synced, and the sync result is a fact, not a timer", () => {
  const syncing = documentStatus({ ...READY, sync: "syncing", pendingSync: true });
  assert.equal(syncing.kind, "syncing");
  assert.equal(syncing.label, "جارٍ المزامنة…");
  assert.equal(syncing.busy, true);

  const local = documentStatus({ ...READY, pendingSync: true });
  assert.equal(local.kind, "local");
  assert.equal(local.label, "محفوظ محليًا");
  assert.equal(local.busy, false);

  const synced = documentStatus({ ...READY, lastSyncedAt: Date.now() });
  assert.equal(synced.kind, "synced");
  assert.equal(synced.busy, false);
});

test("offline is understandable: the local document is available, never loading", () => {
  const local = documentStatus({ ...READY, online: false });
  assert.equal(local.kind, "offline");
  assert.equal(local.label, "دون اتصال · متاح محليًا");
  assert.match(local.detail, /متاح للعمل دون اتصال/);
  assert.equal(local.busy, false);
  assert.equal(local.ready, true, "the canvas stays editable offline");
  assert.equal(local.degradedByOffline, true);

  const nothingLocal = documentStatus({ ...READY, online: false, persisted: false });
  assert.equal(nothingLocal.label, "دون اتصال");
  assert.match(nothingLocal.detail, /سيُحفظ عملك على هذا الجهاز/);

  // Offline while saving: the write still leads, with the offline glyph as the
  // cause — one primary state, one explanation.
  const savingOffline = documentStatus({
    ...READY,
    online: false,
    save: "saving",
  });
  assert.equal(savingOffline.kind, "pending-save");
  assert.equal(savingOffline.degradedByOffline, true);
});

test("failures are actionable, retryable and outrank work in progress", () => {
  const saveFailed = documentStatus({ ...READY, save: "error" });
  assert.equal(saveFailed.kind, "save-error");
  assert.equal(saveFailed.tone, "danger");
  assert.equal(saveFailed.retryable, true);
  assert.match(saveFailed.detail, /تحقق من مساحة تخزين/);

  const syncFailed = documentStatus({
    ...READY,
    sync: "error",
    pendingSync: true,
    lastSyncedAt: 10,
  });
  assert.equal(syncFailed.kind, "sync-error");
  assert.equal(syncFailed.retryable, true);
  assert.equal(syncFailed.persisted, true);
  assert.match(syncFailed.detail, /متاحة/);

  // Priority is total: exactly one of these can ever be painted.
  assert.equal(kind({ save: "error", sync: "error" }), "save-error");
  assert.equal(kind({ save: "error", sync: "syncing" }), "save-error");
  assert.equal(kind({ sync: "error", save: "saving" }), "sync-error");
  assert.equal(kind({ sync: "error", online: false }), "sync-error");
  assert.equal(kind({ sync: "syncing", pendingSync: true }), "syncing");
});

test("the phase is the only input that changes readiness", () => {
  const off = documentStatus({ ...READY, online: false, pendingSync: true });
  const failing = documentStatus({ ...READY, sync: "error" });
  const saving = documentStatus({ ...READY, save: "saving" });
  for (const status of [off, failing, saving])
    assert.equal(status.ready, true, status.kind);
  assert.equal(documentStatus({ ...READY, phase: "loading" }).ready, false);
});

test("labels are short enough for the header capsule and unique per state", () => {
  const labels = new Map<string, string>();
  for (const override of [
    { phase: "loading" },
    {},
    { save: "saving" },
    { save: "dirty" },
    { save: "error" },
    { sync: "syncing" },
    { sync: "error" },
    { pendingSync: true },
    { lastSyncedAt: 5 },
    { online: false },
  ] as Partial<DocumentStatusInput>[]) {
    const status = documentStatus({ ...READY, ...override });
    assert.ok(status.label.length <= 26, status.label);
    assert.ok(status.short.length <= 22, status.short);
    assert.ok(status.detail.length > 0);
    assert.equal(labels.get(status.kind) ?? status.label, status.label);
    labels.set(status.kind, status.label);
  }
});
