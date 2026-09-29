import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Group,
  Italic,
  Layers,
  Lock,
  Move,
  MoveDown,
  MoveUp,
  Paintbrush,
  Scaling,
  Trash2,
  Underline,
  Ungroup,
  Unlock,
  X,
} from "lucide-react";
import { TYPE_NAME, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { useInteraction } from "@/lib/editor/interaction-store";
import { placeFloatingToolbar } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";
import { StrokeControls } from "./StrokeControls";
import { ScrubInput } from "./ui/ScrubInput";
import { ColorField } from "./ui/ColorField";

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
  /*
   * Follow the element while it is being dragged/rotated WITHOUT subscribing
   * to the document: the transient interaction store bumps `version` for this
   * element only. (The old `pages` subscription re-rendered the bubble on
   * every document write, and a drag wrote per frame.)
   */
  const dragVersion = useInteraction(
    (s) => (s.overrides[el.id] ? s.version : 0),
  );
  const updateStyle = useEditor((s) => s.updateStyle);
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const copyStyle = useEditor((s) => s.copyStyle);
  const pasteStyle = useEditor((s) => s.pasteStyle);
  const styleClipboard = useEditor((s) => s.styleClipboard);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const bring = useEditor((s) => s.bring);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const bubbleOffset = useEditor((s) => s.bubbleOffset);
  const setBubbleOffset = useEditor((s) => s.setBubbleOffset);
  const [dragging, setDragging] = useState(false);
  const flipSelected = useEditor((s) => s.flipSelected);
  const toggleResizeLock = useEditor((s) => s.toggleResizeLock);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const group = useEditor((s) => s.group);
  const ungroup = useEditor((s) => s.ungroup);
  const selectedIds = useEditor((s) => s.selectedIds);

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
    // A narrow tool rail must not force a phone toolbar down to the page rail.
    // Fit its scrollable row into the lane beside the tools before placing it.
    let laneLeft = MARGIN, laneRight = window.innerWidth - MARGIN;
    document.querySelectorAll<HTMLElement>('[data-editor-obstacle="tool-dock"]').forEach(dock => {
      const r = dock.getBoundingClientRect();
      if (!r.width || r.height < r.width || getComputedStyle(dock).visibility === "hidden") return;
      if (r.left > rect.left + rect.width / 2) laneRight = Math.min(laneRight, r.left - MARGIN);
      else if (r.right < rect.left + rect.width / 2) laneLeft = Math.max(laneLeft, r.right + MARGIN);
    });
    toolbar.style.maxWidth = `${Math.min(640, window.innerWidth - MARGIN * 2, Math.max(240, laneRight - laneLeft))}px`;
    const size = toolbar.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    // Keep the bubble clear of the real, outward-expanded grip hit regions,
    // not just the visible 7px dots. These measurements include rotation/zoom.
    const grips = [...document.querySelectorAll<HTMLElement>(
      `.selection-frame[data-el-id="${CSS.escape(el.id)}"] .handle, .selection-frame[data-el-id="${CSS.escape(el.id)}"] .rotate-handle`,
    )].map(node => node.getBoundingClientRect());
    /*
     * The selection frame can be the MEASURED artwork box, so it is part of
     * the anchor: the bubble must clear what the author sees as "the
     * selection", not just the element's layout box.
     */
    const frameNode = document.querySelector<HTMLElement>(
      `.selection-frame[data-el-id="${CSS.escape(el.id)}"]`,
    );
    if (frameNode) grips.push(frameNode.getBoundingClientRect());
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
      .filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden")
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
    /*
     * A manual park wins over the automatic placement, still clamped into the
     * viewport so a resized window can never strand the bubble off screen.
     */
    const offset = useEditor.getState().bubbleOffset;
    const parked = offset
      ? {
          left: Math.min(
            Math.max(left + offset.dx, MARGIN),
            Math.max(MARGIN, window.innerWidth - size.width - MARGIN),
          ),
          top: Math.min(
            Math.max(top + offset.dy, MARGIN),
            Math.max(MARGIN, window.innerHeight - size.height - MARGIN),
          ),
        }
      : { left, top };
    setPos(parked);
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
    document.querySelectorAll("[data-editor-obstacle]").forEach(node => observer.observe(node));
    if (boxRef.current) observer.observe(boxRef.current);
    window.addEventListener("nasaq:panel-layout", schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener("nasaq:panel-layout", schedule);
      window.removeEventListener("transitionend", schedule, true);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [place, el.x, el.y, el.w, el.h, el.rotation, zoom, dragVersion, bubbleOffset]);

  /**
   * Drag the bubble by its grip and remember where it lands.
   *
   * Deltas are accumulated against the bubble's live rect (never the model),
   * and each move writes the offset through the store so the placement effect
   * keeps honouring the park without fighting the pointer.
   */
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const toolbar = boxRef.current;
    if (!toolbar) return;
    const origin = toolbar.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = useEditor.getState().bubbleOffset ?? { dx: 0, dy: 0 };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const next = { dx: base.dx + dx, dy: base.dy + dy };
      /* Clamp the travel so the parked bubble can never leave the viewport. */
      next.dx = Math.min(
        Math.max(next.dx, base.dx + MARGIN - origin.left),
        Math.max(base.dx + window.innerWidth - origin.width - MARGIN - origin.left, base.dx + MARGIN - origin.left),
      );
      next.dy = Math.min(
        Math.max(next.dy, base.dy + MARGIN - origin.top),
        Math.max(base.dy + window.innerHeight - origin.height - MARGIN - origin.top, base.dy + MARGIN - origin.top),
      );
      useEditor.getState().setBubbleOffset(next);
    };
    const end = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

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
      className={cn("floating-toolbar", dragging && "is-dragging")}
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
      dir="rtl"
      role="toolbar"
      aria-label={`أدوات ${el.name || TYPE_NAME[el.type]}`}
    >
      {/*
       * Drag grip — the bubble can be parked anywhere on screen, and
       * double-clicking the grip hands placement back to the automatic
       * scoring (above → below → sides, never over the artwork).
       */}
      <button
        type="button"
        className="floating-toolbar-btn floating-toolbar-grip"
        title="اسحب لنقل الشريط — نقرتان لإعادته إلى الموضع التلقائي"
        aria-label="نقل الشريط العائم"
        onPointerDown={startDrag}
        onDoubleClick={() => setBubbleOffset(null)}
      >
        <Move className="size-3.5" />
      </button>
      <span className="floating-toolbar-sep" aria-hidden />
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
            <ColorField
              className="floating-toolbar-swatch"
              label="لون النص"
              value={style.color}
              fallback="#172033"
              onChange={(v) => updateStyle(el.id, { color: v }, true)}
              onCommit={(v) => updateStyle(el.id, { color: v })}
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

      <StrokeControls />

      {isObject && (
        <>
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">
              تعبئة
            </span>
            <ColorField
              className="floating-toolbar-swatch"
              label="لون التعبئة"
              value={el.type === "svg" ? style.svgFill : style.fill}
              fallback={style.background || "#006c35"}
              allowNone
              onChange={(v) => updateStyle(el.id, el.type === "svg" ? { svgFill: v } : { fill: v }, true)}
              onCommit={(v) => updateStyle(el.id, el.type === "svg" ? { svgFill: v } : { fill: v })}
            />
          </div>
          <span className="floating-toolbar-sep" aria-hidden />
          <div className="floating-toolbar-section">
            <span className="px-1 text-[10px] font-extrabold text-muted">
              إطار
            </span>
            <ColorField
              className="floating-toolbar-swatch"
              label="لون الإطار"
              value={el.type === "line" || el.type === "divider" ? style.color : el.type === "svg" || el.type === "icon" ? style.svgStroke : style.borderColor}
              fallback={style.color || "#c9a86a"}
              onChange={(v) => updateStyle(el.id, el.type === "line" || el.type === "divider" ? { color: v } : el.type === "svg" || el.type === "icon" ? { svgStroke: v } : { borderColor: v }, true)}
              onCommit={(v) => updateStyle(el.id, el.type === "line" || el.type === "divider" ? { color: v } : el.type === "svg" || el.type === "icon" ? { svgStroke: v } : { borderColor: v })}
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
        {/*
         * الظهور أولًا: تبديل إخفاء/إظهار العنصر بعين واحدة — أحد أزرار
         * «التحكم والإخفاء» الموحدة حول العنصر المحدد.
         */}
        <button
          type="button"
          className="floating-toolbar-btn"
          title="إخفاء العنصر (يظهر مرة أخرى من شجرة الطبقات)"
          aria-label="إخفاء العنصر"
          onClick={() => toggleHidden()}
        >
          <EyeOff className="size-3.5" />
        </button>
        {/*
         * القفل: الحالة أحادية اللمس (بنفس بنفس same purple as the
         * locked frame) والعنصر يبقى محددًا — الفتح من هنا أو من Properties.
         */}
        <button
          type="button"
          className={cn(
            "floating-toolbar-btn",
            el.locked && "is-locked-active",
          )}
          aria-pressed={el.locked === true}
          title={el.locked ? "فتح القفل" : "قفل العنصر (منع التحرير)"}
          aria-label={el.locked ? "فتح القفل" : "قفل العنصر"}
          onClick={() => toggleLock()}
        >
          {el.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
        </button>
        {/* التجميع السريع — فقط عند تحديد عنصرين فأكثر / فك تجميع مجموعة. */}
        {selectedIds.length >= 2 && (
          <button
            type="button"
            className="floating-toolbar-btn"
            title="تجميع (⌘G)"
            aria-label="تجميع"
            onClick={() => group()}
          >
            <Group className="size-3.5" />
          </button>
        )}
        {el.type === "group" && (
          <button
            type="button"
            className="floating-toolbar-btn"
            title="فك التجميع (⇧⌘G)"
            aria-label="فك التجميع"
            onClick={() => ungroup()}
          >
            <Ungroup className="size-3.5" />
          </button>
        )}
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
          className="floating-toolbar-btn"
          title="نسخ التنسيق"
          aria-label="نسخ التنسيق"
          onClick={copyStyle}
        >
          <Paintbrush className="size-3.5" />
        </button>
        <button
          type="button"
          className="floating-toolbar-btn"
          title="لصق التنسيق"
          aria-label="لصق التنسيق"
          onClick={pasteStyle}
          disabled={!styleClipboard}
        >
          <Paintbrush className="size-3.5" />
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
          className={cn("floating-toolbar-btn", "text-error")}
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
