/**
 * Where windows pin themselves: right, left, or mirroring the UI direction.
 *
 * The workspace is RTL-first, so «اليمين» is the natural reading edge — but an
 * author working in English (or on a pen in the left hand) wants the opposite.
 * The preference is one stored choice with three values, and `auto` resolves
 * against the document direction at use time, so switching the interface
 * language moves the dock with it instead of stranding it.
 *
 * Pure + SSR-safe; the Node test runner exercises the resolution rules.
 */

export type DockEdgePreference = "auto" | "right" | "left";

export const DOCK_EDGE_PREFERENCES: readonly DockEdgePreference[] = [
  "auto",
  "right",
  "left",
];

export const DOCK_EDGE_LABELS: Record<DockEdgePreference, string> = {
  auto: "تلقائي — مع اتجاه الواجهة",
  right: "اليمين",
  left: "اليسار",
};

export type UiDirection = "rtl" | "ltr";

const STORAGE_KEY = "nasaq.workspace.dock.v1";
export const DEFAULT_DOCK_EDGE: DockEdgePreference = "auto";

export function isDockEdgePreference(
  value: unknown,
): value is DockEdgePreference {
  return (
    typeof value === "string" &&
    (DOCK_EDGE_PREFERENCES as string[]).includes(value)
  );
}

/**
 * The physical edge a window pins to for a preference + direction.
 * `auto` follows the reading edge: right in RTL, left in LTR.
 */
export function resolveDockEdge(
  preference: DockEdgePreference,
  direction: UiDirection = "rtl",
): "right" | "left" {
  if (preference === "right") return "right";
  if (preference === "left") return "left";
  return direction === "ltr" ? "left" : "right";
}

export function loadDockEdgePreference(): DockEdgePreference {
  if (typeof window === "undefined") return DEFAULT_DOCK_EDGE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isDockEdgePreference(raw) ? raw : DEFAULT_DOCK_EDGE;
  } catch {
    return DEFAULT_DOCK_EDGE;
  }
}

export function saveDockEdgePreference(preference: DockEdgePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* the session keeps the default */
  }
}

/* -------------------------------------------------------------------------- */
/* Long-press before a window moves                                           */
/* -------------------------------------------------------------------------- */

/**
 * How long a press on a window's title bar must be held before the window
 * starts following the pointer.
 *
 * A click — or a swipe that turns out to be a scroll — must never relocate a
 * window: authors kept grabbing a tab title to READ it and dropping the whole
 * panel across the canvas. The same duration the canvas uses for its touch
 * long-press would feel slow on a title bar, so this is deliberately shorter
 * than `LONG_PRESS_MS` (550) while still being unmistakably a hold.
 */
export const PANEL_DRAG_HOLD_MS = 350;

/**
 * Whether a title-bar press has earned the right to drag yet.
 *
 * Pure on purpose: the gesture component only owns timers and pointer deltas,
 * the rule lives here so tests can pin it. A press arms the drag once it has
 * been held long enough WITHOUT travelling — a travelling finger is a scroll
 * or a click-drag on the content, not a window move.
 */
export function pressArmsDrag(args: {
  heldMs: number;
  movedPx: number;
  /** Pointer travel that cancels the hold (a scroll/selection, not a hold). */
  slopPx?: number;
  holdMs?: number;
}): boolean {
  const slop = args.slopPx ?? 6;
  const hold = args.holdMs ?? PANEL_DRAG_HOLD_MS;
  if (args.movedPx > slop) return false;
  return args.heldMs >= hold;
}
