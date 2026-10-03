import assert from "node:assert/strict";
import { test } from "node:test";
import { screenToDocument } from "./document-space.ts";
import {
  cropFromLocalBox,
  cropSceneTransform,
  cropLocalPoint,
  cropPagePoint,
  imageLayout,
  normalizeCrop,
  planRegionCrop,
} from "./image-crop.ts";
import type { CanvasEl } from "./model.ts";

const image = (over: Partial<CanvasEl> = {}): CanvasEl =>
  ({
    id: "img",
    type: "image",
    name: "صورة",
    x: 50,
    y: 60,
    w: 100,
    h: 80,
    rotation: 0,
    opacity: 1,
    z: 1,
    style: {},
    ...over,
  }) as CanvasEl;

/** Screen rect → page mm for the same artboard painted at 3 different zooms. */
test("pointer → document millimetres is correct at any zoom, pan or scroll", () => {
  const size = { w: 210, h: 297 };
  // 25% zoom, scrolled: the artboard is painted smaller and offset.
  const zoomedOut = { left: 120, top: 40, width: 210 * 0.25 * 3.7795, height: 297 * 0.25 * 3.7795 };
  const centreX = zoomedOut.left + zoomedOut.width / 2;
  const centreY = zoomedOut.top + zoomedOut.height / 2;
  const centre = screenToDocument(zoomedOut, size, centreX, centreY);
  assert.ok(Math.abs(centre.x - 105) < 1e-6);
  assert.ok(Math.abs(centre.y - 148.5) < 1e-6);
  // The top-left painted pixel is document 0,0 in every case.
  assert.deepEqual(screenToDocument(zoomedOut, size, zoomedOut.left, zoomedOut.top), {
    x: 0,
    y: 0,
  });
  // A 400% zoom of the same page: the same FRACTION of the artboard.
  const zoomedIn = { left: -900, top: -2200, width: 210 * 4 * 3.7795, height: 297 * 4 * 3.7795 };
  const quarter = screenToDocument(
    zoomedIn,
    size,
    zoomedIn.left + zoomedIn.width / 4,
    zoomedIn.top + zoomedIn.height / 4,
  );
  assert.ok(Math.abs(quarter.x - 52.5) < 1e-6);
  assert.ok(Math.abs(quarter.y - 74.25) < 1e-6);
  // A degenerate rect (unmounted page) must not produce NaN geometry.
  assert.deepEqual(screenToDocument({ left: 0, top: 0, width: 0, height: 0 }, size, 10, 10), {
    x: 0,
    y: 0,
  });
});

test("crop from a page region keeps the visual centre of the selection", () => {
  const el = image();
  const source = { w: 1000, h: 800 };
  const transform = cropSceneTransform([el], el.id, null)!;
  const plan = planRegionCrop({
    el,
    source,
    region: { x: 70, y: 80, w: 40, h: 40 },
    transform,
  });
  assert.ok(plan);
  // The cropped frame covers exactly the region the author drew.
  assert.deepEqual(plan.frame, { x: 70, y: 80, w: 40, h: 40 });
  // 100mm of frame maps to 1000px of source: 40mm → 400px.
  assert.ok(Math.abs(plan.crop.w - 400) < 0.01);
  assert.ok(Math.abs(plan.crop.h - 400) < 0.01);
  assert.equal(plan.crop.sourceW, 1000);
});

test("a region hanging off the image crops the visible overlap, never a broken bitmap", () => {
  const el = image();
  const source = { w: 1000, h: 800 };
  const transform = cropSceneTransform([el], el.id, null)!;
  const plan = planRegionCrop({
    el,
    source,
    region: { x: 100, y: 100, w: 200, h: 200 },
    transform,
  });
  assert.ok(plan);
  assert.deepEqual(plan.frame, { x: 100, y: 100, w: 50, h: 40 });
  assert.ok(plan.crop.w <= 1000 && plan.crop.h <= 800);
  assert.ok(plan.crop.w > 0 && plan.crop.h > 0);
  // Entirely outside → refused, so the document is never touched.
  assert.equal(
    planRegionCrop({
      el,
      source,
      region: { x: 200, y: 200, w: 50, h: 50 },
      transform,
    }),
    null,
  );
  // Sub-millimetre slivers are refused as well.
  assert.equal(
    planRegionCrop({
      el,
      source,
      region: { x: 60, y: 70, w: 0.2, h: 30 },
      transform,
    }),
    null,
  );
});

test("a rotated image crops where the author drew, not where the box is", () => {
  const el = image({ rotation: 90 });
  const source = { w: 800, h: 800 };
  const transform = cropSceneTransform([el], el.id, null)!;
  // In page space a 90°-rotated element's local +x axis points down.
  const localTopLeft = cropPagePoint(transform, { x: 0, y: 0 });
  const back = cropLocalPoint(transform, localTopLeft);
  assert.ok(Math.abs(back.x) < 1e-9 && Math.abs(back.y) < 1e-9);
  const plan = planRegionCrop({
    el,
    source,
    region: { x: el.x + el.w / 2 - 10, y: el.y + el.h / 2 - 10, w: 20, h: 20 },
    transform,
  });
  assert.ok(plan);
  assert.ok(Math.abs(plan.crop.w - plan.crop.h) < 0.01);
  assert.ok(Math.abs(plan.crop.w - (20 * 800) / 100) < 1);
});

test("crop numbers stay consistent with the non-destructive crop window", () => {
  const el = image();
  const source = { w: 1000, h: 800 };
  const layout = imageLayout(el, source, el.style.crop, "cover");
  const crop = cropFromLocalBox({ x: 0, y: 0, w: 100, h: 80 }, layout);
  assert.deepEqual(crop, { sourceW: 1000, sourceH: 800, x: 0, y: 0, w: 1000, h: 800 });
  // And a stored crop round-trips through normalisation unchanged.
  assert.deepEqual(normalizeCrop(crop), crop);
});
