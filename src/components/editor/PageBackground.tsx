import { PaintBucket, Trash2 } from "lucide-react";
import { pageSize, type Page } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { FillEditor } from "./ui/FillField";

/** Page paint is metadata, not a selectable/transformable layer. */
export function PageBackground({ page }: { page: Page }) {
  const setBackground = useEditor((s) => s.setPageBackground);
  const size = pageSize(page);
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
          title="حذف خلفية الصفحة"
          aria-label="حذف خلفية الصفحة"
          disabled={page.locked}
          onClick={() =>
            setBackground(page.id, { bg: "transparent", bgGradient: undefined })
          }
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="text-[10px] text-muted">
        Page Background · {size.w} × {size.h} مم
        <br />
        تعبئة كاملة حتى الحواف، خلف جميع العناصر.
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
    </section>
  );
}
