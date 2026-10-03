import type { DocumentSize, RectMm } from "./document-space";

/**
 * Selection-region geometry — pure, page-space millimetres, no DOM.
 *
 * The marquee existed before this module, but only as a live pointer overlay:
 * the rectangle vanished on pointerup, existed in screen pixels between two
 * events, and could not be reused for anything else (crop, extraction, a
 * readout). Every tool here — rectangle, square, ellipse, lasso — now produces
 * the SAME `SelectionRegion`, so "the region" is one concept the canvas,
 * the crop tool and the tests all understand.
 *
 * All maths is in document millimetres. Screen pixels never enter the model;
 * the caller converts pointer positions once (see `screenToDocument`), which is
 * what makes a region correct under any zoom, pan, scroll or devicePixelRatio.
 */

export type RegionShape = "rect" | "ellipse" | "lasso";

export interface RegionPoint {
  x: number;
  y: number;
}

export interface SelectionRegion {
  pageId: string;
  shape: RegionShape;
  /** Axis-aligned bounds in page mm, always clamped inside the page. */
  box: RectMm;
  /** Closed freehand path in page mm. Present for `lasso` only. */
  points?: RegionPoint[];
}

export interface DragBoxInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Keep width === height (the square tool, or Shift on any region tool). */
  square?: boolean;
  /** Alt/Option: the anchor is the centre instead of a corner. */
  fromCenter?: boolean;
}

const positive = (value: number) => (Number.isFinite(value) ? value : 0);

/**
 * The rectangle a drag describes.
 *
 * `fromCenter` mirrors the drag around its anchor and `square` keeps the two
 * axes equal by extending BOTH to the larger delta — never by shrinking one —
 * so the pointer stays on the edge of the region while the constraint holds.
 */
