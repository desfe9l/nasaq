import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Italic,
  Layers,
  MoveDown,
  MoveUp,
  Trash2,
  Underline,
} from "lucide-react";
import { TYPE_NAME, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { placeFloatingToolbar } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";
import { ScrubInput } from "./ui/ScrubInput";

/** Elements that render an editable text body. */
const TEXT_TYPES = new Set(["text", "box", "stat", "stamp", "progress"]);

/** Gap between the selected element and the toolbar (spec: 16px). */
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

  const fontChoices = useEditor((s) => s.fontChoices);
  const zoom = useEditor((s) => s.zoom);
  const scrollIntoView = useEditor((s) => s.pages);
  const updateStyle = useEditor((s) => s.updateStyle);
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const bring = useEditor((s) => s.bring);

  /**
   * Place the toolbar 16px above the element, flipping below when there is no
   * room, and clamp horizontally so it can never leave the viewport.
   */
  const place = useCallback(() => {
    const target = document.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(el.id)}"]`);
    const toolbar = boxRef.current;
    if (!target || !toolbar) return;
    const rect = target.getBoundingClientRect();
    const size = toolbar.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    // The arithmetic is pure and unit-tested (`placeFloatingToolbar`); this
    // callback only feeds it live screen measurements.
    const { left, top } = placeFloatingToolbar(
      rect,
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
      GAP,
      MARGIN,
    );
    setPos({ left, top });
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
    return () => {
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

  return (
    <div
      ref={boxRef}
      className="floating-toolbar"
      data-floating-toolbar={el.id}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
      // The toolbar is chrome over the document: pointer events must never
      // reach the canvas beneath it.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
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
                updateStyle(el.id, { fontWeight: Number(style.fontWeight) >= 700 ? 500 : 800 });
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
                updateStyle(el.id, { fontStyle: style.fontStyle === "italic" ? "normal" : "italic" });
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
              onChange={(event) => updateStyle(el.id, { color: event.target.value }, true)}
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
                    updateStyle(el.id, { textAlign: item.id as "right" | "center" | "left" | "justify" });
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
            <span className="px-1 text-[10px] font-extrabold text-muted">تعبئة</span>
            <input
              className="floating-toolbar-swatch"
              type="color"
              aria-label="لون التعبئة"
              title="لون التعبئة"
              value={style.fill || style.background || "#006c35"}
              onChange={(event) => updateStyle(el.id, { fill: event.target.value }, true)}
              onBlur={() => {
                updateStyle(el.id, { fill: style.fill });
                commit();
              }}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">إطار</span>
            <input
              className="floating-toolbar-swatch"
              type="color"
              aria-label="لون الإطار"
              title="لون الإطار"
              value={style.borderColor || style.color || "#c9a86a"}
              onChange={(event) => updateStyle(el.id, { borderColor: event.target.value }, true)}
              onBlur={() => {
                updateStyle(el.id, { borderColor: style.borderColor });
                commit();
              }}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">شفافية</span>
            <input
              className="floating-toolbar-range"
              type="range"
              min={0}
              max={100}
              step={1}
              aria-label="الشفافية"
              title="الشفافية"
              value={Math.round((el.opacity ?? 1) * 100)}
              onChange={(event) => updateElement(el.id, { opacity: Number(event.target.value) / 100 }, true)}
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
          className={cn("floating-toolbar-btn", "text-[#b42318]")}
          title="حذف"
          aria-label="حذف"
          onClick={deleteSelected}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
