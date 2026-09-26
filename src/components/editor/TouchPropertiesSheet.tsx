import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

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
  const [height, setHeight] = useState(320);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const folded = height <= 64;
  return (
    <section
      className={`editor-sidebar editor-properties touch-properties-sheet ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
      data-editor-obstacle={open ? "" : undefined}
      aria-label="لوحة الخصائص"
      aria-hidden={!open}
      inert={!open}
      style={{ height }}
    >
      <div className="touch-properties-header">
        <div
          className="touch-properties-grip"
          role="slider"
          tabIndex={open ? 0 : -1}
          aria-label="اسحب لتغيير ارتفاع لوحة الخصائص"
          aria-valuemin={56}
          aria-valuemax={Math.round(
            typeof window === "undefined" ? 600 : window.innerHeight * 0.72,
          )}
          aria-valuenow={height}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setHeight((h) =>
                Math.max(
                  56,
                  Math.min(
                    window.innerHeight * 0.72,
                    h + (e.key === "ArrowUp" ? 40 : -40),
                  ),
                ),
              );
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
            setHeight(
              Math.max(
                56,
                Math.min(
                  window.innerHeight * 0.72,
                  start.height + start.y - e.clientY,
                ),
              ),
            );
          }}
          onPointerUp={(e) => {
            if (drag.current?.id !== e.pointerId) return;
            drag.current = null;
            setDragging(false);
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (height < 100) setHeight(56);
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
          <span /> <span>الخصائص</span>
        </div>
        <button
          type="button"
          aria-label={folded ? "توسيع الخصائص" : "طي الخصائص"}
          aria-expanded={!folded}
          onClick={() => setHeight(folded ? 320 : 56)}
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
