import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GripHorizontal, Maximize2, PanelRightClose, X } from "lucide-react";
import { clampPanel, type PanelRect } from "@/lib/editor/panel-geometry";
import { panelSpawnRect, type ScreenBox } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";

/**
 * The floating-panel system.
 *
 * Properties, Layers, Tools and the element library are the SAME component: a
 * card that floats over the workspace instead of a column that owns layout
 * space. Nothing in the editor reserves a side rail for a panel any more, so
 * the canvas keeps the full width whether a panel is open or closed, and
 * opening one never reflows the document.
 *
 * What every panel can do, without a per-panel implementation:
 *   • move by its grip (pointer or touch, with arrow-key nudging),
 *   • resize from the corner grip (and shrink to a compact, scrollable height),
 *   • close from the header, reopen instantly from its compact control,
 *   • stay inside the workspace on every viewport, including orientation
 *     changes, because every move/resize re-runs the same clamp,
 *   • remember its rectangle for the editing session.
 *
 * Docking is a per-panel OPTION (the header toggle), never the default: a
 * docked panel is the old fixed layout and is only useful on wide screens where
 * the author prefers a permanent column.
 */
export interface FloatingPanelProps {
  /** Storage key + the CSS hook used by the QA scripts. */
  storageKey: string;
  /** Accessible name; also the obstacle side marker. */
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Physical side the panel prefers while floating (docking hint + obstacle). */
  side?: "left" | "right";
  /** Opt-in permanent column. Off by default: the canvas stays dominant. */
  docked?: boolean;
  onDockChange?: (docked: boolean) => void;
  /** Opening size before the workspace clamp is applied. */
  defaultSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  className?: string;
}

const DEFAULT_SIZE = { width: 320, height: 520 };
const DEFAULT_MIN = { width: 248, height: 180 };
/**
 * Free strip kept below a freshly opened panel so it can still be dragged:
 * a card that fills the whole band is docked in everything but name.
 */
const PANEL_TRAVEL = 72;

