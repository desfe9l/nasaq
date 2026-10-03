import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasEl } from "./model.ts";
import {
  TOOLS,
  TOOL_GROUPS,
  TOOL_ORDER,
  isMarqueeTool,
  isRasterElement,
  isRasterTool,
  ownsCanvas,
  resolveMarqueeMode,
  resolveToolShortcut,
  toolAccepts,
  toolDef,
} from "./tools.ts";
import {
  DEFAULT_BRUSH,
  DEFAULT_ERASER,
  cropAspectRatio,
  toolState,
  useTools,
} from "./tool-store.ts";

const el = (type: CanvasEl["type"]) => ({ type });

test("every tool has a label, a hint and a family", () => {
  for (const id of TOOL_ORDER)
    assert.ok(TOOLS[id], `${id} missing`);
  for (const id of TOOL_ORDER) {
    const def = TOOL_ORDER.includes(id) ? TOOLS[id]! : null;
    assert.ok(def);
    assert.ok(def.label.length > 1);
    assert.ok(def.hint.length > 5);
  }
  // The toolbar renders exactly the groups, in order, with no duplicates.
  const flat = TOOL_GROUPS.flat();
  assert.deepEqual(flat, TOOL_ORDER);
  assert.equal(new Set(flat).size, flat.length);
});

test("tool families drive the shared gesture layer", () => {
  assert.equal(isMarqueeTool("marquee-ellipse"), true);
  assert.equal(isMarqueeTool("select"), false);
  assert.equal(isRasterTool("brush"), true);
  assert.equal(isRasterTool("eraser"), true);
  assert.equal(isRasterTool("crop"), false);
  // Only the pointer tools may move elements by dragging.
  assert.equal(ownsCanvas("select"), false);
  assert.equal(ownsCanvas("select-layer"), false);
  assert.equal(ownsCanvas("marquee-rect"), true);
  assert.equal(ownsCanvas("brush"), true);
  assert.equal(ownsCanvas("crop"), true);
  assert.equal(ownsCanvas("text"), true);
});

test("selection scope decides which elements a tool can touch", () => {
  assert.equal(toolAccepts("select", el("text")), true);
  assert.equal(toolAccepts("select-shape", el("shape")), true);
  assert.equal(toolAccepts("select-shape", el("text")), false);
  assert.equal(toolAccepts("select-image", el("image")), true);
  assert.equal(toolAccepts("select-image", el("shape")), false);
  // Any object at all is a layer.
  assert.equal(toolAccepts("select-layer", el("table")), true);
  assert.equal(isRasterElement(el("image")), true);
  assert.equal(isRasterElement(el("logo")), true);
  assert.equal(isRasterElement(el("shape")), false);
});

test("modifier keys resolve per tool: Shift = 1:1, Alt = from centre", () => {
  assert.deepEqual(resolveMarqueeMode("marquee-square"), {
    shape: "rect",
    square: true,
    fromCenter: false,
  });
  assert.deepEqual(resolveMarqueeMode("marquee-rect", { shift: true, alt: true }), {
    shape: "rect",
    square: true,
    fromCenter: true,
  });
  assert.deepEqual(resolveMarqueeMode("marquee-ellipse"), {
    shape: "ellipse",
    square: false,
    fromCenter: false,
  });
  assert.deepEqual(resolveMarqueeMode("lasso").shape, "lasso");
  assert.equal(resolveMarqueeMode("brush").shape, null);
});

test("the rectangle and square tools are genuinely different tools", () => {
  assert.notEqual(TOOLS["marquee-rect"].id, TOOLS["marquee-square"].id);
  assert.equal(TOOLS["marquee-rect"].square, undefined);
  assert.equal(TOOLS["marquee-square"].square, true);
  assert.equal(toolDef("marquee-square").label.includes("مربع"), true);
  assert.equal(toolDef("marquee-rect").label.includes("مستطيل"), true);
});

test("shortcuts resolve from the tool table, including the shift variant", () => {
  assert.equal(resolveToolShortcut("v"), "select");
  assert.equal(resolveToolShortcut("m"), "marquee-rect");
  assert.equal(resolveToolShortcut("m", true), "marquee-square");
  assert.equal(resolveToolShortcut("l"), "lasso");
  assert.equal(resolveToolShortcut("c"), "crop");
  assert.equal(resolveToolShortcut("b"), "brush");
  assert.equal(resolveToolShortcut("e"), "eraser");
  assert.equal(resolveToolShortcut("t"), "text");
  assert.equal(resolveToolShortcut("r"), "shape");
  assert.equal(resolveToolShortcut("q"), null);
});

test("tool settings have sane defaults and clamp their inputs", () => {
  const before = toolState();
  assert.equal(before.tool, "select");
  assert.equal(before.brush.sizeMm, DEFAULT_BRUSH.sizeMm);
  assert.equal(before.eraser.sizeMm, DEFAULT_ERASER.sizeMm);
  const { setBrush, setEraser, setCropAspect, setTool, setRegion } = useTools.getState();
  setBrush({ sizeMm: 5000, hardness: 4, opacity: -1, color: "not-a-colour" });
  const brush = toolState().brush;
  assert.ok(brush.sizeMm <= 120 && brush.sizeMm >= 0.5);
  assert.equal(brush.hardness, 1);
  assert.ok(brush.opacity >= 0.02);
  assert.equal(brush.color, DEFAULT_BRUSH.color);
  setEraser({ sizeMm: Number.NaN, hardness: 0.5, opacity: 0.5 });
  assert.ok(Number.isFinite(toolState().eraser.sizeMm));
  setCropAspect("16:9");
  assert.equal(cropAspectRatio(toolState().cropAspect), 16 / 9);
  setCropAspect("nonsense" as never);
  assert.equal(toolState().cropAspect, "free");
  setRegion({ pageId: "p", shape: "rect", box: { x: 0, y: 0, w: 10, h: 10 } });
  setTool("brush");
  assert.ok(toolState().region, "choosing a tool keeps the region for cropping");
  setTool("select");
  assert.equal(toolState().region, null, "the pointer tool drops the region");
  useTools.getState().resetTool();
  assert.equal(toolState().tool, "select");
  assert.equal(toolState().painting, false);
});
