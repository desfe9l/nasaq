import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cropSceneTransform } from "./image-crop.ts";
import { createElement, type CanvasEl } from "./model.ts";
import { useEditor } from "./store.ts";
import { createProject } from "./templates.ts";

/**
 * End-to-end stroke engine tests against a REAL rasterizer.
 *
 * `scripts/test-canvas-harness.mjs` puts a Skia canvas behind
 * `document.createElement("canvas")` inside jsdom, so the engine rasterizes
 * exactly as it does in the browser and these assertions read the pixels of the
 * PNG it commits — brush colour, erased alpha, protected neighbours, rotation.
 * The transforms come from the same `cropSceneTransform` the canvas component
 * uses, so a rotated element is verified through production math.
 *
 * One source of truth for the pixels: when Skia is unavailable the suite skips
 * with a reason rather than passing on a stub.
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
  ): Promise<{ image: unknown; at(x: number, y: number): number[] }>;
}

const { installCanvasHarness } = (await import(
  new URL("../../../scripts/test-canvas-harness.mjs", import.meta.url).href
)) as { installCanvasHarness: () => Promise<Harness | null> };
const harness = await installCanvasHarness();
const skip = harness
  ? false
  : "canvas harness unavailable (@napi-rs/canvas not installed)";

const RED = "#ff0000";
const BLUE = { r: 0, g: 0, b: 255 };

const imageElement = (over: Partial<CanvasEl> = {}): CanvasEl =>
  ({
    id: "img",
    type: "image",
    name: "صورة",
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    rotation: 0,
    opacity: 1,
    z: 1,
    style: {},
    ...over,
  }) as CanvasEl;

/** 200×200 artwork that covers a 50 mm frame — 4 source px per millimetre. */
function artwork() {
  return harness!.createImage(200, 200, (ctx) => {
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, 200, 200);
  });
}

async function strokeFor(
  mode: "brush" | "eraser",
  el: CanvasEl,
  over: Record<string, unknown> = {},
) {
  const { RasterStroke } = await import("./raster-session.ts");
  const image = artwork();
  const stroke = new RasterStroke({
    pageId: "p1",
    pageNode: harness!.host(),
    pxPerMm: 4,
    mode,
    sizeMm: 5,
    hardness: 1,
    opacity: 1,
    smoothing: 0,
    color: BLUE,
    target: { el, image, source: { w: 200, h: 200 } },
    page: { w: 210, h: 297 },
    transform: cropSceneTransform([el], el.id, null)!,
    ...over,
  });
  return { stroke, el };
}

test("brush stroke paints the committed PNG, live preview included", { skip }, async () => {
  const { stroke } = await strokeFor("brush", imageElement());
  // 50 mm frame over a 200 px source = 4 px/mm: the middle of the frame is the
  // middle of the bitmap.
  assert.equal(stroke.paint({ x: 25, y: 25 }), true);
  assert.equal(stroke.paint({ x: 30, y: 25 }), true);
  // The author sees the stroke BEFORE the document is touched.
  const host = document.querySelector<HTMLElement>(".raster-stroke-layer");
  assert.ok(host, "overlay canvas must exist during the stroke");
  assert.ok(host!.querySelector("canvas"), "overlay holds a real canvas");
  assert.equal(host!.style.left, "0mm");
  assert.equal(host!.style.width, "50mm");

  const patch = stroke.commit()!;
  assert.ok(patch.src?.startsWith("data:image/png"));
  assert.equal(patch.layer, undefined, "an existing image is edited in place");
  const pixels = await harness!.pixelsOf(patch.src!, 200, 200);
  const painted = pixels.at(100, 100);
  assert.ok(painted[2]! > 200, "blue channel of the painted pixel");
  assert.ok(painted[0]! < 60, "red channel replaced by the brush colour");
  assert.equal(painted[3], 255, "opaque artwork stays opaque");
  // 5 mm brush at 4 px/mm covers ±10 px; far away the artwork is untouched.
  assert.deepEqual(pixels.at(10, 10), [255, 0, 0, 255]);
  assert.equal(document.querySelector(".raster-stroke-layer"), null);
});

