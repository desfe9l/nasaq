/**
 * Screen ↔ document conversion and zoom clamps.
 *
 * `screenToDocument` is the single inverse of the painted artboard: every
 * pointer gesture, hit-test, drop and insertion goes through it. A wrong
 * conversion is invisible in a screenshot and obvious only when an author
 * grabs a box and it jumps — which is why it is pinned here at several zooms,
 * including the degenerate rect (a stage that has not laid out yet) that used
 * to divide by zero.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  insertionPosition,
  screenToDocument,
  stepZoom,
  visibleDocumentRect,
} from "./document-space.ts";

const A4 = { w: 210, h: 297 };
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});

test("a point maps into page millimetres at 2 px/mm", () => {
  const page = rect(100, 50, 420, 594); // 210×297mm at 2 px/mm
  assert.deepEqual(screenToDocument(page, A4, 100, 50), { x: 0, y: 0 });
  assert.deepEqual(screenToDocument(page, A4, 310, 50), { x: 105, y: 0 });
  assert.deepEqual(screenToDocument(page, A4, 100, 50 + 594), { x: 0, y: 297 });
});

test("the conversion is exact at every zoom, including tiny and huge ones", () => {
  for (const ppm of [0.5, 1, 2, 4, 8]) {
    const page = rect(0, 0, A4.w * ppm, A4.h * ppm);
    const point = screenToDocument(page, A4, A4.w * ppm * 0.5, A4.h * ppm * 0.25);
    assert.ok(Math.abs(point.x - A4.w / 2) < 1e-9, `x at ${ppm} px/mm`);
    assert.ok(Math.abs(point.y - A4.h / 4) < 1e-9, `y at ${ppm} px/mm`);
  }
});

test("an unlaid-out box yields 0 instead of NaN", () => {
  const point = screenToDocument(rect(0, 0, 0, 0), A4, 120, 80);
  assert.deepEqual(point, { x: 0, y: 0 }, "a zero-sized box must not divide by zero");
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test("a point outside the page maps outside the page (no clamping)", () => {
  const page = rect(100, 50, 420, 594);
  const point = screenToDocument(page, A4, 90, 40);
  assert.ok(point.x < 0 && point.y < 0, "the conversion is linear everywhere");
});

test("the visible document rect is the overlap of page and viewport", () => {
  const page = rect(0, 0, 420, 594);
  const viewport = rect(0, 0, 210, 297);
  const visible = visibleDocumentRect(page, viewport, A4);
  assert.ok(visible, "there is an overlap");
  assert.equal(visible!.x, 0);
  assert.equal(visible!.y, 0);
  assert.equal(visible!.w, 105, "half the page width is visible");
  assert.equal(visible!.h, 148.5, "half the page height is visible");
});

test("no overlap means no visible rect", () => {
  assert.equal(
    visibleDocumentRect(rect(0, 0, 420, 594), rect(1000, 0, 200, 200), A4),
    null,
  );
});

test("insertion centres a box on a point", () => {
  assert.deepEqual(insertionPosition({ w: 40, h: 20 }, { x: 100, y: 100 }), {
    x: 80,
    y: 90,
  });
});

test("zoom clamps are enforced and never produce a non-finite value", () => {
  assert.equal(clampZoom(0), MIN_ZOOM);
  assert.equal(clampZoom(0.0001), MIN_ZOOM);
  assert.equal(clampZoom(1000), MAX_ZOOM);
  assert.equal(clampZoom(1.5), 1.5);
  /* Non-finite input is "no zoom information", not "as large as possible":
   * NaN/Infinity can only come from a broken measurement, and snapping such a
   * canvas to 1600% would be worse than 100%. */
  assert.equal(clampZoom(Number.NaN), 1, "garbage falls back to 100%");
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), 1, "garbage falls back to 100%");
  assert.equal(clampZoom(Number.NEGATIVE_INFINITY), 1, "garbage falls back to 100%");
});

test("zoom steps multiply by 1.2 and stop at the bounds", () => {
  assert.ok(Math.abs(stepZoom(1, 1) - 1.2) < 1e-9, "in");
  assert.ok(Math.abs(stepZoom(1, -1) - 1 / 1.2) < 1e-9, "out");
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM, "cannot exceed the ceiling");
  assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM, "cannot fall through the floor");
});
