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
/**
 * Map a handle to the handle it *behaves* as on a mirrored element (step 7).
 *
 * `scaleX(-1)` moves the `nw` grip to the visual right edge: the author grabs
 * what looks like the top-right corner, so the resize must grow from that side.
 * Swapping the axis letters is exactly equivalent to inverting dx/dy for the
 * axes the handle actually uses, and leaves the geometry maths untouched.
 */
export function mirrorHandle(handle: string, flipX: boolean, flipY: boolean): string {
  let out = "";
  for (const ch of handle) {
    if (ch === "e" && flipX) out += "w";
    else if (ch === "w" && flipX) out += "e";
    else if (ch === "n" && flipY) out += "s";
    else if (ch === "s" && flipY) out += "n";
    else out += ch;
  }
  // Letter order is preserved (and irrelevant to `resizeByHandle`, which uses
  // `includes`), so "nw" maps to "ne" and stays readable.
  return out;
}

export function resizeByHandle(
  next: GestureBox,
  orig: GestureBox,
  handle: string,
  dx: number,
  dy: number,
  preserveRatio: boolean,
  locks?: { widthLocked?: boolean; heightLocked?: boolean },
): void {
  const wLocked = Boolean(locks?.widthLocked);
  const hLocked = Boolean(locks?.heightLocked);

  if (!preserveRatio) {
    let { x, y, w, h } = orig;
    if (!wLocked) {
      if (handle.includes("e")) w = orig.w + dx;
      if (handle.includes("w")) {
        x = orig.x + dx;
        w = orig.w - dx;
      }
    }
    if (!hLocked) {
      if (handle.includes("s")) h = orig.h + dy;
      if (handle.includes("n")) {
        y = orig.y + dy;
        h = orig.h - dy;
      }
    }
    if (w < MIN_SIZE) {
      if (!wLocked && handle.includes("w")) x = orig.x + orig.w - MIN_SIZE;
      w = MIN_SIZE;
    }
    if (h < MIN_SIZE) {
      if (!hLocked && handle.includes("n")) y = orig.y + orig.h - MIN_SIZE;
      h = MIN_SIZE;
    }
    next.x = x;
    next.y = y;
    next.w = w;
    next.h = h;
    return;
  }

  const ratio = orig.w / Math.max(orig.h, MIN_SIZE);
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  let scale = 1;
  if (wLocked && hLocked) {
    next.x = orig.x;
    next.y = orig.y;
    next.w = orig.w;
    next.h = orig.h;
    return;
  }
  if (horizontal && vertical) {
    if (wLocked) {
      const heightScale =
        (orig.h + (handle.includes("s") ? dy : -dy)) / Math.max(orig.h, MIN_SIZE);
      scale = heightScale;
    } else if (hLocked) {
      const widthScale =
        (orig.w + (handle.includes("e") ? dx : -dx)) / Math.max(orig.w, MIN_SIZE);
      scale = widthScale;
    } else {
      const widthScale =
        (orig.w + (handle.includes("e") ? dx : -dx)) / Math.max(orig.w, MIN_SIZE);
      const heightScale =
        (orig.h + (handle.includes("s") ? dy : -dy)) / Math.max(orig.h, MIN_SIZE);
      scale =
        Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
          ? widthScale
          : heightScale;
    }
  } else if (horizontal) {
    if (wLocked) {
      next.x = orig.x;
      next.y = orig.y;
      next.w = orig.w;
      next.h = orig.h;
      return;
    }
    scale =
      (orig.w + (handle.includes("e") ? dx : -dx)) / Math.max(orig.w, MIN_SIZE);
  } else if (vertical) {
    if (hLocked) {
      next.x = orig.x;
      next.y = orig.y;
      next.w = orig.w;
      next.h = orig.h;
      return;
    }
    scale =
      (orig.h + (handle.includes("s") ? dy : -dy)) / Math.max(orig.h, MIN_SIZE);
  }
  const nextW = wLocked ? orig.w : Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
  const nextH = hLocked ? orig.h : Math.max(MIN_SIZE, (wLocked ? orig.h * Math.max(scale, 0.01) : nextW / ratio));
  let finalW = nextW;
  let finalH = nextH;
  if (wLocked && !hLocked) {
    finalH = Math.max(MIN_SIZE, orig.h * Math.max(scale, 0.01));
    finalW = orig.w;
  } else if (!wLocked && hLocked) {
    finalW = Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
    finalH = orig.h;
  } else if (!wLocked && !hLocked) {
    finalW = nextW;
    finalH = nextH;
  }

  if (handle.includes("w")) next.x = orig.x + orig.w - finalW;
  else if (handle.includes("e")) next.x = orig.x;
  else next.x = orig.x + (orig.w - finalW) / 2;

  if (handle.includes("n")) next.y = orig.y + orig.h - finalH;
  else if (handle.includes("s")) next.y = orig.y;
  else next.y = orig.y + (orig.h - finalH) / 2;

  next.w = finalW;
  next.h = finalH;
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
    /*
     * تباعد متساوٍ (equal spacing): when the moving box sits between two
     * neighbours in the same row/column, snap it so both gaps are identical —
     * the classic "distribute while dragging". Only fires when no edge/centre
     * snap claimed that axis, so the common alignment case keeps priority,
     * and only inside the same screen-scale threshold as every other snap.
     */
    if (!bestV) {
      const overlapV = (o: SnapCandidate) =>
        o.y < el.y + el.h && o.y + o.h > el.y;
      let left: SnapCandidate | null = null;
      let right: SnapCandidate | null = null;
      for (const o of stable) {
        if (!overlapV(o)) continue;
        if (o.x + o.w <= el.x + threshold && (!left || o.x + o.w > left.x + left.w))
          left = o;
        if (o.x >= el.x + el.w - threshold && (!right || o.x < right.x)) right = o;
      }
      if (left && right) {
        const span = right.x - (left.x + left.w);
        const gap = (span - el.w) / 2;
        if (gap >= 0) {
          const ideal = left.x + left.w + gap;
          if (Math.abs(el.x - ideal) <= threshold) {
            el.x = ideal;
            v.push(left.x + left.w + gap / 2, el.x + el.w + gap / 2);
          }
        }
      }
    }
    if (!bestH) {
      const overlapH = (o: SnapCandidate) =>
        o.x < el.x + el.w && o.x + o.w > el.x;
      let above: SnapCandidate | null = null;
      let below: SnapCandidate | null = null;
      for (const o of stable) {
        if (!overlapH(o)) continue;
        if (o.y + o.h <= el.y + threshold && (!above || o.y + o.h > above.y + above.h))
          above = o;
        if (o.y >= el.y + el.h - threshold && (!below || o.y < below.y)) below = o;
      }
      if (above && below) {
        const span = below.y - (above.y + above.h);
        const gap = (span - el.h) / 2;
        if (gap >= 0) {
          const ideal = above.y + above.h + gap;
          if (Math.abs(el.y - ideal) <= threshold) {
            el.y = ideal;
            h.push(above.y + above.h + gap / 2, el.y + el.h + gap / 2);
          }
        }
      }
    }
  }
  return { v: [...new Set(v)], h: [...new Set(h)] };
}

