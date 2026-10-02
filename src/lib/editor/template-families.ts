import { uid } from "@/lib/utils";
import {
  createElement,
  nextZ,
  normalizeZ,
  type CanvasEl,
  type Page,
  type Theme,
} from "./model";
import {
  BODY,
  CEREMONY,
  DISPLAY,
  EDITORIAL,
  META,
  ROLE,
  band,
  cell,
  hairline,
  paint,
  plate,
  tick,
} from "./template-layouts";
import { bindDesignSkill } from "./design-skill";

bindDesignSkill("families");

/**
 * Distinct editorial families for the template gallery.
 * Art direction: `.grok/skills/nasaq-design/SKILL.md`.
 *
 * Each page is a real editable NASAQ document. Families do not share a
 * layout with a recolor — the composition changes with the job.
 */

type Add = (type: CanvasEl["type"], over?: Partial<CanvasEl>) => CanvasEl;

export interface FamilyTemplateMeta {
  id: string;
  title: string;
  desc: string;
  category:
    | "covers"
    | "reports"
    | "stats"
    | "tables"
    | "kpis"
    | "infographics"
    | "inner"
    | "editorial"
    | "institutional"
    | "data"
    | "executive"
    | "section"
    | "timeline";
  concept: string;
  preview:
    | "editorial"
    | "grid"
    | "data"
    | "flow"
    | "asymmetric"
    | "modular"
    | "executive"
    | "statistical"
    | "section"
    | "process";
}

export const FAMILY_TEMPLATES: FamilyTemplateMeta[] = [
  { id: "family-gov-cover", title: "غلاف مؤسسي", desc: "حقل عنوان ثم صورة تنزف حتى حافة التجليد", category: "covers", concept: "Institutional", preview: "grid" },
  { id: "family-gov-opener", title: "فاتحة قسم حكومي", desc: "رقم قسم، عنوان، وملخص ما سيُقرأ", category: "section", concept: "Institutional", preview: "section" },
  { id: "family-corp-cover", title: "غلاف شركات", desc: "عمود هوية وصفّ بيانات وصورة أفقية", category: "institutional", concept: "Corporate", preview: "modular" },
  { id: "family-exec-brief", title: "موجز تنفيذي", desc: "قرار، رقم، وقيد على مقياس واحد", category: "executive", concept: "Executive", preview: "executive" },
  { id: "family-annual-kpis", title: "مؤشرات التقرير السنوي", desc: "رقم قائد ورقمان تابعان ثم قراءة", category: "kpis", concept: "Annual Report", preview: "statistical" },
  { id: "family-editorial-open", title: "افتتاح تحريري", desc: "عنوان ثم صورة بعرض غير مكتمل وتعليق", category: "editorial", concept: "Modern Editorial", preview: "editorial" },
  { id: "family-editorial-quote", title: "اقتباس", desc: "اقتباس أميري وإسناد وسياق قصير", category: "editorial", concept: "Modern Editorial", preview: "asymmetric" },
  { id: "family-minimal-prose", title: "متن بسيط", desc: "عمود قراءة وهامش ملاحظة", category: "reports", concept: "Minimal", preview: "flow" },
  { id: "family-finance-ledger", title: "جدول مالي", desc: "كشف بخط مزدوج وجدول وقراءة فارق", category: "tables", concept: "Financial", preview: "data" },
  { id: "family-media-spread", title: "صفحة بصرية", desc: "صورة بارتفاع الصفحة وعمود تحرير", category: "infographics", concept: "Media", preview: "asymmetric" },
  { id: "family-leadership-close", title: "ختام قيادي", desc: "ختام هادئ بتوقيع وموعد النسخة التالية", category: "inner", concept: "Leadership", preview: "section" },
  { id: "family-project-phases", title: "مراحل مشروع", desc: "مسار أفقي والمرحلة الحالية تنزل تحته", category: "timeline", concept: "Project Report", preview: "process" },
  { id: "family-performance", title: "مقارنة أداء", desc: "فرق ربعين وجدول وقضيبان نسبيان", category: "data", concept: "Performance", preview: "data" },
  { id: "family-premium-cover", title: "غلاف فاخر", desc: "حقل فحمي وإطار نحاسي وعنوان في الثلث الأسفل", category: "covers", concept: "Premium", preview: "executive" },
];

const NAVY = "#071d3d";
const GOLD = "#c6a05a";
const PAPER = "#f7f6f3";
const IVORY = "#f6f3ee";
const INK = "#172033";
const FOREST = "#1b4d3e";
const CHARCOAL = "#1c1917";
const BRASS = "#a6844a";
const CORP = "#12344d";
const PRESS = "#9a3412";
const LEDGER = "#0f3d2e";
const PROJECT = "#1e3a5f";

