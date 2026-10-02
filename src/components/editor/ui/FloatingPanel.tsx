import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  GripHorizontal,
  Minus,
  Move,
  PanelLeft,
  PanelRight,
  Pin,
  X,
} from "lucide-react";
import {
  clampPanel,
  type PanelRect,
} from "@/lib/editor/panel-geometry";
import { panelSpawnRect, type DockSide, type ScreenBox } from "@/lib/editor/ui-state";
import {
  PANEL_DRAG_HOLD_MS,
  loadDockEdgePreference,
  pressArmsDrag,
  resolveDockEdge,
  type UiDirection,
} from "@/lib/editor/workspace-dock";
import { cn } from "@/lib/utils";

/**
 * The floating-window system.
 *
 * Every editor list — properties, layers, report tools, the asset library and
 * the element tools — is the SAME component: a card that floats over the
 * workspace instead of a column that owns layout space. The panel is
 * `position: absolute` inside the workspace row (a high z-index overlay), so
 * opening, closing, moving or resizing it can never reflow the artboard — the
 * canvas keeps the full width and height in every mode.
 *
 * What every window can do, without a per-panel implementation:
 *   • move by its whole title bar (pointer or touch, arrow-key nudging),
 *   • resize from ALL four corners and ALL four edges (8 grips),
 *   • dock to the left or the right only — top and bottom pins are not offered.
 *     A docked window becomes a grid track, so the workspace row reserves its
 *     space and the canvas shrinks instead of being covered; undocking gives it back,
 *   • close from the header, reopen instantly,
 *   • stay inside the workspace on every viewport, including orientation
 *     changes, because every move/resize re-runs the same clamp,
 *   • remember its rectangle and its dock side for the editing session.
 */
