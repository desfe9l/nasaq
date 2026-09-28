/**
 * Where the account menu lands — the geometry half of the identity card.
 *
 * The card is opened from a chip that sits *inside* a bar (the site header, the
 * editor toolbar). Positioning it against the chip alone produces the two
 * failures this module exists to prevent:
 *
 *   1. the card starts at the chip's bottom edge, which is still inside the
 *      bar's own height — so it covers the bar's border and the action buttons
 *      beside it instead of opening cleanly below the toolbar;
 *   2. on a narrow screen the card's inline edge runs past the viewport, so
 *      long names and addresses are clipped rather than wrapped.
 *
 * So the placement is measured from the BAR's bottom edge (never the chip's)
 * and clamped into the viewport with a 16px gutter, honouring the document
 * direction. The numbers live here, once, because the site chrome and the
 * editor open the same card; `account-menu.test.ts` pins the invariants.
 */

/**
 * The bar that owns a trigger — the element whose bottom edge the card must
 * clear. Both surfaces use a `<header>`: the site chrome's sticky header and
 * the editor's `.editor-toolbar` (also a `<header>`), with a role fallback for
 * any future toolbar that is not one.
 */
export const ACCOUNT_MENU_BAR_SELECTOR = "header, .editor-toolbar, [role='toolbar']";

/** The narrowest the identity block (avatar + name + email + badge) can get. */
export const ACCOUNT_MENU_MIN_WIDTH = 280;

/** Breathing room between the bar's bottom edge and the card. */
export const ACCOUNT_MENU_GAP = 8;

/** The card never touches a viewport edge: the same 16px the CSS max-width keeps. */
export const ACCOUNT_MENU_MARGIN = 16;

/**
 * Below this the identity block and the first actions start to clip, so a short
 * viewport gets an internally scrolling card at this height rather than a
 * sliver of one.
 */
export const ACCOUNT_MENU_MIN_HEIGHT = 180;

/** Just enough of a rect to place the card — `DOMRect` satisfies it. */
export interface MenuAnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MenuPlacement {
  /**
   * Offset of the card's inline-end edge from the viewport layer's inline-end
   * edge — the edge the trigger sits on (left in RTL, right in LTR). Logical, so
   * the card grows toward the middle of the screen in either direction.
   */
  insetInlineEnd: number;
  /** Distance from the top of the viewport (CSS `top`), always below the bar. */
  top: number;
  /**
   * The space actually left between that edge and the opposite gutter. Applied
   * per open, so a wide card (a long studio name) can never run off the screen —
   * the CSS `100vw - 32px` ceiling alone would, because it does not know where
   * the card starts.
   */
  maxWidth: number;
  /** Internal scroll ceiling, so a tall card can never run off the screen. */
  maxHeight: number;
}

/**
 * The element a trigger belongs to, as far as measurement is concerned. Declared
 * structurally (not as `Element`) so the placement rules stay unit-testable
 * without a DOM.
 */
export interface MenuTriggerLike {
  getBoundingClientRect(): MenuAnchorRect;
  closest(selector: string): MenuTriggerLike | null;
}

/**
 * The bottom edge of the bar that owns `trigger` — the line the card opens
 * below. Falls back to the trigger's own bottom edge when the trigger is not
 * inside a bar (a bare button in a page body), so the card still opens under
 * whatever opened it.
 */
export function anchorBarBottom(
  trigger: MenuTriggerLike | null | undefined,
  fallback: MenuAnchorRect,
  barSelector: string = ACCOUNT_MENU_BAR_SELECTOR,
): number {
  const bar = trigger && typeof trigger.closest === "function" ? trigger.closest(barSelector) : null;
  return bar ? bar.getBoundingClientRect().bottom : fallback.bottom;
}

/**
 * Place the card for one measurement.
 *
 * - `top` is measured from the bar's bottom edge plus the gap, so the card
 *   never covers the toolbar it was opened from, and it never starts above the
 *   viewport's top gutter.
 * - `insetInlineEnd` aligns the card's inline-end edge with the trigger's — the
 *   trigger is the last thing before the screen edge — then shifts it back
 *   inside the gutters: never closer than `margin` to the edge, and never so
 *   close that the minimum-width card would not fit toward the middle.
 * - `maxWidth` is the space left between that edge and the opposite gutter, so
 *   the card wraps its long text inside the screen instead of running off it.
 *   It can never dip below the card's minimum width: the inline-end clamp above
 *   always leaves the minimum room.
 * - `maxHeight` is what is left below `top`, floored at the usable minimum so a
 *   very short viewport scrolls the card instead of collapsing it.
 */
export function placeAccountMenu({
  anchor,
  bar,
  viewport,
  dir = "rtl",
  minWidth = ACCOUNT_MENU_MIN_WIDTH,
  gap = ACCOUNT_MENU_GAP,
  margin = ACCOUNT_MENU_MARGIN,
  minHeight = ACCOUNT_MENU_MIN_HEIGHT,
}: {
  anchor: MenuAnchorRect;
  /** Bottom edge of the bar above the card (see `anchorBarBottom`). */
  bar: number;
  viewport: { width: number; height: number };
  dir?: "rtl" | "ltr";
  /** The card's layout floor; also the room the clamp has to preserve. */
  minWidth?: number;
  gap?: number;
  margin?: number;
  minHeight?: number;
}): MenuPlacement {
  const top = Math.max(margin, Math.max(bar, anchor.bottom) + gap);

  /* Distance from the layer's inline-end edge to the trigger's, per direction. */
  const inlineEnd = dir === "rtl" ? anchor.left : viewport.width - anchor.right;
  const insetInlineEnd = Math.min(
    Math.max(inlineEnd, margin),
    Math.max(margin, viewport.width - margin - minWidth),
  );

  const maxWidth = Math.max(minWidth, viewport.width - margin - insetInlineEnd);
  const maxHeight = Math.max(minHeight, viewport.height - margin - top);

  return { insetInlineEnd, top, maxWidth, maxHeight };
}
