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
 *
 * iPad portrait is a full workspace, not a reduced phone layout: at 768 the two
 * panels dock like the desktop. Phones stay slide-overs.
 */
export const OVERLAY_BREAKPOINT = 768;

/**
 * Below this width windows float over a full-width canvas instead of docking
 * as grid tracks: two docked panels leave a portrait iPad (≈820px) barely half
 * its width for the artboard. Landscape iPad and desktop dock as before.
 */
export const DOCK_BREAKPOINT = 1100;

/** True when the viewport is in slide-over mode (tablet/phone widths). */
export function isOverlayViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return false;
  return !window.matchMedia(`(min-width: ${OVERLAY_BREAKPOINT}px)`).matches;
}

/**
 * ── The responsive layout system, stated ONCE ───────────────────────────────
 *
 * Not a pile of media queries: one pure function answers "which surface is
 * this?" from (width, height, coarse pointer), the shell puts the answer on the
 * root as `data-editor-surface`, and CSS carries a density scale from it.
 * Every size decision — toolbar buttons, options bar, drawers — reads the same
 * resolved surface, so a control can be compact on a 1366px laptop,
 * touch-friendly-compact on an iPad, and maximally dense-but-hittable on a
 * phone, from ONE rule set that never contradicts another.
 */
export type EditorSurface =
  | "desktop"
  | "tablet-landscape"
  | "tablet-portrait"
  | "mobile-landscape"
  | "mobile-portrait"
  | "fullscreen";

/**
 * Resolve the editor surface from raw geometry.
 *
 * Bands (width):
 *   fullscreen === true → fullscreen (100% viewport priority for canvas)
 *   ≥ DOCK_BREAKPOINT and fine pointer → desktop (compact, docked panels)
 *   ≥ DOCK_BREAKPOINT with any coarse pointer → tablet (dockable, touch-first;
 *     an iPad Pro landscape is wide, but it is still a finger)
 *   OVERLAY_BREAKPOINT..DOCK_BREAKPOINT → tablet (full workspace, floating
 *     windows when the two docks cannot both fit)
 *   < OVERLAY_BREAKPOINT (or short landscape height < 500) → mobile (either orientation)
 *
 * Orientation is the tie-breaker inside a band: a portrait phone gets the
 * widest touch targets, a landscape phone keeps the bar shorter because its
 * problem is width, not finger room. Pure and DOM-free so tests and the shell
 * can never disagree.
 */
const MOBILE_SHORT_EDGE = 600;
const MOBILE_LANDSCAPE_MAX_HEIGHT = 500;

export function resolveEditorSurface(
  width: number,
  height: number,
  coarse: boolean,
  fullscreen = false,
): EditorSurface {
  if (fullscreen) return "fullscreen";
  const w = Number.isFinite(width) ? width : 0;
  const h = Number.isFinite(height) ? height : 0;
  if (w <= 0 || h <= 0) return "mobile-portrait";
  const landscape = w > h;
  /*
   * A finger-driven device is a phone the moment its SHORT edge cannot hold
   * a comfortable two-row bar — an 844×390 landscape phone is still a phone
   * even though its width crosses the tablet band. Short landscape viewports
   * below DOCK_BREAKPOINT (< 500px tall) also resolve to mobile-landscape.
   */
  if (
    w < OVERLAY_BREAKPOINT ||
    (w < DOCK_BREAKPOINT && h < MOBILE_LANDSCAPE_MAX_HEIGHT) ||
    (coarse && Math.min(w, h) < MOBILE_SHORT_EDGE)
  )
    return landscape ? "mobile-landscape" : "mobile-portrait";
  if (w < DOCK_BREAKPOINT)
    return landscape ? "tablet-landscape" : "tablet-portrait";
  if (coarse) return landscape ? "tablet-landscape" : "tablet-portrait";
  return "desktop";
}

/**
 * Bottom pages panel (الصفحات) height bounds.
 *
 * The panel carries page thumbnails, so it must be tall enough for one row plus
 * its own controls, yet never grow so far that the artboard has no usable room
 * left — hence a viewport-derived ceiling rather than a fixed pixel value that
 * would be meaningless on a short laptop screen.
 */
