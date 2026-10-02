import { uid } from "@/lib/utils";
import {
  createElement,
  nextZ,
  normalizeZ,
  type CanvasEl,
  type Page,
  type Theme,
} from "./model";
import { band, hairline, paint, plate, tick } from "./template-layouts";

/**
 * Distinct editorial families for the template gallery.
 *
 * Each page is a real editable NASAQ document (text, shapes, tables, images),
 * laid on one A4 grid (18mm margin, 8mm rhythm). Families do not share a
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
  { id: "family-gov-cover", title: "غلاف مؤسسي", desc: "شريط كحلي وعنوان على الشبكة وبيانات بلا بطاقات", category: "covers", concept: "Institutional", preview: "grid" },
  { id: "family-gov-opener", title: "فاتحة قسم حكومي", desc: "رقم قسم كبير ومسافة بيضاء وعنوان واحد", category: "section", concept: "Institutional", preview: "section" },
  { id: "family-corp-cover", title: "غلاف شركات", desc: "عمود لوني رفيع وصف بيانات على خط أساس واحد", category: "institutional", concept: "Corporate", preview: "modular" },
  { id: "family-exec-brief", title: "موجز تنفيذي", desc: "رقم واحد ونص عمودين وتوقيع", category: "executive", concept: "Executive", preview: "executive" },
  { id: "family-annual-kpis", title: "مؤشرات التقرير السنوي", desc: "ثلاثة أرقام على خط فاصل دون بطاقات", category: "kpis", concept: "Annual Report", preview: "statistical" },
  { id: "family-editorial-open", title: "افتتاح تحريري", desc: "عنوان كبير وصورة عريضة وتعليق", category: "editorial", concept: "Modern Editorial", preview: "editorial" },
  { id: "family-editorial-quote", title: "اقتباس", desc: "اقتباس واحد ومساحة بيضاء واسعة", category: "editorial", concept: "Modern Editorial", preview: "asymmetric" },
  { id: "family-minimal-prose", title: "متن بسيط", desc: "تسلسل طباعي فقط: عنوان ومتن ورقم صفحة", category: "reports", concept: "Minimal", preview: "flow" },
  { id: "family-finance-ledger", title: "جدول مالي", desc: "عنوان وجدول وخلاصة رقمية هادئة", category: "tables", concept: "Financial", preview: "data" },
  { id: "family-media-spread", title: "صفحة بصرية", desc: "صورة قائدة ثم عنوان وعمودان", category: "infographics", concept: "Media", preview: "asymmetric" },
  { id: "family-leadership-close", title: "ختام قيادي", desc: "صفحة ختام هادئة بتوقيع ومسافة", category: "inner", concept: "Leadership", preview: "section" },
  { id: "family-project-phases", title: "مراحل مشروع", desc: "تسلسل أفقي بأرقام على خط واحد", category: "timeline", concept: "Project Report", preview: "process" },
  { id: "family-performance", title: "مقارنة أداء", desc: "جدول مقارنة ومؤشر قراءة", category: "data", concept: "Performance", preview: "data" },
  { id: "family-premium-cover", title: "غلاف فاخر", desc: "خلفية فحمية وعنوان ذهبي ومسافة واسعة", category: "covers", concept: "Premium", preview: "executive" },
];

const NAVY = "#071d3d";
const GOLD = "#c6a05a";
const PAPER = "#f7f6f3";
const IVORY = "#f6f3ee";
const INK = "#172033";
const FOREST = "#1b4d3e";
const CHARCOAL = "#1c1917";
const BRASS = "#a6844a";

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
  switch (id) {
    case "family-gov-cover":
      return sheet("غلاف مؤسسي", theme, PAPER, (add) => {
        paint(add, "تصنيف", "تقرير مؤسسي", 18, 18, 150, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#66748a", textAlign: "right" });
        paint(add, "عنوان الغلاف", "تقرير الأداء\nالسنوي", 18, 30, 154, 32, { fontFamily: "Tajawal", fontSize: 34, fontWeight: 800, color: NAVY, textAlign: "right", lineHeight: 1.02 });
        hairline(add, "فاصل العنوان", 148, 68, 44, GOLD, 1);
        paint(add, "مقدمة", "النطاق، النتيجة، والقرار. ثلاثة أسطر ثم تترك الصفحة للصورة.", 18, 78, 174, 18, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.65 });
        paint(add, "تسمية الجهة", "الجهة", 120, 108, 72, 5, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
        paint(add, "اسم الجهة", entity, 108, 116, 84, 8, { fontFamily: "Tajawal", fontSize: 13, fontWeight: 700, color: NAVY, textAlign: "right" });
        paint(add, "تسمية الفترة", "الفترة", 18, 108, 70, 5, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
        paint(add, "التاريخ", "يناير — ديسمبر", 18, 116, 80, 8, { fontFamily: "Tajawal", fontSize: 13, fontWeight: 700, color: NAVY, textAlign: "right" });
        add("logo", { name: "الشعار", x: 176, y: 14, w: 16, h: 16 });
        add("image", { name: "صورة المقر", x: 0, y: 140, w: 210, h: 157, src: plate("facade"), style: { objectFit: "cover", radius: 0 } });
      });
    case "family-gov-opener":
      return sheet("فاتحة قسم", theme, PAPER, (add) => {
        paint(add, "فهرس", "٠١  النطاق\n٠٢  النتائج\n٠٣  التوصية", 18, 28, 40, 28, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#8b95a5", textAlign: "right", lineHeight: 1.7 });
        paint(add, "رقم القسم", "٠٢", 18, 78, 174, 28, { fontFamily: "Tajawal", fontSize: 64, fontWeight: 800, color: NAVY, textAlign: "right", lineHeight: 0.85 });
        hairline(add, "فاصل", 140, 116, 52, GOLD, 1);
        paint(add, "عنوان القسم", "النتائج\nوالأثر", 18, 128, 150, 28, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: INK, textAlign: "right", lineHeight: 1.1 });
        paint(add, "سطر القسم", "ما الذي تغيّر، ولماذا يهم القرار التالي.", 18, 166, 140, 12, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: "#3d4a5c", textAlign: "right", lineHeight: 1.6 });
        paint(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b7280", textAlign: "right" });
      });
    case "family-corp-cover":
      return sheet("غلاف شركات", theme, "#ffffff", (add) => {
        band(add, "عمود الهوية", 0, 0, 8, 297, "#12344d");
        paint(add, "تصنيف", "تقرير أعمال  ·  ربع حالي", 22, 24, 168, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#667887", textAlign: "right" });
        paint(add, "العنوان", "تقرير الأعمال\nكما سيُعرض", 22, 36, 168, 28, { fontFamily: "Tajawal", fontSize: 30, fontWeight: 800, color: "#12344d", textAlign: "right", lineHeight: 1.08 });
        hairline(add, "خط أساس", 22, 74, 168, "#d5dde4", 0.4);
        paint(add, "جهة", entity, 120, 82, 70, 8, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: "#12344d", textAlign: "right" });
        paint(add, "إعداد", "مكتب المدير العام", 62, 82, 52, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 600, color: INK, textAlign: "right" });
        paint(add, "حالة", "للمراجعة", 22, 82, 36, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 700, color: "#b08a4f", textAlign: "right" });
        add("image", { name: "حقل الأعمال", x: 22, y: 108, w: 168, h: 72, src: plate("facade"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "تعليق", "المقر  ·  الربع الحالي", 22, 182, 168, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#667887", textAlign: "right" });
        paint(add, "المتن", "الغلاف يقف على عمود هوية وصفّ بيانات وصور واحد. لا بطاقة، ولا شريط عنوان بعرض الصفحة.", 22, 198, 150, 24, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
      });
    case "family-exec-brief":
      return sheet("موجز تنفيذي", theme, IVORY, (add) => {
        paint(add, "تصنيف", "موجز تنفيذي", 18, 22, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: BRASS, textAlign: "right" });
        paint(add, "العنوان", "ما يجب أن يُحسم\nهذا الأسبوع", 18, 34, 174, 24, { fontFamily: "Tajawal", fontSize: 26, fontWeight: 800, color: CHARCOAL, textAlign: "right", lineHeight: 1.12 });
        hairline(add, "فاصل", 154, 64, 38, BRASS, 0.9);
        paint(add, "الرقم", "٤٢٪", 120, 76, 72, 16, { fontFamily: "Tajawal", fontSize: 32, fontWeight: 800, color: CHARCOAL, textAlign: "right", lineHeight: 1 });
        paint(add, "تسمية الرقم", "نمو الإيراد مقابل الخطة", 120, 94, 72, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b6258", textAlign: "right" });
        paint(add, "العمود الأول", "الخلاصة: الأداء فوق الخطة، والطاقة عند سقفها.", 18, 78, 92, 22, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.65 });
        paint(add, "العمود الثاني", "القرار: تأجيل التوسعة، والإبقاء على هدف الإيراد.", 18, 112, 174, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.65 });
        band(add, "علامة القيد", 18, 140, 1.4, 22, BRASS);
        paint(add, "القيد", "القيد تشغيلي. لا يُعالج بهدف مبيعات أعلى.", 24, 142, 168, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 600, color: CHARCOAL, textAlign: "right", lineHeight: 1.5 });
        hairline(add, "خط التوقيع", 18, 196, 52, "#cfc6b8", 0.35);
        paint(add, "التوقيع", "الاسم\nالصفة", 18, 202, 60, 14, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b6258", textAlign: "right", lineHeight: 1.4 });
        paint(add, "الجهة", entity, 100, 210, 92, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b6258", textAlign: "right" });
      });
    case "family-annual-kpis":
      return sheet("مؤشرات سنوية", theme, "#f4efe6", (add) => {
        band(add, "رأس قصير", 0, 0, 210, 16, FOREST);
        paint(add, "الرأس", "التقرير السنوي", 18, 4, 174, 8, { fontFamily: "Tajawal", fontSize: 11, fontWeight: 700, color: "#f4efe6", textAlign: "right" });
        paint(add, "العنوان", "ثلاثة أرقام تكفي", 18, 28, 174, 12, { fontFamily: "Tajawal", fontSize: 22, fontWeight: 800, color: FOREST, textAlign: "right" });
        hairline(add, "خط الأرقام", 18, 48, 174, "#d9cbb6", 0.4);
        paint(add, "رقم ١", "٩٤", 150, 56, 42, 16, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: FOREST, textAlign: "right" });
        paint(add, "تسمية ١", "رضا المستفيدين", 138, 74, 54, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#5c5348", textAlign: "right" });
        band(add, "مقياس ١", 150, 88, 42, 2.2, FOREST);
        tick(add, "فاصل ١", 132, 58, 28, "#d9cbb6");
        paint(add, "رقم ٢", "١٢", 86, 56, 40, 16, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: FOREST, textAlign: "right" });
        paint(add, "تسمية ٢", "مبادرة مكتملة", 78, 74, 48, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#5c5348", textAlign: "right" });
        band(add, "مقياس ٢", 96, 88, 28, 2.2, "#8a6232");
        tick(add, "فاصل ٢", 72, 58, 28, "#d9cbb6");
        paint(add, "رقم ٣", "٣٫٢", 18, 56, 48, 16, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: "#8a6232", textAlign: "right" });
        paint(add, "تسمية ٣", "عائد كل ريال", 18, 74, 48, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#5c5348", textAlign: "right" });
        band(add, "مقياس ٣", 18, 88, 36, 2.2, "#c6a05a");
        paint(add, "قراءة", "الرضا والعائد فوق الخطة. مبادرة واحدة ما زالت داخل الربع القادم، وهي ليست مؤشرًا على المنهج.", 18, 108, 174, 22, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        paint(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#7a6a58", textAlign: "right" });
      });
    case "family-editorial-open":
      return sheet("افتتاح تحريري", theme, "#fafafa", (add) => {
        paint(add, "كِكر", "ملف  ·  الاتصالات", 18, 16, 140, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: "#c2410c", textAlign: "right" });
        paint(add, "عدد الملف", "٠٤", 164, 12, 28, 12, { fontFamily: "Tajawal", fontSize: 16, fontWeight: 800, color: "#c2410c", textAlign: "left" });
        paint(add, "العنوان", "العنوان الذي\nيقود الصفحة", 18, 28, 174, 26, { fontFamily: "Noto Kufi Arabic", fontSize: 26, fontWeight: 700, color: "#12141a", textAlign: "right", lineHeight: 1.12 });
        add("image", { name: "الصورة الرئيسية", x: 0, y: 64, w: 148, h: 108, src: plate("press"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "هامش الصورة", "الصورة\nلا تمتد\nحتى الحافة\nاليمنى", 154, 78, 40, 36, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right", lineHeight: 1.45 });
        paint(add, "تعليق", "تعليق الصورة بمحاذاة حافتها، لا في منتصف الصفحة.", 18, 176, 148, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
        paint(add, "المتن", "فقرة تحت الصورة بمقياس النسخ. الإطار هو المسافة، لا مستطيل حول الكلام.", 18, 192, 120, 28, { fontFamily: "Noto Naskh Arabic", fontSize: 12, fontWeight: 500, color: "#12141a", textAlign: "right", lineHeight: 1.75 });
        paint(add, "الجهة", entity, 18, 268, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "right" });
      });
    case "family-editorial-quote":
      return sheet("اقتباس", theme, "#ffffff", (add) => {
        paint(add, "كِكر", "ملف", 18, 36, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: "#c2410c", textAlign: "right" });
        hairline(add, "علامة", 164, 58, 28, "#c2410c", 1.2);
        paint(add, "الاقتباس", "الجملة التي\nتستحق صفحة\nكاملة.", 18, 72, 174, 48, { fontFamily: "Noto Kufi Arabic", fontSize: 28, fontWeight: 700, color: "#12141a", textAlign: "right", lineHeight: 1.2 });
        paint(add, "النسبة", "الاسم  ·  الصفة", 18, 132, 120, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 600, color: "#c2410c", textAlign: "right" });
        paint(add, "سياق", "قيل في اجتماع الدورة، لا في حملة.", 18, 148, 140, 8, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: "#4b5563", textAlign: "right" });
        paint(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "right" });
      });
    case "family-minimal-prose":
      return sheet("متن", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "قسم  ·  ٠٣", 48, 20, 144, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "right" });
        paint(add, "هامش", "ملاحظة\nعلى الهامش\nلا تزيح المتن", 16, 36, 28, 28, { fontFamily: "IBM Plex Sans Arabic", fontSize: 7.5, fontWeight: 600, color: "#9ca3af", textAlign: "right", lineHeight: 1.45 });
        paint(add, "عنوان", "عنوان الفقرة", 48, 32, 144, 10, { fontFamily: "Tajawal", fontSize: 18, fontWeight: 800, color: INK, textAlign: "right" });
        hairline(add, "فاصل", 48, 46, 144, "#e5e7eb", 0.3);
        paint(add, "متن أول", "فقرة أولى على مقياس واحد. الحجم والوزن والمسافة هم التسلسل، لا لون إضافي ولا إطار.", 48, 54, 144, 28, { fontFamily: "Noto Naskh Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.8 });
        paint(add, "عنوان فرعي", "عنوان فرعي", 48, 92, 144, 8, { fontFamily: "Tajawal", fontSize: 14, fontWeight: 700, color: INK, textAlign: "right" });
        paint(add, "متن ثان", "فقرة ثانية تبقى على الشبكة نفسها. استبدال النص لا يطلب تحريك أي عنصر.", 48, 104, 144, 28, { fontFamily: "Noto Naskh Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.8 });
        paint(add, "رقم الصفحة", "٠٣", 18, 272, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "left" });
      });
    case "family-finance-ledger":
      return sheet("جدول مالي", theme, "#ffffff", (add) => {
        hairline(add, "خط الرأس", 18, 18, 174, "#0f3d2e", 1.1);
        hairline(add, "خط الرأس الثاني", 18, 20.2, 174, "#0f3d2e", 0.3);
        paint(add, "تصنيف", "مالي  ·  إغلاق الفترة", 18, 26, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#0f3d2e", textAlign: "right" });
        paint(add, "العنوان", "ملخص الإنفاق", 18, 36, 174, 10, { fontFamily: "Tajawal", fontSize: 20, fontWeight: 800, color: "#0f3d2e", textAlign: "right" });
        add("table", {
          name: "جدول الإنفاق",
          x: 18, y: 54, w: 174, h: 72,
          content: JSON.stringify([
            ["البند", "المعتمد", "الفعلي", "الفرق"],
            ["التشغيل", "١٢٠", "١١٤", "٦"],
            ["المشاريع", "٨٠", "٨٦", "−٦"],
            ["الاحتياطي", "٢٠", "١٨", "٢"],
            ["الإجمالي", "٢٢٠", "٢١٨", "٢"],
          ]),
          style: { cols: 4, rows: 5, fontSize: 10, fontFamily: "IBM Plex Sans Arabic", cellAlign: "center", headerBg: "#0f3d2e", headerColor: "#ffffff", stripeBg: "#f4f7f5" },
        });
        paint(add, "تسمية القراءة", "القراءة", 110, 136, 82, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#0f3d2e", textAlign: "right" });
        paint(add, "الخلاصة", "الفرق الصافي ٢ لصالح المعتمد. المشاريع تجاوزت، والتشغيل وفّر.", 110, 144, 82, 22, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.55 });
        paint(add, "تسمية الإجراء", "الإجراء", 18, 136, 82, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#8a6232", textAlign: "right" });
        paint(add, "الإجراء", "لا يُنقل وفر التشغيل إلى المشاريع قبل مراجعة العقد.", 18, 144, 84, 22, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.55 });
        paint(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#62736b", textAlign: "right" });
      });
    case "family-media-spread":
      return sheet("صفحة بصرية", theme, "#ffffff", (add) => {
        add("image", { name: "الصورة", x: 0, y: 0, w: 92, h: 297, src: plate("press"), style: { objectFit: "cover", radius: 0 } });
        paint(add, "كِكر", "اتصالات", 104, 28, 90, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#2563eb", textAlign: "right" });
        paint(add, "العنوان", "العنوان بجانب الصورة، لا فوق شريط", 104, 40, 90, 28, { fontFamily: "Tajawal", fontSize: 18, fontWeight: 800, color: "#111827", textAlign: "right", lineHeight: 1.25 });
        hairline(add, "فاصل", 154, 76, 40, "#2563eb", 0.8);
        paint(add, "متن أول", "العمود يشرح الصورة ولا يؤطرها. العرض ضيق لأن الصورة أخذت نصف الصفحة.", 104, 88, 90, 36, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        paint(add, "متن ثان", "التعليق هنا، في عمود النص، حتى يبقى قابلًا للتحرير دون أن يجلس على الصورة.", 104, 132, 90, 28, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        paint(add, "الجهة", entity, 104, 260, 90, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
      });
    case "family-leadership-close":
      return sheet("ختام", theme, IVORY, (add) => {
        paint(add, "تسمية", "ختام", 18, 48, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: BRASS, textAlign: "right" });
        paint(add, "الختام", "شكرًا لكم", 18, 64, 174, 16, { fontFamily: "Tajawal", fontSize: 32, fontWeight: 800, color: CHARCOAL, textAlign: "right" });
        hairline(add, "فاصل", 150, 88, 42, BRASS, 0.8);
        paint(add, "سطر", "النسخة التالية تصدر مع إغلاق الربع، لا مع إعادة وصف هذا الربع.", 18, 100, 160, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: "#4b453c", textAlign: "right", lineHeight: 1.6 });
        hairline(add, "خط التوقيع", 110, 150, 64, "#cfc6b8", 0.35);
        paint(add, "التوقيع", "الاسم\nالصفة", 110, 156, 64, 14, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 600, color: "#6b6258", textAlign: "right", lineHeight: 1.4 });
        paint(add, "التاريخ", "نهاية الفترة", 18, 160, 70, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#8a8175", textAlign: "right" });
        paint(add, "الجهة", entity, 18, 250, 174, 8, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: CHARCOAL, textAlign: "right" });
      });
    case "family-project-phases":
      return sheet("مراحل", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "تقرير مشروع", 18, 22, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#1d4ed8", textAlign: "right" });
        paint(add, "العنوان", "أربع مراحل", 18, 32, 120, 12, { fontFamily: "Tajawal", fontSize: 22, fontWeight: 800, color: "#0f172a", textAlign: "right" });
        paint(add, "الحالة", "الحالية: البناء", 140, 36, 52, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: "#1d4ed8", textAlign: "left" });
        hairline(add, "مسار", 18, 72, 174, "#cbd5e1", 0.6);
        ["الانطلاق", "البناء", "التسليم", "الإغلاق"].forEach((label, i) => {
          const x = 18 + i * 44;
          add("shape", {
            name: `نقطة ${i + 1}`,
            x: x + 16,
            y: 68,
            w: 8,
            h: 8,
            style: {
              fill: i === 1 ? "#1d4ed8" : "#ffffff",
              borderColor: "#1d4ed8",
              borderWidth: 0.6,
              radius: 4,
            },
          });
          paint(add, `رقم ${i + 1}`, `٠${i + 1}`, x, 84, 40, 8, { fontFamily: "Tajawal", fontSize: 11, fontWeight: 800, color: "#1d4ed8", textAlign: "center" });
          paint(add, `مرحلة ${i + 1}`, label, x, 96, 40, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 700, color: INK, textAlign: "center" });
        });
        paint(add, "ملاحظة", "البناء هو المرحلة الوحيدة المفتوحة. التسليم لا يبدأ قبل اعتماد قائمة النواقص.", 18, 120, 174, 18, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.65 });
        paint(add, "الجهة", entity, 18, 268, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#64748b", textAlign: "right" });
      });
    case "family-performance":
      return sheet("أداء", theme, "#ffffff", (add) => {
        paint(add, "تصنيف", "تقرير أداء", 18, 20, 110, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: FOREST, textAlign: "right" });
        paint(add, "العنوان", "مقارنة ربعين", 18, 30, 120, 12, { fontFamily: "Tajawal", fontSize: 22, fontWeight: 800, color: FOREST, textAlign: "right" });
        paint(add, "المؤشر", "+٦", 150, 26, 42, 14, { fontFamily: "Tajawal", fontSize: 26, fontWeight: 800, color: "#8a6232", textAlign: "left" });
        paint(add, "تسمية المؤشر", "صافي الحركة", 150, 42, 42, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#8a6232", textAlign: "left" });
        add("table", {
          name: "مقارنة",
          x: 18, y: 58, w: 174, h: 64,
          content: JSON.stringify([
            ["المؤشر", "الربع السابق", "هذا الربع"],
            ["الإنجاز", "٨٨", "٩٤"],
            ["الالتزام", "٩١", "٩٠"],
            ["الجودة", "٨٤", "٨٩"],
          ]),
          style: { cols: 3, rows: 4, fontSize: 10, fontFamily: "IBM Plex Sans Arabic", cellAlign: "center", headerBg: "#1b4d3e", headerColor: "#ffffff" },
        });
        paint(add, "قراءة", "الالتزام هو المؤشر الوحيد الذي تراجع. الباقي تحسّن دون تغيير المنهج.", 18, 132, 174, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.6 });
        paint(add, "المصدر", "المصدر: تقرير الربعين — مكتب الأداء.", 18, 156, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#7a6a58", textAlign: "right" });
        paint(add, "الجهة", entity, 18, 268, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#7a6a58", textAlign: "right" });
      });
    case "family-premium-cover":
      return sheet("غلاف فاخر", theme, CHARCOAL, (add) => {
        add("shape", { name: "إطار", x: 12, y: 12, w: 186, h: 273, style: { fill: "transparent", borderColor: BRASS, borderWidth: 0.45, radius: 0 } });
        paint(add, "تصنيف", "نسخة محدودة", 24, 28, 162, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: BRASS, textAlign: "right" });
        paint(add, "السنة", "٢٠٢٦", 24, 28, 40, 6, { fontFamily: "Tajawal", fontSize: 9, fontWeight: 700, color: "#a8a29e", textAlign: "left" });
        paint(add, "العنوان", "تقرير\nالقيادة", 24, 150, 162, 36, { fontFamily: "Tajawal", fontSize: 40, fontWeight: 800, color: "#f6f3ee", textAlign: "right", lineHeight: 1 });
        hairline(add, "خط", 150, 194, 36, BRASS, 0.9);
        paint(add, "سطر", "يُتداول داخل الجهة. لا يُنشر كما هو.", 24, 204, 150, 10, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: "#d6d3d1", textAlign: "right" });
        hairline(add, "خط البيانات", 24, 246, 162, "#44403c", 0.3);
        paint(add, "الجهة", entity, 24, 254, 110, 8, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: BRASS, textAlign: "right" });
        paint(add, "النسخة", "نسخة ٠١", 140, 254, 46, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#a8a29e", textAlign: "left" });
      });
    default:
      return null;
  }
}
