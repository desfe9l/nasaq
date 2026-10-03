/**
 * Raster painting primitives — pure maths over a plain RGBA buffer.
 *
 * The eraser used to be a delete button in disguise: brushing an object removed
 * the whole ELEMENT. A real eraser (and a real brush) needs pixel work, and
 * pixel work needs to be testable without a browser, so the compositing lives
 * here as arithmetic over `{ data, width, height }` and the canvas is only the
 * place those bytes are finally uploaded.
 *
 * Alpha is handled as STRAIGHT (non-premultiplied) RGBA, which is exactly what
 * `ImageData` and PNG use, so transparency survives a round trip through
 * `putImageData`/`toDataURL` and a half-erased PNG stays a half-erased PNG
 * instead of turning black or gaining a halo.
 */

export interface RasterBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RectPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface DabOptions {
  x: number;
  y: number;
  /** Radius in buffer pixels. */
  radius: number;
  /** 0 = fully soft edge, 1 = hard edge. */
  hardness: number;
  /** 0..1, multiplied into every pixel's coverage. */
  opacity: number;
  erase: boolean;
  color: Rgb;
}

export const DEFAULT_INK: Rgb = { r: 17, g: 24, b: 39 };

/**
 * Coverage of one pixel: 1 inside the hard core, a smoothstep ramp to 0 at the
 * brush radius. A hard stop at the radius aliases badly on a 2 px and larger
 * brush, which is why even hardness 1 keeps a one-pixel feather.
 */
export function dabAlpha(
  distance: number,
  radius: number,
  hardness: number,
): number {
  if (!(radius > 0) || distance >= radius) return 0;
  if (distance <= 0) return 1;
  const inner = radius * Math.min(1, Math.max(0, hardness)) * 0.98;
  if (distance <= inner) return 1;
  const span = Math.max(radius - inner, 0.0001);
  const t = Math.min(1, Math.max(0, (radius - distance) / span));
  return t * t * (3 - 2 * t);
}

const clampByte = (value: number) =>
  value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

/** Composite one dab into the buffer; returns the dirty rect it touched. */
export function stampDab(
  buffer: RasterBuffer,
  dab: DabOptions,
  clip?: RectPx | null,
): RectPx | null {
  const { data, width, height } = buffer;
  if (!(dab.radius > 0) || !(dab.opacity > 0)) return null;
  const left = Math.max(0, Math.floor(dab.x - dab.radius));
  const top = Math.max(0, Math.floor(dab.y - dab.radius));
  const right = Math.min(width, Math.ceil(dab.x + dab.radius + 1));
  const bottom = Math.min(height, Math.ceil(dab.y + dab.radius + 1));
  const fromX = clip ? Math.max(left, Math.floor(clip.x)) : left;
  const fromY = clip ? Math.max(top, Math.floor(clip.y)) : top;
  const toX = clip ? Math.min(right, Math.ceil(clip.x + clip.w)) : right;
  const toY = clip ? Math.min(bottom, Math.ceil(clip.y + clip.h)) : bottom;
  if (toX <= fromX || toY <= fromY) return null;
  const radiusSq = dab.radius * dab.radius;
  for (let y = fromY; y < toY; y++) {
    const dy = y + 0.5 - dab.y;
    for (let x = fromX; x < toX; x++) {
      const dx = x + 0.5 - dab.x;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= radiusSq) continue;
      const coverage =
        dabAlpha(Math.sqrt(distanceSq), dab.radius, dab.hardness) * dab.opacity;
      if (coverage <= 0) continue;
      const index = (y * width + x) * 4;
      const dstA = data[index + 3]! / 255;
      if (dab.erase) {
        // Destination-out: colour is untouched, alpha is eaten away. That is
        // what makes erasing on a PNG leave a clean transparent hole instead
        // of a white one.
        data[index + 3] = clampByte(dstA * (1 - coverage) * 255);
        continue;
      }
      const srcA = coverage;
      const outA = srcA + dstA * (1 - srcA);
      if (outA <= 0) {
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
        data[index + 3] = 0;
        continue;
      }
      const keep = (dstA * (1 - srcA)) / outA;
      const take = srcA / outA;
      data[index] = clampByte(dab.color.r * take + data[index]! * keep);
      data[index + 1] = clampByte(dab.color.g * take + data[index + 1]! * keep);
      data[index + 2] = clampByte(dab.color.b * take + data[index + 2]! * keep);
      data[index + 3] = clampByte(outA * 255);
    }
  }
  return { x: fromX, y: fromY, w: toX - fromX, h: toY - fromY };
}

/** Pixels between two stamps of one stroke: 20% of the radius, never below 1. */
export function strokeSpacing(radius: number): number {
  return Math.max(1, radius * 0.2);
}

/**
 * Points along a segment, spaced so consecutive dabs overlap.
 *
 * Without this a fast Pencil flick paints a dotted line; with it the stroke is
 * continuous at any pointer sample rate, which matters most on iPad where the
 * samples arrive in bursts.
 */
export function walkSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  spacing: number,
): { x: number; y: number }[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.floor(distance / Math.max(0.5, spacing)));
  const points: { x: number; y: number }[] = [];
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
  }
  return points;
}

/**
 * Stroke smoothing (exponential follow) with Pencil pressure kept separate.
 *
 * `smoothing` is the usual 0..1 knob: 0 follows the pointer exactly, higher
 * values lag behind and flatten jitter. Pressure is NOT smoothed by the same
 * factor — it is averaged over a short window, so a light-to-heavy transition
 * stays a ramp instead of becoming an on/off switch.
 */
export class StrokeSmoother {
  private current: { x: number; y: number } | null = null;
  private pressure = 0.5;
  private smoothing: number;

  constructor(smoothing: number) {
    this.smoothing = smoothing;
  }

  reset() {
    this.current = null;
    this.pressure = 0.5;
  }

  push(
    point: { x: number; y: number },
    pressure?: number,
  ): { from: { x: number; y: number }; to: { x: number; y: number }; pressure: number } {
    const follow = Math.min(0.9, Math.max(0, this.smoothing)) * 0.75;
    const next = this.current
      ? {
          x: this.current.x + (point.x - this.current.x) * (1 - follow),
          y: this.current.y + (point.y - this.current.y) * (1 - follow),
        }
      : { ...point };
    const from = this.current ?? next;
    this.current = next;
    if (typeof pressure === "number" && Number.isFinite(pressure) && pressure > 0) {
      this.pressure = this.pressure * 0.7 + pressure * 0.3;
    } else {
      this.pressure = this.pressure * 0.7 + 0.5 * 0.3;
    }
    return { from, to: next, pressure: this.pressure };
  }
}

/** Bounding box of a stroke, padded by its radius — used to size a new layer. */
export function strokeBounds(
  points: { x: number; y: number }[],
  radius: number,
): RectPx {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX - radius,
    y: minY - radius,
    w: maxX - minX + radius * 2,
    h: maxY - minY + radius * 2,
  };
}

/** Merge two pixel-aligned dirty rectangles into their bounding union. */
export function mergeDirtyRect(
  a: RectPx | null,
  b: RectPx | null,
): RectPx | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Radius in buffer pixels for a brush of `sizeMm` document millimetres. */
export function brushRadiusPx(sizeMm: number, pxPerMm: number): number {
  return Math.max(0.5, (Math.max(0.1, sizeMm) / 2) * Math.max(0.01, pxPerMm));
}
