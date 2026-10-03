import { memo, useState } from "react";
import { Check, Crop, Eraser, Paintbrush, ScanLine, X } from "lucide-react";
import { regionSizeLabel } from "@/lib/editor/marquee";
import { BRUSH_LIMITS, ERASER_LIMITS, useTools } from "@/lib/editor/tool-store";
import { regionModeDef, toolDef } from "@/lib/editor/tools";
import {
  cropSelectionToImage,
  extractRegionFromImage,
} from "@/lib/editor/crop-session";
import { useInteraction } from "@/lib/editor/interaction-store";
import { cn } from "@/lib/utils";

/**
 * Contextual tool options — the properties of the LIVE tool, and nothing else.
 *
 * This bar is the whole price of arming a tool: a small floating capsule over
 * the canvas, never a reserved strip. It renders only when the live state has
 * real settings to show (brush, eraser, or an armed region with a finished
 * rectangle) and disappears the moment the operation ends — Apply, Cancel or
 * Escape. While a crop frame session owns the box, the frame's own
 * Apply/Cancel bubble is the single control surface, so this bar stands down;
 * two copies of the same confirm/cancel is exactly the sprawl this replaced.
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

/**
 * The finished region and what it can become: «قص» is the Apply of the crop
 * operation (non-destructive, one undo restores the full picture), «استخراج»
 * copies the pixels into a new image, «إلغاء» drops the region. All three are
 * icon-first with tooltips so the bar never grows with text.
 */
function RegionOptions() {
  const region = useTools((s) => s.region);
  const [busy, setBusy] = useState(false);
  const run = (job: () => Promise<unknown>) => {
    setBusy(true);
    void job().finally(() => setBusy(false));
  };
  if (!region)
    return (
      <span className="tool-props-hint">اسحب على اللوحة لبدء التحديد</span>
    );
  return (
    <>
      <span className="tool-props-value" dir="ltr">
        {regionSizeLabel(region.box)}
      </span>
      <button
        type="button"
        className="tool-props-btn is-primary"
        disabled={busy}
        title="تطبيق القص على الصورة داخل التحديد · Enter"
        aria-label="قص التحديد"
        onClick={() => run(() => cropSelectionToImage(region))}
      >
        <Check className="size-3.5" />
        <Crop className="size-3.5" />
        قص
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
        استخراج
      </button>
      <button
        type="button"
        className="tool-props-btn is-quiet"
        title="إلغاء منطقة التحديد · Escape"
        aria-label="إلغاء منطقة التحديد"
        onClick={() => useTools.getState().setRegion(null)}
      >
        <X className="size-3.5" />
        إلغاء
      </button>
    </>
  );
}

export const ToolPropertiesBar = memo(function ToolPropertiesBar() {
  const tool = useTools((s) => s.tool);
  const regionMode = useTools((s) => s.regionMode);
  const painting = useTools((s) => s.painting);
  const cropActive = useInteraction((s) => s.crop !== null);
  const def = toolDef(tool);
  // A live crop frame brings its own ephemeral Apply/Cancel bubble; a bar here
  // too would be the same controls twice.
  if (cropActive) return null;
  const regionArmed = tool === "select" && regionMode !== "off";
  // Only tools with real settings get a bar — no hints dressed up as options.
  if (def.family !== "raster" && !regionArmed) return null;
  const modeDef = regionModeDef(regionMode);

  return (
    <div
      data-editor-obstacle="tool-props"
      className="tool-props"
      dir="rtl"
      role="toolbar"
      aria-label={def.family === "raster" ? `خصائص ${def.label}` : "خصائص التحديد والقص"}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {def.family === "raster" && tool === "brush" && <BrushOptions />}
      {def.family === "raster" && tool === "eraser" && <EraserOptions />}
      {regionArmed && (
        <>
          <span className={cn("tool-props-title", "tool-props-title-region")}>
            <Crop className="size-3.5" /> {modeDef.label}
          </span>
          <span className="tool-props-hint">{modeDef.hint}</span>
          <RegionOptions />
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
