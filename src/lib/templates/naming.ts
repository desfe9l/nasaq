/**
 * Professional, Arabic-first default names for templates.
 *
 * Titles entered by a person remain untouched. Automatic names are derived
 * from the actual source name, template category, document metadata, content,
 * language and format; this module intentionally has no server or UI deps so
 * imports, the Admin catalog and local template saves use the same rules.
 */

export interface TemplateNamingContext {
  title?: unknown;
  /** True only when the title field was explicitly edited by the author. */
  titleIsManual?: boolean;
  /** Original source file name, when the template came from an upload/import. */
  sourceName?: unknown;
  description?: unknown;
  category?: unknown;
  kind?: unknown;
  format?: unknown;
  /** JSON project/template payload, structured pages, or plain content. */
  content?: unknown;
}

const FILE_EXTENSION = /\.(?:docx|pptx|ppt|pdf|png|jpe?g|webp|gif|svg|json|nsq|psd|psb|ai|indd|xlsx|xls|csv)$/i;
const TITLE_LIMIT = 120;

const CATEGORY_LABELS: Record<string, string> = {
  covers: "أغلفة التقارير",
  reports: "تقارير رسمية",
  inner: "صفحات داخلية",
  stats: "إحصائيات",
  tables: "جداول",
  kpis: "مؤشرات أداء",
  infographics: "إنفوجرافيك",
  slides: "عروض تقديمية",
  editorial: "قوالب تحريرية",
  institutional: "قوالب مؤسسية",
  data: "قوالب بيانات",
  executive: "قوالب تنفيذية",
  section: "فواصل الأقسام",
  timeline: "مخططات المراحل",
  general: "قوالب مؤسسية",
  import: "مستندات محوّلة",
  psd: "تصاميم محوّلة",
};

const KNOWN_CATEGORIES = new Map<string, string>([
  ...Object.entries(CATEGORY_LABELS).map(([key, label]) => [key, label] as const),
  ["أغلفة التقارير", "أغلفة التقارير"],
  ["تقارير", "تقارير رسمية"],
  ["تقارير رسمية", "تقارير رسمية"],
  ["صفحات داخلية", "صفحات داخلية"],
  ["إحصائيات", "إحصائيات"],
  ["جداول", "جداول"],
  ["مؤشرات", "مؤشرات أداء"],
  ["مؤشرات أداء", "مؤشرات أداء"],
  ["عروض", "عروض تقديمية"],
  ["عروض تقديمية", "عروض تقديمية"],
  ["مؤسسية", "قوالب مؤسسية"],
  ["تنفيذية", "قوالب تنفيذية"],
  ["عام", "قوالب مؤسسية"],
]);

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || "";
}

function sourceStem(value: string): string {
  return basename(value).replace(FILE_EXTENSION, "").replace(/\s+/g, " ").trim();
}

function comparable(value: string): string {
  return sourceStem(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_.-]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** These are never useful template names, even if they were saved previously. */
export function isTemplatePlaceholderName(value: unknown): boolean {
  const text = asText(value)
    .replace(FILE_EXTENSION, "")
    .replace(/[\s_\-#]+/g, " ")
    .trim()
    .toLocaleLowerCase();
  if (!text) return true;
  return /^(?:untitled(?:\s+(?:document|template|project|file|\d+))?|new\s+(?:template|document|project|file)|template(?:\s+\d+)?|document(?:\s+\d+)?|project(?:\s+\d+)?|imported(?:\s+file)?|file(?:\s+\d+)?|قالب(?:\s+جديد|\s+\d+)?|مستند(?:\s+جديد|\s+\d+)?|مشروع(?:\s+جديد|\s+\d+)?|بدون\s+اسم|بلا\s+اسم)$/i.test(text);
}

function parsedContent(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return { pages: value };
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function documentMetadataName(content: Record<string, unknown> | null): string {
  if (!content) return "";
  const project = record(content.project);
  const metadata = record(content.metadata);
  return [content.name, content.title, project?.name, metadata?.name]
    .find((value) => typeof value === "string" && value.trim()) as string || "";
}

function collectDocumentText(content: Record<string, unknown> | null): string {
  if (!content) return "";
  const out: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || out.join(" ").length > 12_000 || value == null) return;
    if (typeof value === "string") {
      out.push(value.slice(0, 600));
      return;
    }
    if (typeof value !== "object" || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 500)) visit(item, depth + 1);
      return;
    }
    const item = value as Record<string, unknown>;
    if (typeof item.content === "string" && (item.type === "text" || item.type == null)) {
      out.push(item.content.slice(0, 600));
    }
    for (const [key, child] of Object.entries(item)) {
      if (["src", "dataUrl", "thumbnail", "image", "embeddedFonts"].includes(key)) continue;
      if (typeof child === "object") visit(child, depth + 1);
    }
  };
  visit(content.pages, 0);
  return out.join(" ").slice(0, 12_000);
}

