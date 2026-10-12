/**
 * Non-destructive image cropping — the geometry behind BOTH crop entry points
 * (the Crop tool's drag and «قص التحديد» from a marquee), which the module
 * itself had no test for.
 *
 * What is pinned here, and the failure each case prevents:
 *
 *   · a stored crop is clamped to its source, so a hand-edited or migrated
 *     document can never produce a source window outside the bitmap;
 *   · cover/contain/fill place the artwork predictably, including object
 *     position, because that placement is what the author sees while cropping;
 *   · a region drawn on the page maps through the element's REAL affine
 *     transform (rotation, flip, group ancestry), so a rotated or grouped image
 *     crops where the author drew;
 *   · a region hanging off the visible artwork crops the overlap instead of
 *     blanking the bitmap, and a sub-minimum region is refused rather than
 *     stored as a sliver.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_CROP_MM,
  cropFromLocalBox,
  cropLocalPoint,
  cropPagePoint,
  cropSceneTransform,
  croppedFrame,
  imageCropTransform,
  imageLayout,
  normalizeCrop,
  planRegionCrop,
  sameCropTransform,
  type ImageCrop,
} from "./image-crop.ts";
import type { CanvasEl } from "./model.ts";

const el = (over: Partial<CanvasEl> = {}): CanvasEl =>
  ({
    id: "img",
    type: "image",
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    style: {},
    ...over,
  }) as CanvasEl;

/* ── normalizeCrop ─────────────────────────────────────────────────────── */

test("a valid crop is kept exactly as stored", () => {
  const crop: ImageCrop = { sourceW: 1000, sourceH: 500, x: 100, y: 50, w: 400, h: 200 };
  assert.deepEqual(normalizeCrop(crop), crop);
});

test("garbage crops are rejected instead of reaching the renderer", () => {
  for (const value of [
    undefined,
    null,
    42,
    "crop",
    {},
    { sourceW: 0, sourceH: 100, x: 0, y: 0, w: 10, h: 10 },
    { sourceW: 100, sourceH: 100, x: 0, y: 0, w: 0, h: 10 },
    { sourceW: 100, sourceH: 100, x: 0, y: 0, w: 10, h: -1 },
    { sourceW: 100, sourceH: 100, x: Number.NaN, y: 0, w: 10, h: 10 },
    { sourceW: 100, sourceH: 100, x: 0, y: 0, w: 10 },
  ]) {
    assert.equal(normalizeCrop(value), undefined, JSON.stringify(value));
  }
});

test("an out-of-range window is clamped inside the source, never outside", () => {
  const clamped = normalizeCrop({
    sourceW: 100,
    sourceH: 80,
    x: -20,
    y: 200,
    w: 500,
    h: 500,
  })!;
  assert.equal(clamped.x, 0);
  assert.ok(Math.abs(clamped.y - (80 - 0.01)) < 1e-9, "y is pulled back to the last visible row");
  assert.equal(clamped.w, 100, "width cannot exceed the source");
  assert.ok(clamped.h > 0 && clamped.h < 0.02, "height is bounded by the clamped origin");
  assert.ok(clamped.x + clamped.w <= 100 + 1e-9);
  assert.ok(clamped.y + clamped.h <= 80 + 1e-9);
});

/* ── imageLayout ───────────────────────────────────────────────────────── */

test("cover fills the frame and lets the overflow hang outside", () => {
  /* 2:1 artwork in a 1:1 frame: cover scales by height, so the width overflows. */
  const layout = imageLayout({ w: 100, h: 100 }, { w: 200, h: 100 });
  assert.equal(layout.w, 200);
  assert.equal(layout.h, 100);
  assert.equal(layout.x, -50, "centred by default: half the overflow each side");
  assert.equal(layout.y, 0);
});

test("contain fits the artwork inside the frame with letterboxing", () => {
  const layout = imageLayout({ w: 100, h: 100 }, { w: 200, h: 100 }, undefined, "contain");
  assert.equal(layout.w, 100);
  assert.equal(layout.h, 50);
  assert.equal(layout.x, 0);
  assert.equal(layout.y, 25, "centred vertically");
});

