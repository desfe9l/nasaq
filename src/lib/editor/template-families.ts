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
  DISPLAY,
  META,
  ROLE,
  band,
  cell,
  folio,
  hairline,
  kpiCard,
  mark,
  mediaInk,
  paint,
  plate,
  tick,
} from "./template-layouts";
import { bindDesignSkill } from "./design-skill";

bindDesignSkill("families");

/**
 * Distinct editorial families for the template gallery.
 * Art direction: `.grok/skills/nasaq-media/SKILL.md`.
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
  { id: "family-gov-cover", title: "غلاف مؤسسي", desc: "غلاف أبيض، عنوان أخضر، وكتلة سفلية", category: "covers", concept: "Institutional", preview: "grid" },
  { id: "family-gov-opener", title: "فاتحة قسم حكومي", desc: "رقم قسم، عنوان، وملخص ما سيُقرأ", category: "section", concept: "Institutional", preview: "section" },
  { id: "family-corp-cover", title: "غلاف شركات", desc: "عمود هوية وصفّ بيانات وصورة أفقية", category: "institutional", concept: "Corporate", preview: "modular" },
  { id: "family-exec-brief", title: "موجز تنفيذي", desc: "قرار، رقم، وقيد على مقياس واحد", category: "executive", concept: "Executive", preview: "executive" },
  { id: "family-annual-kpis", title: "مؤشرات التقرير السنوي", desc: "رقم قائد ورقمان تابعان ثم قراءة", category: "kpis", concept: "Annual Report", preview: "statistical" },
  { id: "family-editorial-open", title: "افتتاح تحريري", desc: "عنوان ثم صورة بعرض غير مكتمل وتعليق", category: "editorial", concept: "Modern Editorial", preview: "editorial" },
  { id: "family-editorial-quote", title: "اقتباس", desc: "جملة هندسية وخط ذهبي وإسناد قصير", category: "editorial", concept: "Modern Editorial", preview: "asymmetric" },
  { id: "family-minimal-prose", title: "متن بسيط", desc: "عمود قراءة وهامش ملاحظة", category: "reports", concept: "Minimal", preview: "flow" },
  { id: "family-finance-ledger", title: "جدول مالي", desc: "كشف بخط مزدوج وجدول وقراءة فارق", category: "tables", concept: "Financial", preview: "data" },
  { id: "family-media-spread", title: "صفحة بصرية", desc: "صورة بارتفاع الصفحة وعمود تحرير", category: "infographics", concept: "Media", preview: "asymmetric" },
  { id: "family-leadership-close", title: "ختام قيادي", desc: "ختام هادئ بتوقيع وموعد النسخة التالية", category: "inner", concept: "Leadership", preview: "section" },
  { id: "family-project-phases", title: "مراحل مشروع", desc: "مسار أفقي والمرحلة الحالية تنزل تحته", category: "timeline", concept: "Project Report", preview: "process" },
  { id: "family-performance", title: "مقارنة أداء", desc: "فرق ربعين وجدول وقضيبان نسبيان", category: "data", concept: "Performance", preview: "data" },
  { id: "family-premium-cover", title: "غلاف فاخر", desc: "حقل أخضر وخيط ذهبي وعنوان أبيض", category: "covers", concept: "Premium", preview: "executive" },
];

const NAVY = "#071d3d";
const GOLD = "#c6a05a";
const PAPER = "#f7f6f3";
const IVORY = "#f6f3ee";
const INK = "#172033";
const FOREST = "#1b4d3e";
const CHARCOAL = "#1c1917";
const BRASS = "#a6844a";
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
    clipContent: true,
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
      const ink = mediaInk(theme);
      return sheet("غلاف مؤسسي", theme, "#ffffff", (add) => {
        mark(add, "زاوية", 168, 0, 42, 36, ink.soft, "triangle");
        mark(add, "معين", 184, 14, 7, 7, ink.gold, "diamond");
        add("logo", { name: "الشعار", x: 16, y: 14, w: 14, h: 14 });
        paint(add, "تصنيف", "تقرير مؤسسي  ·  ٢٠٢٦", 36, 16, 120, 6, { ...ROLE.meta, color: "#66748a" });
        paint(add, "عنوان الغلاف", "تقرير الأداء\nالسنوي", 16, 40, 170, 32, { ...ROLE.display, fontSize: 32, color: ink.green });
        hairline(add, "خيط", 130, 78, 48, ink.gold, 1);
        paint(add, "مقدمة", "يغلق هذا الإصدار عام العمل: ما اكتمل في الخدمة، وما بقي أمام اللجنة.", 16, 88, 168, 14, { ...ROLE.body, fontSize: 12, color: INK });
        add("image", { name: "صورة المقر", x: 0, y: 112, w: 210, h: 70, src: plate("facade"), style: { objectFit: "cover", radius: 0 } });
        band(add, "كتلة خضراء", 0, 182, 210, 115, ink.green);
        hairline(add, "خيط الكتلة", 0, 182, 210, ink.gold, 0.7);
        ([["٠١", "النطاق"], ["٠٢", "النتائج"], ["٠٣", "الأثر"], ["٠٤", "التوصية"]] as const).forEach(([num, label], i) => {
          const y = 196 + i * 16;
          mark(add, `دائرة ${num}`, 176, y, 8, 8, ink.gold, "circle");
          paint(add, `رقم ${num}`, num, 176, y + 1.6, 8, 5, { ...ROLE.caption, fontSize: 5, color: ink.green, textAlign: "center" });
          paint(add, `بند ${label}`, label, 16, y, 150, 8, { ...ROLE.h3, fontSize: 13, color: "#f7f6f3" });
        });
        paint(add, "اسم الجهة", entity, 16, 268, 140, 8, { ...ROLE.meta, color: ink.gold });
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
      const ink = mediaInk(theme);
      const block = cell(0, 12);
      return sheet("غلاف شركات", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "تقرير أعمال  ·  الربع الحالي", block.x, 18, block.w, 6, { ...ROLE.meta, color: "#667887" });
        paint(add, "العنوان", "تقرير الأعمال", block.x, 30, block.w, 16, { ...ROLE.display, fontSize: 32, color: ink.green });
        hairline(add, "خيط", 140, 52, 48, ink.gold, 1);
        add("image", { name: "حقل الأعمال", x: 0, y: 68, w: 210, h: 78, src: plate("facade"), style: { objectFit: "cover", radius: 0 } });
        band(add, "تعليق", 0, 130, 210, 14, ink.green);
        paint(add, "سطر التعليق", "المقر الإداري  ·  الربع المنتهي في سبتمبر", 16, 133, 178, 8, { ...ROLE.caption, color: "#f7f6f3" });
        paint(add, "المتن", "الإيراد فوق الخطة، والطاقة عند سقفها. التوسعة تُؤجَّل حتى تراجع وحدة الإسناد طاقتها.", 16, 156, 178, 22, { ...ROLE.body, fontSize: 12, color: INK });
        band(add, "كتلة خضراء", 0, 200, 210, 97, ink.green);
        hairline(add, "خيط الكتلة", 0, 200, 210, ink.gold, 0.7);
        paint(add, "جهة", entity, 16, 214, 178, 10, { ...ROLE.h2, color: "#f7f6f3" });
        paint(add, "إعداد", "مكتب المدير العام", 16, 230, 100, 8, { ...ROLE.meta, color: "#d7e3dc" });
        paint(add, "حالة", "للمراجعة", 120, 230, 74, 8, { ...ROLE.meta, color: ink.gold, textAlign: "left" });
      });
    }
    case "family-exec-brief": {
      const lead = cell(0, 7);
      const side = cell(7, 5);
      return sheet("موجز تنفيذي", theme, IVORY, (add) => {
        paint(add, "تصنيف", "موجز تنفيذي  ·  اجتماع هذا الأسبوع", full.x, 20, full.w, 6, { ...ROLE.meta, color: BRASS });
        paint(add, "العنوان", "قرار هذه الجلسة", lead.x, 32, lead.w, 14, { ...ROLE.h1, fontSize: 24, color: CHARCOAL });
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
      const ink = mediaInk(theme);
      return sheet("مؤشرات سنوية", theme, "#ffffff", (add) => {
        paint(add, "الرأس", "التقرير السنوي  ·  مؤشرات الإغلاق", 16, 16, 178, 6, { ...ROLE.meta, color: ink.green });
        hairline(add, "خط الرأس", 16, 26, 178, ink.gold, 0.6);
        paint(add, "العنوان", "ما يكفي للقراءة", 16, 32, 178, 10, { ...ROLE.h1, color: ink.green });
        const cards: [string, string][] = [
          ["٩٤", "إنجاز الخطة من مئة"],
          ["١٢", "مبادرة مكتملة"],
          ["٣.٢", "عائد كل ريال"],
          ["+٥", "فرق عن العام السابق"],
        ];
        cards.forEach(([value, label], i) => {
          const x = i % 2 === 0 ? 108 : 16;
          const y = 50 + Math.floor(i / 2) * 62;
          kpiCard(add, label, x, y, 86, 56, value, label, ink.green, ink.gold, INK);
        });
        band(add, "شريط الملخص", 16, 182, 178, 16, ink.green);
        paint(add, "الملخص", "المبادرتان المفتوحتان في محور واحد ولا تغيّران الحكم", 24, 186, 162, 8, { ...ROLE.caption, color: "#f7f6f3" });
        paint(add, "المصدر", "المصدر: مكتب التخطيط — إغلاق ديسمبر.", 16, 208, 178, 6, { ...ROLE.caption, color: "#7a6a58" });
        folio(add, theme, entity, "٠٤");
      });
    }
    case "family-editorial-open": {
      const text = cell(0, 8);
      return sheet("افتتاح تحريري", theme, "#fafafa", (add) => {
        paint(add, "كِكر", "ملف الخدمة", text.x, 16, text.w, 6, { ...ROLE.meta, color: PRESS });
        paint(add, "عدد الملف", "٠٤", 16, 14, 28, 8, { ...ROLE.meta, fontFamily: DISPLAY, fontSize: 14, color: PRESS, textAlign: "left" });
        paint(add, "العنوان", "لماذا يطول الانتظار\nحين تثبت الطاقة", text.x, 28, text.w, 28, { ...ROLE.h1, fontWeight: 800, fontSize: 22, color: "#12141a" });
        add("image", { name: "الصورة الرئيسية", x: 0, y: 68, w: 156, h: 112, src: plate("press"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "هامش الصورة", "المنفذ\nالرئيسي\nساعة الذروة", 164, 78, 30, 28, { ...ROLE.caption, color: "#6b7280", lineHeight: 1.45 });
        paint(add, "تعليق", "الاستقبال عند المنفذ الرئيسي  ·  الأسبوع الثالث من رمضان", 16, 184, 140, 8, { ...ROLE.caption, color: "#6b7280" });
        paint(add, "المتن", "ارتفع عدد المعاملات ١٨٪ بينما بقي عدد المنافذ ثابتًا. الانتظار ليس حملة توعوية ناقصة، بل طاقة لم تُراجع منذ العام الماضي.", full.x, 200, full.w, 32, { ...ROLE.body, fontFamily: BODY, color: "#12141a" });
        paint(add, "الجهة", entity, full.x, 268, full.w, 6, { ...ROLE.caption, color: "#9ca3af" });
      });
    }
    case "family-editorial-quote":
      return sheet("اقتباس", theme, "#ffffff", (add) => {
        const ink = mediaInk(theme);
        mark(add, "معين", 184, 48, 8, 8, ink.gold, "diamond");
        paint(add, "كِكر", "من محضر اللجنة", full.x, 48, 150, 6, { ...ROLE.meta, color: ink.green });
        hairline(add, "خيط", 140, 64, 48, ink.gold, 1);
        paint(add, "الاقتباس", "لا نحتاج حملة جديدة.\nنحتاج منفذًا يفتح\nقبل أن تصل الذروة.", full.x, 80, full.w, 48, { ...ROLE.display, fontSize: 26, color: ink.green, lineHeight: 1.25 });
        paint(add, "النسبة", "مديرة تشغيل المنافذ", full.x, 140, 140, 8, { ...ROLE.h3, color: ink.gold });
        paint(add, "سياق", "قيل في اجتماع الدورة، لا في مادة إعلامية.", full.x, 154, 160, 10, { ...ROLE.body, fontSize: 12, color: "#4b5563" });
        folio(add, theme, entity, "٠٦");
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
      const ink = mediaInk(theme);
      return sheet("صفحة بصرية", theme, "#ffffff", (add) => {
        add("image", { name: "الصورة الأولى", x: 16, y: 16, w: 178, h: 78, src: plate("press"), style: { objectFit: "cover", radius: 0 } });
        band(add, "تعليق أول", 16, 78, 178, 14, ink.green);
        paint(add, "سطر أول", "المنفذ الغربي  ·  اليوم الثاني", 24, 81, 162, 8, { ...ROLE.caption, color: "#f7f6f3" });
        add("image", { name: "الصورة الثانية", x: 16, y: 102, w: 178, h: 70, src: plate("field"), style: { objectFit: "cover", radius: 0 } });
        band(add, "تعليق ثان", 16, 158, 178, 14, ink.green);
        paint(add, "سطر ثان", "قبل صدور البيان بيوم", 24, 161, 162, 8, { ...ROLE.caption, color: "#f7f6f3" });
        paint(add, "العنوان", "ما وثّقته الفرق قبل البيان", 16, 184, 178, 10, { ...ROLE.h2, color: ink.green });
        paint(add, "متن", "ست عشرة فرقة عملت على مدار الساعة. لم تُسجَّل فجوة تغطية بعد اليوم الأول.", 16, 198, 178, 18, { ...ROLE.body, fontSize: 12, color: INK });
        folio(add, theme, entity, "٠٧");
      });
    }
    case "family-leadership-close":
      return sheet("ختام", theme, "#ffffff", (add) => {
        const ink = mediaInk(theme);
        paint(add, "تسمية", "ختام الدورة", 16, 20, 178, 6, { ...ROLE.meta, color: ink.gold });
        mark(add, "موجة", 40, 118, 130, 36, ink.green, "wave");
        const photo = add("image", { name: "صورة", x: 66, y: 40, w: 78, h: 100, src: plate("portrait"), style: { objectFit: "cover", radius: 0 } });
        const mask = mark(add, "قناع", 66, 40, 78, 100, "transparent", "arch");
        photo.clippedBy = mask.id;
        mark(add, "إطار", 62, 36, 86, 108, ink.gold, "arch-frame");
        paint(add, "الاسم", "اسم المسؤول", 16, 160, 178, 10, { ...ROLE.h2, color: ink.gold, textAlign: "center" });
        hairline(add, "خيط الاسم", 70, 174, 70, ink.gold, 0.6);
        paint(add, "الصفة", "الصفة", 16, 180, 178, 6, { ...ROLE.meta, color: ink.green, textAlign: "center" });
        paint(add, "سطر", "النسخة التالية تصدر مع إغلاق الربع، ولا تعيد وصف هذا الربع.", 16, 196, 178, 14, { ...ROLE.body, fontSize: 12, color: INK, textAlign: "center" });
        folio(add, theme, entity, "٠٨");
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
      return sheet("غلاف فاخر", theme, "#0c3d2c", (add) => {
        const ink = mediaInk(theme);
        add("shape", { name: "إطار", x: 12, y: 12, w: 186, h: 273, style: { fill: "transparent", borderColor: ink.gold, borderWidth: 0.45, radius: 0 } });
        mark(add, "معين", 96, 28, 8, 8, ink.gold, "diamond");
        paint(add, "تصنيف", "للتداول الداخلي", 24, 46, 162, 6, { ...ROLE.meta, color: ink.gold, textAlign: "center" });
        add("image", { name: "صورة", x: 28, y: 62, w: 154, h: 78, src: plate("night"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "العنوان", "تقرير القيادة", 24, 156, 162, 18, { ...ROLE.display, fontSize: 32, color: "#f7f6f3", textAlign: "center" });
        hairline(add, "خيط", 78, 180, 54, ink.gold, 0.8);
        paint(add, "سطر", "يُتداول داخل الجهة. لا يُنشر كما هو.", 24, 190, 162, 10, { ...ROLE.body, fontFamily: META, fontSize: 11, color: "#d7e3dc", textAlign: "center" });
        paint(add, "الجهة", entity, 24, 230, 162, 8, { ...ROLE.h3, color: ink.gold, textAlign: "center" });
        paint(add, "السنة", "٢٠٢٦", 24, 244, 162, 8, { ...ROLE.meta, color: "#f7f6f3", textAlign: "center" });
      });
    default:
      return null;
  }
}
