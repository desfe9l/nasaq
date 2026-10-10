/**
 * Intelligent template organization — content-derived naming, classification
 * and ordering.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Templates used to present whatever name they arrived with: a raw file name
 * from an import, «قالب ٣», an empty title, or a generator's internal id. The
 * catalogue then showed the same document twice under two names, in an order
 * nobody chose. A customer scanning the library had to open cards to learn what
 * they were.
 *
 * WHAT THIS DOES
 * --------------
 * Everything here is derived from the document itself — its real elements, its
 * real text, its real page geometry — never from a counter:
 *
 *   • `analyzeTemplate` reads the pages and reports what the document IS: its
 *     document type, purpose, language mix, size class, orientation and visual
 *     structure (columns, tables, charts, imagery, numbering).
 *   • `suggestTemplateName` turns that into a meaningful Arabic name of the
 *     form «تقرير سنوي — ملخص المؤشرات (A4 رأسي)» — never «Untitled», never a
 *     file name, never a number.
 *   • `suggestTemplateCategory` maps the analysis onto the platform's own
 *     categories, so an automatic filing is always a REAL category.
 *   • `orderTemplates` sorts a catalogue by meaning (family, then document
 *     type, then size, then the name), with an explicit author override always
 *     winning.
 *
 * The module is pure and dependency-light beyond the document model, so the
 * catalogue, the admin panel, the import service and the tests all agree.
 */

import {
  pageSize,
  sizeIdOf,
  type CanvasEl,
  type Page,
  type SizeId,
} from "@/lib/editor/model";
import type { TemplateCategoryId } from "@/lib/editor/templates";
import {
  canonicalCategoryId,
  isTemplatePlaceholderName,
  knownCategoryLabel,
  templateCategoryLabel,
} from "./naming";

/** Arabic words that identify the document family, most specific first. */
const TYPE_SIGNALS: { id: DocumentTypeId; label: string; patterns: RegExp[] }[] = [
  { id: "annual-report", label: "تقرير سنوي", patterns: [/تقرير\s*(ال)?سنوي/, /annual\s*report/i, /الحصاد\s*السنوي/] },
  { id: "quarterly-report", label: "تقرير ربع سنوي", patterns: [/ربع\s*سنوي/, /quarterly/i] },
  { id: "financial-report", label: "تقرير مالي", patterns: [/مالي|ميزانية|الميزانية|قوائم\s*مالية|إيرادات|مصروفات/] },
  { id: "progress-report", label: "تقرير إنجاز", patterns: [/إنجاز|الأداء|مؤشرات\s*الأداء|نسب\s*الإنجاز/] },
  { id: "letter", label: "خطاب رسمي", patterns: [/خطاب|تعميم|بسم\s*الله|المكرم|سعادة|وتفضلوا/] },
  { id: "minutes", label: "محضر اجتماع", patterns: [/محضر|اجتماع|الحضور|جدول\s*الأعمال|القرارات/] },
  { id: "proposal", label: "مقترح", patterns: [/مقترح|عرض\s*سعر|نطاق\s*العمل|المخرجات/] },
  { id: "plan", label: "خطة تشغيلية", patterns: [/خطة|خطط|المراحل|الجدول\s*الزمني|المبادرات/] },
  { id: "presentation", label: "عرض تقديمي", patterns: [/عرض|شرائح|presentation/i] },
  { id: "certificate", label: "شهادة", patterns: [/شهادة|تقدير|يمنح|تشهد/] },
  { id: "infographic", label: "إنفوجرافيك", patterns: [/إنفوجراف|infographic/i] },
  { id: "invoice", label: "فاتورة", patterns: [/فاتورة|مطالبة|سند\s*صرف/] },
  { id: "contract", label: "عقد", patterns: [/عقد|اتفاقية|الطرف\s*الأول|الطرف\s*الثاني/] },
  { id: "agenda", label: "جدول أعمال", patterns: [/جدول\s*الأعمال|أجندة/] },
  { id: "cover", label: "غلاف", patterns: [/غلاف|الجمهورية|المملكة\s*العربية|وزارة|هيئة|شركة/] },
];

