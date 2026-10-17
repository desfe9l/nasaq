/**
 * Easing for the NASAQ Motion Studio.
 *
 * Every animation in the studio is *deterministic and seekable*: a frame is a
 * pure function of time (`seek(t)`), never an accumulator that is stepped
 * forward. That contract only holds if the easing functions themselves are
 * pure and reproducible, which is why nothing here touches `Date`, a rAF
 * timestamp, or any mutable module state.
 *
 * The default curve is the one the NASAQ motion system uses everywhere:
 * `cubic-bezier(.45, 0, .15, 1)`. It is deliberately asymmetric — a slow,
 * weighted start with a long, decisive settle. Symmetric easings (`ease-in-out`,
 * a plain sine) read as "UI animation" and make logo and wordmark motion look
 * like a dialog closing. This curve is the one verified in the reference
 * Arabic launch templates, and it is what makes a morph feel like a camera
 * move rather than a cross-fade.
 */

/** A CSS-style cubic-bezier control pair: `[x1, y1, x2, y2]`. */
export type Easing = readonly [number, number, number, number];

/**
 * The NASAQ motion curve. Slow weighted entry, long decisive settle.
 * All motion presets default to this.
 */
export const MOTION_EASE: Easing = [0.45, 0, 0.15, 1];

/** Linear — only correct for continuous, non-staged motion (rotations, sweeps). */
export const LINEAR: Easing = [0, 0, 1, 1];

/** Quick, confident exit used when a layer is being removed from a scene. */
export const EASE_OUT: Easing = [0.16, 1, 0.3, 1];

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

/**
 * Solve the x-component of the cubic Bézier, i.e. the `t` in a parametric
 * curve at which the horizontal coordinate reaches `x`.
 *
 * `x(t)` is monotonic on [0,1] for any well-formed control points, so a
 * bisection converges reliably. Newton–Raphson alone is faster but is not used
 * here: with near-vertical control segments the derivative can be ~0 and it
 * overshoots into the wrong frame. Frame-exact output matters more than the
 * microseconds, so this is pure bisection with a fixed iteration budget.
 */
const solveTForX = (x: number, x1: number, x2: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Linear control points are the common case; skip the search entirely.
  if (x1 === x2) return x;

  let low = 0;
  let high = 1;
  let mid = x;
  for (let i = 0; i < 64; i += 1) {
    mid = (low + high) / 2;
    const value = bezierComponent(mid, 0, x1, x2, 1);
    if (value < x) low = mid;
    else high = mid;
    if (Math.abs(value - x) < 1e-7) break;
  }
  return mid;
};

/**
 * One axis of a cubic Bézier, evaluated with the standard
 * `P0, P1, P2, P3` Bernstein basis.
 */
const bezierComponent = (
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number => {
  const u = 1 - t;
  // Expanded form — faster than the naive three-term version and allocation-free.
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
};

/**
 * Evaluate an easing curve at `progress` ∈ [0,1].
 *
 * `progress` is clamped, so callers may pass an unclamped
 * `elapsed / duration` from a timeline that overshot its scene and get a
 * well-defined end state rather than an extrapolation.
 */
export const ease = (easing: Easing, progress: number): number => {
  const x = clamp01(progress);
  const [x1, y1, x2, y2] = easing;
  if (x1 === y1 && x2 === y2) return x;
  const t = solveTForX(x, x1, x2);
  return bezierComponent(t, 0, y1, y2, 1);
};

/**
 * Map a time window onto an eased progress value.
 *
 * This is the single entry point the whole studio uses to turn "what time is
 * it" into "how far along is this layer". Before `startMs` it returns 0 and
 * after `endMs` it returns 1, so a layer's state is defined at every instant
 * of the timeline — including the frames before it enters and after it leaves.
 * No layer ever has to ask "am I active yet".
 */
export const easedProgress = (
  timeMs: number,
  startMs: number,
  endMs: number,
  easing: Easing = MOTION_EASE,
): number => {
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    return timeMs >= endMs ? 1 : 0;
  }
  if (timeMs <= startMs) return 0;
  if (timeMs >= endMs) return 1;
  return ease(easing, (timeMs - startMs) / (endMs - startMs));
};

/**
 * Eased progress clamped to a sub-window of its own span — the "enter 0→1,
 * hold, leave 1→0" shape used by scene layers.
 */
export const windowedProgress = (
  timeMs: number,
  startMs: number,
  endMs: number,
  options: { enter?: number; hold?: number; exit?: number } = {},
  easing: Easing = MOTION_EASE,
): { value: number; phase: "before" | "enter" | "hold" | "exit" | "after" } => {
  const { enter = 0.18, hold = 0.64, exit = 0.18 } = options;
  const total = enter + hold + exit;
  const p = easedProgress(timeMs, startMs, endMs, LINEAR);

  if (p <= 0) return { value: 0, phase: "before" };
  if (p >= 1) return { value: 0, phase: "after" };

  const enterEnd = enter / total;
  const exitStart = (enter + hold) / total;

  if (p < enterEnd) {
    return { value: ease(easing, p / enterEnd), phase: "enter" };
  }
  if (p < exitStart) {
    return { value: 1, phase: "hold" };
  }
  return {
    value: 1 - ease(easing, (p - exitStart) / (exit / total)),
    phase: "exit",
  };
};

/**
 * Ease an **area** rather than a radius.
 *
 * This exists because of a real failure mode in the reference launch
 * templates: easing the iris *radius* makes the very first frames jump. At
 * `r → 0` the radius is nearly flat in perceived terms while the disc it
 * encloses is changing enormously, so an eased radius pops open instead of
 * blooming. Easing the enclosed area keeps the perceived rate of change even,
 * and the opening reads as a camera iris rather than a scaling circle.
 *
 * Given a normalised area progress `p`, this returns the radius of a disc of
 * area `p` relative to the disc of area 1: `√p`.
 */
export const easeAreaToRadius = (areaProgress: number): number =>
  Math.sqrt(clamp01(areaProgress));

/** Linear interpolation. */
export const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * clamp01(t);

/**
 * A discrete, frame-quantised step with a smooth edge — used for counters and
 * typed glyphs so a digit changes on a frame boundary rather than smearing
 * across a motion-blur subframe.
 */
export const stepAt = (timeMs: number, intervalMs: number, offsetMs = 0): number => {
  if (intervalMs <= 0) return 0;
  return Math.floor((timeMs - offsetMs) / intervalMs);
};