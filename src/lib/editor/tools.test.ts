import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasEl } from "./model.ts";
import {
  TOOLS,
  REGION_MODES,
  regionModeDef,
  isRasterElement,
  isRasterTool,
  isRegionArmed,
  ownsCanvas,
  regionKeeps,
  resolveMarqueeMode,
  resolveToolKey,
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

test("the select/crop family is ONE tool — no tool sprawl", () => {
  const ids = Object.keys(TOOLS);
  // One selection tool, two paint tools, two draw tools. Nothing else.
  assert.deepEqual(ids, ["select", "brush", "eraser", "text", "shape"]);
  // Every tool has a label and a hint that explains it in one line.
  for (const id of ids) {
    const def = toolDef(id as keyof typeof TOOLS);
    assert.ok(def.label.length > 1, `${id} needs a label`);
    assert.ok(def.hint.length > 5, `${id} needs a hint`);
  }
  // And the select tool's label mentions BOTH verbs it owns.
  assert.ok(TOOLS.select.label.includes("تحديد"));
  assert.ok(TOOLS.select.label.includes("قص"));
});

test("region modes are options of the select tool, never tools of their own", () => {
  const modeIds = REGION_MODES.map((mode) => mode.id);
  assert.deepEqual(modeIds, ["off", "rect", "square", "ellipse", "lasso"]);
  for (const mode of REGION_MODES) {
    assert.ok(mode.label.length > 0);
    assert.ok(mode.hint.length > 5);
    if (mode.id !== "off") {
      // A non-pointer mode paints a kept region; the pointer does not.
      assert.equal(regionKeeps("select", mode.id), true);
    }
  }
  assert.equal(regionKeeps("select", "off"), false);
  assert.equal(regionKeeps("brush", "rect"), false, "brush has no region");
  assert.equal(isRegionArmed("select", "rect"), true);
  assert.equal(isRegionArmed("select", "off"), false);
  assert.equal(isRegionArmed("eraser", "lasso"), false);
  assert.equal(regionModeDef("nope" as never).id, "off");
});

test("the gesture layer follows family + armed region, not nine tool ids", () => {
  assert.equal(isRasterTool("brush"), true);
  assert.equal(isRasterTool("eraser"), true);
  assert.equal(isRasterTool("select"), false);
  // Only the plain pointer may move elements; an armed region draws over them.
  assert.equal(ownsCanvas("select", "off"), false);
  assert.equal(ownsCanvas("select", "rect"), true);
  assert.equal(ownsCanvas("select", "square"), true);
  assert.equal(ownsCanvas("select", "ellipse"), true);
  assert.equal(ownsCanvas("select", "lasso"), true);
  assert.equal(ownsCanvas("brush", "off"), true);
  assert.equal(ownsCanvas("text", "off"), true);
});

test("the select tool reaches every element; the paint tools only raster", () => {
  assert.equal(toolAccepts("select", el("text")), true);
  assert.equal(toolAccepts("select", el("image")), true);
  assert.equal(toolAccepts("select", el("shape")), true);
  assert.equal(toolAccepts("brush", el("image")), true);
  assert.equal(toolAccepts("brush", el("text")), false);
  assert.equal(toolAccepts("eraser", el("logo")), true);
  assert.equal(toolAccepts("eraser", el("table")), false);
  assert.equal(isRasterElement(el("qr")), true);
  assert.equal(isRasterElement(el("text")), false);
});

test("region modes resolve the marquee; Shift is 1:1, Alt is from centre", () => {
  assert.deepEqual(resolveMarqueeMode("select", "off"), {
    shape: "rect",
    square: false,
    fromCenter: false,
  });
  assert.deepEqual(resolveMarqueeMode("select", "square"), {
    shape: "rect",
    square: true,
    fromCenter: false,
  });
  assert.deepEqual(resolveMarqueeMode("select", "rect", { shift: true, alt: true }), {
    shape: "rect",
    square: true,
    fromCenter: true,
  });
  assert.equal(resolveMarqueeMode("select", "ellipse").shape, "ellipse");
  assert.equal(resolveMarqueeMode("select", "ellipse", { shift: true }).square, true);
  assert.equal(resolveMarqueeMode("select", "lasso").shape, "lasso");
  // Paint tools never draw a region; draw tools always draw a rect box.
  assert.equal(resolveMarqueeMode("brush", "off").shape, null);
  assert.equal(resolveMarqueeMode("text", "off").shape, "rect");
});

test("shortcuts resolve to a tool activation, including the shift variant", () => {
  assert.deepEqual(resolveToolKey("v"), { tool: "select", regionMode: "off" });
  assert.deepEqual(resolveToolKey("m"), { tool: "select", regionMode: "rect" });
  assert.deepEqual(resolveToolKey("m", true), { tool: "select", regionMode: "square" });
  assert.deepEqual(resolveToolKey("l"), { tool: "select", regionMode: "lasso" });
  assert.deepEqual(resolveToolKey("b"), { tool: "brush", regionMode: "off" });
  assert.deepEqual(resolveToolKey("e"), { tool: "eraser", regionMode: "off" });
  assert.deepEqual(resolveToolKey("t"), { tool: "text", regionMode: "off" });
  assert.deepEqual(resolveToolKey("r"), { tool: "shape", regionMode: "off" });
  assert.equal(resolveToolKey("q"), null);
  assert.equal(resolveToolKey("c"), null, "C is the crop ACTION, not a tool key");
});

test("the ONE dropdown's shortcut chips match the keyboard resolution", () => {
  for (const mode of REGION_MODES) {
    if (!mode.shortcut) continue;
    const shift = mode.shortcut.startsWith("⇧");
    const key = (shift ? mode.shortcut.slice(1) : mode.shortcut).toLowerCase();
    assert.deepEqual(resolveToolKey(key, shift), {
      tool: "select",
      regionMode: mode.id,
    });
  }
});

test("tool settings have sane defaults and clamp their inputs", () => {
  const before = toolState();
  assert.equal(before.tool, "select");
  assert.equal(before.regionMode, "off");
  assert.equal(before.brush.sizeMm, DEFAULT_BRUSH.sizeMm);
  assert.equal(before.eraser.sizeMm, DEFAULT_ERASER.sizeMm);
  const { setBrush, setEraser, setCropAspect, setTool, armSelect, setRegion, activate } =
    useTools.getState();
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
  // Arm a region and finish a rectangle on it.
  armSelect("rect");
  assert.equal(toolState().tool, "select");
  assert.equal(toolState().regionMode, "rect");
  setRegion({ pageId: "p", shape: "rect", box: { x: 0, y: 0, w: 10, h: 10 } });
  // Leaving select for a paint tool ends the selection operation entirely.
  setTool("brush");
  assert.equal(toolState().region, null, "painting drops the crop surface");
  assert.equal(toolState().regionMode, "off");
  // The region survives switching between region shapes.
  armSelect("ellipse");
  setRegion({ pageId: "p", shape: "ellipse", box: { x: 1, y: 1, w: 5, h: 5 } });
  armSelect("lasso");
  assert.ok(toolState().region, "the next shape keeps the region editable");
  // Returning to the pointer (the header's main click, Escape's last step)
  // clears the region — the interface returns to its natural state.
  armSelect("off");
  assert.equal(toolState().region, null);
  assert.equal(toolState().regionMode, "off");
  // A keyboard activation arms tool + mode atomically.
  activate({ tool: "select", regionMode: "square" });
  assert.equal(toolState().regionMode, "square");
  activate({ tool: "eraser", regionMode: "square" });
  assert.equal(toolState().tool, "eraser");
  assert.equal(toolState().regionMode, "off", "a paint tool never inherits a region");
  useTools.getState().resetTool();
  assert.equal(toolState().tool, "select");
  assert.equal(toolState().regionMode, "off");
  assert.equal(toolState().painting, false);
});