test("fill stretches each axis independently", () => {
  const layout = imageLayout({ w: 100, h: 100 }, { w: 200, h: 100 }, undefined, "fill");
  assert.equal(layout.w, 100);
  assert.equal(layout.h, 100);
  assert.equal(layout.scaleX, 0.5);
  assert.equal(layout.scaleY, 1);
});

test("object position moves the artwork across the frame", () => {
  const left = imageLayout({ w: 100, h: 100 }, { w: 200, h: 100 }, undefined, "cover", 0, 0);
  const right = imageLayout({ w: 100, h: 100 }, { w: 200, h: 100 }, undefined, "cover", 100, 100);
  assert.ok(Math.abs(left.x) < 1e-9, "0% pins the left edge to the frame");
  assert.equal(right.x, -100, "100% pins the right edge");
  assert.ok(Math.abs(left.y) < 1e-9);
  assert.ok(Math.abs(right.y) < 1e-9);
});

test("a stored crop replaces the whole-source window", () => {
  const crop: ImageCrop = { sourceW: 1000, sourceH: 1000, x: 0, y: 0, w: 500, h: 500 };
  const layout = imageLayout({ w: 100, h: 100 }, { w: 1000, h: 1000 }, crop);
  assert.deepEqual(layout.window, crop, "the crop window is copied through");
  assert.equal(layout.w, 100, "a square crop in a square frame needs no overflow");
  assert.equal(layout.h, 100);
});

/* ── cropFromLocalBox ──────────────────────────────────────────────────── */

test("cropping to the visible frame reproduces the window unchanged", () => {
  const crop: ImageCrop = { sourceW: 800, sourceH: 600, x: 100, y: 60, w: 400, h: 300 };
  const layout = imageLayout({ w: 200, h: 150 }, { w: 800, h: 600 }, crop);
  /* The artwork exactly fills this frame, so the visible box is the frame. */
  const next = cropFromLocalBox({ x: layout.x, y: layout.y, w: layout.w, h: layout.h }, layout);
  assert.ok(Math.abs(next.x - crop.x) < 1e-9);
  assert.ok(Math.abs(next.y - crop.y) < 1e-9);
  assert.ok(Math.abs(next.w - crop.w) < 1e-9);
  assert.ok(Math.abs(next.h - crop.h) < 1e-9);
});

test("cropping half the frame halves the stored source window", () => {
  const source = { w: 400, h: 400 };
  const layout = imageLayout({ w: 100, h: 100 }, source);
  const next = cropFromLocalBox({ x: 0, y: 0, w: 50, h: 50 }, layout);
  assert.deepEqual(next, { sourceW: 400, sourceH: 400, x: 0, y: 0, w: 200, h: 200 });
});

/* ── croppedFrame ──────────────────────────────────────────────────────── */

test("a crop that keeps the frame centred does not move the element", () => {
  const frame = { x: 10, y: 20, w: 100, h: 100, rotation: 0 };
  const next = croppedFrame(frame, { x: 25, y: 25, w: 50, h: 50 });
  assert.ok(Math.abs(next.x - 35) < 1e-9);
  assert.ok(Math.abs(next.y - 45) < 1e-9);
  assert.equal(next.w, 50);
  assert.equal(next.h, 50);
});

test("the visual crop centre stays put under rotation", () => {
  const frame = { x: 0, y: 0, w: 200, h: 100, rotation: 90 };
  const box = { x: 40, y: 30, w: 60, h: 40 };
  const next = croppedFrame(frame, box);
  /* The new frame must still be centred on the SAME page point the box had. */
  const before = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const after = { x: next.x + next.w / 2, y: next.y + next.h / 2 };
  const centre = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
  const rotate = (p: { x: number; y: number }) => {
    const radians = (frame.rotation * Math.PI) / 180;
    return {
      x: centre.x + (p.x - centre.x) * Math.cos(radians) - (p.y - centre.y) * Math.sin(radians),
      y: centre.y + (p.x - centre.x) * Math.sin(radians) + (p.y - centre.y) * Math.cos(radians),
    };
  };
  const expected = rotate({
    x: centre.x + (box.x + box.w / 2 - frame.w / 2),
    y: centre.y + (box.y + box.h / 2 - frame.h / 2),
  });
  assert.ok(Math.abs(after.x - expected.x) < 1e-9, `x ${after.x} vs ${expected.x}`);
  assert.ok(Math.abs(after.y - expected.y) < 1e-9, `y ${after.y} vs ${expected.y}`);
  assert.notDeepEqual(before, after, "a rotated crop really does move the frame");
});

