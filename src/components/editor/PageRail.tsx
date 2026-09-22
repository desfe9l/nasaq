import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, GripVertical, Maximize2, Minus, Plus, Trash2 } from "lucide-react";
import { pageSize, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { cn } from "@/lib/utils";

/**
 * Horizontal page rail with drag-and-drop reordering.
 *
 * Uses the pointer events API rather than HTML5 drag-and-drop: the rail lives
 * inside a scroll container and HTML5 DnD is unreliable in Safari there.
 */
export function PageRail() {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const reorderPages = useEditor((s) => s.reorderPages);
  const renamePage = useEditor((s) => s.renamePage);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [thumbScale, setThumbScale] = useState(1);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragIndex(index);
    setOverIndex(index);

    const move = (ev: PointerEvent) => {
      let target = index;
      for (const [id, node] of Object.entries(itemRefs.current)) {
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        // RTL rail: the first item sits at the highest x, so compare centres.
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          const found = pages.findIndex((p) => p.id === id);
          if (found >= 0) target = found;
          break;
        }
      }
      setOverIndex(target);
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      let target = index;
      for (const [id, node] of Object.entries(itemRefs.current)) {
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        if (ev.clientX >= rect.left && ev.clientX <= rect.right) {
          const found = pages.findIndex((p) => p.id === id);
          if (found >= 0) target = found;
          break;
        }
      }
      setDragIndex(null);
      setOverIndex(null);
      if (target !== index) reorderPages(index, target);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (collapsed) {
    return (
      <div className="editor-page-rail flex h-9 items-center justify-between border-t px-3 py-1">
        <span className="text-[11px] font-bold text-muted">{pages.length} صفحات — اللوحة مطوية</span>
        <button type="button" onClick={() => setCollapsed(false)} className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-line px-2 text-[11px] font-bold dark:border-white/10" title="إظهار لوحة الصفحات"><ChevronUp className="size-3.5" /> إظهار</button>
      </div>
    );
  }
  return (
    <div className="editor-page-rail flex h-[132px] items-stretch gap-2 border-t px-3 py-2">
      <div className="flex flex-col justify-center gap-1">
        <button
          type="button"
          onClick={() => addPage()}
          className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-navy px-2.5 text-[11px] font-extrabold text-white"
        >
          <Plus className="size-3.5" />
          صفحة
        </button>
        <button
          type="button"
          onClick={() => duplicatePage()}
          title="نسخ الصفحة الحالية"
          className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-line px-2.5 text-[11px] font-extrabold dark:border-white/10"
        >
          <Copy className="size-3.5" />
          نسخ
        </button>
        <div className="flex items-center gap-1 rounded-[6px] border border-line p-1 dark:border-white/10">
          <button type="button" onClick={() => setThumbScale((s) => Math.max(0.7, Math.round((s - 0.15)*100)/100))} className="grid size-6 place-items-center rounded hover:bg-line-2 dark:hover:bg-white/5" title="تصغير المصغرات"><Minus className="size-3" /></button>
          <span className="w-8 text-center text-[10px] tabular-nums">{Math.round(thumbScale*100)}%</span>
          <button type="button" onClick={() => setThumbScale((s) => Math.min(1.4, Math.round((s + 0.15)*100)/100))} className="grid size-6 place-items-center rounded hover:bg-line-2 dark:hover:bg-white/5" title="تكبير المصغرات"><Plus className="size-3" /></button>
        </div>
        <button type="button" onClick={() => setCollapsed(true)} className="inline-flex h-7 items-center justify-center gap-1 rounded-[6px] border border-line text-[10px] font-bold dark:border-white/10" title="طي لوحة الصفحات"><ChevronDown className="size-3" /> طي</button>
      </div>

      {/*
       * `px-1 py-1` is ring room, not decoration: the active page is marked by a
       * 2px ring with a 2px offset, and without padding those 4px were clipped
       * by this scroll container — the first/last thumbnail showed a cut ring.
       */}
      <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 py-1" dir="rtl">
        {pages.map((p, i) => {
          const size = pageSize(p);
          const ratio = size.w / size.h;
          const baseW = ratio >= 1 ? 92 : 62;
          const baseH = ratio >= 1 ? Math.round(92 / ratio) : 88;
          const thumbW = Math.round(baseW * thumbScale);
          const thumbH = Math.round(baseH * thumbScale);
          return (
            <li
              key={p.id}
              ref={(n) => {
                itemRefs.current[p.id] = n;
              }}
              className={cn(
                "group relative shrink-0 rounded-[8px] border p-1.5",
                // Active page: a clear gold ring around the thumbnail — the
                // same accent the canvas ring uses, so "you are here" reads
                // identically in both places.
                p.id === activePageId
                  ? "border-transparent ring-2 ring-gold ring-offset-2 ring-offset-white dark:ring-offset-[#111722]"
                  : "border-line dark:border-white/10",
                dragIndex === i && "opacity-50",
                overIndex === i && dragIndex !== null && dragIndex !== i && "drop-target",
              )}
            >
              <button
                type="button"
                onClick={() => setActivePage(p.id)}
                className="block"
                aria-current={p.id === activePageId}
              >
                <span
                  className="relative mb-1 block overflow-hidden rounded-[4px] border border-line bg-white"
                  style={{ width: `${thumbW}px`, height: `${thumbH}px` }}
                >
                  {p.elements
                    .slice()
                    .sort((a, b) => a.z - b.z)
                    .filter((el) => !el.hidden)
                    .slice(0, 14)
                    .map((el) => (
                      <span
                        key={el.id}
                        className="absolute block"
                        style={{
                          // Thumbnails are schematic: positions are scaled from
                          // page mm into the fixed thumbnail box.
                          position: "absolute",
                          left: `${(el.x / size.w) * 100}%`,
                          top: `${(el.y / size.h) * 100}%`,
                          width: `${(el.w / size.w) * 100}%`,
                          height: `${(el.h / size.h) * 100}%`,
                          background: thumbnailColor(el),
                          borderRadius: isRound(el) ? "999px" : "1px",
                        }}
                      />
                    ))}
                </span>
                <span className="flex items-center justify-between gap-1 text-[10px]">
                  {renaming === p.id ? (
                    <input
                      autoFocus
                      defaultValue={p.name}
                      aria-label="اسم الصفحة"
                      onBlur={(e) => {
                        renamePage(p.id, e.target.value.trim());
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-[86px] rounded border border-navy-2 px-1 text-[10px] font-bold dark:bg-white/5"
                    />
                  ) : (
                    <span
                      className="max-w-[86px] truncate font-bold"
                      onDoubleClick={() => setRenaming(p.id)}
                      title="انقر مرتين لإعادة التسمية"
                    >
                      {p.name}
                    </span>
                  )}
                  <span className="tabular-nums text-muted">{i + 1}</span>
                </span>
              </button>

              <span className="absolute top-0.5 left-0.5 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  onPointerDown={startDrag(i)}
                  title="اسحب لإعادة الترتيب"
                  aria-label={`إعادة ترتيب ${p.name}`}
                  className="drag-handle grid size-5 place-items-center rounded bg-white/90 text-muted shadow"
                >
                  <GripVertical className="size-3" />
                </button>
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(p.id)}
                    title="حذف الصفحة"
                    aria-label={`حذف ${p.name}`}
                    className="grid size-5 place-items-center rounded bg-white/90 text-danger shadow"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/45 p-4" role="dialog" aria-modal="true" aria-label="تأكيد حذف الصفحة">
          <div className="w-full max-w-xs rounded-[10px] bg-white p-4 shadow-xl dark:bg-[#161c26]">
            <strong className="text-[13px]">حذف الصفحة؟</strong>
            <p className="mt-1 text-[11px] leading-6 text-muted">سيتم حذف الصفحة وكل عناصرها نهائيًا. لا يمكن التراجع إلا بـ ⌘Z فورًا.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setConfirmDelete(null)} className="h-8 rounded-[6px] border border-line px-3 text-[11px] dark:border-white/10">إلغاء</button>
              <button type="button" onClick={() => { if (confirmDelete) deletePage(confirmDelete); setConfirmDelete(null); }} className="h-8 rounded-[6px] bg-red-600 px-3 text-[11px] font-bold text-white">حذف</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function thumbnailColor(el: CanvasEl) {
  const isLine = el.type === "line" || el.type === "divider";
  if (isLine) return el.style?.color || el.style?.fill || "#c9a86a";
  if (el.style?.fill) return el.style.fill;
  if (el.style?.background) return el.style.background;
  if (el.type === "image" || el.type === "logo") return "#dbe2ec";
  if (el.type === "table") return "#c7d0dd";
  if (el.style?.color) return el.style.color;
  return "#1f3556";
}

/** True for shapes whose silhouette is a circle/ellipse, drawn as a pill. */
function isRound(el: CanvasEl) {
  if (el.type !== "shape") return false;
  const id = el.style?.shapeId || el.style?.shape || "";
  return id === "circle" || id === "ellipse" || id === "seal";
}