/**
 * Snap a RESIZED box: the edges the author is actually dragging line up with
 * the artboard, object edges/centres (smart) and the grid — while the opposite,
 * anchored edge stays exactly where it is.
 *
 * `handle` selects which edges are live (`"se"` = right+bottom, `"e"` =
 * right, …); non-live edges are never nudged, so a resize anchored on its
 * left edge can never drift left. Mutates `box` and returns the guides, same
 * contract as `applySnap`.
 */
export function applyResizeSnap(
  box: GestureBox,
  handle: string,
  others: SnapCandidate[],
  size: { w: number; h: number },
  grid: boolean,
  smart: boolean,
  zoom: number,
): SnapGuides {
  const v: number[] = [];
  const h: number[] = [];
  const liveLeft = handle.includes("w");
  const liveRight = handle.includes("e");
  const liveTop = handle.includes("n");
  const liveBottom = handle.includes("s");
  const threshold = snapThresholdMm(zoom);

  const edgesFor = (axis: "x" | "y", extent: number) =>
    axis === "x"
      ? [0, extent / 2, extent, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])]
      : [0, extent / 2, extent, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];

  const nearest = (value: number, targets: number[]) => {
    let best: { delta: number; target: number } | null = null;
    for (const t of targets) {
      const delta = t - value;
      if (
        Math.abs(delta) <= threshold &&
        (!best || Math.abs(delta) < Math.abs(best.delta))
      ) {
        best = { delta, target: t };
      }
    }
    return best;
  };

  // Grid first (unconditional, same as move), then smart guides win if closer.
  if (grid) {
    if (liveLeft) {
      const gx = Math.round(box.x / GRID) * GRID;
      box.w += box.x - gx;
      box.x = gx;
    }
    if (liveRight) box.w = Math.round((box.x + box.w) / GRID) * GRID - box.x;
    if (liveTop) {
      const gy = Math.round(box.y / GRID) * GRID;
      box.h += box.y - gy;
      box.y = gy;
    }
    if (liveBottom) box.h = Math.round((box.y + box.h) / GRID) * GRID - box.y;
  }
  if (smart) {
    const xTargets = edgesFor("x", size.w);
    const yTargets = edgesFor("y", size.h);
    if (liveLeft) {
      const best = nearest(box.x, xTargets);
      if (best) {
        box.x += best.delta;
        box.w -= best.delta;
        v.push(best.target);
      }
    } else if (liveRight) {
      const best = nearest(box.x + box.w, xTargets);
      if (best) {
        box.w += best.delta;
        v.push(best.target);
      }
    }
    if (liveTop) {
      const best = nearest(box.y, yTargets);
      if (best) {
        box.y += best.delta;
        box.h -= best.delta;
        h.push(best.target);
      }
    } else if (liveBottom) {
      const best = nearest(box.y + box.h, yTargets);
      if (best) {
        box.h += best.delta;
        h.push(best.target);
      }
    }
  }
  return { v: [...new Set(v)], h: [...new Set(h)] };
}
