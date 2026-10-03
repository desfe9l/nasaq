import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { tipPlacement, type TooltipState } from "@/lib/editor/ui-state";
import {
  TOOLTIP_LONG_PRESS_MS,
  startLongPressTimer,
  type LongPressHandle,
} from "@/lib/editor/keyboard";

/**
 * ONE tooltip for the whole studio.
 *
 * Discoverability is bought with a hover/long-press bubble, never with more
 * permanent text on the bar — so every icon-only control in the editor wears
 * one of these and the interface stays readable at a glance.
 *
 * Behaviour that makes it usable everywhere:
 *   • Fast. A mouse hover opens it after a short delay (`HOVER_DELAY`) and it
 *     closes the moment the pointer leaves — never the browser's one-second
 *     native `title` bubble, which is also unavailable on touch.
 *   • Long-press. On coarse pointers (finger, pen) a press-and-hold opens the
 *     same bubble, and the click that ends the hold is swallowed so a tooltip
 *     never fires the control underneath it.
 *   • Non-blocking. The bubble is a fixed-position portal above every editor
 *     layer, so it is never clipped by a toolbar, a panel or the canvas, and it
 *     takes no layout space: nothing reflows when it appears.
 *   • Intelligent position. Above the control when there is room, below it
 *     otherwise, horizontally centred and then clamped inside the viewport, so
 *     it can never hang off an edge.
 */
const HOVER_DELAY = 140;
const LEAVE_DELAY = 60;
/** Press-and-hold duration that opens a tooltip where hover does not exist. */
const HOLD_DELAY = TOOLTIP_LONG_PRESS_MS;
/** Estimate used before the bubble has been measured once. */
const ESTIMATE = { width: 168, height: 40 };

export interface TipProps {
  /** Tool name — always present, and the control's accessible name. */
  label: string;
  /** One short line of purpose. Shown under the name. */
  hint?: string;
  /** Keyboard shortcut, rendered as a key cap on the trailing side. */
  shortcut?: string;
  /** Preferred side; flipped automatically when the viewport has no room. */
  side?: "top" | "bottom";
  children: ReactElement;
}

export function Tip({ label, hint, shortcut, side = "bottom", children }: TipProps) {
  const [open, setOpen] = useState<TooltipState | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef<LongPressHandle | null>(null);
  const held = useRef(false);
  const measured = useRef(false);
  const id = useId();

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    holdRef.current?.cancel();
    holdRef.current = null;
  }, []);

  const hide = useCallback(
    (delay = 0) => {
      clear();
      if (delay) timer.current = setTimeout(() => setOpen(null), delay);
      else setOpen(null);
    },
    [clear],
  );

  /** Measure live: the anchor can move (dock reflow, panel open, scroll). */
  const show = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const measuredBox = bubbleRef.current?.getBoundingClientRect();
    setOpen(
      tipPlacement(
        anchor.getBoundingClientRect(),
        measuredBox && measuredBox.width
          ? { width: measuredBox.width, height: measuredBox.height }
          : ESTIMATE,
        { width: window.innerWidth, height: window.innerHeight },
        side,
      ),
    );
  }, [side]);

  /*
   * First paint uses an estimated bubble size; once the real bubble is in the
   * DOM, re-measure exactly once so a long label near an edge is still fully
   * visible. The flag keeps this to one correction instead of a loop.
   */
  useLayoutEffect(() => {
    if (!open) {
      measured.current = false;
      return;
    }
    if (measured.current) return;
    measured.current = true;
    show();
  }, [open, show]);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => show();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("nasaq:panel-layout", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("nasaq:panel-layout", reposition);
    };
  }, [open, show]);

  /**
   * A long-press ends with a click on most browsers. Swallow that click
   * (capture phase) when a tooltip is open from a hold so revealing a tooltip
   * never triggers the control, and dismiss the tooltip on the next tap outside.
   */
  useEffect(() => {
    if (!open) return;
    const swallow = (event: MouseEvent) => {
      if (!held.current) return;
      held.current = false;
      event.stopPropagation();
      event.preventDefault();
    };
    const dismissOnPointerDown = (event: PointerEvent) => {
      if (anchorRef.current?.contains(event.target as Node)) return;
      held.current = false;
      hide(0);
    };
    window.addEventListener("click", swallow, true);
    window.addEventListener("pointerdown", dismissOnPointerDown, true);
    return () => {
      window.removeEventListener("click", swallow, true);
      window.removeEventListener("pointerdown", dismissOnPointerDown, true);
    };
  }, [open, hide]);

  const child = children as ReactElement<Record<string, unknown>>;
  const childRef = child.props.ref;

  const handlers: Record<string, unknown> = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      clear();
      timer.current = setTimeout(show, HOVER_DELAY);
    },
    onPointerLeave: () => hide(LEAVE_DELAY),
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") return;
      clear();
      held.current = false;
      holdRef.current = startLongPressTimer({
        startX: event.clientX,
        startY: event.clientY,
        delayMs: HOLD_DELAY,
        onTrigger: () => {
          held.current = true;
          show();
        },
      });
    },
    onPointerMove: (event: React.PointerEvent) => {
      holdRef.current?.move(event.clientX, event.clientY);
    },
    onPointerUp: () => clear(),
    onPointerCancel: () => {
      clear();
      held.current = false;
    },
    onFocus: () => show(),
    onBlur: () => hide(),
  };

  const element = cloneElement(child, {
    ...handlers,
    "aria-describedby": open ? id : undefined,
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      if (typeof childRef === "function") (childRef as (n: HTMLElement | null) => void)(node);
      else if (childRef && typeof childRef === "object") {
        (childRef as { current: HTMLElement | null }).current = node;
      }
    },
  });

  if (typeof document === "undefined") return element;
  return (
    <>
      {element}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            className={cn("editor-tip", open.side === "top" && "is-top")}
            style={{ left: open.left, top: open.top }}
          >
            <span className="editor-tip-label">{label}</span>
            {hint && <span className="editor-tip-hint">{hint}</span>}
            {shortcut && <kbd className="editor-tip-kbd">{shortcut}</kbd>}
          </div>,
          document.body,
        )}
    </>
  );
}
