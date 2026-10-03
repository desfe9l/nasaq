/**
 * Custom drop shadow — a pure codec between the panel's numeric controls and
 * the single `style.shadow` box-shadow string the canvas already renders (and
 * html2canvas already rasterises on export). No new storage field: presets and
 * custom values share the same string, so old projects keep working.
 */
export interface ShadowParts {
  /** Horizontal offset, mm. */
  x: number;
  /** Vertical offset, mm. */
  y: number;
  /** Blur radius, mm (≥ 0). */
  blur: number;
  /** Hex colour `#rrggbb`. */
  color: string;
  /** Opacity 0–1. */
  alpha: number;
}

export const DEFAULT_SHADOW: ShadowParts = {
  x: 0,
  y: 2,
  blur: 5,
  color: "#0f172a",
  alpha: 0.16,
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [15, 23, 42];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("")}`;

export function buildShadow(parts: ShadowParts): string {
  const [r, g, b] = hexToRgb(parts.color);
  const round = (n: number) => Math.round(n * 10) / 10;
  const alpha = Math.round(clamp(parts.alpha, 0, 1) * 100) / 100;
  if (alpha === 0) return "";
  return `${round(clamp(parts.x, -50, 50))}mm ${round(clamp(parts.y, -50, 50))}mm ${round(clamp(parts.blur, 0, 50))}mm rgba(${r},${g},${b},${alpha})`;
}

/** Read a stored shadow back into controls; unknown syntax → defaults. */
export function parseShadow(value: string | undefined): ShadowParts {
  if (!value) return { ...DEFAULT_SHADOW };
  const m =
    /^\s*(-?[\d.]+)(?:mm)?\s+(-?[\d.]+)(?:mm)?\s+([\d.]+)(?:mm)?\s+rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)\s*$/i.exec(
      value,
    );
  if (!m) return { ...DEFAULT_SHADOW };
  return {
    x: Number(m[1]),
    y: Number(m[2]),
    blur: Number(m[3]),
    color: toHex(Number(m[4]), Number(m[5]), Number(m[6])),
    alpha: m[7] === undefined ? 1 : clamp(Number(m[7]), 0, 1),
  };
}
