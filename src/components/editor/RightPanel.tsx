import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Baseline,
  Copy,
  Eye,
  EyeOff,
  Grid2x2,
  GripVertical,
  ImagePlus,
  Link,
  Lock,
  Trash2,
  Unlock,
} from "lucide-react";
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
import { SHAPES } from "@/lib/editor/shapes";
import { columnTotals, resizeMatrix, toCsv } from "@/lib/editor/tables";
import { prepareText } from "@/lib/editor/text-render";
import { useEditor, type RightTab } from "@/lib/editor/store";
import { cn, round } from "@/lib/utils";
import { toast } from "sonner";
import { ShapePreview } from "./ShapePreview";

const TEXT_TYPES = ["text", "box", "stat", "stamp", "table", "progress"];

export function RightPanel({ onReplaceImage }: { onReplaceImage: (id: string) => void }) {
  const tab = useEditor((s) => s.rightTab);
  const setRightTab = useEditor((s) => s.setRightTab);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedId = useEditor((s) => s.selectedId);
  const updateElement = useEditor((s) => s.updateElement);
  const updateStyle = useEditor((s) => s.updateStyle);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const copySelected = useEditor((s) => s.copySelected);
  const pasteClipboard = useEditor((s) => s.pasteClipboard);
  const clipboard = useEditor((s) => s.clipboard);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const bring = useEditor((s) => s.bring);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const alignPage = useEditor((s) => s.alignPage);
  const fontChoices = useEditor((s) => s.fontChoices);
  const probeFonts = useEditor((s) => s.probeFonts);
  const setLeftTab = useEditor((s) => s.setLeftTab);
  const theme = THEMES[useEditor((s) => s.theme)];
  const [cellEditor, setCellEditor] = useState(false);
  const [savingAsset, setSavingAsset] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dropLayerId, setDropLayerId] = useState<string | null>(null);
  const reorderLayers = useEditor((s) => s.reorderLayers);

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
      const src = await captureElement(el.id, 3);
      if (!src) {
        toast.error("تعذر التقاط العنصر", {
          description: "حاول مرة أخرى، أو أعد تحميل الصفحة إذا تكرر الخطأ.",
        });
        return;
      }
      const saved = await useEditor.getState().addAsset({
        name: el.name || TYPE_NAME[el.type],
        src,
        w: el.w,
        h: el.h,
      });
      if (saved) toast.success(`تم حفظ "${saved.name}" في المكتبة`, {
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

  const page = pages.find((p) => p.id === activePageId);
  // Resolves through groups, so a member picked inside a group shows its own
  // properties rather than nothing.
  const el = page && selectedId ? findElement(page.elements, selectedId)?.el : undefined;
  const layers = [...(page?.elements || [])].sort((a, b) => b.z - a.z);
  const selectedCount = useEditor((s) => s.selectedIds.length);

  const startLayerDrag = (id: string) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggedLayerId(id);
    setDropLayerId(id);
    const layerAtPointer = (pointer: PointerEvent) =>
      document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId || null;
    const move = (pointer: PointerEvent) => setDropLayerId(layerAtPointer(pointer));
    const finish = (pointer: PointerEvent) => {
      const target = layerAtPointer(pointer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setDraggedLayerId(null);
      setDropLayerId(null);
      if (target && target !== id) reorderLayers(id, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    // A cancelled touch (notification, edge-swipe) must not leave the list
    // stuck in a half-dragged state.
    window.addEventListener("pointercancel", finish);
  };

  return (
    <aside className="editor-properties flex h-full min-h-0 flex-col border-r border-line bg-white dark:border-white/10 dark:bg-[#161c26]">
      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-line p-2 dark:border-white/10">
        {(
          [
            ["properties", "خصائص"],
            ["layers", "طبقات"],
          ] as [RightTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setRightTab(id)}
            className={cn(
              "h-9 rounded-[8px] text-[12px] font-extrabold",
              tab === id ? "bg-navy text-white" : "text-muted hover:bg-line-2 dark:text-white/70 dark:hover:bg-white/5",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="editor-pane-scroll min-h-0 flex-1 overflow-auto p-3">
        {tab === "layers" && (
          <div className="grid gap-1.5">
            {layers.length === 0 && (
              <EmptyNote>لا توجد عناصر في هذه الصفحة بعد.</EmptyNote>
            )}
            {layers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                dragging={draggedLayerId === layer.id}
                dropTarget={dropLayerId === layer.id && draggedLayerId !== layer.id}
                onDragStart={startLayerDrag(layer.id)}
              />
            ))}
          </div>
        )}

        {tab === "properties" && !el && (
          <div className="grid gap-2">
            <EmptyNote>
              اختر عنصراً على الصفحة لعرض خصائصه: الموضع، المقاس، الدوران، الشفافية، الخط، الألوان، الإطار والظل.
              النقر المزدوج على النص يفعّل التعديل المباشر.
            </EmptyNote>
            <button
              type="button"
              disabled={!clipboard}
              onClick={pasteClipboard}
              className="h-9 rounded-[8px] border border-line text-[12px] font-extrabold disabled:opacity-40 dark:border-white/10"
            >
              لصق العنصر المنسوخ
            </button>
          </div>
        )}

        {tab === "properties" && el && (
          <div className="grid gap-3">
            {selectedCount > 1 && (
              <div className="rounded-[8px] border border-blue-300 bg-blue-50 px-2.5 py-2 text-[11px] font-bold text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                {selectedCount} عناصر محددة — تُطبَّق التعديلات على العنصر الأساسي «{el.name || TYPE_NAME[el.type]}» فقط.
                استخدم شريط الترتيب للمحاذاة والتجميع.
              </div>
            )}
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-extrabold">{el.name || TYPE_NAME[el.type]}</h3>
              <span className="text-[11px] text-muted">{TYPE_NAME[el.type]}</span>
            </div>

            <Field label="الاسم">
              <input value={el.name} onChange={(e) => updateElement(el.id, { name: e.target.value })} />
            </Field>

            {TEXT_MARKUP_TYPES.has(el.type) && (
              <Field label="النص (Enter لسطر جديد)" full>
                <textarea
                  rows={4}
                  value={el.content || ""}
                  onChange={(e) => updateElement(el.id, { content: e.target.value }, true)}
                  onBlur={() => updateElement(el.id, { content: el.content })}
                />
              </Field>
            )}

            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "w", "h"] as const).map((k) => (
                <Field key={k} label={LABELS[k]}>
                  <input
                    type="number"
                    step={0.5}
                    value={round(el[k])}
                    onChange={(e) => updateElement(el.id, { [k]: Number(e.target.value) }, true)}
                    onBlur={() => updateElement(el.id, { [k]: el[k] })}
                  />
                </Field>
              ))}
              <Field label="دوران °">
                <input
                  type="number"
                  value={round(el.rotation)}
                  onChange={(e) => updateElement(el.id, { rotation: Number(e.target.value) }, true)}
                  onBlur={() => updateElement(el.id, { rotation: el.rotation })}
                />
              </Field>
              <Field label="شفافية">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={el.opacity}
                  onChange={(e) => updateElement(el.id, { opacity: Number(e.target.value) }, true)}
                  onBlur={() => updateElement(el.id, { opacity: el.opacity })}
                />
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-extrabold text-muted">محاذاة داخل الصفحة</p>
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
                    className="h-8 rounded-[8px] border border-line text-[11px] font-bold dark:border-white/10"
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {TEXT_TYPES.includes(el.type) && (
              <>
                <Field label="الخط">
                  <select
                    value={el.style.fontFamily || "Tajawal"}
                    onChange={(e) => updateStyle(el.id, { fontFamily: e.target.value })}
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
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[10px] font-extrabold dark:border-white/10"
                >
                  <Baseline className="size-3.5" /> مكتبة الخطوط ({fontChoices.length})
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="الحجم pt">
                    <input
                      type="number"
                      min={4}
                      max={200}
                      value={el.style.fontSize || 14}
                      onChange={(e) => updateStyle(el.id, { fontSize: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { fontSize: el.style.fontSize })}
                    />
                  </Field>
                  <Field label="الوزن">
                    <select
                      value={String(el.style.fontWeight || 600)}
                      onChange={(e) => updateStyle(el.id, { fontWeight: Number(e.target.value) })}
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
                          el.style.textAlign === v ? "border-navy bg-navy text-white" : "border-line dark:border-white/10",
                        )}
                      >
                        <Icon className="size-4" />
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="لون النص">
                    <input
                      type="color"
                      value={toColor(el.style.color, theme.ink)}
                      onChange={(e) => updateStyle(el.id, { color: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { color: el.style.color })}
                    />
                  </Field>
                  <Field label="تباعد الحروف مم">
                    <input
                      type="number"
                      step={0.05}
                      min={-1}
                      max={3}
                      value={el.style.letterSpacing ?? 0}
                      onChange={(e) => updateStyle(el.id, { letterSpacing: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { letterSpacing: el.style.letterSpacing })}
                    />
                  </Field>
                </div>
              </>
            )}

            {(el.type === "text" || el.type === "box" || el.type === "stat") && (
              <>
                <Field label={`تباعد الأسطر — ${(el.style.lineHeight || 1.45).toFixed(2)}`}>
                  <CommitRange
                    min={0.9}
                    max={2.6}
                    step={0.05}
                    value={el.style.lineHeight || 1.45}
                    ariaLabel="تباعد الأسطر"
                    onLive={(v) => updateStyle(el.id, { lineHeight: v }, true)}
                    onCommit={(v) => updateStyle(el.id, { lineHeight: v })}
                  />
                  <div className="mt-1 flex gap-1">
                    {LINE_HEIGHTS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        title={`${l.label} (${l.value})`}
                        onClick={() => updateStyle(el.id, { lineHeight: l.value })}
                        className={cn(
                          "h-7 flex-1 rounded-[6px] border text-[10px] font-extrabold",
                          Math.abs((el.style.lineHeight || 1.45) - l.value) < 0.01
                            ? "border-navy-2 bg-navy-2/5"
                            : "border-line dark:border-white/10",
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
                        onClick={() => updateStyle(el.id, { letterSpacing: l.value })}
                        className={cn(
                          "h-8 flex-1 rounded-[6px] border text-[10px] font-extrabold",
                          Math.abs((el.style.letterSpacing || 0) - l.value) < 0.01
                            ? "border-navy-2 bg-navy-2/5"
                            : "border-line dark:border-white/10",
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
              <section className="grid gap-2.5 rounded-[10px] border border-line p-2.5 dark:border-white/10">
                <h3 className="text-[11px] font-extrabold tracking-wide text-muted">معالجة النص العربي</h3>

                <Field label="شكل الأرقام">
                  <div className="grid grid-cols-2 gap-1.5">
                    {NUMERAL_OPTIONS.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => updateStyle(el.id, { numerals: n.id })}
                        className={cn(
                          "h-9 rounded-[8px] border text-[11px] font-extrabold",
                          (el.style.numerals || "western") === n.id
                            ? "border-navy-2 bg-navy-2/5"
                            : "border-line dark:border-white/10",
                        )}
                      >
                        {n.label} <span className="text-muted">{n.sample}</span>
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
                        onClick={() => updateStyle(el.id, { paragraphSpacing: p.value })}
                        aria-pressed={(el.style.paragraphSpacing || 0) === p.value}
                        className={cn(
                          "h-8 flex-1 rounded-[6px] border text-[10px] font-extrabold",
                          (el.style.paragraphSpacing || 0) === p.value
                            ? "border-navy-2 bg-navy-2/5"
                            : "border-line dark:border-white/10",
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="النص الطويل">
                  <select
                    value={el.style.textFit || "clip"}
                    onChange={(e) => updateStyle(el.id, { textFit: e.target.value as "clip" | "shrink" | "grow" })}
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
                    يُصغَّر الخط تلقائياً ليتسع النص داخل الإطار — يتوقف عند أدنى حجم مقروء.
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
                          onClick={() => updateStyle(el.id, { justifyLastLine: v })}
                          aria-pressed={(el.style.justifyLastLine || "start") === v}
                          className={cn(
                            "h-8 rounded-[6px] border text-[10px] font-extrabold",
                            (el.style.justifyLastLine || "start") === v
                              ? "border-navy-2 bg-navy-2/5"
                              : "border-line dark:border-white/10",
                          )}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}

                <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
                  إظهار النص الزائد
                  <input
                    type="checkbox"
                    checked={Boolean(el.style.overflowVisible)}
                    onChange={(e) => updateStyle(el.id, { overflowVisible: e.target.checked })}
                    className="accent-navy"
                  />
                </label>

                <div className="grid grid-cols-2 gap-1.5">
                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
                    الاتجاه عمودي
                    <input
                      type="checkbox"
                      checked={el.style.writingMode === "vertical"}
                      onChange={(e) => updateStyle(el.id, { writingMode: e.target.checked ? "vertical" : "horizontal" })}
                      className="accent-navy"
                    />
                  </label>
                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
                    إزالة التشكيل
                    <input
                      type="checkbox"
                      checked={Boolean(el.style.stripTashkeel)}
                      onChange={(e) => updateStyle(el.id, { stripTashkeel: e.target.checked })}
                      className="accent-navy"
                    />
                  </label>
                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
                    احترام أسطر النص
                    <input
                      type="checkbox"
                      checked={Boolean(el.style.preserveBreaks)}
                      onChange={(e) => updateStyle(el.id, { preserveBreaks: e.target.checked })}
                      className="accent-navy"
                    />
                  </label>
                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
                    ربط الوحدات
                    <input
                      type="checkbox"
                      checked={Boolean(el.style.bindUnits)}
                      onChange={(e) => updateStyle(el.id, { bindUnits: e.target.checked })}
                      className="accent-navy"
                    />
                  </label>
                  <label className="flex h-9 items-center justify-between gap-2 rounded-[8px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10">
                    ترقيم عربي
                    <input
                      type="checkbox"
                      checked={Boolean(el.style.arabicPunctuation)}
                      onChange={(e) => updateStyle(el.id, { arabicPunctuation: e.target.checked })}
                      className="accent-navy"
                    />
                  </label>
                </div>

                {el.style.writingMode === "vertical" && (
                  <p className="text-[10px] leading-4 text-muted">
                    الاتجاه العمودي مناسب لعناوين الكعب والغلاف الجانبي. تأكد من كفاية ارتفاع العنصر.
                  </p>
                )}
              </section>
            )}

            {["box", "stat", "progress"].includes(el.type) && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="التعبئة">
                  <input
                    type="color"
                    value={toColor(el.style.fill, theme.surface)}
                    onChange={(e) => updateStyle(el.id, { fill: e.target.value }, true)}
                    onBlur={() => updateStyle(el.id, { fill: el.style.fill })}
                  />
                </Field>
                <Field label="لون الخلفية">
                  <input
                    type="color"
                    value={toColor(el.style.background || el.style.fill, theme.surface)}
                    onChange={(e) => updateStyle(el.id, { background: e.target.value }, true)}
                    onBlur={() => updateStyle(el.id, { background: el.style.background })}
                  />
                </Field>
                <Field label="الإطار">
                  <input
                    type="color"
                    value={toColor(el.style.borderColor, theme.line)}
                    onChange={(e) => updateStyle(el.id, { borderColor: e.target.value }, true)}
                    onBlur={() => updateStyle(el.id, { borderColor: el.style.borderColor })}
                  />
                </Field>
                <Field label="سماكة الإطار مم">
                  <input
                    type="number"
                    step={0.05}
                    min={0}
                    value={el.style.borderWidth ?? 0.35}
                    onChange={(e) => updateStyle(el.id, { borderWidth: Number(e.target.value) }, true)}
                    onBlur={() => updateStyle(el.id, { borderWidth: el.style.borderWidth })}
                  />
                </Field>
                <Field label="الزوايا مم">
                  <input
                    type="number"
                    min={0}
                    value={el.style.radius || 0}
                    onChange={(e) => updateStyle(el.id, { radius: Number(e.target.value) }, true)}
                    onBlur={() => updateStyle(el.id, { radius: el.style.radius })}
                  />
                </Field>
                <Field label="الحاشية مم">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={el.style.padding ?? 4}
                    onChange={(e) => updateStyle(el.id, { padding: Number(e.target.value) }, true)}
                    onBlur={() => updateStyle(el.id, { padding: el.style.padding })}
                  />
                </Field>
              </div>
            )}

            {el.type === "progress" && (
              <>
                <Field label="النوع" full>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["bar", "ring"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => updateStyle(el.id, { variant: v })}
                        className={cn(
                          "h-9 rounded-[8px] border text-[11px] font-extrabold",
                          (el.style.variant || "bar") === v
                            ? "border-navy-2 bg-navy-2/5"
                            : "border-line dark:border-white/10",
                        )}
                      >
                        {v === "bar" ? "شريط أفقي" : "حلقة دائرية"}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={`نسبة الإنجاز: ${Math.round(Number(el.style.value) || 0)}%`} full>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Number(el.style.value) || 0}
                    onChange={(e) => updateStyle(el.id, { value: Number(e.target.value) }, true)}
                    onBlur={() => updateStyle(el.id, { value: el.style.value })}
                    className="w-full accent-navy"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="رقم النسبة">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Math.round(Number(el.style.value) || 0)}
                      onChange={(e) => updateStyle(el.id, { value: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { value: el.style.value })}
                    />
                  </Field>
                  <Field label="عرض الرقم">
                    <select
                      value={el.style.showValue === false ? "no" : "yes"}
                      onChange={(e) => updateStyle(el.id, { showValue: e.target.value === "yes" })}
                    >
                      <option value="yes">ظاهر</option>
                      <option value="no">مخفي</option>
                    </select>
                  </Field>
                  <Field label="لون الشريط">
                    <input
                      type="color"
                      value={toColor(el.style.fill, theme.primary)}
                      onChange={(e) => updateStyle(el.id, { fill: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { fill: el.style.fill })}
                    />
                  </Field>
                  <Field label="لون المسار">
                    <input
                      type="color"
                      value={toColor(el.style.background, "#e8ecf3")}
                      onChange={(e) => updateStyle(el.id, { background: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { background: el.style.background })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {[25, 50, 75, 90, 100].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => updateStyle(el.id, { value: v })}
                      className="h-8 rounded-[8px] border border-line text-[11px] font-extrabold tabular-nums dark:border-white/10"
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
                      const active = (el.style.shapeId || el.style.shape || "rect") === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => updateStyle(el.id, { shapeId: s.id })}
                          title={s.label}
                          className={cn(
                            "grid aspect-square place-items-center rounded-[6px] border p-1",
                            active
                              ? "border-navy-2 bg-navy-2/10 text-navy-2 dark:text-gold-2"
                              : "border-line text-muted hover:border-navy-2 dark:border-white/10",
                          )}
                        >
                          <ShapePreview shapeId={s.id} className="size-full max-h-7" />
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="التعبئة">
                    <input
                      type="color"
                      value={toColor(el.style.fill, theme.primary)}
                      onChange={(e) => updateStyle(el.id, { fill: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { fill: el.style.fill })}
                    />
                  </Field>
                  <Field label="لون الإطار">
                    <input
                      type="color"
                      value={toColor(el.style.borderColor, "#c9a86a")}
                      onChange={(e) => updateStyle(el.id, { borderColor: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { borderColor: el.style.borderColor })}
                    />
                  </Field>
                  <Field label="سماكة الإطار">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      value={el.style.borderWidth ?? 0}
                      onChange={(e) => updateStyle(el.id, { borderWidth: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { borderWidth: el.style.borderWidth })}
                    />
                  </Field>
                  <Field label="بلا إطار">
                    <button
                      type="button"
                      onClick={() => updateStyle(el.id, { borderWidth: 0 })}
                      className="h-9 w-full rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
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
                    onChange={(e) => updateElement(el.id, { opacity: Number(e.target.value) / 100 }, true)}
                    onBlur={() => updateElement(el.id, { opacity: el.opacity })}
                    className="w-full accent-navy"
                  />
                </Field>
              </>
            )}

            {el.type === "icon" && (
              <>
                <Field label="الأيقونة">
                  <select value={el.icon || "star"} onChange={(e) => updateElement(el.id, { icon: e.target.value })}>
                    {Object.keys(ICONS).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="اللون">
                    <input
                      type="color"
                      value={toColor(el.style.color, theme.accent)}
                      onChange={(e) => updateStyle(el.id, { color: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { color: el.style.color })}
                    />
                  </Field>
                  <Field label="سماكة الخط">
                    <input
                      type="number"
                      step={0.1}
                      min={0.5}
                      value={el.style.stroke || 1.8}
                      onChange={(e) => updateStyle(el.id, { stroke: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { stroke: el.style.stroke })}
                    />
                  </Field>
                </div>
              </>
            )}

            {(el.type === "line" || el.type === "divider") && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="اللون">
                  <input
                    type="color"
                    value={toColor(el.style.color, theme.accent)}
                    onChange={(e) => updateStyle(el.id, { color: e.target.value }, true)}
                    onBlur={() => updateStyle(el.id, { color: el.style.color })}
                  />
                </Field>
                <Field label="السماكة مم">
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={el.style.stroke || 0.8}
                    onChange={(e) => updateStyle(el.id, { stroke: Number(e.target.value) }, true)}
                    onBlur={() => updateStyle(el.id, { stroke: el.style.stroke })}
                  />
                </Field>
              </div>
            )}

            {el.type === "table" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="أعمدة">
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={el.style.cols || 3}
                      onChange={(e) => resizeTable(el, Number(e.target.value), el.style.rows || 4, updateElement)}
                    />
                  </Field>
                  <Field label="صفوف">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={el.style.rows || 4}
                      onChange={(e) => resizeTable(el, el.style.cols || 3, Number(e.target.value), updateElement)}
                    />
                  </Field>
                </div>

                <Field label="إضافة / حذف سريع" full>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={(el.style.rows || 4) >= 30}
                      onClick={() => setTableSize(el, { rows: (el.style.rows || 4) + 1 }, updateElement)}
                      className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40 dark:border-white/10"
                    >
                      + صف
                    </button>
                    <button
                      type="button"
                      disabled={(el.style.rows || 4) <= 1}
                      onClick={() => setTableSize(el, { rows: (el.style.rows || 4) - 1 }, updateElement)}
                      className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40 dark:border-white/10"
                    >
                      − صف
                    </button>
                    <button
                      type="button"
                      disabled={(el.style.cols || 3) >= 12}
                      onClick={() => setTableSize(el, { cols: (el.style.cols || 3) + 1 }, updateElement)}
                      className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40 dark:border-white/10"
                    >
                      + عمود
                    </button>
                    <button
                      type="button"
                      disabled={(el.style.cols || 3) <= 1}
                      onClick={() => setTableSize(el, { cols: (el.style.cols || 3) - 1 }, updateElement)}
                      className="h-8 rounded-[6px] border border-line text-[10px] font-extrabold disabled:opacity-40 dark:border-white/10"
                    >
                      − عمود
                    </button>
                  </div>
                </Field>

                <Field label="محاذاة الخلايا">
                  <select
                    value={el.style.cellAlign || "right"}
                    onChange={(e) =>
                      updateStyle(el.id, { cellAlign: e.target.value as "right" | "center" | "left" })
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
                      onChange={(e) => updateStyle(el.id, { headerBg: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { headerBg: el.style.headerBg })}
                    />
                  </Field>
                  <Field label="لون الرأس">
                    <input
                      type="color"
                      value={toColor(el.style.headerColor, "#ffffff")}
                      onChange={(e) => updateStyle(el.id, { headerColor: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { headerColor: el.style.headerColor })}
                    />
                  </Field>
                  <Field label="خلفية الخلايا">
                    <input
                      type="color"
                      value={toColor(el.style.tableBg, "#ffffff")}
                      onChange={(e) => updateStyle(el.id, { tableBg: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { tableBg: el.style.tableBg })}
                    />
                  </Field>
                  <Field label="لون الحدود">
                    <input
                      type="color"
                      value={toColor(el.style.borderColor, "#bfc7d6")}
                      onChange={(e) => updateStyle(el.id, { borderColor: e.target.value }, true)}
                      onBlur={() => updateStyle(el.id, { borderColor: el.style.borderColor })}
                    />
                  </Field>
                  <Field label="تخطيط الصفوف">
                    <select
                      value={el.style.stripeBg ? "stripe" : "plain"}
                      onChange={(e) => updateStyle(el.id, { stripeBg: e.target.value === "stripe" ? "#f4f6fa" : "" })}
                    >
                      <option value="plain">بلون واحد</option>
                      <option value="stripe">صفوف متبادلة</option>
                    </select>
                  </Field>
                  <Field label="حجم الخط pt">
                    <input
                      type="number"
                      min={5}
                      max={40}
                      value={el.style.fontSize || 11}
                      onChange={(e) => updateStyle(el.id, { fontSize: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { fontSize: el.style.fontSize })}
                    />
                  </Field>
                </div>

                <TableTotals el={el} />

                <div>
                  <button
                    type="button"
                    onClick={() => setCellEditor((v) => !v)}
                    aria-expanded={cellEditor}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-line text-[12px] font-extrabold dark:border-white/10"
                  >
                    <Grid2x2 className="size-3.5" />
                    {cellEditor ? "إغلاق محرر الخلايا" : "تحرير الخلايا كشبكة"}
                  </button>
                  {cellEditor && (
                    <div className="mt-2 overflow-auto rounded-[8px] border border-line p-1 dark:border-white/10">
                      <table className="border-collapse">
                        <tbody>
                          {parseTable(el.content, el.style.cols, el.style.rows).map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell, ci) => (
                                <td key={ci} className="p-0.5">
                                  <input
                                    value={cell}
                                    aria-label={`صف ${ri + 1} عمود ${ci + 1}`}
                                    onChange={(e) => setTableCell(el, ri, ci, e.target.value, updateElement)}
                                    className="h-7 w-[74px] rounded-[4px] border border-line px-1 text-[11px] dark:border-white/10 dark:bg-white/5"
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
                    value={parseTable(el.content, el.style.cols, el.style.rows)
                      .map((r) => r.join(" | "))
                      .join("\n")}
                    onChange={(e) => {
                      const data = e.target.value
                        .split("\n")
                        .map((line) => line.split("|").map((c) => c.trim()));
                      updateElement(el.id, { content: JSON.stringify(data) }, true);
                    }}
                    onBlur={() => updateElement(el.id, { content: el.content })}
                  />
                </Field>

                <button
                  type="button"
                  onClick={() => {
                    const data = parseTable(el.content, el.style.cols, el.style.rows);
                    void copyTableCsv(data);
                  }}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
                >
                  <Copy className="size-3.5" /> نسخ الجدول كـ CSV
                </button>
              </>
            )}

            {["image", "logo"].includes(el.type) && (
              <>
                <Field label="الملاءمة">
                  <select
                    value={el.style.objectFit || "cover"}
                    onChange={(e) =>
                      updateStyle(el.id, { objectFit: e.target.value as "cover" | "contain" | "fill" })
                    }
                  >
                    <option value="cover">Cover — تعبئة مع قص</option>
                    <option value="contain">Contain — احتواء كامل</option>
                    <option value="fill">Fill — تمديد</option>
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="موضع أفقي %">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={el.style.objectX ?? 50}
                      onChange={(e) => updateStyle(el.id, { objectX: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { objectX: el.style.objectX })}
                    />
                  </Field>
                  <Field label="موضع رأسي %">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={el.style.objectY ?? 50}
                      onChange={(e) => updateStyle(el.id, { objectY: Number(e.target.value) }, true)}
                      onBlur={() => updateStyle(el.id, { objectY: el.style.objectY })}
                    />
                  </Field>
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
                  onChange={(e) => updateElement(el.id, { content: e.target.value }, true)}
                  onBlur={() => updateElement(el.id, { content: el.content })}
                />
              </Field>
            )}

            <Field label="الظل">
              <select
                value={shadowId(el.style.shadow)}
                onChange={(e) => {
                  const found = SHADOWS.find((s) => s.id === e.target.value);
                  updateStyle(el.id, { shadow: found?.value || "" });
                }}
              >
                {SHADOWS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-1.5">
              <Action onClick={() => bring("forward")} icon={ArrowUp} label="تقديم" />
              <Action onClick={() => bring("back")} icon={ArrowDown} label="تأخير" />
              <Action onClick={duplicateSelected} icon={Copy} label="نسخ (⌘D)" />
              <Action onClick={copySelected} icon={Copy} label="قص للحافظة" />
              <Action onClick={toggleLock} icon={el.locked ? Unlock : Lock} label={el.locked ? "فتح القفل" : "قفل"} />
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
            <Action onClick={deleteSelected} icon={Trash2} label="حذف العنصر" danger />
          </div>
        )}
      </div>
    </aside>
  );
}

/** Types that render an editable text body (table is edited structurally). */
const TEXT_MARKUP_TYPES = new Set(["text", "box", "stat", "stamp", "progress"]);

const LABELS: Record<"x" | "y" | "w" | "h", string> = {
  x: "X مم",
  y: "Y مم",
  w: "العرض مم",
  h: "الارتفاع مم",
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
  resizeTable(el, next.cols ?? el.style.cols ?? 3, next.rows ?? el.style.rows ?? 4, updateElement);
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
      <p className="rounded-[6px] border border-gold/50 bg-gold/10 px-2 py-1.5 text-[10px] leading-4 font-bold text-navy dark:text-gold-2">
        تم تصغير الخط تلقائياً من {round2(base)}pt إلى {round2(prepared.fontSize)}pt ليتّسع النص.
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

/** Copy the grid as CSV so it can travel into Excel, Sheets, or another app. */
async function copyTableCsv(data: string[][]) {
  const csv = toCsv(data);
  try {
    await navigator.clipboard.writeText(csv);
    toast.success("تم نسخ الجدول بصيغة CSV");
  } catch {
    // Clipboard permission can be denied; fall back to a download so the data
    // is still retrievable rather than silently lost. `toCsv` already includes
    // the UTF-8 BOM that makes Excel read Arabic correctly.
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "table.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.message("تم تنزيل الجدول بصيغة CSV", { description: "تعذّر الوصول إلى الحافظة." });
  }
}

/** Read-only column sums, so the author can verify figures before typing them. */
function TableTotals({ el }: { el: CanvasEl }) {
  const totals = columnTotals(parseTable(el.content, el.style.cols, el.style.rows)).filter((t) => t.numeric);
  if (!totals.length) return null;
  return (
    <div className="rounded-[8px] border border-line p-2 dark:border-white/10">
      <h4 className="mb-1.5 text-[10px] font-extrabold text-muted">مجموع الأعمدة الرقمية</h4>
      <ul className="grid gap-1">
        {totals.map((t) => (
          <li key={t.col} className="flex items-center justify-between text-[11px]">
            <span className="text-muted">العمود {t.col + 1}</span>
            <span className="font-extrabold tabular-nums">{round2(t.total)}</span>
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
  const hit = SHADOWS.find((s) => s.value && s.value === value);
  return hit?.id || "none";
}

/**
 * One row in the layers list.
 *
 * Groups expand to show their members, which is the only place a nested element
 * can be picked without stepping into it on the canvas. Renaming happens inline
 * so the author stays in the list while organising a busy page.
 */
function LayerRow({
  layer,
  depth = 0,
  dragging = false,
  dropTarget = false,
  onDragStart,
}: {
  layer: CanvasEl;
  depth?: number;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: (event: React.PointerEvent) => void;
}) {
  const selected = useEditor((s) => s.selectedIds.includes(layer.id));
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const setElementFlag = useEditor((s) => s.setElementFlag);
  const renameElement = useEditor((s) => s.renameElement);
  const enterGroup = useEditor((s) => s.enterGroup);
  const moveLayer = useEditor((s) => s.moveLayer);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(layer.name || TYPE_NAME[layer.type]);

  const commitName = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== layer.name) renameElement(layer.id, next);
    else setDraft(layer.name || TYPE_NAME[layer.type]);
  };

  return (
    <div className="grid gap-1">
      <div
        data-layer-id={depth === 0 ? layer.id : undefined}
        className={cn(
          "flex items-center gap-1.5 rounded-[8px] border px-2 py-1.5",
          selected ? "border-navy-2 bg-navy-2/5" : "border-line dark:border-white/10",
          dragging && "opacity-50",
          dropTarget && "drop-target",
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
            className="min-w-0 flex-1 rounded-[6px] border border-line px-1.5 py-0.5 text-[12px] font-bold dark:border-white/15"
          />
        ) : (
          <>
          {depth === 0 && onDragStart && (
            <button type="button" onPointerDown={onDragStart} title="اسحب لإعادة ترتيب الطبقة" aria-label={`إعادة ترتيب ${layer.name || TYPE_NAME[layer.type]}`} className="drag-handle grid size-7 shrink-0 place-items-center rounded-[6px] border border-line text-muted dark:border-white/10">
              <GripVertical className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => (e.shiftKey ? toggleSelect(layer.id) : select(layer.id))}
            onDoubleClick={() => {
              // Double-clicking a group row steps into it, mirroring the canvas.
              if (layer.type === "group") enterGroup(layer.id);
              else setRenaming(true);
            }}
            className="flex min-w-0 flex-1 items-center justify-between text-right text-[12px]"
            title="نقرة لتحديد، Shift+نقرة لإضافة، نقرة مزدوجة لإعادة التسمية"
          >
            <span className="truncate font-bold">
              {layer.type === "group" && <span className="me-1 text-gold-2">▸</span>}
              {layer.name || TYPE_NAME[layer.type]}
            </span>
            <span className="flex items-center gap-1 pr-1 text-muted">
              {layer.locked && <Lock className="size-3.5" />}
              {layer.hidden && <EyeOff className="size-3.5" />}
              {layer.linkId && <Link className="size-3.5 text-gold-2" />}
              <span className="text-[10px] tabular-nums">{layer.z}</span>
            </span>
          </button>
          </>
        )}
        {/* Move up/down: wired to `moveLayer`, which swaps real array order and
            renumbers z — the layers list, canvas stacking and export order all
            follow the same z rule, so one press moves the layer everywhere. */}
        <button
          type="button"
          title="تقديم طبقة"
          aria-label={`تقديم ${layer.name || TYPE_NAME[layer.type]}`}
          onClick={() => moveLayer(layer.id, 1)}
          className="grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line dark:border-white/10"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          title="تأخير طبقة"
          aria-label={`تأخير ${layer.name || TYPE_NAME[layer.type]}`}
          onClick={() => moveLayer(layer.id, -1)}
          className="grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line dark:border-white/10"
        >
          <ArrowDown className="size-3.5" />
        </button>
        <button
          type="button"
          title={layer.hidden ? "إظهار" : "إخفاء"}
          aria-label={layer.hidden ? `إظهار ${layer.name || TYPE_NAME[layer.type]}` : `إخفاء ${layer.name || TYPE_NAME[layer.type]}`}
          onClick={() => setElementFlag(layer.id, "hidden")}
          className="grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line dark:border-white/10"
        >
          {layer.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
        <button
          type="button"
          title={layer.locked ? "فتح القفل" : "قفل"}
          aria-label={layer.locked ? `فتح قفل ${layer.name || TYPE_NAME[layer.type]}` : `قفل ${layer.name || TYPE_NAME[layer.type]}`}
          onClick={() => setElementFlag(layer.id, "locked")}
          className="grid size-8 shrink-0 touch-manipulation place-items-center rounded-[6px] border border-line dark:border-white/10"
        >
          {layer.locked ? <Unlock className="size-3.5" /> : <Lock className="size-3.5" />}
        </button>
      </div>
      {layer.children
        ?.slice()
        .sort((a, b) => b.z - a.z)
        .map((child) => (
          <LayerRow key={child.id} layer={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[8px] border border-dashed border-line p-4 text-[12px] leading-6 text-muted dark:border-white/15">
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

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={cn("editor-property-field grid gap-1 text-[11px] font-extrabold text-muted", full && "col-span-2")}>
      {label}
      <div className="field-control [&_input]:h-9 [&_input]:w-full [&_input]:rounded-[8px] [&_input]:border [&_input]:border-line [&_input]:bg-white [&_input]:px-2.5 [&_input]:text-[13px] [&_input]:font-semibold [&_input]:text-ink dark:[&_input]:border-white/10 dark:[&_input]:bg-white/5 dark:[&_input]:text-white [&_input[type=color]]:p-1 [&_input[type=range]]:h-9 [&_select]:h-9 [&_select]:w-full [&_select]:rounded-[8px] [&_select]:border [&_select]:border-line [&_select]:bg-white [&_select]:px-2.5 [&_select]:text-[13px] dark:[&_select]:border-white/10 dark:[&_select]:bg-white/5 dark:[&_select]:text-white [&_textarea]:min-h-[80px] [&_textarea]:w-full [&_textarea]:rounded-[8px] [&_textarea]:border [&_textarea]:border-line [&_textarea]:bg-white [&_textarea]:p-2.5 [&_textarea]:text-[13px] [&_textarea]:leading-6 dark:[&_textarea]:border-white/10 dark:[&_textarea]:bg-white/5 dark:[&_textarea]:text-white">
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
        danger
          ? "border-red-200 bg-red-50 text-danger dark:border-red-500/30 dark:bg-red-500/10"
          : "border-line dark:border-white/10",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function toColor(v: string | undefined, fallback: string) {
  if (!v || v === "transparent" || v.startsWith("rgba") || v.startsWith("hsl")) return fallback;
  return v;
}

export { X as UnusedIcon } from "lucide-react";