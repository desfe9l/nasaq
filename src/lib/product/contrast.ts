/*
 * Colour arithmetic for the institutional identity — WCAG relative luminance.
 *
 * Extracted from `brand-kit.ts` so the identity can be consumed by pure,
 * storage-free modules (the design generator's palette bridge, and the tests
 * that run it under Node) without dragging IndexedDB into their import graph.
 * `brand-kit.ts` re-exports these two functions, so there is still exactly ONE
 * implementation of the readability rule.
 */

/** WCAG relative luminance of a hex colour (`#rgb` or `#rrggbb`). */
export function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return 0;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two hex colours, rounded to two decimals. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Darken a hex colour until it clears AA (4.5:1) on the given background. */
export function readableOn(hex: string, background: string): string {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#1f2937";
  let current = clean;
  for (let step = 0; step < 24 && contrastRatio(current, background) < 4.5; step += 1) {
    const r = Math.max(0, Math.round(parseInt(current.slice(1, 3), 16) * 0.88));
    const g = Math.max(0, Math.round(parseInt(current.slice(3, 5), 16) * 0.88));
    const b = Math.max(0, Math.round(parseInt(current.slice(5, 7), 16) * 0.88));
    current = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  return current;
}

/** Mix two hex colours; `t` is how much of `b` ends up in the result. */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string, fallback: string) =>
    (/^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback)
      .slice(1)
      .match(/../g)!
      .map((part) => parseInt(part, 16));
  const [ar, ag, ab] = parse(a, "#000000");
  const [br, bg, bb] = parse(b, "#ffffff");
  const ratio = Math.min(1, Math.max(0, t));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * ratio);
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}
