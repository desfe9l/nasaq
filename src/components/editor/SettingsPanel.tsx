import { useEffect, useState } from "react";
import { Ruler } from "lucide-react";
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
    <div className="editor-pane-scroll editor-panel-body p-3">
      <div className="grid gap-4">
        <section>
          <h2 className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-extrabold">
            <Ruler className="size-4" /> مقاس الصفحة
          </h2>
          <div className="grid gap-1.5">
            {SIZE_PRESETS.filter((size) => size.id !== "custom").map((size) => (
              <button
                key={size.id}
                type="button"
                onClick={() => activePageId && setPageSize(activePageId, size.id)}
                className={cn(
                  "rounded-[8px] border px-2.5 py-2 text-right",
                  activeSizeId === size.id
                    ? "border-navy-2 bg-navy-2/5"
                    : "border-line ",
                )}
              >
                <strong className="block text-[12px]">{size.name}</strong>
                <span className="text-[11px] text-muted">{size.desc}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <ScrubField
              label="العرض مم"
              value={customSize.w}
              min={20}
              max={2000}
              step={1}
              precision={0}
              suffix="مم"
              onChange={(w) => setCustomSize((value) => ({ ...value, w }))}
            />
            <ScrubField
              label="الارتفاع مم"
              value={customSize.h}
              min={20}
              max={2000}
              step={1}
              precision={0}
              suffix="مم"
              onChange={(h) => setCustomSize((value) => ({ ...value, h }))}
            />
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => applyCustomSize("page")}
              className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold "
            >
              تطبيق على الصفحة
            </button>
            <button
              type="button"
              onClick={() => applyCustomSize("all")}
              className="h-9 rounded-[8px] border border-line text-[11px] font-extrabold "
            >
              تطبيق على الكل
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-extrabold">الدقة والمحاذاة</h2>
          <div className="grid gap-1.5">
            <button
              type="button"
              className="h-11 rounded-lg border border-line text-[12px] font-bold"
              onClick={() =>
                window.dispatchEvent(new CustomEvent(OPEN_EDITOR_SETTINGS_EVENT))
              }
            >
              مظهر المحرر — فاتح / داكن
            </button>
            <ToggleRow
              label="إظهار الشبكة"
              value={showGrid}
              onChange={() => toggle("showGrid")}
            />
            <ToggleRow
              label="التقاط للشبكة"
              value={snapGrid}
              onChange={() => toggle("snapGrid")}
            />
            <ToggleRow
              label="محاذاة العناصر"
              value={snapElements}
              onChange={() => toggle("snapElements")}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-extrabold">مكتبة الخطوط</h2>
          <p className="text-[11px] leading-5 text-muted">
            ثمانية خطوط عربية مضمّنة (Tajawal، Cairo، IBM Plex Sans Arabic، Noto
            Sans/Naskh/Kufi، Amiri، Reem Kufi)، مع إمكانية رفع خط مخصص بصيغة
            TTF/OTF/WOFF.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-extrabold">التخزين</h2>
          <p className="text-[11px] leading-5 text-muted">
            {storage.mode === "indexeddb"
              ? "المشاريع محفوظة محلياً في IndexedDB داخل متصفحك؛ قد تتطلب خدمات الترخيص أو الذكاء الاصطناعي اتصالاً."
              : "IndexedDB غير متاح في هذا المتصفح؛ يتم الحفظ في LocalStorage بمساحة محدودة."}
          </p>
        </section>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={value}
      className="flex items-center justify-between rounded-[8px] border border-line px-2.5 py-2 text-[12px] font-bold "
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          value ? "bg-navy-2" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all",
            value ? "right-0.5" : "right-[18px]",
          )}
        />
      </span>
    </button>
  );
}
