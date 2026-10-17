import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { pageSize, type SizeId } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";
import { PageBackground } from "./PageBackground";

export const OPEN_PAGE_SETTINGS_EVENT = "nasaq:open-page-settings";

/** Page name click opens this. Rename stays on double-click. */
export function PageSettingsHost() {
  const [pageId, setPageId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === "string" && id) setPageId(id);
    };
    window.addEventListener(OPEN_PAGE_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_PAGE_SETTINGS_EVENT, open);
  }, []);
  if (!pageId || typeof document === "undefined") return null;
  return createPortal(
    <PageSettingsDialog pageId={pageId} onClose={() => setPageId(null)} />,
    document.body,
  );
}

function PageSettingsDialog({
  pageId,
  onClose,
}: {
  pageId: string;
  onClose: () => void;
}) {
  const page = useEditor((s) => s.pages.find((item) => item.id === pageId));
  const renamePage = useEditor((s) => s.renamePage);
  const setPageSize = useEditor((s) => s.setPageSize);
  const clipExport = useEditor((s) => s.clipExport);
  const setClipExport = useEditor((s) => s.setClipExport);
  const [unit, setUnit] = useState<"mm" | "cm" | "in">("mm");
  const [customW, setCustomW] = useState("210");
  const [customH, setCustomH] = useState("297");
  const factor = unit === "mm" ? 1 : unit === "cm" ? 10 : 25.4;
  useEffect(() => {
    if (!page) return;
    const size = pageSize(page);
    setCustomW(String(Math.round((size.w / factor) * 100) / 100));
    setCustomH(String(Math.round((size.h / factor) * 100) / 100));
  }, [page?.id, unit]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!page) return null;
  const size = pageSize(page);
  const landscape = size.w > size.h;
  const applySize = (id: SizeId) => setPageSize(page.id, id);
  return (
    <div
      className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-scrim p-4 backdrop-blur-xs"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-label={`إعدادات ${page.name}`}
        dir="rtl"
        className="editor-settings-surface grid max-h-[min(86vh,760px)] w-[min(440px,100%)] gap-3.5 overflow-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
          <div>
            <h2 className="text-[14px] font-black text-ink">{page.name}</h2>
            <p className="mt-0.5 text-[11px] font-medium text-muted">
              تخصيص الاسم والمقاس والخلفية
            </p>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            className="grid size-8 place-items-center rounded-xl border border-line/60 text-muted transition hover:bg-line-2 hover:text-ink"
            onClick={onClose}
          >
            <span className="text-[14px] font-bold">✕</span>
          </button>
        </div>

        <label className="grid gap-1.5 text-[12px] font-extrabold text-ink">
          اسم الصفحة
          <input
            key={page.id}
            type="text"
            defaultValue={page.name}
            maxLength={200}
            aria-label="اسم الصفحة"
            className="h-9 rounded-xl border border-line bg-surface px-3 text-[12px] font-semibold text-ink outline-none focus:border-brand"
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== page.name) renamePage(page.id, name);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                event.currentTarget.value = page.name;
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <div className="grid gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-extrabold text-ink">المقاس والاتجاه</span>
            <span className="text-[10px] font-bold tabular-nums text-muted">
              {Math.round(size.w)} × {Math.round(size.h)} مم · {landscape ? "أفقي" : "عمودي"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className={cn(
                "h-9 rounded-xl border text-[11px] font-extrabold transition",
                !landscape && size.w === 210
                  ? "border-brand bg-navy/[0.06] text-brand shadow-xs"
                  : "border-line bg-surface text-ink hover:bg-surface-2",
              )}
              onClick={() => applySize("a4-portrait")}
            >
              A4 عمودي
            </button>
            <button
              type="button"
              className={cn(
                "h-9 rounded-xl border text-[11px] font-extrabold transition",
                landscape && size.h === 210
                  ? "border-brand bg-navy/[0.06] text-brand shadow-xs"
                  : "border-line bg-surface text-ink hover:bg-surface-2",
              )}
              onClick={() => applySize("a4-landscape")}
            >
              A4 أفقي
            </button>
            <button
              type="button"
              className="h-9 rounded-xl border border-line bg-surface text-[11px] font-extrabold text-ink hover:bg-surface-2"
              onClick={() => applySize("a3-portrait")}
            >
              A3
            </button>
            <button
              type="button"
              className="h-9 rounded-xl border border-line bg-surface text-[11px] font-extrabold text-ink hover:bg-surface-2"
              onClick={() => applySize("slide-16-9")}
            >
              عرض 16:9
            </button>
          </div>
          <div className="grid gap-2 rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-2">
              <strong className="text-[11px] font-extrabold text-ink">مقاس مخصص</strong>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value as "mm" | "cm" | "in")}
                className="h-7 rounded-lg border border-line bg-surface px-2 text-[10px] font-bold text-ink"
                aria-label="وحدة قياس الصفحة"
              >
                <option value="mm">مم</option>
                <option value="cm">سم</option>
                <option value="in">بوصة</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[10.5px] font-bold text-muted">
                العرض
                <input
                  type="number"
                  min={20 / factor}
                  max={2000 / factor}
                  step="0.01"
                  value={customW}
                  onChange={(event) => setCustomW(event.target.value)}
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-bold tabular-nums text-ink outline-none focus:border-brand"
                />
              </label>
              <label className="grid gap-1 text-[10.5px] font-bold text-muted">
                الارتفاع
                <input
                  type="number"
                  min={20 / factor}
                  max={2000 / factor}
                  step="0.01"
                  value={customH}
                  onChange={(event) => setCustomH(event.target.value)}
                  className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-bold tabular-nums text-ink outline-none focus:border-brand"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                className="h-8 rounded-lg border border-line bg-surface text-[10.5px] font-bold text-ink hover:bg-surface-2"
                onClick={() => {
                  const w = Number(customW), h = Number(customH);
                  if (w > h) { setCustomW(String(h)); setCustomH(String(w)); }
                }}
              >
                رأسي
              </button>
              <button
                type="button"
                className="h-8 rounded-lg border border-line bg-surface text-[10.5px] font-bold text-ink hover:bg-surface-2"
                onClick={() => {
                  const w = Number(customW), h = Number(customH);
                  if (h > w) { setCustomW(String(h)); setCustomH(String(w)); }
                }}
              >
                أفقي
              </button>
            </div>
            <button
              type="button"
              className="h-8 rounded-lg bg-navy text-[11px] font-extrabold text-on-brand shadow-xs transition hover:bg-navy-2 disabled:opacity-40"
              disabled={
                !Number.isFinite(Number(customW)) ||
                !Number.isFinite(Number(customH)) ||
                Number(customW) * factor < 20 ||
                Number(customH) * factor < 20 ||
                Number(customW) * factor > 2000 ||
                Number(customH) * factor > 2000
              }
              onClick={() =>
                setPageSize(page.id, "custom", {
                  w: Number(customW) * factor,
                  h: Number(customH) * factor,
                })
              }
            >
              تطبيق الأبعاد على الصفحة
            </button>
            <span className="text-[9.5px] leading-4 text-muted">
              20–2000 مم لكل بُعد. تبقى العناصر والطبقات قابلة للتحرير ويُسجّل التغيير في التراجع.
            </span>
          </div>
        </div>
        <PageBackground page={page} />
        <label className="flex items-start gap-2 rounded-xl border border-line bg-surface-2/20 p-2.5 text-[11px] font-bold">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={clipExport !== false}
            onChange={(event) => setClipExport(event.target.checked)}
          />
          <span>
            قص التصدير على حدود الصفحة
            <span className="mt-0.5 block font-semibold text-muted">
              مستقل عن الإخفاء أثناء التحرير. لا يحذف العناصر ولا يغيّر أبعاد الصفحة.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
