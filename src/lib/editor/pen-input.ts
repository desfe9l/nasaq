/**
 * Apple Pencil / touch disambiguation for the canvas.
 *
 * One module owns the "which body part is pressing?" question, so every
 * gesture entry point — element press, marquee, selection frame, stage
 * chrome — shares the same palm-rejection answer instead of each guessing on
 * its own.
 *
 * Palm rejection is best-effort by nature: Safari never tags a contact as
 * "palm", so the heuristic is proximity in TIME to the Pencil — a pen that is
 * currently pressed, or that has just hovered/moved nearby within a short
 * grace window. While the pen is down (or freshly active) a touch pointer is
 * treated as the resting palm and swallowed by the gesture layer.
 *
 * Everything here is dependency-free and clock-injectable, so the rules are
 * unit-testable without real hardware.
 */

/** The subset of a PointerEvent the input rules care about. */
export interface PenPointerLike {
  pointerType?: string;
  pointerId?: number;
  /** DOM event type: pointerdown / pointerup / pointercancel / move / over / out. */
  type?: string;
}

/** Pen contacts currently in contact with the glass. */
const penDown = new Set<number>();
/** Timestamp of the most recent pen activity (down, hover, move, up). */
let lastPenAt = -Infinity;
/**
 * Grace window after the last pen event before a touch counts as a real
 * finger again. Covers the micro-gap between pen-up and the next hover move,
 * and the moments a hovering pen sits still while the palm lands.
 */
export const PEN_GRACE_MS = 500;

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * Record a pen event. Called from a window-level capture listener for every
 * pointer event whose `pointerType === "pen"` — anywhere in the editor counts,
 * because a palm lands wherever the hand rests, not only over the artboard.
 */
export function notePenActivity(
  event: PenPointerLike,
  at: number = nowMs(),
): void {
  if (event.pointerType !== "pen") return;
  lastPenAt = at;
  const id = event.pointerId ?? -1;
  if (event.type === "pointerdown") {
    penDown.add(id);
  } else if (event.type === "pointerup" || event.type === "pointercancel") {
    penDown.delete(id);
  }
}

/**
 * True when a TOUCH pointer should be treated as palm contact and ignored.
 *
 * Non-touch pointers (pen, mouse) are never palm — the pen IS the author, and
 * a mouse has no resting body part to reject.
 */
export function isPalmTouch(
  event: PenPointerLike,
  at: number = nowMs(),
): boolean {
  if (event.pointerType !== "touch") return false;
  if (penDown.size > 0) return true;
  return at - lastPenAt < PEN_GRACE_MS;
}

/** Forget all pen state (window blur, tests). */
export function resetPenInput(): void {
  penDown.clear();
  lastPenAt = -Infinity;
}

/* ------------------------------------------------------------------ *
 * Double-tap (the touch/Pencil twin of double-click).
 *
 * iPad hardware has no second button and Safari's synthesized dblclick is not
 * reliable once the canvas claims touch gestures, so the gesture layer reports
 * element taps here and a second quick tap on the same element dispatches a
 * real `dblclick` — the one edit pathway ElementNode already owns (text edit,
 * group stepping).
 * ------------------------------------------------------------------ */

const DOUBLE_TAP_MS = 400;
let lastTapId: string | null = null;
let lastTapAt = -Infinity;

/**
 * Report a tap (pointerup with no drag) on `elId`. Returns true when this tap
 * completes a double-tap on the same element inside the window — the caller
 * should then fire {@link fireSyntheticDoubleClick}.
 *
 * Mouse is excluded: the browser already delivers a native dblclick.
 */
export function noteElementTap(
  elId: string,
  pointerType: string,
  at: number = nowMs(),
): boolean {
  if (pointerType !== "touch" && pointerType !== "pen") return false;
  if (lastTapId === elId && at - lastTapAt <= DOUBLE_TAP_MS) {
    lastTapId = null;
    lastTapAt = -Infinity;
    return true;
  }
  lastTapId = elId;
  lastTapAt = at;
  return false;
}

/** Dispatch a bubbling `dblclick` on the element node with `elId`. */
export function fireSyntheticDoubleClick(elId: string): void {
  if (typeof document === "undefined") return;
  const node = document.querySelector<HTMLElement>(
    `[data-el-id="${CSS.escape(elId)}"]`,
  );
  node?.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
}

/** Forget tap pairing (tests). */
export function resetTapPairing(): void {
  lastTapId = null;
  lastTapAt = -Infinity;
}

/* ------------------------------------------------------------------ *
 * Pencil hover.
 *
 * iPadOS reports hover as pointer events with `pointerType: "pen"` but does
 * NOT flip CSS :hover for a hovering stylus, so the canvas keeps its own
 * lightweight highlight: the element under the hovering pen gets a class that
 * paints a hairline outline at constant screen width (zoom-compensated).
 * ------------------------------------------------------------------ */

const HOVER_CLASS = "is-pen-hover";
let hoverEl: Element | null = null;

/** Move the pen-hover highlight to whatever `[data-el-id]` node is under (x, y). */
export function updatePenHover(x: number, y: number): void {
  if (typeof document === "undefined") return;
  const hit = document.elementFromPoint(x, y);
  const target =
    hit?.closest<HTMLElement>("[data-el-id]") ??
    // Handles live in the selection overlay without their own id — highlight
    // the frame's element when the pen is over a handle.
    null;
  if (target === hoverEl) return;
  hoverEl?.classList.remove(HOVER_CLASS);
  target?.classList.add(HOVER_CLASS);
  hoverEl = target;
}

/** Remove the pen-hover highlight (pen left the canvas / went out of range). */
export function clearPenHover(): void {
  hoverEl?.classList.remove(HOVER_CLASS);
  hoverEl = null;
}
