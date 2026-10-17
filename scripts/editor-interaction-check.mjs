/**
 * Real pointer-gesture regression suite for the canvas — NO browser required.
 *
 * The editor's transform pipeline (press → live override → single commit) is
 * what an author judges the product by, and it is exactly what per-module tests
 * cannot see: `resizeToPointer` can be provably correct while the handle is hit
 * in the wrong place, a click still nudges the artwork by half a millimetre, or
 * the node never repaints the committed geometry.
 *
 * This harness mounts the REAL `CanvasStage` (React client render) through Vite
 * on a jsdom document, stubs a deterministic layout (page at (100, 50), `zoom`
 * CSS px per mm) and drives genuine `PointerEvent`s through the live gesture
 * session. Assertions read either the store (document millimetres) or the
 * rendered inline style (what the author sees), so a defect has to survive both.
 *
 * Run:  npm run test:editor:interaction
 *       (node scripts/editor-interaction-check.mjs)
 * Dev dependencies: jsdom, fake-indexeddb (installed by `npm ci`).
 */
import { JSDOM } from "jsdom";

/* ── DOM + browser globals, before any app module loads ─────────────────── */
const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
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
  "MouseEvent",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
]) {
  if (window[key] !== undefined) define(key, window[key]);
}
define("window", window);
define("navigator", {
  userAgent: "Mozilla/5.0 (interaction-check)",
  language: "ar-SA",
  maxTouchPoints: 2,
});
window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});
define("matchMedia", window.matchMedia);
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
define("ResizeObserver", StubObserver);
define("IntersectionObserver", StubObserver);
/* Deterministic frames: the gesture loop coalesces with rAF, so the suite
 * drives it with a timer of the same shape instead of waiting on a compositor
 * that jsdom does not have. */
define("requestAnimationFrame", (cb) => setTimeout(() => cb(Date.now()), 0));
define("cancelAnimationFrame", (id) => clearTimeout(id));
import "fake-indexeddb/auto";

/* ── The app, loaded through Vite exactly as the dev server serves it ───── */
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

const { useEditor } = await vite.ssrLoadModule("/src/lib/editor/store.ts");
const { useInteraction } = await vite.ssrLoadModule(
  "/src/lib/editor/interaction-store.ts",
);
const { createProject } = await vite.ssrLoadModule("/src/lib/editor/templates.ts");
const { createElement, pageSize } = await vite.ssrLoadModule("/src/lib/editor/model.ts");
const stageModule = await vite.ssrLoadModule("/src/components/editor/CanvasStage.tsx");
const { default: React } = await import("react");
const { createRoot } = await import("react-dom/client");

/* ── Deterministic layout ───────────────────────────────────────────────── */
const PAGE_ORIGIN = { left: 100, top: 50 };
let ppm = 2; // CSS px per mm — tracks `zoom`
let pageRect = null;

const rectOf = (r) => ({
  x: r.left,
  y: r.top,
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
  right: r.left + r.width,
  bottom: r.top + r.height,
  toJSON: () => r,
});
const ZERO = rectOf({ left: 0, top: 0, width: 0, height: 0 });
window.Element.prototype.getBoundingClientRect = function getRect() {
  if (this.dataset?.pageId) return pageRect || ZERO;
  if (this.classList?.contains("editor-canvas-stage"))
    return rectOf({ left: 0, top: 0, width: 1200, height: 900 });
  return ZERO;
};
window.Element.prototype.setPointerCapture = function () {};
window.Element.prototype.releasePointerCapture = function () {};
window.Element.prototype.hasPointerCapture = () => false;

/* ── Harness plumbing ───────────────────────────────────────────────────── */
const wait = (ms = 24) => new Promise((r) => setTimeout(r, ms));
const results = [];

let host = null;
let root = null;

const BOX = { type: "shape", id: "box-1", x: 20, y: 30, w: 60, h: 40 };

const layoutFor = () => {
  const page = useEditor.getState().pages[0];
  const size = pageSize(page);
  pageRect = rectOf({
    left: PAGE_ORIGIN.left,
    top: PAGE_ORIGIN.top,
    width: size.w * ppm,
    height: size.h * ppm,
  });
};

