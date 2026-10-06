import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";

/**
 * The editor's DOCUMENT LIFECYCLE, driven through the real store.
 *
 * This is the regression suite for the states the studio actually got wrong:
 *
 *   · `hydrated`/loading staying on after the document was open;
 *   · a second `hydrate()` (the route + the studio both ask) restoring the
 *     library twice and re-opening the document;
 *   · a failed or refused open leaving «جارٍ فتح المستند…» behind;
 *   · autosave or the sync queue putting the editor back into a loading state;
 *   · re-opening the document that is already on screen (every reload) wiping
 *     the live edits and resetting the camera.
 */

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost/editor/doc-1",
  pretendToBeVisual: true,
});
const { window } = dom;

const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });

for (const key of [
  "document",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
] as const) {
  const value = (window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) define(key, value);
}
define("window", window);
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
define("matchMedia", window.matchMedia);
define("requestAnimationFrame", (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0),
);
define("cancelAnimationFrame", (id: number) => clearTimeout(id));
/* The connectivity probe is a browser fetch; here it always answers. */
define("navigator", { onLine: true, language: "ar-SA", userAgent: "lifecycle-test" });
define("fetch", async () => ({ ok: true }));
define("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

const { useEditor } = await import("./store.ts");
const { documentStatus } = await import("./document-status.ts");
const { buildNewDocument, defaultNewDocument } = await import("./new-document.ts");

const statusOf = () => {
  const s = useEditor.getState();
  return documentStatus({
    phase: s.documentPhase,
    save: s.saveState,
    saveArmed: s.saveArmed,
    online: true,
    sync: "idle",
    persisted: true,
  });
};

const settle = async () => {
  /* Two microtask turns: the store's own awaits, then the projections. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test("idle → loading → ready, and a second hydrate() never reloads", async () => {
  const store = useEditor.getState();
  assert.equal(store.documentPhase, "idle");
  assert.equal(store.hydrated, false);

  const first = store.hydrate();
  assert.equal(
    statusOf().kind,
    "opening",
    "the lifecycle is opening until a document is really in memory",
  );
  assert.notEqual(
    useEditor.getState().documentPhase,
    "ready",
    "no document is claimed before the read finished",
  );
  await first;

  const after = useEditor.getState();
  assert.equal(after.documentPhase, "ready", "the lifecycle must settle on ready");
  assert.equal(after.hydrated, true);
  assert.notEqual(statusOf().kind, "opening", "no loading is left on screen");

  /* The route and the studio both ask on mount: one run, one library restore. */
  const snap = after.past.length;
  await Promise.all([after.hydrate(), after.hydrate()]);
  const second = useEditor.getState();
  assert.equal(second.documentPhase, "ready");
  assert.equal(second.past.length, snap, "a joined hydrate must not touch history");

  /*
   * …and a LATER, sequential ask (a remount, a page that boots the editor
   * again) must not so much as blink the phase: re-entering `loading` on a
   * ready document is the "ready → loading → ready" loop itself.
   */
  await useEditor.getState().hydrate();
  assert.equal(
    useEditor.getState().documentPhase,
    "ready",
    "a redundant hydrate leaves the open document alone",
  );
  assert.equal(useEditor.getState().past.length, snap);
});

test("opening a document reaches ready, and a refused open never sticks on loading", async () => {
  /* One empty A4 page: inside the trial ceiling, so saving is permitted. */
  const document = buildNewDocument(
    defaultNewDocument({ name: "مستند دورة الحياة", pages: 1 }),
  );

  const created = await useEditor.getState().createDocument(document);
  assert.equal(created, true);
  const opened = useEditor.getState();
  assert.equal(opened.documentPhase, "ready");
  assert.equal(opened.documentOrigin, "open", "the studio put this document up");
  assert.equal(documentStatus({
    phase: opened.documentPhase,
    save: opened.saveState,
    online: true,
    sync: "idle",
  }).kind, "ready");

  /* A missing document: the toast is the author's feedback, and the phase is
   * exactly where it was — the old code could leave a loading flag behind. */
  const revision = opened.documentRevision;
  const missing = await useEditor.getState().openProject("does-not-exist");
  assert.equal(missing, false);
  const afterFailure = useEditor.getState();
  assert.equal(afterFailure.documentPhase, "ready", "no stuck loading after a refusal");
  assert.equal(afterFailure.id, opened.id, "the live document survives the refusal");
  assert.equal(afterFailure.documentRevision, revision, "nothing was replaced");
});

