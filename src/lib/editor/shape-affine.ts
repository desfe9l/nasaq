/**
 * Affine mapping of shape geometry.
 *
 * A clipping mask has to place the mask's 0–100 geometry box somewhere inside
 * the masked element's own box. The obvious tool for that is an SVG
 * `transform`, but a `clipPath` that is referenced from an HTML element
 * (`clip-path: url(#…)`) silently collapses to an empty region in Chromium as
 * soon as its contents carry a transform, so the placement has to happen in the
 * coordinates themselves.
 *
 * Everything here is a plain affine map `p' = p·s + t`, applied per axis:
 * rectangles, circles, ellipses and polygons are rewritten element-wise, and
 * paths are rewritten command by command — with arcs first converted to cubic
 * Béziers, because Bézier curves are affine-covariant (scaling a control polygon
 * scales the curve exactly, while an `A` command's radii, rotation and flags do
 * not survive a non-uniform map).
 */

import type { ShapePart } from "./shapes";

/** Placement of geometry: scale per axis, then translate. */
export interface Affine {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Path commands, with the number of coordinates each one consumes. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

interface Cmd {
  letter: string;
  args: number[];
}

/** Split path data into commands, expanding repeated coordinate sets. */
function parsePath(d: string): Cmd[] {
  const out: Cmd[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const letter = m[1];
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    const arity = ARITY[letter.toLowerCase()] ?? 0;
    if (!arity) {
      out.push({ letter, args: [] });
      continue;
    }
    if (!nums.length) {
      out.push({ letter, args: [] });
      continue;
    }
    for (let i = 0; i + arity <= nums.length; i += arity) {
      // Extra coordinate sets after an `M` are line-tos, per the SVG grammar.
      const l = i === 0 ? letter : letter === "M" ? "L" : letter === "m" ? "l" : letter;
      out.push({ letter: l, args: nums.slice(i, i + arity) });
    }
  }
  return out;
}

/**
 * Convert one elliptical arc to cubic Béziers (SVG spec F.6.5 + the standard
 * ≤90°-per-segment cubic approximation), so the result can be scaled freely.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
): number[][] {
  if (rx === 0 || ry === 0) return [[x2, y2, x2, y2, x2, y2]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  // Radii too small for the endpoints are enlarged, as the spec requires.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    const a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const start = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2));
  const step = delta / segments;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: number[][] = [];
  const pt = (t: number) => {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    return [cx + rx * cosT * cos - ry * sinT * sin, cy + rx * cosT * sin + ry * sinT * cos];
  };
  const der = (t: number) => {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    return [-rx * sinT * cos - ry * cosT * sin, -rx * sinT * sin + ry * cosT * cos];
  };
  for (let i = 0; i < segments; i++) {
    const t1 = start + i * step;
    const t2 = t1 + step;
    const p1 = pt(t1);
    const p2 = pt(t2);
    const d1 = der(t1);
    const d2 = der(t2);
    out.push([p1[0] + k * d1[0], p1[1] + k * d1[1], p2[0] - k * d2[0], p2[1] - k * d2[1], p2[0], p2[1]]);
  }
  return out;
}

const scaleNum = (n: number) => (Number.isFinite(n) ? round(n) : 0);

/**
 * Map path data through an affine transform.
 *
 * Absolute commands have their coordinates mapped; relative commands keep their
 * deltas scaled on their own axes (a translation cancels out of a delta).
 */
export function mapPathData(d: string, m: Affine): string {
  const out: string[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  for (const cmd of parsePath(d)) {
    const lower = cmd.letter.toLowerCase();
    /** Lower case letters are relative in path data; upper case are absolute. */
    const rel = cmd.letter === lower;
    const a = cmd.args;
    if (lower === "z") {
      out.push("Z");
      x = startX;
      y = startY;
      continue;
    }
    const nums: number[] = [];
    if (lower === "a") {
      // `a`: rx ry rot large sweep x y — curves first, mapped afterwards.
      const [rx, ry, rot, large, sweep, ex, ey] = a;
      const endX = rel ? x + ex : ex;
      const endY = rel ? y + ey : ey;
      const curves = arcToCubics(x, y, rx, ry, rot, large, sweep, endX, endY);
      for (const c of curves) {
        nums.push(
          scaleNum(c[0] * m.sx + m.tx),
          scaleNum(c[1] * m.sy + m.ty),
          scaleNum(c[2] * m.sx + m.tx),
          scaleNum(c[3] * m.sy + m.ty),
          scaleNum(c[4] * m.sx + m.tx),
          scaleNum(c[5] * m.sy + m.ty),
        );
      }
      out.push(`C ${chunk(nums)}`);
      x = endX;
      y = endY;
      continue;
    }
    if (lower === "h") {
      const nx = rel ? x + a[0] : a[0];
      out.push(`${rel ? "h" : "H"} ${scaleNum(rel ? a[0] * m.sx : nx * m.sx + m.tx)}`);
      x = nx;
      continue;
    }
    if (lower === "v") {
      const ny = rel ? y + a[0] : a[0];
      out.push(`${rel ? "v" : "V"} ${scaleNum(rel ? a[0] * m.sy : ny * m.sy + m.ty)}`);
      y = ny;
      continue;
    }
    for (let i = 0; i + 2 <= a.length; i += 2) {
      const px = a[i];
      const py = a[i + 1];
      const ax = rel ? px : px * m.sx + m.tx;
      const ay = rel ? py : py * m.sy + m.ty;
      nums.push(scaleNum(rel ? px * m.sx : ax), scaleNum(rel ? py * m.sy : ay));
    }
    const nx = rel ? x + a[a.length - 2] : a[a.length - 2];
    const ny = rel ? y + a[a.length - 1] : a[a.length - 1];
    x = nx;
    y = ny;
    if (lower === "m") {
      startX = x;
      startY = y;
    }
    out.push(`${cmd.letter} ${chunk(nums)}`);
  }
  return out.join(" ");
}

function chunk(nums: number[]): string {
  return nums.join(" ").replace(/-/g, " -").trim();
}

function mapPoints(points: string, m: Affine): string {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [px, py] = pair.split(",").map(Number);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return pair;
      return `${scaleNum(px * m.sx + m.tx)},${scaleNum(py * m.sy + m.ty)}`;
    })
    .join(" ");
}

/**
 * Rewrite one shape primitive under an affine transform.
 *
 * A circle that is scaled unevenly becomes an ellipse: keeping it a `circle`
 * would round the narrower axis and visibly lie about the mask silhouette.
 */
export function mapShapePart(part: ShapePart, m: Affine): ShapePart {
  const px = (v: number) => v * m.sx + m.tx;
  const py = (v: number) => v * m.sy + m.ty;
  switch (part.k) {
    case "rect":
      return {
        k: "rect",
        x: px(part.x),
        y: py(part.y),
        w: part.w * m.sx,
        h: part.h * m.sy,
        rx: part.rx ? part.rx * Math.min(m.sx, m.sy) : undefined,
      };
    case "circle": {
      const rx = part.r * m.sx;
      const ry = part.r * m.sy;
      if (Math.abs(rx - ry) < 1e-6) return { k: "circle", cx: px(part.cx), cy: py(part.cy), r: rx };
      return { k: "ellipse", cx: px(part.cx), cy: py(part.cy), rx, ry };
    }
    case "ellipse":
      return { k: "ellipse", cx: px(part.cx), cy: py(part.cy), rx: part.rx * m.sx, ry: part.ry * m.sy };
    case "poly":
      return { k: "poly", points: mapPoints(part.points, m) };
    default:
      return { k: "path", d: mapPathData(part.d, m) };
  }
}
