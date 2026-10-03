import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendRegionPoint,
  aspectBox,
  aspectFitBox,
  boxIsUsable,
  clampRegionBox,
  lassoPath,
  marqueeBox,
  pointInPolygon,
  polygonBounds,
  polygonHitsBox,
  regionHitsBox,
} from "./marquee.ts";

const PAGE = { w: 210, h: 297 };

test("rectangle marquee is aspect-free and direction-free", () => {
  const downRight = marqueeBox({ startX: 10, startY: 20, endX: 50, endY: 60 });
  assert.deepEqual(downRight, { x: 10, y: 20, w: 40, h: 40 });
  // Dragging up-left produces the same rectangle, never a negative size.
  const upLeft = marqueeBox({ startX: 50, startY: 60, endX: 10, endY: 20 });
  assert.deepEqual(upLeft, downRight);
});

test("square constraint takes the LARGER delta so the pointer stays on the edge", () => {
  const box = marqueeBox({
    startX: 100,
    startY: 100,
    endX: 140,
    endY: 110,
    square: true,
  });
  assert.equal(box.w, box.h);
  assert.equal(box.w, 40);
});

test("alt draws from the centre, keeping the anchor in the middle", () => {
  const box = marqueeBox({
    startX: 100,
    startY: 100,
    endX: 120,
    endY: 130,
    fromCenter: true,
  });
  assert.deepEqual(box, { x: 80, y: 70, w: 40, h: 60 });
  // With both modifiers the square is centred too.
  const centred = marqueeBox({
    startX: 100,
    startY: 100,
    endX: 120,
    endY: 130,
    square: true,
    fromCenter: true,
  });
  assert.equal(centred.w, centred.h);
  // 1:1 takes the larger delta (30) on both axes, then mirrors it around the
  // anchor: the box spans 60mm and the anchor stays dead centre.
  assert.equal(centred.w, 60);
  assert.equal(centred.x + centred.w, 130);
  assert.equal(centred.x + centred.w / 2, 100);
});

test("a region never leaves its page", () => {
  const clamped = clampRegionBox({ x: -20, y: 280, w: 100, h: 40 }, PAGE);
  assert.deepEqual(clamped, { x: 0, y: 280, w: 80, h: 17 });
  // Fully outside → nothing, rather than a zero-size region.
  assert.equal(clampRegionBox({ x: -50, y: -50, w: 20, h: 20 }, PAGE), null);
  assert.equal(boxIsUsable(clamped), true);
  assert.equal(boxIsUsable({ x: 0, y: 0, w: 0.2, h: 30 }), false);
});

test("aspect ratios hold while dragging in either direction", () => {
  const wide = aspectBox({ startX: 0, startY: 0, endX: 160, endY: 40 }, 16 / 9);
  assert.ok(Math.abs(wide.w / wide.h - 16 / 9) < 1e-9);
  assert.equal(wide.w, 160);
  const up = aspectBox({ startX: 100, startY: 100, endX: 20, endY: 30 }, 3 / 4);
  assert.ok(Math.abs(up.w / up.h - 3 / 4) < 1e-9);
  assert.ok(up.x < 100 && up.y < 100);
});

test("ellipse hit test excludes an element that only touches the bounding box corner", () => {
  const ellipse = {
    shape: "ellipse" as const,
    box: { x: 0, y: 0, w: 100, h: 100 },
  };
  const centre = { x: 40, y: 40, w: 10, h: 10 };
  const corner = { x: 92, y: 92, w: 6, h: 6 };
  assert.equal(regionHitsBox(ellipse, centre), true);
  assert.equal(regionHitsBox(ellipse, corner), false);
});

test("lasso geometry: bounds, membership and intersection", () => {
  const points = [
    { x: 10, y: 10 },
    { x: 60, y: 10 },
    { x: 60, y: 60 },
    { x: 10, y: 60 },
  ];
  assert.deepEqual(polygonBounds(points), { x: 10, y: 10, w: 50, h: 50 });
  assert.equal(pointInPolygon(points, 30, 30), true);
  assert.equal(pointInPolygon(points, 5, 30), false);
  assert.equal(polygonHitsBox(points, { x: 40, y: 40, w: 5, h: 5 }), true);
  assert.equal(polygonHitsBox(points, { x: 100, y: 100, w: 5, h: 5 }), false);
  // A box that only CROSSES the path still counts: the lasso selects it.
  assert.equal(polygonHitsBox(points, { x: 55, y: 30, w: 40, h: 5 }), true);
  assert.match(lassoPath(points), /^M 10 10 L 60 10 L 60 60 L 10 60 Z$/);
});

test("a freehand path drops redundant samples but keeps its shape", () => {
  let points: { x: number; y: number }[] = [];
  points = appendRegionPoint(points, { x: 0, y: 0 });
  points = appendRegionPoint(points, { x: 0.05, y: 0.05 });
  points = appendRegionPoint(points, { x: 5, y: 0 });
  assert.equal(points.length, 2);
  assert.deepEqual(points[1], { x: 5, y: 0 });
});

test("lasso selection survives an arbitrary number of points", () => {
  const circle = Array.from({ length: 64 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    return { x: 50 + Math.cos(angle) * 20, y: 50 + Math.sin(angle) * 20 };
  });
  assert.equal(pointInPolygon(circle, 50, 50), true);
  assert.equal(pointInPolygon(circle, 50, 90), false);
  assert.equal(
    regionHitsBox({ shape: "lasso", box: polygonBounds(circle), points: circle }, {
      x: 48,
      y: 48,
      w: 4,
      h: 4,
    }),
    true,
  );
});

test("aspectFitBox keeps the ratio, the centre and the bounds", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 };
  // A free ratio is a no-op — «حر» never mutates the frame the author set.
  assert.deepEqual(aspectFitBox({ x: 10, y: 10, w: 40, h: 30 }, bounds, null), {
    x: 10, y: 10, w: 40, h: 30,
  });
  const square = aspectFitBox({ x: 10, y: 10, w: 40, h: 30 }, bounds, 1);
  assert.equal(Math.abs(square.w - square.h) < 1e-9, true, "1:1");
  assert.equal(square.w, 30, "the smaller axis sets the size");
  assert.equal(Math.abs(square.x + square.w / 2 - 30) < 1e-9, true, "centre kept");
  // A box larger than the artwork is cut down to the ratio AND to the bounds.
  const wide = aspectFitBox({ x: 0, y: 40, w: 200, h: 10 }, { x: 0, y: 0, w: 60, h: 200 }, 2);
  assert.equal(wide.w, 20, "the height bound sets the ratio box (shrink to fit)");
  assert.equal(wide.h, 10);
  assert.ok(wide.x >= 0 && wide.x + wide.w <= 60, "kept inside the bounds");
  // A tall ratio in a short bound yields the largest fitting ratio box.
  const tight = aspectFitBox({ x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0, w: 40, h: 10 }, 1 / 4);
  assert.ok(tight.w <= 40 && tight.h <= 10, "never larger than the bounds");
  assert.ok(Math.abs(tight.w / tight.h - 1 / 4) < 1e-9);
  // A tall target near an edge is shifted back inside, never left dangling.
  const tall = aspectFitBox({ x: 90, y: 0, w: 40, h: 80 }, bounds, 1 / 2);
  assert.ok(tall.x >= 0 && tall.x + tall.w <= bounds.w, "inside horizontally");
  assert.ok(Math.abs(tall.w / tall.h - 1 / 2) < 1e-9);
});
