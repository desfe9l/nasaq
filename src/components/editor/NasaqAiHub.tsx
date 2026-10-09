import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  Image as ImageIcon,
  Link2,
  Sparkles,
  TextSelect,
  Wand2,
  X,
} from "lucide-react";
import { AiReportPanel } from "./AiReportPanel";
import { DesignTwinPanel } from "./DesignTwinPanel";
import { ImageAiTools } from "./ImageAiTools";
import { SelectionAiActions } from "./SelectionAiActions";
import {
  NASAQ_AI_OPEN_EVENT,
  NASAQ_AI_TOGGLE_EVENT,
  NASAQ_AI_CAPABILITIES,
  nasaqAiContext,
  type NasaqAiTab,
} from "@/lib/ai/nasaq-ai";
import { createPathFor } from "@/lib/site-routes";
import { useEditor } from "@/lib/editor/store";
import { findElement, type CanvasEl } from "@/lib/editor/model";
import { cn } from "@/lib/utils";

const TAB_ICONS: Record<NasaqAiTab, typeof FileText> = {
  selection: TextSelect,
  report: FileText,
  image: ImageIcon,
  generate: Wand2,
  twin: Sparkles,
};

function pickAiTarget(
  els: CanvasEl[],
  ids: readonly string[],
  types: string[],
): CanvasEl | null {
  for (const id of ids) {
    const hit = findElement(els, id)?.el;
    if (hit && types.includes(hit.type)) return hit;
  }
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el && types.includes(el.type) && !el.hidden) return el;
  }
  return null;
}

/**
 * «نَسَق AI» — the one AI window of the editor.
 *
 * Every capability the platform already has (report drafting, selection
 * transforms, image analysis/OCR, raw-content generation) opens HERE, in one
 * compact floating panel that follows the dock rules: opens on demand, closes
 * with Esc, never steals the artboard, and always shows which document and
 * selection it is working on. The components inside are the SAME ones the
 * floating controls and the properties dock reach — one system, several doors.
 */
export function NasaqAiHub() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NasaqAiTab>("selection");
  const documentTitle = useEditor((s) => s.name);
  const theme = useEditor((s) => s.theme);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);

  useEffect(() => {
    const openTo = (event: Event) => {
      const detail = (event as CustomEvent<NasaqAiTab | undefined>).detail;
      if (detail && NASAQ_AI_CAPABILITIES.some((c) => c.id === detail))
        setTab(detail);
      else if (!detail) setTab((t) => t);
      setOpen(true);
    };
    const toggle = () => setOpen((v) => !v);
    window.addEventListener(NASAQ_AI_OPEN_EVENT, openTo);
    window.addEventListener(NASAQ_AI_TOGGLE_EVENT, toggle);
    return () => {
      window.removeEventListener(NASAQ_AI_OPEN_EVENT, openTo);
      window.removeEventListener(NASAQ_AI_TOGGLE_EVENT, toggle);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const page = useMemo(
    () => pages.find((p) => p.id === activePageId) ?? pages[0] ?? null,
    [pages, activePageId],
  );
  const context = useMemo(
    () =>
      nasaqAiContext(documentTitle, theme, pages, activePageId, selectedIds),
    [documentTitle, theme, pages, activePageId, selectedIds],
  );
  const textTarget = useMemo(
    () =>
      page
        ? pickAiTarget(
            page.elements,
            selectedIds,
            ["text", "box", "stat", "stamp"],
          )
        : null,
    [page, selectedIds],
  );
  const imageTarget = useMemo(
    () => (page ? pickAiTarget(page.elements, selectedIds, ["image", "logo"]) : null),
    [page, selectedIds],
  );

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      dir="rtl"
      role="dialog"
      aria-label="نَسَق AI"
      data-editor-obstacle="float"
      className="fixed z-[var(--z-dialog,70)] top-14 right-3 w-[min(360px,calc(100vw-24px))] max-h-[calc(100vh-96px)] overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl flex flex-col"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2 text-[12.5px] font-black">
          <Wand2 className="size-4 text-brand" aria-hidden />
          نَسَق AI
        </span>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-[8px] text-muted hover:bg-surface-2"
          aria-label="إغلاق نَسَق AI"
          title="إغلاق · Esc"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </button>
      </header>

      {/* The context line: what the model is looking at, always visible. */}
      <p className="shrink-0 border-b border-line bg-surface-2/50 px-3 py-1.5 text-[10px] font-bold leading-4 text-muted">
        {context.documentTitle || "مستند بدون اسم"} — صفحة {context.pageNo}/{context.pageCount}
        {context.selection.length
          ? ` · ${context.selection.length} عنصر محدد`
          : " · لا تحديد — يعمل على آخر عنصر مناسب"}
      </p>

      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto px-2 py-1.5"
        role="tablist"
        aria-label="قدرات نَسَق AI"
      >
        {NASAQ_AI_CAPABILITIES.map((capability) => {
          const Icon = TAB_ICONS[capability.id];
          const active = tab === capability.id;
          return (
            <button
              key={capability.id}
              type="button"
              role="tab"
              aria-selected={active}
              title={`${capability.label} — ${capability.hint}`}
              onClick={() => setTab(capability.id)}
              className={cn(
                "grid h-8 min-w-8 shrink-0 place-items-center rounded-[8px] border px-2 text-[10px] font-extrabold transition",
                active
                  ? "border-navy-2 bg-navy text-on-brand"
                  : "border-transparent text-muted hover:border-line hover:bg-surface-2",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon className="size-3.5" aria-hidden />
                {capability.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="editor-pane-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "report" && <AiReportPanel />}
        {tab === "selection" &&
          (textTarget ? (
            <SelectionAiActions el={textTarget} />
          ) : (
            <p className="rounded-[8px] border border-line bg-surface-2/40 p-3 text-[11px] leading-5 text-muted">
              حدّد عنصراً نصياً على اللوحة أولاً — سيعمل الذكاء على محتواه
              تحديداً، ويُبقي بقية المستند دون تغيير.
            </p>
          ))}
        {tab === "image" &&
          (imageTarget && page ? (
            <ImageAiTools el={imageTarget} pageId={page.id} />
          ) : (
            <p className="rounded-[8px] border border-line bg-surface-2/40 p-3 text-[11px] leading-5 text-muted">
              حدّد صورة على اللوحة (أو أضف واحدة) لتفعيل التحليل وقراءة النص —
              النتائج تُدرج كعناصر نص قابلة للتعديل.
            </p>
          ))}
        {tab === "generate" && (
          <div className="grid gap-2">
            <p className="text-[11px] leading-5 text-muted">
              خط توليد نَسَق نفسه — قياس، تركيب، مراجعة — ينتج مستنداً كاملاً
              بمقاس A4 وعناصر قابلة للتعديل، لا صورة مسطحة.
            </p>
            <a
              href={createPathFor({ start: "ai" })}
              className="editor-mini-btn justify-center gap-1.5 border border-line px-3 py-2 text-[12px] font-extrabold"
              title="يفتح مسار الإنشاء بمسح المحتوى الخام"
            >
              <Link2 className="size-3.5" aria-hidden />
              محتوى خام → مستند نَسَق
            </a>
            <p className="text-[10px] leading-4 text-muted">
              يحترم حدود الترخيص وحدود الاستخدام نفسها التي يحترمها المحرر.
            </p>
          </div>
        )}
        {tab === "twin" && <DesignTwinPanel />}
      </div>
    </div>,
    document.body,
  );
}
