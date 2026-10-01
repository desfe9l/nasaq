/**
 * Runtime smoke test for the six-window workspace — NO browser required.
 *
 * Loads the REAL store module through Vite (TS + aliases, exactly as the dev
 * server serves it) on top of a jsdom DOM, then exercises the window-system
 * state machine the UI renders:
 *
 *   1. The six windows (library / tools / elements / properties / layers /
 *      report) are INDEPENDENT — opening one never closes another, and all
 *      six can be open at the same time.
 *   2. closeFloatingPanels() dismisses all six.
 *   3. The pages-rail visibility state persists into the UI slot that
 *      hydrate() reads back (the hide/show toggle survives a reload).
 *   4. The pages rail is compact by default (96px) with an 84px floor.
 *
 * Run:  npm run test:editor:windows
 *       (node scripts/editor-windows-smoke.mjs)
 * Dev dependencies: jsdom, fake-indexeddb (installed by npm ci).
 */
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/* ── DOM + browser globals, before any app module loads ─────────────────── */
const dom = new JSDOM("<!doctype html><html dir=\"rtl\"><body></body></html>", {
  url: "http://localhost/editor",
  pretendToBeVisual: true,
});
const { window } = dom;

const define = (key, value) =>
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });

for (const key of [
  "document",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLCanvasElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "PointerEvent",
  "KeyboardEvent",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
]) {
  if (window[key] !== undefined) define(key, window[key]);
}
define("navigator", {
  userAgent: "Mozilla/5.0 (smoke-test)",
  language: "ar-SA",
  clipboard: { writeText: async () => {} },
  mediaDevices: undefined,
});
/* App code references bare `window` — mirror the browser global. */
define("window", window);

/* jsdom has no matchMedia — the editor branches on the 1100px overlay break. */
window.matchMedia = (query) => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const max = /max-width:\s*(\d+)px/.exec(query);
  const matches = min
    ? window.innerWidth >= Number(min[1])
    : max
      ? window.innerWidth <= Number(max[1])
      : false;
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
};
define("matchMedia", window.matchMedia);

class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = StubObserver;
window.IntersectionObserver = StubObserver;
define("ResizeObserver", StubObserver);
define("IntersectionObserver", StubObserver);

/* IndexedDB for the storage layer (hydrate is not exercised, but imports
 * must not blow up). */
import "fake-indexeddb/auto";

/* ── Load the real store through Vite ───────────────────────────────────── */
/* No project config: the editor vite.config boots the server DB, which is
 * irrelevant here (and its server-only guard dislikes a jsdom window). The
 * store's import graph only needs the `@/` alias + TS. */
