import { memo, useState } from "react";
import { Check, Crop, Eraser, Paintbrush, ScanLine, X } from "lucide-react";
import { ASPECT_RATIOS, regionSizeLabel } from "@/lib/editor/marquee";
import {
  BRUSH_LIMITS,
  ERASER_LIMITS,
  useTools,
} from "@/lib/editor/tool-store";
import { toolDef } from "@/lib/editor/tools";
import {
  applyImageCrop,
  beginImageCrop,
  cropSelectionToImage,
  extractRegionFromImage,
} from "@/lib/editor/crop-session";
import { useInteraction } from "@/lib/editor/interaction-store";
import { useEditor } from "@/lib/editor/store";
import { findElement } from "@/lib/editor/model";
import { cn } from "@/lib/utils";

/**
 * Contextual tool options — the properties of the LIVE tool, and nothing else.
 *
 * The editor used to hard-code three unrelated option clusters in the header:
 * a permanent eraser size slider that appeared for exactly one tool, a pair of
 * marquee-shape buttons that duplicated the tool identity, and a size stepper
 * with no label. That is the "fake settings" problem — controls that look like
 * options but do not describe the current tool.
 *
 * This bar renders from the tool table, so each tool shows exactly its own
 * settings and tools without options show nothing:
 *
 *   Select / pickers → the region readout and what can be done with it
 *   Crop             → aspect ratio + Apply/Cancel
 *   Brush            → size, hardness, opacity, smoothing, colour
 *   Eraser           → size, hardness, opacity
 */

/** Compact labelled slider; every one is a real setting bound to the tool store. */
function OptionSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="tool-props-slider">
      <span className="tool-props-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-brand"
      />
      <span className="tool-props-value" dir="ltr">
        {Math.round(value * 100) / 100}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </label>
  );
}

