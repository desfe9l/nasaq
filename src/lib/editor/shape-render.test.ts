import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRectRadius,
  dashArrayForUnits,
  shapeIdOf,
  shapeSvgMarkup,
  strokeToUnits,
} from "./shape-render.ts";
import { SHAPES, isCompoundShape, shapeDef } from "./shapes.ts";
import { DEFAULT_GRADIENT } from "./gradient.ts";

/**
 * Shape rendering is shared by the canvas (React SVG) and the exporter (HTML
 * string). These tests pin the string builder, because a drift here moves a
 * shape between the editor and the exported PDF.
 */

test("shape-render: shapeIdOf prefers shapeId and maps the legacy enum", () => {
  assert.equal(shapeIdOf(undefined), "rect");
  assert.equal(shapeIdOf({}), "rect");
  assert.equal(shapeIdOf({ shape: "circle" }), "circle");
  assert.equal(shapeIdOf({ shape: "rounded" }), "rounded");
  assert.equal(shapeIdOf({ shape: "anything-else" }), "rect");
  assert.equal(shapeIdOf({ shapeId: "star", shape: "circle" }), "star");
});

test("shape-render: every library shape serialises to a well-formed SVG", () => {
  for (const def of SHAPES) {
    const svg = shapeSvgMarkup(def.id, {
      fill: "#123456",
      stroke: "#000000",
      strokeUnits: 0,
    });
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), def.id);
    assert.ok(svg.endsWith("</g></svg>"), def.id);
    assert.ok(svg.includes('viewBox="0 0 100 100"'), def.id);
    assert.ok(svg.includes('preserveAspectRatio="none"'), def.id);
    // One primitive per part, nothing dropped on the way out.
    const primitives = svg.match(/<(rect|circle|ellipse|polygon|path) /g) || [];
    assert.equal(primitives.length, def.parts.length, `${def.id} part count`);
    // Compound shapes (holes) need the even-odd rule, simple ones must not get it.
    assert.equal(svg.includes('fill-rule="evenodd"'), isCompoundShape(def.id), def.id);
  }
});

test("shape-render: an unknown id falls back to the rectangle", () => {
  const unknown = shapeSvgMarkup("no-such-shape", {
    fill: "red",
    stroke: "red",
    strokeUnits: 0,
  });
  const rect = shapeSvgMarkup("rect", { fill: "red", stroke: "red", strokeUnits: 0 });
  assert.equal(unknown, rect);
  assert.equal(shapeDef("no-such-shape").id, "rect");
});

test("shape-render: no stroke means no stroke attributes and no inset transform", () => {
  const svg = shapeSvgMarkup("circle", {
    fill: "#abcdef",
    stroke: "#000",
    strokeUnits: 0,
  });
  assert.ok(!svg.includes("stroke="), "no stroke attribute");
  assert.ok(!svg.includes("transform="), "no inset transform");
  assert.ok(svg.includes('fill="#abcdef"'));
  // A negative stroke is treated as none, never as a flipped inset.
  const negative = shapeSvgMarkup("circle", {
    fill: "#abcdef",
    stroke: "#000",
    strokeUnits: -4,
  });
  assert.equal(negative, svg);
});

test("shape-render: a stroke is inset by half its weight so the outline stays inside the frame", () => {
  const svg = shapeSvgMarkup("rect", {
    fill: "#fff",
    stroke: "#0f172a",
    strokeUnits: 10,
  });
  assert.ok(svg.includes('transform="translate(5 5) scale(0.9)"'), svg);
  assert.ok(svg.includes('stroke="#0f172a"'));
  assert.ok(svg.includes('stroke-width="10"'));
  assert.ok(svg.includes('stroke-linejoin="round"'));
  assert.ok(!svg.includes("stroke-dasharray"), "solid by default");
});

