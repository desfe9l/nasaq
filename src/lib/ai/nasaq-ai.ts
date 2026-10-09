/**
 * NASAQ AI — one layer, one voice.
 *
 * The editor already had real AI powers; what it did NOT have was ONE place
 * that knows them. `AiReportPanel` lived inside «أدوات التقرير»,
 * `SelectionAiActions` inside the properties dock, `ImageAiTools` on image
 * selections, heading generation behind its own dialog, the raw-content
 * pipeline on a site route. Every call re-explained the document, and none of
 * them shared a name.
 *
 * This module is that single name: `nasaq-ai`. It owns
 *
 *   · the capability list (the ONLY tabs the unified AI hub renders),
 *   · the open/toggle channel (window events, so any control — floating
 *     toolbar, dock, context menu, workspace — reaches the SAME panel),
 *   · the document-context reader: one pass over the live editor state that
 *     every capability receives, so an AI call from the editor always knows
 *     the page, the selection and the theme it was invoked from.
 *
 * It is deliberately a *coordination* layer, never a provider: calls still
 * run through `@/lib/ai/functions` and the intelligence pipeline, which keep
 * their Gemini adapter, licence gates, rate limits, sanitising and error
 * copy. Nothing here bypasses those boundaries.
 */

import type { CanvasEl, Page } from "@/lib/editor/model";

export type NasaqAiTab = "selection" | "report" | "image" | "generate" | "twin";

export interface NasaqAiCapability {
  id: NasaqAiTab;
  /** Compact Arabic label — the hub tab strip is icon-first. */
  label: string;
  /** One line explaining what the capability does to THIS document. */
  hint: string;
}

/** The unified capability set — one list, every entry point reads it. */
export const NASAQ_AI_CAPABILITIES: readonly NasaqAiCapability[] = [
  {
    id: "selection",
    label: "المحتوى المحدد",
    hint: "صياغة، تلخيص، توسيع، أو تحويل نص للعناصر المحددة — لا شيء يُلغى بنقرة واحدة.",
  },
  {
    id: "report",
    label: "تقرير ذكي",
    hint: "مسودة تقرير تفهم عنوان المستند وصفحاته الحالية، وتُدرج كعناصر قابلة للتعديل.",
  },
  {
    id: "image",
    label: "تحليل الصور",
    hint: "قراءة الصورة المحددة (OCR + وصف) ونصوص جاهزة للّصق في عناصر النص.",
  },
  {
    id: "generate",
    label: "توليد",
    hint: "من محتوى خام إلى مستند نَسَق كامل، عبر خط المنصة نفسه (قياس → تركيب → مراجعة).",
  },
  {
    id: "twin",
    label: "التوأم",
    hint: "يفهم الموجز، يطبّق دستور التصميم، وينشئ عناصر قابلة للتعديل مع مراجعة محدودة.",
  },
];

export const NASAQ_AI_TOGGLE_EVENT = "nasaq:toggle-ai";
export const NASAQ_AI_OPEN_EVENT = "nasaq:open-ai";

/** Open the hub; pass a capability to raise its tab (contextual triggers). */
export function openNasaqAi(tab?: NasaqAiTab) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NasaqAiTab | undefined>(NASAQ_AI_OPEN_EVENT, {
      detail: tab,
    }),
  );
}

/** The one trigger every surface (toolbar, dock, nav strip) shares. */
export function toggleNasaqAi(tab?: NasaqAiTab) {
  if (typeof window === "undefined") return;
  if (tab) return openNasaqAi(tab);
  window.dispatchEvent(new CustomEvent(NASAQ_AI_TOGGLE_EVENT));
}

export interface NasaqAiContext {
  documentTitle: string;
  theme: string;
  pageNo: number;
  pageCount: number;
  pageName: string;
  /** Selected elements on the active page, in selection order. */
  selection: { id: string; type: string; name: string; preview: string }[];
}

/** Flatten selection previews (pure — the hub and tests share one rule). */
export function selectionPreview(el: CanvasEl, limit = 90): string {
  const text = String(el.content ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, limit);
  if (el.type === "image" || el.type === "logo")
    return String(el.name || "صورة");
  if (el.type === "table") return "جدول";
  if (el.children?.length)
    return `مجموعة (${el.children.length} عنصر)`;
  return String(el.name || el.type);
}

/**
 * The context EVERY capability receives.
 *
 * `collect` is pure over the passed slices so it is testable without a store;
 * `collectNasaqAiContext` binds it to the live editor state at call time,
 * which is exactly what keeps an AI action invoked from the selection
 * operating on the selection rather than on some stale snapshot.
 */
export function nasaqAiContext(
  name: string,
  theme: string,
  pages: readonly Page[],
  activePageId: string,
  selectedIds: readonly string[],
): NasaqAiContext {
  const page =
    pages.find((p) => p.id === activePageId) ?? pages[0] ?? null;
  const elements = page ? page.elements : [];
  const picked = selectedIds;
  const find = (list: CanvasEl[], id: string): CanvasEl | null => {
    for (const el of list) {
      if (el.id === id) return el;
      if (el.children?.length) {
        const hit = find(el.children, id);
        if (hit) return hit;
      }
    }
    return null;
  };
  return {
    documentTitle: name,
    theme,
    pageNo: page ? pages.findIndex((p) => p.id === page.id) + 1 : 0,
    pageCount: pages.length,
    pageName: page?.name ?? "",
    selection: picked
      .map((id) => find(elements, id))
      .filter((el): el is CanvasEl => Boolean(el))
      .map((el) => ({
        id: el.id,
        type: el.type,
        name: el.name || el.type,
        preview: selectionPreview(el),
      })),
  };
}
