/**
 * NASAQ — dock edge preference + long-press drag arming tests.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PANEL_DRAG_HOLD_MS,
  resolveDockEdge,
  pressArmsDrag,
} from "./workspace-dock.ts";

test("auto follows the interface direction", () => {
  assert.equal(resolveDockEdge("auto", "rtl"), "right");
  assert.equal(resolveDockEdge("auto", "ltr"), "left");
});

test("explicit preferences beat the direction", () => {
  assert.equal(resolveDockEdge("right", "rtl"), "right");
  assert.equal(resolveDockEdge("right", "ltr"), "right");
  assert.equal(resolveDockEdge("left", "rtl"), "left");
  assert.equal(resolveDockEdge("left", "ltr"), "left");
});

test("a plain click never arms the window drag", () => {
  assert.equal(pressArmsDrag({ heldMs: 0, movedPx: 0 }), false);
  assert.equal(pressArmsDrag({ heldMs: 120, movedPx: 0 }), false);
  assert.equal(pressArmsDrag({ heldMs: PANEL_DRAG_HOLD_MS, movedPx: 0 }), true);
  assert.equal(pressArmsDrag({ heldMs: 4000, movedPx: 0 }), true);
});

test("a travelling press is a scroll or a click, not a hold", () => {
  assert.equal(pressArmsDrag({ heldMs: 900, movedPx: 7 }), false);
  assert.equal(pressArmsDrag({ heldMs: 900, movedPx: 6 }), true, "slop edge");
  assert.equal(
    pressArmsDrag({ heldMs: 900, movedPx: 20, slopPx: 24 }),
    true,
    "a caller-supplied slop is honoured",
  );
});
