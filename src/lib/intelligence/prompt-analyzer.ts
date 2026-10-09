import type { DesignComposition } from "@/lib/ai/design-composition";
import type { DesignFormat, DesignStyle, PaletteRoles } from "./schema";
import { paletteForStyle } from "./dna";
import type { PageLayoutDirective } from "./layout-variety";

export interface PromptAnalysis {
  compositions?: DesignComposition[];
  rawPrompt: string;
  docType:
    | "official_report"
    | "annual_report"
    | "cover"
    | "presentation"
    | "company_profile"
    | "executive_summary"
    | "infographic"
    | "minutes"
    | "plan"
    | "certificate"
    | "letterhead";
  docTypeLabel: string;
  topic: string;
  title: string;
  subtitle: string;
  org: string;
  style: DesignStyle;
  styleLabel: string;
  coverStyle:
    | "minimal"
    | "editorial"
    | "premium"
    | "gradient"
    | "wave"
    | "geometric"
    | "image-led"
    | "executive"
    | "formal"
    | "legal"
    | "media"
    | "annual-report";
  generationMode: "generate" | "balance" | "professional";
  contentDensity: "light" | "balanced" | "dense";
  bilingual: boolean;
  visualDirection: string;
  pages: number;
  format: DesignFormat;
  orientation: "portrait" | "landscape";
  dimensions: { w: number; h: number };
  palette: PaletteRoles;
  classification: string;
  dateString: string;
  keyMetrics: Array<{ value: string; label: string; trend?: string }>;
  frameworkPillars: Array<{ title: string; desc: string }>;
  tableData: {
    headers: string[];
    rows: string[][];
  };
  summaryTakeaways: string[];
  recommendations: string[];
  /**
   * Per-page layout directives from the AI design brief (Anti-Monotony &
   * Dynamic Layout Rules). Undefined for pure prompt parsing — the planner
   * then falls back to the style-biased rotation.
   */
  pageLayouts?: PageLayoutDirective[];
}

const STYLE_LABELS: Record<DesignStyle, string> = {
  institutional: "مؤسسي سيادي",
  government: "حكومي رسمي",
  corporate: "شركات وأعمال",
  executive: "تنفيذي قيادي",
  editorial: "تحريري معاصر",
  presentation: "عرض مرئي",
  report: "تقرير شامل",
  infographic: "بيانات وإنفوجرافيك",
  auction: "مزادات واستثمار",
};

// Specialized palettes tailored to topics
const CYBER_PALETTE: PaletteRoles = {
  field: "#0a2239",
  paper: "#f7f9fb",
  ink: "#0c1b2c",
  accent: "#00a3c4",
  muted: "#5a6b7c",
  onField: "#f7f9fb",
};

const ENERGY_PALETTE: PaletteRoles = {
  field: "#133e2c",
  paper: "#f8f9f6",
  ink: "#14241c",
  accent: "#48bb78",
  muted: "#5c6b63",
  onField: "#f8f9f6",
};

const HEALTH_PALETTE: PaletteRoles = {
  field: "#0e4c5a",
  paper: "#f4f8f8",
  ink: "#11262d",
  accent: "#38bdf8",
  muted: "#556e75",
  onField: "#f4f8f8",
};

const ROYAL_PALETTE: PaletteRoles = {
  field: "#0c3d2c",
  paper: "#faf8f4",
  ink: "#17231c",
  accent: "#c6a05a",
  muted: "#5c6660",
  onField: "#faf8f4",
};

const CORPORATE_BLUE: PaletteRoles = {
  field: "#071d3d",
  paper: "#f7f8fb",
  ink: "#172033",
  accent: "#c6a05a",
  muted: "#5c6570",
  onField: "#f7f8fb",
};

