/**
 * Geometry mapping for the clipping mask.
 *
 * The mask places a shape's 0–100 box inside the masked element's fractional
 * box, and it does so in the coordinates themselves: a `clipPath` referenced
 * from HTML drops its contents when they carry an SVG `transform`, so the
 * placement cannot be expressed as a transform.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPathData, mapShapePart, type Affine } from "./shape-affine.ts";
import { shapeDef } from "./shapes.ts";

const IDENTITY: Affine = { sx: 1, sy: 1, tx: 0, ty: 0 };
const nums = (d: string) => d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];

test("shape-affine: identity keeps rectangles and polygons in place", () => {
  assert.deepEqual(mapShapePart({ k: "rect", x: 10, y: 20, w: 30, h: 40, rx: 4 }, IDENTITY), {
    k: "rect",
    x: 10,
    y: 20,
    w: 30,
    h: 40,
    rx: 4,
  });
  assert.deepEqual(mapShapePart({ k: "poly", points: "0,0 50,100 100,0" }, IDENTITY), {
    k: "poly",
    points: "0,0 50,100 100,0",
  });
});

test("shape-affine: scale and translation land on the expected coordinates", () => {
  const m: Affine = { sx: 0.5, sy: 0.25, tx: 10, ty: 5 };
  assert.deepEqual(mapShapePart({ k: "rect", x: 20, y: 40, w: 40, h: 40 }, m), {
    k: "rect",
    x: 20,
    y: 15,
    w: 20,
    h: 10,
    rx: undefined,
  });
  assert.deepEqual(mapShapePart({ k: "poly", points: "0,0 100,100" }, m), { k: "poly", points: "10,5 60,30" });
});

test("shape-affine: an unevenly scaled circle becomes an ellipse", () => {
  const even = mapShapePart({ k: "circle", cx: 50, cy: 50, r: 25 }, { sx: 2, sy: 2, tx: 1, ty: 1 });
  assert.deepEqual(even, { k: "circle", cx: 101, cy: 101, r: 50 });
  const uneven = mapShapePart({ k: "circle", cx: 50, cy: 50, r: 25 }, { sx: 2, sy: 0.5, tx: 0, ty: 0 });
  assert.deepEqual(uneven, { k: "ellipse", cx: 100, cy: 25, rx: 50, ry: 12.5 });
});

test("shape-affine: line commands follow the map exactly", () => {
  const m: Affine = { sx: 2, sy: 3, tx: 10, ty: 20 };
  const out = mapPathData("M0 0L10 10H30V40Z", m);
  // M(0,0)→(10,20), L(10,10)→(30,50), H(30)→(70), V(40)→(140).
  assert.deepEqual(nums(out), [10, 20, 30, 50, 70, 140]);
  assert.match(out, /Z\s*$/);
});

test("shape-affine: relative deltas scale without being translated", () => {
  const out = mapPathData("m10 20l5 5z", { sx: 2, sy: 3, tx: 100, ty: 100 });
  assert.deepEqual(nums(out), [20, 60, 10, 15]);
});

test("shape-affine: arcs become curves whose midpoints stay on the ellipse", () => {
  const m: Affine = { sx: 2, sy: 3, tx: 10, ty: 20 };
  const mapped = mapPathData("M0 0A50 50 0 0 1 100 0Z", m);
  assert.ok(!/[Aa]/.test(mapped), "no arc command may survive a non-uniform map");
  const v = nums(mapped);
  // Start point, then the first cubic's control points and end point.
  assert.deepEqual(v.slice(0, 2), [10, 20]);
  assert.deepEqual(v.slice(-2), [210, 20]);
  // The 180° arc is cut into 90° segments, so the first cubic must END on the
  // quarter point (50, ±50) — mapped to x=110 with the 50-unit offset scaled by
  // sy=3. That is the check that the arc, not just its endpoints, survived.
  assert.ok(Math.abs(v[6] - 110) < 0.5, `quarter point x should map to 110, got ${v[6]}`);
  const mappedQuarterY = (v[7] - 20) / 3;
  assert.ok(Math.abs(Math.abs(mappedQuarterY) - 50) < 0.5, `quarter point y should map to ±50, got ${mappedQuarterY}`);
});

test("shape-affine: every library shape maps into the target box without arcs", () => {
  // What a mask does in practice: 0–100 box units → fractions of another box.
  const m: Affine = { sx: 0.008, sy: 0.012, tx: 0.05, ty: 0.03 };
  for (const id of ["heart", "star", "arch", "crescent", "shield", "cloud", "circle", "rounded"]) {
    const def = shapeDef(id);
    for (const part of def.parts) {
      const mapped = mapShapePart(part, m);
      if (mapped.k === "path") {
        assert.ok(!/[Aa]/.test(mapped.d), `${id} still carries an arc command`);
        for (const n of nums(mapped.d)) {
          assert.ok(Number.isFinite(n), `${id} produced a non-finite coordinate`);
          assert.ok(n > -1 && n < 3, `${id} mapped a coordinate out of range: ${n}`);
        }
      }
      if (mapped.k === "poly") {
        for (const pair of mapped.points.split(/\s+/)) {
          const [x, y] = pair.split(",").map(Number);
          assert.ok(x > -1 && x < 3 && y > -1 && y < 3, `${id} polygon point out of range: ${pair}`);
        }
      }
    }
  }
});