function sheet(
  name: string,
  theme: Theme,
  bg: string,
  build: (add: Add) => void,
): Page {
  const p: Page = {
    id: uid("page"),
    name,
    bg,
    w: 210,
    h: 297,
    elements: [],
  };
  const add: Add = (type, over = {}) => {
    const el = createElement(type, over, theme);
    el.z = nextZ(p);
    p.elements.push(el);
    return el;
  };
  build(add);
  normalizeZ(p);
  return p;
}

export function buildFamilyPage(
  id: string,
  theme: Theme,
  org: string,
): Page | null {
  const entity = org.trim() || "اسم الجهة";
  const full = cell(0, 12);
  switch (id) {
    case "family-gov-cover": {
      const title = cell(0, 10);
      return sheet("غلاف مؤسسي", theme, PAPER, (add) => {
        band(add, "عمود التجليد", 196, 0, 14, 297, NAVY);
        band(add, "خط التجليد", 194.4, 0, 1.2, 297, GOLD);
        add("logo", { name: "الشعار", x: 197, y: 16, w: 12, h: 12 });
        paint(add, "سنة العمود", "٢٦", 196, 250, 14, 16, { ...ROLE.meta, fontFamily: DISPLAY, fontSize: 11, color: GOLD, textAlign: "center" });
        paint(add, "تصنيف", "تقرير مؤسسي  ·  استخدام داخلي", 16, 22, 170, 6, { ...ROLE.meta, color: "#66748a" });
        paint(add, "السنة", "٢٠٢٦", 16, 34, 170, 18, { ...ROLE.display, fontSize: 36, color: NAVY, lineHeight: 0.9 });
        paint(add, "عنوان الغلاف", "تقرير الأداء السنوي", title.x, 58, title.w, 12, { ...ROLE.h1, fontSize: 22, color: INK });
        hairline(add, "فاصل العنوان", 150, 76, 36, GOLD, 1);
        paint(add, "مقدمة", "يغلق هذا الإصدار عام العمل: ما اكتمل في الخدمة، وما بقي مفتوحًا أمام اللجنة.", 16, 86, 168, 16, { ...ROLE.body, fontSize: 12, color: INK });
        ([["٠١", "النطاق"], ["٠٢", "النتائج"], ["٠٣", "الأثر على الخدمة"], ["٠٤", "التوصية"]] as const).forEach(([num, label], i) => {
          const y = 118 + i * 18;
          paint(add, `رقم ${num}`, num, 156, y, 30, 8, { ...ROLE.h3, color: GOLD });
          paint(add, `بند ${label}`, label, 16, y, 132, 8, { ...ROLE.h3, fontSize: 13, color: NAVY });
          hairline(add, `حد ${num}`, 16, y + 12, 170, "#e4e0d8", 0.3);
        });
        add("image", { name: "صورة المقر", x: 0, y: 210, w: 194, h: 87, src: plate("facade"), style: { objectFit: "cover", radius: 0 } });
        band(add, "قاعدة الغلاف", 0, 268, 194, 29, NAVY);
        paint(add, "اسم الجهة", entity, 96, 274, 90, 10, { ...ROLE.h3, fontSize: 12, color: "#f7f6f3" });
        paint(add, "التاريخ", "يناير — ديسمبر", 16, 276, 70, 8, { ...ROLE.meta, color: GOLD, textAlign: "left" });
      });
    }
    case "family-gov-opener": {
      const index = cell(0, 3);
      const body = cell(4, 8);
      return sheet("فاتحة قسم", theme, PAPER, (add) => {
        paint(add, "فهرس", "٠١  النطاق\n٠٢  النتائج\n٠٣  التوصية", index.x, 24, index.w, 22, { ...ROLE.meta, color: "#8b95a5", lineHeight: 1.7 });
        tick(add, "حد الفهرس", index.x - 6, 24, 24, "#d9d3c8");
        paint(add, "رقم القسم", "٠٢", full.x, 62, full.w, 32, { ...ROLE.display, fontSize: 64, color: NAVY, lineHeight: 0.85 });
        hairline(add, "فاصل", 150, 102, 38, GOLD, 1);
        paint(add, "عنوان القسم", "النتائج والأثر", body.x, 114, body.w, 14, { ...ROLE.h1, fontSize: 26, color: INK });
        paint(add, "سطر القسم", "ما الذي تغيّر في الخدمة هذا العام، ولماذا يغيّر ذلك توصية الدورة القادمة.", body.x, 134, body.w, 16, { ...ROLE.body, color: "#3d4a5c" });
        hairline(add, "حد الملخص", full.x, 162, full.w, "#e4e0d8", 0.35);
        paint(add, "تسمية الملخص", "في هذا القسم", full.x, 172, 50, 6, { ...ROLE.meta, color: GOLD });
        paint(add, "ملخص القسم", "تُعرض النتيجة قبل السرد. الرقم القائد هو إنجاز الخطة، ثم أثره على زمن الخدمة، ثم ما يزال مفتوحًا. التوصية لا تُستنتج من جدول منفصل.", full.x, 182, full.w, 28, { ...ROLE.body, color: INK });
        paint(add, "الجهة", entity, full.x, 268, full.w, 8, { ...ROLE.meta, color: "#6b7280" });
      });
    }
    case "family-corp-cover": {
      const block = cell(0, 11);
      return sheet("غلاف شركات", theme, "#ffffff", (add) => {
        band(add, "عمود الهوية", 200, 0, 10, 297, CORP);
        paint(add, "تصنيف", "تقرير أعمال  ·  الربع الحالي", block.x, 22, block.w, 6, { ...ROLE.meta, color: "#667887" });
        paint(add, "العنوان", "تقرير الأعمال\nكما سيُعرض", block.x, 34, block.w, 28, { ...ROLE.display, fontSize: 30, color: CORP });
        hairline(add, "خط أساس", block.x, 70, block.w, "#d5dde4", 0.4);
        paint(add, "جهة", entity, 128, 78, 62, 8, { ...ROLE.h3, color: CORP });
        paint(add, "إعداد", "مكتب المدير العام", 70, 78, 52, 8, { ...ROLE.meta, fontSize: 10, color: INK });
        paint(add, "حالة", "للمراجعة", block.x, 78, 42, 8, { ...ROLE.meta, fontSize: 10, color: BRASS });
        add("image", { name: "حقل الأعمال", x: block.x, y: 100, w: block.w, h: 78, src: plate("facade"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "تعليق", "المقر الإداري  ·  الربع المنتهي في سبتمبر", block.x, 182, block.w, 6, { ...ROLE.caption, color: "#667887" });
        paint(add, "المتن", "الإيراد فوق الخطة، والطاقة التشغيلية عند سقفها. التوسعة تُؤجَّل حتى تراجع وحدة الإسناد طاقتها.", block.x, 198, block.w, 28, { ...ROLE.body, fontSize: 12, color: INK });
        paint(add, "التوزيع", "يُوزَّع على الإدارة التنفيذية فقط.", block.x, 248, block.w, 8, { ...ROLE.meta, color: "#667887" });
      });
    }
    case "family-exec-brief": {
      const lead = cell(0, 7);
      const side = cell(7, 5);
      return sheet("موجز تنفيذي", theme, IVORY, (add) => {
        paint(add, "تصنيف", "موجز تنفيذي  ·  اجتماع هذا الأسبوع", full.x, 20, full.w, 6, { ...ROLE.meta, color: BRASS });
        paint(add, "العنوان", "ما يجب أن يُحسم", lead.x, 32, lead.w, 14, { ...ROLE.h1, fontSize: 24, color: CHARCOAL });
        hairline(add, "فاصل", 154, 52, 34, BRASS, 0.9);
        paint(add, "الرقم", "٤٢٪", lead.x, 62, 70, 18, { ...ROLE.display, fontSize: 36, color: CHARCOAL, lineHeight: 1 });
        paint(add, "تسمية الرقم", "نمو الإيراد\nمقابل الخطة", lead.x, 84, 70, 12, { ...ROLE.caption, color: "#6b6258", lineHeight: 1.4 });
        paint(add, "الحكم", "الأداء فوق الخطة لأن الطلب ثبت، لا لأن الطاقة زادت.", side.x, 64, side.w, 28, { ...ROLE.body, fontSize: 12, color: INK });
        hairline(add, "حد القرار", full.x, 112, full.w, "#e4dccf", 0.35);
        paint(add, "تسمية القرار", "القرار المعروض", full.x, 122, full.w, 6, { ...ROLE.meta, color: BRASS });
        paint(add, "القرار", "تأجيل التوسعة إلى الربع القادم، والإبقاء على هدف الإيراد كما هو.", full.x, 132, full.w, 16, { ...ROLE.h2, fontFamily: BODY, fontWeight: 500, fontSize: 13, color: INK, lineHeight: 1.6 });
        band(add, "علامة القيد", full.x, 160, 1.4, 24, BRASS);
        paint(add, "القيد", "القيد تشغيلي. لا يُعالج بهدف مبيعات أعلى، ولا بفتح توظيف قبل خطة الطاقة.", 22, 160, 168, 22, { ...ROLE.body, fontSize: 12, color: CHARCOAL });
        hairline(add, "خط التوقيع", 120, 214, 64, "#cfc6b8", 0.35);
        paint(add, "التوقيع", "الاسم\nالصفة", 120, 220, 64, 14, { ...ROLE.meta, fontSize: 10, color: "#6b6258", lineHeight: 1.4 });
        paint(add, "الجهة", entity, full.x, 248, 90, 8, { ...ROLE.meta, color: "#6b6258" });
        paint(add, "الموعد", "يُحسم في الجلسة", 120, 248, 64, 8, { ...ROLE.meta, color: "#6b6258", textAlign: "left" });
      });
    }
    case "family-annual-kpis": {
      const primary = cell(0, 6);
      const secondary = cell(6, 6);
      return sheet("مؤشرات سنوية", theme, "#f4efe6", (add) => {
        paint(add, "الرأس", "التقرير السنوي  ·  مؤشرات الإغلاق", full.x, 18, full.w, 6, { ...ROLE.meta, color: FOREST });
        hairline(add, "خط الرأس", full.x, 28, full.w, FOREST, 0.7);
        paint(add, "العنوان", "ما يكفي للقراءة", full.x, 36, full.w, 12, { ...ROLE.h1, color: FOREST });
        paint(add, "رقم ١", "٩٤", primary.x, 58, primary.w, 28, { ...ROLE.display, fontSize: 56, color: FOREST, lineHeight: 0.9 });
        paint(add, "تسمية ١", "من مئة  ·  إنجاز الخطة المعتمدة", primary.x, 90, primary.w, 8, { ...ROLE.caption, color: "#5c5348" });
        band(add, "مقياس ١", primary.x, 100, 36, 1.2, FOREST);
        paint(add, "مقابل", "مقابل ٨٩ في العام السابق", primary.x, 106, primary.w, 8, { ...ROLE.meta, color: "#8a6232" });
        paint(add, "رقم ٢", "١٢", secondary.x, 58, secondary.w, 14, { ...ROLE.display, fontSize: 26, color: FOREST, lineHeight: 1 });
        paint(add, "تسمية ٢", "مبادرة مكتملة من أربع عشرة", secondary.x, 74, secondary.w, 8, { ...ROLE.caption, color: "#5c5348" });
        paint(add, "رقم ٣", "٣.٢", secondary.x, 92, secondary.w, 14, { ...ROLE.display, fontSize: 26, color: "#8a6232", lineHeight: 1 });
        paint(add, "تسمية ٣", "عائد كل ريال تشغيل", secondary.x, 112, secondary.w, 8, { ...ROLE.caption, color: "#5c5348" });
        hairline(add, "حد القراءة", full.x, 136, full.w, "#d9cbb6", 0.4);
        paint(add, "قراءة", "الرضا والعائد فوق الخطة. المبادرتان المفتوحتان في محور واحد، وهو التحول الرقمي، ولا تغيّران الحكم على العام.", full.x, 148, full.w, 28, { ...ROLE.body, color: INK });
        paint(add, "المصدر", "المصدر: مكتب التخطيط — إغلاق ديسمبر.", full.x, 186, full.w, 6, { ...ROLE.caption, color: "#7a6a58" });
        hairline(add, "حد المقارنة", full.x, 202, full.w, "#d9cbb6", 0.35);
        ([["العام السابق", "٨٩"], ["هذا العام", "٩٤"], ["الفرق", "+٥"]] as const).forEach(([label, value], i) => {
          const slot = cell(i * 4, 4);
          paint(add, `مقارنة ${label}`, label, slot.x, 210, slot.w, 6, { ...ROLE.caption, color: "#7a6a58" });
          paint(add, `رقم مقارنة ${label}`, value, slot.x, 218, slot.w, 10, { ...ROLE.h2, color: i === 2 ? "#8a6232" : FOREST });
        });
        paint(add, "الجهة", entity, full.x, 248, full.w, 8, { ...ROLE.meta, color: "#7a6a58" });
      });
    }
    case "family-editorial-open": {
      const text = cell(0, 8);
      return sheet("افتتاح تحريري", theme, "#fafafa", (add) => {
        paint(add, "كِكر", "ملف الخدمة", text.x, 16, text.w, 6, { ...ROLE.meta, color: PRESS });
        paint(add, "عدد الملف", "٠٤", 16, 14, 28, 8, { ...ROLE.meta, fontFamily: DISPLAY, fontSize: 14, color: PRESS, textAlign: "left" });
        paint(add, "العنوان", "لماذا يطول الانتظار\nحين تثبت الطاقة", text.x, 28, text.w, 28, { ...ROLE.h1, fontFamily: EDITORIAL, fontWeight: 700, fontSize: 24, color: "#12141a" });
        add("image", { name: "الصورة الرئيسية", x: 0, y: 68, w: 156, h: 112, src: plate("press"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "هامش الصورة", "المنفذ\nالرئيسي\nساعة الذروة", 164, 78, 30, 28, { ...ROLE.caption, color: "#6b7280", lineHeight: 1.45 });
        paint(add, "تعليق", "الاستقبال عند المنفذ الرئيسي  ·  الأسبوع الثالث من رمضان", 16, 184, 140, 8, { ...ROLE.caption, color: "#6b7280" });
        paint(add, "المتن", "ارتفع عدد المعاملات ١٨٪ بينما بقي عدد المنافذ ثابتًا. الانتظار ليس حملة توعوية ناقصة، بل طاقة لم تُراجع منذ العام الماضي.", full.x, 200, full.w, 32, { ...ROLE.body, fontFamily: BODY, color: "#12141a" });
        paint(add, "الجهة", entity, full.x, 268, full.w, 6, { ...ROLE.caption, color: "#9ca3af" });
      });
    }
    case "family-editorial-quote":
      return sheet("اقتباس", theme, "#ffffff", (add) => {
        paint(add, "كِكر", "ملف الخدمة  ·  من محضر اللجنة", full.x, 36, full.w, 6, { ...ROLE.meta, color: PRESS });
        hairline(add, "علامة", 164, 52, 24, PRESS, 1.2);
        paint(add, "الاقتباس", "لا نحتاج حملة جديدة.\nنحتاج منفذًا يفتح\nقبل أن تصل الذروة.", full.x, 68, full.w, 52, { ...ROLE.display, fontFamily: CEREMONY, fontWeight: 700, fontSize: 26, color: "#12141a", lineHeight: 1.35 });
        paint(add, "النسبة", "مديرة تشغيل المنافذ", full.x, 132, 120, 8, { ...ROLE.h3, color: PRESS });
        paint(add, "سياق", "قيل في اجتماع الدورة، لا في مادة إعلامية.", full.x, 146, 140, 8, { ...ROLE.body, fontSize: 12, color: "#4b5563" });
        paint(add, "الجهة", entity, full.x, 268, full.w, 8, { ...ROLE.caption, color: "#9ca3af" });
      });
    case "family-minimal-prose": {
      const col = cell(0, 9);
      const margin = cell(9, 3);
      return sheet("متن", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "قسم  ·  ٠٣", col.x, 20, col.w, 6, { ...ROLE.caption, color: "#9ca3af" });
        paint(add, "هامش", "يُراجع\nقبل النشر\nعلى البوابة", margin.x, 36, margin.w, 28, { ...ROLE.caption, fontSize: 7.5, color: "#9ca3af", lineHeight: 1.45 });
        paint(add, "عنوان", "ما تغيّر في زمن الخدمة", col.x, 32, col.w, 10, { ...ROLE.h1, fontSize: 18, color: INK });
        hairline(add, "فاصل", col.x, 48, col.w, "#e5e7eb", 0.3);
        paint(add, "متن أول", "انتقلت أربع بوابات من مناوبة نهارية إلى تغطية كاملة. انخفض متوسط الانتظار من ست وعشرين دقيقة إلى إحدى عشرة، دون زيادة في عدد الموظفين، لأن توزيع المناوبة هو الذي تغيّر.", col.x, 56, col.w, 36, { ...ROLE.body, color: INK });
        paint(add, "عنوان فرعي", "ما لم يتغيّر", col.x, 100, col.w, 8, { ...ROLE.h2, fontSize: 14, color: INK });
        paint(add, "متن ثان", "بقيت شكوى واحدة تتكرر: المواد التوعوية تصل بعد بدء الذروة. أُغلق ذلك في اليوم الثاني، لكنه لا يُحسب تحسنًا في المنهج ما لم يُثبَّت في جدول التوريد.", col.x, 114, col.w, 36, { ...ROLE.body, color: INK });
        paint(add, "متن ثالث", "هذا القسم لا يلخّص العام. يلخّص أثرًا واحدًا يمكن للجنة أن تسجّله، ثم تنتقل إلى التوصية في القسم التالي.", col.x, 158, col.w, 28, { ...ROLE.body, color: INK });
        paint(add, "رقم الصفحة", "٠٣", 18, 272, 174, 6, { ...ROLE.folio, color: "#9ca3af" });
      });
    }
    case "family-finance-ledger": {
      const read = cell(0, 6);
      const act = cell(6, 6);
      return sheet("جدول مالي", theme, "#ffffff", (add) => {
        hairline(add, "خط الرأس", full.x, 18, full.w, LEDGER, 1.1);
        hairline(add, "خط الرأس الثاني", full.x, 20.4, full.w, LEDGER, 0.3);
        paint(add, "تصنيف", "مالي  ·  إغلاق الفترة", full.x, 26, full.w, 6, { ...ROLE.meta, color: LEDGER });
        paint(add, "العنوان", "ملخص الإنفاق", full.x, 36, 110, 10, { ...ROLE.h1, fontSize: 20, color: LEDGER });
        paint(add, "الوحدة", "بالمليون  ·  ريال", 16, 40, 50, 6, { ...ROLE.caption, color: "#62736b", textAlign: "left" });
        add("table", {
          name: "جدول الإنفاق",
          x: full.x, y: 54, w: full.w, h: 72,
          content: JSON.stringify([
            ["البند", "المعتمد", "الفعلي", "الفرق"],
            ["التشغيل", "١٢٠", "١١٤", "٦"],
            ["المشاريع", "٨٠", "٨٦", "−٦"],
            ["الاحتياطي", "٢٠", "١٨", "٢"],
            ["الإجمالي", "٢٢٠", "٢١٨", "٢"],
          ]),
          style: { cols: 4, rows: 5, fontSize: 10, fontFamily: META, cellAlign: "center", headerBg: LEDGER, headerColor: "#ffffff", stripeBg: "#f4f7f5", borderColor: "#d5e3db", color: INK },
        });
        paint(add, "تسمية القراءة", "القراءة", read.x, 138, read.w, 6, { ...ROLE.meta, color: LEDGER });
        paint(add, "الخلاصة", "الفرق الصافي ٢ لصالح المعتمد. المشاريع تجاوزت، والتشغيل وفّر بالمقدار نفسه تقريبًا.", read.x, 148, read.w, 28, { ...ROLE.body, fontSize: 11, color: INK });
        paint(add, "تسمية الإجراء", "الإجراء", act.x, 138, act.w, 6, { ...ROLE.meta, color: "#8a6232" });
        paint(add, "الإجراء", "لا يُنقل وفر التشغيل إلى المشاريع قبل مراجعة العقد المفتوح.", act.x, 148, act.w, 28, { ...ROLE.body, fontSize: 11, color: INK });
        hairline(add, "خط الاعتماد", full.x, 196, full.w, "#d5e3db", 0.35);
        paint(add, "تسمية الاعتماد", "اعتماد الإدارة المالية", full.x, 206, full.w, 6, { ...ROLE.meta, color: LEDGER });
        hairline(add, "خط التوقيع", 120, 224, 58, "#0f3d2e", 0.35);
        paint(add, "التوقيع", "الاسم والصفة", 120, 230, 58, 8, { ...ROLE.caption, color: "#62736b" });
        paint(add, "الجهة", entity, full.x, 248, full.w, 8, { ...ROLE.caption, color: "#62736b" });
      });
    }
    case "family-media-spread": {
      const col = { x: 108, w: 86 };
      return sheet("صفحة بصرية", theme, "#ffffff", (add) => {
        add("image", { name: "الصورة", x: 0, y: 0, w: 96, h: 297, src: plate("press"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "كِكر", "اتصالات  ·  تغطية الميدان", col.x, 28, col.w, 6, { ...ROLE.meta, color: PRESS });
        paint(add, "العنوان", "ما وثّقته الفرق قبل أن يُكتب البيان", col.x, 40, col.w, 28, { ...ROLE.h1, fontSize: 18, color: "#111827", lineHeight: 1.3 });
        hairline(add, "فاصل", 154, 76, 40, PRESS, 0.8);
        paint(add, "مقدمة", "الصورة من المنفذ الغربي في اليوم الثاني. البيان صدر في اليوم الثالث، بعد أن أُغلقت فجوة المواد.", col.x, 88, col.w, 32, { ...ROLE.body, fontSize: 11, color: INK });
        paint(add, "متن", "ست عشرة فرقة عملت على أربع وعشرين ساعة. لم تُسجَّل فجوة تغطية بعد اليوم الأول.", col.x, 128, col.w, 28, { ...ROLE.body, fontSize: 11, color: INK });
        paint(add, "تعليق", "المنفذ الغربي، اليوم الثاني. البيان صدر في اليوم التالي.", col.x, 168, col.w, 20, { ...ROLE.caption, color: "#6b7280", lineHeight: 1.45 });
        paint(add, "الجهة", entity, col.x, 260, col.w, 8, { ...ROLE.meta, color: "#6b7280" });
      });
    }
    case "family-leadership-close":
      return sheet("ختام", theme, IVORY, (add) => {
        paint(add, "تسمية", "ختام الدورة", full.x, 48, full.w, 6, { ...ROLE.meta, color: BRASS });
        paint(add, "الختام", "شكرًا لكم", full.x, 64, full.w, 18, { ...ROLE.display, fontSize: 36, color: CHARCOAL });
        hairline(add, "فاصل", 150, 92, 38, BRASS, 0.8);
        paint(add, "سطر", "نقدر وقت اللجنة. النسخة التالية تصدر مع إغلاق الربع، ولا تعيد وصف هذا الربع.", full.x, 108, 160, 20, { ...ROLE.body, fontSize: 13, color: "#4b453c" });
        hairline(add, "خط التوقيع", 118, 156, 70, "#cfc6b8", 0.35);
        paint(add, "التوقيع", "الاسم\nالصفة", 118, 164, 70, 14, { ...ROLE.meta, fontSize: 10, color: "#6b6258", lineHeight: 1.4 });
        paint(add, "التاريخ", "نهاية الفترة", full.x, 168, 70, 8, { ...ROLE.meta, color: "#8a8175" });
        band(add, "قاعدة الختام", 0, 248, 210, 49, CHARCOAL);
        paint(add, "الموعد التالي", "النسخة التالية", 16, 258, 64, 6, { ...ROLE.caption, color: BRASS, textAlign: "left" });
        paint(add, "تاريخ التالي", "مارس ٢٠٢٧", 16, 268, 64, 8, { ...ROLE.h3, color: "#f6f3ee", textAlign: "left" });
        paint(add, "الجهة", entity, 90, 262, 100, 10, { ...ROLE.h3, color: BRASS });
      });
    case "family-project-phases":
      return sheet("مراحل", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "تقرير مشروع  ·  مبنى الإسناد", full.x, 20, 120, 6, { ...ROLE.meta, color: PROJECT });
        paint(add, "العنوان", "أربع مراحل", full.x, 30, 120, 12, { ...ROLE.h1, color: "#0f172a" });
        paint(add, "الحالة", "الحالية: البناء", 16, 34, 70, 8, { ...ROLE.meta, fontSize: 10, color: PROJECT, textAlign: "left" });
        hairline(add, "مسار", 22, 78, 166, "#d5dde6", 0.7);
        const stages = [
          ["الانطلاق", "نطاق معتمد."],
          ["البناء", "القائمة مفتوحة."],
          ["التسليم", "لم يبدأ."],
          ["الإغلاق", "بعد النواقص."],
        ];
        stages.forEach(([label, note], i) => {
          const x = 18 + i * 46;
          band(add, `علامة ${label}`, x + 16, 74, 8, 8, i === 1 ? PROJECT : "#ffffff");
          add("shape", {
            name: `حد ${label}`,
            x: x + 16,
            y: 74,
            w: 8,
            h: 8,
            style: { fill: "transparent", borderColor: PROJECT, borderWidth: i === 1 ? 0 : 0.6, radius: 0 },
          });
          paint(add, `رقم ${i + 1}`, `٠${i + 1}`, x, 90, 42, 8, { ...ROLE.h3, color: i === 1 ? PROJECT : "#64748b", textAlign: "center" });
          paint(add, `مرحلة ${i + 1}`, label, x, 102, 42, 8, { ...ROLE.h3, color: INK, textAlign: "center" });
          paint(add, `ملاحظة مرحلة ${i + 1}`, note, x, 114, 42, 10, { ...ROLE.caption, color: "#64748b", textAlign: "center" });
        });
        band(add, "إسقاط المرحلة", 83, 82, 0.7, 34, PROJECT);
        paint(add, "شرح الحالية", "البناء هو المرحلة الوحيدة المفتوحة. التسليم لا يبدأ قبل اعتماد قائمة النواقص، والإغلاق لا يُعلَن بنسبة إنجاز.", 16, 150, 178, 22, { ...ROLE.body, color: INK });
        paint(add, "المالك", "المالك: إدارة المشاريع  ·  الموعد المرجعي: نهاية الربع.", full.x, 184, full.w, 8, { ...ROLE.caption, color: "#64748b" });
        paint(add, "الجهة", entity, full.x, 268, full.w, 6, { ...ROLE.caption, color: "#64748b" });
      });
    case "family-performance": {
      return sheet("أداء", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "تقرير أداء  ·  ربعان", full.x, 18, 110, 6, { ...ROLE.meta, color: FOREST });
        paint(add, "العنوان", "ما تحرّك", full.x, 28, 100, 12, { ...ROLE.h1, color: FOREST });
        paint(add, "المؤشر", "+٦", 16, 24, 48, 16, { ...ROLE.display, fontSize: 28, color: "#8a6232", textAlign: "left", lineHeight: 1 });
        paint(add, "تسمية المؤشر", "صافي الحركة", 16, 42, 48, 6, { ...ROLE.caption, color: "#8a6232", textAlign: "left" });
        add("table", {
          name: "مقارنة",
          x: full.x, y: 58, w: full.w, h: 64,
          content: JSON.stringify([
            ["المؤشر", "الربع السابق", "هذا الربع"],
            ["الإنجاز", "٨٨", "٩٤"],
            ["الالتزام", "٩١", "٩٠"],
            ["الجودة", "٨٤", "٨٩"],
          ]),
          style: { cols: 3, rows: 4, fontSize: 10, fontFamily: META, cellAlign: "center", headerBg: FOREST, headerColor: "#ffffff", borderColor: "#d5e3db", color: INK },
        });
        paint(add, "سابق", "٨٨", full.x, 136, 20, 8, { ...ROLE.h3, color: "#94a89f" });
        band(add, "قضيب السابق", 40, 139, 70, 2.2, "#d5e3db");
        paint(add, "حالي", "٩٤", full.x, 150, 20, 8, { ...ROLE.h3, color: FOREST });
        band(add, "قضيب الحالي", 40, 153, 92, 2.2, FOREST);
        paint(add, "قراءة", "الالتزام هو المؤشر الوحيد الذي تراجع نقطة واحدة. الباقي تحسّن دون تغيير المنهج.", full.x, 168, full.w, 16, { ...ROLE.body, color: INK });
        paint(add, "المصدر", "المصدر: تقرير الربعين — مكتب الأداء.", full.x, 192, full.w, 6, { ...ROLE.caption, color: "#7a6a58" });
        paint(add, "الجهة", entity, full.x, 268, full.w, 6, { ...ROLE.caption, color: "#7a6a58" });
      });
    }
    case "family-premium-cover":
      return sheet("غلاف فاخر", theme, CHARCOAL, (add) => {
        add("shape", { name: "إطار", x: 12, y: 12, w: 186, h: 273, style: { fill: "transparent", borderColor: BRASS, borderWidth: 0.4, radius: 0 } });
        paint(add, "تصنيف", "للتداول الداخلي", 24, 28, 120, 6, { ...ROLE.meta, color: BRASS });
        paint(add, "السنة", "٢٠٢٦", 24, 28, 40, 6, { ...ROLE.meta, color: "#a8a29e", textAlign: "left" });
        paint(add, "فهرس الغلاف", "النتائج\nالقرار\nالملاحق", 148, 48, 38, 22, { ...ROLE.caption, color: "#a8a29e", lineHeight: 1.6, textAlign: "right" });
        paint(add, "العنوان", "تقرير\nالقيادة", 24, 168, 162, 36, { ...ROLE.display, fontSize: 40, color: "#f6f3ee", lineHeight: 1 });
        hairline(add, "خط", 150, 212, 36, BRASS, 0.9);
        paint(add, "سطر", "يُتداول داخل الجهة. لا يُنشر كما هو.", 24, 222, 150, 10, { ...ROLE.body, fontFamily: META, fontSize: 11, color: "#d6d3d1" });
        hairline(add, "خط البيانات", 24, 248, 162, "#44403c", 0.3);
        paint(add, "الجهة", entity, 24, 256, 110, 8, { ...ROLE.h3, color: BRASS });
        paint(add, "النسخة", "نسخة ٠١", 140, 256, 46, 8, { ...ROLE.meta, color: "#a8a29e", textAlign: "left" });
      });
    default:
      return null;
  }
}