export type DocumentTypeId =
  | "annual-report"
  | "quarterly-report"
  | "financial-report"
  | "progress-report"
  | "letter"
  | "minutes"
  | "proposal"
  | "plan"
  | "presentation"
  | "certificate"
  | "infographic"
  | "invoice"
  | "contract"
  | "agenda"
  | "cover"
  | "document";

/** The purpose a document serves, inferred from the same evidence. */
export type DocumentPurposeId =
  | "summary"
  | "analysis"
  | "record"
  | "correspondence"
  | "proposal"
  | "identity"
  | "data"
  | "general";

export type Orientation = "portrait" | "landscape" | "square";

export interface TemplateAnalysis {
  documentType: DocumentTypeId;
  documentTypeLabel: string;
  purpose: DocumentPurposeId;
  /** Fraction of text elements whose content is mostly Arabic (0–1). */
  arabicShare: number;
  language: "ar" | "mixed" | "latin";
  sizeId: SizeId;
  sizeLabel: string;
  orientation: Orientation;
  dimensions: { w: number; h: number };
  /** Visual structure, measured from the real elements. */
  structure: {
    columns: number;
    tables: number;
    charts: number;
    images: number;
    shapes: number;
    textBlocks: number;
    /** Elements per page — density, used for the ordering score. */
    density: number;
    hasNumbering: boolean;
    hasHeaderBand: boolean;
  };
  /** Words that appear most often in headings, longest-wins ties. */
  keywords: string[];
  /** A title read from the document's own cover/first-page heading, if any. */
  coverTitle: string;
  pages: number;
}

const PLACEHOLDER_FILE = /\.(json|svg|psd|png|jpe?g|webp|pdf|docx?|pptx?|nsq)$/i;
/** A name that is only a number, a counter, or a generic product word. */
const GENERIC_ONLY = /^(?:[\s._-]*(?:قالب|template|نسخة|copy|new|untitled|بدون\s*عنوان|قالب\s*جديد)[\s._-]*\d*[\s._-]*)$/i;

const STOPWORDS = new Set([
  "في", "من", "على", "إلى", "عن", "مع", "هذا", "هذه", "ذلك", "التي", "الذي",
  "كما", "بين", "بعد", "قبل", "كل", "أو", "و", "the", "and", "for", "with",
]);

/** Arabic letters share a Unicode range; anything else counts as Latin. */
function scriptShare(text: string): number {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const total = arabic + latin;
  return total === 0 ? 0 : arabic / total;
}

function elementText(el: CanvasEl): string {
  // Table content is a serialised matrix; its headings are still words.
  // Control characters are stripped with a Unicode class rather than a literal
  // range: the range form is a lint error, and the class says the same thing.
  return String(el.content ?? "").replace(/[\p{Cc}]+/gu, " ").trim();
}

function columnCount(elements: CanvasEl[]): number {
  /*
   * Columns are measured, not guessed: text blocks that share a vertical band
   * and are separated horizontally form a column set. Two bands is the smallest
   * count that means a layout is multi-column; one is a single column.
   */
  const texts = elements.filter((el) => el.type === "text" && el.w < 120);
  if (texts.length < 4) return 1;
  const sorted = [...texts].sort((a, b) => a.x - b.x);
  let bands = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w);
    if (gap > 8) bands += 1;
  }
  return Math.min(Math.max(bands, 1), 4);
}

