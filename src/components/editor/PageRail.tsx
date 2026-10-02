import { pageBackgroundCss, paintCss } from "@/lib/editor/gradient";
import { OPEN_PAGE_SETTINGS_EVENT } from "./PageSettingsDialog";
import { OPEN_NEW_PAGE_EVENT } from "./NewPageDialog";
import { memo, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { pageSize, type CanvasEl, type Page } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { clamp, cn } from "@/lib/utils";

export function PageRail({
  height = 112,
  minHeight = 96,
}: {
  height?: number;
  minHeight?: number;
}) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = () => window.dispatchEvent(new CustomEvent(OPEN_NEW_PAGE_EVENT));
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const deletePage = useEditor((s) => s.deletePage);
  const reorderPages = useEditor((s) => s.reorderPages);
  const renamePage = useEditor((s) => s.renamePage);
  const collapsed = useEditor((s) => s.pagesRailCollapsed);
  const togglePagesRail = useEditor((s) => s.togglePagesRail);

  const activeIndex = pages.findIndex((p) => p.id === activePageId);
  const scrollStageToPage = (pageId: string, center = false) => {
    const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
    const pageEl = stage?.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(pageId)}"]`,
    );
    if (stage && pageEl) {
      const cell = pageEl.closest<HTMLElement>(".artboard-cell") ?? pageEl;
      const sr = stage.getBoundingClientRect();
      const cr = cell.getBoundingClientRect();
      if (
        center ||
        cr.left < sr.left ||
        cr.right > sr.right ||
        cr.top < sr.top ||
        cr.bottom > sr.bottom
      ) {
        stage.scrollLeft += cr.left + cr.width / 2 - (sr.left + sr.width / 2);
        stage.scrollTop += cr.top + cr.height / 2 - (sr.top + sr.height / 2);
      }
    }
    itemRefs.current[pageId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  };

  const activatePage = (index: number) => {
    const page = pages[index];
    if (!page) return;
    setActivePage(page.id);
    requestAnimationFrame(() => scrollStageToPage(page.id, false));
  };

  const focusPage = (index: number) => {
    const page = pages[index];
    if (!page) return;
    setActivePage(page.id);
    useEditor.setState({ enteredGroupId: null, editingId: null });
    window.dispatchEvent(
      new CustomEvent("nasaq:fit-page", { detail: page.id }),
    );
    requestAnimationFrame(() => scrollStageToPage(page.id, true));
  };

  const thumbBox = (ratio: number) => {
    const chrome = 44;
    const available = Math.max(48, height - chrome);
    const floor = Math.max(40, minHeight - chrome);
    const h = clamp(Math.round(available), floor, 100);
    const w = clamp(Math.round(h * ratio), 34, 240);
    return { w, h };
  };

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const settingsTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    itemRefs.current[activePageId]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activePageId]);

  const startDrag = (index: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    setDragIndex(index);
    setOverIndex(index);

    const indexAt = (clientX: number, fallback: number) => {
      let best = fallback;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const [id, node] of Object.entries(itemRefs.current)) {
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const dist = Math.abs(clientX - (rect.left + rect.width / 2));
        if (dist < bestDist) {
          bestDist = dist;
          const found = pages.findIndex((p) => p.id === id);
          if (found >= 0) best = found;
        }
      }
      return best;
    };

    const move = (ev: PointerEvent) => {
      setOverIndex(indexAt(ev.clientX, index));
    };

    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const target = indexAt(ev.clientX, index);
      setDragIndex(null);
      setOverIndex(null);
      if (ev.type !== "pointercancel" && target !== index)
        reorderPages(index, target);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /*
   * Collapsed strip — a 1-line page rail. Every management action stays one
   * click away (the expand chevron), but the artboard keeps the height the
   * thumbnail tray was using. Chips show live page numbers; the active page
   * is highlighted.
   */
  if (collapsed) {
    return (
      <div className="editor-page-rail editor-page-rail-collapsed flex h-full min-h-0 items-center gap-1.5 border-t bg-surface px-2 overflow-hidden">
        <button
          type="button"
          onClick={() => togglePagesRail()}
          title="توسيع شريط الصفحات"
          aria-label="توسيع شريط الصفحات"
          aria-expanded={false}
          className="page-rail-nav grid size-7 shrink-0 place-items-center rounded-[7px] border border-line text-muted"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => addPage()}
          title="إضافة صفحة"
          aria-label="إضافة صفحة"
          className="page-rail-nav grid size-7 shrink-0 place-items-center rounded-[7px] bg-navy text-white"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
        <ul
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto editor-pane-scroll"
          dir="rtl"
        >
          {pages.map((p, i) => (
            <li key={p.id} className="shrink-0">
              <button
                type="button"
                onClick={() => activatePage(i)}
                onDoubleClick={() => focusPage(i)}
                aria-current={p.id === activePageId}
                title={`${p.name} — ${p.elements.length} عنصر`}
                className={cn(
                  "page-rail-chip grid h-7 min-w-7 shrink-0 place-items-center rounded-[7px] border px-1.5 text-[11px] font-extrabold tabular-nums transition-colors",
                  p.id === activePageId
                    ? "is-active border-navy-2 bg-navy-2/10 text-brand"
                    : "border-transparent text-muted hover:border-line",
                )}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ul>
        <span className="shrink-0 text-[10px] font-bold text-muted tabular-nums">
          {pages.length}
        </span>
      </div>
    );
  }

  return (
    <div className="editor-page-rail flex h-full min-h-0 items-stretch gap-2 border-t px-2 py-1 bg-surface overflow-hidden">
      {/*
       * One cell size for the whole rail control group — icon-only, named by
       * tooltip. Text labels would cost the rail's height budget for words a
       * hover already says.
       */}
      <div className="page-rail-controls flex shrink-0 flex-col justify-center gap-1">
        <button
          type="button"
          onClick={() => togglePagesRail()}
          title="تصغير شريط الصفحات — صف واحد من الأرقام"
          aria-label="تصغير شريط الصفحات"
          aria-expanded
          className="page-rail-nav grid size-8 place-items-center rounded-[8px] border border-line text-muted"
        >
          <ChevronUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => addPage()}
          title="إضافة صفحة"
          aria-label="إضافة صفحة"
          className="page-rail-nav grid size-8 place-items-center rounded-[8px] bg-navy text-white"
        >
          <Plus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => duplicatePage()}
          title="تكرار الصفحة الحالية كنسخة مطابقة — يشمل الإعدادات والعناصر"
          aria-label="تكرار الصفحة الحالية كنسخة مطابقة"
          className="page-rail-nav grid size-8 place-items-center rounded-[8px] border border-line text-muted"
        >
          <Copy className="size-4" aria-hidden />
        </button>
      </div>

      <button
        type="button"
        className="page-rail-nav grid size-8 shrink-0 place-items-center rounded-[8px] border border-line text-muted disabled:cursor-not-allowed disabled:opacity-35"
        onClick={() => activatePage(activeIndex - 1)}
        disabled={activeIndex <= 0}
        aria-label="الصفحة السابقة"
        title="الصفحة السابقة"
      >
        <ChevronRight className="size-4" aria-hidden />
      </button>

      <ul
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-hidden px-1 py-1 editor-pane-scroll"
        dir="rtl"
      >
        {pages.map((p, i) => {
          const size = pageSize(p);
          const ratio = size.w / size.h;
          const { w: thumbW, h: thumbH } = thumbBox(ratio);
          void size;
          const active = p.id === activePageId;
          return (
            <li
              key={p.id}
              ref={(n) => {
                itemRefs.current[p.id] = n;
              }}
              className={cn(
                "page-rail-item group relative flex items-center gap-1 shrink-0 rounded-lg border p-1",
                active ? "is-active" : "border-line",
                dragIndex === i && "opacity-50",
                overIndex === i &&
                  dragIndex !== null &&
                  dragIndex !== i &&
                  "drop-target",
              )}
              style={{ outlineOffset: "2px" }}
            >
              <div>
                <button
                  type="button"
                  aria-label={`${p.name} ${i + 1}`}
                  onClick={() => {
                    activatePage(i);
                  }}
                  onDoubleClick={() => {
                    focusPage(i);
                  }}
                  className="block rounded-lg text-right"
                  aria-current={active}
                  title="نقرة لاختيار الصفحة — نقرة مزدوجة لفتحها بوضوح في اللوحة"
                >
                  <PageThumb page={p} w={thumbW} h={thumbH} />
                </button>
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
                      className="w-[86px] rounded border border-navy-2 px-1 text-[10px] font-bold bg-surface-2"
                    />
                  ) : (
                    <span
                      className="truncate font-bold"
                      style={{ maxWidth: `${Math.max(48, thumbW)}px` }}
                      onClick={() => {
                        activatePage(i);
                        window.clearTimeout(settingsTimer.current);
                        settingsTimer.current = window.setTimeout(() => {
                          window.dispatchEvent(
                            new CustomEvent(OPEN_PAGE_SETTINGS_EVENT, {
                              detail: p.id,
                            }),
                          );
                        }, 220);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        window.clearTimeout(settingsTimer.current);
                        setRenaming(p.id);
                      }}
                      title="نقرة لإعدادات الصفحة — نقرتان لإعادة التسمية"
                    >
                      {p.name}
                    </span>
                  )}
                  <span
                    className={cn(
                      "grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 text-[9px] font-extrabold tabular-nums",
                      active
                        ? "page-rail-number-active"
                        : "bg-line-2 text-muted",
                    )}
                  >
                    {i + 1}
                  </span>
                </span>
              </div>

              <span className="page-rail-actions flex flex-col gap-0.5">
                <button
                  type="button"
                  onPointerDown={startDrag(i)}
                  title="اسحب لإعادة الترتيب"
                  aria-label={`إعادة ترتيب ${p.name}`}
                  className="drag-handle grid size-5 place-items-center rounded text-muted"
                >
                  <GripVertical className="size-3" />
                </button>
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deletePage(p.id)}
                    title="حذف الصفحة"
                    aria-label={`حذف ${p.name}`}
                    className="grid size-5 place-items-center rounded text-error"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="page-rail-nav grid size-8 shrink-0 place-items-center rounded-[8px] border border-line text-muted disabled:cursor-not-allowed disabled:opacity-35"
        onClick={() => activatePage(activeIndex + 1)}
        disabled={activeIndex < 0 || activeIndex >= pages.length - 1}
        aria-label="الصفحة التالية"
        title="الصفحة التالية"
      >
        <ChevronLeft className="size-4" aria-hidden />
      </button>
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

function isRound(el: CanvasEl) {
  if (el.type !== "shape") return false;
  const id = el.style?.shapeId || el.style?.shape || "";
  return id === "circle" || id === "ellipse" || id === "seal";
}

/**
 * A page's miniature. Memoized on the PAGE OBJECT's identity: an element edit
 * on page 3 rebuilds only page 3's miniature — the old render rebuilt every
 * page's colored boxes (up to 14 DOM nodes each) on every document write.
 */
const PageThumb = memo(function PageThumb({
  page,
  w,
  h,
}: {
  page: Page;
  w: number;
  h: number;
}) {
  const size = pageSize(page);
  return (
    <span
      className="page-thumbnail relative mb-1 block overflow-hidden rounded-md border border-line shadow-sm"
      style={{
        width: `${w}px`,
        height: `${h}px`,
        backgroundColor: page.bg || "#ffffff",
        backgroundImage: page.bgImage
          ? `url("${page.bgImage.replace(/"/g, "%22")}")`
          : pageBackgroundCss(page).startsWith("linear") ||
              pageBackgroundCss(page).startsWith("radial")
            ? pageBackgroundCss(page)
            : undefined,
        backgroundSize: page.bgImage
          ? page.bgImageFit === "contain"
            ? "contain"
            : "cover"
          : undefined,
        backgroundPosition: `${page.bgImageX ?? 50}% ${page.bgImageY ?? 50}%`,
        backgroundRepeat: "no-repeat",
      }}
    >
      {page.elements
        .slice()
        .sort((a, b) => a.z - b.z)
        .filter((el) => !el.hidden)
        .slice(0, 14)
        .map((el) => (
          <span
            key={el.id}
            className="absolute block"
            style={{
              left: `${(el.x / size.w) * 100}%`,
              top: `${(el.y / size.h) * 100}%`,
              width: `${(el.w / size.w) * 100}%`,
              height: `${(el.h / size.h) * 100}%`,
              background: paintCss(thumbnailColor(el), el.style?.gradient),
              borderRadius: isRound(el) ? "999px" : "1px",
            }}
          />
        ))}
    </span>
  );
});
