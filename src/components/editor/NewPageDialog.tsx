import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { pageSize, SIZE_PRESETS, type SizeId } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";

export const OPEN_NEW_PAGE_EVENT = "nasaq:open-new-page";

const CHOICES: SizeId[] = ["a4-portrait", "a4-landscape", "a3-portrait", "slide-16-9"];

/** One chooser for every «صفحة جديدة» control. Duplicate stays a separate action. */
export function NewPageHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_NEW_PAGE_EVENT, show);
    return () => window.removeEventListener(OPEN_NEW_PAGE_EVENT, show);
  }, []);
  if (!open || typeof document === "undefined") return null;
  return createPortal(<NewPageDialog onClose={() => setOpen(false)} />, document.body);
}

function NewPageDialog({ onClose }: { onClose: () => void }) {
  const addPage = useEditor((s) => s.addPage);
  const page = useEditor((s) => s.pages.find((item) => item.id === s.activePageId));
  const size = pageSize(page);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = (request: Parameters<typeof addPage>[0]) => {
    addPage(request);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-label="صفحة جديدة"
        dir="rtl"
        className="editor-settings-surface grid w-[min(420px,100%)] gap-3 rounded-[12px] border border-line bg-surface p-4 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[14px] font-black">صفحة جديدة</h2>
          <button type="button" className="text-[12px] font-bold" onClick={onClose}>
            إغلاق
          </button>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          الصفحة الجديدة فارغة. نسخ المحتوى يتم فقط من «تكرار الصفحة».
        </p>
        <button
          type="button"
          className="rounded-[8px] border border-navy bg-navy/10 px-3 py-2 text-right"
          onClick={() => choose({ mode: "inherit" })}
        >
          <span className="block text-[12px] font-extrabold">نفس مقاس الصفحة الحالية واتجاهها</span>
          <span className="mt-0.5 block text-[10px] font-semibold text-muted tabular-nums">
            {Math.round(size.w)} × {Math.round(size.h)} مم · {size.w > size.h ? "أفقي" : "عمودي"} — دون نسخ العناصر
          </span>
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          {CHOICES.map((id) => {
            const preset = SIZE_PRESETS.find((item) => item.id === id);
            if (!preset) return null;
            return (
              <button
                key={id}
                type="button"
                className="rounded-[8px] border border-line px-2 py-2 text-right"
                onClick={() => choose({ mode: "preset", sizeId: id })}
              >
                <span className="block text-[11px] font-extrabold">{preset.name}</span>
                <span className="mt-0.5 block text-[10px] text-muted">{preset.desc}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
