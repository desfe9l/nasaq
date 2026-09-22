/**
 * Pure editor-shell UI state helpers.
 *
 * Kept out of `store.ts` (and free of path aliases and browser globals at module
 * scope) so the layout arithmetic and the SVG import parsing can be unit-tested
 * with the plain Node test runner — the same convention the other editor
 * modules follow.
 */

/**
 * Screens at or below this width swap the docked sidebars for floating
 * slide-overs. One source of truth, so the store (auto-open rules) and the
 * shell (layout) can never disagree about which mode is active.
 */
export const OVERLAY_BREAKPOINT = 1024;

/** True when the viewport is in slide-over mode (tablet/phone widths). */
export function isOverlayViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return !window.matchMedia(`(min-width: ${OVERLAY_BREAKPOINT}px)`).matches;
}

/**
 * Bottom pages panel (الصفحات) height bounds.
 *
 * The panel carries page thumbnails, so it must be tall enough for one row plus
 * its own controls, yet never grow so far that the artboard has no usable room
 * left — hence a viewport-derived ceiling rather than a fixed pixel value that
 * would be meaningless on a short laptop screen.
 */
export const PAGES_PANEL_DEFAULT = 152;
export const PAGES_PANEL_MIN = 96;

/** Headroom kept for the canvas + status bar above the pages panel. */
const PAGES_PANEL_RESERVED = 220;

/** Clamp a pages-panel height to the current viewport. */
export function clampPagesHeight(height: number): number {
  const viewport = typeof window === "undefined" ? 900 : window.innerHeight;
  const max = Math.max(
    PAGES_PANEL_MIN + 24,
    Math.min(viewport * 0.6, viewport - PAGES_PANEL_RESERVED),
  );
  const value = Number.isFinite(height) ? height : PAGES_PANEL_DEFAULT;
  return Math.min(max, Math.max(PAGES_PANEL_MIN, Math.round(value)));
}

/**
 * Pull the `<svg>…</svg>` root out of an uploaded file.
 *
 * Exported icons routinely arrive wrapped in an XML prolog, a doctype or author
 * comments; the page only needs the root element, and rejecting a file for
 * carrying a prolog would be user-hostile.
 */
export function extractSvgMarkup(raw: string): string | null {
  const match = String(raw || "").match(/<svg[\s\S]*?<\/svg\s*>/i);
  if (!match) return null;
  const markup = match[0].trim();
  return markup.length > 24 ? markup : null;
}

/** Overlap area between two screen boxes (0 when they only touch). */
function overlapArea(a: ScreenBox, b: ScreenBox): number {
  const w =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Total overlap of a candidate box with every obstacle. */
function blockedArea(box: ScreenBox, avoid: readonly ScreenBox[]): number {
  let total = 0;
  for (const obstacle of avoid) total += overlapArea(box, obstacle);
  return total;
}

/** Screen-space box (matches the fields of DOMRect we rely on). */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Where the floating toolbar ended up relative to the element. */
export interface ToolbarPlacement {
  left: number;
  top: number;
  /**
   * Side the toolbar settled on: `above` is preferred, the others are chosen
   * when the element is near an edge or an obstacle (panel/dialog) is in the way.
   */
  placement: "above" | "below" | "left" | "right";
  /** True when the toolbar had to be pushed sideways to stay on screen. */
  clamped: boolean;
}

/**
 * Place the floating contextual toolbar next to a selected element.
 *
 * Pure on purpose: the numbers are the whole feature, and they must hold in
 * RTL exactly as in LTR. Physical screen pixels have no direction, so anchoring
 * from `getBoundingClientRect` values (never from the element's mm geometry)
 * makes the maths direction-agnostic — the only RTL-sensitive part is the
 * toolbar's own content, which renders `dir="rtl"`.
 *
 * Preference: 16px above the element. When the element is near the top of the
 * viewport (a selected element scrolled up, a full-bleed image on page 1) the
 * toolbar flips BELOW it rather than overlapping the selection or leaving the
 * screen; horizontally it is centred on the element and then clamped inside the
 * viewport, so it can never be half-visible at either edge.
 */
export function placeFloatingToolbar(
  anchor: ScreenBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 16,
  margin = 8,
  avoid: readonly ScreenBox[] = [],
): ToolbarPlacement {
  const clampTop = (value: number) =>
    Math.min(
      Math.max(value, margin),
      Math.max(margin, viewport.height - size.height - margin),
    );
  const clampLeft = (value: number) =>
    viewport.width - 2 * margin <= size.width
      ? margin
      : Math.min(Math.max(value, margin), viewport.width - size.width - margin);

  const centeredLeft = anchor.left + anchor.width / 2 - size.width / 2;
  const centeredTop = anchor.top + anchor.height / 2 - size.height / 2;

  /*
   * Candidate placements, in preference order: above the element (the original
   * behaviour), below it, then to either side — the latter two exist so the
   * bubble can step around the docked panels instead of landing on top of them.
   * Each candidate is clamped into the viewport first, then scored by how much
   * of it lands on an obstacle.
   */
  const candidates: Array<{
    placement: ToolbarPlacement["placement"];
    left: number;
    top: number;
  }> = [
    {
      placement: "above",
      left: clampLeft(centeredLeft),
      top: clampTop(anchor.top - gap - size.height),
    },
    {
      placement: "below",
      left: clampLeft(centeredLeft),
      top: clampTop(anchor.bottom + gap),
    },
    {
      placement: "left",
      left: clampLeft(anchor.left - gap - size.width),
      top: clampTop(centeredTop),
    },
    {
      placement: "right",
      left: clampLeft(anchor.right + gap),
      top: clampTop(centeredTop),
    },
  ];

  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    // A candidate pushed back onto the element itself is not an option: the
    // bubble must never cover the artwork it is formatting.
    const box: ScreenBox = {
      left: candidate.left,
      top: candidate.top,
      width: size.width,
      height: size.height,
      right: candidate.left + size.width,
      bottom: candidate.top + size.height,
    };
    const score = blockedArea(box, avoid) + overlapArea(box, anchor) * 2;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
    if (score === 0) break;
  }

  const clamped = Math.abs(best.left - centeredLeft) > 0.5;
  return { left: best.left, top: best.top, placement: best.placement, clamped };
}