function normalizedCategory(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * The model's own category ids, as a set.
 *
 * Exported so classification (`organization.ts`) and the admin panel can ask
 * "is this value a category the FILTERS understand?" without duplicating the
 * list — and so a free-text Arabic category is never mistaken for one.
 */
export const KNOWN_CATEGORY_IDS: ReadonlySet<string> = new Set(
  Object.keys(CATEGORY_LABELS).filter((key) => key !== "general"),
);

/** True only for an id the catalogue's filters actually accept. */
export function isKnownTemplateCategoryId(value: unknown): boolean {
  return KNOWN_CATEGORY_IDS.has(normalizedCategory(asText(value)));
}

/**
 * The canonical id for a stored category value, or "" when it is not one.
 *
 * `isKnownTemplateCategoryId` answers a yes/no question; callers that must
 * STORE the value need the id itself (case/space normalised), so the catalogue
 * keeps answering the same filter after an administrator retypes «Covers».
 */
export function canonicalCategoryId(value: unknown): string {
  const id = normalizedCategory(asText(value));
  return id && KNOWN_CATEGORY_IDS.has(id) ? id : "";
}

/** The Arabic label for a stored category id, or "" when it is not one. */
export function knownCategoryLabel(value: unknown): string {
  const id = normalizedCategory(asText(value));
  return id ? (CATEGORY_LABELS[id] ?? "") : "";
}

/** Display a known category in Arabic without exposing internal category ids. */
export function templateCategoryLabel(value: unknown): string {
  const category = asText(value).trim();
  if (!category) return "قوالب مؤسسية";
  return KNOWN_CATEGORIES.get(normalizedCategory(category)) ||
    (/^[\u0600-\u06FF\s]+$/.test(category) ? category : "قوالب مؤسسية");
}

function cleanSourceDescriptor(value: string): string {
  let clean = sourceStem(value)
    .normalize("NFKC")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  clean = clean
    .replace(/\b(?:final|finalized|draft|copy|duplicate|latest|approved|new|old|template|document|file|version|ver|rev)\b/gi, " ")
    .replace(/\b(?:v|ver|version|rev)\s*\d+(?:\.\d+)*\b/gi, " ")
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, " ")
    .replace(/\b(?:final|draft|copy|نسخة|نهائي|مسودة|قالب|مستند)\s*\d*\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (isTemplatePlaceholderName(clean)) return "";
  return clean;
}

function defaultFromSignals(input: {
  sourceName: string;
  title: string;
  metadataName: string;
  description: string;
  category: string;
  kind: string;
  format: string;
  documentText: string;
  content: Record<string, unknown> | null;
}): string {
  const sourceDescriptor = [input.sourceName, input.title, input.metadataName]
    .map(cleanSourceDescriptor)
    .find(Boolean) || "";
  const text = [
    input.sourceName,
    input.title,
    input.metadataName,
    input.description,
    input.category,
    input.documentText,
  ].join(" ").normalize("NFKC").toLocaleLowerCase();
  const categoryKey = normalizedCategory(input.category);
  const ext = (input.format || input.sourceName || "").toLocaleLowerCase();
  const pages = Array.isArray(input.content?.pages) ? input.content.pages : [];
  const firstPage = record(pages[0]);
  const pageWidth = Number(firstPage?.w);
  const pageHeight = Number(firstPage?.h);
  const widePage = Number.isFinite(pageWidth) && Number.isFinite(pageHeight) && pageWidth > pageHeight * 1.4;
  const isArabic = /[\u0600-\u06FF]/.test(`${input.sourceName} ${input.title} ${input.metadataName} ${input.documentText}`);
  const isReport = /reports?|\bannual\b|\bquarter(?:ly)?\b|\bq[1-4]\b|تقرير|سنوي|ربع\s*سنوي/i.test(text);
  const isSlide = /slides?|presentation|powerpoint|\.pptx?\b|عرض|شرائح/i.test(`${text} ${ext}`) || categoryKey === "slides" || (widePage && !/reports?|تقرير|خطاب|letter/i.test(text));
  const quarterly = /quarter(?:ly)?|\bq[1-4]\b|ربع\s*سنوي|ربعي|للربع|الربع|ربع/i.test(text);
  const annual = /annual|yearly|سنوي|العام/i.test(text);
  const performance = /performance|kpi|indicator|scorecard|dashboard|أداء|مؤشر|إنجاز/i.test(text);
  const executive = /executive|leadership|board|قيادي|تنفيذي|مجلس/i.test(text);
  const company = /company|corporate|business|شركة|تعريفي/i.test(text);
  const companyProfile = /company\s*profile|profile\s*company|بروفايل\s*شركة|ملف\s*تعريفي/i.test(text);
  const dashboard = /dashboard|scorecard|لوحة|مؤشرات/i.test(text);
  const budget = /budget|ميزانية/i.test(text);
  const resume = /\b(?:resume|résumé|curriculum\s*vitae|cv)\b|سيرة\s*ذاتية/i.test(text);
  const meeting = /meeting|minutes|agenda|اجتماع|محضر|جدول\s*الأعمال/i.test(text);
  const letter = /\bletter\b|memo|correspondence|خطاب|مراسلات|مذكرة/i.test(text);
  const policy = /\bpolicy\b|سياسة/i.test(text);
  const strategy = /strateg(?:y|ic)|خطة\s+استراتيجية/i.test(text);
  const financial = /financial|budget|finance|مالي|ميزانية/i.test(text);
  const categorySlides = categoryKey === "slides" || /عروض تقديمية/.test(categoryKey);

  if (resume) return isArabic ? "نموذج سيرة ذاتية عربية" : "نموذج سيرة ذاتية احترافي";
  if (companyProfile && !isSlide) return "ملف تعريفي احترافي للشركة";
  if (dashboard && !isReport) return "لوحة مؤشرات أداء";
  if (isSlide && executive) return "عرض قيادي رسمي";
  if (isSlide && company) return "عرض شركة احترافي";
  if (quarterly && performance) return "تقرير أداء ربع سنوي";
  if (annual && performance) return "تقرير أداء سنوي";
  if (quarterly && isReport) return "تقرير ربع سنوي احترافي";
  if (annual && isReport) return "تقرير سنوي احترافي";
  if (meeting) return "محضر اجتماع رسمي";
  if (letter) return "خطاب إداري رسمي";
  if (policy) return "نموذج سياسة مؤسسية";
  if (strategy) return "خطة استراتيجية احترافية";
  if (financial && isReport) return "تقرير مالي احترافي";
  if (budget) return "خطة ميزانية احترافية";
  if (performance || categoryKey === "kpis" || categoryKey === "مؤشرات أداء") return "لوحة مؤشرات أداء";
  if (categorySlides || isSlide) return "عرض مؤسسي احترافي";

  const categoryBase: Record<string, string> = {
    covers: "غلاف تقرير مؤسسي",
    "أغلفة التقارير": "غلاف تقرير مؤسسي",
    reports: "تقرير إداري احترافي",
    "تقارير رسمية": "تقرير إداري احترافي",
    inner: "صفحة داخلية احترافية",
    "صفحات داخلية": "صفحة داخلية احترافية",
    stats: "ملخص إحصائي احترافي",
    "إحصائيات": "ملخص إحصائي احترافي",
    tables: "نموذج جدول إداري",
    "جداول": "نموذج جدول إداري",
    infographics: "إنفوجرافيك مؤسسي",
    "إنفوجرافيك": "إنفوجرافيك مؤسسي",
    editorial: "قالب تحريري احترافي",
    "قوالب تحريرية": "قالب تحريري احترافي",
    institutional: "قالب مؤسسي احترافي",
    "قوالب مؤسسية": "قالب مؤسسي احترافي",
    data: "نموذج بيانات احترافي",
    "قوالب بيانات": "نموذج بيانات احترافي",
    executive: "ملخص تنفيذي رسمي",
    "قوالب تنفيذية": "ملخص تنفيذي رسمي",
    section: "فاصل أقسام مؤسسي",
    "فواصل الأقسام": "فاصل أقسام مؤسسي",
    timeline: "مخطط مراحل احترافي",
    "مخططات المراحل": "مخطط مراحل احترافي",
    psd: "تصميم مؤسسي محوّل",
    import: "مستند مؤسسي محوّل",
  };
  const categoryName = categoryBase[categoryKey];
  if (categoryName) {
    if (sourceDescriptor && !/^(?:report|annual report|template|document|file|قالب|مستند|تقرير|ملف)$/i.test(sourceDescriptor)) {
      return `${categoryName} — ${sourceDescriptor}`.slice(0, TITLE_LIMIT);
    }
    return categoryName;
  }

  if (input.kind.toLowerCase() === "svg" || /\.svg\b/i.test(ext)) return "تصميم متجهي احترافي";
  if (/\.pptx?\b|presentation|عرض/i.test(ext)) return "عرض مؤسسي احترافي";
  if (sourceDescriptor) {
    const topic = sourceDescriptor
      .replace(/\b(?:annual|yearly)\b/gi, "سنوي")
      .replace(/\bquarterly\b/gi, "ربع سنوي")
      .replace(/\bperformance\b/gi, "أداء")
      .replace(/\breport\b/gi, "تقرير")
      .replace(/\bplan\b/gi, "خطة")
      .replace(/\bproposal\b/gi, "مقترح")
      .replace(/\bcompany\b/gi, "شركة")
      .replace(/\bproject\b/gi, "مشروع")
      .replace(/\bpolicy\b/gi, "سياسة")
      .replace(/\s+/g, " ")
      .trim();
    const prefix = input.kind.toLowerCase() === "svg" ? "تصميم متجهي" : "قالب مؤسسي";
    return `${prefix} — ${topic}`.slice(0, TITLE_LIMIT);
  }
  if (input.kind.toLowerCase() === "svg" || /\.svg\b/i.test(ext)) return "تصميم متجهي احترافي";
  return "قالب إداري احترافي";
}

/** Generate a professional name from a template's real metadata and content. */
export function generateTemplateName(context: TemplateNamingContext): string {
  const content = parsedContent(context.content);
  const sourceName = asText(context.sourceName).trim();
  const title = asText(context.title).trim();
  const metadataName = documentMetadataName(content);
  const result = defaultFromSignals({
    sourceName,
    title,
    metadataName,
    description: asText(context.description),
    category: asText(context.category),
    kind: asText(context.kind),
    format: asText(context.format),
    documentText: collectDocumentText(content),
    content,
  });
  return result.slice(0, TITLE_LIMIT);
}

/**
 * Resolve a persisted name. Meaningful author-entered names are returned byte
 * for byte (apart from the storage limit); known placeholder or raw upload
 * names always become a professional, content-aware default.
 */
export function resolveTemplateName(context: TemplateNamingContext): string {
  const raw = asText(context.title);
  const trimmed = raw.trim();
  if (!trimmed || isTemplatePlaceholderName(trimmed)) return generateTemplateName(context);

  if (context.titleIsManual === true) return raw.slice(0, TITLE_LIMIT);
  if (context.titleIsManual === false) return generateTemplateName(context);

  const sourceName = asText(context.sourceName).trim();
  const sameAsSource = sourceName && comparable(trimmed) === comparable(sourceName);
  const looksLikeFile = FILE_EXTENSION.test(trimmed);
  if (sameAsSource || looksLikeFile) return generateTemplateName(context);
  return raw.slice(0, TITLE_LIMIT);
}

/** Keep the document's own metadata aligned with the catalog title. */
export function applyTemplateNameToContent(content: string, title: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return content;
    const document = parsed as Record<string, unknown>;
    document.name = title;
    const project = record(document.project);
    if (project) project.name = title;
    return JSON.stringify(document);
  } catch {
    return content;
  }
}
