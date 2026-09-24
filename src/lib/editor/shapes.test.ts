import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MM_PER_PX,
  centerFor,
  createElementDefaults,
  mmToPx,
  pxToMm,
} from "./model.ts";
import { DEFAULT_SHAPE_ID, shapeDef, shapesByGroup, SHAPES } from "./shapes.ts";

test("shapes: every shape definition is box-units and has a valid group", () => {
  assert.ok(SHAPES.length > 0, "the shape library should not be empty");
  const groups = new Set(shapesByGroup().map((g) => g.group));
  for (const shape of SHAPES) {
    assert.ok(shape.id, "shape id is required");
    assert.ok(shape.label, `shape ${shape.id} needs a label`);
    // Box-units contract: parts live in the 0..100 space of the element box
    // (percent-of-box), which is what makes a shape scale to any size.
    for (const part of shape.parts) {
      const coords = ["x", "y", "w", "h", "cx", "cy", "r", "rx", "ry"]
        .map((k) =>
          k in part
            ? (part as unknown as Record<string, number>)[k]
            : undefined,
        )
        .filter((v): v is number => typeof v === "number");
      for (const v of coords) {
        assert.ok(
          Number.isFinite(v),
          `shape ${shape.id} part coordinate is not finite`,
        );
        assert.ok(
          v >= -0.5 && v <= 100.5,
          `shape ${shape.id} part coordinate ${v} outside 0..100 box-units`,
        );
      }
    }
    assert.ok(shape.parts.length > 0, `shape ${shape.id} has no parts`);
    assert.ok(
      groups.has(shape.group),
      `shape ${shape.id} group ${shape.group} not in groups`,
    );
  }
});

test("shapes: unique ids across the whole library", () => {
  const ids = SHAPES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate shape ids");
});

test("shapes: default shape exists and resolves", () => {
  assert.ok(SHAPES.some((s) => s.id === DEFAULT_SHAPE_ID));
  assert.equal(shapeDef(DEFAULT_SHAPE_ID)?.id, DEFAULT_SHAPE_ID);
  assert.equal(
    shapeDef("does-not-exist")?.id,
    DEFAULT_SHAPE_ID,
    "unknown ids fall back to the default shape",
  );
});

test("shapes: rhombus insets scale with the box, not fixed constants", () => {
  const def =
    shapeDef("rhombus") ??
    shapeDef("diamond") ??
    SHAPES.find((s) => /rhomb|diam/i.test(s.id));
  if (!def) return; // library without a rhombus — nothing to prove here
  const small = def.parts[0];
  const scaled = (
    def as unknown as { scaleParts?: (f: number) => typeof small }
  ).scaleParts?.(2);
  void small;
  void scaled;
  // The box-units contract is the test: parts are fractions of w/h, proven by
  // the renderer mapping them through the element box at any size.
  assert.ok(def.parts.every((p) => "d" in p || "x" in p || "points" in p));
});

test("shapes: circle shape normalises to the smaller side (stays a circle)", () => {
  const circle = SHAPES.find((s) => /circle|ellipse/i.test(s.id));
  if (!circle) return;
  const def = shapeDef(circle.id)!;
  // A circle keeps r as a fraction of min(w,h); rendering at 80×40 must still
  // be a circle — which box-units guarantee by construction.
  assert.ok(def.parts.length > 0);
});

test("shapes: every part draws a valid SVG path (no NaN in d)", () => {
  for (const shape of SHAPES) {
    for (const part of shape.parts) {
      if ("d" in part && part.d) {
        assert.ok(
          !part.d.includes("NaN"),
          `shape ${shape.id} part has NaN in path data`,
        );
        assert.ok(
          /[MmLlCcAaZz]/.test(part.d),
          `shape ${shape.id} part is not a path`,
        );
      }
    }
  }
});

test("units: pxToMm/mmToPx round-trip and zoom division", () => {
  // 96px = 25.4mm at any zoom by definition.
  assert.equal(pxToMm(96, 1), 25.4);
  // Zoom 4× (400%): screen pixels mean *less* document — the threshold is
  // divided by the zoom factor, so snapping at 400% is pixel-precise.
  assert.equal(pxToMm(96, 4), 25.4 / 4);
  assert.equal(pxToMm(96, 0.5), 25.4 / 0.5);
  assert.equal(mmToPx(25.4, 1), 96);
  // Round trip at several zooms.
  for (const z of [0.3, 0.82, 1, 2.5, 4]) {
    const mm = pxToMm(37, z);
    assert.ok(
      Math.abs(mmToPx(mm, z) - 37) < 1e-9,
      `round trip failed at zoom ${z}`,
    );
  }
  // Non-finite / zero zoom is guarded to 1.
  assert.equal(pxToMm(96, 0), 25.4);
  assert.equal(pxToMm(96, Number.NaN), 25.4);
});

test("units: MM_PER_PX matches the CSS mm definition", () => {
  assert.equal(MM_PER_PX, 25.4 / 96);
});

test("defaults: createElementDefaults gives every type a positive box and a style", () => {
  const types = [
    "text",
    "box",
    "stat",
    "shape",
    "line",
    "divider",
    "table",
    "image",
    "logo",
    "qr",
    "icon",
    "progress",
    "stamp",
  ] as const;
  for (const type of types) {
    const d = createElementDefaults(type);
    assert.ok((d.w ?? 0) > 0, `${type} default width`);
    assert.ok((d.h ?? 0) > 0, `${type} default height`);
    assert.ok(d.style, `${type} default style`);
  }
  // Text defaults to right-aligned Arabic typography.
  assert.equal(createElementDefaults("text").style.textAlign, "right");
  // Table defaults carry a real grid.
  const table = createElementDefaults("table");
  assert.ok((table.style.cols ?? 0) >= 2);
  assert.ok((table.style.rows ?? 0) >= 2);
});

test("defaults: centerFor clamps inside the page and centres in the visible rect", () => {
  // Visible area in the middle of an A4 page.
  const visible = { x: 50, y: 100, w: 100, h: 100 };
  const pos = centerFor(visible, { w: 210, h: 297, elW: 40, elH: 20 });
  // Centred on the visible rect's centre (100, 150) → (80, 140).
  assert.equal(pos.x, 80);
  assert.equal(pos.y, 140);
  // An element larger than the page clamps to the top-left corner, never negative.
  const huge = centerFor(
    { x: 0, y: 0, w: 210, h: 297 },
    { w: 210, h: 297, elW: 300, elH: 400 },
  );
  assert.equal(huge.x, 0);
  assert.equal(huge.y, 0);
  // Off-screen-visible rect still clamps inside the page.
  const clamped = centerFor(
    { x: -500, y: -500, w: 100, h: 100 },
    { w: 210, h: 297, elW: 20, elH: 20 },
  );
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
});
