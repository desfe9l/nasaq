import { useRef, useState } from "react";
import { Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { pageSize, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { clamp, cn } from "@/lib/utils";

/**
 * Horizontal page rail with drag-and-drop reordering.
 *
 * Uses the pointer events API rather than HTML5 drag-and-drop: the rail lives
 * inside a scroll container and HTML5 DnD is unreliable in Safari there.
 */
export function PageRail({ height = 152, minHeight = 96 }: { height?: number; minHeight?: number }) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const reorderPages = useEditor((s) => s.reorderPages);
  const renamePage = useEditor((s) => s.renamePage);

  /*
   * Fluid thumbnails (Phase 3).
   *
   * The panel is drag-resizable, so the thumbnail size is DERIVED from the
   * available height rather than hard-coded: the box keeps the page's own
   * aspect ratio (width follows height through `ratio`) and simply scales with
   * the panel. Nothing is ever squashed or stretched, and the row scrolls
   * horizontally once the pages no longer fit.
   */
  const thumbBox = (ratio: number) => {
    // Strip the chrome around the thumbnail: labels, padding, drag chips.
    // p-2 card padding + 2px border + label row + ring room inside the rail.
    const chrome = 60;
    const available = Math.max(48, height - chrome);
    const floor = Math.max(40, minHeight - chrome);
    const h = clamp(Math.round(available), floor, 220);
    const w = clamp(Math.round(h * ratio), 34, 240);
    return { w, h };
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
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

  return (
    <div className="editor-page-rail flex h-full min-h-0 items-stretch gap-4 border-t px-4 py-2">
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
      </div>

      {/*
       * `px-1 py-1` is ring room, not decoration: the active page is marked by a
       * 2px ring with a 2px offset, and without padding those 4px were clipped
       * by this scroll container — the first/last thumbnail showed a cut ring.
       */}
      <ul className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto overflow-y-hidden px-2 py-2" dir="rtl">
        {pages.map((p, i) => {
          const size = pageSize(p);
          const ratio = size.w / size.h;
          const { w: thumbW, h: thumbH } = thumbBox(ratio);
          return (
            <li
              key={p.id}
              ref={(n) => {
                itemRefs.current[p.id] = n;
              }}
              className={cn(
                /*
                 * One self-contained card: preview, page number, border and
                 * active state all live INSIDE this box. The active ring has no
                 * offset (an offset ring drew outside the card and was clipped
                 * by the scroll container into a stray "( )"), and the rail's
                 * own padding leaves room for the 2px ring on every side.
                 */
                "group relative shrink-0 rounded-xl border-2 p-2 transition-all",
                p.id === activePageId
                  ? "border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/30"
                  : "border-line hover:border-emerald-500/40 dark:border-white/10",
                dragIndex === i && "opacity-50",
                overIndex === i && dragIndex !== null && dragIndex !== i && "drop-target",
              )}
            >
              <button
                type="button"
                onClick={() => setActivePage(p.id)}
                className="block rounded-lg text-right"
                aria-current={p.id === activePageId}
              >
                <span
                  className="relative mb-1.5 block overflow-hidden rounded-md border border-line bg-white shadow-sm"
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
                <span className="flex items-center justify-between gap-1 text-[10px] leading-tight">
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
                      className="truncate font-bold"
                      style={{ maxWidth: `${Math.max(48, thumbW)}px` }}
                      onDoubleClick={() => setRenaming(p.id)}
                      title="انقر مرتين لإعادة التسمية"
                    >
                      {p.name}
                    </span>
                  )}
                  <span
                    className={cn(
                      "grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[9px] font-extrabold tabular-nums",
                      p.id === activePageId ? "bg-emerald-500 text-white" : "bg-line-2 text-muted dark:bg-white/10",
                    )}
                  >
                    {i + 1}
                  </span>
                </span>
              </button>

              <span className="absolute top-1 left-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
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
                    onClick={() => deletePage(p.id)}
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