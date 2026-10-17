/**
 * Colour maths for the motion studio.
 *
 * Small on purpose. The only reason this exists as its own module is that two
 * other modules need identical behaviour: `render-frame.ts` mixes the
 * night→dawn→day sky, and `canvas-render.ts` crossfades the period-origin ink.
 * If those two implemented "blend two hex colours" separately they would drift
 * within a release, and a colour that matched in preview would not match in
 * the exported video.
 *
 * Kept pure and dependency-free so it is trivially testable and usable in a
 * worker.
 */

/** Clamp a number into [0,1]. */
export const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

/**
 * Parse `#rgb`, `#rrggbb` or `rgb()` into components.
 *
 * Returns `null` for anything it does not understand, so callers can fall back
 * to a hard pick rather than silently rendering `rgb(NaN,NaN,NaN)` — which
 * canvas interprets as black and which looks like a mysterious palette bug.
 */
export const parseColor = (
  value: string,
): [number, number, number] | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    if (full.length !== 6) return null;
    const int = Number.parseInt(full, 16);
    if (Number.isNaN(int)) return null;
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  const rgb = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i,
  );
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return null;
};

/** Blend two colours. Unparseable input falls back to a hard pick at t=0.5. */
export const mixRgb = (from: string, to: string, t: number): string => {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const c = clamp01(t);
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * c);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
};

/** Relative luminance (WCAG 2.x), used to keep on-brand labels legible. */
export const luminance = (value: string): number => {
  const rgb = parseColor(value);
  if (!rgb) return 0;
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
};

/** WCAG contrast ratio between two colours, 1–21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
};

/**
 * Pick a legible label colour for a fill.
 *
 * NASAQ's gold is a light decorative fill in both themes, so its label is
 * always ink — never white. Computing it beats hard-coding it at each call
 * site, which is how the "white text on gold" mistake happens.
 */
export const readableOn = (fill: string, ink: string, light: string): string =>
  contrastRatio(fill, light) >= contrastRatio(fill, ink) ? light : ink;