test("a flipped element mirrors the crop offset", () => {
  const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
  const box = { x: 10, y: 50, w: 20, h: 20 };
  const plain = croppedFrame(frame, box);
  const mirrored = croppedFrame(frame, box, true, false);
  assert.equal(plain.x, 10);
  const plainCentre = plain.x + plain.w / 2;
  const mirroredCentre = mirrored.x + mirrored.w / 2;
  assert.equal(mirroredCentre, 100 - plainCentre, "the crop centre mirrors about the frame centre");
  assert.equal(mirrored.x, 70);
  assert.equal(plain.y, mirrored.y, "vertical flip is off in both");
});

/* ── affine transforms ─────────────────────────────────────────────────── */

test("an unrotated leaf maps local coordinates through its own origin", () => {
  const matrix = imageCropTransform([el({ x: 10, y: 20, w: 100, h: 50 })], "img")!;
  assert.deepEqual(matrix, { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  assert.deepEqual(cropPagePoint(matrix, { x: 0, y: 0 }), { x: 10, y: 20 });
  assert.deepEqual(cropPagePoint(matrix, { x: 100, y: 50 }), { x: 110, y: 70 });
});

test("page and local point mapping are exact inverses", () => {
  const matrix = imageCropTransform([
    el({ x: 30, y: 40, w: 120, h: 60, rotation: 37 }),
  ], "img")!;
  for (const point of [
    { x: 0, y: 0 },
    { x: 12.5, y: 33.25 },
    { x: 120, y: 60 },
  ]) {
    const page = cropPagePoint(matrix, point);
    const back = cropLocalPoint(matrix, page);
    assert.ok(Math.abs(back.x - point.x) < 1e-9, `${point.x} → ${back.x}`);
    assert.ok(Math.abs(back.y - point.y) < 1e-9, `${point.y} → ${back.y}`);
  }
});

test("a 90° rotation maps the local origin onto the rotated corner", () => {
  const matrix = imageCropTransform([
    el({ x: 10, y: 20, w: 100, h: 50, rotation: 90 }),
  ], "img")!;
  assert.ok(Math.abs(matrix.e - 85) < 1e-9, `e ${matrix.e}`);
  assert.ok(Math.abs(matrix.f - -5) < 1e-9, `f ${matrix.f}`);
});

test("a child inherits its group's transform", () => {
  const group = el({
    id: "g",
    x: 10,
    y: 10,
    w: 200,
    h: 200,
    rotation: 0,
    children: [el({ id: "child", x: 20, y: 30, w: 40, h: 20 })],
  });
  const child = imageCropTransform([group], "child")!;
  /* Group origin + child origin: a nested element's page position is relative. */
  assert.deepEqual(cropPagePoint(child, { x: 0, y: 0 }), { x: 30, y: 40 });
});

test("an isolated group is entered without its own rotation", () => {
  const group = el({
    id: "g",
    x: 10,
    y: 10,
    w: 200,
    h: 200,
    rotation: 90,
    children: [el({ id: "child", x: 20, y: 30, w: 40, h: 20 })],
  });
  const rotated = imageCropTransform([group], "child")!;
  const isolated = cropSceneTransform([group], "child", "g")!;
  assert.notDeepEqual(
    cropPagePoint(rotated, { x: 0, y: 0 }),
    cropPagePoint(isolated, { x: 0, y: 0 }),
    "entering the group must drop its rotation, exactly as the canvas renders it",
  );
  assert.deepEqual(
    cropPagePoint(isolated, { x: 0, y: 0 }),
    { x: 30, y: 40 },
    "…and land on the unrotated editing frame",
  );
});

test("a transform is compared with a tolerance, not bit-exactness", () => {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
  assert.ok(sameCropTransform(matrix, matrix));
  assert.ok(sameCropTransform({ ...matrix, e: 10 + 1e-12 }, matrix));
  assert.ok(!sameCropTransform({ ...matrix, e: 10.01 }, matrix));
  assert.ok(!sameCropTransform(undefined, matrix));
});

/* ── planRegionCrop ────────────────────────────────────────────────────── */

test("a marquee region over an unrotated image crops exactly that region", () => {
  const plan = planRegionCrop({
    el: el({ x: 0, y: 0, w: 100, h: 100 }),
    source: { w: 1000, h: 1000 },
    region: { x: 0, y: 0, w: 50, h: 50 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  })!;
  assert.deepEqual(plan.box, { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(plan.crop, { sourceW: 1000, sourceH: 1000, x: 0, y: 0, w: 500, h: 500 });
  /* The cropped frame sits exactly where the region was drawn: the artwork the
   * author selected does not jump across the page when the crop lands. */
  assert.deepEqual(plan.frame, { x: 0, y: 0, w: 50, h: 50 });
});

test("a region hanging off the artwork crops the visible overlap, never blanks it", () => {
  const plan = planRegionCrop({
    el: el({ x: 0, y: 0, w: 100, h: 100 }),
    source: { w: 100, h: 100 },
    /* Half of the region is outside the element. */
    region: { x: 80, y: 0, w: 60, h: 40 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  })!;
  assert.deepEqual(plan.box, { x: 80, y: 0, w: 20, h: 40 });
  assert.equal(plan.crop.w, 20, "the stored window matches the visible sliver");
});

test("a crop smaller than the floor is refused instead of stored as a sliver", () => {
  const plan = planRegionCrop({
    el: el({ x: 0, y: 0, w: 100, h: 100 }),
    source: { w: 100, h: 100 },
    region: { x: 10, y: 10, w: MIN_CROP_MM / 2, h: MIN_CROP_MM / 2 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  });
  assert.equal(plan, null);
});

test("a region entirely in the letterbox of a contained image is refused", () => {
  const plan = planRegionCrop({
    el: el({ x: 0, y: 0, w: 100, h: 100 }),
    /* contain: a 2:1 artwork in a square frame fits to 100×50, leaving 25mm of
     * empty frame above and below it. */
    source: { w: 200, h: 100 },
    fit: "contain",
    /* A region drawn in that empty band sees no artwork at all. */
    region: { x: 20, y: 90, w: 10, h: 5 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  });
  assert.equal(plan, null);
});

test("a rotated image crops where the author drew, using all four corners", () => {
  const rotation = 45;
  const transform = imageCropTransform([
    el({ x: 0, y: 0, w: 100, h: 100, rotation }),
  ], "img")!;
  const plan = planRegionCrop({
    el: el({ x: 0, y: 0, w: 100, h: 100, rotation }),
    source: { w: 100, h: 100 },
    region: { x: 20, y: 20, w: 30, h: 30 },
    transform,
  })!;
  /* In the element's own frame a page-axis square is a rotated quad: its
   * bounding box is wider than the region itself (30 × √2). */
  const diagonal = 30 * Math.SQRT2;
  assert.ok(
    plan.box.w > 30 && plan.box.w <= diagonal + 1e-6,
    `bounding width ${plan.box.w} should exceed the region but not the diagonal`,
  );
  assert.ok(Math.abs(plan.box.w - plan.box.h) < 1e-6, "a square region stays square");
  assert.ok(plan.box.x >= 0 && plan.box.y >= 0, "the box stays inside the artwork");
});

test("a flipped image crops the mirrored region", () => {
  const transform = imageCropTransform([
    el({ x: 0, y: 0, w: 100, h: 100, style: { flipX: true } }),
  ], "img")!;
  const plan = planRegionCrop({
    el: el({ x: 0, y: 0, w: 100, h: 100, style: { flipX: true } }),
    source: { w: 100, h: 100 },
    flipX: true,
    region: { x: 0, y: 0, w: 20, h: 100 },
    transform,
  })!;
  assert.deepEqual(plan.box, { x: 80, y: 0, w: 20, h: 100 }, "the left of the page is the right of the source");
});

test("a source with no usable dimensions is refused before any maths", () => {
  const transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  assert.equal(
    planRegionCrop({
      el: el(),
      source: { w: 0, h: 100 },
      region: { x: 0, y: 0, w: 50, h: 50 },
      transform,
    }),
    null,
  );
});
