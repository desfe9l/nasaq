import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Baseline,
  ChevronDown,
  Copy,
  Contrast,
  Eye,
  FlipHorizontal2,
  FlipVertical2,
  EyeOff,
  Grid2x2,
  GripVertical,
  ImagePlus,
  Link,
  Lock,
  RotateCcw,
  RotateCw,
  Search,
  Scaling,
  Scissors,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { fitBoxToPage } from "@/lib/editor/fit-page";
import { pageSize } from "@/lib/editor/model";
import {
  ICONS,
  SHADOWS,
  THEMES,
  TYPE_NAME,
  findElement,
  parseTable,
  type CanvasEl,
} from "@/lib/editor/model";
import {
  LETTER_SPACINGS,
  LINE_HEIGHTS,
  NUMERAL_OPTIONS,
  PARAGRAPH_SPACINGS,
  TEXT_FIT_OPTIONS,
} from "@/lib/editor/arabic";
import {
  DEFAULT_FADE,
  FADE_BLENDS,
  FADE_DIRECTIONS,
  fadeDirectionLabel,
  normalizeFade,
  type FadeBlend,
  type FadeOverlay,
} from "@/lib/editor/fade";
import { SHAPES } from "@/lib/editor/shapes";
import { buildShadow, parseShadow } from "@/lib/editor/shadow";

/** Element types that can carry a fade overlay (the image family, step 8). */
const FADE_TYPES: ReadonlySet<string> = new Set(["image", "logo", "qr"]);

/** Arabic labels for the blend modes offered on a fade overlay. */
const BLEND_LABEL: Record<string, string> = {
  normal: "عادي",
  multiply: "تراكب ضربي (Multiply)",
  screen: "إضاءة (Screen)",
  overlay: "تغطية (Overlay)",
  "soft-light": "ضوء ناعم (Soft Light)",
  darken: "تغميق (Darken)",
  lighten: "تفتيح (Lighten)",
  luminosity: "إضاءة لونية (Luminosity)",
};

/**
 * Fold any angle into (−180, 180] so a quarter-turn from 170° reads −100°,
 * not 260° — export then renders the element exactly as the canvas shows it.
 */
function normalizeDeg(deg: number): number {
  return (((deg % 360) + 540) % 360) - 180;
}
import { columnTotals, resizeMatrix } from "@/lib/editor/tables";
import { prepareText } from "@/lib/editor/text-render";
import { useEditor } from "@/lib/editor/store";
import { cn, round } from "@/lib/utils";
import { toast } from "sonner";
import { ShapePreview } from "./ShapePreview";
import { AccordionSection, SubGroup, useAccordionState } from "./ui/Accordion";
import { FillField } from "./ui/FillField";
import { PageBackground } from "./PageBackground";
import { beginImageCrop } from "@/lib/editor/crop-session";
import { ColorField } from "./ui/ColorField";
import {
  getRecentColors,
  recordRecentColor,
  subscribeRecentColors,
} from "@/lib/editor/recent-colors";
import { ArabicTextTools } from "./ArabicTextTools";
import { ImageAiTools } from "./ImageAiTools";
import { ScrubField, ScrubInput } from "./ui/ScrubInput";

const TEXT_TYPES = ["text", "box", "stat", "stamp", "table", "progress"];

/**
 * الخصائص — the properties inspector as a STANDALONE window.
 *
 * It used to share a tab strip with the layers list and hide أدوات التقرير
 * behind an accordion; since the split it is its own floating window with its
 * own open state, so it can sit next to the layers window and the report-tools
 * window at the same time.
 */