const { createServer } = await import("vite");
const { resolve } = await import("node:path");
const vite = await createServer({
  configFile: false,
  root: resolve("."),
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
  resolve: { alias: { "@": resolve("./src") } },
});
try {
  const { useEditor, UI_KEY } = await vite.ssrLoadModule("/src/lib/editor/store.ts");
  const s = () => useEditor.getState();

  /* 1 ─ The six windows are independent. */
  s().setLeftTab("elements");
  assert.equal(s().leftOpen, true, "elements window opens");
  s().setLeftTab("library");
  assert.equal(s().libraryOpen, true, "library is its own window");
  assert.equal(s().leftOpen, true, "opening library never closes elements");
  s().setLeftTab("tools");
  assert.equal(s().toolsOpen, true, "element-tools is its own window");
  s().setRightTab("properties");
  assert.equal(s().rightOpen, true, "properties window opens");
  s().setRightTab("layers");
  assert.equal(s().layersOpen, true, "layers is its own window");
  assert.equal(
    s().rightOpen,
    true,
    "opening layers never closes properties (simultaneous display)",
  );
  s().toggle("reportToolsOpen");
  assert.equal(s().reportToolsOpen, true, "report-tools window opens");
  assert.ok(
    s().leftOpen &&
      s().rightOpen &&
      s().layersOpen &&
      s().reportToolsOpen &&
      s().libraryOpen &&
      s().toolsOpen,
    "all six windows are open at once",
  );

  /* 2 ─ One close-all covers all six. */
  s().closeFloatingPanels();
  assert.ok(
    !s().leftOpen &&
      !s().rightOpen &&
      !s().layersOpen &&
      !s().reportToolsOpen &&
      !s().libraryOpen &&
      !s().toolsOpen,
    "closeFloatingPanels dismisses all six windows",
  );

  /* 3 ─ Rail hide/show persists into the hydrated UI slot. */
  const uiSlot = () => JSON.parse(window.localStorage.getItem(UI_KEY) || "{}");
  assert.equal(uiSlot().pagesRailHidden, undefined, "rail shown by default");
  s().togglePagesRailHidden();
  assert.equal(s().pagesRailHidden, true, "rail hides");
  assert.equal(uiSlot().pagesRailHidden, true, "hidden state is persisted");
  s().togglePagesRailHidden();
  assert.equal(s().pagesRailHidden, false, "rail restores");
  assert.equal(uiSlot().pagesRailHidden, false, "restored state is persisted");

  /* 4 ─ Compact default + floor. */
  assert.equal(s().pagesPanelHeight, 96, "compact 96px rail by default");
  s().setPagesPanelHeight(30);
  assert.equal(s().pagesPanelHeight, 84, "84px floor holds");
  s().setPagesPanelHeight(96);

  console.log(
    "PASS(1): six independent windows (all-open, close-all), persisted rail hide/show, compact rail default + floor.",
  );

  /* ── 2 ─ Render-level: the real EditorApp tree, docked and undocked ────── */
  /* A CLIENT render (createRoot on jsdom), not SSR: zustand's server snapshot
   * is the store's INITIAL state, so an SSR pass would always see the
   * skeleton. Client render reads the live state and runs the effects. */
  /* jsdom's default 1024px width is below the 1100px overlay breakpoint,
   * which would disable docking — size the window like a real desktop. */
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });

  /* Canvas 2D: jsdom has none — hand the app a no-op context so paint effects
   * run instead of throwing. */
  const makeCtx = () => {
    const target = {};
    return new Proxy(target, {
      get(t, p) {
        if (p === "measureText")
          return () => ({ width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 2 });
        if (p === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (p === "createLinearGradient" || p === "createRadialGradient")
          return () => ({ addColorStop() {} });
        if (p in t) return t[p];
        t[p] = () => undefined;
        return t[p];
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    });
  };
  window.HTMLCanvasElement.prototype.getContext = () => makeCtx();
  /* Font loading: jsdom has no FontFaceSet — the store iterates it. */
  window.document.fonts = {
    ready: Promise.resolve(),
    check: () => true,
    load: () => Promise.resolve([]),
    add() {},
    remove() {},
    has: () => false,
    size: 0,
    forEach() {},
    [Symbol.iterator]() {
      return [][Symbol.iterator]();
    },
  };
  define("requestAnimationFrame", window.requestAnimationFrame.bind(window));
  define("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
  /* APIs jsdom does not implement (browsers all do). */
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.scrollTo = () => {};
  window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  window.HTMLElement.prototype.getAnimations = () => [];

  const { createProject } = await vite.ssrLoadModule("/src/lib/editor/templates.ts");
  const { default: React } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const editorAppModule = await vite.ssrLoadModule("/src/components/editor/EditorApp.tsx");

  const project = createProject("blank", "official", "اختبار");
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  let root = null;
  let host = null;
  const mount = (extra = {}) => {
    if (root) {
      root.unmount();
      host.remove();
    }
    useEditor.setState({
      /* EditorApp calls hydrate() on mount; the render test seeds the state
       * itself, so the real loader (IndexedDB + fonts + UI slot) is skipped. */
      hydrate: async () => {},
      hydrated: true,
      id: project.id ?? "smoke",
      name: project.name,
      pages: project.pages,
      activePageId: project.pages[0].id,
      leftOpen: true,
      rightOpen: true,
      layersOpen: true,
      libraryOpen: true,
      toolsOpen: true,
      reportToolsOpen: true,
      ...extra,
    });
    host = window.document.createElement("div");
    window.document.body.appendChild(host);
    root = createRoot(host);
    root.render(React.createElement(editorAppModule.EditorApp));
    return host;
  };
  /* jsdom has no layout engine, so the assertions read the GRID STYLES the
   * component computes — the inline grid areas are the source of truth that a
   * real browser turns into pixels. */

  /* Undocked: all six windows present, single canvas track. */
  mount();
  await settle();
  assert.equal(host.querySelectorAll(".editor-floating-panel").length, 6, "six windows in the DOM");
  for (const label of ["المكتبة", "أدوات العناصر", "لوحة العناصر", "الخصائص", "الطبقات", "أدوات التقرير"]) {
    assert.ok(
      host.querySelector(`.editor-floating-panel[aria-label="${label}"]`),
      `window "${label}" rendered`,
    );
  }
  const rowFree = host.querySelector(".editor-workspace-row");
  assert.ok(rowFree, "workspace row rendered");
  assert.equal(
    rowFree.style.gridTemplateColumns,
    "minmax(0, 1fr)",
    "undocked workspace is a single full-width canvas track",
  );
  assert.equal(host.querySelectorAll(".is-docked").length, 0, "nothing docked by default");
  const propsFree = host.querySelector('.editor-floating-panel[aria-label="الخصائص"]');
  assert.equal(propsFree.querySelectorAll(".floating-panel-resize").length, 8, "eight resize grips");
  assert.ok(propsFree.querySelector(".fp-dock-menu") === null, "dock menu closed by default");

  /* Dock the properties window to the RIGHT: the grid grows a 340px column
   * (column 1 — the physical right edge in this RTL grid) and the canvas
   * moves to column 2. */
  window.localStorage.setItem("nasaq.panel.docks.v2", JSON.stringify({ properties: "right" }));
  window.localStorage.setItem("nasaq.panel.dock-sizes.v2", JSON.stringify({ properties: { w: 340, h: 0 } }));
  mount();
  await settle();
  const rowDocked = host.querySelector(".editor-workspace-row");
  assert.equal(
    rowDocked.style.gridTemplateColumns,
    "340px minmax(0, 1fr)",
    "right dock reserves a 340px column before the canvas",
  );
  const dockedProps = host.querySelector('.editor-floating-panel[aria-label="الخصائص"]');
  assert.ok(
    dockedProps.classList.contains("is-docked") && dockedProps.classList.contains("is-docked-right"),
    "window carries the docked-right class",
  );
  assert.equal(dockedProps.getAttribute("data-dock-side"), "right", "dock side exposed");
  const dockCell = host.querySelector(".editor-dock-cell");
  assert.equal(dockCell.style.gridColumn, "1", "docked cell owns column 1 (physical right in RTL)");
  const center = host.querySelector(".editor-canvas-workspace");
  assert.equal(center.style.gridColumn, "2", "canvas moved to column 2");
  assert.equal(center.style.gridRow, "1", "canvas stays in the main row");

  /* A TOP docked window becomes a full-width 220px row track. */
  window.localStorage.setItem("nasaq.panel.docks.v2", JSON.stringify({ layers: "top" }));
  window.localStorage.setItem("nasaq.panel.dock-sizes.v2", JSON.stringify({ layers: { w: 0, h: 220 } }));
  mount();
  await settle();
  const rowTop = host.querySelector(".editor-workspace-row");
  assert.equal(
    rowTop.style.gridTemplateRows,
    "220px minmax(0, 1fr)",
    "top dock reserves a 220px row above the canvas",
  );
  const topLayers = host.querySelector('.editor-floating-panel[aria-label="الطبقات"]');
  assert.ok(topLayers.classList.contains("is-docked-top"), "layers window docked-top");
  assert.equal(topLayers.getAttribute("data-dock-side"), "top", "top dock side exposed");

  /* The pages rail hides completely when the store flag flips. */
  assert.ok(host.querySelector(".editor-page-rail"), "rail renders by default");
  useEditor.setState({ pagesRailHidden: true });
  root.render(React.createElement(editorAppModule.EditorApp));
  await settle();
  assert.equal(host.querySelector(".editor-page-rail"), null, "hiding the rail removes it from the DOM");
  useEditor.setState({ pagesRailHidden: false });
  root.render(React.createElement(editorAppModule.EditorApp));
  await settle();
  assert.ok(host.querySelector(".editor-page-rail"), "restoring the rail brings it back");

  root.unmount();
  host.remove();

  console.log(
    "PASS(2): EditorApp client-renders the six windows (8 grips each); right dock = 340px column (col 1) with the canvas in col 2, top dock = 220px row, rail hide/show.",
  );
} finally {
  await vite.close();
}
