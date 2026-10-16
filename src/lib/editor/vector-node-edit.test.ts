import assert from "node:assert/strict";
import test from "node:test";
import {
  extractVectorTarget,
  movePoint,
  parsePathData,
  pointsToPathData,
  rewritePathData,
  type PathPoint,
} from "./vector-node-edit.ts";

/**
 * The vector node editor's pure geometry contract.
 *
 * These are the rules the editor got wrong in production:
 *
 *   · points were scraped out of the WHOLE markup, so `viewBox="0 0 900 640"`
 *     and the `xmlns` URL desynced the token stream — `extractVectorTarget`
 *     must read the first `<path>`'s `d` attribute and nothing else;
 *   · the commit replaced `el.content` with a bare path string, destroying the
 *     drawing — `rewritePathData` must touch only `d` values that match, and
 *     every occurrence that matches (Photoshop paints one shape twice: a fill
 *     pass and a gradient pass sharing the same `d`);
 *   · unsupported or malformed paths must return null so the editor degrades
 *     to "not editable" instead of corrupting the element.
 */

test("parsePathData: absolute moves, lines and cubics", () => {
  assert.deepEqual(parsePathData("M 10 10 L 30 10 C 40 10 50 20 60 30"), [
    { x: 10, y: 10, type: "M" },
    { x: 30, y: 10, type: "L" },
    {
      x: 60,
      y: 30,
      type: "C",
      cp1: { x: 40, y: 10 },
      cp2: { x: 50, y: 20 },
    },
  ]);
});

test("parsePathData: relative commands resolve against the current point", () => {
  const points = parsePathData("m 10 10 l 20 0 l 0 20");
  assert.deepEqual(points, [
    { x: 10, y: 10, type: "M" },
    { x: 30, y: 10, type: "L" },
    { x: 30, y: 30, type: "L" },
  ]);
});

test("parsePathData: extra pairs after a moveto are implicit linetos", () => {
  assert.deepEqual(parsePathData("M 5 5 15 5 15 25"), [
    { x: 5, y: 5, type: "M" },
    { x: 15, y: 5, type: "L" },
    { x: 15, y: 25, type: "L" },
  ]);
});

test("parsePathData: H/V become lines on the current axis", () => {
  assert.deepEqual(parsePathData("M 0 0 H 40 V 20 h -10 v -5"), [
    { x: 0, y: 0, type: "M" },
    { x: 40, y: 0, type: "L" },
    { x: 40, y: 20, type: "L" },
    { x: 30, y: 20, type: "L" },
    { x: 30, y: 15, type: "L" },
  ]);
});

test("parsePathData: S and T reflect the previous control point", () => {
  const withS = parsePathData("M 0 0 C 10 0 10 10 20 10 S 30 20 40 20");
  const cubic = withS?.[2];
  assert.equal(cubic?.type, "C");
  /* Reflection of (10,10) about (20,10) is (30,10) — the SVG rule. */
  assert.deepEqual(cubic?.cp1, { x: 30, y: 10 });

  const withT = parsePathData("M 0 0 Q 10 0 20 10 T 40 10");
  const quad = withT?.[2];
  assert.equal(quad?.type, "Q");
  assert.deepEqual(quad?.cp, { x: 30, y: 20 });
});

test("parsePathData: close keeps its slot and re-emits as Z", () => {
  const points = parsePathData("M 0 0 L 10 0 L 10 10 Z");
  assert.equal(points?.length, 4);
  assert.equal(points?.[3].type, "Z");
  assert.equal(pointsToPathData(points!), "M0 0 L10 0 L10 10 Z");
});

test("parsePathData: arcs and malformed data are refused, never guessed", () => {
  assert.equal(parsePathData("M 0 0 A 5 5 0 0 1 10 10"), null);
  assert.equal(parsePathData("10 10 L 20 20"), null);
  assert.equal(parsePathData("M 0 0 L 5"), null);
  assert.equal(parsePathData(""), null);
});

test("parsePathData: rounding keeps three decimals in the emitted path", () => {
  const points = parsePathData("M 1.23456 2.34567 L 3.45678 4.5");
  assert.equal(pointsToPathData(points!), "M1.235 2.346 L3.457 4.5");
});

