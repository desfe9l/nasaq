import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { pageSize, type SizeId } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
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
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-label={`إعدادات ${page.name}`}
        dir="rtl"
        className="editor-settings-surface grid max-h-[min(86vh,760px)] w-[min(440px,100%)] gap-3 overflow-auto rounded-[12px] border border-line bg-surface p-4 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-black">{page.name}</h2>
          <button type="button" className="text-[12px] font-bold" onClick={onClose}>
            إغلاق
          </button>
        </div>
        <p className="text-[11px] text-muted">
          حدّث اسم الصفحة وإعداداتها من هنا.
        </p>
        <label className="grid gap-1 text-[12px] font-bold">
          اسم الصفحة
          <input
            key={page.id}
            type="text"
            defaultValue={page.name}
            maxLength={200}
            aria-label="اسم الصفحة"
            className="h-9 rounded-[8px] border border-line bg-surface px-3 text-[12px] font-semibold outline-none focus:border-brand"
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
        <div className="grid gap-2">
          <span className="text-[12px] font-bold">المقاس والاتجاه</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" className="h-8 rounded-[8px] border border-line text-[11px] font-bold" onClick={() => applySize("a4-portrait")}>A4 عمودي</button>
            <button type="button" className="h-8 rounded-[8px] border border-line text-[11px] font-bold" onClick={() => applySize("a4-landscape")}>A4 أفقي</button>
            <button type="button" className="h-8 rounded-[8px] border border-line text-[11px] font-bold" onClick={() => applySize("a3-portrait")}>A3</button>
            <button type="button" className="h-8 rounded-[8px] border border-line text-[11px] font-bold" onClick={() => applySize("slide-16-9")}>عرض 16:9</button>
          </div>
          <p className="text-[10px] tabular-nums text-muted">
            {Math.round(size.w)} × {Math.round(size.h)} مم · {landscape ? "أفقي" : "عمودي"}
          </p>
        </div>
        <PageBackground page={page} />
        <label className="flex items-start gap-2 text-[11px] font-bold">
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
