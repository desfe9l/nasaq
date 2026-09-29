import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";
import { GripHorizontal, Maximize2, PanelRightClose, X } from "lucide-react";
import { clampPanel, type PanelRect } from "@/lib/editor/panel-geometry";

/** Shared floating drawer for properties/layers and detachable library. No duplicate
 * content, backdrop, or separate panel system. Only layout metadata is localStorage. */
export function TouchPropertiesSheet({
  open,
  onClose,
  children,
  side = "right",
  docked = false,
  onDockChange,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  side?: "left" | "right";
  docked?: boolean;
  onDockChange?: (docked: boolean) => void;
}) {
  const key = `nasaq.panel.${side}.v2`;
  const title = side === "left" ? "لوحة العناصر" : "الخصائص والطبقات";
  const [rect, setRect] = useState<PanelRect>({
    left: 12,
    top: 100,
    width: 320,
    height: 420,
  });
  const [dragging, setDragging] = useState(false);
  const latest = useRef(rect);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    rect: PanelRect;
    mode: "move" | "resize";
  } | null>(null);
  const bounds = useCallback(
    (next: PanelRect) =>
      clampPanel(
        next,
        {
          width: window.innerWidth,
          height: Math.min(
            window.innerHeight,
            document
              .querySelector(".editor-canvas-stage")
              ?.getBoundingClientRect().bottom ?? window.innerHeight,
          ),
        },
        (document.querySelector(".editor-toolbar")?.getBoundingClientRect()
          .bottom ?? 72) + 8,
      ),
    [],
  );
  const apply = useCallback(
    (next: PanelRect) => {
      const safe = bounds(next);
      latest.current = safe;
      setRect(safe);
      window.dispatchEvent(new Event("nasaq:panel-layout"));
    },
    [bounds],
  );
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(latest.current));
    } catch {
      /* session layout remains usable */
    }
  };
  useEffect(() => {
    let initial: PanelRect = {
      left: side === "left" ? window.innerWidth - 332 : 12,
      top: 100,
      width: 320,
      height: 420,
    };
    try {
      const stored = JSON.parse(localStorage.getItem(key) || "null");
      if (
        stored &&
        ["left", "top", "width", "height"].every((k) =>
          Number.isFinite(stored[k]),
        )
      )
        initial = stored;
    } catch {
      /* default position */
    }
    apply(initial);
    const resize = () => apply(latest.current);
    const observer = new ResizeObserver(resize);
    document
      .querySelectorAll(".editor-toolbar, .editor-canvas-stage")
      .forEach((node) => observer.observe(node));
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [key, side, apply]);

  const start = (e: PointerEvent<HTMLElement>, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.preventDefault();
    const current = docked
      ? bounds(
          e.currentTarget
            .closest(".touch-properties-sheet")!
            .getBoundingClientRect(),
        )
      : latest.current;
    if (docked) {
      apply(current);
      onDockChange?.(false);
    }
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      rect: current,
      mode,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y;
    apply(
      g.mode === "move"
        ? { ...g.rect, left: g.rect.left + dx, top: g.rect.top + dy }
        : { ...g.rect, width: g.rect.width + dx, height: g.rect.height + dy },
    );
  };
  const finish = () => {
    if (!gesture.current) return;
    gesture.current = null;
    setDragging(false);
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
      className={`editor-sidebar touch-properties-sheet ${docked ? "is-docked" : "is-floating"} ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
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
          onPointerDown={(e) => start(e, "move")}
          {...events}
          onKeyDown={(e) => {
            const direction = {
              ArrowLeft: [-16, 0],
              ArrowRight: [16, 0],
              ArrowUp: [0, -16],
              ArrowDown: [0, 16],
            }[e.key];
            if (!direction) return;
            e.preventDefault();
            onDockChange?.(false);
            apply({
              ...latest.current,
              left: latest.current.left + direction[0],
              top: latest.current.top + direction[1],
            });
            persist();
          }}
        >
          <GripHorizontal size={16} />
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
        <button type="button" aria-label={`إغلاق ${title}`} onClick={onClose}>
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
          onPointerDown={(e) => start(e, "resize")}
          {...events}
          onKeyDown={(e) => {
            const direction = {
              ArrowLeft: [-16, 0],
              ArrowRight: [16, 0],
              ArrowUp: [0, -16],
              ArrowDown: [0, 16],
            }[e.key];
            if (!direction) return;
            e.preventDefault();
            apply({
              ...latest.current,
              width: latest.current.width + direction[0],
              height: latest.current.height + direction[1],
            });
            persist();
          }}
        >
          <Maximize2 size={14} />
        </button>
      )}
    </section>
  );
}
