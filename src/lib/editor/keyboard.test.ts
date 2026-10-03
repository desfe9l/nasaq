import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANVAS_LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  canRunShortcutInScope,
  hasExceededLongPressSlop,
  resolveEscapeStep,
  shortcutHint,
  shortcutKey,
  shouldArmCanvasLongPress,
  startLongPressTimer,
  stepBrushSizeMm,
} from "./keyboard.ts";

test("existing selection/tool shortcuts keep physical bindings on Arabic keyboards", () => {
  for (const [key, code, expected] of [
    ["ش", "KeyA", "a"],
    ["ر", "KeyV", "v"],
    ["ف", "KeyT", "t"],
    ["ق", "KeyR", "r"],
    ["ن", "KeyK", "k"],
    ["[", "BracketLeft", "["],
  ]) {
    assert.equal(shortcutKey({ key, code }), expected);
  }
});

test("Latin bindings, zoom symbols and navigation are not remapped", () => {
  for (const key of ["a", "A", "+", "-", "0", "Escape", "ArrowRight"]) {
    assert.equal(shortcutKey({ key, code: "" }), key.toLowerCase());
  }
});

test("shortcut hints use the host platform modifier", () => {
  assert.equal(shortcutHint("⌘ A", "Win32"), "Ctrl+A");
  assert.equal(shortcutHint("⌘ ⇧ G", "Linux"), "Ctrl+Shift+G");
  assert.equal(shortcutHint("⌘ A", "MacIntel"), "⌘ A");
  assert.equal(shortcutHint("⇧⌘Z", "MacIntel"), "⇧⌘Z");
  assert.equal(shortcutHint("⇧⌘Z", "Win32"), "Shift+Ctrl+Z");
});

test("shouldArmCanvasLongPress respects active tool, pointerType, and context", () => {
  assert.equal(
    shouldArmCanvasLongPress({
      pointerType: "pen",
      tool: "select",
      regionMode: "off",
    }),
    true,
  );
  assert.equal(
    shouldArmCanvasLongPress({
      pointerType: "touch",
      tool: "select",
      regionMode: "off",
    }),
    true,
  );
  assert.equal(
    shouldArmCanvasLongPress({
      pointerType: "mouse",
      tool: "select",
      regionMode: "off",
    }),
    false,
    "mouse uses right-click contextmenu",
  );
  for (const tool of ["brush", "eraser", "text", "shape"] as const) {
    assert.equal(
      shouldArmCanvasLongPress({
        pointerType: "pen",
        tool,
        regionMode: "off",
      }),
      false,
      `${tool} must never arm canvas long-press`,
    );
  }
  for (const regionMode of ["rect", "square", "ellipse", "lasso"] as const) {
    assert.equal(
      shouldArmCanvasLongPress({
        pointerType: "pen",
        tool: "select",
        regionMode,
      }),
      false,
      `region mode ${regionMode} must never arm canvas long-press`,
    );
  }
  assert.equal(
    shouldArmCanvasLongPress({
      pointerType: "touch",
      tool: "select",
      regionMode: "off",
      cropActive: true,
    }),
    false,
  );
});

test("startLongPressTimer cancels when movement exceeds threshold", async () => {
  let fired = false;
  let cancelled = false;
  const handle = startLongPressTimer({
    startX: 100,
    startY: 100,
    delayMs: 30,
    onTrigger: () => {
      fired = true;
    },
    onCancel: () => {
      cancelled = true;
    },
  });
  assert.equal(hasExceededLongPressSlop({ x: 100, y: 100 }, { x: 103, y: 100 }), false);
  assert.equal(handle.move(103, 100), true);
  assert.equal(
    hasExceededLongPressSlop(
      { x: 100, y: 100 },
      { x: 100 + LONG_PRESS_SLOP_PX, y: 100 },
    ),
    true,
  );
  assert.equal(handle.move(100 + LONG_PRESS_SLOP_PX, 100), false);
  assert.equal(cancelled, true);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(fired, false);
  assert.equal(CANVAS_LONG_PRESS_MS, 550);
});

test("resolveEscapeStep steps out one layer at a time without overlap", () => {
  const base = {
    interactionBusy: false,
    painting: false,
    layerPickerOpen: false,
    cropActive: false,
    hasRegion: false,
    tool: "select" as const,
    regionMode: "off" as const,
    isDesktop: true,
    anyFloatingPanelOpen: false,
    enteredGroupId: null,
    selectedCount: 0,
  };
  assert.equal(
    resolveEscapeStep({ ...base, painting: true, tool: "brush", selectedCount: 2 }),
    "cancel-interaction",
  );
  assert.equal(
    resolveEscapeStep({ ...base, layerPickerOpen: true, selectedCount: 1 }),
    "close-layer-picker",
  );
  assert.equal(
    resolveEscapeStep({ ...base, cropActive: true, selectedCount: 1 }),
    "cancel-crop",
  );
  assert.equal(
    resolveEscapeStep({ ...base, hasRegion: true, regionMode: "rect" }),
    "clear-region",
  );
  assert.equal(
    resolveEscapeStep({ ...base, tool: "eraser", selectedCount: 1 }),
    "reset-tool",
  );
  assert.equal(
    resolveEscapeStep({
      ...base,
      isDesktop: false,
      anyFloatingPanelOpen: true,
      selectedCount: 1,
    }),
    "close-floating-panels",
  );
  assert.equal(
    resolveEscapeStep({ ...base, enteredGroupId: "g1", selectedCount: 1 }),
    "exit-group",
  );
  assert.equal(
    resolveEscapeStep({ ...base, selectedCount: 1 }),
    "clear-selection",
  );
  assert.equal(resolveEscapeStep(base), "none");
});

test("canRunShortcutInScope separates app shortcuts from canvas shortcuts", () => {
  const idle = {
    editableTarget: false,
    modalOpen: false,
    interactionBusy: false,
    painting: false,
    cropActive: false,
  };
  assert.equal(canRunShortcutInScope("app", idle), true);
  assert.equal(canRunShortcutInScope("canvas", idle), true);
  assert.equal(
    canRunShortcutInScope("app", { ...idle, editableTarget: true }),
    true,
    "app shortcuts like Cmd+S still work inside text fields",
  );
  assert.equal(
    canRunShortcutInScope("canvas", { ...idle, editableTarget: true }),
    false,
    "canvas shortcuts yield to text fields",
  );
  assert.equal(
    canRunShortcutInScope("canvas", { ...idle, painting: true }),
    false,
    "canvas shortcuts are blocked during live brush/eraser stroke",
  );
});

test("stepBrushSizeMm steps and clamps brush/eraser diameter cleanly", () => {
  assert.equal(stepBrushSizeMm(0.5, -1), 0.5);
  assert.equal(stepBrushSizeMm(4, 1), 4.5);
  assert.equal(stepBrushSizeMm(10, 1), 11);
  assert.equal(stepBrushSizeMm(20, 1), 22);
  assert.equal(stepBrushSizeMm(60, 1), 60);
});
