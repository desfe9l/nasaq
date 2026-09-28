import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

/** Remembered height (px) — the sheet keeps its last position across sessions. */
const HEIGHT_KEY = "nasaq.touchPropsHeight.v1";
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 56;

function readStoredHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(v) && v >= MIN_HEIGHT && v <= 4000) return v;
  } catch {
    /* private mode: default height */
  }
  return DEFAULT_HEIGHT;
}

/** Non-modal: the workspace remains usable and its measured size never changes.
 * Only the grip claims touch; all existing property controls scroll normally. */
export function TouchPropertiesSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const [height, setHeight] = useState(readStoredHeight);
  /** Live viewport ceiling (0.72dvh) — recomputed on rotate/resize so the
   * sheet always stays on screen while the STORED height survives rotation. */
  const [maxHeight, setMaxHeight] = useState(() =>
    typeof window === "undefined" ? 600 : Math.round(window.innerHeight * 0.72),
  );
  useEffect(() => {
    const stage = document.querySelector(".editor-canvas-stage");
    const onResize = () => {
      const header = document.querySelector(".editor-toolbar")?.getBoundingClientRect().bottom ?? 80;
      const bottom = stage?.getBoundingClientRect().bottom ?? window.innerHeight;
      setMaxHeight(Math.max(MIN_HEIGHT, Math.floor(Math.min(window.innerHeight * 0.72, bottom - header - 24))));
    };
    onResize();
    const observer = new ResizeObserver(onResize);
    if (stage) observer.observe(stage);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const effective = Math.min(height, maxHeight);
  const folded = effective <= 64;

  const applyHeight = (next: number, persist = true) => {
    const clamped = Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.round(next)));
    setHeight(clamped);
    if (persist) {
      try {
        localStorage.setItem(HEIGHT_KEY, String(clamped));
      } catch {
        /* private mode: height lives for this session */
      }
    }
  };

  return (
    <section
      className={`editor-sidebar editor-properties touch-properties-sheet ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
      data-editor-obstacle={open ? "" : undefined}
      aria-label="لوحة الخصائص"
      aria-hidden={!open}
      inert={!open}
      style={{ height: effective }}
    >
      <div className="touch-properties-header">
        <div
          className="touch-properties-grip"
          role="slider"
          tabIndex={open ? 0 : -1}
          aria-label="اسحب لتغيير ارتفاع لوحة الخصائص"
          aria-orientation="vertical"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={maxHeight}
          aria-valuenow={effective}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              applyHeight(effective + (e.key === "ArrowUp" ? 40 : -40));
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || drag.current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              id: e.pointerId,
              y: e.clientY,
              height:
                e.currentTarget.parentElement!.parentElement!.getBoundingClientRect()
                  .height,
            };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (!start || start.id !== e.pointerId) return;
            // Live sizing during the drag; persisted once on release, so a
            // rotation-triggered clamp never overwrites the stored height.
            applyHeight(
              Math.max(
                MIN_HEIGHT,
                Math.min(
                  maxHeight,
                  start.height + e.clientY - start.y,
                ),
              ),
              false,
            );
          }}
          onPointerUp={(e) => {
            if (drag.current?.id !== e.pointerId) return;
            drag.current = null;
            setDragging(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
            applyHeight(height < 100 ? MIN_HEIGHT : height);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <span /> <span>الخصائص والطبقات</span>
        </div>
        <button
          type="button"
          aria-label={folded ? "توسيع الخصائص" : "طي الخصائص"}
          aria-expanded={!folded}
          onClick={() => applyHeight(folded ? DEFAULT_HEIGHT : MIN_HEIGHT)}
        >
          {folded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
        <button type="button" aria-label="إغلاق لوحة الخصائص" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="touch-properties-content" inert={folded}>
        {children}
      </div>
    </section>
  );
}
