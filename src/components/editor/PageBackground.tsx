import { ImagePlus, PaintBucket, Trash2 } from "lucide-react";
import { useRef } from "react";
import { pageSize, type Page } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { FillEditor } from "./ui/FillField";

/** Store the picked background as-is. Size is not reduced. */
async function pageImageDataUrl(file: File): Promise<string> {
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("image"));
    reader.readAsDataURL(file);
  });
}

/** Page paint is metadata, not a selectable/transformable layer. */
export function PageBackground({ page }: { page: Page }) {
  const setBackground = useEditor((s) => s.setPageBackground);
  const fileRef = useRef<HTMLInputElement>(null);
  const size = pageSize(page);
  const fit = page.bgImageFit === "contain" ? "contain" : "cover";
  return (
    <section
      className="page-background-properties grid gap-3 rounded-[8px] border border-line p-3"
      aria-label="خلفية الصفحة"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px] font-bold">
          <PaintBucket className="size-4" />
          خلفية الصفحة
        </div>
        <button
          type="button"
          className="editor-icon-btn"
          title="حذف لون الخلفية"
          aria-label="حذف لون الخلفية"
          disabled={page.locked}
          onClick={() =>
            setBackground(page.id, { bg: "transparent", bgGradient: undefined })
          }
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="text-[10px] text-muted">
        {size.w} × {size.h} مم — تعبئة حتى الحواف، خلف العناصر، وليست طبقة قابلة للتحديد.
      </div>
      <fieldset disabled={page.locked} className="min-w-0">
        <FillEditor
          value={page.bg || "#ffffff"}
          gradient={page.bgGradient}
          fallback="#ffffff"
          onChange={(bg, bgGradient) =>
            setBackground(page.id, { bg, bgGradient }, true)
          }
          onCommit={(bg, bgGradient) =>
            setBackground(page.id, { bg, bgGradient })
          }
        />
      </fieldset>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-bold">صورة الخلفية</span>
          {page.bgImage && (
            <button
              type="button"
              className="text-[11px] font-bold text-muted"
              disabled={page.locked}
              onClick={() => setBackground(page.id, { bgImage: "" })}
            >
              إزالة الصورة
            </button>
          )}
        </div>
        <button
          type="button"
          disabled={page.locked}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold"
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus className="size-3.5" />
          {page.bgImage ? "استبدال الصورة" : "اختيار صورة"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void pageImageDataUrl(file)
              .then((bgImage) => {
                if (bgImage) setBackground(page.id, { bgImage, bgImageFit: fit });
              })
              .catch(() => undefined);
          }}
        />
        {page.bgImage && (
          <div className="flex gap-1" role="group" aria-label="ملاءمة صورة الخلفية">
            {(
              [
                ["cover", "تعبئة دون تشويه"],
                ["contain", "إظهار الصورة كاملة"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={page.locked}
                aria-pressed={fit === id}
                className="h-8 flex-1 rounded-[8px] border border-line text-[11px] font-bold aria-pressed:border-navy-2 aria-pressed:text-brand"
                onClick={() => setBackground(page.id, { bgImageFit: id })}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-start gap-2 text-[11px] font-bold">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={page.locked}
            checked={Boolean(page.clipContent)}
            onChange={(event) =>
              setBackground(page.id, { clipContent: event.target.checked })
            }
          />
          <span>
            إخفاء ما يخرج عن الصفحة أثناء التحرير
            <span className="mt-0.5 block font-semibold text-muted">
              العناصر تبقى محفوظة، ويُقص ظهورها فقط.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
