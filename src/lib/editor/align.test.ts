/**
 * NASAQ Editor — tests for single-selection and group-aware alignment
 * (`alignmentMoves` in model.ts).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { alignmentMoves, type CanvasEl, type Page } from "./model.ts";

function el(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<CanvasEl> = {},
): CanvasEl {
  return {
    id,
    type: "box",
    name: id,
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    z: 1,
    style: {},
    ...extra,
  };
}

function pageOf(elements: CanvasEl[]): Page {
  return { id: "p1", name: "صفحة", elements };
}

const A4 = { x: 0, y: 0, w: 210, h: 297 };

test("single element aligns to the artboard on all six edges", () => {
  const page = pageOf([el("a", 40, 60, 30, 20)]);

  const left = alignmentMoves(page.elements, ["a"], "left", A4)[0];
  assert.deepEqual([left.x, left.y], [0, 60]);

  const right = alignmentMoves(page.elements, ["a"], "right", A4)[0];
  assert.equal(right.x + 30, 210, "element.right → artboard.right");

  const center = alignmentMoves(page.elements, ["a"], "center", A4)[0];
  assert.equal(center.x + 15, 105, "element.centerX → artboard.centerX");

  const top = alignmentMoves(page.elements, ["a"], "top", A4)[0];
  assert.equal(top.y, 0);

  const bottom = alignmentMoves(page.elements, ["a"], "bottom", A4)[0];
  assert.equal(bottom.y + 20, 297, "element.bottom → artboard.bottom");

  const middle = alignmentMoves(page.elements, ["a"], "middle", A4)[0];
  assert.equal(middle.y + 10, 148.5, "element.centerY → artboard.centerY");
});

test("group member aligns in absolute page space, not group-relative space", () => {
  const child = el("child", 5, 5, 20, 10); // group-relative
  const group = el("grp", 100, 200, 30, 20, {
    type: "group",
    children: [child],
  });
  const page = pageOf([group]);

  // The child's absolute page position is (105, 205). Aligning LEFT must put
  // its absolute left edge at 0 — group-relative x becomes -100 — not 0, which
  // would leave it sitting at page (100, …) inside the group. The returned y
  // stays in the child's own (group-relative) space: 5, i.e. absolute 205.
  const left = alignmentMoves(page.elements, ["child"], "left", A4)[0];
  assert.deepEqual(left, { id: "child", x: -100, y: 5 });

  const center = alignmentMoves(page.elements, ["child"], "center", A4)[0];
  assert.equal(
    center.x + 100 + 10,
    105,
    "child centre lands on the artboard centre",
  );
});

test("multi-element alignment keeps using the shared selection box", () => {
  const a = el("a", 10, 10, 20, 20);
  const b = el("b", 100, 100, 30, 10);
  const page = pageOf([a, b]);

  // The store passes the selection's shared bounds as the frame; left aligns
  // both elements' left edges onto it.
  const selection = { x: 10, y: 10, w: 120, h: 100 };
  const moves = alignmentMoves(page.elements, ["a", "b"], "left", selection);
  assert.deepEqual(moves, [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 10, y: 100 },
  ]);
});

test("custom page sizes align against that artboard, not A4", () => {
  const page = pageOf([el("a", 40, 60, 30, 20)]);
  const slide = { x: 0, y: 0, w: 338.7, h: 190.5 };
  const right = alignmentMoves(page.elements, ["a"], "right", slide)[0];
  assert.ok(Math.abs(right.x + 30 - 338.7) < 1e-9);
});
