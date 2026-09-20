/**
 * NASAQ Editor — tests for the gesture math in `transform.ts`:
 * Shift-based proportional resizing and zoom-aware snapping.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MIN_SIZE,
  type CanvasEl,
} from "./model.ts";
import { applySnap, resizeByHandle, snapThresholdMm } from "./transform.ts";

function box(x: number, y: number, w: number, h: number): CanvasEl {
  return {
    id: "t1",
    type: "shape",
    name: "test",
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    z: 1,
    style: {},
  };
}

function resize(orig: CanvasEl, handle: string, dx: number, dy: number, shift: boolean): CanvasEl {
  const next = { ...orig };
  resizeByHandle(next, orig, handle, dx, dy, shift || orig.style.aspectLock === true);
  return next;
}

test("plain corner drag resizes freely without ratio constraints", () => {
  const next = resize(box(10, 10, 40, 20), "se", 30, 60, false);
  assert.equal(next.w, 70);
  assert.equal(next.h, 80);
  assert.equal(next.x, 10);
  assert.equal(next.y, 10);
});

test("plain edge drag changes one axis only", () => {
  const next = resize(box(10, 10, 40, 20), "e", -10, 99, false);
  assert.equal(next.w, 30);
  assert.equal(next.h, 20);
});

test("plain drag honours MIN_SIZE on both axes", () => {
  const next = resize(box(10, 10, 40, 40), "se", -500, -500, false);
  assert.equal(next.w, MIN_SIZE);
  assert.equal(next.h, MIN_SIZE);
  assert.equal(next.x, 10);
  assert.equal(next.y, 10);
});

test("west/north drags keep the opposite edge anchored", () => {
  const next = resize(box(10, 10, 40, 40), "nw", 5, 6, false);
  assert.equal(next.x, 15);
  assert.equal(next.y, 16);
  assert.equal(next.w, 35);
  assert.equal(next.h, 34);
});

test("shift + corner preserves the element's own aspect ratio", () => {
  const square = resize(box(0, 0, 40, 40), "se", 40, 10, true);
  assert.equal(square.w, 80);
  assert.equal(square.h, 80, "square stays square");

  // Height leads (dy=40 on a 50mm box is a 1.8x move; dx=0 is 1.0x), so the
  // width follows at the locked 2:1 ratio.
  const wide = resize(box(0, 0, 100, 50), "se", 0, 40, true);
  assert.equal(wide.w, 180);
  assert.equal(wide.h, 90, "movement on the minor axis still scales from the dominant axis");
});

test("shift resize keeps a circle circular and an image proportional", () => {
  const circle = box(0, 0, 60, 60);
  circle.style.shapeId = "circle";
  const next = resize(circle, "se", -20, 5, true);
  assert.equal(next.w, next.h, "circle remains a circle");
  assert.equal(next.w, 40);

  const image = box(0, 0, 80, 40);
  image.type = "image";
  image.src = "data:";
  // ne: dx=-20 (0.75x) with dy=-10 (0.75x) — width leads the tie, height follows.
  const imgNext = resize(image, "ne", -20, -10, true);
  assert.equal(imgNext.w, 60);
  assert.ok(Math.abs(imgNext.h - 30) < 1e-9, "image keeps 2:1 aspect ratio");
});

test("shift resize does not distort star/polygon shapes with ideal ratios", () => {
  const star = box(0, 0, 50, 50);
  star.style.shapeId = "star5";
  const next = resize(star, "se", 25, 25, true);
  assert.equal(next.w, next.h, "a square star scales uniformly, no golden-ratio constant");
});

test("shift resize anchors the opposite corner and can centre edges", () => {
  const next = resize(box(10, 10, 40, 20), "nw", -20, 0, true);
  // Width grows by 20 => height grows by 10 (2:1), anchored at se corner.
  assert.equal(next.x + next.w, 50);
  assert.equal(next.y + next.h, 30);
  assert.equal(next.w, 60);
  assert.equal(next.h, 30);

  const fromEdge = resize(box(10, 10, 40, 20), "n", 0, -10, true);
  assert.equal(fromEdge.w, 60, "1.5x vertical move scales width to match");
  assert.equal(fromEdge.x, 10 + (40 - 60) / 2, "pure n/s resize stays centred horizontally");
});

test("aspectLock preserves the ratio without Shift", () => {
  const locked = box(0, 0, 60, 30);
  locked.style.aspectLock = true;
  const next = resize(locked, "se", 0, 60, false);
  assert.equal(next.w, 180, "3x vertical move, width follows the locked 2:1 ratio");
  assert.equal(next.h, 90);
});

test("proportional scaling never flips the box through its minimum", () => {
  const next = resize(box(0, 0, 40, 40), "se", -1000, 0, true);
  assert.equal(next.w, MIN_SIZE);
  assert.equal(next.h, MIN_SIZE);
  assert.ok(next.x >= 0, "west edge never crosses the anchored east edge");
});

test("snap threshold scales inversely with zoom (screen-space constant)", () => {
  const at100 = snapThresholdMm(1);
  const at200 = snapThresholdMm(2);
  const at50 = snapThresholdMm(0.5);
  assert.ok(Math.abs(at200 - at100 / 2) < 1e-9);
  assert.ok(Math.abs(at50 - at100 * 2) < 1e-9);
  // Degenerate zoom falls back to 1 rather than exploding.
  assert.equal(snapThresholdMm(0), at100);
  assert.equal(snapThresholdMm(-3), at100);
});

test("smart snapping aligns to other elements and the artboard", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 100, w: 50, h: 40 }];

  // Element centre 5mm right of page centre at zoom 1 (threshold ~1.85mm) —
  // out of range, no snap.
  const free = box(108, 50, 20, 20);
  const none = applySnap(free, others, size, false, true, 1, {});
  assert.deepEqual(none, { v: [], h: [] });
  assert.equal(free.x, 108);

  // Left edge within threshold of a neighbour's left edge.
  const near = box(101.2, 50, 20, 20);
  const hit = applySnap(near, others, size, false, true, 1, {});
  assert.deepEqual(hit.v, [100]);
  assert.equal(near.x, 100);

  // Centre snaps to the artboard's vertical centre line.
  const centre = box(94.2, 0, 20, 20);
  const centreHit = applySnap(centre, [], size, false, true, 1, {});
  assert.deepEqual(centreHit.v, [105]);
  assert.equal(centre.x + centre.w / 2, 105, "the element's centre lands on the artboard centre");
});

test("snapping ignores elements moving with the gesture", () => {
  const size = { w: 210, h: 297 };
  const el = box(101, 50, 20, 20);
  const guides = applySnap(el, [{ id: "peer", x: 100, y: 0, w: 30, h: 30 }], size, false, true, 1, {
    peer: true,
  });
  assert.deepEqual(guides, { v: [], h: [] });
  assert.equal(el.x, 101);
});

test("grid snap rounds to the document grid", () => {
  const size = { w: 210, h: 297 };
  const el = box(7, 13, 20, 20);
  applySnap(el, [], size, true, false, 1, {});
  assert.equal(el.x, 5);
  assert.equal(el.y, 15);
});
