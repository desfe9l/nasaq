/**
 * History dedupe: a commit that changes NOTHING must not become an undo step.
 *
 * THE DEFECT THIS PINS
 * --------------------
 * `pushHistory` deduped against the previous snapshot by comparing page ARRAYS
 * by reference. Every commit rebuilds only the page objects it touched, so a
 * write that carried the values already in the document — re-applying a
 * property, a gesture that ended where it began, a second `commit()` after a
 * live edit — arrived as fresh objects and was recorded as a change.
 *
 * The author sees two symptoms: Undo appears to do nothing (it restores the
 * state that is already on screen), and a document nobody edited is marked
 * dirty and autosaved. Both are fixed at the dedupe itself, which is the one
 * place the "nothing changed" question is asked.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";
import type { CanvasEl } from "./model.ts";

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost/editor",
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
window.matchMedia = ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;
define("matchMedia", window.matchMedia);
define("requestAnimationFrame", (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0),
);
define("cancelAnimationFrame", (id: number) => clearTimeout(id));
define("navigator", {
  onLine: true,
  language: "ar-SA",
  userAgent: "history-dedupe-test",
});
define("fetch", async () => ({ ok: true }));
define(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { useEditor } = await import("./store.ts");
const { createProject } = await import("./templates.ts");
const { createElement, findElement } = await import("./model.ts");

const GROUP = (): CanvasEl => ({
  id: "group-1",
  type: "group",
  name: "مجموعة",
  x: 10,
  y: 10,
  w: 100,
  h: 80,
  rotation: 0,
  opacity: 1,
  z: 1,
  style: {},
  children: [
    {
      id: "child-1",
      type: "shape",
      name: "طفل",
      x: 5,
      y: 5,
      w: 40,
      h: 30,
      rotation: 0,
      opacity: 1,
      z: 1,
      style: { fill: "#123456" },
    },
  ],
});

const BOX = (): CanvasEl => ({
  id: "box-1",
  type: "shape",
  name: "مربع",
  x: 20,
  y: 30,
  w: 60,
  h: 40,
  rotation: 0,
  opacity: 1,
  z: 1,
  style: { fill: "#123456" },
});

/**
 * One page with the given elements plus ONE baseline history entry.
 *
 * The page carries its size explicitly, exactly as a saved document does: a
 * page created without `w`/`h` (the in-memory `createProject()` default, where
 * `pageSize()` substitutes A4) materialises them on the first write, and that
 * materialisation IS a document change — it must be recorded, not squeezed
 * through the dedupe.
 */
function seed(elements: CanvasEl[]) {
  const project = createProject("blank", "official", "السجل");
  const base = project.pages[0];
  const page = { ...base, w: base.w || 210, h: base.h || 297, elements };
  useEditor.setState({
    hydrate: async () => {},
    hydrated: true,
    id: "history-dedupe",
    name: project.name,
    pages: [page],
    activePageId: page.id,
    selectedId: null,
    selectedIds: [],
    enteredGroupId: null,
    past: [],
    future: [],
  });
  /* Every real session starts with one snapshot; `undo()` refuses below it. */
  useEditor.getState().commit();
  assert.equal(useEditor.getState().past.length, 1, "one baseline entry");
  return page.id;
}

const store = () => useEditor.getState();
const element = (id: string) =>
  findElement(store().pages[0].elements, id)?.el as CanvasEl;
const entries = () => store().past.length;

test("re-applying the same property pushes no history entry", () => {
  seed([BOX()]);
  const before = element("box-1");
  store().updateElement("box-1", { x: before.x, y: before.y, w: before.w });
  assert.equal(entries(), 1, "a no-op property write is not an undo step");
  assert.equal(element("box-1").x, before.x);
});

test("a no-op write keeps redo available", () => {
  seed([BOX()]);
  store().updateElement("box-1", { x: 55 });
  assert.equal(entries(), 2, "the real edit is one step");
  store().undo();
  assert.equal(store().future.length, 1, "redo is armed");
  /* A write that changes nothing must not wipe the redo stack. */
  store().updateElement("box-1", { x: element("box-1").x });
  assert.equal(store().future.length, 1, "redo survives a no-op write");
  store().redo();
  assert.equal(element("box-1").x, 55, "redo still lands the edit");
});

test("an identical applyElements commit pushes no history entry", () => {
  seed([BOX()]);
  const before = element("box-1");
  store().applyElements(store().pages[0].id, [
    { ...before, style: { ...before.style } },
  ]);
  assert.equal(entries(), 1, "a commit carrying identical geometry is not a step");
});

test("a real change still pushes exactly one entry, and undo restores it", () => {
  seed([BOX()]);
  const before = element("box-1");
  store().applyElements(store().pages[0].id, [{ ...before, x: 44.5 }]);
  assert.equal(entries(), 2, "one undo step");
  assert.equal(element("box-1").x, 44.5);
  store().undo();
  assert.equal(element("box-1").x, before.x, "undo returns the box");
  store().redo();
  assert.equal(element("box-1").x, 44.5, "redo re-applies it");
});

test("a style-only change is a real change", () => {
  seed([BOX()]);
  store().updateElement("box-1", { style: { fill: "#000000" } });
  assert.equal(entries(), 2, "changing only the fill is an undo step");
  assert.equal(element("box-1").style.fill, "#000000");
});

test("a change inside a group is noticed", () => {
  seed([GROUP()]);
  store().updateElement("child-1", { x: 12 });
  assert.equal(entries(), 2, "a nested child edit is an undo step");
  assert.equal(element("child-1").x, 12);
  /* …and repeating it verbatim is not. */
  store().updateElement("child-1", { x: 12 });
  assert.equal(entries(), 2, "repeating the nested write is not a second step");
});

test("committing twice in a row records one step", () => {
  seed([BOX()]);
  store().updateElement("box-1", { x: 70 });
  assert.equal(entries(), 2);
  store().commit();
  store().commit();
  assert.equal(entries(), 2, "a repeated commit is deduped");
});

test("history stays bounded and undo still walks back", () => {
  seed([BOX()]);
  for (let i = 1; i <= 5; i++) store().updateElement("box-1", { x: 20 + i });
  assert.equal(entries(), 6, "five edits, five steps (plus the baseline)");
  for (let i = 0; i < 5; i++) store().undo();
  assert.equal(element("box-1").x, 20, "undo walks all the way back");
});

test("the seeded element factory matches the model", () => {
  const created = createElement("shape", { id: "made-1", x: 3, y: 4, w: 5, h: 6 });
  assert.equal(created.id, "made-1");
  assert.equal(created.w, 5);
});
