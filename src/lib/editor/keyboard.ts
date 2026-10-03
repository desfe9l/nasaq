import type { RegionMode, ToolId } from "./tools";

/** Physical letter keys preserve existing bindings on Arabic keyboards.
 * Symbols/digits keep their native key value; callers still own modifier rules. */
export function shortcutKey(event: { key: string; code: string }): string {
  return /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : event.key.toLowerCase();
}

/** Readable shortcut hints on Windows/Linux and macOS, always rendered LTR. */
export function shortcutHint(
  hint: string,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
  return /Mac|iPad|iPhone/.test(platform)
    ? hint
    : hint
        .replaceAll("⌘", "Ctrl+")
        .replaceAll("⇧", "Shift+")
        .replace(/\+ /g, "+");
}

/* ── Centralized Shortcut & Long-Press Architecture ─────────────────────── */

export type ShortcutScope = "app" | "canvas";

/** Explicit timing constants for hold/long-press gestures across the editor. */
export const CANVAS_LONG_PRESS_MS = 550;
export const TOOLTIP_LONG_PRESS_MS = 420;
export const LONG_PRESS_SLOP_PX = 6;

export interface CanvasLongPressContext {
  pointerType: string;
  tool: ToolId;
  regionMode: RegionMode;
  cropActive?: boolean;
  spacePanning?: boolean;
  multiTouch?: boolean;
  interactionBusy?: boolean;
}

/**
 * Long-press context menus on the canvas are strictly scoped:
 *  - Never for mouse (mouse uses right-click `contextmenu`).
 *  - Never while crop, space-pan, or multi-touch navigation is active.
 *  - Never when Brush, Eraser, Text, Shape, or any Selection Region mode is armed
 *    (so holding Pencil or finger to draw/erase/marquee never pops a menu).
 */
export function shouldArmCanvasLongPress(ctx: CanvasLongPressContext): boolean {
  if (ctx.pointerType === "mouse") return false;
  if (ctx.cropActive || ctx.spacePanning || ctx.multiTouch || ctx.interactionBusy) {
    return false;
  }
  return ctx.tool === "select" && ctx.regionMode === "off";
}

/** True once pointer movement exceeds the long-press cancellation threshold. */
export function hasExceededLongPressSlop(
  start: { x: number; y: number },
  current: { x: number; y: number },
  slopPx = LONG_PRESS_SLOP_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= slopPx;
}

export interface LongPressTimerOptions {
  startX: number;
  startY: number;
  delayMs?: number;
  slopPx?: number;
  onTrigger: () => void;
  onCancel?: () => void;
}

export interface LongPressHandle {
  readonly triggered: boolean;
  readonly active: boolean;
  move(clientX: number, clientY: number): boolean;
  cancel(): void;
}

/**
 * Centralized long-press timer that automatically cancels on:
 *  - pointer movement >= `slopPx`
 *  - any scroll or wheel event in capture phase
 *  - any keyboard shortcut (`keydown`)
 *  - window blur
 */
export function startLongPressTimer(options: LongPressTimerOptions): LongPressHandle {
  const delayMs = options.delayMs ?? CANVAS_LONG_PRESS_MS;
  const slopPx = options.slopPx ?? LONG_PRESS_SLOP_PX;
  const origin = { x: options.startX, y: options.startY };
  let triggered = false;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanupListeners = () => {
    if (typeof window === "undefined") return;
    window.removeEventListener("scroll", cancel, true);
    window.removeEventListener("wheel", cancel, true);
    window.removeEventListener("keydown", cancel, true);
    window.removeEventListener("blur", cancel);
  };

  function cancel() {
    if (!active) return;
    active = false;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    cleanupListeners();
    if (!triggered) options.onCancel?.();
  }

  timer = setTimeout(() => {
    if (!active) return;
    active = false;
    triggered = true;
    timer = undefined;
    cleanupListeners();
    options.onTrigger();
  }, delayMs);

  if (typeof window !== "undefined") {
    window.addEventListener("scroll", cancel, { capture: true, passive: true });
    window.addEventListener("wheel", cancel, { capture: true, passive: true });
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", cancel);
  }

  return {
    get triggered() {
      return triggered;
    },
    get active() {
      return active;
    },
    move(clientX: number, clientY: number): boolean {
      if (!active) return false;
      if (hasExceededLongPressSlop(origin, { x: clientX, y: clientY }, slopPx)) {
        cancel();
        return false;
      }
      return true;
    },
    cancel,
  };
}

/** True when a keyboard event originated inside an editable text control. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface EscapeStepContext {
  interactionBusy: boolean;
  painting: boolean;
  layerPickerOpen: boolean;
  cropActive: boolean;
  hasRegion: boolean;
  tool: ToolId;
  regionMode: RegionMode;
  isDesktop: boolean;
  anyFloatingPanelOpen: boolean;
  enteredGroupId: string | null;
  selectedCount: number;
}

export type EscapeAction =
  | "cancel-interaction"
  | "close-layer-picker"
  | "cancel-crop"
  | "clear-region"
  | "reset-tool"
  | "close-floating-panels"
  | "exit-group"
  | "clear-selection"
  | "none";

/**
 * Deterministic single-owner Escape hierarchy.
 * Each press of Escape resolves to exactly ONE action and never cascades into
 * lower layers on the same keydown event.
 */
export function resolveEscapeStep(ctx: EscapeStepContext): EscapeAction {
  if (ctx.interactionBusy || ctx.painting) return "cancel-interaction";
  if (ctx.layerPickerOpen) return "close-layer-picker";
  if (ctx.cropActive) return "cancel-crop";
  if (ctx.hasRegion) return "clear-region";
  if (ctx.tool !== "select" || ctx.regionMode !== "off") return "reset-tool";
  if (!ctx.isDesktop && ctx.anyFloatingPanelOpen) return "close-floating-panels";
  if (ctx.enteredGroupId) return "exit-group";
  if (ctx.selectedCount > 0) return "clear-selection";
  return "none";
}

export interface ShortcutExecutionContext {
  editableTarget: boolean;
  modalOpen: boolean;
  interactionBusy: boolean;
  painting: boolean;
  cropActive: boolean;
}

/**
 * Enforces separation between application-level shortcuts (`"app"`) and
 * canvas-interaction shortcuts (`"canvas"`).
 */
export function canRunShortcutInScope(
  scope: ShortcutScope,
  ctx: ShortcutExecutionContext,
): boolean {
  if (ctx.modalOpen) return false;
  if (scope === "app") {
    // App-level shortcuts (Save, Export, Command Palette) remain available
    // unless a live canvas stroke/drag is actively holding the pointer.
    return !ctx.interactionBusy && !ctx.painting;
  }
  // Canvas shortcuts never fire inside text inputs or during a live pointer gesture.
  if (ctx.editableTarget) return false;
  if (ctx.interactionBusy || ctx.painting || ctx.cropActive) return false;
  return true;
}

/** Step size in mm when adjusting Brush/Eraser diameter via `[` and `]`. */
export function stepBrushSizeMm(currentMm: number, direction: -1 | 1): number {
  const step = currentMm < 5 ? 0.5 : currentMm < 15 ? 1 : 2;
  const next = currentMm + direction * step;
  return Math.min(60, Math.max(0.5, Math.round(next * 2) / 2));
}