test("eraser removes alpha and leaves real transparency behind", { skip }, async () => {
  const { stroke } = await strokeFor("eraser", imageElement());
  stroke.paint({ x: 25, y: 25 });
  const patch = stroke.commit()!;
  const pixels = await harness!.pixelsOf(patch.src!, 200, 200);
  assert.equal(pixels.at(100, 100)[3], 0, "erased pixel is fully transparent");
  assert.equal(pixels.at(10, 10)[3], 255, "the rest of the bitmap survives");
});

test("the eraser never paints outside the artwork it targets", { skip }, async () => {
  const el = imageElement({
    style: {
      crop: { sourceW: 200, sourceH: 200, x: 50, y: 50, w: 100, h: 100 },
    },
  });
  const { stroke } = await strokeFor("eraser", el);
  // Off the element entirely → nothing painted, nothing to undo.
  assert.equal(stroke.paint({ x: -20, y: -20 }), false);
  assert.equal(stroke.painted, false);
  assert.equal(stroke.commit(), null);
});

test("a committed patch carries pixels only — never geometry", { skip }, async () => {
  const el = imageElement({ x: 40, y: 60, w: 80, h: 40, rotation: 30 });
  const { stroke } = await strokeFor("brush", el);
  // The element centre, through the production transform.
  const t = cropSceneTransform([el], el.id, null)!;
  const centre = {
    x: t.a * (el.w / 2) + t.c * (el.h / 2) + t.e,
    y: t.b * (el.w / 2) + t.d * (el.h / 2) + t.f,
  };
  assert.equal(stroke.paint(centre), true);
  const patch = stroke.commit()!;
  assert.ok(patch.src?.startsWith("data:image/png"));
  // Only pixels: no x/y/w/h/rotation, and no new element either.
  for (const key of ["x", "y", "w", "h", "rotation", "layer"]) {
    assert.equal(key in patch, false, `patch must not carry ${key}`);
  }
});

test("a rotated element paints where the pointer is, not where its box is", { skip }, async () => {
  const el = imageElement({ rotation: 90, x: 0, y: 0 });
  const t = cropSceneTransform([el], el.id, null)!;
  const { stroke } = await strokeFor("brush", el);
  // Local (25 mm, 2 mm) — inside the rotated frame, through production math.
  const point = { x: t.a * 25 + t.c * 2 + t.e, y: t.b * 25 + t.d * 2 + t.f };
  assert.equal(stroke.paint(point), true);
  const patch = stroke.commit()!;
  const pixels = await harness!.pixelsOf(patch.src!, 200, 200);
  const painted = pixels.at(100, 8);
  assert.ok(painted[2]! > 150, "painted along the rotated local axis");
  assert.deepEqual(pixels.at(8, 100), [255, 0, 0, 255], "the rest is red");
});

