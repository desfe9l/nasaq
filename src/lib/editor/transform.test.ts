/**
 * NASAQ Editor — tests for the gesture math in `transform.ts`:
 * Shift-based proportional resizing and zoom-aware snapping.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { GRID, MIN_SIZE, type CanvasEl } from "./model.ts";
import {
  applyResizeSnap,
  applySnap,
  elementAABB,
  mirrorHandle,
  resizeByHandle,
  rotatePoint,
  rotatedAABB,
  rotationIsAxisAligned,
  snapThresholdMm,
  toLocalDelta,
} from "./transform.ts";

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

function resize(
  orig: CanvasEl,
  handle: string,
  dx: number,
  dy: number,
  shift: boolean,
): CanvasEl {
  const next = { ...orig };
  resizeByHandle(
    next,
    orig,
    handle,
    dx,
    dy,
    shift || orig.style.aspectLock === true,
  );
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
  assert.equal(
    wide.h,
    90,
    "movement on the minor axis still scales from the dominant axis",
  );
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
  assert.equal(
    next.w,
    next.h,
    "a square star scales uniformly, no golden-ratio constant",
  );
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
  assert.equal(
    fromEdge.x,
    10 + (40 - 60) / 2,
    "pure n/s resize stays centred horizontally",
  );
});

test("aspectLock preserves the ratio without Shift", () => {
  const locked = box(0, 0, 60, 30);
  locked.style.aspectLock = true;
  const next = resize(locked, "se", 0, 60, false);
  assert.equal(
    next.w,
    180,
    "3x vertical move, width follows the locked 2:1 ratio",
  );
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
  assert.equal(
    centre.x + centre.w / 2,
    105,
    "the element's centre lands on the artboard centre",
  );
});

test("snapping ignores elements moving with the gesture", () => {
  const size = { w: 210, h: 297 };
  const el = box(101, 50, 20, 20);
  const guides = applySnap(
    el,
    [{ id: "peer", x: 100, y: 0, w: 30, h: 30 }],
    size,
    false,
    true,
    1,
    {
      peer: true,
    },
  );
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

test("mirrorHandle flips the axis letters a mirrored element swaps", () => {
  assert.equal(mirrorHandle("nw", false, false), "nw");
  assert.equal(mirrorHandle("nw", true, false), "ne");
  assert.equal(mirrorHandle("ne", true, false), "nw");
  assert.equal(mirrorHandle("se", true, false), "sw");
  assert.equal(
    mirrorHandle("n", true, false),
    "n",
    "a vertical-only edge is unmoved by a horizontal mirror",
  );
  assert.equal(mirrorHandle("n", false, true), "s");
  assert.equal(mirrorHandle("se", true, true), "nw");
  assert.equal(mirrorHandle("e", true, true), "w");
});

test("a mirrored corner grip drags the edge the author can see", () => {
  // Element mirrored horizontally: the grip drawn at the visual right edge must
  // grow the box to the right, exactly like an unmirrored `e` handle.
  const orig = box(20, 20, 40, 30);
  const next = box(20, 20, 40, 30);
  resizeByHandle(next, orig, mirrorHandle("nw", true, false), 10, 0, false);
  assert.equal(next.w, 50);
  assert.equal(next.x, 20);
});

test("equal-spacing snap centres a box between two row neighbours", () => {
  const size = { w: 210, h: 297 };
  const others = [
    { id: "left", x: 0, y: 0, w: 40, h: 60 },
    { id: "right", x: 100, y: 0, w: 40, h: 60 },
  ];
  // 20mm box 1mm off the perfect centre of the 60mm gap (ideal x = 60).
  const el = box(61, 25, 20, 20);
  const guides = applySnap(el, others, size, false, true, 1, {});
  assert.equal(el.x, 60, "both gaps become 20mm");
  assert.deepEqual(
    guides.v.sort((a, b) => a - b),
    [50, 90],
    "a guide marks the middle of each gap",
  );
});

test("equal-spacing stays quiet when nothing flanks the box", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "lonely", x: 150, y: 0, w: 40, h: 60 }];
  const el = box(61, 25, 20, 20);
  const guides = applySnap(el, others, size, false, true, 1, {});
  assert.equal(el.x, 61, "a lone neighbour on one side never fakes a gap");
  assert.deepEqual(guides, { v: [], h: [] });
});

test("resize snap moves ONLY the dragged edge", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 0, w: 40, h: 40 }];

  // se: right edge 1.6mm short of the neighbour's left edge → grows to meet it.
  const se = { x: 10, y: 10, w: 88.4, h: 30 };
  const seGuides = applyResizeSnap(se, "se", others, size, false, true, 1);
  assert.equal(se.x, 10, "the anchored west edge never drifts");
  assert.equal(se.w, 90, "east edge lands exactly on the target");
  assert.deepEqual(seGuides.v, [100]);

  // w handle: left edge snaps, the right edge stays put.
  const w = { x: 101.2, y: 10, w: 50, h: 30 };
  const wGuides = applyResizeSnap(w, "w", others, size, false, true, 1);
  assert.equal(w.x, 100, "west edge lands on the target");
  assert.equal(w.w, 51.2, "east edge is preserved (151.2mm)");
  assert.deepEqual(wGuides.v, [100]);
});

test("resize grid snap rounds the live edge to the grid", () => {
  const box2 = { x: 10, y: 10, w: 88.4, h: 30 };
  applyResizeSnap(box2, "se", [], { w: 210, h: 297 }, true, false, 1);
  assert.equal(box2.x, 10, "grid snap never touches the anchored edge");
  assert.equal(box2.w, 90, `east edge 98.4 → ${10 + box2.w - 10 + 10} = grid multiple`);
  assert.equal((box2.x + box2.w) % GRID, 0);
});

// ── Proportion-preserving resize snap (held-modifier gesture) ────────────────

test("ratioLock snaps the closest live edge and scales both dimensions", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 0, w: 40, h: 40 }];
  // 2:1 box whose east edge is 1.5mm short of the neighbour's west edge.
  const b = { x: 10, y: 10, w: 88.5, h: 44.25 };
  const guides = applyResizeSnap(b, "se", others, size, false, true, 1, 0, {
    ratioLock: true,
  });
  assert.equal(b.w, 90, "the snapped axis lands exactly on the target");
  assert.equal(b.h, 45, "the other dimension follows the same scale");
  assert.equal(b.x, 10, "the anchored west edge never drifts");
  assert.equal(b.y, 10, "the anchored north edge never drifts");
  assert.deepEqual(guides.v, [100]);
  assert.deepEqual(guides.h, []);
});

test("ratioLock keeps a single-axis edge handle centred on the other axis", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 0, w: 40, h: 40 }];
  const b = { x: 10, y: 10, w: 88.5, h: 44.25 };
  const guides = applyResizeSnap(b, "e", others, size, false, true, 1, 0, {
    ratioLock: true,
  });
  assert.equal(b.w, 90);
  assert.equal(b.h, 45);
  assert.equal(b.x, 10);
  assert.equal(b.y, 10 + 44.25 / 2 - 45 / 2, "the height grows about the centre");
  assert.deepEqual(guides.v, [100]);
});

test("ratioLock anchors the opposite corner for a west/north handle", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 10, y: 0, w: 40, h: 40 }];
  const b = { x: 11.5, y: 10, w: 88.5, h: 44.25 };
  applyResizeSnap(b, "nw", others, size, false, true, 1, 0, {
    ratioLock: true,
  });
  assert.equal(b.x, 10, "the west edge lands on the target");
  assert.equal(b.w, 90);
  assert.equal(b.x + b.w, 100, "the anchored east edge is preserved");
  assert.equal(b.h, 45);
  assert.equal(b.y + b.h, 54.25, "the anchored south edge is preserved");
});

test("ratioLock reports nothing and changes nothing when no edge is close", () => {
  const size = { w: 210, h: 297 };
  const b = { x: 10, y: 10, w: 50, h: 25 };
  const before = { ...b };
  const guides = applyResizeSnap(b, "se", [], size, false, true, 1, 0, {
    ratioLock: true,
  });
  assert.deepEqual(b, before);
  assert.deepEqual(guides, { v: [], h: [] });
});

test("ratioLock stays suspended for a rotated box", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 0, w: 40, h: 40 }];
  const b = { x: 10, y: 10, w: 88.5, h: 44.25 };
  const guides = applyResizeSnap(b, "se", others, size, false, true, 1, 30, {
    ratioLock: true,
  });
  assert.equal(b.w, 88.5, "a tilted box resizes freeform");
  assert.deepEqual(guides, { v: [], h: [] });
});

// ── Rotation-aware transformation model ─────────────────────────────────────

test("rotationIsAxisAligned accepts multiples of 90 with float tolerance", () => {
  assert.ok(rotationIsAxisAligned(0));
  assert.ok(rotationIsAxisAligned(90));
  assert.ok(rotationIsAxisAligned(-90));
  assert.ok(rotationIsAxisAligned(180));
  assert.ok(rotationIsAxisAligned(-360));
  assert.ok(rotationIsAxisAligned(90.1), "within tolerance");
  assert.ok(!rotationIsAxisAligned(30));
  assert.ok(!rotationIsAxisAligned(45));
  assert.ok(!rotationIsAxisAligned(89.5), "just outside tolerance");
});

test("toLocalDelta is the identity at 0 and swaps/signs at 90", () => {
  assert.deepEqual(toLocalDelta(10, 4, 0), { dx: 10, dy: 4 });
  // 90° clockwise: the local x axis points down the page, local y points
  // left. A page delta (dx, dy) is therefore (localDx, localDy) = (dy, −dx).
  const at90 = toLocalDelta(10, 4, 90);
  assert.ok(Math.abs(at90.dx - 4) < 1e-9);
  assert.ok(Math.abs(at90.dy + 10) < 1e-9);
  // 180°: both axes invert.
  const at180 = toLocalDelta(10, 4, 180);
  assert.ok(Math.abs(at180.dx + 10) < 1e-9);
  assert.ok(Math.abs(at180.dy + 4) < 1e-9);
  // 30°: check against the closed form.
  const rad = (30 * Math.PI) / 180;
  const at30 = toLocalDelta(10, 4, 30);
  assert.ok(Math.abs(at30.dx - (10 * Math.cos(rad) + 4 * Math.sin(rad))) < 1e-9);
  assert.ok(
    Math.abs(at30.dy - (-10 * Math.sin(rad) + 4 * Math.cos(rad))) < 1e-9,
  );
});

test("rotatedAABB matches the closed form and is invariant at 90°", () => {
  const b = { x: 10, y: 20, w: 40, h: 20 };
  const a45 = rotatedAABB(b, 45);
  const expected = (40 + 20) * Math.SQRT1_2;
  assert.ok(Math.abs(a45.w - expected) < 1e-9);
  assert.ok(Math.abs(a45.h - expected) < 1e-9);
  // Centre is invariant.
  assert.ok(Math.abs(a45.x + a45.w / 2 - (b.x + b.w / 2)) < 1e-9);
  assert.ok(Math.abs(a45.y + a45.h / 2 - (b.y + b.h / 2)) < 1e-9);
  // 90°: the extents swap.
  const a90 = rotatedAABB(b, 90);
  assert.ok(Math.abs(a90.w - 20) < 1e-9);
  assert.ok(Math.abs(a90.h - 40) < 1e-9);
});

test("elementAABB agrees with rotatedAABB for a lone element", () => {
  const el = { x: 5, y: 6, w: 30, h: 12 };
  for (const rot of [0, 30, 45, 90, 180, -30, 270]) {
    const a = elementAABB(el, rot, { x: 0, y: 0 });
    const r = rotatedAABB(el, rot);
    assert.ok(Math.abs(a.x - r.x) < 1e-9, `x @ ${rot}`);
    assert.ok(Math.abs(a.y - r.y) < 1e-9, `y @ ${rot}`);
    assert.ok(Math.abs(a.w - r.w) < 1e-9, `w @ ${rot}`);
    assert.ok(Math.abs(a.h - r.h) < 1e-9, `h @ ${rot}`);
  }
});

test("elementAABB composes a child's rotation with the group's", () => {
  // A 10×10 child at the group's top-left corner; the group is 40×40,
  // rotated 45° about its own centre, sitting at (0,0).
  const child = { x: 0, y: 0, w: 10, h: 10 };
  const a = elementAABB(child, 0, { x: 0, y: 0 }, 45, { x: 20, y: 20 });
  // Reference: rotate the four corners by hand.
  const corners: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [px, py] of corners) {
    const p = rotatePoint(px, py, 20, 20, 45);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(Math.abs(a.x - minX) < 1e-9);
  assert.ok(Math.abs(a.y - minY) < 1e-9);
  assert.ok(Math.abs(a.w - (maxX - minX)) < 1e-9);
  assert.ok(Math.abs(a.h - (maxY - minY)) < 1e-9);
});

test("applySnap snaps a tilted box by its visual extremes, not phantom edges", () => {
  const size = { w: 210, h: 297 };
  // A 45°-rotated 20×20 box whose AABB right edge sits 0.5mm LEFT of the
  // artboard centre (x=105). Its MODEL right edge (x+w) is far from 105 —
  // snapping must use the visual silhouette, and the whole element moves.
  const halfAABB = 20 * Math.SQRT1_2; // AABB half-extent of a 20×20 at 45°
  const centerX = 104.5 - halfAABB; // AABB right edge at 104.5
  const el = { x: centerX - 10, y: 50, w: 20, h: 20 };
  const before = { ...el };
  const guides = applySnap(el, [], size, false, true, 1, {}, 45);
  const afterAABB = rotatedAABB(el, 45);
  assert.deepEqual(guides.v, [105], "the guide marks the artboard centre");
  assert.ok(
    Math.abs(afterAABB.x + afterAABB.w - 105) < 1e-9,
    "the visual right extreme lands on the centre line",
  );
  // The element moved as a rigid translation: its centre shifted by the
  // same 0.5mm.
  const cxB = before.x + before.w / 2;
  const cxA = el.x + el.w / 2;
  assert.ok(Math.abs(cxA - cxB - 0.5) < 1e-9, "centre moved exactly 0.5mm");
});

test("applySnap for an axis-aligned box is unchanged by the rotation param", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 100, w: 50, h: 40 }];
  const el = { x: 101.2, y: 50, w: 20, h: 20 };
  const guides = applySnap(el, others, size, false, true, 1, {}, 0);
  assert.deepEqual(guides.v, [100]);
  assert.equal(el.x, 100);
});

test("applyResizeSnap suspends for a rotated box (no phantom-edge snap)", () => {
  const size = { w: 210, h: 297 };
  const others = [{ id: "a", x: 100, y: 0, w: 40, h: 40 }];
  const rotated = { x: 10, y: 10, w: 88.4, h: 30 };
  const g = applyResizeSnap(
    rotated,
    "se",
    others,
    size,
    true,
    true,
    1,
    30,
  );
  assert.deepEqual(g, { v: [], h: [] });
  assert.equal(rotated.x, 10);
  assert.equal(rotated.w, 88.4, "a tilted box resizes freeform");

  // 90° is axis-parallel but on swapped axes — suspended too.
  const at90 = { x: 10, y: 10, w: 88.4, h: 30 };
  const g90 = applyResizeSnap(at90, "se", others, size, true, true, 1, 90);
  assert.deepEqual(g90, { v: [], h: [] });
  assert.equal(at90.w, 88.4);

  // Exactly 0 (mod 360) still snaps.
  const at0 = { x: 10, y: 10, w: 88.4, h: 30 };
  const g0 = applyResizeSnap(at0, "se", others, size, false, true, 1, 0);
  assert.equal(at0.w, 90);
  const at360 = { x: 10, y: 10, w: 88.4, h: 30 };
  const g360 = applyResizeSnap(at360, "se", others, size, false, true, 1, 360);
  assert.equal(at360.w, 90);
  assert.deepEqual(g360.v, [100]);
});

test("a rotated resize projects the pointer onto local axes", () => {
  // Element 40×30 rotated 90°. Its local x axis points DOWN the page, so a
  // purely vertical page drag of +10mm on the "se" handle must grow the
  // WIDTH by 10 (local dx), not the height.
  const orig = box(10, 10, 40, 30);
  orig.rotation = 90;
  const next = { ...orig };
  const local = toLocalDelta(0, 10, 90);
  resizeByHandle(next, orig, "se", local.dx, local.dy, false);
  assert.equal(next.w, 50, "vertical page drag grows width at 90°");
  assert.equal(next.h, 30, "…and leaves the height alone");
});

import { resizeToPointer } from "./transform.ts";

const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type H = (typeof HANDLES)[number];

/** The grabbed feature's page position for each handle at 0°. */
function grabPoint(o: { x: number; y: number; w: number; h: number }, hd: H) {
  const { x, y, w, h } = o;
  switch (hd) {
    case "n": return { x: x + w / 2, y };
    case "s": return { x: x + w / 2, y: y + h };
    case "e": return { x: x + w, y: y + h / 2 };
    case "w": return { x, y: y + h / 2 };
    case "ne": return { x: x + w, y };
    case "nw": return { x, y };
    case "se": return { x: x + w, y: y + h };
    case "sw": return { x, y: y + h };
  }
}