test("shape-render: dashed outlines use the shared dash formula", () => {
  assert.equal(dashArrayForUnits(0), undefined);
  assert.equal(dashArrayForUnits(-1), undefined);
  assert.equal(dashArrayForUnits(Number.NaN), undefined);
  // Hairline: clamped to the minimum pattern.
  assert.equal(dashArrayForUnits(1), "4 3");
  // Heavy outline: scales with the stroke weight.
  assert.equal(dashArrayForUnits(10), "16 12");
  const svg = shapeSvgMarkup("rect", {
    fill: "#fff",
    stroke: "#000",
    strokeUnits: 10,
    dash: true,
  });
  assert.ok(svg.includes('stroke-dasharray="16 12"'), svg);
});

test("shape-render: applyRectRadius rounds rect parts per axis and leaves others alone", () => {
  const rect = shapeDef("rect").parts;
  // Unset / zero / negative radius or missing box → untouched reference.
  assert.equal(applyRectRadius(rect, undefined, { w: 50, h: 25 }), rect);
  assert.equal(applyRectRadius(rect, 0, { w: 50, h: 25 }), rect);
  assert.equal(applyRectRadius(rect, -3, { w: 50, h: 25 }), rect);
  assert.equal(applyRectRadius(rect, 5, undefined), rect);

  // 5mm on a 50×25 box → 10 units horizontally, 20 vertically (circular corner).
  const rounded = applyRectRadius(rect, 5, { w: 50, h: 25 });
  assert.notEqual(rounded, rect);
  for (const part of rounded) {
    assert.equal(part.k, "rect");
    if (part.k === "rect") {
      assert.equal(part.rx, 10);
      assert.equal(part.ry, 20);
    }
  }

  // Radius larger than half the box clamps at 50 units (a full pill).
  const pill = applyRectRadius(rect, 100, { w: 50, h: 25 });
  for (const part of pill) if (part.k === "rect") assert.equal(part.rx, 50);

  // Circle geometry has no corners: identical reference back.
  const circle = shapeDef("circle").parts;
  assert.equal(applyRectRadius(circle, 5, { w: 50, h: 50 }), circle);
});

test("shape-render: a corner radius reaches the serialised markup only through rect parts", () => {
  const svg = shapeSvgMarkup("rect", {
    fill: "#fff",
    stroke: "#000",
    strokeUnits: 0,
    radiusMm: 4,
    box: { w: 40, h: 20 },
  });
  assert.ok(svg.includes('rx="10"'), svg);
  assert.ok(svg.includes('ry="20"'), svg);
  const circle = shapeSvgMarkup("circle", {
    fill: "#fff",
    stroke: "#000",
    strokeUnits: 0,
    radiusMm: 4,
    box: { w: 40, h: 20 },
  });
  assert.ok(!circle.includes("rx="), "circle ignores radius");
});

test("shape-render: strokeToUnits uses the geometric mean of the box", () => {
  // 1mm on a 100×100 box → 1 unit.
  assert.equal(strokeToUnits(1, { w: 100, h: 100 }), 1);
  // 1mm on a 25×100 box → sqrt(2500)=50 → 2 units.
  assert.equal(strokeToUnits(1, { w: 25, h: 100 }), 2);
  // Degenerate boxes never divide by zero.
  assert.ok(Number.isFinite(strokeToUnits(1, { w: 0, h: 0 })));
  assert.equal(strokeToUnits(Number.NaN, { w: 10, h: 10 }), 0);
});

test("shape-render: a gradient paints through a sanitised defs id", () => {
  const svg = shapeSvgMarkup("rect", {
    fill: "#fff",
    stroke: "#000",
    strokeUnits: 0,
    gradient: DEFAULT_GRADIENT,
    gradientId: 'evil"><script>',
  });
  assert.ok(svg.includes("<defs>"), "gradient emits defs");
  assert.ok(!svg.includes("<script"), "id characters are scrubbed");
  assert.ok(svg.includes('fill="url(#evilscript)"'), svg);
});

test("shape-render: the same inputs always produce byte-identical markup (canvas ≡ export)", () => {
  const opts = {
    fill: "#336699",
    stroke: "#000000",
    strokeUnits: 3,
    dash: true,
    radiusMm: 2,
    box: { w: 60, h: 30 },
  };
  assert.equal(shapeSvgMarkup("rounded", opts), shapeSvgMarkup("rounded", opts));
});