test("painting on empty canvas creates a raster layer sized to the stroke", { skip }, async () => {
  const { RasterStroke } = await import("./raster-session.ts");
  const stroke = new RasterStroke({
    pageId: "p1",
    pageNode: harness!.host(),
    pxPerMm: 4,
    mode: "brush",
    sizeMm: 6,
    hardness: 1,
    opacity: 1,
    smoothing: 0,
    color: BLUE,
    target: null,
    page: { w: 210, h: 297 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  });
  stroke.paint({ x: 100, y: 100 });
  stroke.paint({ x: 120, y: 100 });
  const patch = stroke.commit()!;
  assert.ok(patch.layer, "a new layer, not an edit");
  const layer = patch.layer!;
  // Geometry is the stroke's own bounds in page mm, padded by the brush: the
  // stroke is 20 mm long and the brush 6 mm wide.
  assert.ok(layer.w >= 20 && layer.w <= 30, `layer width ${layer.w}`);
  assert.ok(layer.h >= 6 && layer.h <= 14, `layer height ${layer.h}`);
  assert.ok(layer.x < 100 && layer.x + layer.w > 120);
  const px = 8; // RASTER_LAYER_PX_PER_MM
  const width = Math.round(layer.w * px);
  const height = Math.round(layer.h * px);
  const pixels = await harness!.pixelsOf(layer.src, width, height);
  // The stroke's start, in the new bitmap's own pixels.
  const startX = Math.round((100 - layer.x) * px);
  assert.ok(pixels.at(startX, Math.round(height / 2))[2]! > 200);
  assert.equal(pixels.at(0, 0)[3], 0, "unpainted corners stay transparent");
});

test("a stroke with no movement still commits as a stamp", { skip }, async () => {
  const { stroke } = await strokeFor("brush", imageElement());
  assert.equal(stroke.paint({ x: 25, y: 25 }), true);
  const patch = stroke.commit()!;
  const pixels = await harness!.pixelsOf(patch.src!, 200, 200);
  assert.equal(pixels.at(100, 100)[3], 255);
  assert.ok(pixels.at(100, 100)[2]! > 200);
});

test("cancel leaves nothing behind and frees the bitmap", { skip }, async () => {
  const { stroke } = await strokeFor("brush", imageElement());
  stroke.paint({ x: 25, y: 25 });
  stroke.cancel();
  assert.equal(stroke.commit(), null);
  assert.equal(document.querySelector(".raster-stroke-layer"), null);
  assert.equal(stroke.painted, false);
});

test("the loader prefers the mounted node and decodes a data URL when alone", { skip }, async () => {
  const { loadRasterSource } = await import("./raster-session.ts");
  const src = artwork().toDataURL("image/png");

  // A node-less element with no source is refused, not guessed at.
  assert.equal(await loadRasterSource(imageElement()), null);

  // Alone, the loader decodes the committed data URL itself.
  const decoded = await loadRasterSource(imageElement({ src } as Partial<CanvasEl>));
  assert.deepEqual(decoded?.source, { w: 200, h: 200 });

  // A mounted, decoded node wins: it is the element the author is looking at,
  // even when the element's own src says something else.
  const node = await harness!.pixelsOf(src, 10, 10).then((pixels) => pixels.image);
  const mounted = await loadRasterSource(
    imageElement({ src: artwork().toDataURL("image/png") } as Partial<CanvasEl>),
    node as unknown as HTMLImageElement,
  );
  assert.deepEqual(mounted?.source, { w: 200, h: 200 });
  assert.equal(mounted?.image, node, "the decoded node is reused as-is");
});

test("a stroke is one undoable document write", { skip }, async () => {
  // The whole path CanvasStage takes on pointerup: build the patch, hand it to
  // the store once, and let history own the result.
  const page = createProject("blank").pages[0];
  const src = artwork().toDataURL("image/png");
  const el = createElement("image", {
    id: "art",
    x: 20,
    y: 30,
    w: 100,
    h: 100,
    z: 1,
    src,
    style: {},
  });
  page.elements = [el];
  useEditor.setState({
    pages: [page],
    activePageId: page.id,
    selectedIds: ["art"],
    selectedId: "art",
    enteredGroupId: null,
    past: [],
    future: [],
  });
  useEditor.getState().commit();
  const before = useEditor.getState().past.length;

  const { stroke } = await strokeFor("eraser", el);
  // The element spans page (20,30)-(120,130); the middle is page (70,80).
  assert.equal(stroke.paint({ x: 70, y: 80 }), true);
  const patch = stroke.commit()!;
  useEditor.getState().updateElement("art", patch);
  assert.equal(useEditor.getState().past.length, before + 1, "one entry");

  const painted = useEditor.getState().pages[0].elements[0].src!;
  assert.notEqual(painted, src);
  const pixels = await harness!.pixelsOf(painted, 200, 200);
  // Fully erased: alpha 0 and no colour left to fringe against a new
  // background — the same result the browser canvas produces.
  assert.deepEqual(pixels.at(100, 100), [0, 0, 0, 0]);
  assert.equal(pixels.at(20, 20)[3], 255, "the rest of the artwork is intact");

  useEditor.getState().undo();
  assert.equal(useEditor.getState().pages[0].elements[0].src, src, "undo");
  useEditor.getState().redo();
  assert.equal(useEditor.getState().pages[0].elements[0].src, painted, "redo");
});