export function marqueeBox(input: DragBoxInput): RectMm {
  const sx = positive(input.startX);
  const sy = positive(input.startY);
  let dx = positive(input.endX) - sx;
  let dy = positive(input.endY) - sy;
  if (input.square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  if (input.fromCenter) {
    return {
      x: sx - Math.abs(dx),
      y: sy - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    };
  }
  return {
    x: Math.min(sx, sx + dx),
    y: Math.min(sy, sy + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

/** Signed extent of a drag, used by the readouts. */
export function dragExtent(input: DragBoxInput) {
  const box = marqueeBox(input);
  return { w: box.w, h: box.h };
}

/** Named ratios offered by the crop tool. `null` means a free drag. */
export type AspectId = "free" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "original";

export const ASPECT_RATIOS: { id: AspectId; label: string; ratio: number | null }[] = [
  { id: "free", label: "حر", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

/**
 * The drag box with a fixed width:height ratio, growing to the LARGER of the
 * two pointer deltas so the region always reaches the pointer along one axis
 * and never jumps smaller than the gesture — the same rule the 1:1 constraint
 * uses, which is what keeps Square Select and a 1:1 Crop feeling identical.
 */
export function aspectBox(input: DragBoxInput, aspect: number | null): RectMm {
  if (!aspect || !(aspect > 0) || !Number.isFinite(aspect)) return marqueeBox(input);
  const sx = positive(input.startX);
  const sy = positive(input.startY);
  let dx = positive(input.endX) - sx;
  let dy = positive(input.endY) - sy;
  const width = Math.max(Math.abs(dx), Math.abs(dy) * aspect);
  const height = width / aspect;
  dx = (dx < 0 ? -1 : 1) * width;
  dy = (dy < 0 ? -1 : 1) * height;
  if (input.fromCenter) {
    return { x: sx - width, y: sy - height, w: width * 2, h: height * 2 };
  }
  return {
    x: Math.min(sx, sx + dx),
    y: Math.min(sy, sy + dy),
    w: width,
    h: height,
  };
}

/**
 * Refit an existing box to a width:height ratio, then keep it inside bounds.
 *
 * This is what a crop-frame ratio chip does: the box centre stays where the
 * author put it, the largest box with the requested ratio is cut from the
 * current one, and the result is shifted back inside the artwork bounds. When
 * the ratio cannot fit at all, the largest fitting ratio box is returned —
 * never an out-of-range frame.
 */
export function aspectFitBox(
  box: RectMm,
  bounds: RectMm,
  ratio: number | null,
): RectMm {
  if (!ratio || !(ratio > 0) || !Number.isFinite(ratio)) return box;
  let w = Math.min(box.w, box.h * ratio);
  let h = w / ratio;
  // The ratio box must also live inside the artwork bounds.
  if (w > bounds.w || h > bounds.h) {
    w = Math.min(w, bounds.w);
    h = w / ratio;
    if (h > bounds.h) {
      h = bounds.h;
      w = h * ratio;
    }
  }
  w = Math.max(2, Math.min(w, bounds.w));
  h = Math.max(2, Math.min(h, bounds.h));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.min(Math.max(cx - w / 2, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(cy - h / 2, bounds.y), bounds.y + bounds.h - h);
  return { x, y, w, h };
}

/**
 * Keep a region inside its own page.
 *
 * A selection is page furniture: the marquee overlay lives inside the artboard
 * node, so a region that ran past the page edge could visually cross into the
 * neighbouring artboard in multi-page view and, worse, be cropped against the
 * wrong page. Clamping here — once, in page mm — is what makes "the selection
 * cannot leak into another page" true for every tool instead of per tool.
 */
export function clampRegionBox(box: RectMm, size: DocumentSize): RectMm | null {
  const left = Math.max(0, Math.min(box.x, box.x + box.w));
  const top = Math.max(0, Math.min(box.y, box.y + box.h));
  const right = Math.min(size.w, Math.max(box.x, box.x + box.w));
  const bottom = Math.min(size.h, Math.max(box.y, box.y + box.h));
  if (right - left <= 0 || bottom - top <= 0) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function boxIsUsable(box: RectMm | null, min = 0.75): box is RectMm {
  return !!box && box.w >= min && box.h >= min;
}

/** Region from a finished drag: constrained, then clamped to the page. */
export function regionBoxFromDrag(
  input: DragBoxInput,
  size: DocumentSize,
): RectMm | null {
  return clampRegionBox(marqueeBox(input), size);
}

export function polygonBounds(points: RegionPoint[]): RectMm {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Append a point to a freehand path, dropping samples that add nothing.
 *
 * A 120Hz Pencil emits far more samples than a lasso needs, and each one costs
 * a segment in the overlay SVG. Dropping sub-threshold moves keeps the path
 * light without changing its shape at any usable zoom.
 */
export function appendRegionPoint(
  points: RegionPoint[],
  point: RegionPoint,
  minDistance = 0.4,
): RegionPoint[] {
  const last = points[points.length - 1];
  if (
    last &&
    Math.hypot(point.x - last.x, point.y - last.y) < minDistance
  )
    return points;
  return [...points, point];
}

/** Even-odd ray cast. Points exactly on an edge are inside, which is fine here. */
export function pointInPolygon(
  points: RegionPoint[],
  x: number,
  y: number,
): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (!a || !b) continue;
    const intersects =
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0) || d1 === 0 || d2 === 0) &&
    ((d3 > 0) !== (d4 > 0) || d3 === 0 || d4 === 0);
}

/** Does a freehand region touch (or contain) an element box? */
export function polygonHitsBox(
  points: RegionPoint[],
  box: RectMm,
): boolean {
  if (points.length < 3) return false;
  const corners: RegionPoint[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  // Fast reject: disjoint bounds can never touch.
  const bounds = polygonBounds(points);
  if (
    box.x > bounds.x + bounds.w ||
    box.x + box.w < bounds.x ||
    box.y > bounds.y + bounds.h ||
    box.y + box.h < bounds.y
  )
    return false;
  if (corners.some((corner) => pointInPolygon(points, corner.x, corner.y)))
    return true;
  if (
    points.some((point) => point.x >= box.x && point.x <= box.x + box.w &&
      point.y >= box.y && point.y <= box.y + box.h)
  )
    return true;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    for (let c = 0; c < 4; c++) {
      const p = corners[c];
      const q = corners[(c + 1) % 4];
      if (!p || !q) continue;
      if (segmentsCross(a.x, a.y, b.x, b.y, p.x, p.y, q.x, q.y)) return true;
    }
  }
  return false;
}

/** Rectangle / ellipse / lasso hit test against an element box, in page mm. */
export function regionHitsBox(
  region: Pick<SelectionRegion, "shape" | "box" | "points">,
  box: RectMm,
): boolean {
  const { x, y, w, h } = region.box;
  if (region.shape === "lasso" && region.points?.length) {
    return polygonHitsBox(region.points, box);
  }
  if (region.shape !== "ellipse") {
    return box.x < x + w && box.x + box.w > x && box.y < y + h && box.y + box.h > y;
  }
  if (w <= 0 || h <= 0) return false;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const px = Math.max(box.x, Math.min(cx, box.x + box.w));
  const py = Math.max(box.y, Math.min(cy, box.y + box.h));
  return ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1;
}

/** SVG path for a lasso overlay, in page mm. */
export function lassoPath(points: RegionPoint[]): string {
  if (!points.length) return "";
  const [first, ...rest] = points;
  return (
    `M ${first!.x} ${first!.y}` +
    rest.map((point) => ` L ${point.x} ${point.y}`).join("") +
    " Z"
  );
}

/** A short human readout for region dimensions, in millimetres. */
export function regionSizeLabel(box: RectMm, round = (n: number) => n.toFixed(1)) {
  return `${round(box.w)} × ${round(box.h)} مم`;
}
