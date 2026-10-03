/**
 * Fade overlay (step 8) — a gradient layer painted ABOVE an image.
 *
 * The overlay is stored as a small value object on the element style, never as a
 * second element: it cannot be selected, moved or deleted by accident, it
 * inherits the image's clip and mirror, and it follows the image through
 * copy/paste, grouping, undo and every save with no extra bookkeeping.
 *
 * Everything here is pure so the geometry/colour maths is unit-tested away from
 * the DOM; the canvas only spreads the returned object into a `style`.
 */

/** Which way the gradient runs. `toBottom` reads top → bottom on screen. */
export const FADE_DIRECTIONS = [
  "toBottom",
  "toTop",
  "toRight",
  "radial",
] as const;
export type FadeDirection = (typeof FADE_DIRECTIONS)[number];

/**
 * Blend modes offered in the panel. A deliberately short list of the modes that
 * actually help a legibility scrim on top of a photo — the exotic ones (hue,
 * exclusion, …) confuse more than they help, and some render inconsistently in
 * the print-to-PDF path.
 */
export const FADE_BLENDS = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "darken",
  "lighten",
  "luminosity",
] as const;
export type FadeBlend = (typeof FADE_BLENDS)[number];

export interface FadeOverlay {
  direction: FadeDirection;
  /** Colour at the gradient's start. */
  from: string;
  /** Colour at the gradient's end — usually `transparent`. */
  to: string;
  /** Layer opacity, 0–1. */
  opacity: number;
  blend: FadeBlend;
}

/** The overlay a freshly-added layer starts from: a legible dark scrim. */
export const DEFAULT_FADE: FadeOverlay = {
  direction: "toBottom",
  from: "#0f172a",
  to: "transparent",
  opacity: 0.85,
  blend: "normal",
};

const ARABIC_DIRECTION: Record<FadeDirection, string> = {
  toBottom: "من الأعلى إلى الأسفل",
  toTop: "من الأسفل إلى الأعلى",
  toRight: "من اليسار إلى اليمين",
  radial: "دائري (Radial)",
};

export function fadeDirectionLabel(direction: FadeDirection): string {
  return ARABIC_DIRECTION[direction] ?? ARABIC_DIRECTION.toBottom;
}

/** True when a value is a fade we can render (guards hand-edited saves). */
export function isFadeOverlay(value: unknown): value is FadeOverlay {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<FadeOverlay>;
  return (
    typeof v.direction === "string" &&
    (FADE_DIRECTIONS as readonly string[]).includes(v.direction) &&
    typeof v.from === "string" &&
    typeof v.to === "string"
  );
}

/**
 * Repair a stored overlay: unknown directions fall back to top-to-bottom, a
 * missing blend to `normal`, and opacity is clamped to 0–1. Saves written by an
 * older build (or a hand-edited JSON) therefore render instead of throwing.
 */
export function normalizeFade(
  value: FadeOverlay | undefined | null,
): FadeOverlay | null {
  if (!isFadeOverlay(value)) return null;
  const opacity = Number(value.opacity);
  return {
    direction: value.direction,
    from: value.from || "#000000",
    to: value.to || "transparent",
    opacity: Number.isFinite(opacity)
      ? Math.min(1, Math.max(0, opacity))
      : DEFAULT_FADE.opacity,
    blend: (FADE_BLENDS as readonly string[]).includes(value.blend)
      ? value.blend
      : "normal",
  };
}

/**
 * The CSS a fade overlay paints with.
 *
 * `linear-gradient(to bottom, …)` is written physically on purpose: the spec
 * names the gradient by where it *ends on screen*, and the overlay is a
 * decorative scrim over a picture — mirroring it with the document direction
 * would make "من الأعلى إلى الأسفل" disagree with what the author sees.
 */
export function fadeBackground(fade: FadeOverlay): string {
  const { direction, from, to } = fade;
  if (direction === "radial")
    return `radial-gradient(circle at 50% 50%, ${from}, ${to})`;
  return `linear-gradient(${direction === "toRight" ? "to right" : direction === "toTop" ? "to top" : "to bottom"}, ${from}, ${to})`;
}

/** Ready-to-spread React style for the overlay layer. */
export function fadeStyle(fade: FadeOverlay): {
  background: string;
  opacity: number;
  mixBlendMode: FadeBlend;
} {
  return {
    background: fadeBackground(fade),
    opacity: fade.opacity,
    mixBlendMode: fade.blend,
  };
}
