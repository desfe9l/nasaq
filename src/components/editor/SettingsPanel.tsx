import { useEffect, useState } from "react";
import {
  Check,
  Grid2x2,
  HardDrive,
  Layers,
  Magnet,
  Moon,
  Ruler,
  Sliders,
  SlidersHorizontal,
  Sun,
  SunDim,
  Type,
} from "lucide-react";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { SIZE_PRESETS, sizeIdOf } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { ScrubField } from "./ui/ScrubInput";

const CUSTOM_SIZE_KEY = "nasaq.editor.custom-page-size";

function readCustomSize() {
  try {
    const value = JSON.parse(localStorage.getItem(CUSTOM_SIZE_KEY) || "null");
    if (
      value &&
      Number.isFinite(value.w) &&
      Number.isFinite(value.h) &&
      value.w >= 20 &&
      value.h >= 20
    )
      return { w: value.w, h: value.h };
  } catch {
    /* Use the familiar A4 starting point when storage is unavailable. */
  }
  return { w: 210, h: 297 };
}

/**
 * The editor's page and alignment settings. This is the same Settings surface
 * formerly hosted in the Elements sidebar, now shown as a pinned tab beside
 * Properties. Keeping it as one component avoids a duplicate settings panel.
 */
export function SettingsPanel() {
  const activeSizeId = useEditor((s) =>
    sizeIdOf(s.pages.find((page) => page.id === s.activePageId)),
  );
  const activePageId = useEditor((s) => s.activePageId);
  const setPageSize = useEditor((s) => s.setPageSize);
  const setAllPageSizes = useEditor((s) => s.setAllPageSizes);
  const toggle = useEditor((s) => s.toggle);
  const showGrid = useEditor((s) => s.showGrid);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const appearance = useEditor((s) => s.appearance);
  const setAppearance = useEditor((s) => s.setAppearance);
  const storage = useEditor((s) => s.storage);
  const [customSize, setCustomSize] = useState(readCustomSize);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_SIZE_KEY, JSON.stringify(customSize));
    } catch {
      /* Keep the draft in memory when storage is unavailable. */
    }
  }, [customSize]);

  const applyCustomSize = (scope: "page" | "all") => {
    const w = Math.max(20, Math.min(1000, customSize.w));
    const h = Math.max(20, Math.min(1000, customSize.h));
    if (scope === "all") setAllPageSizes("custom", { w, h });
    else if (activePageId) setPageSize(activePageId, "custom", { w, h });
  };

  return (
    <div className="editor-pane-scroll editor-panel-body p-3.5">
      <div className="grid gap-4">
        {/* Appearance Quick Selector */}
        <section className="rounded-xl border border-line bg-surface p-3.5 shadow-xs">
          <div className="flex items-center justify-between border-b border-line/60 pb-2">
            <h2 className="flex items-center gap-1.5 text-[12px] font-extrabold text-ink">
              <Sun className="size-3.5 text-brand" strokeWidth={1.8} />
              مظهر المحرر
            </h2>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent(OPEN_EDITOR_SETTINGS_EVENT))
              }
              className="text-[10.5px] font-bold text-brand hover:underline"
            >
              خيارات متقدمة
            </button>
          </div>
          <div
            role="radiogroup"
            aria-label="سمة المحرر"
            className="mt-2.5 flex gap-1 rounded-xl border border-line bg-surface-2/40 p-1"
          >
            {(
              [
                { value: "light" as const, label: "فاتح", Icon: Sun },
                { value: "dim" as const, label: "خافت", Icon: SunDim },
                { value: "dark" as const, label: "داكن", Icon: Moon },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={appearance === value}
                onClick={() => setAppearance(value)}
                className={cn(
                  "inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-extrabold transition",
                  appearance === value
                    ? "bg-navy text-on-brand shadow-xs"
                    : "text-muted hover:bg-line-2 hover:text-ink",
                )}
              >
                <Icon className="size-3" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Page Size & Geometry */}
        <section className="rounded-xl border border-line bg-surface p-3.5 shadow-xs">
          <h2 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-extrabold text-ink">
            <Ruler className="size-3.5 text-brand" strokeWidth={1.8} /> مقاس الصفحة
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {SIZE_PRESETS.filter((size) => size.id !== "custom").map((size) => {
              const active = activeSizeId === size.id;
              return (
                <button
                  key={size.id}
                  type="button"
                  onClick={() => activePageId && setPageSize(activePageId, size.id)}
                  className={cn(
                    "flex flex-col rounded-xl border p-2.5 text-right transition-all duration-150",
                    active
                      ? "border-brand bg-navy/[0.07] ring-1 ring-brand/30 shadow-xs"
                      : "border-line bg-surface-2/30 hover:border-brand/40 hover:bg-surface-2",
                  )}
                >
                  <strong className="block text-[11.5px] font-extrabold text-ink">{size.name}</strong>
                  <span className="mt-0.5 block text-[10px] font-semibold text-muted">{size.desc}</span>
                </button>
              );
            })}
          </div>

          {/* Custom Size Fields */}
          <div className="mt-3 rounded-xl border border-line/70 bg-surface-2/30 p-2.5">
            <span className="mb-2 block text-[10.5px] font-bold text-muted">
              أبعاد مخصصة (20 – 2000 مم):
            </span>
            <div className="grid grid-cols-2 gap-2">
              <ScrubField
                label="العرض"
                value={customSize.w}
                min={20}
                max={2000}
                step={1}
                precision={0}
                suffix="مم"
                onChange={(w) => setCustomSize((value) => ({ ...value, w }))}
              />
              <ScrubField
                label="الارتفاع"
                value={customSize.h}
                min={20}
                max={2000}
                step={1}
                precision={0}
                suffix="مم"
                onChange={(h) => setCustomSize((value) => ({ ...value, h }))}
              />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => applyCustomSize("page")}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[11px] font-bold text-ink transition hover:bg-line-2"
              >
                <Check className="size-3 text-brand" />
                للصفحة الحالية
              </button>
              <button
                type="button"
                onClick={() => applyCustomSize("all")}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[11px] font-bold text-ink transition hover:bg-line-2"
              >
                <Layers className="size-3 text-brand" />
                لكل الصفحات
              </button>
            </div>
          </div>
        </section>

        {/* Snapping & Alignment */}
        <section className="rounded-xl border border-line bg-surface p-3.5 shadow-xs">
          <h2 className="mb-2.5 flex items-center gap-1.5 text-[12px] font-extrabold text-ink">
            <SlidersHorizontal className="size-3.5 text-brand" strokeWidth={1.8} />
            الدقة والمحاذاة الذكية
          </h2>
          <div className="grid gap-2">
            <ToggleRow
              label="إظهار شبكة التصميم"
              icon={Grid2x2}
              value={showGrid}
              onChange={() => toggle("showGrid")}
            />
            <ToggleRow
              label="جذب العناصر للشبكة (Snap)"
              icon={Magnet}
              value={snapGrid}
              onChange={() => toggle("snapGrid")}
            />
            <ToggleRow
              label="محاذاة العناصر المجاورة"
              icon={Sliders}
              value={snapElements}
              onChange={() => toggle("snapElements")}
            />
          </div>
        </section>

        {/* Font Library & Storage Info */}
        <div className="grid gap-3">
          <section className="rounded-xl border border-line bg-surface p-3 shadow-xs">
            <div className="flex items-center gap-2">
              <Type className="size-3.5 text-brand" strokeWidth={1.8} />
              <h2 className="text-[11.5px] font-extrabold text-ink">مكتبة الخطوط</h2>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-5 text-muted">
              ثمانية خطوط عربية مؤسسية مدمجة (Tajawal, Cairo, IBM Plex Sans, Amiri, Noto)، مع دعم كامل لرفع خطوط TTF/OTF.
            </p>
          </section>

          <section className="rounded-xl border border-line bg-surface p-3 shadow-xs">
            <div className="flex items-center gap-2">
              <HardDrive className="size-3.5 text-brand" strokeWidth={1.8} />
              <h2 className="text-[11.5px] font-extrabold text-ink">التخزين المحلي</h2>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-5 text-muted">
              {storage.mode === "indexeddb"
                ? "المشاريع والصفحات محفوظة محلياً في متصفحك بتقنية IndexedDB لسرعة فائقة وخصوصية تامة."
                : "الحفظ يتم في الذاكرة المحلية (LocalStorage)."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  icon: Icon,
  value,
  onChange,
}: {
  label: string;
  icon?: typeof Grid2x2;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={value}
      className={cn(
        "flex items-center justify-between rounded-xl border p-2.5 text-[11.5px] font-extrabold transition-all duration-150",
        value
          ? "border-brand/40 bg-navy/[0.04] text-ink"
          : "border-line bg-surface hover:bg-surface-2 text-muted hover:text-ink",
      )}
    >
      <span className="flex items-center gap-2">
        {Icon && <Icon className="size-3.5 text-brand" strokeWidth={1.8} />}
        <span>{label}</span>
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150",
          value ? "border-brand bg-brand" : "border-line bg-line-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-3.5 rounded-full bg-surface shadow-xs transition-all duration-150",
            // RTL: "on" slides toward the start of the track.
            value ? "start-0.5" : "start-[18px]",
          )}
        />
      </span>
    </button>
  );
}