function BrushOptions() {
  const brush = useTools((s) => s.brush);
  const setBrush = useTools((s) => s.setBrush);
  return (
    <>
      <span className="tool-props-title">
        <Paintbrush className="size-3.5" /> فرشاة
      </span>
      <OptionSlider
        label="الحجم"
        value={brush.sizeMm}
        min={BRUSH_LIMITS.size.min}
        max={BRUSH_LIMITS.size.max}
        step={0.5}
        suffix="مم"
        onChange={(sizeMm) => setBrush({ sizeMm })}
      />
      <OptionSlider
        label="الصلابة"
        value={Math.round(brush.hardness * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(hardness) => setBrush({ hardness: hardness / 100 })}
      />
      <OptionSlider
        label="العتامة"
        value={Math.round(brush.opacity * 100)}
        min={2}
        max={100}
        step={1}
        suffix="%"
        onChange={(opacity) => setBrush({ opacity: opacity / 100 })}
      />
      <OptionSlider
        label="التنعيم"
        value={Math.round(brush.smoothing * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(smoothing) => setBrush({ smoothing: smoothing / 100 })}
      />
      <label className="tool-props-color">
        <span className="tool-props-label">اللون</span>
        <input
          type="color"
          value={brush.color}
          aria-label="لون الفرشاة"
          onChange={(event) => setBrush({ color: event.target.value })}
        />
      </label>
    </>
  );
}

function EraserOptions() {
  const eraser = useTools((s) => s.eraser);
  const setEraser = useTools((s) => s.setEraser);
  return (
    <>
      <span className="tool-props-title">
        <Eraser className="size-3.5" /> مسح
      </span>
      <OptionSlider
        label="الحجم"
        value={eraser.sizeMm}
        min={ERASER_LIMITS.size.min}
        max={ERASER_LIMITS.size.max}
        step={0.5}
        suffix="مم"
        onChange={(sizeMm) => setEraser({ sizeMm })}
      />
      <OptionSlider
        label="الصلابة"
        value={Math.round(eraser.hardness * 100)}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onChange={(hardness) => setEraser({ hardness: hardness / 100 })}
      />
      <OptionSlider
        label="العتامة"
        value={Math.round(eraser.opacity * 100)}
        min={2}
        max={100}
        step={1}
        suffix="%"
        onChange={(opacity) => setEraser({ opacity: opacity / 100 })}
      />
      <span className="tool-props-hint">يعمل على الصور والطبقات النقطية فقط</span>
    </>
  );
}

/** Region actions: what the rectangle you just drew can be used for. */
function RegionActions({ compact = false }: { compact?: boolean }) {
  const region = useTools((s) => s.region);
  const [busy, setBusy] = useState(false);
  if (!region) return null;
  const run = (job: () => Promise<unknown>) => {
    setBusy(true);
    void job().finally(() => setBusy(false));
  };
  return (
    <>
      <span className="tool-props-value" dir="ltr">
        {regionSizeLabel(region.box)}
      </span>
      <button
        type="button"
        className="tool-props-btn"
        disabled={busy}
        title="قص الصورة إلى منطقة التحديد — غير متلف ويمكن التراجع عنه"
        aria-label="قص التحديد"
        onClick={() => run(() => cropSelectionToImage(region))}
      >
        <Crop className="size-3.5" />
        {compact ? null : "قص التحديد"}
      </button>
      <button
        type="button"
        className="tool-props-btn"
        disabled={busy}
        title="نسخ ما داخل التحديد إلى صورة مستقلة — الأصل لا يتغير"
        aria-label="استخراج التحديد"
        onClick={() => run(() => extractRegionFromImage(region))}
      >
        <ScanLine className="size-3.5" />
        {compact ? null : "استخراج"}
      </button>
      <button
        type="button"
        className="tool-props-btn is-quiet"
        title="إلغاء منطقة التحديد · Escape"
        aria-label="إلغاء منطقة التحديد"
        onClick={() => useTools.getState().setRegion(null)}
      >
        <X className="size-3.5" />
        {compact ? null : "إلغاء"}
      </button>
    </>
  );
}

function CropOptions() {
  const aspect = useTools((s) => s.cropAspect);
  const setAspect = useTools((s) => s.setCropAspect);
  const session = useInteraction((s) => s.crop);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIsImage = useEditor((s) => {
    const page = s.pages.find((p) => p.id === s.activePageId);
    const el =
      page && s.selectedId ? findElement(page.elements, s.selectedId)?.el : null;
    return el?.type === "image" || el?.type === "logo";
  });
  return (
    <>
      <span className="tool-props-title">
        <Crop className="size-3.5" /> قص
      </span>
      <div className="tool-props-chips" role="group" aria-label="نسبة القص">
        {ASPECT_RATIOS.map((ratio) => (
          <button
            key={ratio.id}
            type="button"
            className={cn("tool-props-chip", aspect === ratio.id && "is-active")}
            aria-pressed={aspect === ratio.id}
            onClick={() => setAspect(ratio.id)}
          >
            {ratio.label}
          </button>
        ))}
      </div>
      {session ? (
        <>
          <button
            type="button"
            className="tool-props-btn is-primary"
            title="تطبيق القص · Enter"
            onClick={applyImageCrop}
          >
            <Check className="size-3.5" />
            تطبيق
          </button>
          <button
            type="button"
            className="tool-props-btn is-quiet"
            title="إلغاء القص · Escape"
            onClick={() => useInteraction.getState().endCrop()}
          >
            <X className="size-3.5" />
            إلغاء
          </button>
        </>
      ) : (
        <button
          type="button"
          className="tool-props-btn"
          disabled={!selectedIsImage}
          title={
            selectedIsImage
              ? "ابدأ إطار القص على الصورة المحددة"
              : "حدد صورة أولاً، أو اسحب منطقة فوق صورة"
          }
          onClick={() => selectedId && beginImageCrop(selectedId)}
        >
          <Crop className="size-3.5" />
          قص الصورة المحددة
        </button>
      )}
      <span className="tool-props-sep" aria-hidden />
      <RegionActions compact />
    </>
  );
}

export const ToolPropertiesBar = memo(function ToolPropertiesBar() {
  const tool = useTools((s) => s.tool);
  const painting = useTools((s) => s.painting);
  const region = useTools((s) => s.region);
  const def = toolDef(tool);
  // Only tools with real settings get a bar — no hints dressed up as options.
  if (def.family !== "raster" && def.family !== "crop" && def.family !== "marquee")
    return null;

  return (
    <div
      data-editor-obstacle="tool-props"
      className="tool-props"
      dir="rtl"
      role="toolbar"
      aria-label={`خصائص ${def.label}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {def.family === "raster" && tool === "brush" && <BrushOptions />}
      {def.family === "raster" && tool === "eraser" && <EraserOptions />}
      {def.family === "crop" && <CropOptions />}
      {def.family === "marquee" && (
        <>
          <span className="tool-props-title">{def.label}</span>
          {def.marquee === "lasso" ? (
            <span className="tool-props-hint">ارسم الحدود بإصبعك أو القلم</span>
          ) : def.square ? (
            <span className="tool-props-hint">نسبة ثابتة 1:1</span>
          ) : (
            <span className="tool-props-hint">Shift = 1:1 · Alt = من المركز</span>
          )}
          {region ? (
            <RegionActions />
          ) : (
            <span className="tool-props-hint">اسحب على اللوحة لبدء التحديد</span>
          )}
        </>
      )}
      {painting && <span className="tool-props-hint is-live">جارٍ الرسم…</span>}
      <button
        type="button"
        className="tool-props-close"
        aria-label="إنهاء الأداة والعودة إلى أداة التحديد"
        title="أداة التحديد · V"
        onClick={() => useTools.getState().resetTool()}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
});