/** Reset the whole document for one check (before the stage mounts). */
function seed({ elements = [BOX], zoom = 2, pages = null } = {}) {
  ppm = zoom;
  const project = createProject("blank", "official", "فحص التفاعل");
  const base = pages || project.pages;
  const seeded = base.map((page, index) =>
    index === 0
      ? { ...page, elements: elements.map((el) => createElement(el.type, el)) }
      : page,
  );
  useEditor.setState({
    hydrate: async () => {},
    hydrated: true,
    id: "interaction-check",
    name: project.name,
    pages: seeded,
    activePageId: seeded[0].id,
    selectedId: null,
    selectedIds: [],
    enteredGroupId: null,
    zoom,
    snapGrid: false,
    snapElements: false,
    past: [],
    future: [],
  });
  layoutFor();
  /* A real session always has one baseline snapshot; `undo()` refuses below
   * that, so the suite measures history DELTAS from here. */
  useEditor.getState().commit();
}

function mountStage() {
  host = window.document.createElement("div");
  window.document.body.appendChild(host);
  root = createRoot(host);
  root.render(React.createElement(stageModule.CanvasStage));
}

function teardown() {
  if (root) {
    root.unmount();
    root = null;
  }
  if (host) {
    host.remove();
    host = null;
  }
  useInteraction.getState().endInteraction();
}

