import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FilePlus2, Sparkles, X } from "lucide-react";
import { pageSize, SIZE_PRESETS, type SizeId } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

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
    <div
      className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-scrim p-4 backdrop-blur-xs"
      onPointerDown={onClose}
    >
      <div
        role="dialog"
        aria-label="صفحة جديدة"
        dir="rtl"
        className="editor-settings-surface grid w-[min(440px,100%)] gap-3.5 rounded-2xl border border-line bg-surface p-5 shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-navy/10 text-brand">
              <FilePlus2 className="size-4" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-[14px] font-black text-ink">إضافة صفحة جديدة</h2>
              <p className="text-[11px] font-medium text-muted">
                صفحة فارغة جاهزة للرسم والتحرير
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            className="grid size-8 place-items-center rounded-xl border border-line/60 text-muted transition hover:bg-line-2 hover:text-ink"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Inherit current page option */}
        <button
          type="button"
          className="flex items-center justify-between gap-3 rounded-xl border border-brand/50 bg-navy/[0.05] p-3 text-right transition hover:bg-navy/[0.09]"
          onClick={() => choose({ mode: "inherit" })}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-brand" />
              <span className="text-[12px] font-extrabold text-ink">
                نفس مقاس الصفحة الحالية واتجاهها
              </span>
            </div>
            <span className="mt-1 block text-[10.5px] font-semibold text-muted tabular-nums">
              {Math.round(size.w)} × {Math.round(size.h)} مم · {size.w > size.h ? "أفقي" : "عمودي"} — دون نسخ العناصر
            </span>
          </div>
          <span className="rounded-lg bg-navy px-2.5 py-1 text-[11px] font-extrabold text-on-brand shadow-xs">
            اختيار
          </span>
        </button>

        {/* Standard Presets */}
        <div>
          <span className="mb-2 block text-[11px] font-extrabold text-muted">
            أو اختر مقاساً معيارياً:
          </span>
          <div className="grid grid-cols-2 gap-2">
            {CHOICES.map((id) => {
              const preset = SIZE_PRESETS.find((item) => item.id === id);
              if (!preset) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className="rounded-xl border border-line bg-surface p-2.5 text-right transition hover:border-brand/50 hover:bg-surface-2"
                  onClick={() => choose({ mode: "preset", sizeId: id })}
                >
                  <span className="block text-[11.5px] font-extrabold text-ink">{preset.name}</span>
                  <span className="mt-0.5 block text-[10px] text-muted">{preset.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
