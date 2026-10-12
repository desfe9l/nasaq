/**
 * Page navigation on a long document — the store-side half of the artboard
 * virtualisation (see `ArtboardPage` in CanvasStage.tsx).
 *
 * The canvas only skips re-rendering pages whose `page` object is referentially
 * identical, and only mounts the pages near the viewport. That makes three
 * store behaviours load-bearing for performance:
 *
 *   1. Switching the active page must not touch the `pages` array or any page
 *      object (otherwise React reconciles all 30 artboards on every click).
 *   2. Editing one page must leave every other page's reference intact.
 *   3. Navigation is not a document change: no history entry, no dirty flag,
 *      and it stays O(1) however long the document is.
 *
 * The store is booted in a jsdom window exactly like history-dedupe.test.ts.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";
import type { CanvasEl, Page } from "./model.ts";

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
  userAgent: "page-navigation-test",
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

const PAGE_COUNT = 60;
const ELEMENTS_PER_PAGE = 40;

function longDocument(): Page[] {
  const project = createProject("blank", "official", "تقرير طويل");
  const base = project.pages[0];
  const pages: Page[] = [];
  for (let p = 0; p < PAGE_COUNT; p += 1) {
    const elements: CanvasEl[] = [];
    for (let i = 0; i < ELEMENTS_PER_PAGE; i += 1) {
      elements.push(
        createElement(i % 3 === 0 ? "text" : "shape", {
          id: `p${p}-el${i}`,
          x: 10 + (i % 8) * 20,
          y: 10 + Math.floor(i / 8) * 30,
          w: 18,
          h: 12,
        }),
      );
    }
    pages.push({
      ...base,
      id: `page-${p}`,
      name: `صفحة ${p + 1}`,
      w: base.w || 210,
      h: base.h || 297,
      elements,
    });
  }
  return pages;
}

function seed() {
  const pages = longDocument();
  useEditor.setState({
    hydrate: async () => {},
    hydrated: true,
    id: "page-navigation",
    name: "تقرير طويل",
    pages,
    activePageId: pages[0].id,
    selectedId: "p0-el1",
    selectedIds: ["p0-el1"],
    enteredGroupId: null,
    editingId: null,
    past: [],
    future: [],
  });
  useEditor.getState().commit();
  assert.equal(useEditor.getState().past.length, 1, "one baseline entry");
  return pages;
}

const store = () => useEditor.getState();

test("switching pages keeps every page object and the pages array referentially identical", () => {
  const pages = seed();
  const before = store().pages;
  store().setActivePage("page-37");
  const after = store().pages;
  assert.equal(after, before, "pages array untouched");
  for (let i = 0; i < pages.length; i += 1) {
    assert.equal(after[i], pages[i], `page ${i} reference intact`);
  }
  assert.equal(store().activePageId, "page-37");
});

test("switching pages clears the selection and edit state without a history entry", () => {
  seed();
  const past = store().past.length;
  const future = store().future.length;
  store().setActivePage("page-12");
  assert.equal(store().selectedId, null);
  assert.deepEqual(store().selectedIds, []);
  assert.equal(store().editingId, null);
  assert.equal(store().enteredGroupId, null);
  assert.equal(store().past.length, past, "navigation is not an undo step");
  assert.equal(store().future.length, future, "navigation does not clear redo");
});

test("navigating to the page already shown is a no-op (no state publish at all)", () => {
  seed();
  store().select("p0-el5");
  const snapshot = useEditor.getState();
  store().setActivePage("page-0");
  assert.equal(useEditor.getState(), snapshot, "no new state object");
  assert.equal(store().selectedId, "p0-el5", "selection on the same page survives");
});

test("editing one page leaves the other 59 page references untouched (memo contract)", () => {
  const pages = seed();
  store().setActivePage("page-20");
  store().updateElement("p20-el3", { x: 99 });
  const after = store().pages;
  assert.notEqual(after, pages, "a write produces a new pages array");
  for (let i = 0; i < pages.length; i += 1) {
    if (i === 20) {
      assert.notEqual(after[i], pages[i], "the edited page is a fresh object");
      assert.equal(findElement(after[i].elements, "p20-el3")?.el.x, 99);
    } else {
      assert.equal(after[i], pages[i], `page ${i} is the same reference`);
    }
  }
});

test("a page's own elements array is shared until that page is edited", () => {
  const pages = seed();
  store().setActivePage("page-5");
  store().setActivePage("page-6");
  store().setActivePage("page-5");
  for (let i = 0; i < pages.length; i += 1) {
    assert.equal(store().pages[i].elements, pages[i].elements, `elements of page ${i}`);
  }
});

test("navigation cost does not grow with document length", () => {
  seed();
  // Warm up the code path once.
  store().setActivePage("page-1");
  const HOPS = 2000;
  const t0 = performance.now();
  for (let i = 0; i < HOPS; i += 1) {
    store().setActivePage(`page-${(i * 7) % PAGE_COUNT}`);
  }
  const perHop = (performance.now() - t0) / HOPS;
  // Each hop is a constant-size `set` on the store; anything in the
  // milliseconds would mean the pages are being cloned or re-walked.
  assert.ok(perHop < 0.5, `${perHop.toFixed(3)}ms per page switch on ${PAGE_COUNT} pages`);
  assert.equal(store().pages.length, PAGE_COUNT);
});

test("undo after navigating restores the document, not the page the author was on", () => {
  seed();
  store().setActivePage("page-3");
  store().updateElement("p3-el0", { x: 55 });
  store().commit();
  store().setActivePage("page-40");
  store().undo();
  assert.equal(findElement(store().pages[3].elements, "p3-el0")?.el.x, 10 + 0, "edit undone");
  assert.ok(store().pages.some((p) => p.id === store().activePageId), "active page still exists");
});
