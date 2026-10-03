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
import { PX_PER_MM } from "./render-units.ts";
export { PX_PER_MM } from "./render-units.ts";

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
 * ── One transformation model, every shape type ─────────────────────────────
 *
 * An element is always `x/y/w/h` (its unrotated box, in page mm) plus a
 * `rotation` in degrees. The box is the artwork: every shape renders its
 * geometry edge-to-edge inside it (the shared 100×100 geometry stretched with
 * `preserveAspectRatio="none"`), so what is visible IS the box and nothing
 * ever renders inside a letterbox or outside it. All gesture maths therefore
 * run on that single representation:
 *
 *  · position — page translation, rotation-invariant;
 *  · rotation — about the box centre, the CSS `transform-origin`; the centre
 *    never moves and `x/y/w/h` are untouched by a rotate;
 *  · resize — the pointer delta is projected onto the element's LOCAL axes
 *    (`toLocalDelta`) before `resizeByHandle` runs, so a grabbed corner
 *    tracks the pointer at every rotation, and `w/h` stay exactly the
 *    rendered box (a circle resized square stays a circle, resized freeform
 *    becomes the box's ellipse — never a box and a shape that disagree);
 *  · snapping — axis-aligned boxes snap their own edges (they are the visual
 *    edges); a rotated box has no page-parallel edges, so it snaps its
 *    rotation-invariant references instead — the axis-aligned bounding box
 *    (`rotatedAABB`) plus its centre — and resize snapping is suspended for
 *    it, because a tilted edge has no grid line or artboard edge to meet.
 *
 * Zoom never enters this model: page mm are page mm at every zoom, and the
 * screen→mm conversion (`pagePoint`) divides by the zoomed rect, so a gesture
 * changes the document the same amount at 25% as at 400%.
 */

/** Tolerance (degrees) under which a rotation counts as axis-aligned. */
const AXIS_TOL_DEG = 0.25;

/**
 * True when a rotated box's edges are still parallel to the page axes —
 * i.e. the rotation is a multiple of 90°. Only such boxes may participate in
 * page-aligned snapping (their edges ARE the visual edges).
 */
export function rotationIsAxisAligned(rotation: number): boolean {
  const r = Number(rotation) || 0;
  const quarter = Math.round(r / 90);
  return Math.abs(r - quarter * 90) <= AXIS_TOL_DEG;
}

/**
 * The axis-aligned bounding box of a rotated rectangle, in page mm.
 *
 * For a box of size `w×h` rotated by θ the visual extents are
 * `w·|cosθ| + h·|sinθ|` × `w·|sinθ| + h·|cosθ|` around the (invariant)
 * centre. This is the ONLY rotation-invariant silhouette a snap can use:
 * its four edges are the leftmost/rightmost/topmost/bottommost visual lines
 * of the element, so aligning them to the artboard or a neighbour is exactly
 * what the author sees happen.
 */
export function rotatedAABB(el: GestureBox, rotation: number): GestureBox {
  const rad = ((Number(rotation) || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const aw = el.w * c + el.h * s;
  const ah = el.w * s + el.h * c;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  return { x: cx - aw / 2, y: cy - ah / 2, w: aw, h: ah };
}

/**
 * Project a pointer delta, expressed in PAGE axes (mm), onto the element's
 * LOCAL (unrotated) axes.
 *
 * `resizeByHandle` speaks the element's own coordinate space — `dx` along
 * the box's long axis, `dy` along its short one. A pointer moving on screen
 * moves along the PAGE axes, and for a rotated box those are different
 * directions. Feeding raw page deltas to a rotated element is what made the
 * grabbed corner track the local axes instead of the pointer (the resize
 * "slipped" by up to the drag length × sin(θ), and a purely horizontal drag
 * leaked into the height). The element's local frame is the page frame
 * rotated by θ, so the inverse rotation is the projection:
 *
 *   localDx =  dx·cosθ + dy·sinθ
 *   localDy = −dx·sinθ + dy·cosθ
 *
 * At θ = 0 this is the identity, so axis-aligned gestures are untouched.
 */
export function toLocalDelta(
  dx: number,
  dy: number,
  rotation: number,
): { dx: number; dy: number } {
  const rad = ((Number(rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    dx: dx * cos + dy * sin,
    dy: -dx * sin + dy * cos,
  };
}

/**
 * Anchor-based resize — the ONE resize model for every shape type, at every
 * rotation.
 *
 * The element renders as its box rotated about its CENTRE (the CSS
 * transform-origin), so "keep the origin, grow w/h" — the naïve model —
 * shifts the centre the moment w/h change, and on a rotated element NO
 * visual corner or edge actually stays put: the box swims, the grabbed
 * corner slips off the pointer, and a drag leaks into the other dimension.
 *
 * The geometry that is actually true is the visual one:
 *
 *   1. the ANCHOR feature (the corner/edge opposite the dragged handle)
 *      stays exactly where it is, in page space;
 *   2. the dragged corner/edge lands EXACTLY on the pointer (`target`);
 *   3. the model fields (x, y, w, h) are back-solved from those two facts.
 *
 * With the local axes `e1 = (cosθ, sinθ)`, `e2 = (−sinθ, cosθ)` and the
 * anchor point `A`, the pointer's offset from the anchor decomposes into
 * local components `lu = (T−A)·e1`, `lv = (T−A)·e2`, from which the new
 * size follows per handle (signs encode which side the pointer pulled),
 * and the new origin is the anchor plus the size change along each
 * anchored axis. At θ = 0 this reduces algebraically to the classic
 * `resizeByHandle` results (same clamps, same anchors) — so axis-aligned
 * behaviour is unchanged, and a rotated box finally behaves like an
 * unrotated one: the handle is under the pointer, the anchor does not
 * move, `w/h` are the rendered box, and nothing else about the element
 * (centre, rotation, the rest of the document) is touched.
 *
 * `preserveRatio` (Shift or the element's aspect lock) keeps the element's
 * CURRENT w:h ratio — the dominant axis sets the scale, exactly as
 * `resizeByHandle` does, so circles stay circles. `centered` (Alt) pins
 * the centre instead of an edge and scales symmetrically.
 */
export function resizeToPointer(
  next: GestureBox,
  orig: GestureBox,
  handle: string,
  target: { x: number; y: number },
  rotation: number,
  preserveRatio: boolean,
  locks?: {
    widthLocked?: boolean;
    heightLocked?: boolean;
    /** Alt: the centre stays pinned, both sides move. */
    centered?: boolean;
  },
): void {
  const wLocked = Boolean(locks?.widthLocked);
  const hLocked = Boolean(locks?.heightLocked);
  const centered = Boolean(locks?.centered);

  const rad = ((Number(rotation) || 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const e1 = { x: c, y: s };
  const e2 = { x: -s, y: c };
  const cx0 = orig.x + orig.w / 2;
  const cy0 = orig.y + orig.h / 2;
  /** A point at local (lx·w/2, ly·h/2) relative to the centre, in page mm. */
  const fromCentre = (lx: number, ly: number) => ({
    x: cx0 + (lx * orig.w * c - ly * orig.h * s) / 2,
    y: cy0 + (lx * orig.w * s + ly * orig.h * c) / 2,
  });

  if (wLocked && hLocked) {
    next.x = orig.x;
    next.y = orig.y;
    next.w = orig.w;
    next.h = orig.h;
    return;
  }

  /**
   * The reference point the pointer's offset is measured from: the anchor
   * corner/edge-midpoint for a normal resize, the CENTRE for a centered
   * (Alt) one.
   */
  const isCorner = handle.length === 2;
  let ref: { x: number; y: number };
  let sx: number; // pointer pulled the east (+) or west (−) local edge
  let sy: number;
  if (centered) {
    ref = { x: cx0, y: cy0 };
    sx = handle.includes("e") || (isCorner && !handle.includes("w")) ? 1 : -1;
    sy = handle.includes("s") || (isCorner && !handle.includes("n")) ? 1 : -1;
    // A pure edge handle only moves its own axis.
    if (!isCorner) {
      if (handle === "e" || handle === "w") sy = 0;
      if (handle === "n" || handle === "s") sx = 0;
    }
  } else if (isCorner) {
    if (handle === "se") {
      ref = fromCentre(-1, -1);
      sx = 1;
      sy = 1;
    } else if (handle === "ne") {
      ref = fromCentre(-1, 1);
      sx = 1;
      sy = -1;
    } else if (handle === "nw") {
      ref = fromCentre(1, 1);
      sx = -1;
      sy = -1;
    } else {
      ref = fromCentre(1, -1);
      sx = -1;
      sy = 1;
    } // "sw"
  } else {
    if (handle === "e") {
      ref = fromCentre(-1, 0);
      sx = 1;
      sy = 0;
    } else if (handle === "w") {
      ref = fromCentre(1, 0);
      sx = -1;
      sy = 0;
    } else if (handle === "n") {
      ref = fromCentre(0, 1);
      sx = 0;
      sy = -1;
    } else {
      ref = fromCentre(0, -1);
      sx = 0;
      sy = 1;
    } // "s"
  }

  // Local components of the reference→pointer vector. A centered handle
  // sees the pointer at half the corner distance, so the size is doubled.
  const dxp = target.x - ref.x;
  const dyp = target.y - ref.y;
  const lu = dxp * e1.x + dyp * e1.y;
  const lv = dxp * e2.x + dyp * e2.y;
  const k = centered ? 2 : 1;

  const canW = isCorner || handle === "e" || handle === "w";
  const canH = isCorner || handle === "n" || handle === "s";

  let w = orig.w;
  let h = orig.h;
  if (!wLocked && canW) w = Math.max(MIN_SIZE, sx * k * lu);
  if (!hLocked && canH) h = Math.max(MIN_SIZE, sy * k * lv);

  if (preserveRatio) {
    const ratio = orig.w / Math.max(orig.h, MIN_SIZE);
    if (!wLocked && !hLocked) {
      if (canW && canH) {
        // Corner, both axes free: the dominant axis sets the uniform scale —
        // the same dominant-axis rule `resizeByHandle` applies, expressed on
        // the anchor-projected sizes.
        const wScale = (sx * k * lu) / Math.max(orig.w, MIN_SIZE);
        const hScale = (sy * k * lv) / Math.max(orig.h, MIN_SIZE);
        const scale =
          Math.abs(wScale - 1) >= Math.abs(hScale - 1) ? wScale : hScale;
        w = Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
        h = Math.max(MIN_SIZE, w / ratio);
      } else if (canW) {
        // "e"/"w" edge: the width leads, the height follows the ratio.
        const scale = (sx * k * lu) / Math.max(orig.w, MIN_SIZE);
        w = Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
        h = Math.max(MIN_SIZE, w / ratio);
      } else {
        // "n"/"s" edge: the height leads, the width follows.
        const scale = (sy * k * lv) / Math.max(orig.h, MIN_SIZE);
        h = Math.max(MIN_SIZE, orig.h * Math.max(scale, 0.01));
        w = Math.max(MIN_SIZE, h * ratio);
      }
    } else if (wLocked && !hLocked && canH) {
      // Locked width: the free height follows its own scale, width stays.
      const scale = (sy * k * lv) / Math.max(orig.h, MIN_SIZE);
      h = Math.max(MIN_SIZE, orig.h * Math.max(scale, 0.01));
    } else if (hLocked && !wLocked && canW) {
      const scale = (sx * k * lu) / Math.max(orig.w, MIN_SIZE);
      w = Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
    }
    // A locked dimension is an absolute constraint: it never rescales.
  }

  /*
   * New centre: the midpoint of the anchor and the FINAL dragged feature
   * (the feature's final position is `ref + R·(sx·w/2, sy·h/2)` — exactly
   * the pointer when nothing clamps, and the clamped position when MIN_SIZE
   * or a lock stops it short, so the centre never chases pointer overflow).
   * Centered (Alt): the centre is pinned.
   */
  let ccx: number;
  let ccy: number;
  if (centered) {
    ccx = cx0;
    ccy = cy0;
  } else {
    ccx = ref.x + (sx * w * c - sy * h * s) / 2;
    ccy = ref.y + (sx * w * s + sy * h * c) / 2;
  }
  next.x = ccx - w / 2;
  next.y = ccy - h / 2;
  next.w = w;
  next.h = h;
}

/** Rotate a page-mm point around a centre (positive degrees = clockwise). */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rotation: number,
): { x: number; y: number } {
  const rad = ((Number(rotation) || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Exact axis-aligned bounding box of a (possibly rotated) element's box,
 * computed corner by corner so nesting composes correctly:
 *
 *   `local` is the element's unrotated box in some coordinate space,
 *   `localRot` its own rotation about its own centre, and
 *   `parentRot` (optional) a further rotation applied by a parent group
 *   about `parentCentre` in that same space, BEFORE the box is translated by
 *   `offset` into page mm.
 *
 * Returns the box in PAGE mm — the silhouette a marquee or a snap must hit.
 */
export function elementAABB(
  local: GestureBox,
  localRot: number,
  offset: { x: number; y: number },
  parentRot?: number,
  parentCentre?: { x: number; y: number },
): GestureBox {
  const cx = local.x + local.w / 2;
  const cy = local.y + local.h / 2;
  const corners: [number, number][] = [
    [local.x, local.y],
    [local.x + local.w, local.y],
    [local.x + local.w, local.y + local.h],
    [local.x, local.y + local.h],
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of corners) {
    // Own rotation about the element's centre…
    const p1 = localRot
      ? rotatePoint(px, py, cx, cy, localRot)
      : { x: px, y: py };
    // …then the parent group's rotation about ITS centre, in the parent's
    // space (the parent's own offset is applied last).
    const p2 =
      parentRot && parentCentre
        ? rotatePoint(p1.x, p1.y, parentCentre.x, parentCentre.y, parentRot)
        : p1;
    const fx = p2.x + offset.x;
    const fy = p2.y + offset.y;
    if (fx < minX) minX = fx;
    if (fy < minY) minY = fy;
    if (fx > maxX) maxX = fx;
    if (fy > maxY) maxY = fy;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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
export function mirrorHandle(
  handle: string,
  flipX: boolean,
  flipY: boolean,
): string {
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
        (orig.h + (handle.includes("s") ? dy : -dy)) /
        Math.max(orig.h, MIN_SIZE);
      scale = heightScale;
    } else if (hLocked) {
      const widthScale =
        (orig.w + (handle.includes("e") ? dx : -dx)) /
        Math.max(orig.w, MIN_SIZE);
      scale = widthScale;
    } else {
      const widthScale =
        (orig.w + (handle.includes("e") ? dx : -dx)) /
        Math.max(orig.w, MIN_SIZE);
      const heightScale =
        (orig.h + (handle.includes("s") ? dy : -dy)) /
        Math.max(orig.h, MIN_SIZE);
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
  const nextW = wLocked
    ? orig.w
    : Math.max(MIN_SIZE, orig.w * Math.max(scale, 0.01));
  const nextH = hLocked
    ? orig.h
    : Math.max(
        MIN_SIZE,
        wLocked ? orig.h * Math.max(scale, 0.01) : nextW / ratio,
      );
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
 * `rotation` selects the silhouette that gets snapped. An axis-aligned box
 * (rotation a multiple of 90°) snaps its own edges and centres — they ARE
 * the visual edges. A tilted box has no page-parallel edges, so snapping its
 * *model* box edges would align invisible phantom lines and make the element
 * jump to places the author cannot see. Instead the tilted box snaps its
 * rotation-invariant references — the edges of its `rotatedAABB` (the true
 * visual extremes) and its centre — and the resulting nudge is applied to
 * `el.x`/`el.y`, moving the whole element exactly as its silhouette moved.
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
  rotation: number = 0,
): SnapGuides {
  /**
   * The silhouette the snap logic reasons about. Axis-aligned: the box
   * itself (its edges are the visual edges). Tilted: the AABB — an
   * independent object, so the algorithm's mutations land on it and are
   * transferred back to `el` as a translation at the end.
   */
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const aligned =
    Math.min(normalizedRotation, 360 - normalizedRotation) <= AXIS_TOL_DEG;
  const shape: GestureBox = aligned ? el : rotatedAABB(el, rotation);
  const rawX = shape.x,
    rawY = shape.y;
  const v: number[] = [];
  const h: number[] = [];
  if (grid) {
    shape.x = Math.round(shape.x / GRID) * GRID;
    shape.y = Math.round(shape.y / GRID) * GRID;
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
    const mineV = [rawX, rawX + shape.w / 2, rawX + shape.w];
    const mineH = [rawY, rawY + shape.h / 2, rawY + shape.h];
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
      shape.x = rawX + bestV.delta;
      v.push(bestV.target);
    }
    if (bestH) {
      shape.y = rawY + bestH.delta;
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
        o.y < shape.y + shape.h && o.y + o.h > shape.y;
      let left: SnapCandidate | null = null;
      let right: SnapCandidate | null = null;
      for (const o of stable) {
        if (!overlapV(o)) continue;
        if (
          o.x + o.w <= shape.x + threshold &&
          (!left || o.x + o.w > left.x + left.w)
        )
          left = o;
        if (o.x >= shape.x + shape.w - threshold && (!right || o.x < right.x))
          right = o;
      }
      if (left && right) {
        const span = right.x - (left.x + left.w);
        const gap = (span - shape.w) / 2;
        if (gap >= 0) {
          const ideal = left.x + left.w + gap;
          if (Math.abs(shape.x - ideal) <= threshold) {
            shape.x = ideal;
            v.push(left.x + left.w + gap / 2, shape.x + shape.w + gap / 2);
          }
        }
      }
    }
    if (!bestH) {
      const overlapH = (o: SnapCandidate) =>
        o.x < shape.x + shape.w && o.x + o.w > shape.x;
      let above: SnapCandidate | null = null;
      let below: SnapCandidate | null = null;
      for (const o of stable) {
        if (!overlapH(o)) continue;
        if (
          o.y + o.h <= shape.y + threshold &&
          (!above || o.y + o.h > above.y + above.h)
        )
          above = o;
        if (o.y >= shape.y + shape.h - threshold && (!below || o.y < below.y))
          below = o;
      }
      if (above && below) {
        const span = below.y - (above.y + above.h);
        const gap = (span - shape.h) / 2;
        if (gap >= 0) {
          const ideal = above.y + above.h + gap;
          if (Math.abs(shape.y - ideal) <= threshold) {
            shape.y = ideal;
            h.push(above.y + above.h + gap / 2, shape.y + shape.h + gap / 2);
          }
        }
      }
    }
  }
  /*
   * A tilted box was snapped through its AABB: the whole silhouette moved by
   * the AABB's nudge, so the element (centre included) moves by exactly the
   * same translation. For axis-aligned boxes `shape === el` and the delta is
   * zero — the mutation already happened on `el` directly.
   */
  if (!aligned) {
    const base = rotatedAABB(el, rotation);
    el.x += shape.x - base.x;
    el.y += shape.y - base.y;
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
 *
 * `rotation` suspends the snap unless the box is UNROTATED (0 mod 360). A
 * resized edge only meets a page-parallel target when it is itself
 * page-parallel; the snap targets live in page coordinates, so the box must
 * be in page orientation too. At 90°/180°/270° the model edges are parallel
 * to the page but sit on the SWAPPED axes (a 90° "east" edge is the visual
 * top), so even those would land on the wrong lines — only 0° is safe.
 * Anything else returns immediately: a tilted box resizes freeform, which is
 * deterministic and never corrupts the anchored edge.
 */
export function applyResizeSnap(
  box: GestureBox,
  handle: string,
  others: SnapCandidate[],
  size: { w: number; h: number },
  grid: boolean,
  smart: boolean,
  zoom: number,
  rotation: number = 0,
): SnapGuides {
  // Normalize into [0, 360) and treat anything but 0 (mod 360) as tilted.
  const r = (((Number(rotation) || 0) % 360) + 360) % 360;
  if (Math.min(r, 360 - r) > 1e-6) return { v: [], h: [] };
  const v: number[] = [];
  const h: number[] = [];
  const liveLeft = handle.includes("w");
  const liveRight = handle.includes("e");
  const liveTop = handle.includes("n");
  const liveBottom = handle.includes("s");
  const threshold = snapThresholdMm(zoom);

  const edgesFor = (axis: "x" | "y", extent: number) =>
    axis === "x"
      ? [
          0,
          extent / 2,
          extent,
          ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w]),
        ]
      : [
          0,
          extent / 2,
          extent,
          ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h]),
        ];

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

  const raw = { ...box };
  // Smart candidates are measured BEFORE grid quantisation. Otherwise a page
  // edge such as 297 mm becomes unreachable at high zoom on a 5 mm grid.
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
      const best = nearest(raw.x, xTargets);
      if (best && raw.x + raw.w - best.target >= MIN_SIZE) {
        box.x = best.target;
        box.w = raw.w - best.delta;
        v.push(best.target);
      }
    } else if (liveRight) {
      const best = nearest(raw.x + raw.w, xTargets);
      if (best && best.target - box.x >= MIN_SIZE) {
        box.w = best.target - box.x;
        v.push(best.target);
      }
    }
    if (liveTop) {
      const best = nearest(raw.y, yTargets);
      if (best && raw.y + raw.h - best.target >= MIN_SIZE) {
        box.y = best.target;
        box.h = raw.h - best.delta;
        h.push(best.target);
      }
    } else if (liveBottom) {
      const best = nearest(raw.y + raw.h, yTargets);
      if (best && best.target - box.y >= MIN_SIZE) {
        box.h = best.target - box.y;
        h.push(best.target);
      }
    }
  }
  return { v: [...new Set(v)], h: [...new Set(h)] };
}
