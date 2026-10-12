/**
 * Floating-panel clamping (the six-window workspace).
 *
 * A panel dragged off-screen, or one whose stored geometry no longer fits a
 * smaller viewport, is unreachable: the author cannot grab it back. `clampPanel`
 * is the single guard, so it is pinned here for each way a viewport can shrink
 * — including the tablet breakpoint where the floating panels replace the
 * docked columns.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { clampPanel } from "./panel-geometry.ts";

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 1024, height: 768 };
const NARROW = { width: 420, height: 720 };

test("a panel that already fits is left exactly where it is", () => {
  const rect = { left: 300, top: 120, width: 340, height: 500 };
  assert.deepEqual(clampPanel(rect, DESKTOP), rect);
});

test("a panel dragged past the right/bottom edge comes back inside", () => {
  const clamped = clampPanel(
    { left: 1400, top: 880, width: 340, height: 500 },
    DESKTOP,
  );
  assert.equal(clamped.left + clamped.width, DESKTOP.width - 8);
  assert.equal(clamped.top + clamped.height, DESKTOP.height - 8);
});

test("a panel dragged past the left/top edge gets a reachable grab area", () => {
  const clamped = clampPanel(
    { left: -200, top: -80, width: 340, height: 500 },
    DESKTOP,
  );
  assert.equal(clamped.left, 8);
  assert.equal(clamped.top, 8, "the header must stay grabbable");
});

test("minima protect the panel from being resized into nothing", () => {
  const clamped = clampPanel({ left: 20, top: 20, width: 40, height: 10 }, DESKTOP);
  assert.equal(clamped.width, 240, "240px minimum width");
  assert.equal(clamped.height, 80, "80px minimum height");
});

test("a tablet viewport shrinks the panel rather than letting it overflow", () => {
  const clamped = clampPanel({ left: 0, top: 0, width: 600, height: 700 }, TABLET);
  assert.ok(
    clamped.left + clamped.width <= TABLET.width - 8,
    `${clamped.width}px wide must fit ${TABLET.width}px`,
  );
  assert.ok(
    clamped.top + clamped.height <= TABLET.height - 8,
    `${clamped.height}px tall must fit ${TABLET.height}px`,
  );
});

test("a viewport narrower than the minimum still returns usable numbers", () => {
  const clamped = clampPanel({ left: 100, top: 100, width: 340, height: 500 }, { width: 200, height: 300 });
  assert.ok(Number.isFinite(clamped.width) && clamped.width >= 0);
  assert.ok(clamped.width <= 200, "never wider than the viewport");
  assert.ok(clamped.height <= 300, "never taller than the viewport");
  assert.ok(clamped.left >= 0 && clamped.top >= 0);
});

test("the custom top offset is honoured but never becomes unreachable", () => {
  const clamped = clampPanel(
    { left: 100, top: 0, width: 340, height: 400 },
    DESKTOP,
    64,
  );
  assert.equal(clamped.top, 64, "the header offset is respected");
  /* …but on a short viewport the offset must yield to reachability. */
  const short = clampPanel({ left: 0, top: 0, width: 340, height: 400 }, { width: 1440, height: 100 }, 64);
  assert.ok(short.top <= 20, `top ${short.top} leaves the panel on screen`);
});

test("a panel already inside a narrow viewport keeps its position", () => {
  const rect = { left: 10, top: 10, width: 300, height: 400 };
  assert.deepEqual(clampPanel(rect, NARROW), rect);
});