export function PropertiesPanel({
  onReplaceImage,
}: {
  onReplaceImage: (id: string) => void;
}) {
  /*
   * PERF: the inspector subscribes to the ACTIVE PAGE OBJECT, never the
   * whole `pages` array. A page object keeps its identity until that page
   * itself is edited, so a write to any OTHER page (page furniture, numbering,
   * undo/redo of another page) no longer re-renders the properties panel —
   * and with drags living in the transient interaction layer, even an active
   * page edit re-renders the panel exactly once per committed gesture.
   */
  const page = useEditor((s) =>
    s.rightOpen && !s.focusMode
      ? s.pages.find((p) => p.id === s.activePageId)
      : undefined,
  );
  const selectedId = useEditor((s) =>
    s.rightOpen && !s.focusMode ? s.selectedId : null,
  );
  const updateElement = useEditor((s) => s.updateElement);
  const flipSelected = useEditor((s) => s.flipSelected);
  const toggleFadeOverlay = useEditor((s) => s.toggleFadeOverlay);
  const updateStyle = useEditor((s) => s.updateStyle);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleResizeLock = useEditor((s) => s.toggleResizeLock);
  const toggleWidthLock = useEditor((s) => s.toggleWidthLock);
  const toggleHeightLock = useEditor((s) => s.toggleHeightLock);
  const toggleAspectLock = useEditor((s) => s.toggleAspectLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const group = useEditor((s) => s.group);
  const alignPage = useEditor((s) => s.alignPage);
  const fontChoices = useEditor((s) => s.fontChoices);
  const probeFonts = useEditor((s) => s.probeFonts);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const customIcons = useEditor((s) => s.customIcons);
  const addElement = useEditor((s) => s.addElement);
  const theme = THEMES[useEditor((s) => s.theme)];
  const [cellEditor, setCellEditor] = useState(false);
  const [savingAsset, setSavingAsset] = useState(false);
  /* Core properties start open; infrequent tools remain collapsible. */
  const accordions = useAccordionState<
    "dimensions" | "text" | "background" | "fade"
  >("properties", {
    dimensions: true,
    text: true,
    background: true,
    fade: false,
  });

  /**
   * Turn the selected element into a reusable picture.
   *
   * Rasterising the live node is what lets a *shape* — a divider, a seal, a
   * decorated box — come back later as an image, so the shelf is not limited to
   * things the author already had as files.
   */
  const saveToLibrary = async (el: CanvasEl) => {
    if (savingAsset) return;
    setSavingAsset(true);
    try {
      const { captureElement } = await import("@/lib/editor/export");
      const pageId = useEditor.getState().activePageId;
      const captured = await captureElement(pageId, el.id, 3);
      if (!captured) {
        toast.error("تعذر التقاط العنصر", {
          description: "حاول مرة أخرى، أو أعد تحميل الصفحة إذا تكرر الخطأ.",
        });
        return;
      }
      const saved = await useEditor.getState().addAsset({
        name: el.name || TYPE_NAME[el.type],
        src: captured.src,
        // The trimmed artwork's own size — the shelf card and every later
        // insertion show the element, never the page it lived on.
        w: captured.w,
        h: captured.h,
      });
      if (saved)
        toast.success(`تم حفظ "${saved.name}" في المكتبة`, {
          description: "تجده في تبويب «عناصر» ← مكتبة العناصر.",
        });
    } catch (err) {
      toast.error("تعذر حفظ العنصر في المكتبة", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSavingAsset(false);
    }
  };

  // The font list is needed here for the family selector, so probe on first use
  // rather than making the author open the font tab just to populate the list.
  useEffect(() => {
    probeFonts();
  }, [probeFonts]);

  // Resolves through groups, so a member picked inside a group shows its own
  // properties rather than nothing.
  const el =
    page && selectedId ? findElement(page.elements, selectedId)?.el : undefined;
  /**
   * Corner radius control: only rect-family shapes have corners to round
   * (circle/polygon/path geometry has none). `rounded` shows its preset
   * (14% of the width) until the author scrubs an explicit value.
   */
  const shapeId =
    el?.type === "shape" ? el.style?.shapeId || el.style?.shape || "rect" : "";
  const rectFamilyShape = shapeId === "rect" || shapeId === "rounded";
  /*
   * Step 8 state: the normalised overlay (so a hand-edited save renders the
   * same values the panel shows) plus one writer that keeps every edit in the
   * element's history — the same pathway as any other style change.
   */
  const fade = normalizeFade(el?.style?.fade);
  const updateFade = (patch: Partial<FadeOverlay>, transient = false) => {
    if (!el) return;
    updateElement(
      el.id,
      { style: { ...el.style, fade: { ...(fade ?? DEFAULT_FADE), ...patch } } },
      transient,
    );
  };

  const selectedCount = useEditor((s) =>
    s.rightOpen && !s.focusMode ? s.selectedIds.length : 0,
  );

  return (
    <aside className="editor-properties flex h-full min-h-0 flex-col bg-surface">
      {/*
       * Phase 1 — the panel body is the ONLY scrolling region and is capped by
       * the real header height (`editor-panel-body`), so a short window scrolls
       * inside the panel instead of clipping the last controls.
       */}
      <div className="editor-pane-scroll editor-panel-body no-bottom-pad p-3">
        {!el && (
          <div className="grid gap-2">
            {page && <PageBackground key={page.id} page={page} />}
            <EmptyNote>
              اختر عنصراً على الصفحة لعرض خصائصه: الموضع، المقاس، الدوران،
              الشفافية، الخط، الألوان، الإطار والظل. النقر المزدوج على النص
              يفعّل التعديل المباشر.
            </EmptyNote>
          </div>
        )}

        {selectedCount > 1 && (
          <div className="grid gap-3" data-selection-inspector="multiple">
            <div className="rounded-xl border border-brand/25 bg-navy/5 p-3">
              <p className="text-[11px] font-bold tracking-wide text-brand">
                تحديد متعدد
              </p>
              <h3 className="mt-1 text-[16px] font-extrabold text-ink">
                {selectedCount} عناصر جاهزة للتحرير الجماعي
              </h3>
              <p className="mt-1 text-[10px] leading-4 text-muted">
                المحاذاة والتوزيع تُطبَّق على المجموعة كاملة.
              </p>
            </div>

            <section className="grid gap-2 rounded-lg border border-line p-2.5">
              <h4 className="text-[11px] font-extrabold text-muted">
                محاذاة التحديد
              </h4>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ["right", "يمين", AlignRight],
                    ["center", "وسط أفقي", AlignCenter],
                    ["left", "يسار", AlignLeft],
                    ["top", "أعلى", AlignJustify],
                    ["middle", "وسط رأسي", AlignCenter],
                    ["bottom", "أسفل", AlignJustify],
                  ] as const
                ).map(([edge, label, Icon]) => (
                  <button
                    key={edge}
                    type="button"
                    className="editor-mini-btn justify-center"
                    title={`محاذاة ${label}`}
                    aria-label={`محاذاة ${label}`}
                    onClick={() => align(edge, "selection")}
                  >
                    <Icon className="size-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1.5 border-t border-line pt-2">
                <button
                  type="button"
                  className="editor-mini-btn justify-center"
                  disabled={selectedCount < 3}
                  onClick={() => distribute("h")}
                >
                  توزيع أفقي
                </button>
                <button
                  type="button"
                  className="editor-mini-btn justify-center"
                  disabled={selectedCount < 3}
                  onClick={() => distribute("v")}
                >
                  توزيع رأسي
                </button>
              </div>
            </section>

            <section className="grid grid-cols-2 gap-1.5 rounded-lg border border-line p-2.5">
              <h4 className="col-span-2 text-[11px] font-extrabold text-muted">
                تنظيم سريع
              </h4>
              <button
                type="button"
                className="editor-mini-btn justify-center"
                onClick={group}
              >
                تجميع العناصر
              </button>
              <button
                type="button"
                className="editor-mini-btn justify-center"
                onClick={toggleLock}
              >
                <Lock className="size-3.5" /> قفل التحديد
              </button>
              <button
                type="button"
                className="editor-mini-btn justify-center"
                onClick={toggleHidden}
              >
                <EyeOff className="size-3.5" /> إخفاء التحديد
              </button>
            </section>
          </div>
        )}

        {el && selectedCount === 1 && (
          <div key={el.id} className="grid gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-extrabold">
                {el.name || TYPE_NAME[el.type]}
              </h3>
              <span className="text-[11px] text-muted">
                {TYPE_NAME[el.type]}
              </span>
            </div>

            {/* Phase 2 — «الأبعاد والتحاذي» (open by default). */}
            <AccordionSection
              title="الأبعاد والتحاذي"
              id="dimensions"
              open={accordions.isOpen("dimensions", true)}
              onToggle={() => accordions.toggle("dimensions")}
            >
              <Field label="الاسم">
                <input
                  value={el.name}
                  onChange={(e) =>
                    updateElement(el.id, { name: e.target.value })
                  }
                />
              </Field>

              {/*
               * Scrubbable geometry (Phase 2.3): drag the label or the value to
               * change it, Shift for ×10, Alt for ×0.1; the − / + steppers cover
               * touch. `auto-fit` is what lets the four fields reflow to two or
               * one column as the panel narrows instead of overlapping.
               */}
              <div className="property-grid">
                {(["x", "y", "w", "h"] as const).map((k) => {
                  /*
                   * The resize lock protects width/height everywhere they can
                   * be typed, not only on the canvas handles: position (x/y)
                   * stays free, and so do rotate, flip and every other field.
                   */
                  const sizeLocked =
                    Boolean(el.resizeLocked) ||
                    (k === "w" && Boolean(el.widthLocked)) ||
                    (k === "h" && Boolean(el.heightLocked));
                  return (
                    <ScrubField
                      key={k}
                      label={LABELS[k]}
                      value={round(el[k])}
                      min={k === "w" || k === "h" ? 1 : -500}
                      step={0.5}
                      suffix="مم"
                      disabled={sizeLocked}
                      onChange={(v) => updateElement(el.id, { [k]: v }, true)}
                      onCommit={(v) => updateElement(el.id, { [k]: v })}
                    />
                  );
                })}
                {/*
                 * Step 7 — quarter-turn helpers next to the free-form angle: the
                 * scrubbable field is right for exactness, these two are right
                 * for the 90% case (straighten, then mirror).
                 */}
                <div className="property-grid-span flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-muted">
                    الاتجاه
                  </span>
                  <button
                    type="button"
                    className="editor-mini-btn"
                    title="تدوير 90° بعكس عقارب الساعة"
                    onClick={() =>
                      updateElement(el.id, {
                        rotation: normalizeDeg((el.rotation || 0) + 90),
                      })
                    }
                  >
                    <RotateCcw className="size-3.5" />
                    90°
                  </button>
                  <button
                    type="button"
                    className="editor-mini-btn"
                    title="تدوير 90° مع عقارب الساعة"
                    onClick={() =>
                      updateElement(el.id, {
                        rotation: normalizeDeg((el.rotation || 0) - 90),
                      })
                    }
                  >
                    <RotateCw className="size-3.5" />
                    90°
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "editor-mini-btn",
                      el.style?.flipX && "is-active",
                    )}
                    aria-pressed={el.style?.flipX === true}
                    title="قلب أفقي"
                    onClick={() => flipSelected("x")}
                  >
                    <FlipHorizontal2 className="size-3.5" />
                    قلب أفقي
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "editor-mini-btn",
                      el.style?.flipY && "is-active",
                    )}
                    aria-pressed={el.style?.flipY === true}
                    title="قلب رأسي"
                    onClick={() => flipSelected("y")}
                  >
                    <FlipVertical2 className="size-3.5" />
                    قلب رأسي
                  </button>
                </div>
                <ScrubField
                  label="زاوية الدوران"
                  value={round(el.rotation)}
                  min={-360}
                  max={360}
                  step={1}
                  precision={1}
                  suffix="°"
                  onChange={(v) => updateElement(el.id, { rotation: v }, true)}
                  onCommit={(v) => updateElement(el.id, { rotation: v })}
                />
                <ScrubField
                  label="الشفافية"
                  value={round((el.opacity ?? 1) * 100)}
                  min={0}
                  max={100}
                  step={1}
                  precision={0}
                  suffix="%"
                  onChange={(v) =>
                    updateElement(el.id, { opacity: v / 100 }, true)
                  }
                  onCommit={(v) => updateElement(el.id, { opacity: v / 100 })}
                />
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-extrabold text-muted">
                  محاذاة داخل الصفحة
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      ["right", "يمين"],
                      ["center", "وسط"],
                      ["left", "يسار"],
                      ["top", "أعلى"],
                      ["middle", "منتصف"],
                      ["bottom", "أسفل"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => alignPage(k)}
                      className="h-8 rounded-[8px] border border-line text-[11px] font-bold"
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </AccordionSection>

            {/* Phase 2 — «النص»: content, typography and Arabic handling. */}
            {TEXT_TYPES.includes(el.type) && (
              <AccordionSection
                title="النص"
                id="text"
                open={accordions.isOpen("text", true)}
                onToggle={() => accordions.toggle("text")}
              >
                {TEXT_MARKUP_TYPES.has(el.type) && (
                  <Field label="النص (Enter لسطر جديد)" full>
                    <textarea
                      rows={4}
                      value={el.content || ""}
                      onChange={(e) =>
                        updateElement(el.id, { content: e.target.value }, true)
                      }
                      onBlur={() =>
                        updateElement(el.id, { content: el.content })
                      }
                    />
                  </Field>
                )}
                <SubGroup title="الخط والطباعة">
                  <Field label="الخط">
                    <select
                      value={el.style.fontFamily || "Tajawal"}
                      onChange={(e) =>
                        updateStyle(el.id, { fontFamily: e.target.value })
                      }
                    >
                      {fontChoices.map((f) => (
                        <option key={f.family} value={f.family}>
                          {f.family} — {f.note}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    type="button"
                    onClick={() => setLeftTab("fonts")}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[10px] font-extrabold"
                  >
                    <Baseline className="size-3.5" /> مكتبة الخطوط (
                    {fontChoices.length})
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubField
                      label="الحجم pt"
                      value={round(Number(el.style.fontSize || 14) || 0)}
                      min={4}
                      max={200}
                      step={0.5}
                      onChange={(v) =>
                        updateStyle(el.id, { fontSize: v }, true)
                      }
                      onCommit={(v) => updateStyle(el.id, { fontSize: v })}
                    />
                    <Field label="الوزن">
                      <select
                        value={String(el.style.fontWeight || 600)}
                        onChange={(e) =>
                          updateStyle(el.id, {
                            fontWeight: Number(e.target.value),
                          })
                        }
                      >
                        {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="المحاذاة">
                    <div className="flex gap-1">
                      {(
                        [
                          ["right", AlignRight, "يمين"],
                          ["center", AlignCenter, "وسط"],
                          ["left", AlignLeft, "يسار"],
                          ["justify", AlignJustify, "ضبط"],
                        ] as const
                      ).map(([v, Icon, hint]) => (
                        <button
                          key={v}
                          type="button"
                          title={hint}
                          aria-label={hint}
                          onClick={() => updateStyle(el.id, { textAlign: v })}
                          aria-pressed={el.style.textAlign === v}
                          className={cn(
                            "grid h-9 flex-1 place-items-center rounded-[8px] border",
                            el.style.textAlign === v
                              ? "border-navy bg-navy text-white"
                              : "border-line",
                          )}
                        >
                          <Icon className="size-4" />
                        </button>
                      ))}
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="لون النص">
                      <ColorField
                        value={el.style.color}
                        fallback={theme.ink}
                        label="لون النص"
                        onChange={(v) => updateStyle(el.id, { color: v }, true)}
                        onCommit={(v) => updateStyle(el.id, { color: v })}
                        className="h-9 w-full"
                      />
                    </Field>
                    <ScrubField
                      label="تباعد الحروف مم"
                      value={round(Number(el.style.letterSpacing ?? 0) || 0)}
                      min={-1}
                      max={3}
                      step={0.05}
                      onChange={(v) =>
                        updateStyle(el.id, { letterSpacing: v }, true)
                      }
                      onCommit={(v) => updateStyle(el.id, { letterSpacing: v })}
                    />
                  </div>
                </SubGroup>

                {(el.type === "text" ||
                  el.type === "box" ||
                  el.type === "stat") && (
                  <>
                    <Field
                      label={`تباعد الأسطر — ${(el.style.lineHeight || 1.45).toFixed(2)}`}
                    >
                      <CommitRange
                        min={0.9}
                        max={2.6}
                        step={0.05}
                        value={el.style.lineHeight || 1.45}
                        ariaLabel="تباعد الأسطر"
                        onLive={(v) =>
                          updateStyle(el.id, { lineHeight: v }, true)
                        }
                        onCommit={(v) => updateStyle(el.id, { lineHeight: v })}
                      />
                      <div className="mt-1 flex gap-1">
                        {LINE_HEIGHTS.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            title={`${l.label} (${l.value})`}
                            onClick={() =>
                              updateStyle(el.id, { lineHeight: l.value })
                            }
                            className={cn(
                              "h-7 flex-1 rounded-[6px] border text-[10px] font-extrabold",
                              Math.abs(
                                (el.style.lineHeight || 1.45) - l.value,
                              ) < 0.01
                                ? "border-navy-2 bg-navy-2/5"
                                : "border-line",
                            )}
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <Field label="تباعد الحروف">
                      <div className="flex gap-1">
                        {LETTER_SPACINGS.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            title={l.label}
                            onClick={() =>
                              updateStyle(el.id, { letterSpacing: l.value })
                            }
                            className={cn(
                              "h-8 flex-1 rounded-[6px] border text-[10px] font-extrabold",
                              Math.abs(
                                (el.style.letterSpacing || 0) - l.value,
                              ) < 0.01
                                ? "border-navy-2 bg-navy-2/5"
                                : "border-line",
                            )}
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </>
                )}

                {TEXT_MARKUP_TYPES.has(el.type) && (
                  <SubGroup title="معالجة النص العربي والمساحة">
                    <Field label="شكل الأرقام">
                      <div className="grid grid-cols-2 gap-1.5">
                        {NUMERAL_OPTIONS.map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            onClick={() =>
                              updateStyle(el.id, { numerals: n.id })
                            }
                            className={cn(
                              "h-9 rounded-[8px] border text-[11px] font-extrabold",
                              (el.style.numerals || "western") === n.id
                                ? "border-navy-2 bg-navy-2/5"
                                : "border-line",
                            )}
                          >
                            {n.label}{" "}
                            <span className="text-muted">{n.sample}</span>
                          </button>
                        ))}
                      </div>
                    </Field>

                    <Field label="الفراغ بين الفقرات">
                      <div className="flex gap-1">
                        {PARAGRAPH_SPACINGS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              updateStyle(el.id, { paragraphSpacing: p.value })
                            }
                            aria-pressed={
                              (el.style.paragraphSpacing || 0) === p.value
                            }
                            className={cn(
                              "h-8 flex-1 rounded-[6px] border text-[10px] font-extrabold",
                              (el.style.paragraphSpacing || 0) === p.value
                                ? "border-navy-2 bg-navy-2/5"
                                : "border-line",
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    <Field label="مساحة النص">
                      <select
                        value={el.style.textBoxMode || "autoHeight"}
                        onChange={(e) => {
                          const textBoxMode = e.target.value as
                            | "free"
                            | "autoHeight"
                            | "fixed"
                            | "autoWidth"
                            | "fit";
                          updateStyle(el.id, {
                            textBoxMode,
                            overflowVisible: textBoxMode !== "fixed",
                          });
                          if (textBoxMode === "free" || textBoxMode === "autoHeight") {
                            queueMicrotask(() => fitTextBox(el.id));
                          }
                        }}
                      >
                        <option value="free">مساحة حرة — المقاس يتبع النص</option>
                        <option value="autoHeight">ارتفاع حر — العرض ثابت</option>
                        <option value="autoWidth">عرض حر</option>
                        <option value="fixed">إطار ثابت</option>
                        <option value="fit">تصغير الخط داخل الإطار</option>
                      </select>
                    </Field>

                    <Field label="النص الطويل">
                      <select
                        value={el.style.textFit || "clip"}
                        onChange={(e) =>
                          updateStyle(el.id, {
                            textFit: e.target.value as
                              "clip" | "shrink" | "grow",
                          })
                        }
                      >
                        {TEXT_FIT_OPTIONS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label} — {t.hint}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <TextFitStatus el={el} />

                    {el.style.textFit === "shrink" && (
                      <p className="text-[10px] leading-4 text-muted">
                        يُصغَّر الخط تلقائياً ليتسع النص داخل الإطار — يتوقف عند
                        أدنى حجم مقروء.
                      </p>
                    )}

                    {el.style.textAlign === "justify" && (
                      <Field label="السطر الأخير">
                        <div className="grid grid-cols-2 gap-1.5">
                          {(
                            [
                              ["start", "إلى اليمين"],
                              ["stretch", "ممتد"],
                            ] as const
                          ).map(([v, l]) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() =>
                                updateStyle(el.id, { justifyLastLine: v })
                              }
                              aria-pressed={
                                (el.style.justifyLastLine || "start") === v
                              }
                              className={cn(
                                "h-8 rounded-[6px] border text-[10px] font-extrabold",
                                (el.style.justifyLastLine || "start") === v
                                  ? "border-navy-2 bg-navy-2/5"
                                  : "border-line",
                              )}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </Field>
                    )}

                    <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                      إظهار النص الزائد
                      <input
                        type="checkbox"
                        checked={Boolean(el.style.overflowVisible)}
                        onChange={(e) =>
                          updateStyle(el.id, {
                            overflowVisible: e.target.checked,
                          })
                        }
                        className="accent-navy"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                        الاتجاه عمودي
                        <input
                          type="checkbox"
                          checked={el.style.writingMode === "vertical"}
                          onChange={(e) =>
                            updateStyle(el.id, {
                              writingMode: e.target.checked
                                ? "vertical"
                                : "horizontal",
                            })
                          }
                          className="accent-navy"
                        />
                      </label>
                      <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                        إزالة التشكيل
                        <input
                          type="checkbox"
                          checked={Boolean(el.style.stripTashkeel)}
                          onChange={(e) =>
                            updateStyle(el.id, {
                              stripTashkeel: e.target.checked,
                            })
                          }
                          className="accent-navy"
                        />
                      </label>
                      <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                        احترام أسطر النص
                        <input
                          type="checkbox"
                          checked={Boolean(el.style.preserveBreaks)}
                          onChange={(e) =>
                            updateStyle(el.id, {
                              preserveBreaks: e.target.checked,
                            })
                          }
                          className="accent-navy"
                        />
                      </label>
                      <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                        ربط الوحدات
                        <input
                          type="checkbox"
                          checked={Boolean(el.style.bindUnits)}
                          onChange={(e) =>
                            updateStyle(el.id, { bindUnits: e.target.checked })
                          }
                          className="accent-navy"
                        />
                      </label>
                      <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                        ترقيم عربي
                        <input
                          type="checkbox"
                          checked={Boolean(el.style.arabicPunctuation)}
                          onChange={(e) =>
                            updateStyle(el.id, {
                              arabicPunctuation: e.target.checked,
                            })
                          }
                          className="accent-navy"
                        />
                      </label>
                    </div>

                    {el.style.writingMode === "vertical" && (
                      <p className="text-[10px] leading-4 text-muted">
                        الاتجاه العمودي مناسب لعناوين الكعب والغلاف الجانبي.
                        تأكد من كفاية ارتفاع العنصر.
                      </p>
                    )}
                  </SubGroup>
                )}

                {/*
                 * Section 2 + 3 + 5 — Arabic typography presets, opt-in kashida
                 * justification and the dynamic macro tokens. All three are
                 * per-element text tools, so they live inside «النص» rather than
                 * in a section of their own.
                 */}
                {TEXT_MARKUP_TYPES.has(el.type) && <ArabicTextTools el={el} />}
              </AccordionSection>
            )}

            {/*
             * Phase 2 — «الخلفية والحدود»: every fill / border / shadow control,
             * including the per-element-type blocks, behind one collapsible
             * group so the inspector stays scannable.
             */}
            <AccordionSection
              title="الخلفية والحدود"
              id="background"
              open={accordions.isOpen("background", true)}
              onToggle={() => accordions.toggle("background")}
            >
              {["box", "stat", "progress"].includes(el.type) && (
                <SubGroup title="المظهر والتعبئة">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="التعبئة">
                      <FillField
                        value={el.style.fill}
                        gradient={el.style.gradient}
                        fallback={theme.surface}
                        label="لون التعبئة"
                        onChange={(v, gradient) =>
                          updateStyle(el.id, { fill: v, gradient }, true)
                        }
                        onCommit={(v, gradient) =>
                          updateStyle(el.id, { fill: v, gradient })
                        }
                        className="h-9 w-full"
                      />
                    </Field>
                    <Field label="لون الخلفية">
                      <ColorField
                        value={el.style.background || el.style.fill}
                        fallback={theme.surface}
                        label="لون الخلفية"
                        onChange={(v) =>
                          updateStyle(el.id, { background: v }, true)
                        }
                        onCommit={(v) => updateStyle(el.id, { background: v })}
                        className="h-9 w-full"
                      />
                    </Field>
                    <Field label="الإطار">
                      <ColorField
                        value={el.style.borderColor}
                        fallback={theme.line}
                        label="لون الإطار"
                        onChange={(v) =>
                          updateStyle(el.id, { borderColor: v }, true)
                        }
                        onCommit={(v) => updateStyle(el.id, { borderColor: v })}
                        className="h-9 w-full"
                      />
                    </Field>
                    <ScrubField
                      label="سماكة الإطار مم"
                      value={round(Number(el.style.borderWidth ?? 0.35) || 0)}
                      min={0}
                      step={0.05}
                      onChange={(v) =>
                        updateStyle(el.id, { borderWidth: v }, true)
                      }
                      onCommit={(v) => updateStyle(el.id, { borderWidth: v })}
                    />
                    <StrokeStyleField
                      dash={el.style.borderDash === true}
                      onPick={(dashed) => {
                        if (dashed === (el.style.borderDash === true)) return;
                        updateStyle(el.id, { borderDash: dashed });
                      }}
                    />
                    <ScrubField
                      label="الزوايا مم"
                      value={round(Number(el.style.radius || 0) || 0)}
                      min={0}
                      step={0.5}
                      onChange={(v) => updateStyle(el.id, { radius: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { radius: v })}
                    />
                    <ScrubField
                      label="الحاشية مم"
                      value={round(Number(el.style.padding ?? 4) || 0)}
                      min={0}
                      step={0.5}
                      onChange={(v) => updateStyle(el.id, { padding: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { padding: v })}
                    />
                  </div>
                </SubGroup>
              )}

              {el.type === "progress" && (
                <>
                  <Field label="النوع" full>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["bar", "ring", "steps"] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => updateStyle(el.id, { variant: v })}
                          className={cn(
                            "h-9 rounded-[8px] border text-[11px] font-extrabold",
                            (el.style.variant || "bar") === v
                              ? "border-navy-2 bg-navy-2/5"
                              : "border-line",
                          )}
                        >
                          {v === "bar"
                            ? "شريط أفقي"
                            : v === "ring"
                              ? "حلقة دائرية"
                              : "نقاط مراحل"}
                        </button>
                      ))}
                    </div>
                  </Field>

                  {(el.style.variant || "bar") === "steps" && (
                    <ScrubField
                      label="عدد المراحل"
                      value={Number(el.style.steps) || 5}
                      min={2}
                      max={12}
                      step={1}
                      precision={0}
                      full
                      onChange={(v) => updateStyle(el.id, { steps: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { steps: v })}
                    />
                  )}

                  <Field
                    label={`نسبة الإنجاز: ${Math.round(Number(el.style.value) || 0)}%`}
                    full
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Number(el.style.value) || 0}
                      onChange={(e) =>
                        updateStyle(
                          el.id,
                          { value: Number(e.target.value) },
                          true,
                        )
                      }
                      onBlur={() =>
                        updateStyle(el.id, { value: el.style.value })
                      }
                      className="w-full accent-navy"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <ScrubField
                      label="رقم النسبة"
                      value={round(
                        Number(Math.round(Number(el.style.value) || 0)) || 0,
                      )}
                      min={0}
                      max={100}
                      step={0.5}
                      onChange={(v) => updateStyle(el.id, { value: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { value: v })}
                    />
                    <Field label="عرض الرقم">
                      <select
                        value={el.style.showValue === false ? "no" : "yes"}
                        onChange={(e) =>
                          updateStyle(el.id, {
                            showValue: e.target.value === "yes",
                          })
                        }
                      >
                        <option value="yes">ظاهر</option>
                        <option value="no">مخفي</option>
                      </select>
                    </Field>
                    <Field label="تعبئة الشريط">
                      <FillField
                        value={el.style.fill}
                        gradient={el.style.gradient}
                        fallback={theme.primary}
                        className="h-9 w-full"
                        onChange={(fill, gradient) =>
                          updateStyle(el.id, { fill, gradient }, true)
                        }
                        onCommit={(fill, gradient) =>
                          updateStyle(el.id, { fill, gradient })
                        }
                      />
                    </Field>
                    <Field label="لون المسار">
                      <input
                        type="color"
                        value={toColor(el.style.background, "#e8ecf3")}
                        onChange={(e) =>
                          updateStyle(
                            el.id,
                            { background: e.target.value },
                            true,
                          )
                        }
                        onBlur={() =>
                          updateStyle(el.id, {
                            background: el.style.background,
                          })
                        }
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {[25, 50, 75, 90, 100].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => updateStyle(el.id, { value: v })}
                        className="h-8 rounded-[8px] border border-line text-[11px] font-extrabold tabular-nums"
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                </>
              )}

              {el.type === "shape" && (
                <>
                  <Field label="الشكل" full>
                    <div className="grid grid-cols-5 gap-1.5">
                      {SHAPES.map((s) => {
                        const active =
                          (el.style.shapeId || el.style.shape || "rect") ===
                          s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() =>
                              updateStyle(el.id, { shapeId: s.id })
                            }
                            title={s.label}
                            className={cn(
                              "library-hit grid aspect-square place-items-center rounded-[6px] border p-1",
                              active
                                ? "border-navy-2 bg-navy-2/10 text-brand-hover"
                                : "border-line text-muted",
                            )}
                            aria-pressed={active}
                          >
                            <ShapePreview
                              shapeId={s.id}
                              className="size-full max-h-7"
                            />
                          </button>
                        );
                      })}
                    </div>
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="التعبئة">
                      <FillField
                        value={el.style.fill}
                        gradient={el.style.gradient}
                        fallback={theme.primary}
                        label="لون التعبئة"
                        onChange={(v, gradient) =>
                          updateStyle(el.id, { fill: v, gradient }, true)
                        }
                        onCommit={(v, gradient) =>
                          updateStyle(el.id, { fill: v, gradient })
                        }
                        className="h-9 w-full"
                      />
                    </Field>
                    <Field label="لون الإطار">
                      <ColorField
                        value={el.style.borderColor}
                        fallback="#c9a86a"
                        label="لون الإطار"
                        onChange={(v) =>
                          updateStyle(el.id, { borderColor: v }, true)
                        }
                        onCommit={(v) => updateStyle(el.id, { borderColor: v })}
                        className="h-9 w-full"
                      />
                    </Field>
                    <ScrubField
                      label="سماكة الإطار"
                      value={round(Number(el.style.borderWidth ?? 0) || 0)}
                      min={0}
                      step={0.1}
                      onChange={(v) =>
                        updateStyle(el.id, { borderWidth: v }, true)
                      }
                      onCommit={(v) => updateStyle(el.id, { borderWidth: v })}
                    />
                    <StrokeStyleField
                      dash={el.style.borderDash === true}
                      onPick={(dashed) => {
                        if (dashed === (el.style.borderDash === true)) return;
                        updateStyle(el.id, { borderDash: dashed });
                      }}
                    />
                    {rectFamilyShape && (
                      <ScrubField
                        label="استدارة الزوايا مم"
                        value={
                          el.style.radius != null
                            ? round(Number(el.style.radius) || 0)
                            : shapeId === "rounded"
                              ? round(el.w * 0.14)
                              : 0
                        }
                        min={0}
                        step={0.5}
                        onChange={(v) =>
                          updateStyle(el.id, { radius: v }, true)
                        }
                        onCommit={(v) => updateStyle(el.id, { radius: v })}
                      />
                    )}
                    <Field label="بلا إطار">
                      <button
                        type="button"
                        onClick={() => updateStyle(el.id, { borderWidth: 0 })}
                        className="h-9 w-full rounded-[8px] border border-line text-[11px] font-extrabold"
                      >
                        إزالة
                      </button>
                    </Field>
                  </div>

                  <Field label="الشفافية" full>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round((el.opacity ?? 1) * 100)}
                      onChange={(e) =>
                        updateElement(
                          el.id,
                          { opacity: Number(e.target.value) / 100 },
                          true,
                        )
                      }
                      onBlur={() =>
                        updateElement(el.id, { opacity: el.opacity })
                      }
                      className="w-full accent-navy"
                    />
                  </Field>

                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                    قفل النسبة أثناء التحجيم
                    <input
                      type="checkbox"
                      checked={el.style.aspectLock === true}
                      onChange={(e) =>
                        updateStyle(el.id, { aspectLock: e.target.checked })
                      }
                      className="accent-navy"
                    />
                  </label>
                </>
              )}

              {el.type === "icon" && (
                <>
                  <Field label="الأيقونة">
                    <select
                      value={el.icon || "star"}
                      onChange={(e) =>
                        updateElement(el.id, { icon: e.target.value })
                      }
                    >
                      {Object.keys(ICONS).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {/*
                   * The author's own vectors are reachable from the properties
                   * panel too (Phase 7.3). They insert as `svg` elements, which
                   * keeps them vector — an `icon` element renders the built-in
                   * path set only.
                   */}
                  {customIcons.length > 0 && (
                    <Field label="رموز مخصصة (إدراج على الصفحة)" full>
                      <div className="library-grid-icons">
                        {customIcons.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            title={item.name}
                            aria-label={`إدراج ${item.name}`}
                            onClick={() =>
                              addElement("svg", {
                                name: item.name,
                                content: item.svg,
                                w: item.kind === "divider" ? 150 : 24,
                                h: item.kind === "divider" ? 10 : 24,
                              })
                            }
                            className="library-asset-card p-1"
                            dangerouslySetInnerHTML={{ __html: item.svg }}
                          />
                        ))}
                      </div>
                    </Field>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="اللون">
                      <input
                        type="color"
                        value={toColor(el.style.color, theme.accent)}
                        onChange={(e) =>
                          updateStyle(el.id, { color: e.target.value }, true)
                        }
                        onBlur={() =>
                          updateStyle(el.id, { color: el.style.color })
                        }
                      />
                    </Field>
                    <ScrubField
                      label="سماكة الخط"
                      value={round(Number(el.style.stroke ?? 1.8) || 0)}
                      min={0}
                      step={0.1}
                      onChange={(v) => updateStyle(el.id, { stroke: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { stroke: v })}
                    />
                  </div>
                </>
              )}

              {(el.type === "line" || el.type === "divider") && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="اللون">
                    <ColorField
                      value={el.style.color}
                      fallback={theme.accent}
                      label="لون الخط"
                      onChange={(v) => updateStyle(el.id, { color: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { color: v })}
                      className="h-9 w-full"
                    />
                  </Field>
                  <ScrubField
                    label="السماكة مم"
                    value={round(
                      Number(
                        el.style.stroke ?? (el.type === "divider" ? 0.5 : 0.8),
                      ) || 0,
                    )}
                    min={0}
                    step={0.1}
                    onChange={(v) => updateStyle(el.id, { stroke: v }, true)}
                    onCommit={(v) => updateStyle(el.id, { stroke: v })}
                  />
                </div>
              )}

              {el.type === "table" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubField
                      label="أعمدة"
                      value={round(Number(el.style.cols || 3) || 0)}
                      min={1}
                      max={12}
                      step={0.5}
                      onChange={(v) =>
                        resizeTable(el, v, el.style.rows || 4, updateElement)
                      }
                      onCommit={(v) =>
                        resizeTable(el, v, el.style.rows || 4, updateElement)
                      }
                    />
                    <ScrubField
                      label="صفوف"
                      value={round(Number(el.style.rows || 4) || 0)}
                      min={1}
                      max={30}
                      step={0.5}
                      onChange={(v) =>
                        resizeTable(el, el.style.cols || 3, v, updateElement)
                      }
                      onCommit={(v) =>
                        resizeTable(el, el.style.cols || 3, v, updateElement)
                      }
                    />
                  </div>

                  <Field label="إضافة / حذف سريع" full>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        disabled={(el.style.rows || 4) >= 30}
                        onClick={() =>
                          setTableSize(
                            el,
                            { rows: (el.style.rows || 4) + 1 },
                            updateElement,
                          )
                        }
                        className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40"
                      >
                        + صف
                      </button>
                      <button
                        type="button"
                        disabled={(el.style.rows || 4) <= 1}
                        onClick={() =>
                          setTableSize(
                            el,
                            { rows: (el.style.rows || 4) - 1 },
                            updateElement,
                          )
                        }
                        className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40"
                      >
                        − صف
                      </button>
                      <button
                        type="button"
                        disabled={(el.style.cols || 3) >= 12}
                        onClick={() =>
                          setTableSize(
                            el,
                            { cols: (el.style.cols || 3) + 1 },
                            updateElement,
                          )
                        }
                        className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40"
                      >
                        + عمود
                      </button>
                      <button
                        type="button"
                        disabled={(el.style.cols || 3) <= 1}
                        onClick={() =>
                          setTableSize(
                            el,
                            { cols: (el.style.cols || 3) - 1 },
                            updateElement,
                          )
                        }
                        className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40"
                      >
                        − عمود
                      </button>
                    </div>
                  </Field>

                  <Field label="محاذاة الخلايا">
                    <select
                      value={el.style.cellAlign || "right"}
                      onChange={(e) =>
                        updateStyle(el.id, {
                          cellAlign: e.target.value as
                            "right" | "center" | "left",
                        })
                      }
                    >
                      <option value="right">يمين</option>
                      <option value="center">وسط</option>
                      <option value="left">يسار</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="خلفية الرأس">
                      <input
                        type="color"
                        value={toColor(el.style.headerBg, theme.primary)}
                        onChange={(e) =>
                          updateStyle(el.id, { headerBg: e.target.value }, true)
                        }
                        onBlur={() =>
                          updateStyle(el.id, { headerBg: el.style.headerBg })
                        }
                      />
                    </Field>
                    <Field label="لون الرأس">
                      <input
                        type="color"
                        value={toColor(el.style.headerColor, "#ffffff")}
                        onChange={(e) =>
                          updateStyle(
                            el.id,
                            { headerColor: e.target.value },
                            true,
                          )
                        }
                        onBlur={() =>
                          updateStyle(el.id, {
                            headerColor: el.style.headerColor,
                          })
                        }
                      />
                    </Field>
                    <Field label="خلفية الخلايا">
                      <input
                        type="color"
                        value={toColor(el.style.tableBg, "#ffffff")}
                        onChange={(e) =>
                          updateStyle(el.id, { tableBg: e.target.value }, true)
                        }
                        onBlur={() =>
                          updateStyle(el.id, { tableBg: el.style.tableBg })
                        }
                      />
                    </Field>
                    <Field label="لون الحدود">
                      <input
                        type="color"
                        value={toColor(el.style.borderColor, "#bfc7d6")}
                        onChange={(e) =>
                          updateStyle(
                            el.id,
                            { borderColor: e.target.value },
                            true,
                          )
                        }
                        onBlur={() =>
                          updateStyle(el.id, {
                            borderColor: el.style.borderColor,
                          })
                        }
                      />
                    </Field>
                    <Field label="تخطيط الصفوف">
                      <select
                        value={el.style.stripeBg ? "stripe" : "plain"}
                        onChange={(e) =>
                          updateStyle(el.id, {
                            stripeBg:
                              e.target.value === "stripe" ? "#f4f6fa" : "",
                          })
                        }
                      >
                        <option value="plain">بلون واحد</option>
                        <option value="stripe">صفوف متبادلة</option>
                      </select>
                    </Field>
                    <ScrubField
                      label="حجم الخط pt"
                      value={round(Number(el.style.fontSize || 11) || 0)}
                      min={5}
                      max={40}
                      step={0.5}
                      onChange={(v) =>
                        updateStyle(el.id, { fontSize: v }, true)
                      }
                      onCommit={(v) => updateStyle(el.id, { fontSize: v })}
                    />
                  </div>

                  <TableTotals el={el} />

                  <div>
                    <button
                      type="button"
                      onClick={() => setCellEditor((v) => !v)}
                      aria-expanded={cellEditor}
                      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-line text-[12px] font-extrabold"
                    >
                      <Grid2x2 className="size-3.5" />
                      {cellEditor
                        ? "إغلاق محرر الخلايا"
                        : "تحرير الخلايا كشبكة"}
                    </button>
                    {cellEditor && (
                      <div className="mt-2 overflow-auto rounded-[8px] border border-line p-1">
                        <table className="border-collapse">
                          <tbody>
                            {parseTable(
                              el.content,
                              el.style.cols,
                              el.style.rows,
                            ).map((row, ri) => (
                              <tr key={ri}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className="p-0.5">
                                    <input
                                      value={cell}
                                      aria-label={`صف ${ri + 1} عمود ${ci + 1}`}
                                      onChange={(e) =>
                                        setTableCell(
                                          el,
                                          ri,
                                          ci,
                                          e.target.value,
                                          updateElement,
                                        )
                                      }
                                      className="h-7 w-[74px] rounded-[4px] border border-line px-1 text-[11px] bg-surface-2"
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <Field label="بيانات الجدول (سطر لكل صف، | بين الخلايا)" full>
                    <textarea
                      rows={5}
                      value={parseTable(
                        el.content,
                        el.style.cols,
                        el.style.rows,
                      )
                        .map((r) => r.join(" | "))
                        .join("\n")}
                      onChange={(e) => {
                        const data = e.target.value
                          .split("\n")
                          .map((line) => line.split("|").map((c) => c.trim()));
                        updateElement(
                          el.id,
                          { content: JSON.stringify(data) },
                          true,
                        );
                      }}
                      onBlur={() =>
                        updateElement(el.id, { content: el.content })
                      }
                    />
                  </Field>

                </>
              )}

              {["image", "logo"].includes(el.type) && (
                <>
                  {page && <ImageAiTools el={el} pageId={page.id} />}
                  {/* «ملاءمة الصفحة»: one press takes the picture to the page's
                      own size — full bleed, or the largest size that stays
                      inside the sheet with the picture's proportions. */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="editor-mini-btn justify-center"
                      disabled={el.locked || el.resizeLocked}
                      title="يغطي الصفحة كاملة دون تشويه الصورة"
                      onClick={() => {
                        const box = fitBoxToPage(el, pageSize(page), "fill");
                        updateElement(el.id, {
                          ...box,
                          rotation: 0,
                          style: { objectFit: "cover", objectX: 50, objectY: 50 },
                        });
                      }}
                    >
                      ملء الصفحة
                    </button>
                    <button
                      type="button"
                      className="editor-mini-btn justify-center"
                      disabled={el.locked || el.resizeLocked}
                      title="أكبر حجم يبقى داخل الصفحة بنسبة الصورة، في المنتصف"
                      onClick={() => {
                        const box = fitBoxToPage(el, pageSize(page), "fit");
                        updateElement(el.id, {
                          ...box,
                          rotation: 0,
                          style: { objectFit: "contain", objectX: 50, objectY: 50 },
                        });
                      }}
                    >
                      ملاءمة داخل الصفحة
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubField
                      label="تفتيح %"
                      value={round(Number(el.style.brightness ?? 100) || 0)}
                      min={0}
                      max={200}
                      step={1}
                      onChange={(v) => updateStyle(el.id, { brightness: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { brightness: v })}
                    />
                    <ScrubField
                      label="حدة %"
                      value={round(Number(el.style.sharpness ?? 0) || 0)}
                      min={0}
                      max={100}
                      step={1}
                      onChange={(v) => updateStyle(el.id, { sharpness: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { sharpness: v })}
                    />
                  </div>
                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold">
                    قفل النسبة أثناء التحجيم
                    <input
                      type="checkbox"
                      checked={el.style.aspectLock === true}
                      onChange={(e) =>
                        updateStyle(el.id, { aspectLock: e.target.checked })
                      }
                      className="accent-navy"
                    />
                  </label>
                  <Field label="الملاءمة">
                    <select
                      value={el.style.objectFit || "cover"}
                      onChange={(e) =>
                        updateStyle(el.id, {
                          objectFit: e.target.value as
                            "cover" | "contain" | "fill",
                        })
                      }
                    >
                      <option value="cover">
                        Fill · تعبئة الإطار دون تشويه
                      </option>
                      <option value="contain">Fit · احتواء الصورة كاملة</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <ScrubField
                      label="موضع أفقي %"
                      value={round(Number(el.style.objectX ?? 50) || 0)}
                      min={0}
                      max={100}
                      step={0.5}
                      onChange={(v) => updateStyle(el.id, { objectX: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { objectX: v })}
                    />
                    <ScrubField
                      label="موضع رأسي %"
                      value={round(Number(el.style.objectY ?? 50) || 0)}
                      min={0}
                      max={100}
                      step={0.5}
                      onChange={(v) => updateStyle(el.id, { objectY: v }, true)}
                      onCommit={(v) => updateStyle(el.id, { objectY: v })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-[8px] border border-line text-[11px] font-bold"
                      disabled={
                        el.locked ||
                        el.resizeLocked ||
                        el.widthLocked ||
                        el.heightLocked
                      }
                      onClick={() => beginImageCrop(el.id)}
                    >
                      قص الصورة · Crop
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-[8px] border border-line text-[11px] font-bold"
                      disabled={!el.style.crop || el.locked}
                      onClick={() =>
                        updateStyle(el.id, {
                          crop: undefined,
                          objectFit: "contain",
                          objectX: 50,
                          objectY: 50,
                        })
                      }
                    >
                      إزالة القص
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onReplaceImage(el.id)}
                    className="h-9 rounded-[8px] bg-navy text-[12px] font-extrabold text-white"
                  >
                    استبدال الصورة
                  </button>
                </>
              )}

              {el.type === "qr" && (
                <Field label="نص الرمز" full>
                  <textarea
                    rows={3}
                    value={el.content || ""}
                    onChange={(e) =>
                      updateElement(el.id, { content: e.target.value }, true)
                    }
                    onBlur={() => updateElement(el.id, { content: el.content })}
                  />
                </Field>
              )}

              {el.type === "svg" && (
                <>
                  {/*
                   * SVG stays vector in the editor. Its markup is chosen from the
                   * device (Shapes → إضافة SVG من الجهاز) and sanitised on render
                   * — there is intentionally no code editor here. Fill and stroke
                   * are INDEPENDENT overrides applied onto the artwork
                   * (applySvgColors); an unset channel keeps the file's own
                   * colors, so recoloring the fill never rewrites outlines.
                   */}
                  <Field label="لون التعبئة (Fill)" full>
                    <FillField
                      value={el.style.svgFill}
                      gradient={el.style.gradient}
                      fallback={el.style.color || "#172033"}
                      className="h-9 w-full"
                      onChange={(svgFill, gradient) =>
                        updateStyle(el.id, { svgFill, gradient }, true)
                      }
                      onCommit={(svgFill, gradient) =>
                        updateStyle(el.id, { svgFill, gradient })
                      }
                    />
                  </Field>
                  <Field label="لون الإطار (Stroke)" full>
                    <ColorRow
                      value={el.style.svgStroke || ""}
                      fallback="#c9a86a"
                      onChange={(v) =>
                        updateStyle(el.id, { svgStroke: v }, true)
                      }
                      onCommit={(v) => updateStyle(el.id, { svgStroke: v })}
                    />
                  </Field>
                  {/*
                   * An override field: empty means «كما في الملف» (keep the SVG's
                   * own stroke width), which is why it uses the scrubber's
                   * `allowUnset` mode instead of a bare number input.
                   */}
                  <Field label="سماكة الإطار">
                    <div className="grid gap-1">
                      <ScrubInput
                        label="سماكة إطار الرسم — فارغ يعني كما في الملف"
                        value={el.style.svgStrokeWidth}
                        allowUnset
                        min={0}
                        max={24}
                        step={0.1}
                        precision={2}
                        suffix="وحدة"
                        placeholder="كما في الملف"
                        onChange={(v) =>
                          updateStyle(el.id, { svgStrokeWidth: v }, true)
                        }
                        onCommit={() =>
                          updateStyle(el.id, {
                            svgStrokeWidth: el.style.svgStrokeWidth,
                          })
                        }
                        onClear={() =>
                          updateStyle(el.id, { svgStrokeWidth: undefined })
                        }
                      />
                      {el.style.svgStrokeWidth !== undefined && (
                        <button
                          type="button"
                          onClick={() =>
                            updateStyle(el.id, { svgStrokeWidth: undefined })
                          }
                          className="h-7 rounded-[6px] border border-line text-[10px] font-extrabold text-muted hover:text-ink"
                        >
                          كما في الملف (بدون تثبيت)
                        </button>
                      )}
                    </div>
                  </Field>
                  <Field label="الملاءمة">
                    <select
                      value={el.style.objectFit || "contain"}
                      onChange={(e) =>
                        updateStyle(el.id, {
                          objectFit: e.target.value as
                            "cover" | "contain" | "fill",
                        })
                      }
                    >
                      <option value="contain">احتواء كامل (Contain)</option>
                      <option value="cover">تعبئة مع قص (Cover)</option>
                      <option value="fill">تمديد (Fill)</option>
                    </select>
                  </Field>
                  <p className="text-[10px] leading-4 text-muted">
                    اترك اللون فارغًا ليبقى لون الملف الأصلي كما هو. التعبئة
                    والإطار مستقلان تمامًا.
                  </p>
                </>
              )}

              <Field label="الظل">
                <select
                  value={shadowId(el.style.shadow)}
                  onChange={(e) => {
                    if (e.target.value === "custom") {
                      updateStyle(el.id, {
                        shadow: buildShadow(
                          parseShadow(el.style.shadow || SHADOWS[2].value),
                        ),
                      });
                      return;
                    }
                    const found = SHADOWS.find((s) => s.id === e.target.value);
                    updateStyle(el.id, { shadow: found?.value || "" });
                  }}
                >
                  {SHADOWS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                  <option value="custom">مخصص…</option>
                </select>
              </Field>
              {/*
               * Custom shadow — real values written to the same `style.shadow`
               * string the canvas renders and html2canvas exports (box-shadow
               * is supported by the raster export), so preview = output.
               */}
              {shadowId(el.style.shadow) === "custom" &&
                (() => {
                  const sh = parseShadow(el.style.shadow);
                  const set = (patch: Partial<typeof sh>, live = true) =>
                    updateStyle(
                      el.id,
                      { shadow: buildShadow({ ...sh, ...patch }) },
                      live,
                    );
                  return (
                    <div className="grid grid-cols-2 gap-2 rounded-[8px] border border-line p-2">
                      <Field label={`الإزاحة الأفقية X (${sh.x} مم)`}>
                        <input
                          type="range"
                          min={-20}
                          max={20}
                          step={0.5}
                          value={sh.x}
                          onChange={(e) => set({ x: Number(e.target.value) })}
                          onPointerUp={() => set({}, false)}
                        />
                      </Field>
                      <Field label={`الإزاحة الرأسية Y (${sh.y} مم)`}>
                        <input
                          type="range"
                          min={-20}
                          max={20}
                          step={0.5}
                          value={sh.y}
                          onChange={(e) => set({ y: Number(e.target.value) })}
                          onPointerUp={() => set({}, false)}
                        />
                      </Field>
                      <Field label={`التمويه Blur (${sh.blur} مم)`}>
                        <input
                          type="range"
                          min={0}
                          max={30}
                          step={0.5}
                          value={sh.blur}
                          onChange={(e) =>
                            set({ blur: Number(e.target.value) })
                          }
                          onPointerUp={() => set({}, false)}
                        />
                      </Field>
                      <Field
                        label={`الشفافية (${Math.round(sh.alpha * 100)}%)`}
                      >
                        <input
                          type="range"
                          min={5}
                          max={100}
                          step={1}
                          value={Math.round(sh.alpha * 100)}
                          onChange={(e) =>
                            set({ alpha: Number(e.target.value) / 100 })
                          }
                          onPointerUp={() => set({}, false)}
                        />
                      </Field>
                      <Field label="لون الظل" full>
                        <input
                          type="color"
                          value={sh.color}
                          onChange={(e) =>
                            set({ color: e.target.value }, false)
                          }
                        />
                      </Field>
                    </div>
                  );
                })()}
            </AccordionSection>

            {/*
             * Step 8 — طبقة التلاشي. Only the image family can carry one, so
             * the whole section is hidden elsewhere; inside, the four gradient
             * presets are buttons (not a dropdown) because they are the fast
             * path, and the colour/opacity/blend controls refine from there.
             */}
            {FADE_TYPES.has(el.type) && (
              <AccordionSection
                title="طبقة التلاشي (Fade Overlay)"
                id="fade"
                open={accordions.isOpen("fade", fade !== null)}
                onToggle={() => accordions.toggle("fade")}
              >
                {fade ? (
                  <>
                    <SubGroup title="اتجاه التدرج">
                      <div className="grid grid-cols-2 gap-2">
                        {FADE_DIRECTIONS.map((direction) => (
                          <button
                            key={direction}
                            type="button"
                            aria-pressed={fade.direction === direction}
                            onClick={() => updateFade({ direction })}
                            className={cn(
                              "h-8 rounded-[8px] border border-line text-[10px] font-bold",
                              fade.direction === direction &&
                                "border-[var(--primary-accent)] bg-[var(--library-active-bg)] text-[var(--primary-accent)]",
                            )}
                          >
                            {fadeDirectionLabel(direction)}
                          </button>
                        ))}
                      </div>
                    </SubGroup>

                    <SubGroup title="الألوان">
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="من">
                          <input
                            type="color"
                            value={toColor(fade.from, "#0f172a")}
                            onChange={(e) =>
                              updateFade({ from: e.target.value })
                            }
                          />
                        </Field>
                        <Field label="إلى">
                          <input
                            type="color"
                            value={toColor(fade.to, "#ffffff")}
                            onChange={(e) => updateFade({ to: e.target.value })}
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        className="editor-mini-btn w-full justify-center"
                        onClick={() => updateFade({ to: "transparent" })}
                      >
                        اجعل النهاية شفافة (تلاشٍ ناعم)
                      </button>
                    </SubGroup>

                    <SubGroup title="الدمج">
                      <ScrubField
                        label="الشفافية"
                        value={round(fade.opacity * 100)}
                        min={0}
                        max={100}
                        step={1}
                        precision={0}
                        suffix="%"
                        onChange={(v) => updateFade({ opacity: v / 100 }, true)}
                        onCommit={(v) => updateFade({ opacity: v / 100 })}
                      />
                      <Field label="وضع الدمج">
                        <select
                          value={fade.blend}
                          onChange={(e) =>
                            updateFade({ blend: e.target.value as FadeBlend })
                          }
                        >
                          {FADE_BLENDS.map((blend) => (
                            <option key={blend} value={blend}>
                              {BLEND_LABEL[blend] ?? blend}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </SubGroup>

                    <button
                      type="button"
                      className="editor-mini-btn w-full justify-center text-error"
                      onClick={toggleFadeOverlay}
                    >
                      <Trash2 className="size-3.5" />
                      إزالة طبقة التلاشي
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="editor-mini-btn w-full justify-center"
                    onClick={toggleFadeOverlay}
                  >
                    <Contrast className="size-3.5" />
                    إضافة طبقة تلاشي (Fade Overlay)
                  </button>
                )}
              </AccordionSection>
            )}


            <div className="grid grid-cols-2 gap-1.5">
              <Action
                onClick={toggleLock}
                icon={el.locked ? Unlock : Lock}
                label={el.locked ? "فتح القفل" : "قفل"}
              />
              <Action
                onClick={toggleResizeLock}
                icon={Scaling}
                label={el.resizeLocked ? "فتح قفل التحجيم" : "قفل التحجيم"}
              />
              <Action
                onClick={toggleWidthLock}
                icon={Scaling}
                label={el.widthLocked ? "فك قفل العرض" : "قفل العرض"}
              />
              <Action
                onClick={toggleHeightLock}
                icon={Scaling}
                label={el.heightLocked ? "فك قفل الارتفاع" : "قفل الارتفاع"}
              />
              <Action
                onClick={toggleAspectLock}
                icon={Scaling}
                label={el.style?.aspectLock ? "فك قفل النسبة" : "قفل النسبة"}
              />
              <Action
                onClick={toggleHidden}
                icon={el.hidden ? Eye : EyeOff}
                label={el.hidden ? "إظهار" : "إخفاء"}
              />
            </div>
            <Action
              onClick={() => void saveToLibrary(el)}
              icon={ImagePlus}
              label="حفظ في المكتبة للرجوع إليه"
            />
            <Action
              onClick={deleteSelected}
              icon={Trash2}
              label="حذف العنصر"
              danger
            />
          </div>
        )}

        {/*
         * «أدوات التقرير» moved out of this panel: it is its own floating
         * window (ReportToolsWindow in EditorApp), so it can sit beside the
         * properties and layers windows instead of hiding behind an accordion.
         */}
      </div>
    </aside>
  );
}

/**
 * الطبقات — the layers list as a STANDALONE window.
 *
 * Split out of the old tabbed right panel: it subscribes to the store on its
 * own, so it can be open at the same time as الخصائص and أدوات التقرير and
 * none of the three hides the others behind a tab.
 */
export function LayersPanel() {
  /*
   * The panel is mounted only while its tab is actually showing. Grouped
   * windows keep `layersOpen` false (the host flag is `rightOpen`), so gating
   * the page on `layersOpen` rendered an empty list for every real document.
   * Focus mode unmounts the window visually but this component can stay in
   * the tree — skip the subscription then so a hidden panel does not repaint.
   */
  const focusMode = useEditor((s) => s.focusMode);
  const page = useEditor((s) =>
    focusMode ? undefined : s.pages.find((p) => p.id === s.activePageId),
  );
  const activePageId = useEditor((s) => (focusMode ? "" : s.activePageId));
  const selectedId = useEditor((s) => (focusMode ? null : s.selectedId));
  const setActivePage = useEditor((s) => s.setActivePage);
  const updateElement = useEditor((s) => s.updateElement);
  const reorderLayers = useEditor((s) => s.reorderLayers);
  const selectMany = useEditor((s) => s.selectMany);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);

  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    side: "before" | "after";
  } | null>(null);
  const [layerQuery, setLayerQuery] = useState("");
  const layerAnchorRef = useRef<string | null>(null);

  useEffect(() => {
    setLayerQuery("");
    setDrop(null);
    setDraggedLayerId(null);
  }, [activePageId]);

  const el =
    page && selectedId ? findElement(page.elements, selectedId)?.el : undefined;
  const layers = useMemo(
    () => [...(page?.elements || [])].sort((a, b) => b.z - a.z),
    [page],
  );
  const visibleLayers = useMemo(
    () =>
      layerQuery.trim()
        ? layers.filter((layer) =>
            `${layer.name} ${TYPE_NAME[layer.type]}`
              .toLocaleLowerCase("ar")
              .includes(layerQuery.trim().toLocaleLowerCase("ar")),
          )
        : layers,
    [layers, layerQuery],
  );

  /** Plain click = select (new anchor) · Shift = range from the anchor · Ctrl/⌘ = toggle. */
  const clickLayerRow = (id: string, shift: boolean, meta: boolean) => {
    if (shift && layerAnchorRef.current && layerAnchorRef.current !== id) {
      const from = layers.findIndex((l) => l.id === layerAnchorRef.current);
      const to = layers.findIndex((l) => l.id === id);
      if (from !== -1 && to !== -1) {
        const [a, b] = from < to ? [from, to] : [to, from];
        selectMany(layers.slice(a, b + 1).map((l) => l.id));
        return;
      }
    }
    if (meta) toggleSelect(id);
    else select(id);
    layerAnchorRef.current = id;
  };

  /**
   * Layer drag-reorder: the drop target AND the insertion side both come from
   * the pointer's position over the row's own rectangle: the upper half inserts
   * above, the lower half below. Purely vertical, so it reads the same in RTL.
   */
  const startLayerDrag = (id: string) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggedLayerId(id);
    setDrop({ id, side: "after" });
    const resolve = (
      pointer: PointerEvent,
    ): { id: string; side: "before" | "after" } | null => {
      const node = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>("[data-layer-id]");
      const target = node?.dataset.layerId;
      if (!node || !target) return null;
      const rect = node.getBoundingClientRect();
      return {
        id: target,
        side:
          pointer.clientY < rect.top + rect.height / 2 ? "before" : "after",
      };
    };
    const move = (pointer: PointerEvent) => {
      const next = resolve(pointer);
      if (next) setDrop(next);
    };
    const finish = (pointer: PointerEvent) => {
      const target = resolve(pointer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDraggedLayerId(null);
      setDrop(null);
      if (target && target.id !== id) reorderLayers(id, target.id, target.side);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <aside className="editor-layers flex h-full min-h-0 flex-col bg-surface">
      {/*
       * Layers control row (Photoshop anatomy): a dropdown and Opacity side by
       * side, wrapping onto two lines when the window is narrow. The page
       * picker and the opacity field drive the same store actions as the page
       * rail and «الأبعاد والتحاذي».
       */}
      <div
        className="editor-panel-controls"
        role="group"
        aria-label="تحكم الطبقات"
      >
        <PageSelect activePageId={activePageId} onChange={setActivePage} />
        <div className="editor-panel-control is-opacity">
          <ScrubField
            label="الشفافية"
            value={el ? round((el.opacity ?? 1) * 100) : 100}
            min={0}
            max={100}
            step={1}
            precision={0}
            suffix="%"
            disabled={!el}
            onChange={(v) => {
              if (el) updateElement(el.id, { opacity: v / 100 }, true);
            }}
            onCommit={(v) => {
              if (el) updateElement(el.id, { opacity: v / 100 });
            }}
          />
        </div>
      </div>
      <div className="editor-pane-scroll editor-panel-body no-bottom-pad p-3">
        <div className="grid gap-2">
          {/* The list grows with the panel; the panel body is its one scroller (no nested scrollbar). */}
          <div className="editor-layer-list min-h-[120px] overflow-x-hidden rounded-[8px] border border-line/50 p-1.5">
            <label className="relative mb-1.5 block">
              <Search className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                value={layerQuery}
                onChange={(event) => setLayerQuery(event.target.value)}
                placeholder="ابحث في الطبقات…"
                aria-label="البحث في الطبقات"
                className="h-9 w-full rounded-md border border-line bg-surface-2 pe-8 ps-2 text-[11px] font-bold outline-none focus:border-navy"
              />
            </label>
            <div className="grid gap-1.5">
              {layers.length === 0 && (
                <EmptyNote>لا توجد عناصر في هذه الصفحة بعد.</EmptyNote>
              )}
              {layers.length > 0 && visibleLayers.length === 0 && (
                <EmptyNote>لا توجد طبقة تطابق «{layerQuery}».</EmptyNote>
              )}
              {visibleLayers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  dragging={draggedLayerId === layer.id}
                  dropBefore={
                    drop?.id === layer.id &&
                    drop.side === "before" &&
                    draggedLayerId !== layer.id
                  }
                  dropAfter={
                    drop?.id === layer.id &&
                    drop.side === "after" &&
                    draggedLayerId !== layer.id
                  }
                  onDragStart={startLayerDrag(layer.id)}
                  onRowClick={(event) =>
                    clickLayerRow(
                      layer.id,
                      event.shiftKey,
                      event.ctrlKey || event.metaKey,
                    )
                  }
                />
              ))}
            </div>
          </div>
          <p className="px-1 text-[10px] leading-4 text-muted">
            الترتيب يحدد التكديس — اسحب الطبقة لتغيير موضعها.
          </p>
        </div>
      </div>
    </aside>
  );
}

/** Types that render an editable text body (table is edited structurally). */
const TEXT_MARKUP_TYPES = new Set(["text", "box", "stat", "stamp", "progress"]);

const LABELS: Record<"x" | "y" | "w" | "h", string> = {
  x: "الموضع الأفقي (مم)",
  y: "الموضع الرأسي (مم)",
  w: "العرض (مم)",
  h: "الارتفاع (مم)",
};

function resizeTable(
  el: CanvasEl,
  cols: number,
  rows: number,
  updateElement: (id: string, patch: Partial<CanvasEl>, live?: boolean) => void,
) {
  const safeCols = Math.max(1, Math.min(12, cols || 1));
  const safeRows = Math.max(1, Math.min(30, rows || 1));
  const data = parseTable(el.content, el.style.cols, el.style.rows);
  updateElement(el.id, {
    content: JSON.stringify(resizeMatrix(data, safeCols, safeRows)),
    style: { ...el.style, cols: safeCols, rows: safeRows },
  });
}

/** Shrink or grow the grid, keeping the cells that already have content. */
function setTableSize(
  el: CanvasEl,
  next: { cols?: number; rows?: number },
  updateElement: (id: string, patch: Partial<CanvasEl>, live?: boolean) => void,
) {
  resizeTable(
    el,
    next.cols ?? el.style.cols ?? 3,
    next.rows ?? el.style.rows ?? 4,
    updateElement,
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Report how the element's text currently fits its box.
 *
 * Uses the same `prepareText` the canvas and exporter use, so the number shown
 * here is the size actually rendered rather than a separate estimate.
 */
function TextFitStatus({ el }: { el: CanvasEl }) {
  const prepared = prepareText(el);
  if (!prepared.text.trim()) return null;
  const base = Number(el.style.fontSize) || 14;
  if (prepared.overflow) {
    return (
      <p className="rounded-[6px] border border-gold/50 bg-gold/10 px-2 py-1.5 text-[10px] leading-4 font-bold text-brand">
        تم تصغير الخط تلقائياً من {round2(base)}pt إلى{" "}
        {round2(prepared.fontSize)}pt ليتّسع النص.
      </p>
    );
  }
  const grew = prepared.fontSize > base + 0.05;
  return (
    <p className="rounded-[6px] border border-line px-2 py-1.5 text-[10px] leading-4 text-muted">
      {grew
        ? `النص يتّسع — تم تكبيره إلى ${round2(prepared.fontSize)}pt.`
        : "النص يتّسع داخل الإطار بالحجم الحالي."}
    </p>
  );
}

/** Read-only column sums, so the author can verify figures before typing them. */
function TableTotals({ el }: { el: CanvasEl }) {
  const totals = columnTotals(
    parseTable(el.content, el.style.cols, el.style.rows),
  ).filter((t) => t.numeric);
  if (!totals.length) return null;
  return (
    <div className="rounded-[8px] border border-line p-2">
      <h4 className="mb-1.5 text-[10px] font-extrabold text-muted">
        مجموع الأعمدة الرقمية
      </h4>
      <ul className="grid gap-1">
        {totals.map((t) => (
          <li
            key={t.col}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="text-muted">العمود {t.col + 1}</span>
            <span className="font-extrabold tabular-nums">
              {round2(t.total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function setTableCell(
  el: CanvasEl,
  row: number,
  col: number,
  value: string,
  updateElement: (id: string, patch: Partial<CanvasEl>, live?: boolean) => void,
) {
  const data = parseTable(el.content, el.style.cols, el.style.rows);
  data[row][col] = value;
  updateElement(el.id, { content: JSON.stringify(data) }, true);
}

function shadowId(value: string | undefined) {
  if (!value) return "none";
  const hit = SHADOWS.find((s) => s.value && s.value === value);
  return hit?.id || "custom";
}

/**
 * One row in the layers list.
 *
 * Groups expand to show their members, which is the only place a nested element
 * can be picked without stepping into it on the canvas. Renaming happens inline
 * so the author stays in the list while organising a busy page.
 */
/**
 * The layers tab's page dropdown. Kept in its own component so only IT
 * re-renders when the page LIST changes (renames, reorders) — the inspector
 * around it subscribes to nothing but the active page object.
 */
const EMPTY_PAGES: { id: string; name: string }[] = [];

function PageSelect({
  activePageId,
  onChange,
}: {
  activePageId: string;
  onChange: (id: string) => void;
}) {
  const pages = useEditor((s) => (s.focusMode ? EMPTY_PAGES : s.pages));
  return (
    <label className="editor-panel-control">
      <span>الصفحة</span>
      <select
        value={activePageId}
        onChange={(e) => onChange(e.target.value)}
        aria-label="صفحة الطبقات"
      >
        {pages.map((p, index) => (
          <option key={p.id} value={p.id}>
            {index + 1}. {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * One layer row (recursively renders a folder's children). Memoized: the
 * layer's element object keeps its identity unless THAT element changed, so
 * an edit or drag-commit elsewhere on the page does not re-run the whole
 * tree — which used to be the single biggest layers-panel cost.
 */
const LayerRow = memo(function LayerRow({
  layer,
  depth = 0,
  dragging = false,
  dropBefore = false,
  dropAfter = false,
  hiddenByAncestor = false,
  onDragStart,
  onRowClick,
}: {
  layer: CanvasEl;
  depth?: number;
  dragging?: boolean;
  /** Drop indicator position, resolved from the pointer's half of the row. */
  dropBefore?: boolean;
  dropAfter?: boolean;
  /** True when an ancestor folder is hidden — the child is hidden with it. */
  hiddenByAncestor?: boolean;
  onDragStart?: (event: React.PointerEvent) => void;
  /** Top-level rows only: Shift selects the whole range from the anchor row. */
  onRowClick?: (event: React.MouseEvent) => void;
}) {
  const selected = useEditor((s) => s.selectedIds.includes(layer.id));
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const setElementFlag = useEditor((s) => s.setElementFlag);
  const renameElement = useEditor((s) => s.renameElement);
  const enterGroup = useEditor((s) => s.enterGroup);
  const moveLayer = useEditor((s) => s.moveLayer);
  const openContextMenu = useEditor((s) => s.openContextMenu);
  const [renaming, setRenaming] = useState(false);
  /*
   * Folder expansion (Phase 5.2). Folders start open — a collapsed folder hides
   * work, which is the opposite of what the tree is for — and each row keeps
   * its own state so opening one folder never rearranges another.
   */
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState(layer.name || TYPE_NAME[layer.type]);
  const children = layer.children?.slice().sort((a, b) => b.z - a.z) ?? [];
  const isFolder = layer.type === "group" || children.length > 0;

  const commitName = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== layer.name) renameElement(layer.id, next);
    else setDraft(layer.name || TYPE_NAME[layer.type]);
  };

  return (
    <div className="grid gap-1">
      <div
        data-layer-id={layer.id}
        onContextMenu={(event) => {
          // Right-click acts on THIS row, which may not be the selection yet.
          event.preventDefault();
          event.stopPropagation();
          if (!selected) select(layer.id);
          openContextMenu({
            x: event.clientX,
            y: event.clientY,
            targetId: layer.id,
            source: "layers",
          });
        }}
        className={cn(
          "layer-row relative flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5",
          selected ? "is-selected" : "hover:bg-line-2/70",
          dragging && "is-dragging",
          dropBefore && "is-drop-before",
          dropAfter && "is-drop-after",
          hiddenByAncestor && "is-nested-hidden",
        )}
        style={depth ? { marginInlineStart: `${depth * 10}px` } : undefined}
      >
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setDraft(layer.name || TYPE_NAME[layer.type]);
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded-[6px] border border-line px-1.5 py-0.5 text-[12px] font-bold"
          />
        ) : (
          <>
            {/* Folder chevron: the tree view's one expand/collapse control. */}
            {isFolder ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-label={
                  expanded
                    ? `طي ${layer.name || TYPE_NAME[layer.type]}`
                    : `توسيع ${layer.name || TYPE_NAME[layer.type]}`
                }
                title={expanded ? "طي المجموعة" : "توسيع المجموعة"}
                className="grid size-7 shrink-0 place-items-center rounded-[6px] text-muted transition hover:bg-line-2"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    !expanded && "-rotate-90",
                  )}
                />
              </button>
            ) : (
              <span className="layer-row-spacer size-7 shrink-0" aria-hidden />
            )}
            {depth === 0 && onDragStart && (
              <button
                type="button"
                onPointerDown={onDragStart}
                title="اسحب لإعادة ترتيب الطبقة"
                aria-label={`إعادة ترتيب ${layer.name || TYPE_NAME[layer.type]}`}
                className="drag-handle grid size-7 shrink-0 place-items-center rounded-[6px] border border-line text-muted"
              >
                <GripVertical className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) =>
                onRowClick
                  ? onRowClick(e)
                  : e.shiftKey
                    ? toggleSelect(layer.id)
                    : select(layer.id)
              }
              onDoubleClick={() => {
                // Double-clicking a group row steps into it, mirroring the canvas.
                if (layer.type === "group") enterGroup(layer.id);
                else setRenaming(true);
              }}
              className="layer-row-name flex min-w-0 flex-1 items-center justify-between text-right text-[12px]"
              title="نقرة لتحديد · Shift+نقرة لتحديد كل ما بين صفّين · ⌘/Ctrl+نقرة للإضافة · نقرة مزدوجة لإعادة التسمية · نقرة يمنى للقائمة السياقية"
            >
              <span className="truncate font-bold">
                {layer.type === "group" && (
                  <span className="me-1 text-gold-2">▸</span>
                )}
                {layer.name || TYPE_NAME[layer.type]}
              </span>
              <span className="flex items-center gap-1 pr-1 text-muted">
                {layer.locked && <Lock className="size-3.5" />}
                {layer.resizeLocked && (
                  <Scaling
                    className="size-3.5 text-warning"
                    aria-label="التحجيم مقفل"
                  />
                )}
                {layer.hidden && <EyeOff className="size-3.5" />}
                {layer.linkId && <Link className="size-3.5 text-gold-2" />}
                {/* The mask relationship is visible in the tree, not only on canvas. */}
                {layer.clippedBy && (
                  <Scissors
                    className="size-3.5 text-gold-2"
                    aria-label="مقصوص بقناع"
                  />
                )}
                <span className="text-[10px] tabular-nums">{layer.z}</span>
              </span>
            </button>
          </>
        )}
        {/* Move up/down: wired to `moveLayer`, which swaps real array order and
            renumbers z — the layers list, canvas stacking and export order all
            follow the same z rule, so one press moves the layer everywhere. */}
        {selected && (
          <>
        <button
          type="button"
          title="تقديم طبقة"
          aria-label={`تقديم ${layer.name || TYPE_NAME[layer.type]}`}
          onClick={() => moveLayer(layer.id, 1)}
          className="layer-row-action is-first grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          title="تأخير طبقة"
          aria-label={`تأخير ${layer.name || TYPE_NAME[layer.type]}`}
          onClick={() => moveLayer(layer.id, -1)}
          className="layer-row-action grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line"
        >
          <ArrowDown className="size-3.5" />
        </button>
        <button
          type="button"
          title={layer.hidden ? "إظهار" : "إخفاء"}
          aria-label={
            layer.hidden
              ? `إظهار ${layer.name || TYPE_NAME[layer.type]}`
              : `إخفاء ${layer.name || TYPE_NAME[layer.type]}`
          }
          onClick={() => setElementFlag(layer.id, "hidden")}
          className="layer-row-action layer-eye-toggle shrink-0 touch-manipulation border border-line"
        >
          {layer.hidden || hiddenByAncestor ? (
            <Eye className="size-3.5" />
          ) : (
            <EyeOff className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          title={layer.locked ? "فتح القفل" : "قفل"}
          aria-label={
            layer.locked
              ? `فتح قفل ${layer.name || TYPE_NAME[layer.type]}`
              : `قفل ${layer.name || TYPE_NAME[layer.type]}`
          }
          onClick={() => setElementFlag(layer.id, "locked")}
          className="layer-row-action grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line"
        >
          {layer.locked ? (
            <Unlock className="size-3.5" />
          ) : (
            <Lock className="size-3.5" />
          )}
        </button>
          </>
        )}
      </div>
      {isFolder && expanded && children.length > 0 && (
        <div className="layer-children">
          {children.map((child) => (
            <LayerRow
              key={child.id}
              layer={child}
              depth={depth + 1}
              hiddenByAncestor={hiddenByAncestor || Boolean(layer.hidden)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[8px] border border-dashed border-line p-2.5 text-[11px] leading-5 text-muted">
      {children}
    </p>
  );
}

/**
 * A range input whose drag produces exactly one undo step.
 *
 * Dragging fires `input` continuously; writing each tick straight to the store
 * would push ~40 history entries per gesture and bury the user's real edits.
 * The live value goes to the canvas without history, and the gesture's end
 * value is applied once — with history — on release.
 */
function CommitRange({
  min,
  max,
  step,
  value,
  ariaLabel,
  onLive,
  onCommit,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  ariaLabel: string;
  onLive: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const pending = useRef<number | null>(null);

  const flush = () => {
    if (pending.current === null) return;
    onCommit(pending.current);
    pending.current = null;
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => {
        const v = Number(e.target.value);
        pending.current = v;
        onLive(v);
      }}
      onPointerUp={flush}
      onPointerCancel={flush}
      // Keyboard arrow keys have no pointer gesture, so commit on each press.
      onKeyUp={(e) => {
        pending.current = Number((e.target as HTMLInputElement).value);
        flush();
      }}
      onBlur={flush}
    />
  );
}

/**
 * نوع الحد — solid / dashed, the shared stroke-style toggle for boxes and
 * shapes. One component so both sections read and write `style.borderDash`
 * exactly the same way (canvas + exporter honour it identically).
 */
function StrokeStyleField({
  dash,
  onPick,
}: {
  dash: boolean;
  onPick: (dashed: boolean) => void;
}) {
  return (
    <Field label="نوع الحد">
      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ["solid", "متصل"],
            ["dashed", "متقطع"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            aria-pressed={(dash ? "dashed" : "solid") === kind}
            onClick={() => onPick(kind === "dashed")}
            className={cn(
              "h-9 rounded-[8px] border text-[11px] font-extrabold",
              (dash ? "dashed" : "solid") === kind
                ? "border-navy-2 bg-navy-2/5 text-brand-hover"
                : "border-line",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </Field>
  );
}

/**
 * صف اختيار اللون: منتقي لون + الألوان المحفوظة (من هوية المشروع) + مسح.
 *
 * Reused by every color field (نص، تعبئة، إطار، SVG fill/stroke) so "saved
 * colors" is ONE row component, not a parallel palette system. Empty value =
 * follow the artwork/theme (القناة بلا تجاوز) — the ✕ clears the override.
 */
function ColorRow({
  value,
  fallback,
  onChange,
  onCommit,
}: {
  value: string;
  fallback: string;
  onChange: (v: string) => void;
  /** Receives the value being committed — never a stale render closure. */
  onCommit: (v: string) => void;
}) {
  const themeId = useEditor((s) => s.theme);
  const theme = THEMES[themeId];
  const [recents, setRecents] = useState<string[]>(() => getRecentColors());
  useEffect(
    () => subscribeRecentColors(() => setRecents(getRecentColors())),
    [],
  );
  // One session = one entry + one recents push, same contract as ColorField.
  // `v` lets immediate actions (swatch chips) commit the NEW colour while
  // blurs commit what the element already holds — passing it through means
  // the commit can never re-apply a pre-click (stale) value.
  const commit = (v: string = value) => {
    recordRecentColor(v);
    onCommit(v);
  };
  const saved = [
    theme.primary,
    theme.accent,
    theme.ink,
    "#ffffff",
    "#111722",
    "#e11d48",
    "#2563eb",
  ];
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={toColor(value, fallback)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => commit()}
          className="h-9 w-12 shrink-0"
        />
        <input
          type="text"
          dir="ltr"
          value={value || ""}
          placeholder="افتراضي"
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{0,8}$/.test(v)) onChange(v);
          }}
          onBlur={() => commit()}
          className="h-9 min-w-0 flex-1 rounded-[8px] border border-line px-2 text-[12px] font-semibold text-ink bg-surface-2"
        />
        <button
          type="button"
          title="إرجاع اللون الافتراضي"
          aria-label="إرجاع اللون الافتراضي"
          onClick={() => {
            onChange("");
            commit("");
          }}
          className="grid size-9 shrink-0 place-items-center rounded-[8px] border border-line text-muted hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {saved.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`اللون المحفوظ ${c}`}
            onClick={() => {
              onChange(c);
              commit(c);
            }}
            style={{ background: c }}
            className={cn(
              "size-5 rounded-[5px] border",
              value.toLowerCase() === c.toLowerCase()
                ? "border-navy ring-2 ring-navy/40"
                : "border-line",
            )}
          />
        ))}
      </div>
      {recents.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="الألوان الأخيرة">
          {recents.map((c) => (
            <button
              key={c}
              type="button"
              title={`لون أخير ${c}`}
              aria-label={`لون أخير ${c}`}
              onClick={() => {
                onChange(c);
                commit(c);
              }}
              style={{ background: c }}
              className={cn(
                "size-5 rounded-[5px] border",
                value.toLowerCase() === c.toLowerCase()
                  ? "border-navy ring-2 ring-navy/40"
                  : "border-line",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label
      className={cn(
        "editor-property-field grid gap-1 text-[11px] font-extrabold text-muted",
        full && "col-span-2",
      )}
    >
      {label}
      <div className="field-control [&_input]:h-9 [&_input]:w-full [&_input]:rounded-[8px] [&_input]:border [&_input]:border-line [&_input]:bg-surface [&_input]:px-2.5 [&_input]:text-[13px] [&_input]:font-semibold [&_input]:text-ink [&_input[type=color]]:p-1 [&_input[type=range]]:h-9 [&_select]:h-9 [&_select]:w-full [&_select]:rounded-[8px] [&_select]:border [&_select]:border-line [&_select]:bg-surface [&_select]:px-2.5 [&_select]:text-[13px] [&_textarea]:min-h-[80px] [&_textarea]:w-full [&_textarea]:rounded-[8px] [&_textarea]:border [&_textarea]:border-line [&_textarea]:bg-surface [&_textarea]:p-2.5 [&_textarea]:text-[13px] [&_textarea]:leading-6">
        {children}
      </div>
    </label>
  );
}

function Action({
  onClick,
  icon: Icon,
  label,
  danger,
}: {
  onClick: () => void;
  icon: typeof Copy;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1 rounded-[8px] border text-[11px] font-extrabold",
        danger ? "border-danger/30 bg-danger/10 text-error" : "border-line",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function toColor(v: string | undefined, fallback: string) {
  if (!v || v === "transparent" || v.startsWith("rgba") || v.startsWith("hsl"))
    return fallback;
  return v;
}

export { X as UnusedIcon } from "lucide-react";
