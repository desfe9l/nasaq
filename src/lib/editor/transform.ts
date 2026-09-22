/**
 * NASAQ Editor — gesture math for the canvas stage.
 *
 * Pure, DOM-free functions for the two pointer gestures the canvas owns:
 * handle resizing (with aspect preservation) and moving (with grid snap and
 * smart-guide alignment). Keeping the math here makes it unit-testable and
 * keeps `CanvasStage` focused on events and rendering.
 *
 * All coordinates are page millimetres — the same document space the elements
 * live in — never viewport pixels.
 */

import { GRID, MIN_SIZE } from "./model.ts";

/** CSS millimetres to screen pixels at 100% zoom (1mm = 96/25.4 px). */
export const PX_PER_MM = 96 / 25.4;

/**
 * Smart-guide snap radius in *screen* pixels. It is converted to page
 * millimetres through the current zoom (`snapThresholdMm`), so the stickiness
 * a user feels is the same at 25% and at 400% — a fixed millimetre threshold
 * would feel grabby when zoomed in and untouchable when zoomed out.
 */
export const SNAP_THRESHOLD_PX = 7;

/** Convert the screen-space snap radius into document millimetres. */
export function snapThresholdMm(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return SNAP_THRESHOLD_PX / (PX_PER_MM * z);
}

/** Box subset the resize/snap math needs; satisfied by `CanvasEl`. */
export interface GestureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Apply a corner/edge resize to `next` (mutating it), relative to `orig`.
 *
 * `preserveRatio` is the Shift modifier: it keeps the element's *current*
 * aspect ratio (`orig.w / orig.h`) so circles stay circular, squares stay
 * square and images/shapes keep their proportions. It is deliberately the
 * element's own ratio — not a per-shape ideal and not a universal constant;
 * those turn every resized rectangle into a golden-ratio frame and distort
 * whatever the author already drew.
 *
 * The explicit per-element lock (`style.aspectLock`) behaves the same way and
 * is resolved by the caller.
 */
export function resizeByHandle(
  next: GestureBox,
  orig: GestureBox,
  handle: string,
  dx: number,
  dy: number,
  preserveRatio: boolean,
): void {
  if (!preserveRatio) {
    let { x, y, w, h } = orig;
    if (handle.includes("e")) w = orig.w + dx;
    if (handle.includes("s")) h = orig.h + dy;
    if (handle.includes("w")) {
      x = orig.x + dx;
      w = orig.w - dx;
    }
    if (handle.includes("n")) {
      y = orig.y + dy;
      h = orig.h - dy;
    }
    if (w < MIN_SIZE) {
      if (handle.includes("w")) x = orig.x + orig.w - MIN_SIZE;
      w = MIN_SIZE;
    }
    if (h < MIN_SIZE) {
      if (handle.includes("n")) y = orig.y + orig.h - MIN_SIZE;
      h = MIN_SIZE;
    }
    next.x = x;
    next.y = y;
    next.w = w;
    next.h = h;
    return;
  }

  // Proportional scaling: pick the axis the pointer travelled furthest on so
  // the gesture feels 1:1, then derive the other axis from the locked ratio.
  const ratio = orig.w / Math.max(orig.h, MIN_SIZE);
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  let scale = 1;
  if (horizontal && vertical) {
    const widthScale =
      (orig.w + (handle.includes("e") ? dx : -dx)) / Math.max(orig.w, MIN_SIZE);
    const heightScale =
      (orig.h + (handle.includes("s") ? dy : -dy)) / Math.max(orig.h, MIN_SIZE);
    scale =
      Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
        ? widthScale
        : heightScale;
  } else if (horizontal) {
    scale =
      (orig.w + (handle.includes("e") ? dx : -dx)) / Math.max(orig.w, MIN_SIZE);
  } else if (vertical) {
    scale =
      (orig.h + (handle.includes("s") ? dy : -dy)) / Math.max(orig.h, MIN_SIZE);
  }
  // Keep the result on the same side of MIN_SIZE as the scale itself: a
  // negative scale means the pointer crossed the far edge, and clamping the
  // width while keeping a negative height derivative would flip the box.
  const nextW = Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
  const nextH = Math.max(MIN_SIZE, nextW / ratio);
  if (handle.includes("w")) next.x = orig.x + orig.w - nextW;
  else if (handle.includes("e")) next.x = orig.x;
  else next.x = orig.x + (orig.w - nextW) / 2;

  if (handle.includes("n")) next.y = orig.y + orig.h - nextH;
  else if (handle.includes("s")) next.y = orig.y;
  else next.y = orig.y + (orig.h - nextH) / 2;

  next.w = nextW;
  next.h = nextH;
}

/** A box that can act as a snap candidate (any element). */
export interface SnapCandidate extends GestureBox {
  id?: string;
}

/** The guide lines produced by a snap, in page millimetres. */
export interface SnapGuides {
  v: number[];
  h: number[];
}

/**
 * Grid snap plus smart guides for a moved element (mutating `el.x`/`el.y`).
 *
 * `smart` enables alignment to the artboard edges/centre and to every other
 * element's edges and centres; `grid` enables the fixed GRID-mm grid. `zoom`
 * converts the screen-space threshold (see `SNAP_THRESHOLD_PX`) into document
 * units so the behaviour is identical at every zoom level.
 *
 * Returns the guide lines to draw; empty arrays when nothing snapped.
 */
export function applySnap(
  el: GestureBox,
  others: SnapCandidate[],
  size: { w: number; h: number },
  grid: boolean,
  smart: boolean,
  zoom: number,
  moving: Record<string, unknown> = {},
): SnapGuides {
  const v: number[] = [];
  const h: number[] = [];
  if (grid) {
    el.x = Math.round(el.x / GRID) * GRID;
    el.y = Math.round(el.y / GRID) * GRID;
  }
  if (smart) {
    const threshold = snapThresholdMm(zoom);
    // Elements that are moving with this gesture are not candidates: snapping
    // a dragged element to a sibling travelling beside it would fight the drag.
    const stable = others.filter((o) => !moving[o.id as string]);
    const edges = [
      0,
      size.w / 2,
      size.w,
      ...stable.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]),
    ];
    const hedges = [
      0,
      size.h / 2,
      size.h,
      ...stable.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]),
    ];
    const mineV = [el.x, el.x + el.w / 2, el.x + el.w];
    const mineH = [el.y, el.y + el.h / 2, el.y + el.h];
    const nearest = (mine: number[], targets: number[]) => {
      let best: { delta: number; target: number } | null = null;
      for (const m of mine) {
        for (const t of targets) {
          const delta = t - m;
          if (
            Math.abs(delta) <= threshold &&
            (!best || Math.abs(delta) < Math.abs(best.delta))
          ) {
            best = { delta, target: t };
          }
        }
      }
      return best;
    };
    const bestV = nearest(mineV, edges);
    const bestH = nearest(mineH, hedges);
    if (bestV) {
      el.x += bestV.delta;
      v.push(bestV.target);
    }
    if (bestH) {
      el.y += bestH.delta;
      h.push(bestH.target);
    }
  }
  return { v: [...new Set(v)], h: [...new Set(h)] };
}