export interface FloatingPanelProps {
  /** Storage key + the CSS hook used by the QA scripts. */
  storageKey: string;
  /** Accessible name; also the obstacle side marker. */
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Physical side the panel prefers while floating (spawn + obstacle). */
  side?: "left" | "right";
  /**
   * The physical screen edge the window is docked to. `null` = free floating.
   * The parent owns the layout: when this is set it renders a grid track for
   * the window and passes `gridAreaStyle` describing where it sits.
   */
  dockSide?: DockSide | null;
  onDockSideChange?: (side: DockSide | null) => void;
  /** Inline style applied only while docked (grid-area placement). */
  gridAreaStyle?: CSSProperties;
  /** Opening size before the workspace clamp is applied. */
  defaultSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  /**
   * Horizontal stagger applied to the FIRST spawn only, so several windows
   * opened together fan out beside the artboard instead of stacking exactly
   * on top of each other. Once the author moves a window, the stored
   * rectangle wins and this is ignored.
   */
  spawnShift?: number;
  className?: string;
  /** Compact rectangular bar. The parent releases the dock track. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const DEFAULT_SIZE = { width: 320, height: 520 };
const DEFAULT_MIN = { width: 248, height: 180 };
/**
 * Free strip kept below a freshly opened panel so it can still be dragged:
 * a card that fills the whole band is docked in everything but name.
 */
const PANEL_TRAVEL = 72;
/** Edge grip hit thickness (px) — finger-sized without shouting. */
const EDGE_HIT = 7;

type GestureMode =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

const CURSORS: Record<GestureMode, string> = {
  move: "grab",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

const DOCK_LABELS: Record<DockSide | "free", string> = {
  top: "تثبيت في الأعلى",
  bottom: "تثبيت في الأسفل",
  left: "تثبيت على اليسار",
  right: "تثبيت على اليمين",
  free: "نافذة حرة (بدون تثبيت)",
};

export function FloatingPanel({
  storageKey,
  title,
  open,
  onClose,
  children,
  side = "right",
  dockSide = null,
  onDockSideChange,
  gridAreaStyle,
  defaultSize = DEFAULT_SIZE,
  minSize = DEFAULT_MIN,
  spawnShift = 0,
  className,
  collapsed = false,
  onToggleCollapsed,
}: FloatingPanelProps) {
  const [rect, setRect] = useState<PanelRect>(() => ({
    left: 12,
    top: 12,
    ...defaultSize,
  }));
  const [dragging, setDragging] = useState(false);
  const [dockMenuOpen, setDockMenuOpen] = useState(false);
  const dockMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!dockMenuOpen) return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!dockMenuRef.current?.contains(event.target as Node))
        setDockMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [dockMenuOpen]);
  const latest = useRef(rect);
  const sectionRef = useRef<HTMLElement | null>(null);
  const gesture = useRef<
    | {
        id: number;
        x: number;
        y: number;
        rect: PanelRect;
        next: PanelRect;
        frame: number;
        mode: GestureMode;
      }
    | null
  >(null);

  const positionKey = `${storageKey}.pos.v2`;

  /**
   * The workspace rectangle a panel is allowed to live in, in the row's own
   * coordinates: the panel is `absolute` inside the workspace row, so 0,0 is
   * the row's top-left (directly below the header). The bottom stops above the
   * page rail so a window can never swallow the page commands. Measured (never
   * hard-coded) so a wrapped header, a collapsed rail or a resized window can
   * never strand a panel off screen.
   */
  const bounds = useCallback(
    (next: PanelRect) => {
      const row = sectionRef.current?.offsetParent as HTMLElement | null;
      const rowRect = row?.getBoundingClientRect();
      if (!rowRect) {
        return clampPanel(next, { width: window.innerWidth, height: window.innerHeight }, 0);
      }
      const rail = document.querySelector(".editor-page-rail");
      const railTop = rail
        ? rail.getBoundingClientRect().top - rowRect.top
        : Infinity;
      const bottom = Math.min(rowRect.height, railTop) - 8;
      return clampPanel(
        next,
        { width: rowRect.width, height: Math.max(bottom + minSize.height, rowRect.height) },
        0,
      );
    },
    [minSize.height],
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
    if (dockSide) return;
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
  }, [bounds, dockSide]);

  const persist = () => {
    try {
      localStorage.setItem(positionKey, JSON.stringify(latest.current));
    } catch {
      /* private mode: the panel still works, it just forgets on reload */
    }
  };

  useEffect(() => {
    let initial: PanelRect = latest.current;
    const stage =
      document.querySelector<HTMLElement>(".editor-canvas-stage")?.getBoundingClientRect();
    const row = sectionRef.current?.offsetParent as HTMLElement | null;
    const rowRect = row?.getBoundingClientRect();
    if (stage) {
      /*
       * A panel is only "floating" if it can actually float. On a short screen
       * the band between the header and the page rail is barely taller than the
       * default card, so a full-height panel would be pinned in place — it
       * would open, but it would not move. Keep a strip of travel free.
       */
      const rail = document.querySelector(".editor-page-rail")?.getBoundingClientRect();
      const bandTop = (rowRect?.top ?? 52) + 16;
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
      // Left-side windows open at the LEFT edge of the stage, right-side
      // windows at the right edge — each fan of three windows spawns beside
      // the artboard it used to push, never on top of its own side's siblings.
      const viewport: PanelRect = {
        left:
          side === "left"
            ? stage.left + 12 + spawnShift
            : Math.max(12, window.innerWidth - spawn.width - 12 - spawnShift),
        top: spawn.top + (side === "left" ? 0 : Math.round(spawnShift / 2)),
        width: spawn.width,
        height: spawn.height,
      };
      // Convert viewport coordinates into the row's own space (0,0 below the header).
      initial = {
        left: rowRect ? viewport.left - rowRect.left : viewport.left,
        top: rowRect ? viewport.top - rowRect.top : viewport.top,
        width: viewport.width,
        height: viewport.height,
      };
    }
    try {
      const stored = JSON.parse(localStorage.getItem(positionKey) || "null");
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
      .querySelectorAll(".editor-toolbar, .editor-canvas-stage, .editor-page-rail, .editor-workspace-row")
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

  /**
   * Resolve the next rectangle for a gesture: pure math, shared by the pointer
   * move and the final commit. Physical clientX/Y deltas — direction-agnostic,
   * so RTL never flips a resize. The opposite edges stay pinned; hitting the
   * minimum size pins the moving edge instead (the panel stops growing the
   * hole).
   */
  const step = (
    g: NonNullable<typeof gesture.current>,
    dx: number,
    dy: number,
  ): PanelRect => {
    const r = g.rect;
    if (g.mode === "move") return { ...r, left: r.left + dx, top: r.top + dy };
    let left = r.left;
    let top = r.top;
    let width = r.width;
    let height = r.height;
    if (g.mode.includes("e")) width = r.width + dx;
    if (g.mode.includes("s")) height = r.height + dy;
    if (g.mode.includes("w")) {
      width = r.width - dx;
      left = r.left + dx;
      if (width < minSize.width) {
        left = r.left + r.width - minSize.width;
        width = minSize.width;
      }
    }
    if (g.mode.includes("n")) {
      height = r.height - dy;
      top = r.top + dy;
      if (height < minSize.height) {
        top = r.top + r.height - minSize.height;
        height = minSize.height;
      }
    }
    return { left, top, width, height };
  };

  /**
   * A press on the title bar arms the move gesture only after a HOLD.
   *
   * A click on a window title — to read it, to reach a tab under the pointer —
   * must never relocate the window; authors kept dropping panels across the
   * canvas that way. The drag earns the pointer after `PANEL_DRAG_HOLD_MS` of
   * stillness, and a travelling press (a scroll, a text sweep) cancels it.
   * The grip stays the keyboard/assistive face of the same gesture.
   */
  const pending = useRef<{
    id: number;
    x: number;
    y: number;
    target: HTMLElement;
    timer: number;
  } | null>(null);
  const [holding, setHolding] = useState(false);

  const cancelHold = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    pending.current = null;
    setHolding(false);
  };

  const armHold = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    cancelHold();
    const target = event.currentTarget;
    const record = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target,
      timer: 0,
    };
    record.timer = window.setTimeout(() => {
      pending.current = null;
      setHolding(false);
      beginGesture(target, record.id, record.x, record.y, "move");
    }, PANEL_DRAG_HOLD_MS);
    pending.current = record;
    setHolding(true);
  };

  const holdMove = (event: PointerEvent<HTMLElement>) => {
    const p = pending.current;
    if (!p || p.id !== event.pointerId) return;
    if (!pressArmsDrag({ heldMs: PANEL_DRAG_HOLD_MS, movedPx: Math.hypot(event.clientX - p.x, event.clientY - p.y) })) {
      // Travelled past the slop: this is a scroll or a click, not a hold.
      cancelHold();
    }
  };

  const start = (event: PointerEvent<HTMLElement>, mode: GestureMode) => {
    if (event.button !== 0) return;
    event.preventDefault();
    beginGesture(event.currentTarget, event.pointerId, event.clientX, event.clientY, mode);
  };

  const beginGesture = (
    target: HTMLElement,
    pointerId: number,
    x: number,
    y: number,
    mode: GestureMode,
  ) => {
    let current = latest.current;
    if (dockSide) {
      // Dragging a docked panel detaches it: the same gesture that positions a
      // floating panel is how you leave the fixed layout.
      const node = target.closest<HTMLElement>(".editor-floating-panel");
      const measured = node?.getBoundingClientRect();
      const row = sectionRef.current?.offsetParent as HTMLElement | null;
      const rowRect = row?.getBoundingClientRect();
      if (measured && rowRect) {
        current = {
          left: measured.left - rowRect.left,
          top: measured.top - rowRect.top,
          width: measured.width,
          height: measured.height,
        };
        latest.current = current;
        persist();
      }
      apply(current);
      onDockSideChange?.(null);
    }
    gesture.current = {
      id: pointerId,
      x,
      y,
      rect: current,
      next: current,
      frame: 0,
      mode,
    };
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* synthetic events still drive the window-level listeners */
    }
    setDragging(true);
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    g.next = step(g, dx, dy);
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
      g.next = step(g, event.clientX - g.x, event.clientY - g.y);
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
    if (dockSide) onDockSideChange?.(null);
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

  const gestureEvents = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };

  /**
   * Title-bar gesture set: a pending HOLD cancels on travel or release, and
   * once the drag is armed the usual gesture handlers take over.
   */
  const holdGestureEvents = {
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      holdMove(event);
      move(event);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      cancelHold();
      finish(event);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      cancelHold();
      finish(event);
    },
    onLostPointerCapture: finish,
  };

  // Never leave a hold timer running behind a closed/unmounted window.
  useEffect(() => cancelHold, []);

  /** One resize grip: a thin edge strip or a corner square. */
  const grip = (mode: GestureMode) => {
    const isCorner = mode.length === 2;
    const style: CSSProperties = { cursor: CURSORS[mode] };
    if (mode === "n") Object.assign(style, { top: 0, left: 0, right: 0, height: EDGE_HIT });
    if (mode === "s") Object.assign(style, { bottom: 0, left: 0, right: 0, height: EDGE_HIT });
    if (mode === "e") Object.assign(style, { right: 0, top: 0, bottom: 0, width: EDGE_HIT });
    if (mode === "w") Object.assign(style, { left: 0, top: 0, bottom: 0, width: EDGE_HIT });
    if (mode === "ne") Object.assign(style, { top: 0, right: 0, width: 16, height: 16 });
    if (mode === "nw") Object.assign(style, { top: 0, left: 0, width: 16, height: 16 });
    if (mode === "se") Object.assign(style, { bottom: 0, right: 0, width: 16, height: 16 });
    if (mode === "sw") Object.assign(style, { bottom: 0, left: 0, width: 16, height: 16 });
    return (
      <button
        key={mode}
        type="button"
        aria-hidden={!isCorner}
        tabIndex={isCorner ? 0 : -1}
        aria-label={
          isCorner
            ? `تغيير حجم ${title} من الركن ${mode}`
            : undefined
        }
        title="اسحب لتغيير الحجم"
        className={cn("floating-panel-resize", `fp-resize-${mode}`)}
        style={style}
        onPointerDown={(event) => start(event, mode)}
        {...gestureEvents}
        onKeyDown={
          isCorner ? (event) => nudge(event, "resize") : undefined
        }
      />
    );
  };

  const style: CSSProperties | undefined = dockSide
    ? gridAreaStyle
    : collapsed
      ? {
          left: rect.left,
          top: rect.top,
          width: Math.min(rect.width, 220),
          height: 40,
        }
      : {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };

  return (
    <section
      ref={sectionRef}
      className={cn(
        // `touch-properties-sheet` / `editor-sidebar` stay on the node: the
        // panel skin and the editor QA scripts address the panel by them.
        "editor-floating-panel touch-properties-sheet editor-sidebar",
        dockSide && "is-docked",
        dockSide && `is-docked-${dockSide}`,
        collapsed && "is-collapsed",
        open && "is-open",
        dragging && "is-dragging",
        holding && "is-drag-armed",
        className,
      )}
      data-editor-obstacle={open ? side : undefined}
      data-dock-side={dockSide ?? undefined}
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
      style={style}
    >
      <div
        className="touch-properties-header"
        onPointerDown={(event) => {
          // Buttons inside the title bar keep their clicks; the bar itself
          // only DRAGS after a hold (armHold), never on a plain click.
          if ((event.target as HTMLElement).closest("button:not(.touch-properties-grip)"))
            return;
          armHold(event);
        }}
        onContextMenu={(event) => {
          // A touch hold must not summon the browser menu mid-drag.
          if (pending.current || dragging) event.preventDefault();
        }}
        {...holdGestureEvents}
      >
        <button
          type="button"
          className="touch-properties-grip"
          aria-label={`تحريك ${title} — اضغط مطولًا ثم اسحب`}
          title="اضغط مطولًا ثم اسحب لتحريك اللوحة — الأسهم للتحريك الدقيق"
          onPointerDown={(event) => {
            // The whole title bar holds-then-drags; the grip is its
            // a11y/keyboard face and stops the bubble so the header handler
            // does not arm a second gesture on a different capture target.
            event.stopPropagation();
            armHold(event);
          }}
          {...holdGestureEvents}
          onKeyDown={(event) => nudge(event, "move")}
        >
          <GripHorizontal size={16} aria-hidden="true" />
          <span>{title}</span>
        </button>
        {onDockSideChange && (
          <div className="fp-dock-cluster relative shrink-0 flex items-center">
            <button
              type="button"
              onClick={() => {
                // One easy press: pin to the workspace's preferred edge
                // (right in RTL, left in LTR, or the author's override),
                // or release the pin when already docked.
                if (dockSide) onDockSideChange(null);
                else {
                  const dir: UiDirection =
                    sectionRef.current?.closest("[dir]")?.getAttribute("dir") ===
                      "ltr" || document.dir === "ltr"
                      ? "ltr"
                      : "rtl";
                  onDockSideChange(resolveDockEdge(loadDockEdgePreference(), dir));
                }
              }}
              aria-label={dockSide ? `فك تثبيت ${title}` : `تثبيت ${title} على حافة العمل`}
              title={
                dockSide
                  ? `فك تثبيت ${title}`
                  : `تثبيت ${title} على ${resolveDockEdge(loadDockEdgePreference()) === "right" ? "اليمين" : "اليسار"}`
              }
              className={cn(dockSide && "is-docked-active")}
            >
              <Pin size={16} />
            </button>
            {/* One press each for the two edges authors actually use: pin to
                the right or the left without opening the edge menu. */}
            <button
              type="button"
              onClick={() => onDockSideChange(dockSide === "right" ? null : "right")}
              aria-pressed={dockSide === "right"}
              aria-label={dockSide === "right" ? `فك تثبيت ${title} من اليمين` : `تثبيت ${title} على اليمين`}
              title={dockSide === "right" ? "مثبتة على اليمين — انقر للفك" : DOCK_LABELS.right}
              className={cn("fp-dock-quick", dockSide === "right" && "is-docked-active")}
            >
              <PanelRight size={15} />
            </button>
            <button
              type="button"
              onClick={() => onDockSideChange(dockSide === "left" ? null : "left")}
              aria-pressed={dockSide === "left"}
              aria-label={dockSide === "left" ? `فك تثبيت ${title} من اليسار` : `تثبيت ${title} على اليسار`}
              title={dockSide === "left" ? "مثبتة على اليسار — انقر للفك" : DOCK_LABELS.left}
              className={cn("fp-dock-quick", dockSide === "left" && "is-docked-active")}
            >
              <PanelLeft size={15} />
            </button>
            <button
              type="button"
              onClick={() => setDockMenuOpen((v) => !v)}
              aria-label={`اختيار حافة تثبيت ${title}`}
              aria-expanded={dockMenuOpen}
              title="اختيار حافة التثبيت"
            >
              <ChevronDown size={15} />
            </button>
            {dockMenuOpen && (
              <div
                ref={dockMenuRef}
                className="fp-dock-menu"
                role="menu"
                aria-label={`حافة تثبيت ${title}`}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {(
                  [
                    ["left", PanelLeft],
                    ["right", PanelRight],
                  ] as const
                ).map(([d, Icon]) => (
                  <button
                    key={d}
                    type="button"
                    role="menuitemradio"
                    aria-checked={dockSide === d}
                    title={DOCK_LABELS[d]}
                    className={cn(dockSide === d && "is-current")}
                    onClick={() => {
                      onDockSideChange(d);
                      setDockMenuOpen(false);
                    }}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{DOCK_LABELS[d].replace("تثبيت في ", "").replace("تثبيت على ", "")}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!dockSide}
                  title={DOCK_LABELS.free}
                  className={cn(!dockSide && "is-current")}
                  onClick={() => {
                    onDockSideChange(null);
                    setDockMenuOpen(false);
                  }}
                >
                  <Move size={15} aria-hidden="true" />
                  <span>نافذة حرة</span>
                </button>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          aria-pressed={collapsed}
          aria-label={collapsed ? `فتح ${title}` : `طي ${title}`}
          title={collapsed ? "فتح اللوحة" : "طي اللوحة إلى شريط"}
          onClick={onToggleCollapsed}
          disabled={!onToggleCollapsed}
        >
          <Minus size={16} className={collapsed ? "rotate-90" : undefined} />
        </button>
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
      {!dockSide && !collapsed && (
        <>
          {(["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const).map(grip)}
        </>
      )}
    </section>
  );
}