async function check(name, config, fn) {
  const resolved = typeof config === "function" ? config() : config;
  teardown();
  seed(resolved);
  mountStage();
  /* A dense document needs longer to reconcile its first paint. */
  await wait(typeof resolved.settle === "number" ? resolved.settle : 200);
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}`);
    console.log(`     · ${error.message}`);
  }
}

/* ── Queries ────────────────────────────────────────────────────────────── */
const elementOf = (id = "box-1") =>
  useEditor.getState().pages[0].elements.find((el) => el.id === id);
const nodeOf = (id = "box-1") =>
  window.document.querySelector(`.canvas-el[data-el-id="${id}"]`);
const pageNode = () => window.document.querySelector("[data-page-id]");
const handleNode = (name) => window.document.querySelector(`[data-handle="${name}"]`);
const rotateNode = () => window.document.querySelector(".rotate-handle");

const mmToClient = (x, y) => ({
  clientX: PAGE_ORIGIN.left + x * ppm,
  clientY: PAGE_ORIGIN.top + y * ppm,
});

function pointer(type, x, y, extra = {}) {
  return new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    ...mmToClient(x, y),
    ...extra,
  });
}

/** A two-finger tap (the iPad undo/redo gesture) on the canvas. */
async function twoFingerTap(target, point) {
  const contact = (id, x, y) => ({
    pointerId: id,
    pointerType: "touch",
    isPrimary: id === 1,
    buttons: 1,
    ...mmToClient(x, y),
  });
  target.dispatchEvent(pointer("pointerdown", point[0], point[1], contact(1, point[0], point[1])));
  await wait(24);
  target.dispatchEvent(
    pointer("pointerdown", point[0], point[1], contact(2, point[0] + 30 / ppm, point[1])),
  );
  await wait(40);
  window.dispatchEvent(
    pointer("pointerup", point[0], point[1], { ...contact(1, point[0], point[1]), buttons: 0 }),
  );
  window.dispatchEvent(
    pointer("pointerup", point[0], point[1], {
      ...contact(2, point[0] + 30 / ppm, point[1]),
      buttons: 0,
    }),
  );
  await wait(48);
}

/** Full press · move · release gesture, waypoints in document millimetres. */
async function gesture(target, from, waypoints, options = {}) {
  if (!target) throw new Error("the gesture target is not rendered");
  const { pointerType = "mouse", steps = 1, settle = 24, altKey = false } = options;
  const extra =
    pointerType === "mouse"
      ? { altKey }
      : { pointerType, pointerId: 7, altKey };
  target.dispatchEvent(pointer("pointerdown", from[0], from[1], extra));
  await wait(10);
  const points = steps > 1 ? waypoints : [waypoints.at(-1) ?? from];
  for (const point of points) {
    if (!point) continue;
    window.dispatchEvent(pointer("pointermove", point[0], point[1], extra));
    if (steps > 1 && settle !== 0) {
      await wait(2);
    }
  }
  await wait(settle);
  const last = waypoints.at(-1) ?? from;
  window.dispatchEvent(
    pointer("pointerup", last[0], last[1], { ...extra, buttons: 0 }),
  );
  await wait(32);
}

/* ── Assertions ─────────────────────────────────────────────────────────── */
const near = (actual, expected, tolerance, what) => {
  if (Math.abs(actual - expected) > tolerance)
    throw new Error(`${what}: expected ${expected} ±${tolerance}, got ${actual}`);
};
const boxOf = (id = "box-1") => {
  const el = elementOf(id);
  if (!el) throw new Error(`element ${id} is gone`);
  return { x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation || 0 };
};
const equalBox = (a, b, what = "box") => {
  for (const key of ["x", "y", "w", "h", "rotation"])
    near(a[key], b[key], 0.005, `${what}.${key}`);
};
const styleOf = (id = "box-1") => {
  const node = nodeOf(id);
  if (!node) throw new Error(`node for ${id} is not rendered`);
  return node.style;
};
const selected = () => useEditor.getState().selectedIds;
const historyLength = () => useEditor.getState().past.length;

/* ── Checks ─────────────────────────────────────────────────────────────── */

await check("a click selects without moving or dirtying the document", {}, async () => {
  const before = boxOf();
  await gesture(nodeOf(), [40, 50], []);
  equalBox(boxOf(), before, "click");
  if (!selected().includes("box-1")) throw new Error("the click did not select the element");
  if (historyLength() !== 1)
    throw new Error(`a click pushed ${historyLength() - 1} history entries`);
});

await check("a two-pixel hand wobble does not nudge the element", {}, async () => {
  const before = boxOf();
  /* 2 css px of travel is inside the 6px slop — this is the "I clicked and the
   * artwork moved" report, measured at 2 px/mm. */
  await gesture(nodeOf(), [40, 50], [[41.2, 50.8]]);
  equalBox(boxOf(), before, "wobble");
  if (historyLength() !== 1)
    throw new Error("a wobbling click still pushed a history entry");
});

await check("a drag moves the element by the pointer delta", {}, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  const box = boxOf();
  near(box.x, 40, 0.02, "x after +20mm");
  near(box.y, 50, 0.02, "y after +20mm");
  near(box.w, 60, 0.02, "w must not change");
  near(box.h, 40, 0.02, "h must not change");
});

await check("a drag is exact at 0.5 px/mm", { zoom: 0.5 }, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  near(boxOf().x, 40, 0.05, "x after +20mm");
  near(boxOf().y, 50, 0.05, "y after +20mm");
});

await check("a drag is exact at 8 px/mm", { zoom: 8 }, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  near(boxOf().x, 40, 0.02, "x after +20mm");
  near(boxOf().y, 50, 0.02, "y after +20mm");
});

await check(
  "a drag that ends where it began leaves no phantom undo step",
  {},
  async () => {
    /*
     * The author grabs the box, changes their mind and brings it back. The
     * document that lands is byte-identical to the one on screen, so this must
     * be a no-op: no history entry (an Undo that restores what is already
     * there reads as "undo is broken") and no autosave for a document nobody
     * edited.
     */
    const before = boxOf();
    const steps = historyLength();
    await gesture(nodeOf(), [40, 50], [[80, 90], [40, 50]]);
    equalBox(boxOf(), before, "the box stays where it started");
    if (historyLength() !== steps)
      throw new Error(
        `a net-zero drag pushed ${historyLength() - steps} history entr(ies)`,
      );
  },
);

await check("the rendered node follows the committed geometry", {}, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  const style = styleOf();
  if (style.left !== "40mm" || style.top !== "50mm")
    throw new Error(`the node paints ${style.left}/${style.top}, expected 40mm/50mm`);
});

await check("a drag is one undo step and redo restores it", {}, async () => {
  const before = boxOf();
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  const moved = boxOf();
  const steps = historyLength() - 1;
  if (steps !== 1) throw new Error(`a drag pushed ${steps} history entries`);
  useEditor.getState().undo();
  equalBox(boxOf(), before, "after undo");
  useEditor.getState().redo();
  equalBox(boxOf(), moved, "after redo");
});

await check(
  "locked artwork is selected but never dragged",
  { elements: [{ ...BOX, locked: true }] },
  async () => {
    const before = boxOf();
    await gesture(nodeOf(), [40, 50], [[60, 70]]);
    equalBox(boxOf(), before, "locked drag");
    if (!selected().includes("box-1"))
      throw new Error("a locked element must still be selectable (so it can be unlocked)");
  },
);

await check(
  "a locked overlay never blocks the element beneath it",
  {
    elements: [
      { ...BOX, id: "under-1" },
      { type: "shape", id: "over-locked", x: 10, y: 20, w: 100, h: 80, locked: true },
    ],
  },
  async () => {
    /*
     * In a browser the LOCKED node is the event target here (it paints on top
     * and accepts the pointer so it can be selected for unlocking), so the
     * press is dispatched on it — that is the path a real click takes. The
     * capture-phase hit-test skips locked artwork, so the press must land on
     * the editable element underneath instead: a locked background (a
     * full-page image, a section band, a header block) can never make what it
     * covers uneditable.
     */
    const beforeUnder = boxOf("under-1");
    const beforeLocked = boxOf("over-locked");
    await gesture(nodeOf("over-locked"), [40, 50], [[60, 70]]);
    near(boxOf("under-1").x, beforeUnder.x + 20, 0.02, "the covered element moves");
    near(boxOf("under-1").y, beforeUnder.y + 20, 0.02, "the covered element moves");
    equalBox(boxOf("over-locked"), beforeLocked, "the locked element itself never moves");
    if (!selected().includes("under-1"))
      throw new Error(`the press selected ${JSON.stringify(selected())}`);
  },
);

await check(
  "Alt+press on a locked overlay behaves the same (no regression)",
  {
    elements: [
      { ...BOX, id: "under-1" },
      { type: "shape", id: "over-locked", x: 10, y: 20, w: 100, h: 80, locked: true },
    ],
  },
  async () => {
    const beforeUnder = boxOf("under-1");
    await gesture(nodeOf("over-locked"), [40, 50], [[60, 70]], { altKey: true });
    near(boxOf("under-1").x, beforeUnder.x + 20, 0.02, "the covered element moves");
    near(boxOf("under-1").y, beforeUnder.y + 20, 0.02, "the covered element moves");
  },
);

await check(
  "a locked element that covers nothing still selects without moving",
  {
    elements: [
      { type: "shape", id: "over-locked", x: 10, y: 20, w: 100, h: 80, locked: true },
      { ...BOX, id: "box-1", x: 150, y: 200 },
    ],
  },
  async () => {
    const before = boxOf("over-locked");
    await gesture(nodeOf("over-locked"), [40, 50], [[60, 70]]);
    equalBox(boxOf("over-locked"), before, "the locked element must not move");
    if (!selected().includes("over-locked"))
      throw new Error(
        "a locked element with nothing under it must still be selectable so it can be unlocked",
      );
  },
);

await check("resize lands the grabbed corner under the pointer", {}, async () => {
  /* A handle only exists on the selected element — select it the way a click
   * does (the check above proves that path), then resize. */
  useEditor.getState().select("box-1");
  await wait(16);
  await gesture(handleNode("se"), [80, 70], [[100, 90]]);
  const box = boxOf();
  near(box.x, 20, 0.05, "x stays (NW anchor)");
  near(box.y, 30, 0.05, "y stays (NW anchor)");
  near(box.w, 80, 0.05, "w grew by 20mm");
  near(box.h, 60, 0.05, "h grew by 20mm");
});

await check("resize is exact at 0.5 px/mm", { zoom: 0.5 }, async () => {
  useEditor.getState().select("box-1");
  await wait(16);
  await gesture(handleNode("se"), [80, 70], [[100, 90]]);
  near(boxOf().w, 80, 0.1, "w grew by 20mm");
  near(boxOf().h, 60, 0.1, "h grew by 20mm");
});

await check("resize never goes below MIN_SIZE", {}, async () => {
  useEditor.getState().select("box-1");
  await wait(16);
  await gesture(handleNode("se"), [80, 70], [[10, 10]]);
  const box = boxOf();
  if (box.w < 4 || box.h < 4) throw new Error(`collapsed to ${box.w}×${box.h}`);
  near(box.x, 20, 0.05, "NW corner still pinned");
});

await check(
  "a multi-selection drags every selected element together",
  {
    elements: [BOX, { ...BOX, id: "box-2", x: 100, y: 120 }],
  },
  async () => {
    useEditor.getState().selectMany(["box-1", "box-2"]);
    await gesture(nodeOf("box-1"), [40, 50], [[60, 70]]);
    near(boxOf("box-1").x, 40, 0.02, "box-1 moves");
    near(boxOf("box-2").x, 120, 0.02, "box-2 moves with the selection");
    near(boxOf("box-2").y, 140, 0.02, "box-2 moves with the selection");
  },
);

await check(
  "a marquee selects what it covers and moves nothing",
  { elements: [BOX, { ...BOX, id: "box-2", x: 120, y: 150 }] },
  async () => {
    const first = boxOf("box-1");
    const second = boxOf("box-2");
    await gesture(pageNode(), [10, 10], [[200, 260]]);
    equalBox(boxOf("box-1"), first, "marquee must not move box-1");
    equalBox(boxOf("box-2"), second, "marquee must not move box-2");
    if (selected().length < 2)
      throw new Error(`the marquee selected ${selected().length} element(s), expected both`);
  },
);

await check("a touch tap with sub-slop travel does not drag", {}, async () => {
  const before = boxOf();
  /* A finger is never a pointer-until-proven-otherwise: the gesture stays
   * undecided until it travels, so a tap that rolls a few pixels must not move
   * the artwork. */
  await gesture(nodeOf(), [40, 50], [[41.6, 51.2]], { pointerType: "touch" });
  equalBox(boxOf(), before, "touch tap");
});

await check("a touch drag past the slop moves by the pointer delta", {}, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]], { pointerType: "touch" });
  near(boxOf().x, 40, 0.02, "x after a +20mm finger drag");
  near(boxOf().y, 50, 0.02, "y after a +20mm finger drag");
});

await check("an Apple Pencil drag behaves exactly like a mouse drag", {}, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]], { pointerType: "pen" });
  near(boxOf().x, 40, 0.02, "x after a +20mm Pencil drag");
  near(boxOf().y, 50, 0.02, "y after a +20mm Pencil drag");
});

await check("a two-finger tap undoes the last edit", {}, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  const moved = boxOf();
  near(moved.x, 40, 0.02, "the drag landed first");
  await twoFingerTap(pageNode(), [150, 250]);
  if (Math.abs(boxOf().x - moved.x) < 0.01)
    throw new Error("the two-finger tap did not undo the drag");
  near(boxOf().x, 20, 0.02, "the two-finger tap restored the previous state");
});

await check(
  "dragging a group frame moves the whole group",
  {
    elements: [
      {
        type: "group",
        id: "group-1",
        x: 40,
        y: 60,
        w: 80,
        h: 60,
        children: [
          { type: "shape", id: "g-child-1", x: 0, y: 0, w: 30, h: 20 },
          { type: "shape", id: "g-child-2", x: 40, y: 30, w: 30, h: 20 },
        ],
      },
    ],
  },
  async () => {
  const before = boxOf("group-1");
  await gesture(nodeOf("group-1"), [45, 65], [[65, 85]]);
  const after = boxOf("group-1");
  near(after.x, before.x + 20, 0.05, "the group frame moved");
  near(after.y, before.y + 20, 0.05, "the group frame moved");
  near(after.w, before.w, 0.02, "the group kept its size");
  /* Children live in parent-relative millimetres: moving the frame must NOT
   * translate them a second time. */
  const children = elementOf("group-1").children ?? [];
  const first = children.find((child) => child.id === "g-child-1");
  const second = children.find((child) => child.id === "g-child-2");
  near(first?.x ?? -1, 0, 0.001, "child 1 stayed relative to the group");
  near(second?.x ?? -1, 40, 0.001, "child 2 stayed relative to the group");
  near(second?.y ?? -1, 30, 0.001, "child 2 stayed relative to the group");
  },
);

await check(
  "dragging one linked element carries its partner",
  {
    elements: [
      { type: "shape", id: "link-1", x: 20, y: 30, w: 40, h: 30, linkId: "L1" },
      { type: "shape", id: "link-2", x: 90, y: 30, w: 40, h: 30, linkId: "L1" },
      { type: "shape", id: "free-1", x: 160, y: 30, w: 40, h: 30 },
    ],
  },
  async () => {
    const before = { one: boxOf("link-1"), two: boxOf("link-2"), free: boxOf("free-1") };
    await gesture(nodeOf("link-1"), [30, 40], [[50, 70]]);
    const after = { one: boxOf("link-1"), two: boxOf("link-2"), free: boxOf("free-1") };
    near(after.one.x, before.one.x + 20, 0.05, "the dragged element moved");
    near(after.one.y, before.one.y + 30, 0.05, "the dragged element moved");
    /* A link is NOT a group: the partner keeps its own layer, its own style and
     * its own id, but moves with the element it is linked to. */
    near(after.two.x, before.two.x + 20, 0.05, "the linked partner followed on x");
    near(after.two.y, before.two.y + 30, 0.05, "the linked partner followed on y");
    equalBox(after.two, { ...before.two, x: before.two.x + 20, y: before.two.y + 30 }, "partner box");
    near(after.two.w, before.two.w, 0.02, "the partner kept its size");
    equalBox(after.free, before.free, "an unlinked neighbour");
    if (useEditor.getState().pages[0].elements.length !== 3)
      throw new Error("linking must not merge elements into a group");
    if (elementOf("link-2").linkId !== "L1")
      throw new Error("the link id must survive the drag");
  },
);

await check("a zoom change keeps the document's millimetres", {}, async () => {
  await gesture(nodeOf(), [40, 50], [[60, 70]]);
  const committed = boxOf();
  /* The artboard repaints at the new zoom; the document must not be touched. */
  ppm = 0.5;
  useEditor.getState().setZoom(0.5);
  layoutFor();
  await wait(40);
  equalBox(boxOf(), committed, "zoom must not rewrite geometry");
  await gesture(nodeOf(), [60, 70], [[80, 90]]);
  near(boxOf().x, committed.x + 20, 0.05, "post-zoom drag delta");
});

await check("rotation keeps the element centre pinned", {}, async () => {
  useEditor.getState().select("box-1");
  await wait(16);
  const before = boxOf();
  const cx = before.x + before.w / 2;
  const cy = before.y + before.h / 2;
  await gesture(rotateNode(), [20, 30], [[cx, cy - before.h / 2 - 40]]);
  const after = boxOf();
  near(after.x, before.x, 0.8, "x after rotation (centre pinned)");
  near(after.y, before.y, 0.8, "y after rotation (centre pinned)");
  near(after.w, before.w, 0.02, "rotation must not resize");
  if (Math.abs(after.rotation) < 20)
    throw new Error(`the rotation gesture produced ${after.rotation}°`);
});

await check("a click on bare canvas clears the selection", {}, async () => {
  const before = boxOf();
  useEditor.getState().select("box-1");
  await gesture(pageNode(), [150, 250], []);
  equalBox(boxOf(), before, "a canvas click must not move anything");
  if (selected().length !== 0)
    throw new Error("clicking bare canvas did not clear the selection");
});

await check(
  "200 moves over a 300-element page stay responsive",
  () => {
    const project = createProject("blank", "official", "أداء");
    const page = project.pages[0];
    const dense = [];
    for (let i = 0; i < 300; i++)
      dense.push({
        type: "shape",
        id: `el-${i}`,
        x: (i % 20) * 9,
        y: Math.floor(i / 20) * 12,
        w: 8,
        h: 10,
      });
    return {
      zoom: 2,
      settle: 900,
      elements: dense,
      pages: Array.from({ length: 50 }, (_, index) =>
        index === 0 ? page : { ...page, id: `${page.id}-${index}`, elements: [] },
      ),
    };
  },
  async () => {
    const started = performance.now();
    await gesture(
      nodeOf("el-0"),
      [5, 5],
      Array.from({ length: 200 }, (_, i) => [
        5 + (i % 40) * 0.2,
        5 + Math.floor(i / 40) * 0.4,
      ]),
      { steps: 200, settle: 0 },
    );
    const elapsed = performance.now() - started;
    const perMove = elapsed / 200;
    console.log(
      `     · 200 moves over a 300-element page (50 pages loaded): ${elapsed.toFixed(0)}ms (${perMove.toFixed(2)}ms/move)`,
    );
    if (perMove > 8)
      throw new Error(`${perMove.toFixed(2)}ms per move exceeds the 8ms budget`);
  },
);

teardown();
await vite.close();

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length ? `${failed.length} interaction check(s) FAILED` : `All ${results.length} interaction checks passed.`}`,
);
for (const failure of failed)
  console.log(`  ✗ ${failure.name}: ${failure.error.message}`);
process.exit(failed.length ? 1 : 0);
