import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Layers,
  MoveDown,
  MoveUp,
  Scaling,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { TYPE_NAME, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { placeFloatingToolbar } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";
import { ScrubInput } from "./ui/ScrubInput";

/** Elements that render an editable text body. */
const TEXT_TYPES = new Set(["text", "box", "stat", "stamp", "progress"]);

/** Gap between the selection interaction bounds and the toolbar. */
const GAP = 16;
/** Minimum distance from the viewport edges. */
const MARGIN = 8;

/**
 * Floating contextual toolbar.
 *
 * Anchor maths are done in SCREEN space (a `getBoundingClientRect` of the live
 * element), never from the element's mm geometry — that is what keeps the
 * toolbar glued to the artwork through zoom, scroll and rotation, and it makes
 * the whole computation RTL-agnostic: physical pixels have no direction. The
 * only RTL-sensitive part is the toolbar's own content, which stays `dir="rtl"`
 * so Arabic labels read correctly.
 *
 * The same option sets the top toolbar uses are reused here (`fontChoices`,
 * `updateStyle`, `updateElement`), so there is no second formatting model.
 */
export function FloatingToolbar({ el }: { el: CanvasEl }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** Which side the bubble settled on — drives its entrance animation. */
  const [side, setSide] = useState<"above" | "below" | "left" | "right">(
    "above",
  );

  const fontChoices = useEditor((s) => s.fontChoices);
  const zoom = useEditor((s) => s.zoom);
  const scrollIntoView = useEditor((s) => s.pages);
  const updateStyle = useEditor((s) => s.updateStyle);
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const bring = useEditor((s) => s.bring);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const flipSelected = useEditor((s) => s.flipSelected);
  const toggleResizeLock = useEditor((s) => s.toggleResizeLock);

  /**
   * Place the toolbar 16px beyond the grips, flipping below when there is no
   * room, and clamp horizontally so it can never leave the viewport.
   */
  const place = useCallback(() => {
    const target = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id] [data-el-id="${CSS.escape(el.id)}"]`,
    );
    const toolbar = boxRef.current;
    if (!target || !toolbar) return;
    const rect = target.getBoundingClientRect();
    const size = toolbar.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    // Keep the bubble clear of the real, outward-expanded grip hit regions,
    // not just the visible 7px dots. These measurements include rotation/zoom.
    const grips = [...document.querySelectorAll<HTMLElement>(
      `.selection-frame[data-el-id="${CSS.escape(el.id)}"] .handle, .selection-frame[data-el-id="${CSS.escape(el.id)}"] .rotate-handle`,
    )].map(node => node.getBoundingClientRect());
    const leftEdge = Math.min(rect.left, ...grips.map(r => r.left));
    const rightEdge = Math.max(rect.right, ...grips.map(r => r.right));
    const topEdge = Math.min(rect.top, ...grips.map(r => r.top));
    const bottomEdge = Math.max(rect.bottom, ...grips.map(r => r.bottom));
    const interactionBox = { left: leftEdge, right: rightEdge, top: topEdge,
      bottom: bottomEdge, width: rightEdge - leftEdge, height: bottomEdge - topEdge };
    /*
     * Obstacles: the header, both sidebars, the pages rail and the status bar
     * all mark themselves `data-editor-obstacle`. Measuring them at placement
     * time (rather than assuming fixed widths) means the bubble dodges a
     * resized panel, a collapsed sidebar or a floating drawer exactly as it
     * dodges the docked layout.
     */
    const avoid = [
      ...document.querySelectorAll<HTMLElement>("[data-editor-obstacle]"),
    ]
      .filter((node) => node.offsetParent !== null)
      .map((node) => node.getBoundingClientRect());
    // The arithmetic is pure and unit-tested (`placeFloatingToolbar`); this
    // callback only feeds it live screen measurements.
    const { left, top, placement } = placeFloatingToolbar(
      interactionBox,
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
      GAP,
      MARGIN,
      [...avoid, ...grips],
    );
    setPos({ left, top });
    setSide(placement);
  }, [el.id]);

  // Re-place on every input that can move the element on screen: its own
  // geometry, the zoom, a page re-render, a scroll inside the stage, a resize.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    schedule();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("transitionend", schedule, true);
    const observer = new ResizeObserver(schedule);
    document.querySelectorAll(".touch-properties-sheet").forEach(node => observer.observe(node));
    return () => {
      observer.disconnect();
      window.removeEventListener("transitionend", schedule, true);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [place, el.x, el.y, el.w, el.h, el.rotation, zoom, scrollIntoView]);

  const style = el.style || {};
  const isText = TEXT_TYPES.has(el.type);
  /** Shapes / images / icons / lines / tables: the "object" tool set. */
  const isObject = !isText;

  const align: Array<{ id: string; label: string; icon: typeof AlignRight }> = [
    { id: "right", label: "محاذاة لليمين", icon: AlignRight },
    { id: "center", label: "توسيط", icon: AlignCenter },
    { id: "left", label: "محاذاة لليسار", icon: AlignLeft },
    { id: "justify", label: "ضبط", icon: AlignJustify },
  ];

  /*
   * Portalled to `document.body` on purpose: the bubble is `position: fixed`
   * and must sit above the docked panel layer (`--z-bubble` > `--z-panel`),
   * while the canvas stage itself is deliberately isolated so artboard layers
   * can never escape it. Rendering here keeps both invariants true.
   */
  return createPortal(
    <div
      ref={boxRef}
      className="floating-toolbar"
      data-floating-toolbar={el.id}
      data-placement={side}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      // The toolbar is chrome over the document: pointer events must never
      // reach the canvas beneath it. Right-click is stopped here too — the
      // stopPropagation means the workspace handler never runs, so without
      // preventDefault the browser's own menu would appear over the canvas.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      role="toolbar"
      aria-label={`أدوات ${el.name || TYPE_NAME[el.type]}`}
    >
      {isText && (
        <>
          <div className="floating-toolbar-section">
            <select
              className="floating-toolbar-select"
              aria-label="نوع الخط"
              value={style.fontFamily || "Tajawal"}
              onChange={(event) => {
                updateStyle(el.id, { fontFamily: event.target.value });
                commit();
              }}
              title="نوع الخط"
            >
              {fontChoices.map((font) => (
                <option key={font.family} value={font.family}>
                  {font.family}
                </option>
              ))}
            </select>
            {/*
             * Font size uses the shared scrubber: drag the value (or its
             * label) horizontally, Shift for ×10, and ± steppers that stay
             * thumb-sized on touch — the same gesture as the properties panel,
             * so the author does not relearn it mid-canvas.
             */}
            <ScrubInput
              className="floating-toolbar-scrub"
              label="حجم الخط"
              value={Math.round(Number(style.fontSize || 12) * 10) / 10}
              min={5}
              max={200}
              step={0.5}
              precision={1}
              suffix="pt"
              onChange={(v) => updateStyle(el.id, { fontSize: v }, true)}
              onCommit={(v) => {
                updateStyle(el.id, { fontSize: v });
                commit();
              }}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <button
              type="button"
              className="floating-toolbar-btn"
              aria-pressed={Number(style.fontWeight || 0) >= 700}
              title="عريض (Bold)"
              aria-label="عريض"
              onClick={() => {
                updateStyle(el.id, {
                  fontWeight: Number(style.fontWeight) >= 700 ? 500 : 800,
                });
                commit();
              }}
            >
              <Bold className="size-3.5" />
            </button>
            <button
              type="button"
              className="floating-toolbar-btn"
              aria-pressed={style.fontStyle === "italic"}
              title="مائل (Italic)"
              aria-label="مائل"
              onClick={() => {
                updateStyle(el.id, {
                  fontStyle: style.fontStyle === "italic" ? "normal" : "italic",
                });
                commit();
              }}
            >
              <Italic className="size-3.5" />
            </button>
            <button
              type="button"
              className="floating-toolbar-btn"
              aria-pressed={style.underline === true}
              title="تحته خط (Underline)"
              aria-label="تحته خط"
              onClick={() => {
                updateStyle(el.id, { underline: style.underline !== true });
                commit();
              }}
            >
              <Underline className="size-3.5" />
            </button>
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <input
              className="floating-toolbar-swatch"
              type="color"
              aria-label="لون النص"
              title="لون النص"
              value={style.color || "#172033"}
              onChange={(event) =>
                updateStyle(el.id, { color: event.target.value }, true)
              }
              onBlur={() => {
                updateStyle(el.id, { color: style.color });
                commit();
              }}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            {align.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="floating-toolbar-btn"
                  aria-pressed={(style.textAlign || "right") === item.id}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => {
                    updateStyle(el.id, {
                      textAlign: item.id as
                        "right" | "center" | "left" | "justify",
                    });
                    commit();
                  }}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        </>
      )}

      {isObject && (
        <>
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">
              تعبئة
            </span>
            <input
              className="floating-toolbar-swatch"
              type="color"
              aria-label="لون التعبئة"
              title="لون التعبئة"
              value={style.fill || style.background || "#006c35"}
              onChange={(event) =>
                updateStyle(el.id, { fill: event.target.value }, true)
              }
              onBlur={() => {
                updateStyle(el.id, { fill: style.fill });
                commit();
              }}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">
              إطار
            </span>
            <input
              className="floating-toolbar-swatch"
              type="color"
              aria-label="لون الإطار"
              title="لون الإطار"
              value={style.borderColor || style.color || "#c9a86a"}
              onChange={(event) =>
                updateStyle(el.id, { borderColor: event.target.value }, true)
              }
              onBlur={() => {
                updateStyle(el.id, { borderColor: style.borderColor });
                commit();
              }}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">
              شفافية
            </span>
            <input
              className="floating-toolbar-range"
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="الشفافية"
              title="الشفافية"
              value={Math.round((el.opacity ?? 1) * 100)}
              onChange={(event) =>
                updateElement(
                  el.id,
                  { opacity: Number(event.target.value) / 100 },
                  true,
                )
              }
              onPointerUp={() => commit()}
              onBlur={() => commit()}
            />
          </div>
        </>
      )}

      <span className="floating-toolbar-sep" aria-hidden />
      <div className="floating-toolbar-section">
        <button
          type="button"
          className="floating-toolbar-btn"
          title="إحضار للأمام"
          aria-label="إحضار للأمام"
          onClick={() => bring("forward")}
        >
          <MoveUp className="size-3.5" />
        </button>
        <button
          type="button"
          className="floating-toolbar-btn"
          title="إرسال للخلف"
          aria-label="إرسال للخلف"
          onClick={() => bring("back")}
        >
          <MoveDown className="size-3.5" />
        </button>
        <button
          type="button"
          className="floating-toolbar-btn"
          title="إلى المقدمة تمامًا"
          aria-label="إلى المقدمة"
          onClick={() => bring("front")}
        >
          <Layers className="size-3.5" />
        </button>
        <button
          type="button"
          className="floating-toolbar-btn"
          title="تكرار (⌘D)"
          aria-label="تكرار"
          onClick={duplicateSelected}
        >
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn("floating-toolbar-btn", el.style?.flipX && "is-active")}
          aria-pressed={el.style?.flipX === true}
          title="قلب أفقي"
          aria-label="قلب أفقي"
          onClick={() => flipSelected("x")}
        >
          <FlipHorizontal2 className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn("floating-toolbar-btn", el.style?.flipY && "is-active")}
          aria-pressed={el.style?.flipY === true}
          title="قلب رأسي"
          aria-label="قلب رأسي"
          onClick={() => flipSelected("y")}
        >
          <FlipVertical2 className="size-3.5" />
        </button>
        {/*
         * قفل التحجيم — independent of the element lock: freezes width/height
         * (handles + size fields) while move, rotate and edit stay free.
         */}
        <button
          type="button"
          className={cn("floating-toolbar-btn", el.resizeLocked && "is-active")}
          aria-pressed={el.resizeLocked === true}
          title={
            el.resizeLocked
              ? "فتح قفل التحجيم"
              : "قفل التحجيم (منع تغيير العرض/الارتفاع)"
          }
          aria-label="قفل التحجيم"
          onClick={() => toggleResizeLock()}
        >
          <Scaling className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn("floating-toolbar-btn", "text-[#b42318]")}
          title="حذف"
          aria-label="حذف"
          onClick={deleteSelected}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <span className="floating-toolbar-sep" aria-hidden />
      {/*
       * Quick dismiss. The author can silence the bubble from the bubble
       * itself (it follows every selection, so it is the thing that is in the
       * way right now); the header eye toggles it back on. The choice is
       * persisted with the rest of the UI state.
       */}
      <button
        type="button"
        className="floating-toolbar-btn"
        title="إخفاء الشريط العائم (يمكن إرجاعه من الترويسة)"
        aria-label="إخفاء الشريط العائم"
        onClick={() => toggleBubble(false)}
      >
        <X className="size-3.5" />
      </button>
    </div>,
    document.body,
  );
}
