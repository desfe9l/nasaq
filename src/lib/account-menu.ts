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
 *
 * The module also owns the two rules that decide when the card LEAVES, because
 * both surfaces used to answer that question differently (and wrongly): a
 * press-only dismissal rule (`shouldDismissAccountMenu`) and a re-measure
 * equality check (`sameMenuPlacement`) that lets a card follow the bar it came
 * from — instead of being closed by — a scroll, a rotation or a toolbar reflow.
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

/** The press event, reduced to what the dismissal rule actually reads. */
export interface MenuPressEvent {
  target: EventTarget | null;
  pointerType?: string;
  button?: number;
}

/**
 * Whether this press is a dismissal candidate at all.
 *
 * The secondary buttons are not: a right-click that opens the browser's context
 * menu, or a middle-click, must not throw the card away — the author is still
 * looking at it. Touch and pen presses carry no button, so they always count.
 */
export function isDismissalPress(event: MenuPressEvent): boolean {
  return !(event.pointerType === "mouse" && (event.button ?? 0) !== 0);
}

/**
 * The `window`-shaped thing the listeners are installed on. Typed against the
 * DOM's own listener aliases so the real `window` satisfies it directly, and a
 * two-line fake satisfies it in tests.
 */
export interface MenuEventSource {
  addEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: boolean | AddEventListenerOptions): void;
}

/**
 * Install the two listeners an open card needs, and hand back their teardown.
 *
 * This is the whole dismissal contract for BOTH surfaces, kept out of React so
 * it can be tested as the rule it is:
 *
 *   • `pointerdown` on the CAPTURE phase — the card lives in a portal, so a
 *     bubble-phase listener would depend on every surface and every row
 *     remembering to stop propagation (that dependency is what used to break).
 *     Capture means the answer comes from containment alone: a press inside the
 *     card can never be misread as a press outside it, which is exactly the
 *     "menu vanished when I tapped anything" bug;
 *   • `keydown` for Escape only;
 *   • nothing else. No `click` on the window (it fired for the card's own
 *     padding), no `scroll` and no `resize` (a phone collapsing its URL bar
 *     fires both, and the author reads that as a random close).
 */
export function installAccountMenuDismiss({
  events,
  panel,
  trigger,
  onClose,
}: {
  events: MenuEventSource;
  /** Read at press time, so a card that is not mounted cannot be "left". */
  panel: () => MenuHitTarget | null;
  trigger: () => MenuHitTarget | null;
  onClose: () => void;
}): () => void {
  const onPointerDown = (event: MenuPressEvent) => {
    if (!isDismissalPress(event)) return;
    if (!shouldDismissAccountMenu({ press: event.target, panel: panel(), trigger: trigger() })) return;
    onClose();
  };
  const onKeyDown = (event: { key?: string }) => {
    if (event.key === "Escape") onClose();
  };
  const press = onPointerDown as EventListener;
  const key = onKeyDown as EventListener;
  events.addEventListener("pointerdown", press, { capture: true });
  events.addEventListener("keydown", key);
  return () => {
    events.removeEventListener("pointerdown", press, { capture: true });
    events.removeEventListener("keydown", key);
  };
}

/**
 * Coalesce "the bar under the card may have moved" into one re-measure.
 *
 * A scroll burst or a ResizeObserver callback fires far more often than a layout
 * actually changes. Measuring once per frame — and never at all when a frame is
 * already queued — is what lets an open card FOLLOW the toolbar it came from
 * instead of being closed by it, at zero extra paint cost.
 */
export function createMenuFrameScheduler({
  measure,
  requestFrame = (callback) => setTimeout(callback, 16),
  cancelFrame = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  measure: () => void;
  /** `requestAnimationFrame` in the app, `setTimeout` by default, a queue in tests. */
  requestFrame?: (callback: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
}): { schedule: () => void; cancel: () => void } {
  let queued = false;
  let handle: unknown = null;
  return {
    schedule() {
      if (queued) return;
      queued = true;
      handle = requestFrame(() => {
        queued = false;
        handle = null;
        measure();
      });
    },
    cancel() {
      if (!queued) return;
      queued = false;
      cancelFrame(handle);
      handle = null;
    },
  };
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
/** The part of the page an outside press may or may not have landed on. */
export interface MenuHitTarget {
  contains(node: EventTarget | null): boolean;
}

/**
 * Whether a press should dismiss the open card.
 *
 * The card may only be closed by a press that lands clearly OUTSIDE it (plus
 * Escape and the card's own close button). Two failure modes this rule removes:
 *
 *   • a blanket `window` click listener closes the card when the author taps
 *     the card's own padding, its identity block or the gap between two rows —
 *     the menu "vanishing on any touch";
 *   • a press that STARTS inside the card (a scroll or a text selection that
 *     the finger leaves inside) ends on a different element, so judging the
 *     dismissal by the release target dismisses the card mid-gesture. The press
 *     target is the only honest answer, which is why dismissal is wired to
 *     `pointerdown` and evaluated here.
 *
 * A press on the trigger is not a dismissal either: the chip owns its own
 * toggle, and closing here would fight it (and re-open in the same tap).
 */
export function shouldDismissAccountMenu({
  press,
  panel,
  trigger,
}: {
  /** The element the press landed on (`PointerEvent.target`). */
  press: EventTarget | null;
  /** The card, or `null` when it is not on screen. */
  panel: MenuHitTarget | null;
  /** The chip that opened it. */
  trigger: MenuHitTarget | null;
}): boolean {
  if (!panel) return false;
  if (panel.contains(press)) return false;
  if (trigger?.contains(press)) return false;
  return true;
}

/**
 * Whether two measurements place the card in the same pixels.
 *
 * Repositioning runs on every scroll frame and on every toolbar reflow; without
 * this, a re-measure that changed nothing still re-renders the card — and a card
 * that repaints for no visible reason is exactly the flicker being fixed.
 */
export function sameMenuPlacement(a: MenuPlacement | null, b: MenuPlacement | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.top === b.top &&
    a.insetInlineEnd === b.insetInlineEnd &&
    a.maxWidth === b.maxWidth &&
    a.maxHeight === b.maxHeight
  );
}

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