test("re-opening the document that is already open is free", async () => {
  const live = useEditor.getState();
  const before = {
    revision: live.documentRevision,
    past: live.past.length,
    id: live.id,
    name: live.name,
  };

  /* Mutate in memory, unsaved — a re-read from IndexedDB would discard it. */
  live.setName("عنوان غير محفوظ");
  assert.equal(await useEditor.getState().openProject(before.id!), true);

  const after = useEditor.getState();
  assert.equal(after.name, "عنوان غير محفوظ", "live edits survive a same-document open");
  assert.equal(after.documentRevision, before.revision, "no camera revolution");
  assert.equal(after.past.length, before.past, "no history reset");
  assert.equal(after.documentPhase, "ready");
});

test("autosave and the sync queue never re-enter the loading state", async () => {
  const live = useEditor.getState();
  live.setName("تعديل يُحفظ تلقائيًا");
  await settle();

  const dirty = useEditor.getState();
  assert.equal(dirty.documentPhase, "ready");
  const pending = documentStatus({
    phase: dirty.documentPhase,
    save: dirty.saveState,
    saveArmed: dirty.saveArmed,
    online: true,
    sync: "idle",
    persisted: true,
  });
  assert.ok(
    pending.kind === "pending-save" || pending.kind === "unsaved",
    `a normal edit reports a save state, not loading: ${pending.kind}`,
  );
  assert.notEqual(pending.kind, "opening");

  await useEditor.getState().saveNow();
  await settle();
  const saved = useEditor.getState();
  assert.equal(saved.saveState, "saved");
  assert.equal(saved.saveArmed, false, "nothing is left claiming a write");
  assert.equal(saved.documentPhase, "ready");

  /* The saved document is durable on this device: a fresh read finds it. */
  const { getProject } = await import("./storage.ts");
  const reloaded = await getProject(saved.id!);
  assert.ok(reloaded, "the save really reached IndexedDB");
  assert.equal(reloaded!.name, "تعديل يُحفظ تلقائيًا");
});

test("offline: the document is workable and never reported as loading", async () => {
  const live = useEditor.getState();
  const offline = documentStatus({
    phase: live.documentPhase,
    save: live.saveState,
    saveArmed: live.saveArmed,
    online: false,
    sync: "idle",
    persisted: true,
  });
  assert.equal(offline.kind, "offline");
  assert.equal(offline.label, "دون اتصال · متاح محليًا");
  assert.equal(offline.ready, true);
  assert.equal(offline.busy, false);

  /* Editing offline is still an edit, not a load. */
  live.setName("تعديل دون اتصال");
  await settle();
  const editing = useEditor.getState();
  assert.equal(editing.documentPhase, "ready");
  assert.notEqual(
    documentStatus({
      phase: editing.documentPhase,
      save: editing.saveState,
      saveArmed: editing.saveArmed,
      online: false,
      sync: "idle",
      persisted: true,
    }).kind,
    "opening",
  );

  await useEditor.getState().saveNow();
  await settle();
  assert.equal(useEditor.getState().saveState, "saved");
  assert.equal(useEditor.getState().documentPhase, "ready");
});

test("a store reset returns to idle, and hydrate brings the new owner to ready", async () => {
  useEditor.getState().resetUserScopedState();
  const reset = useEditor.getState();
  assert.equal(reset.documentPhase, "idle");
  assert.equal(reset.documentOrigin, "none");
  assert.equal(reset.saveArmed, false);

  await useEditor.getState().hydrate();
  const back = useEditor.getState();
  assert.equal(back.documentPhase, "ready");
  assert.equal(back.documentOrigin, "restore", "a boot restore is not a studio open");
});

/* Keeps the fresh-document imports used above honest. */
assert.ok(typeof buildNewDocument === "function");
assert.ok(typeof defaultNewDocument === "function");