export function parsePrompt(prompt: string): PromptAnalysis {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // 1. Detect page count
  let pages = 0;
  const pageMatch = clean.match(/(?:من\s+)?(\d+)\s*صفح/i);
  if (pageMatch) {
    pages = Number.parseInt(pageMatch[1], 10);
  } else if (/صفحت(?:ين|ان)/i.test(clean)) {
    pages = 2;
  } else if (/ثلاث(?:ة)?\s*صفح/i.test(clean)) {
    pages = 3;
  } else if (/أربع(?:ة)?\s*صفح/i.test(clean)) {
    pages = 4;
  } else if (/خمس(?:ة)?\s*صفح/i.test(clean)) {
    pages = 5;
  } else if (/ست(?:ة)?\s*صفح/i.test(clean)) {
    pages = 6;
  } else if (/سبع(?:ة)?\s*صفح/i.test(clean)) {
    pages = 7;
  } else if (/ثمان(?:ي|ية)?\s*صفح/i.test(clean)) {
    pages = 8;
  } else if (/عشر(?:ة)?\s*صفح/i.test(clean)) {
    pages = 10;
  } else if (/اثنتا?\s*عشر(?:ة)?\s*صفح/i.test(clean)) {
    pages = 12;
  } else if (/صفحة\s*واحدة|صفحة\s*فردية/i.test(clean)) {
    pages = 1;
  }

  // 2. Detect Document Type
  let docType: PromptAnalysis["docType"] = "official_report";
  let docTypeLabel = "تقرير رسمي";

  if (/غلاف|صفحة\s*أولى|واجهة/i.test(clean) && !/تقرير\s+من\s+\d+/i.test(clean)) {
    docType = "cover";
    docTypeLabel = "غلاف تقرير";
    if (pages === 0) pages = 1;
  } else if (/عرض|سلايد|شرائح|برزنتيشن|تقديمي|قيادي/i.test(clean)) {
    docType = "presentation";
    docTypeLabel = "عرض تقديمي قيادي";
    if (pages === 0) pages = 6;
  } else if (/تقرير\s*سنوي/i.test(clean)) {
    docType = "annual_report";
    docTypeLabel = "تقرير سنوي";
    if (pages === 0) pages = 6;
  } else if (/تعريفي|بروفايل|نبذة|صفحة\s*تعريفية|ملف\s*شركة/i.test(clean)) {
    docType = "company_profile";
    docTypeLabel = "ملف تعريفي بالشركة";
    if (pages === 0) pages = 2;
  } else if (/ملخص\s*تنفيذي|موجز/i.test(clean)) {
    docType = "executive_summary";
    docTypeLabel = "ملخص تنفيذي";
    if (pages === 0) pages = 2;
  } else if (/محضر|اجتماع/i.test(clean)) {
    docType = "minutes";
    docTypeLabel = "محضر اجتماع";
    if (pages === 0) pages = 2;
  } else if (/خطة\s*عمل|خطة\s*تشغيل|استراتيجية/i.test(clean)) {
    docType = "plan";
    docTypeLabel = "خطة تشغيلية";
    if (pages === 0) pages = 4;
  } else if (/إنفوجرافيك|رسم\s*بياني/i.test(clean)) {
    docType = "infographic";
    docTypeLabel = "إنفوجرافيك";
    if (pages === 0) pages = 1;
  } else if (/شهادة|شكر|تقدير/i.test(clean)) {
    docType = "certificate";
    docTypeLabel = "شهادة تقدير";
    if (pages === 0) pages = 1;
  } else if (/خطاب|مراسلة/i.test(clean)) {
    docType = "letterhead";
    docTypeLabel = "خطاب رسمي";
    if (pages === 0) pages = 1;
  } else {
    // Default official report
    if (pages === 0) pages = 4;
  }

  // Cap pages between 1 and 12
  pages = Math.min(12, Math.max(1, pages));

  // 3. Format and orientation
  let format: DesignFormat = "a4-book";
  let orientation: "portrait" | "landscape" = "portrait";
  let dimensions = { w: 210, h: 297 };

  if (docType === "presentation") {
    format = "wide-slide";
    orientation = "landscape";
    dimensions = { w: 338.7, h: 190.5 };
  } else if (docType === "certificate") {
    format = "a4-book";
    orientation = "landscape";
    dimensions = { w: 297, h: 210 };
  } else if (docType === "infographic" && pages === 1) {
    format = "tall-story";
    orientation = "portrait";
    dimensions = { w: 210, h: 560 };
  }

  // 4. Style & Topic Detection
  let style: DesignStyle = "institutional";
  let palette: PaletteRoles = ROYAL_PALETTE;
  let topic = "موضوع التصميم كما ورد في الطلب";
  let title = "[عنوان المستند]";
  let subtitle = "[أضف ملخصًا موثقًا من المصدر]";
  let org = "[اسم الجهة]";
  const classification = "[التصنيف يحدده المالك]";
  let coverStyle: PromptAnalysis["coverStyle"] = "formal";
  const generationMode: PromptAnalysis["generationMode"] = /توازن|متوازن/i.test(clean)
    ? "balance"
    : /توليد|إبداعي|إبداع/i.test(clean)
      ? "generate"
      : "professional";
  const contentDensity: PromptAnalysis["contentDensity"] = /مكثف|كثيف|تفصيلي/i.test(clean)
    ? "dense"
    : /موجز|خفيف|minimal/i.test(clean)
      ? "light"
      : "balanced";
  const bilingual = /ثنائي|لغتين|عربي.*إنجليزي|إنجليزي.*عربي/i.test(clean);
  let visualDirection = "تكوين عربي RTL مؤسسي بهرمية قوية ومساحات بيضاء مقصودة";

  // Check organization in prompt
  const orgMatch = clean.match(/(?:لـ|لجهة|لشركة|لهيئة|لمؤسسة|لمركز|لوزارة|لمكتب)\s+([^،.\n]+)/i);
  if (orgMatch) {
    org = orgMatch[1].trim();
  }

  // Topic matching with flexible Arabic prefixes (الـ، بـ، كـ، للـ)
  if (/(?:ال)?(?:أمن|أمان)\s*(?:ال)?(?:سيبران|رقمي)|حماية\s*(?:ال)?بيانات|اختراق|تقنية\s*(?:ال)?معلومات|شبكات|سيبران/i.test(clean)) {
    topic = "الأمن السيبراني";
    style = "corporate";
    palette = CYBER_PALETTE;
    title = "[عنوان مستند عن الأمن السيبراني]";
    subtitle = "[أضف ملخصًا موثقًا عن الأمن السيبراني]";
    coverStyle = "gradient";
    visualDirection = "شبكة تقنية دقيقة فوق تدرج عميق مع صورة معالجة وطبقات ضوء";
  } else if (/(?:ال)?سنوي|إنجازات|حصاد|تقرير\s*(?:ال)?سنوي/i.test(clean)) {
    topic = "التقرير السنوي";
    style = "government";
    palette = ROYAL_PALETTE;
    title = "[عنوان التقرير السنوي]";
    subtitle = "[أضف ملخصًا موثقًا للتقرير السنوي]";
    coverStyle = "annual-report";
  } else if (/(?:ال)?شرك(?:ة|ات)|ملف\s*تعريفي|بروفايل|أعمال/i.test(clean)) {
    topic = "ملف الشركة التعريفي";
    style = "corporate";
    palette = CORPORATE_BLUE;
    title = "[عنوان الملف التعريفي]";
    subtitle = "[أضف تعريفًا موثقًا بالجهة أو الخدمة]";
    coverStyle = "image-led";
  } else if (/طاقة|بيئة|استدامة|شمسية|خضراء/i.test(clean)) {
    topic = "الاستدامة والطاقة المتجددة";
    style = "institutional";
    palette = ENERGY_PALETTE;
    title = "[عنوان مستند الاستدامة]";
    subtitle = "[أضف ملخصًا موثقًا للاستدامة أو الطاقة]";
    coverStyle = "wave";
  } else if (/صحة|طبي|رعاية|مستشفى/i.test(clean)) {
    topic = "الرعاية الصحية والتحول الصحي";
    style = "institutional";
    palette = HEALTH_PALETTE;
    title = "[عنوان مستند الرعاية الصحية]";
    subtitle = "[أضف ملخصًا موثقًا للرعاية الصحية]";
    coverStyle = "media";
  } else if (/مالي|استثمار|ميزانية|أرباح|أسهم/i.test(clean)) {
    topic = "التقرير المالي والاستثماري";
    style = "executive";
    palette = CORPORATE_BLUE;
    title = "[عنوان مستند مالي أو استثماري]";
    subtitle = "[أضف ملخصًا ماليًا موثقًا من المصدر]";
  } else if (/حكومي|وزارة|هيئة|بلد/i.test(clean)) {
    topic = "الشؤون الحكومية والسياسات";
    style = "government";
    palette = ROYAL_PALETTE;
    title = "[عنوان المستند الحكومي]";
    subtitle = "[أضف ملخصًا موثقًا من المصدر]";
  } else if (/قيادي|إدارة\s*عليا|مجلس\s*إدارة/i.test(clean)) {
    topic = "العرض القيادي الاستراتيجي";
    style = "executive";
    palette = ROYAL_PALETTE;
    title = "[عنوان العرض القيادي]";
    subtitle = "[أضف ملخصًا موثقًا للعرض]";
  }

  // Adjust style label
  const styleLabel = STYLE_LABELS[style] || "مؤسسي سيادي";

  // These are editable structure, not assertions. Only the owner or a source
  // supplied in the prompt may turn a placeholder into a factual statement.
  const keyMetrics = Array.from({ length: 4 }, (_, index) => ({
    value: `[القيمة ${index + 1}]`,
    label: `[اسم المؤشر ${index + 1}]`,
    trend: `[الفترة أو الاتجاه ${index + 1}]`,
  }));

  const frameworkPillars = Array.from({ length: 3 }, (_, index) => ({
    title: `[اسم المحور ${index + 1}]`,
    desc: `[أضف وصفًا موثقًا للمحور ${index + 1}]`,
  }));

  const tableData = {
    headers: ["[المجال]", "[المؤشر أو المستهدف]", "[القيمة من المصدر]", "[الحالة من المصدر]"],
    rows: Array.from({ length: 4 }, (_, index) => [
      `[البند ${index + 1}]`,
      "[بيان موثق]",
      "[قيمة موثقة]",
      "[حالة موثقة]",
    ]),
  };

  const summaryTakeaways = [
    "[أضف النتيجة أو الملاحظة الأولى من مصدر موثق]",
    "[أضف النتيجة أو الملاحظة الثانية من مصدر موثق]",
    "[أضف النتيجة أو الملاحظة الثالثة من مصدر موثق]",
  ];

  const recommendations = [
    "[أضف التوصية الأولى بعد المراجعة]",
    "[أضف التوصية الثانية بعد المراجعة]",
    "[أضف التوصية الثالثة بعد المراجعة]",
  ];

  return {
    rawPrompt: clean,
    docType,
    docTypeLabel,
    topic,
    title,
    subtitle,
    org,
    style,
    styleLabel,
    coverStyle,
    generationMode,
    contentDensity,
    bilingual,
    visualDirection,
    pages,
    format,
    orientation,
    dimensions,
    palette,
    classification,
    dateString: "[التاريخ يحدده المالك]",
    keyMetrics,
    frameworkPillars,
    tableData,
    summaryTakeaways,
    recommendations,
  };
}
