import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type CanvasEl } from "./model.ts";
import { createProject } from "./templates.ts";
import { useEditor } from "./store.ts";

/**
 * Crop/selection through the REAL document store and a REAL rasterizer.
 *
 * These are the acceptance checks for «قص التحديد» and «استخراج التحديد»: the
 * pixels are decoded from the committed PNG, the element is read back from the
 * store, and Undo/Redo are the actual history stacks. Nothing here is stubbed:
 * the store runs on fake-indexeddb (the repo's existing test double for
 * IndexedDB, which Node does not provide) and the canvas is Skia.
 */
interface Harness {
  window: Window & typeof globalThis;
  host(): HTMLElement;
  createImage(
    width: number,
    height: number,
    paint: (ctx: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement;
  pixelsOf(
    dataUrl: string,
    width: number,
    height: number,
  ): Promise<{ at(x: number, y: number): number[] }>;
}

const { installCanvasHarness } = (await import(
  new URL("../../../scripts/test-canvas-harness.mjs", import.meta.url).href
)) as { installCanvasHarness: () => Promise<Harness | null> };
const harness = await installCanvasHarness();
const skip = harness
  ? false
  : "canvas harness unavailable (@napi-rs/canvas not installed)";

const RED = "#ff0000";
const BLUE = "#0000ff";

/** Left half red, right half blue — a crop that lands on one colour is correct. */
const artwork = () =>
  harness!.createImage(200, 200, (ctx) => {
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, 100, 200);
    ctx.fillStyle = BLUE;
    ctx.fillRect(100, 0, 100, 200);
  });

interface Seeded {
  pageId: string;
  elementId: string;
  src: string;
  original: CanvasEl;
  el(): CanvasEl;
}

/** One 100 mm square image at (20, 30) on a blank page, history reset. */
function seed(over: Partial<CanvasEl> = {}): Seeded {
  const page = createProject("blank").pages[0];
  const src = artwork().toDataURL("image/png");
  const element = createElement("image", {
    id: "art",
    x: 20,
    y: 30,
    w: 100,
    h: 100,
    z: 1,
    src,
    style: {},
    ...over,
  });
  page.elements = [element];
  useEditor.setState({
    pages: [page],
    activePageId: page.id,
    selectedIds: [],
    selectedId: null,
    enteredGroupId: null,
    past: [],
    future: [],
  });
  useEditor.getState().commit();
  const read = () =>
    useEditor.getState().pages[0].elements.find((el) => el.id === "art")!;
  return {
    pageId: page.id,
    elementId: "art",
    src,
    original: read(),
    el: read,
  };
}

const cropModule = () => import("./crop-session.ts");

test("crop to selection frames the chosen pixels and keeps the original bytes", { skip }, async () => {
  const seeded = seed();
  const { cropSelectionToImage } = await cropModule();
  // The left (red) half: 50 mm of the 100 mm frame over a 200 px window.
  const ok = await cropSelectionToImage({
    pageId: seeded.pageId,
    shape: "rect",
    box: { x: 20, y: 30, w: 50, h: 50 },
  });
  assert.equal(ok, true);
  const el = seeded.el();
  assert.deepEqual(
    [el.x, el.y, el.w, el.h],
    [20, 30, 50, 50],
    "the element moves with the crop, it does not drift on the page",
  );
  assert.deepEqual(el.style.crop, {
    sourceW: 200,
    sourceH: 200,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
  });
  assert.equal(el.src, seeded.src, "crop is non-destructive: no re-encode");
  assert.equal(el.rotation, 0);
});

test("crop is one undoable write and Redo restores it", { skip }, async () => {
  const seeded = seed();
  const { cropSelectionToImage } = await cropModule();
  const before = useEditor.getState().past.length;
  await cropSelectionToImage({
    pageId: seeded.pageId,
    shape: "rect",
    box: { x: 20, y: 30, w: 50, h: 50 },
  });
  assert.equal(useEditor.getState().past.length, before + 1, "one history entry");

  useEditor.getState().undo();
  const undone = seeded.el();
  assert.deepEqual([undone.x, undone.y, undone.w, undone.h], [20, 30, 100, 100]);
  assert.equal(undone.style.crop, undefined);

  useEditor.getState().redo();
  const redone = seeded.el();
  assert.deepEqual([redone.w, redone.h], [50, 50]);
  assert.equal(redone.style.crop?.w, 100);
});

test("extraction copies the region into a new element and leaves the original alone", { skip }, async () => {
  const seeded = seed();
  const { extractRegionFromImage } = await cropModule();
  // The right (blue) half.
  const ok = await extractRegionFromImage({
    pageId: seeded.pageId,
    shape: "rect",
    box: { x: 70, y: 30, w: 50, h: 50 },
  });
  assert.equal(ok, true);
  const elements = useEditor.getState().pages[0].elements;
  assert.equal(elements.length, 2);
  const original = elements.find((el) => el.id === "art")!;
  assert.deepEqual(original, seeded.original, "the source is untouched");
  const copy = elements.find((el) => el.id !== "art")!;
  assert.deepEqual(
    [copy.x, copy.y, copy.w, copy.h],
    [70, 30, 50, 50],
    "the copy lands exactly on the region",
  );
  // ...and it carries the region's pixels: the right half is blue.
  const pixels = await harness!.pixelsOf(String(copy.src), 100, 100);
  assert.deepEqual(pixels.at(10, 50), [0, 0, 255, 255]);
  assert.deepEqual(pixels.at(90, 50), [0, 0, 255, 255]);
});

test("a region that misses the image is refused, not guessed at", { skip }, async () => {
  const seeded = seed();
  const { cropSelectionToImage, extractRegionFromImage } = await cropModule();
  const before = useEditor.getState().past.length;
  assert.equal(
    await cropSelectionToImage({
      pageId: seeded.pageId,
      shape: "rect",
      box: { x: 300, y: 300, w: 20, h: 20 },
    }),
    false,
  );
  assert.equal(
    await extractRegionFromImage({
      pageId: seeded.pageId,
      shape: "rect",
      box: { x: 20, y: 30, w: 0.1, h: 0.1 },
    }),
    false,
    "a sub-millimetre sliver is not a crop",
  );
  assert.equal(useEditor.getState().past.length, before, "nothing was written");
  assert.equal(useEditor.getState().pages[0].elements.length, 1);
  assert.deepEqual(seeded.el(), seeded.original);
});

test("cropping a rotated element keeps its angle and its centre", { skip }, async () => {
  const seeded = seed({ rotation: 30 });
  const { cropSelectionToImage } = await cropModule();
  // The region's centre is the element's centre: 45 mm of the 100 mm frame.
  const ok = await cropSelectionToImage({
    pageId: seeded.pageId,
    shape: "rect",
    box: { x: 45, y: 55, w: 50, h: 50 },
  });
  assert.equal(ok, true);
  const el = seeded.el();
  assert.equal(el.rotation, 30, "the angle survives the crop");
  // A page-axis-aligned region is a rotated quad inside a rotated element, so
  // the crop covers its true extent — never a part of what was selected.
  const extent = 50 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6));
  assert.ok(Math.abs(el.w - extent) < 1e-6, `width ${el.w} vs ${extent}`);
  assert.ok(Math.abs(el.h - extent) < 1e-6, `height ${el.h} vs ${extent}`);
  // `croppedFrame` keeps the visual centre fixed under rotation.
  const centre = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
  assert.ok(Math.abs(centre.x - 70) < 1e-6, `centre x ${centre.x}`);
  assert.ok(Math.abs(centre.y - 80) < 1e-6, `centre y ${centre.y}`);
  assert.ok(
    Math.abs((el.style.crop?.w ?? 0) - extent * 2) < 1e-6,
    `source window ${el.style.crop?.w}`,
  );
  assert.ok(el.style.crop!.x >= 0 && el.style.crop!.y >= 0);
  assert.ok(
    el.style.crop!.x + el.style.crop!.w <= 200 &&
      el.style.crop!.y + el.style.crop!.h <= 200,
    "the window never leaves the source bitmap",
  );
});

test("a locked page refuses to crop", { skip }, async () => {
  const seeded = seed();
  const page = useEditor.getState().pages[0];
  useEditor.setState({ pages: [{ ...page, locked: true }] });
  const { cropSelectionToImage } = await cropModule();
  assert.equal(
    await cropSelectionToImage({
      pageId: seeded.pageId,
      shape: "rect",
      box: { x: 20, y: 30, w: 50, h: 50 },
    }),
    false,
  );
  assert.equal(useEditor.getState().pages[0].elements[0].style.crop, undefined);
});