/*
 * The Photoshop shape, verbatim in structure: a viewBox in pixel space, the
 * same `d` painted twice (fill + gradient overlay) behind a translate.
 */
const PSD_SHAPE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 640">' +
  '<defs><linearGradient id="psdVectorOverlay"><stop offset="0" stop-color="#111"/></linearGradient></defs>' +
  '<path d="M 12 24 C 30 24 48 40 48 64 Z" transform="translate(-4 -8)" fill="#006c35" fill-rule="nonzero"/>' +
  '<path d="M 12 24 C 30 24 48 40 48 64 Z" transform="translate(-4 -8)" fill="url(#psdVectorOverlay)" fill-rule="nonzero"/>' +
  "</svg>";

test("extractVectorTarget: reads the first path's d, not the document's numbers", () => {
  const target = extractVectorTarget(PSD_SHAPE);
  assert.ok(target);
  assert.equal(target!.d, "M 12 24 C 30 24 48 40 48 64 Z");
  /* 900/640 are viewBox values: the old scraper leaked them into the points. */
  assert.deepEqual(
    target!.points.map((p) => [p.type, p.x, p.y]),
    [
      ["M", 12, 24],
      ["C", 48, 64],
      ["Z", 12, 24],
    ],
  );
});

test("extractVectorTarget: null when there is no editable path", () => {
  assert.equal(extractVectorTarget("<svg viewBox='0 0 10 10'><rect/></svg>"), null);
  assert.equal(
    extractVectorTarget('<svg viewBox="0 0 10 10"><path fill="#000"/></svg>'),
    null,
  );
  assert.equal(extractVectorTarget(""), null);
});

test("rewritePathData: every occurrence moves together, everything else is byte-identical", () => {
  const target = extractVectorTarget(PSD_SHAPE)!;
  const next = pointsToPathData(
    movePoint(target.points, 1, "point", 60, 80),
  );
  const out = rewritePathData(PSD_SHAPE, target.d, next);
  assert.ok(out);
  /* Both passes follow the same geometry. */
  assert.equal(out!.match(/\sd="/g)?.length, 2);
  assert.equal(out!.split(next).length - 1, 2);
  assert.equal(out!.includes(target.d), false);
  /* Untouched: namespaces, viewBox, gradients, transforms, other attributes. */
  for (const kept of [
    'viewBox="0 0 900 640"',
    'xmlns="http://www.w3.org/2000/svg"',
    'id="psdVectorOverlay"',
    'transform="translate(-4 -8)"',
    'fill="url(#psdVectorOverlay)"',
    "fill-rule",
  ])
    assert.ok(out!.includes(kept), `expected ${kept} to survive`);
});

test("rewritePathData: no match means no write", () => {
  assert.equal(rewritePathData(PSD_SHAPE, "M 1 1 Z", "M 2 2 Z"), null);
  assert.equal(rewritePathData(PSD_SHAPE, "", "M 2 2 Z"), null);
});

test("movePoint: an anchor drag carries the handles, a handle drag does not", () => {
  const points = parsePathData("M 0 0 C 10 0 20 10 30 10")!;
  const moved = movePoint(points, 1, "point", 40, 20);
  assert.deepEqual(moved[1], {
    x: 40,
    y: 20,
    type: "C",
    cp1: { x: 20, y: 10 },
    cp2: { x: 30, y: 20 },
  });
  /* The source snapshot is untouched — React compares by identity. */
  assert.equal(points[1].x, 30);

  const bent = movePoint(moved, 1, "cp1", 5, 5);
  assert.deepEqual(bent[1].cp1, { x: 5, y: 5 });
  assert.deepEqual(bent[1].cp2, { x: 30, y: 20 });
  assert.equal(movePoint(bent, 1, "cp2", 1, 1).length, 2);
});

test("movePoint: a close marker has no geometry to drag", () => {
  const points = parsePathData("M 0 0 L 10 0 L 10 10 Z")!;
  assert.equal(movePoint(points, 3, "point", 9, 9), points);
});
