/** Shared paint data for pages and supported elements; solid colours stay in existing fields. */
export interface ColorStop {
  id: string;
  offset: number;
  color: string;
  opacity: number;
}
export interface Gradient {
  type: "linear" | "radial";
  /** CSS angle: 0° upwards, 90° towards the right. */
  angle: number;
  cx: number;
  cy: number;
  stops: ColorStop[];
}
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const finite = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;
const hex = (v: unknown) =>
  typeof v === "string" &&
  /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(v)
    ? v
    : "#006c35";
export const DEFAULT_GRADIENT: Gradient = {
  type: "linear",
  angle: 90,
  cx: 50,
  cy: 50,
  stops: [
    { id: "start", offset: 0, color: "#006c35", opacity: 1 },
    { id: "end", offset: 1, color: "#c9a86a", opacity: 1 },
  ],
};
export function normalizeGradient(value: unknown): Gradient | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<Gradient>;
  if (
    (v.type !== "linear" && v.type !== "radial") ||
    !Array.isArray(v.stops) ||
    v.stops.length < 2
  )
    return undefined;
  const used = new Set<string>();
  const stops = v.stops
    .slice(0, 16)
    .map((raw, i) => {
      const s =
        raw && typeof raw === "object" ? raw : ({} as Partial<ColorStop>);
      let id =
        typeof s.id === "string" && /^[\w-]{1,64}$/.test(s.id)
          ? s.id
          : `stop-${i}`;
      if (used.has(id)) {
        let suffix = 0;
        do {
          id = `stop-${i}-${suffix++}`;
        } while (used.has(id));
      }
      used.add(id);
      return {
        id,
        offset: clamp(finite(s.offset, i / (v.stops!.length - 1)), 0, 1),
        color: hex(s.color),
        opacity: clamp(finite(s.opacity, 1), 0, 1),
      };
    })
    .sort((a, b) => a.offset - b.offset);
  return {
    type: v.type,
    angle: ((finite(v.angle, 90) % 360) + 360) % 360,
    cx: clamp(finite(v.cx, 50), 0, 100),
    cy: clamp(finite(v.cy, 50), 0, 100),
    stops,
  };
}

export function stopRgba(stop: ColorStop) {
  const c = hex(stop.color).slice(1);
  const full =
    c.length <= 4
      ? c
          .split("")
          .map((s) => s + s)
          .join("")
      : c;
  const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1;
  return `rgba(${parseInt(full.slice(0, 2), 16)}, ${parseInt(full.slice(2, 4), 16)}, ${parseInt(full.slice(4, 6), 16)}, ${Number((stop.opacity * alpha).toFixed(4))})`;
}
export function gradientCss(value: Gradient | undefined): string | undefined {
  const gradient = normalizeGradient(value);
  if (!gradient) return undefined;
  const stops = gradient.stops
    .map((s) => `${stopRgba(s)} ${s.offset * 100}%`)
    .join(", ");
  return gradient.type === "radial"
    ? `radial-gradient(ellipse at ${gradient.cx}% ${gradient.cy}%, ${stops})`
    : `linear-gradient(${gradient.angle}deg, ${stops})`;
}
export const paintCss = (
  solid: string | undefined,
  gradient?: Gradient,
  fallback = "transparent",
) =>
  gradientCss(gradient) ||
  (solid === "none" ? "transparent" : solid || fallback);
export const pageBackgroundCss = (page: {
  bg?: string;
  bgGradient?: Gradient;
}) => paintCss(page.bg, page.bgGradient, "#ffffff");

/** Same CSS gradient line in a non-square SVG box (no angle drift / letterboxing). */
export function gradientVector(angle: number, box: { w: number; h: number }) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad),
    dy = -Math.cos(rad);
  const length = Math.abs(box.w * dx) + Math.abs(box.h * dy);
  return {
    x1: 0.5 - (dx * length) / (2 * box.w),
    y1: 0.5 - (dy * length) / (2 * box.h),
    x2: 0.5 + (dx * length) / (2 * box.w),
    y2: 0.5 + (dy * length) / (2 * box.h),
  };
}

export interface SvgPaintCoordinates {
  x?: number;
  y?: number;
  w: number;
  h: number;
}

/** Safe common paint space: compound parts must not restart the gradient. */
export function gradientSvgDefinition(
  value: Gradient,
  rawId: string,
  box: { w: number; h: number },
  coordinates: SvgPaintCoordinates = { w: 100, h: 100 },
) {
  const g = normalizeGradient(value);
  if (!g) return "";
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const { w, h } = coordinates,
    x = coordinates.x || 0,
    y = coordinates.y || 0;
  const stops = g.stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${stopRgba(s)}"/>`)
    .join("");
  if (g.type === "linear") {
    const v = gradientVector(g.angle, box);
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x + v.x1 * w}" y1="${y + v.y1 * h}" x2="${x + v.x2 * w}" y2="${y + v.y2 * h}">${stops}</linearGradient>`;
  }
  const cx = g.cx / 100,
    cy = g.cy / 100;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1" gradientTransform="translate(${x + cx * w} ${y + cy * h}) scale(${Math.max(cx, 1 - cx) * Math.SQRT2 * w} ${Math.max(cy, 1 - cy) * Math.SQRT2 * h})">${stops}</radialGradient>`;
}