export function FloatingPanel({
  storageKey,
  title,
  open,
  onClose,
  children,
  side = "right",
  docked = false,
  onDockChange,
  defaultSize = DEFAULT_SIZE,
  minSize = DEFAULT_MIN,
  className,
}: FloatingPanelProps) {
  const [rect, setRect] = useState<PanelRect>(() => ({
    left: 12,
    top: 100,
    ...defaultSize,
  }));
  const [dragging, setDragging] = useState(false);
  const latest = useRef(rect);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    rect: PanelRect;
    next: PanelRect;
    frame: number;
    mode: "move" | "resize";
  } | null>(null);

  /**
   * The workspace rectangle a panel is allowed to live in: below the header and
   * above the page rail. Measured (never hard-coded) so a wrapped header, a
   * collapsed rail or a resized window can never strand a panel off screen.
   */
  const bounds = useCallback(
    (next: PanelRect) => {
      const header = document.querySelector(".editor-toolbar");
      const rail = document.querySelector(".editor-page-rail");
      const top = (header?.getBoundingClientRect().bottom ?? 52) + 8;
      const bottom = (rail?.getBoundingClientRect().top ?? window.innerHeight) - 8;
      return clampPanel(
        next,
        { width: window.innerWidth, height: Math.max(top + 120, bottom) },
        top,
      );
    },
    [],
  );

  const apply = useCallback(
    (next: PanelRect) => {
      const safe = bounds(next);
      latest.current = safe;
      setRect(safe);
      // The contextual selection toolbar listens for this and re-places itself
      // so it never lands on a panel that just moved.
      window.dispatchEvent(new Event("nasaq:panel-layout"));
    },
    [bounds],
  );

  /**
   * Re-clamp without announcing a move. Used for workspace-driven refits (a
   * resize, a rotation, a rail that grew): the panel follows its box, but
   * nothing else needs to re-place itself because nothing was dragged.
   */
  const reclamp = useCallback(() => {
    const safe = bounds(latest.current);
    if (
      safe.left === latest.current.left &&
      safe.top === latest.current.top &&
      safe.width === latest.current.width &&
      safe.height === latest.current.height
    )
      return;
    latest.current = safe;
    setRect(safe);
  }, [bounds]);

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(latest.current));
    } catch {
      /* private mode: the panel still works, it just forgets on reload */
    }
  };

  useEffect(() => {
    let initial: PanelRect = latest.current;
    const stage =
      document.querySelector<HTMLElement>(".editor-canvas-stage")?.getBoundingClientRect();
    if (stage) {
      /*
       * A panel is only "floating" if it can actually float. On a short screen
       * the band between the header and the page rail is barely taller than the
       * default card, so a full-height panel would be pinned in place — it
       * would open, but it would not move. Keep a strip of travel free.
       */
      const header = document.querySelector(".editor-toolbar")?.getBoundingClientRect();
      const rail = document.querySelector(".editor-page-rail")?.getBoundingClientRect();
      const bandTop = (header?.bottom ?? 52) + 16;
      const bandBottom = (rail?.top ?? window.innerHeight) - 16;
      const height = Math.min(
        defaultSize.height,
        Math.max(minSize.height, bandBottom - bandTop - PANEL_TRAVEL),
      );
      const spawn = panelSpawnRect(
        stage as ScreenBox,
        { width: defaultSize.width, height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      initial = {
        left: side === "left" ? spawn.left : Math.max(12, window.innerWidth - spawn.width - 12),
        top: spawn.top,
        width: spawn.width,
        height: spawn.height,
      };
    }
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        stored &&
        ["left", "top", "width", "height"].every((k) => Number.isFinite(stored[k]))
      ) {
        initial = stored;
      }
    } catch {
      /* keep the computed default */
    }
    apply(initial);
    // Re-clamp on any workspace change: a rotation, a resized window, a rail
    // that grew. The panel follows its box instead of drifting off screen.
    const resize = () => reclamp();
    const observer = new ResizeObserver(resize);
    document
      .querySelectorAll(".editor-toolbar, .editor-canvas-stage, .editor-page-rail")
      .forEach((node) => observer.observe(node));
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
    };
    // The opening rectangle is a one-off: later moves are the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, side]);

  const start = (event: PointerEvent<HTMLElement>, mode: "move" | "resize") => {
    if (event.button !== 0) return;
    event.preventDefault();
    let current = latest.current;
    if (docked) {
      // Dragging a docked panel detaches it: the same gesture that positions a
      // floating panel is how you leave the fixed layout.
      const node = event.currentTarget.closest<HTMLElement>(".editor-floating-panel");
      const measured = node?.getBoundingClientRect();
      if (measured) current = bounds(measured);
      apply(current);
      onDockChange?.(false);
    }
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect: current,
      next: current,
      frame: 0,
      mode,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (g.mode === "move") {
      g.next = { ...g.rect, left: g.rect.left + dx, top: g.rect.top + dy };
    } else {
      /* The opposite edges stay pinned; only the resize grip changes size. */
      g.next = {
        ...g.rect,
        width: Math.max(minSize.width, g.rect.width + dx),
        height: Math.max(minSize.height, g.rect.height + dy),
      };
    }
    if (g.frame) return;
    g.frame = requestAnimationFrame(() => {
      g.frame = 0;
      if (gesture.current === g) apply(g.next);
    });
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (g.frame) cancelAnimationFrame(g.frame);
    if (event.type === "pointerup") {
      const dx = event.clientX - g.x;
      const dy = event.clientY - g.y;
      g.next = g.mode === "move"
        ? { ...g.rect, left: g.rect.left + dx, top: g.rect.top + dy }
        : {
            ...g.rect,
            width: Math.max(minSize.width, g.rect.width + dx),
            height: Math.max(minSize.height, g.rect.height + dy),
          };
    }
    apply(g.next);
    gesture.current = null;
    setDragging(false);
    persist();
  };

  /** Arrow keys nudge or resize in 16px steps — a keyboard path for both. */
  const nudge = (event: React.KeyboardEvent, mode: "move" | "resize") => {
    const step = event.shiftKey ? 48 : 16;
    const direction = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    if (docked) onDockChange?.(false);
    if (mode === "move") {
      apply({
        ...latest.current,
        left: latest.current.left + direction[0],
        top: latest.current.top + direction[1],
      });
    } else {
      apply({
        ...latest.current,
        width: Math.max(minSize.width, latest.current.width + direction[0]),
        height: Math.max(minSize.height, latest.current.height + direction[1]),
      });
    }
    persist();
  };

  const events = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };

  return (
    <section
      className={cn(
        // `touch-properties-sheet` / `editor-sidebar` stay on the node: the
        // panel skin and the editor QA scripts address the panel by them.
        "editor-floating-panel touch-properties-sheet editor-sidebar",
        docked && "is-docked",
        open && "is-open",
        dragging && "is-dragging",
        className,
      )}
      data-editor-obstacle={open ? side : undefined}
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
      style={
        docked
          ? undefined
          : {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            }
      }
    >
      <div className="touch-properties-header">
        <button
          type="button"
          className="touch-properties-grip"
          aria-label={`تحريك ${title}`}
          title="اسحب لتحريك اللوحة — الأسهم للتحريك الدقيق"
          onPointerDown={(event) => start(event, "move")}
          {...events}
          onKeyDown={(event) => nudge(event, "move")}
        >
          <GripHorizontal size={16} aria-hidden="true" />
          <span>{title}</span>
        </button>
        {onDockChange && (
          <button
            type="button"
            onClick={() => onDockChange(!docked)}
            aria-label={docked ? "فصل لوحة العناصر" : "إرساء لوحة العناصر"}
            title={docked ? "فصل اللوحة" : "إرساء اللوحة"}
          >
            <PanelRightClose size={16} />
          </button>
        )}
        <button
          type="button"
          aria-label={`إغلاق ${title}`}
          title={`إغلاق ${title}`}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="touch-properties-content">{children}</div>
      {!docked && (
        <button
          type="button"
          className="floating-panel-resize"
          aria-label={`تغيير حجم ${title}`}
          title="اسحب لتغيير العرض والارتفاع — أو استخدم الأسهم"
          onPointerDown={(event) => start(event, "resize")}
          {...events}
          onKeyDown={(event) => nudge(event, "resize")}
        >
          <Maximize2 size={14} />
        </button>
      )}
    </section>
  );
}