/** Visual corner/edge-midpoint of a rotated box in page mm. */
function visualPoint(
  o: { x: number; y: number; w: number; h: number; rotation?: number },
  hd: H,
) {
  const rad = (((o.rotation ?? 0) % 360) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const at = (lx: number, ly: number) => ({
    x: cx + (lx * o.w * c - ly * o.h * s) / 2,
    y: cy + (lx * o.w * s + ly * o.h * c) / 2,
  });
  switch (hd) {
    case "n": return at(0, -1);
    case "s": return at(0, 1);
    case "e": return at(1, 0);
    case "w": return at(-1, 0);
    case "ne": return at(1, -1);
    case "nw": return at(-1, -1);
    case "se": return at(1, 1);
    case "sw": return at(-1, 1);
  }
}

test("resizeToPointer at 0° matches resizeByHandle for every handle", () => {
  const orig = { x: 10, y: 20, w: 100, h: 60 };
  const deltas: [number, number][] = [
    [12.3, 5.7], [-7, 30.4], [40, -3], [-25, 8.8], [0, 0],
    [9.9, -12.1], [50, 50], [-60, 20], [200, 120], [-140, -90],
  ];
  for (const hd of HANDLES) {
    for (const [dx, dy] of deltas) {
      const a = { ...orig };
      resizeByHandle(a, orig, hd, dx, dy, false);
      const b = { ...orig };
      const g = grabPoint(orig, hd);
      resizeToPointer(b, orig, hd, { x: g.x + dx, y: g.y + dy }, 0, false);
      assert.deepEqual(
        [a.x, a.y, a.w, a.h].map((v) => +v.toFixed(9)),
        [b.x, b.y, b.w, b.h].map((v) => +v.toFixed(9)),
        `${hd} delta (${dx}, ${dy})`,
      );
    }
  }
});

test("resizeToPointer at 0° matches resizeByHandle with locks and ratio", () => {
  const orig = { x: 10, y: 20, w: 100, h: 60 };
  const deltas: [number, number][] = [[30, 12], [-45, 8], [18, -22]];
  const combos: Array<[H, boolean, { widthLocked?: boolean; heightLocked?: boolean }]> = [
    ["se", false, {}], ["se", true, {}], ["se", false, { widthLocked: true }],
    ["se", false, { heightLocked: true }], ["e", false, {}], ["e", true, {}],
    ["n", false, {}], ["nw", true, { heightLocked: true }],
  ];
  for (const [hd, ratio, locks] of combos) {
    for (const [dx, dy] of deltas) {
      const a = { ...orig };
      resizeByHandle(a, orig, hd, dx, dy, ratio, locks);
      const b = { ...orig };
      const g = grabPoint(orig, hd);
      resizeToPointer(b, orig, hd, { x: g.x + dx, y: g.y + dy }, 0, ratio, locks);
      assert.deepEqual(
        [a.x, a.y, a.w, a.h].map((v) => +v.toFixed(9)),
        [b.x, b.y, b.w, b.h].map((v) => +v.toFixed(9)),
        `${hd} ratio=${ratio} locks=${JSON.stringify(locks)} (${dx}, ${dy})`,
      );
    }
  }
});

test("rotated corner resize: grabbed corner lands exactly on the pointer", () => {
  const orig = { x: 100, y: 100, w: 60, h: 40, rotation: 30 };
  // Target = anchor (visual NW corner) + R(30)·(80, 50) → expected w=80, h=50.
  const anchor = visualPoint(orig, "nw");
  const rad = (30 * Math.PI) / 180;
  const target = {
    x: anchor.x + 80 * Math.cos(rad) - 50 * Math.sin(rad),
    y: anchor.y + 80 * Math.sin(rad) + 50 * Math.cos(rad),
  };
  const next = { x: 0, y: 0, w: 0, h: 0, rotation: 30 };
  resizeToPointer(next, orig, "se", target, 30, false);
  assert.ok(Math.abs(next.w - 80) < 1e-9, `w=${next.w}`);
  assert.ok(Math.abs(next.h - 50) < 1e-9, `h=${next.h}`);
  const got = visualPoint({ ...next }, "se");
  assert.ok(Math.abs(got.x - target.x) < 1e-9 && Math.abs(got.y - target.y) < 1e-9,
    `se corner ${JSON.stringify(got)} vs target ${JSON.stringify(target)}`);
  const anchorAfter = visualPoint({ ...next }, "nw");
  assert.ok(Math.abs(anchorAfter.x - anchor.x) < 1e-9 &&
            Math.abs(anchorAfter.y - anchor.y) < 1e-9,
    "anchor corner must not move");
});

test("rotated edge resize: edge midpoint follows pointer, other edge fixed", () => {
  const orig = { x: 100, y: 100, w: 60, h: 40, rotation: 30 };
  const rad = (30 * Math.PI) / 180;
  const anchor = visualPoint(orig, "w"); // west edge midpoint, must stay put
  const target = {
    x: anchor.x + 75 * Math.cos(rad),
    y: anchor.y + 75 * Math.sin(rad),
  };
  const next = { x: 0, y: 0, w: 0, h: 0, rotation: 30 };
  resizeToPointer(next, orig, "e", target, 30, false);
  assert.ok(Math.abs(next.w - 75) < 1e-9, `w=${next.w}`);
  assert.ok(Math.abs(next.h - 40) < 1e-9, `h=${next.h}`);
  const eastAfter = visualPoint({ ...next }, "e");
  assert.ok(Math.abs(eastAfter.x - target.x) < 1e-9 &&
            Math.abs(eastAfter.y - target.y) < 1e-9, "east midpoint on pointer");
  const westAfter = visualPoint({ ...next }, "w");
  assert.ok(Math.abs(westAfter.x - anchor.x) < 1e-9 &&
            Math.abs(westAfter.y - anchor.y) < 1e-9, "west midpoint fixed");
});

test("rotated ratio-lock: circle resizes by dominant axis and stays a circle", () => {
  const orig = { x: 100, y: 100, w: 40, h: 40, rotation: 45 };
  const rad = (45 * Math.PI) / 180;
  const anchor = visualPoint(orig, "nw");
  // Pointer offset R(45)·(60, 30): dominant axis = width (1.5 vs 0.75).
  const target = {
    x: anchor.x + 60 * Math.cos(rad) - 30 * Math.sin(rad),
    y: anchor.y + 60 * Math.sin(rad) + 30 * Math.cos(rad),
  };
  const next = { x: 0, y: 0, w: 0, h: 0, rotation: 45 };
  resizeToPointer(next, orig, "se", target, 45, true);
  assert.ok(Math.abs(next.w - 60) < 1e-9, `w=${next.w}`);
  assert.ok(Math.abs(next.h - 60) < 1e-9, `h=${next.h}`);
});

test("centered (Alt) resize: the centre stays pinned at any rotation", () => {
  const orig = { x: 100, y: 100, w: 60, h: 40, rotation: 25 };
  const rad = (25 * Math.PI) / 180;
  const c0 = { x: 130, y: 120 };
  const target = {
    x: c0.x + 50 * Math.cos(rad) - 30 * Math.sin(rad),
    y: c0.y + 50 * Math.sin(rad) + 30 * Math.cos(rad),
  };
  const next = { x: 0, y: 0, w: 0, h: 0, rotation: 25 };
  resizeToPointer(next, orig, "se", target, 25, false, { centered: true });
  assert.ok(Math.abs(next.w - 100) < 1e-9, `w=${next.w}`);
  assert.ok(Math.abs(next.h - 60) < 1e-9, `h=${next.h}`);
  const c1 = { x: next.x + next.w / 2, y: next.y + next.h / 2 };
  assert.ok(Math.abs(c1.x - c0.x) < 1e-9 && Math.abs(c1.y - c0.y) < 1e-9,
    `centre moved: ${JSON.stringify(c1)}`);
});

test("rotated resize keeps w/h consistent with the rendered silhouette", () => {
  const orig = { x: 85, y: 128.5, w: 40, h: 40, rotation: 30 };
  const anchor = visualPoint(orig, "nw");
  const rad = (30 * Math.PI) / 180;
  const target = {
    x: anchor.x + 58 * Math.cos(rad) - 20 * Math.sin(rad),
    y: anchor.y + 58 * Math.sin(rad) + 20 * Math.cos(rad),
  };
  const next = { x: 0, y: 0, w: 0, h: 0, rotation: 30 };
  resizeToPointer(next, orig, "se", target, 30, false);
  assert.ok(Math.abs(next.w - 58) < 1e-9 && Math.abs(next.h - 20) < 1e-9);
  // Rendered silhouette (rotated AABB) must be built from exactly these w/h.
  const sil = elementAABB({ x: next.x, y: next.y, w: next.w, h: next.h }, 30, { x: 0, y: 0 });
  const expectW = next.w * Math.abs(Math.cos(rad)) + next.h * Math.abs(Math.sin(rad));
  const expectH = next.w * Math.abs(Math.sin(rad)) + next.h * Math.abs(Math.cos(rad));
  assert.ok(Math.abs(sil.w - expectW) < 1e-9 && Math.abs(sil.h - expectH) < 1e-9);
});