/**
 * Compact default: the rail is a thumbnail tray the author scrolls, not a
 * second artboard. 96px keeps a full thumbnail row plus its caption while
 * giving the canvas back the height the old 112px default spent.
 */
export const PAGES_PANEL_DEFAULT = 96;
export const PAGES_PANEL_MIN = 84;
/** The one-line strip the rail collapses to (page numbers only). */
export const PAGES_RAIL_COLLAPSED = 36;
/** A docked panel's strip may take at most this share of its screen axis. */
export const DOCK_MAX_SHARE = 0.4;

/** A physical screen edge a floating panel can dock to. */
export type DockSide = "left" | "right" | "top" | "bottom";
export const DOCK_SIDES: readonly DockSide[] = [
  "top",
  "bottom",
  "left",
  "right",
];

/**
 * Clamp the size a docked panel may claim on its screen axis.
 *
 * The number comes from the panel's last floating rectangle (what the author
 * was using), then bounded so docking can never leave the canvas a sliver:
 * at least `min`, at most `share` of the viewport axis.
 */
export function clampDockSize(
  requested: number,
  axisLength: number,
  min: number,
  share = DOCK_MAX_SHARE,
): number {
  const max = Math.max(min, Math.round(axisLength * share));
  const value = Number.isFinite(requested) ? requested : min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Fit one or two side docks beside a usable page.
 *
 * iPad portrait cannot hold two desktop docks at their minimums without
 * reducing the artboard to a sliver. When both requested widths fit above
 * `canvasFloor` they are scaled down together. When they cannot, the right
 * (content) dock stays and the left one is returned as null so the shell
 * floats it instead of docking it off the page.
 */
export function fitSideDockWidths(
  viewport: number,
  left: number | null,
  right: number | null,
  min: number,
  canvasFloor: number,
): { left: number | null; right: number | null } {
  const width = Number.isFinite(viewport) ? viewport : 0;
  const floor = Math.max(160, Math.round(canvasFloor));
  const fitOne = (value: number) =>
    Math.min(value, Math.max(min, width - floor));
  if (left == null && right == null) return { left: null, right: null };
  if (left != null && right == null) return { left: fitOne(left), right: null };
  if (right != null && left == null) return { left: null, right: fitOne(right) };
  const budget = width - floor;
  if (left! + right! <= budget) return { left, right };
  const scale = budget / (left! + right!);
  const nextLeft = Math.floor(left! * scale);
  const nextRight = Math.floor(right! * scale);
  if (nextLeft >= min && nextRight >= min) {
    return { left: nextLeft, right: nextRight };
  }
  const kept = Math.min(right!, Math.max(min, budget));
  if (kept >= min && width - kept >= Math.min(floor, 280)) {
    return { left: null, right: kept };
  }
  return { left: null, right: null };
}

/** Headroom kept for the canvas + status bar above the pages panel. */
const PAGES_PANEL_RESERVED = 220;

/** Clamp a pages-panel height to the current viewport. */
export function clampPagesHeight(height: number): number {
  const viewport = typeof window === "undefined" ? 900 : window.innerHeight;
  const max = Math.max(
    PAGES_PANEL_MIN + 24,
    Math.min(144, viewport * 0.25, viewport - PAGES_PANEL_RESERVED),
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

  // Four anchor positions are insufficient when a detached panel crosses them.
  // Also consider the free bands around measured obstacles; choose the closest
  // viable band, not a permanent bottom-of-screen parking spot.
  const xs = new Set([
    clampLeft(centeredLeft),
    margin,
    clampLeft(viewport.width - size.width - margin),
  ]);
  const ys = new Set([
    clampTop(anchor.top - gap - size.height),
    clampTop(anchor.bottom + gap),
    margin,
    clampTop(viewport.height - size.height - margin),
  ]);
  for (const obstacle of avoid) {
    xs.add(clampLeft(obstacle.left - margin - size.width));
    xs.add(clampLeft(obstacle.right + margin));
    ys.add(clampTop(obstacle.top - margin - size.height));
    ys.add(clampTop(obstacle.bottom + margin));
  }
  const alternatives = [...xs]
    .flatMap((left) =>
      [...ys].map((top) => ({
        left,
        top,
        placement: (top + size.height <= anchor.top
          ? "above"
          : "below") as ToolbarPlacement["placement"],
      })),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.left - centeredLeft, a.top - centeredTop) -
        Math.hypot(b.left - centeredLeft, b.top - centeredTop),
    );
  candidates.push(...alternatives);

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

/* -------------------------------------------------------------------------- */
/* Anchored popovers (menus, tooltips, quick pickers)                         */
/* -------------------------------------------------------------------------- */

export interface PopoverPlacement {
  left: number;
  top: number;
  side: "top" | "bottom";
}

/**
 * Where a menu/tooltip panel goes for an anchor box of a known panel size.
 *
 * One rule for every anchored surface in the editor, so a control near an edge
 * can never push its menu off-screen, and a menu that does not fit below simply
 * opens above instead of being cut off. Pure and RTL-agnostic: the alignment is
 * expressed in physical pixels, and the caller picks the edge that matches the
 * reading direction (`end` for an RTL menu that grows leftwards).
 */
export function anchorMenuPlacement(
  anchor: ScreenBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options: {
    side?: "top" | "bottom";
    align?: "start" | "end" | "center";
    gap?: number;
    margin?: number;
  } = {},
): PopoverPlacement {
  const { side = "bottom", align = "end", gap = 6, margin = 8 } = options;
  const rawLeft =
    align === "start"
      ? anchor.left
      : align === "center"
        ? anchor.left + anchor.width / 2 - size.width / 2
        : anchor.right - size.width;
  const left = Math.max(
    margin,
    Math.min(rawLeft, Math.max(margin, viewport.width - size.width - margin)),
  );
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  const resolved = (
    side === "bottom"
      ? below + size.height <= viewport.height - margin
        ? "bottom"
        : "above"
      : above >= margin
        ? "top"
        : "bottom"
  ) as "top" | "bottom";
  const top = Math.max(
    margin,
    Math.min(
      resolved === "bottom" ? below : above,
      Math.max(margin, viewport.height - size.height - margin),
    ),
  );
  return { left, top, side: resolved };
}

export interface TooltipState {
  left: number;
  top: number;
  side: "top" | "bottom";
}

/**
 * Where a tooltip goes for an anchor box and a bubble of a known size.
 *
 * Pure so the geometry is unit-testable (`ui-state.test.ts`) and so the same
 * rule can back every anchored popover: centre on the anchor, clamp inside the
 * viewport, and fall to the other side rather than overflow.
 */
export function tipPlacement(
  anchor: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: "top" | "bottom" = "bottom",
  gap = 8,
  edge = 8,
): TooltipState {
  const centered = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.max(
    edge,
    Math.min(centered, Math.max(edge, viewport.width - size.width - edge)),
  );
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - size.height;
  const side = (
    preferred === "bottom"
      ? below + size.height <= viewport.height - edge
        ? "bottom"
        : "above"
      : above >= edge
        ? "top"
        : "bottom"
  ) as "top" | "bottom";
  const top = Math.max(
    edge,
    Math.min(
      side === "bottom" ? below : above,
      Math.max(edge, viewport.height - size.height - edge),
    ),
  );
  return { left, top, side };
}

/**
 * Default opening rectangle for a floating panel.
 *
 * Panels must not cover the controls the author needs while they work, so a
 * fresh panel is placed in the free band beside the canvas margins instead of
 * snapping over the artboard's centre. `anchor` is the corner region the panel
 * should hug (e.g. the canvas stage rect), and the result is always clamped
 * back inside the viewport by `clampPanel`.
 */
export function panelSpawnRect(
  stage: ScreenBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  inset = 12,
): { left: number; top: number; width: number; height: number } {
  const width = Math.min(size.width, Math.max(200, viewport.width - inset * 2));
  const height = Math.min(
    size.height,
    Math.max(160, viewport.height - inset * 2),
  );
  return {
    width,
    height,
    left: Math.max(inset, stage.left + stage.width - width - inset),
    // The vertical clamp matters as much as the horizontal one: a stage that
    // starts high on a short screen must not spawn a panel that runs off the
    // bottom edge. The panel still re-clamps while it is dragged.
    top: Math.min(
      Math.max(inset, stage.top + inset),
      Math.max(inset, viewport.height - height - inset),
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Selection-bubble density                                                 */
/* -------------------------------------------------------------------------- */

/*
 * The selection bubble has fixed cell geometry; the controls that stay in the
 * bar are decided from the available lane, so font names and selection content
 * never change its width. Anything that does not fit moves to its menu.
 */

/** `.floating-toolbar-btn` — one icon cell of the selection bubble. */
export const BUBBLE_CELL = 32;
/** `.floating-toolbar` `padding: 4px 8px` — the bar's own inline padding. */
export const BUBBLE_PAD = 16;
/** `.floating-toolbar` `gap: 3px` — gutter between two direct children. */
export const BUBBLE_GUTTER = 3;
/** `.floating-toolbar-section` `padding-inline: 3px` (both sides). */
export const BUBBLE_SECTION_PAD = 6;
/** `.floating-toolbar-section` `gap: 2px`. */
export const BUBBLE_SECTION_GAP = 2;
/** `.floating-toolbar-sep` — a 1px rule plus its 3px inline margins. */
export const BUBBLE_SEP = 7;
/** Fixed field widths: a field never sizes itself from its own text. */
export const BUBBLE_FIELD_FONT = 96;
export const BUBBLE_FIELD_SIZE = 92;
export const BUBBLE_FIELD_STROKE = 76;
/** Headroom kept between the measured bar and the lane before it must fold. */
export const BUBBLE_SAFETY = 12;

/** Which kind of element is selected — it decides the bubble's parts. */
export type BubbleKind = "text" | "object" | "image";

/**
 * The pieces of the selection bubble, in render order. `grip`, `more` and
 * `close` are structural and never fold; `drawer` is the trigger the bar shows
 * for the group that has folded out of it.
 */
export type BubblePart =
  | "grip"
  /** Font family + font size (text only). */
  | "typography"
  /** Bold / italic / underline + text colour + paragraph align. */
  | "format"
  /** Fill + border swatches (object only). */
  | "ink"
  /** Image crop plus Fit/Fill — never a generic fill palette. */
  | "image"
  /** Border/stroke width. */
  | "stroke"
  /** Duplicate + delete. */
  | "element"
  /** The trigger of the group drawer. */
  | "drawer"
  | "more"
  | "close";

/** Everything the bubble renders, per selection kind. */
export const BUBBLE_PARTS: Record<BubbleKind, readonly BubblePart[]> = {
  text: ["grip", "typography", "format", "stroke", "element", "more", "close"],
  object: ["grip", "ink", "stroke", "element", "more", "close"],
  image: ["grip", "image", "stroke", "element", "more", "close"],
};

/** Parts that leave the bar for the group drawer (rather than for «المزيد»). */
export const BUBBLE_DRAWER_PARTS: readonly BubblePart[] = [
  "typography",
  "format",
  "ink",
  "stroke",
];

/**
 * Fold order: the first list that fits wins, so a wide lane keeps every control
 * in the bar and a phone lane keeps the icons and hands the fields to a drawer.
 * Nothing here depends on the selection's contents.
 */
export const BUBBLE_FOLDS: Record<
  BubbleKind,
  readonly (readonly BubblePart[])[]
> = {
  text: [
    [],
    ["element"],
    ["element", "typography"],
    ["element", "typography", "format"],
  ],
  object: [[], ["element"], ["element", "ink"], ["element", "ink", "stroke"]],
  image: [[], ["element"], ["element", "stroke"]],
};

/** Rendered width of one bubble part, excluding the gutters around it. */
export function bubblePartWidth(part: BubblePart): number {
  const cells = (n: number) =>
    BUBBLE_SECTION_PAD + n * BUBBLE_CELL + (n - 1) * BUBBLE_SECTION_GAP;
  switch (part) {
    case "typography":
      return (
        BUBBLE_SECTION_PAD +
        BUBBLE_FIELD_FONT +
        BUBBLE_FIELD_SIZE +
        BUBBLE_SECTION_GAP
      );
    // Bold / italic / underline / colour / paragraph align, one section.
    case "format":
      return cells(5);
    // Fill + border. Two cells, so one selection kind never makes the bar
    // wider than the other.
    case "ink":
    case "element":
      return cells(2);
    // Replace, crop, fit, rotate, enhance and lighten.
    case "image":
      return cells(6);
    case "stroke":
      // Owns its leading separator, so a selection without stroke support
      // never leaves a stray divider behind.
      return BUBBLE_SEP + BUBBLE_SECTION_PAD + BUBBLE_FIELD_STROKE;
    case "grip":
    case "drawer":
    case "more":
    case "close":
      return BUBBLE_CELL;
  }
}

/**
 * Measured width of a bubble that renders exactly `parts`.
 *
 * The two separators the bar draws itself (before «المزيد» and before the
 * dismiss control) are part of the geometry, so the number this returns is the
 * bar's real offsetWidth — that is what makes the fold decision trustworthy
 * without measuring the bar (which would be a feedback loop).
 */
export function bubbleBarWidth(parts: readonly BubblePart[]): number {
  const separators = parts.includes("more") ? 2 : 0;
  const width =
    parts.reduce((total, part) => total + bubblePartWidth(part), 0) +
    separators * BUBBLE_SEP;
  const children = parts.length + separators;
  return BUBBLE_PAD + width + Math.max(0, children - 1) * BUBBLE_GUTTER;
}

export interface BubbleLayout {
  /** Parts that stay in the bar, in render order. */
  bar: BubblePart[];
  /** Parts that moved into the selection's tool drawer. */
  drawer: BubblePart[];
  /** Parts that moved into «المزيد» (the always-present overflow drawer). */
  more: BubblePart[];
}

/**
 * Decide what the selection bubble shows for a measured free lane.
 *
 * Pure and deterministic: the bar is a function of the selection KIND, whether
 * that kind can carry a border, and the free lane — never of the element's
 * contents, the font name in the picker or the drawer that happens to be open.
 * Two elements of the same kind therefore always produce the same bar, and
 * opening or closing a drawer never resizes it.
 *
 * `stroke: false` drops the border control from the bar AND from the drawers: a
 * plain text frame has no border, and an empty 76px slot would be a control
 * that does nothing.
 */
export function bubbleLayout(
  kind: BubbleKind,
  lane: number,
  options: { stroke?: boolean; fill?: boolean } = {},
): BubbleLayout {
  const { stroke = true, fill = true } = options;
  const supported = (part: BubblePart) =>
    (stroke || part !== "stroke") && (fill || part !== "ink");
  const parts = BUBBLE_PARTS[kind].filter(supported);
  const available = Number.isFinite(lane) ? lane : Number.POSITIVE_INFINITY;
  const layoutFor = (folded: readonly BubblePart[]): BubbleLayout => {
    const inDrawer = folded.filter(
      (part) => supported(part) && BUBBLE_DRAWER_PARTS.includes(part),
    );
    const bar = parts.filter((part) => !folded.includes(part));
    // One trigger for the whole folded group, never one per control.
    if (inDrawer.length) bar.splice(1, 0, "drawer");
    return {
      bar,
      drawer: inDrawer,
      more: folded.filter(
        (part) => supported(part) && !inDrawer.includes(part),
      ),
    };
  };
  for (const folded of BUBBLE_FOLDS[kind]) {
    const candidate = layoutFor(folded);
    if (bubbleBarWidth(candidate.bar) + BUBBLE_SAFETY <= available)
      return candidate;
  }
  return layoutFor(BUBBLE_FOLDS[kind][BUBBLE_FOLDS[kind].length - 1] ?? []);
}

/* -------------------------------------------------------------------------- */
/* Parked floating drawers                                                    */
/* -------------------------------------------------------------------------- */

/** Parse a stored `{ x, y }` drawer park. `null` when it is unusable. */
export function parseStoredPoint(
  raw: string | null | undefined,
): { x: number; y: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y } = parsed as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * Keep a parked drawer inside the viewport.
 *
 * A park is remembered across sessions and viewports, so it has to survive a
 * window that is now smaller than the one it was made in: the drawer slides
 * back on screen instead of stranding its controls off the edge.
 */
export function clampParkedPoint(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.min(Math.max(point.x, margin), maxX),
    y: Math.min(Math.max(point.y, margin), maxY),
  };
}

/* -------------------------------------------------------------------------- */
/* Selection bounding box                                                     */
/* -------------------------------------------------------------------------- */

/** A rectangle in the page's own millimetre space. */
export interface PageBoxMm {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far the *measured* artwork box may differ from the model box before the
 * measurement is treated as unreliable and the model box wins.
 *
 * A rotated element's axis-aligned screen rect is the box OF its rotated box,
 * so a measurement on an irregular glyph is a conservative superset — fine for
 * a border or a shadow (sub-millimetre), wrong for a 30 mm overhang. Anything
 * beyond a couple of millimetres means "this is not the same rectangle", and
 * the authoritative model geometry is the honest answer.
 */
export const MEASURE_TOLERANCE_MM = 2;

/**
 * Turn a rendered node's screen rect into the tight page-space box the
 * selection frame should paint.
 *
 * The element node carries `transform: rotate(θ)` about its own centre, so the
 * inverse mapping from screen pixels to the element's local axes is a rotation
 * about that same centre. Un-rotating the four corners of the measured screen
 * rect therefore yields the artwork's local footprint, which is exactly what a
 * precise selection frame must show (Figma/Illustrator "bounding box"), while
 * the resize/rotate mathematics keeps running on the model geometry.
 *
 * Returns `null` when the measurement cannot be trusted: no size, a rotation
 * large enough to make the axis-aligned rect a poor proxy, a scale we cannot
 * read, or a deviation beyond `MEASURE_TOLERANCE_MM`.
 */
export function measuredSelectionBox(args: {
  /** The rendered node's rect (screen pixels). */
  node: { left: number; top: number; right: number; bottom: number };
  /** The page node's rect (screen pixels). */
  page: { left: number; top: number; width: number };
  /** Page width in millimetres — converts screen pixels back to the model. */
  pageWidthMm: number;
  /** The element's model box in millimetres. */
  model: PageBoxMm;
  /** The element's rotation in degrees, as stored on the model. */
  rotation?: number;
}): PageBoxMm | null {
  const { node, page, pageWidthMm, model } = args;
  const rotation = Number(args.rotation) || 0;
  const width = node.right - node.left;
  const height = node.bottom - node.top;
  /** Millimetres per screen pixel (the page's zoom is baked into this). */
  const scale = page.width > 0 ? pageWidthMm / page.width : 0;
  if (!(width > 0) || !(height > 0) || !(scale > 0) || !(model.w > 0))
    return null;
  // A slanted, irregular glyph's axis-aligned rect is no longer a good proxy
  // for its own box, so the model geometry is trusted instead.
  if (Math.abs(Math.sin((rotation * Math.PI) / 90)) > 1e-8) return null;

  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // The rotation centre is the element's MODEL centre, in screen pixels.
  const cx = page.left + (model.x + model.w / 2) / scale;
  const cy = page.top + (model.y + model.h / 2) / scale;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [px, py] of [
    [node.left, node.top],
    [node.right, node.top],
    [node.right, node.bottom],
    [node.left, node.bottom],
  ] as const) {
    const dx = px - cx;
    const dy = py - cy;
    // Rotate by -θ to land in the element's local (un-rotated) axes.
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
    minY = Math.min(minY, ly);
    maxY = Math.max(maxY, ly);
  }

  const measuredW = (maxX - minX) * scale;
  const measuredH = (maxY - minY) * scale;
  const measured: PageBoxMm = {
    // `minX`/`minY` are the local offsets from the centre, so shifting the
    // model centre by them names the measured box in page millimetres.
    x: Number((model.x + model.w / 2 + minX * scale).toFixed(3)),
    y: Number((model.y + model.h / 2 + minY * scale).toFixed(3)),
    w: Number(measuredW.toFixed(3)),
    h: Number(measuredH.toFixed(3)),
  };

  const drift = Math.max(
    Math.abs(measured.w - model.w),
    Math.abs(measured.h - model.h),
  );
  if (drift > MEASURE_TOLERANCE_MM) return null;
  return measured;
}

/** Open the existing settings surface from chrome, including signed-out sessions. */
export const OPEN_EDITOR_SETTINGS_EVENT = "nasaq:open-editor-settings";
