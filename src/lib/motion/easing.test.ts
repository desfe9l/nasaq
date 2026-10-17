import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ease,
  easeAreaToRadius,
  easedProgress,
  lerp,
  MOTION_EASE,
  stepAt,
  windowedProgress,
} from "./easing.ts";

describe("motion/easing", () => {
  it("clamps progress into [0,1] at both ends", () => {
    assert.equal(ease(MOTION_EASE, -5), 0);
    assert.equal(ease(MOTION_EASE, 0), 0);
    assert.equal(ease(MOTION_EASE, 1), 1);
    assert.equal(ease(MOTION_EASE, 99), 1);
  });

  it("pins the endpoints regardless of control points", () => {
    for (const curve of [MOTION_EASE, [0.16, 1, 0.3, 1] as const, [0, 0, 1, 1] as const]) {
      assert.equal(ease(curve, 0), 0);
      assert.equal(ease(curve, 1), 1);
    }
  });

  it("is monotonic — no frame ever moves backwards", () => {
    let previous = -Infinity;
    for (let i = 0; i <= 200; i += 1) {
      const value = ease(MOTION_EASE, i / 200);
      assert.ok(
        value >= previous,
        `easing went backwards at progress ${i / 200}: ${value} < ${previous}`,
      );
      previous = value;
    }
  });

  it("is the identity for linear control points", () => {
    for (let i = 0; i <= 20; i += 1) {
      const p = i / 20;
      assert.ok(Math.abs(ease([0, 0, 1, 1], p) - p) < 1e-6);
    }
  });

  it("eases in slowly, then settles decisively (the NASAQ curve shape)", () => {
    // cubic-bezier(.45,0,.15,1) sampled: 0.10→0.021, 0.25→0.207, 0.50→0.791,
    // 0.75→0.964, 0.90→0.995. So it is a slow weighted start, a decisive
    // middle, and a long tail — which is exactly the "camera move" feel.
    assert.ok(ease(MOTION_EASE, 0.1) < 0.1, "must start below the diagonal");
    assert.ok(ease(MOTION_EASE, 0.25) < 0.25, "still weighted at a quarter");
    assert.ok(ease(MOTION_EASE, 0.5) > 0.5, "past the diagonal by halfway");
    assert.ok(ease(MOTION_EASE, 0.75) > 0.9, "most of the move is spent");
    assert.ok(ease(MOTION_EASE, 0.9) < 1, "the settle is not yet over at 0.9");
  });

  it("maps a time window to progress and is defined outside it", () => {
    assert.equal(easedProgress(0, 100, 500), 0);
    assert.equal(easedProgress(100, 100, 500), 0);
    assert.equal(easedProgress(500, 100, 500), 1);
    assert.equal(easedProgress(9999, 100, 500), 1);
    const mid = easedProgress(300, 100, 500);
    assert.ok(mid > 0 && mid < 1);
  });

  it("treats a zero-length window as a step, never a divide-by-zero", () => {
    assert.equal(easedProgress(0, 100, 100), 0);
    assert.equal(easedProgress(100, 100, 100), 1);
    assert.ok(Number.isFinite(easedProgress(50, 100, 100)));
    assert.ok(Number.isFinite(easedProgress(50, 100, 0)));
  });

  it("walks enter → hold → exit and reports the phase", () => {
    const options = { enter: 0.2, hold: 0.6, exit: 0.2 };
    assert.equal(windowedProgress(-1, 0, 1000, options).phase, "before");
    assert.equal(windowedProgress(100, 0, 1000, options).phase, "enter");
    assert.equal(windowedProgress(500, 0, 1000, options).phase, "hold");
    assert.equal(windowedProgress(900, 0, 1000, options).phase, "exit");
    assert.equal(windowedProgress(1001, 0, 1000, options).phase, "after");
    // Hold is exactly full opacity — that is the whole point of a hold.
    assert.equal(windowedProgress(500, 0, 1000, options).value, 1);
  });

  it("returns zero opacity after the window so a layer stops drawing", () => {
    const done = windowedProgress(1001, 0, 1000);
    assert.equal(done.value, 0);
  });

  describe("area easing", () => {
    it("derives radius from area as sqrt", () => {
      assert.equal(easeAreaToRadius(0), 0);
      assert.equal(easeAreaToRadius(1), 1);
      assert.ok(Math.abs(easeAreaToRadius(0.25) - 0.5) < 1e-9);
      assert.ok(Math.abs(easeAreaToRadius(0.5) - Math.SQRT1_2) < 1e-9);
    });

    it("grows faster than the raw area progress early on", () => {
      // This is the whole reason radius is derived rather than eased: at small
      // area the radius is already a sizeable fraction of its final value, so
      // the iris blooms instead of popping.
      const radius = easeAreaToRadius(0.09);
      assert.ok(radius > 0.09, "radius must outpace area early or the iris jumps");
      assert.ok(radius < 1);
    });

    it("clamps out-of-range area", () => {
      assert.equal(easeAreaToRadius(-1), 0);
      assert.equal(easeAreaToRadius(2), 1);
    });
  });

  it("lerps and clamps", () => {
    assert.equal(lerp(10, 20, 0), 10);
    assert.equal(lerp(10, 20, 1), 20);
    assert.equal(lerp(10, 20, 0.5), 15);
    assert.equal(lerp(10, 20, -1), 10);
    assert.equal(lerp(10, 20, 2), 20);
  });

  it("steps discretely for counters and typed glyphs", () => {
    assert.equal(stepAt(0, 100), 0);
    assert.equal(stepAt(99, 100), 0);
    assert.equal(stepAt(100, 100), 1);
    assert.equal(stepAt(250, 100, 50), 2);
    assert.equal(stepAt(50, 0), 0);
  });
});