function keywordsOf(pages: Page[]): string[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const el of page.elements ?? []) {
      const text = elementText(el);
      if (!text || text.length > 200) continue;
      for (const raw of text.split(/[\s،.:؛|/\\()«»"'—-]+/)) {
        const word = raw.trim();
        if (word.length < 4 || word.length > 18) continue;
        if (STOPWORDS.has(word)) continue;
        if (/^\d+$/.test(word)) continue;
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 6)
    .map(([word]) => word);
}

/** The heading a reader would call the document's title. */
function coverTitleOf(pages: Page[]): string {
  const first = pages[0];
  if (!first) return "";
  const candidates = (first.elements ?? [])
    .filter((el) => el.type === "text" || el.type === "stamp")
    .map((el) => ({ el, text: elementText(el) }))
    .filter(({ text }) => text && text.length >= 4 && text.length <= 90)
    .filter(({ text }) => scriptShare(text) > 0.5)
    .sort((a, b) => {
      // A title is set larger and sits higher on the page.
      const size = (b.el.style?.fontSize ?? 0) - (a.el.style?.fontSize ?? 0);
      if (Math.abs(size) > 0.6) return size;
      return a.el.y - b.el.y;
    });
  return candidates[0]?.text.replace(/\s+/g, " ").trim() ?? "";
}

const SIZE_CLASS_LABELS: Record<SizeId, string> = {
  "a4-portrait": "A4 رأسي",
  "a4-landscape": "A4 أفقي",
  "slide-16-9": "عرض 16:9",
  "a3-portrait": "A3 رأسي",
  custom: "مقاس مخصص",
};

/**
 * Read a document and report what it is.
 *
 * The analysis is deliberately conservative: when the evidence is thin, the
 * answer is the honest general one (`document`) rather than a confident wrong
 * classification that would file a letter under «تقارير».
 */
export function analyzeTemplate(pages: Page[]): TemplateAnalysis {
  const all: CanvasEl[] = [];
  for (const page of pages) all.push(...(page.elements ?? []));

  const textAll = all.map(elementText).filter(Boolean);
  const haystack = textAll.join(" ").slice(0, 20_000);
  const arabicShare =
    textAll.length === 0
      ? 0
      : textAll.reduce((sum, text) => sum + scriptShare(text), 0) / textAll.length;

  let documentType: DocumentTypeId = "document";
  let documentTypeLabel = "مستند";
  for (const signal of TYPE_SIGNALS) {
    if (signal.patterns.some((pattern) => pattern.test(haystack))) {
      documentType = signal.id;
      documentTypeLabel = signal.label;
      break;
    }
  }

  const tables = all.filter((el) => el.type === "table").length;
  // «المؤشرات» — the element types that actually carry a number to the reader.
  const charts = all.filter(
    (el) => el.type === "stat" || el.type === "progress",
  ).length;
  const images = all.filter((el) => el.type === "image" || el.type === "logo" || el.type === "qr").length;
  const shapes = all.filter((el) => el.type === "shape" || el.type === "svg").length;
  const textBlocks = all.filter((el) => el.type === "text" || el.type === "box").length;
  const dimensions = pageSize(pages[0]);
  const ratio = dimensions.w / dimensions.h;
  const orientation: Orientation =
    Math.abs(ratio - 1) < 0.05 ? "square" : ratio > 1 ? "landscape" : "portrait";
  const hasNumbering = /صفحة\s*\d|رقم\s*الصفحة|\{رقم_الصفحة/.test(haystack);
  const hasHeaderBand = (pages[0]?.elements ?? []).some(
    (el) => (el.type === "shape" || el.type === "box") && el.y < 30 && el.w > dimensions.w * 0.5,
  );

  const purpose: DocumentPurposeId =
    documentType === "letter" || documentType === "contract" || documentType === "invoice"
      ? "correspondence"
      : documentType === "proposal"
        ? "proposal"
        : documentType === "minutes"
          ? "record"
          : documentType === "cover" || documentType === "certificate"
            ? "identity"
            : tables + charts >= 3
              ? "data"
              : documentType === "annual-report" ||
                  documentType === "quarterly-report" ||
                  documentType === "financial-report" ||
                  documentType === "progress-report"
                ? charts + tables > 0
                  ? "analysis"
                  : "summary"
                : "general";

  return {
    documentType,
    documentTypeLabel,
    purpose,
    arabicShare,
    language: arabicShare > 0.7 ? "ar" : arabicShare < 0.3 ? "latin" : "mixed",
    sizeId: sizeIdOf(pages[0]),
    sizeLabel: SIZE_CLASS_LABELS[sizeIdOf(pages[0])],
    orientation,
    dimensions,
    structure: {
      columns: columnCount(all),
      tables,
      charts,
      images,
      shapes,
      textBlocks,
      density: pages.length ? Math.round(all.length / pages.length) : 0,
      hasNumbering,
      hasHeaderBand,
    },
    keywords: keywordsOf(pages),
    coverTitle: coverTitleOf(pages),
    pages: pages.length,
  };
}

/** The category the analysis files a template under — always a real category. */
export function suggestTemplateCategory(analysis: TemplateAnalysis): TemplateCategoryId {
  const { documentType, structure } = analysis;
  switch (documentType) {
    case "cover":
      return "covers";
    case "presentation":
      return "slides";
    case "certificate":
      return "institutional";
    case "infographic":
      return "infographics";
    case "minutes":
    case "agenda":
      return "editorial";
    case "plan":
      return "timeline";
    case "letter":
    case "contract":
    case "invoice":
      return "editorial";
    case "annual-report":
    case "quarterly-report":
    case "financial-report":
      return "reports";
    case "progress-report":
      return "kpis";
    default:
      break;
  }
  if (structure.tables >= 2) return "tables";
  if (structure.charts >= 3) return "stats";
  if (structure.columns >= 3) return "data";
  if (analysis.orientation === "landscape") return "slides";
  return "inner";
}

/**
 * A meaningful Arabic name for a document.
 *
 * The shape is «نوع المستند — ما يميّزه»، with the format appended only when it
 * is a real distinction (a slide deck named as a report is a worse name than a
 * long one). `hints` lets a caller supply grounded context it already has — an
 * organisation name, a pack title — which is preferred over a keyword guess.
 */
export function suggestTemplateName(
  analysis: TemplateAnalysis,
  hints: { organization?: string; pack?: string; fallbackKind?: string } = {},
): string {
  const base = analysis.documentTypeLabel;
  const org = (hints.organization ?? "").replace(/\s+/g, " ").trim();

  /*
   * The distinguishing half. Preference order is evidence strength:
   *   1. a real title read from the document's own cover;
   *   2. a supplied organisation / pack name (grounded context);
   *   3. the document's most repeated heading word.
   */
  let qualifier = "";
  const cover = analysis.coverTitle.replace(/\s+/g, " ").trim();
  if (cover && cover.length >= 6 && cover.length <= 60 && !GENERIC_ONLY.test(cover)) {
    // A cover heading usually already contains the type («تقرير…»): keep the
    // complement so the name does not repeat itself.
    qualifier = cover.includes(base) ? cover.replace(base, "").replace(/^[\s—–:-]+/, "") : cover;
  }
  if (!qualifier && org) qualifier = org;
  if (!qualifier && hints.pack) qualifier = hints.pack;
  if (!qualifier && analysis.keywords.length) qualifier = analysis.keywords[0];

  const parts = [base];
  if (qualifier) parts.push(qualifier);
  let name = parts.join(" — ");

  // The format is worth naming only where it changes the reader's expectation.
  const format = analysis.sizeLabel;
  const namesFormat = /A4|A3|16:9|مخصص/.test(format);
  if (namesFormat && !name.includes(format) && analysis.sizeId !== "a4-portrait") {
    name = `${name} (${format})`;
  }

  if (name.length > 90) name = `${name.slice(0, 87).trimEnd()}…`;
  if (!name.trim() || isTemplatePlaceholderName(name)) {
    return hints.fallbackKind ? `${base} — ${hints.fallbackKind}` : `${base} جاهز`;
  }
  return name;
}

/** True when a stored name is one the product must never show. */
export function needsGeneratedName(value: unknown): boolean {
  const name = String(value ?? "").trim();
  if (!name) return true;
  if (isTemplatePlaceholderName(name)) return true;
  if (GENERIC_ONLY.test(name)) return true;
  if (PLACEHOLDER_FILE.test(name)) return true;
  // A bare id or hash: `tpl_ab12…`, `builtin_page_cover`, `a1b2c3d4`.
  if (/^[a-z0-9_-]{8,}$/i.test(name) && /[_-]|\d/.test(name)) return true;
  return false;
}

export interface OrderedTemplate {
  /** Author-managed position; `null`/absent means "let the analysis decide". */
  sortOrder?: number | null;
  title: string;
  category?: string | null;
  pages: Page[];
}

/**
 * Order a catalogue by meaning.
 *
 * An author's explicit position always wins — that is what an override IS. Ties
 * are broken by family (so related documents sit together), then by page count
 * and density (a cover before a report, a report before an annex), then by the
 * Arabic name, so the order is stable between renders and deployments.
 */
export function orderTemplates<T extends OrderedTemplate>(entries: T[]): T[] {
  const analysed = entries.map((entry) => ({
    entry,
    analysis: analyzeTemplate(entry.pages),
  }));
  return analysed
    .sort((a, b) => {
      const ao = a.entry.sortOrder;
      const bo = b.entry.sortOrder;
      const aHas = typeof ao === "number" && Number.isFinite(ao);
      const bHas = typeof bo === "number" && Number.isFinite(bo);
      if (aHas && bHas && ao !== bo) return (ao as number) - (bo as number);
      if (aHas !== bHas) return aHas ? -1 : 1;
      const family = a.analysis.documentType.localeCompare(b.analysis.documentType);
      if (family !== 0) return family;
      if (a.analysis.pages !== b.analysis.pages)
        return a.analysis.pages - b.analysis.pages;
      if (a.analysis.structure.density !== b.analysis.structure.density)
        return a.analysis.structure.density - b.analysis.structure.density;
      return a.entry.title.localeCompare(b.entry.title, "ar");
    })
    .map((item) => item.entry);
}

/** A one-line, reader-facing summary of what a template is. */
export function analysisSummary(analysis: TemplateAnalysis): string {
  const bits: string[] = [analysis.documentTypeLabel];
  if (analysis.pages > 1) bits.push(`${analysis.pages} صفحات`);
  bits.push(analysis.sizeLabel);
  if (analysis.structure.tables) bits.push(`${analysis.structure.tables} جدول`);
  if (analysis.structure.charts) bits.push(`${analysis.structure.charts} مؤشر`);
  return bits.join(" · ");
}

/**
 * The category a template should display.
 *
 * An administrator's real override wins — always. When the stored value is
 * free text the analysis still decides which FILTER it answers to, because a
 * filter can only be an id the catalogue knows, while the administrator's own
 * Arabic wording is kept as the label on the card.
 */
export function resolveCategory(
  stored: unknown,
  analysis: TemplateAnalysis,
): { id: TemplateCategoryId; title: string; derived: boolean } {
  const value = String(stored ?? "").trim();
  const derivedId = suggestTemplateCategory(analysis);
  /* 1. A real filter id: the administrator's override wins, unchanged. */
  const canonical = canonicalCategoryId(value);
  if (canonical) {
    return {
      id: canonical as TemplateCategoryId,
      title: knownCategoryLabel(canonical) || value,
      derived: false,
    };
  }
  /*
   * 2. Free text the author typed: their wording stays the card's label, while
   * the analysis decides which FILTER the template answers to — a filter can
   * only be an id the catalogue knows.
   */
  if (value) {
    return { id: derivedId, title: templateCategoryLabel(value), derived: false };
  }
  /* 3. Nothing stored: both the label and the filter are derived. */
  return { id: derivedId, title: templateCategoryLabel(derivedId), derived: true };
}
