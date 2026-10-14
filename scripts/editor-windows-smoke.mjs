/**
 * Runtime smoke test for the window workspace — NO browser required.
 *
 * Loads the REAL modules through Vite (TS + aliases, exactly as the dev server
 * serves them) on top of a jsdom DOM, then exercises both the window-system
 * state machine and the real shell rendered through the real router:
 *
 *   1. The six panels (library / tools / elements / properties / layers /
 *      report) are INDEPENDENT — opening one never closes another, and all six
 *      can be open at the same time; closeFloatingPanels() dismisses them all.
 *   2. The pages-rail visibility state persists into the UI slot that hydrate()
 *      reads back, and the rail is compact by default (96px) with an 84px floor.
 *   3. EditorApp client-renders the SHIPPED layout — two windows hosting the
 *      six panels as tabs, both docked with the canvas in the middle column,
 *      docked windows offering no floating grips — and an author's ungrouped
 *      six-window layout, with a right dock reserving a 340px column.
 *
 * Run:  npm run test:editor:windows
 *       (node scripts/editor-windows-smoke.mjs)
 * Dev dependencies: jsdom, fake-indexeddb, vite (installed by npm ci).
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
  const {
    PAGES_PANEL_DEFAULT,
    PAGES_PANEL_MIN,
    placeFloatingToolbar,
  } = await vite.ssrLoadModule("/src/lib/editor/ui-state.ts");
  const {
    MIN_ZOOM,
    MAX_ZOOM,
    clampZoom,
    stepZoom,
  } = await vite.ssrLoadModule("/src/lib/editor/document-space.ts");
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
  assert.equal(s().pagesPanelHeight, PAGES_PANEL_DEFAULT, "compact rail by default");
  s().setPagesPanelHeight(30);
  assert.equal(s().pagesPanelHeight, PAGES_PANEL_MIN, "rail floor holds");
  s().setPagesPanelHeight(PAGES_PANEL_DEFAULT);

  /* 5 ─ Selection never forces closed panels open, and workspace reset keeps properties active. */
  const firstElId = s().pages[0]?.elements?.[0]?.id;
  if (firstElId) {
    s().closeFloatingPanels();
    assert.equal(s().rightOpen, false, "properties closed before selection");
    s().select(firstElId);
    assert.equal(s().selectedId, firstElId, "element selected");
    assert.equal(s().rightOpen, false, "selecting an element does not force rightOpen");
    assert.equal(s().rightTab, "properties", "rightTab targets properties");
    s().select(null);
  }
  s().resetWorkspaceLayout();
  assert.equal(s().layersOpen, false, "resetWorkspaceLayout keeps layersOpen false so properties stays active");

  /* 6 ─ Proportional zoom steps and obstacle-aware toolbar placement at max zoom. */
  assert.equal(clampZoom(0.001), MIN_ZOOM, "zoom clamps at MIN_ZOOM");
  assert.equal(clampZoom(999), MAX_ZOOM, "zoom clamps at MAX_ZOOM");
  assert.ok(Math.abs(stepZoom(1, 1) - 1.2) < 1e-6, "stepZoom steps proportionally up");
  assert.ok(Math.abs(stepZoom(1.2, -1) - 1) < 1e-6, "stepZoom steps proportionally down");
  const highZoomPlacement = placeFloatingToolbar(
    { left: -400, top: -400, right: 1840, bottom: 1300, width: 2240, height: 1700 },
    { width: 260, height: 40 },
    { width: 1440, height: 900 },
    14,
    12,
    [
      { left: 0, top: 0, right: 1440, bottom: 48, width: 1440, height: 48 },
      { left: 1100, top: 48, right: 1440, bottom: 832, width: 340, height: 784 },
      { left: 0, top: 48, right: 320, bottom: 832, width: 320, height: 784 },
      { left: 0, top: 832, right: 1440, bottom: 900, width: 1440, height: 68 },
    ],
  );
  assert.ok(
    highZoomPlacement.top >= 48 &&
      highZoomPlacement.top + 40 <= 832 &&
      highZoomPlacement.left >= 320 &&
      highZoomPlacement.left + 260 <= 1100,
    "floating toolbar stays inside the unobscured canvas stage even when selection spans the viewport at max zoom",
  );

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

  /*
   * The editor shell is a ROUTE component in production: it reads
   * `useNavigate`, and `LeaveGuard` blocks navigation. Mounting it bare left
   * those hooks without a router, so this smoke test could not render the real
   * workspace at all (`useRouter must be used inside a <RouterProvider>` and
   * zero panels in the DOM). Mount the REAL router with a memory history
   * instead of stubbing the hooks — the shell then runs exactly the code path
   * a browser gives it, and the leave guard is exercised rather than bypassed.
   */
  const {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
  } = await import("@tanstack/react-router");
  const shell = () => React.createElement(editorAppModule.EditorApp);
  const rootRoute = createRootRoute();
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: shell }),
    createRoute({ getParentRoute: () => rootRoute, path: "/editor", component: shell }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/editor/$projectId",
      component: shell,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: "/workspace", component: shell }),
  ]);
  const makeRouter = () =>
    createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/editor"] }),
      defaultPendingMinMs: 0,
    });

  const project = createProject("blank", "official", "اختبار");
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
  let root = null;
  let host = null;
  const mount = async (extra = {}) => {
    if (root) {
      root.unmount();
      host.remove();
    }
    useEditor.setState({
      /* EditorApp calls hydrate() on mount; the render test seeds the state
       * itself, so the real loader (IndexedDB + fonts + UI slot) is skipped. */
      hydrate: async () => {},
      hydrated: true,
      /* The shell latches its opening placeholder until the DOCUMENT reports
       * ready; a smoke test that seeds the document itself must say so, or it
       * measures the placeholder instead of the workspace. */
      documentPhase: "ready",
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
    const router = makeRouter();
    /*
     * TanStack Start's client entry renders `Transitioner` (which creates the
     * router's render-acknowledgement slot and subscribes history) above the
     * provider; the harness has no Start entry, so it does the one thing that
     * component does that the provider needs: an acknowledgement array. The
     * first match is resolved before rendering because jsdom will not navigate
     * on its own.
     */
    router._rendered ??= [];
    await router.load();
    root.render(React.createElement(RouterProvider, { router }));
    return host;
  };
  /* jsdom has no layout engine, so the assertions read the GRID STYLES the
   * component computes — the inline grid areas are the source of truth that a
   * real browser turns into pixels. */

  /* ── 2a · The SHIPPED layout ────────────────────────────────────────────
   * Two windows, each hosting three panels as tabs: لوحة العناصر (content) on
   * the right, الخصائص (inspector) on the left, both docked, with the canvas
   * as its own grid column. `nasaq.panel.groups.v3` / `nasaq.panel.docks.v3`
   * are cleared first so the assertion describes the DEFAULT an author gets on
   * a fresh device, not leftovers from a previous section. */
  window.localStorage.removeItem("nasaq.panel.groups.v3");
  window.localStorage.removeItem("nasaq.panel.docks.v3");
  window.localStorage.removeItem("nasaq.panel.dock-sizes.v2");
  await mount();
  await settle();
  const windows = [...host.querySelectorAll(".editor-floating-panel")];
  assert.equal(windows.length, 2, "the shipped workspace is TWO windows, not six loose panels");
  for (const label of ["لوحة العناصر", "الخصائص"]) {
    assert.ok(
      host.querySelector(`.editor-floating-panel[aria-label="${label}"]`),
      `the ${label} window is rendered`,
    );
  }
  assert.equal(host.querySelectorAll(".editor-floating-panel.is-docked").length, 2, "both windows are docked by default");
  const strips = [...host.querySelectorAll(".panel-tab-strip")];
  assert.equal(strips.length, 2, "each window carries a tab strip (also the drop zone for the first drag)");
  const tabLabels = strips.flatMap((strip) =>
    [...strip.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
  );
  for (const label of ["المكتبة", "أدوات العناصر", "لوحة العناصر", "الخصائص", "الطبقات", "أدوات التقرير"]) {
    assert.ok(
      tabLabels.includes(label),
      `panel «${label}» is reachable as a tab (found: ${tabLabels.join(" / ")})`,
    );
  }
  const rowShipped = host.querySelector(".editor-workspace-row");
  assert.ok(rowShipped, "workspace row rendered");
  assert.match(
    rowShipped.style.gridTemplateColumns,
    /^\d+(px)? minmax\(0, 1fr\)( \d+px)?$/,
    `a docked workspace reserves column tracks around the canvas (${rowShipped.style.gridTemplateColumns})`,
  );
  const canvasCenter = host.querySelector(".editor-canvas-workspace");
  assert.equal(canvasCenter.style.gridColumn, "2", "the canvas owns the middle column");
  /* A DOCKED window is sized by its grid track (the dock strip is the resize
   * face), so it must NOT offer floating grips — offering them would let the
   * author resize it into the layout it no longer owns. */
  for (const label of ["الخصائص", "لوحة العناصر"]) {
    const panel = host.querySelector(`.editor-floating-panel[aria-label="${label}"]`);
    assert.equal(
      panel.querySelectorAll(".floating-panel-resize").length,
      0,
      `${label} is docked: no floating resize grips`,
    );
    assert.ok(
      host.querySelector('.editor-dock-strip[role="separator"]'),
      "a dock strip is the resize affordance instead",
    );
  }

  /* ── 2b · All six panels SEPARATE (the author's own layout) ─────────────
   * Write the grouping an author creates by dragging every tab out, then
   * assert the shell renders six independent windows over the canvas. */
  /* An EMPTY dock map is the author's "I undocked everything" — distinct from
   * the key being absent, which means "first visit, use the shipped layout". */
  window.localStorage.setItem("nasaq.panel.docks.v3", "{}");
  window.localStorage.setItem(
    "nasaq.panel.groups.v3",
    JSON.stringify({
      groups: {
        elements: ["elements"],
        tools: ["tools"],
        library: ["library"],
        properties: ["properties"],
        layers: ["layers"],
        report: ["report"],
      },
      tabs: {
        elements: "elements",
        tools: "tools",
        library: "library",
        properties: "properties",
        layers: "layers",
        report: "report",
      },
    }),
  );
  await mount();
  await settle();
  assert.equal(
    host.querySelectorAll(".editor-floating-panel").length,
    6,
    "an ungrouped layout renders six windows",
  );
  for (const label of ["المكتبة", "أدوات العناصر", "لوحة العناصر", "الخصائص", "الطبقات", "أدوات التقرير"]) {
    assert.ok(
      host.querySelector(`.editor-floating-panel[aria-label="${label}"]`),
      `window «${label}» rendered`,
    );
  }
  const rowFree = host.querySelector(".editor-workspace-row");
  assert.equal(
    rowFree.style.gridTemplateColumns,
    "minmax(0, 1fr)",
    "with nothing docked the canvas owns the whole row",
  );
  assert.equal(host.querySelectorAll(".is-docked").length, 0, "nothing is docked in that layout");
  const propsFree = host.querySelector('.editor-floating-panel[aria-label="الخصائص"]');
  assert.ok(propsFree.querySelector(".fp-dock-menu") === null, "the dock menu starts closed");
  assert.equal(
    propsFree.querySelectorAll(".floating-panel-resize").length,
    8,
    "a floating window offers all eight resize grips",
  );

  /* ── 2c · Docking ───────────────────────────────────────────────────────
   * Pin the properties window to the right: the grid must grow a 340px column
   * and the canvas must move to the next one. */
  window.localStorage.setItem("nasaq.panel.docks.v3", JSON.stringify({ properties: "right" }));
  window.localStorage.setItem("nasaq.panel.dock-sizes.v2", JSON.stringify({ properties: { w: 340, h: 0 } }));
  await mount();
  await settle();
  const rowDocked = host.querySelector(".editor-workspace-row");
  assert.match(
    rowDocked.style.gridTemplateColumns,
    /^340px minmax\(0, 1fr\)/,
    `a 340px docked column precedes the canvas (${rowDocked.style.gridTemplateColumns})`,
  );
  const dockedProps = host.querySelector('.editor-floating-panel[aria-label="الخصائص"]');
  assert.ok(
    dockedProps.classList.contains("is-docked") && dockedProps.classList.contains("is-docked-right"),
    "the window carries the docked-right class",
  );
  assert.equal(dockedProps.getAttribute("data-dock-side"), "right", "the dock side is exposed");
  const dockCell = host.querySelector(".editor-dock-cell");
  assert.equal(dockCell.style.gridColumn, "1", "the docked cell owns column 1 (physical right in RTL)");
  const center = host.querySelector(".editor-canvas-workspace");
  assert.equal(center.style.gridColumn, "2", "the canvas moved to column 2");
  assert.equal(center.style.gridRow, "1", "the canvas stays in the main row");

  /* ── 2d · The pages rail ────────────────────────────────────────────────
   * Hiding it is a STORE change; the shell must react without a remount. */
  assert.ok(host.querySelector(".editor-page-rail"), "the rail renders by default");
  useEditor.setState({ pagesRailHidden: true });
  await settle();
  assert.equal(host.querySelector(".editor-page-rail"), null, "hiding the rail removes it from the DOM");
  useEditor.setState({ pagesRailHidden: false });
  await settle();
  assert.ok(host.querySelector(".editor-page-rail"), "restoring the rail brings it back");
  window.localStorage.removeItem("nasaq.panel.groups.v3");
  window.localStorage.removeItem("nasaq.panel.docks.v3");

  root.unmount();
  host.remove();

  console.log(
    "PASS(2): EditorApp client-renders the shipped two-window layout (six panels reachable as tabs), an ungrouped six-window layout, right dock = 340px column (col 1) with the canvas in col 2, and rail hide/show.",
  );
} finally {
  await vite.close();
}
