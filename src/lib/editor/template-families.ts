import { uid } from "@/lib/utils";
import {
  createElement,
  nextZ,
  normalizeZ,
  type CanvasEl,
  type Page,
  type Theme,
} from "./model";

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

function plate(color: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="${color}"/><rect x="48" y="48" width="864" height="504" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="2"/><text x="480" y="318" text-anchor="middle" fill="rgba(255,255,255,0.88)" font-family="sans-serif" font-size="28">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function text(
  add: Add,
  name: string,
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: CanvasEl["style"],
) {
  add("text", { name, content, x, y, w, h, style });
}

function rule(
  add: Add,
  name: string,
  x: number,
  y: number,
  w: number,
  color: string,
  stroke = 0.35,
) {
  add("line", { name, x, y, w, h: 0, style: { color, stroke } });
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
        add("shape", { name: "شريط الهوية", x: 0, y: 0, w: 210, h: 78, style: { fill: NAVY, borderWidth: 0, radius: 0 } });
        rule(add, "خط ذهبي", 0, 78, 210, GOLD, 1.4);
        add("logo", { name: "الشعار", x: 18, y: 18, w: 18, h: 18 });
        text(add, "تصنيف", "تقرير مؤسسي", 42, 20, 150, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#d7deea", textAlign: "right" });
        text(add, "عنوان الغلاف", "تقرير الأداء\nالسنوي", 18, 98, 174, 42, { fontFamily: "Tajawal", fontSize: 34, fontWeight: 800, color: NAVY, textAlign: "right", lineHeight: 1.05 });
        rule(add, "فاصل العنوان", 150, 148, 42, GOLD, 0.9);
        text(add, "مقدمة", "ملخص يضع نطاق التقرير والجهة والفترة في سطرين، ويترك بقية الغلاف للعنوان.", 18, 160, 120, 28, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        text(add, "تسمية الجهة", "الجهة", 18, 248, 70, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
        text(add, "اسم الجهة", entity, 18, 256, 80, 10, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: NAVY, textAlign: "right" });
        text(add, "تسمية التاريخ", "الفترة", 120, 248, 72, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
        text(add, "التاريخ", "يناير — ديسمبر", 110, 256, 82, 10, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: NAVY, textAlign: "right" });
      });
    case "family-gov-opener":
      return sheet("فاتحة قسم", theme, PAPER, (add) => {
        text(add, "رقم القسم", "٠٢", 18, 48, 174, 36, { fontFamily: "Tajawal", fontSize: 64, fontWeight: 800, color: NAVY, textAlign: "right", lineHeight: 0.9 });
        rule(add, "فاصل", 18, 96, 48, GOLD, 1);
        text(add, "عنوان القسم", "النتائج\nوالأثر", 18, 108, 140, 36, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: INK, textAlign: "right", lineHeight: 1.15 });
        text(add, "سطر القسم", "ما الذي تغيّر، ولماذا يهم القرار التالي.", 18, 156, 120, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: "#3d4a5c", textAlign: "right", lineHeight: 1.6 });
        text(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b7280", textAlign: "right" });
      });
    case "family-corp-cover":
      return sheet("غلاف شركات", theme, "#ffffff", (add) => {
        add("shape", { name: "عمود الهوية", x: 0, y: 0, w: 8, h: 297, style: { fill: "#12344d", borderWidth: 0, radius: 0 } });
        text(add, "تصنيف", "CORPORATE  ·  تقرير أعمال", 22, 28, 168, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#667887", textAlign: "right" });
        text(add, "العنوان", "تقرير الأعمال\nالربع الحالي", 22, 48, 168, 36, { fontFamily: "Tajawal", fontSize: 30, fontWeight: 800, color: "#12344d", textAlign: "right", lineHeight: 1.12 });
        rule(add, "خط أساس", 22, 108, 168, "#d5dde4", 0.4);
        text(add, "جهة", entity, 22, 118, 70, 12, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: "#12344d", textAlign: "right" });
        text(add, "إعداد", "مكتب المدير العام", 96, 118, 46, 12, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 600, color: INK, textAlign: "right" });
        text(add, "حالة", "نسخة للمراجعة", 146, 118, 44, 12, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 600, color: "#b08a4f", textAlign: "right" });
        text(add, "المتن", "هذا الغلاف يعتمد على عمود هوية واحد وصفّ بيانات على خط أساس، بلا بطاقات أو زخرفة.", 22, 160, 150, 28, { fontFamily: "IBM Plex Sans Arabic", fontSize: 12, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
      });
    case "family-exec-brief":
      return sheet("موجز تنفيذي", theme, IVORY, (add) => {
        text(add, "تصنيف", "موجز تنفيذي", 18, 22, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: BRASS, textAlign: "right" });
        text(add, "العنوان", "ما يجب أن يُحسم\nهذا الأسبوع", 18, 34, 174, 28, { fontFamily: "Tajawal", fontSize: 26, fontWeight: 800, color: CHARCOAL, textAlign: "right", lineHeight: 1.15 });
        rule(add, "فاصل", 18, 70, 36, BRASS, 0.9);
        text(add, "الرقم", "٤٢٪", 18, 84, 70, 18, { fontFamily: "Tajawal", fontSize: 32, fontWeight: 800, color: CHARCOAL, textAlign: "right", lineHeight: 1 });
        text(add, "تسمية الرقم", "نمو الإيراد مقابل الخطة", 18, 106, 78, 10, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b6258", textAlign: "right" });
        text(add, "العمود الأول", "الخلاصة في جملتين: أين يقف الأداء، وما القرار المطلوب من القيادة.", 18, 132, 82, 40, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        text(add, "العمود الثاني", "القيد الوحيد هذا الربع هو الطاقة التشغيلية، لا الطلب.", 100, 132, 92, 40, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        rule(add, "خط التوقيع", 18, 246, 52, "#cfc6b8", 0.35);
        text(add, "التوقيع", "الاسم\nالصفة", 18, 252, 60, 14, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b6258", textAlign: "right", lineHeight: 1.4 });
        text(add, "الجهة", entity, 110, 262, 82, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#6b6258", textAlign: "right" });
      });
    case "family-annual-kpis":
      return sheet("مؤشرات سنوية", theme, "#f4efe6", (add) => {
        add("shape", { name: "رأس قصير", x: 0, y: 0, w: 210, h: 22, style: { fill: FOREST, borderWidth: 0, radius: 0 } });
        text(add, "الرأس", "التقرير السنوي", 18, 6, 174, 10, { fontFamily: "Tajawal", fontSize: 11, fontWeight: 700, color: "#f4efe6", textAlign: "right" });
        text(add, "العنوان", "ثلاثة أرقام تكفي", 18, 40, 174, 14, { fontFamily: "Tajawal", fontSize: 22, fontWeight: 800, color: FOREST, textAlign: "right" });
        rule(add, "خط الأرقام", 18, 64, 174, "#d9cbb6", 0.4);
        text(add, "رقم ١", "٩٤", 18, 74, 50, 18, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: FOREST, textAlign: "right" });
        text(add, "تسمية ١", "رضا المستفيدين", 18, 96, 50, 12, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#5c5348", textAlign: "right" });
        add("shape", { name: "فاصل ١", x: 76, y: 76, w: 0.35, h: 28, style: { fill: "#d9cbb6", borderWidth: 0, radius: 0 } });
        text(add, "رقم ٢", "١٢", 84, 74, 46, 18, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: FOREST, textAlign: "right" });
        text(add, "تسمية ٢", "مبادرة مكتملة", 84, 96, 46, 12, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#5c5348", textAlign: "right" });
        add("shape", { name: "فاصل ٢", x: 138, y: 76, w: 0.35, h: 28, style: { fill: "#d9cbb6", borderWidth: 0, radius: 0 } });
        text(add, "رقم ٣", "٣٫٢", 146, 74, 46, 18, { fontFamily: "Tajawal", fontSize: 28, fontWeight: 800, color: "#8a6232", textAlign: "right" });
        text(add, "تسمية ٣", "عائد كل ريال", 146, 96, 46, 12, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#5c5348", textAlign: "right" });
        text(add, "قراءة", "القراءة: الأداء تجاوز الخطة في الرضا والعائد، وتأخر في إغلاق مبادرة واحدة ما زالت ضمن الربع القادم.", 18, 132, 174, 24, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        text(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#7a6a58", textAlign: "right" });
      });
    case "family-editorial-open":
      return sheet("افتتاح تحريري", theme, "#fafafa", (add) => {
        text(add, "كِكر", "ملف  ·  الاتصالات", 18, 18, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: "#c2410c", textAlign: "right" });
        text(add, "العنوان", "العنوان الذي\nيقود الصفحة", 18, 30, 174, 32, { fontFamily: "Noto Kufi Arabic", fontSize: 28, fontWeight: 700, color: "#12141a", textAlign: "right", lineHeight: 1.15 });
        add("image", { name: "الصورة الرئيسية", x: 18, y: 74, w: 174, h: 98, src: plate("#1f2937", "IMAGE"), style: { radius: 0 } });
        text(add, "تعليق", "تعليق الصورة في سطر واحد، بمحاذاة حافة الصورة.", 18, 176, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#6b7280", textAlign: "right" });
        text(add, "المتن", "فقرة قصيرة تحت الصورة. لا بطاقة حولها: المسافة البيضاء هي الإطار.", 18, 196, 120, 28, { fontFamily: "Noto Naskh Arabic", fontSize: 12, fontWeight: 500, color: "#12141a", textAlign: "right", lineHeight: 1.75 });
      });
    case "family-editorial-quote":
      return sheet("اقتباس", theme, "#ffffff", (add) => {
        text(add, "كِكر", "ملف", 18, 48, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: "#c2410c", textAlign: "right" });
        rule(add, "علامة", 18, 78, 24, "#c2410c", 1.2);
        text(add, "الاقتباس", "الجملة التي\nتستحق صفحة\nكاملة.", 18, 88, 160, 48, { fontFamily: "Noto Kufi Arabic", fontSize: 26, fontWeight: 700, color: "#12141a", textAlign: "right", lineHeight: 1.25 });
        text(add, "النسبة", "الاسم  ·  الصفة", 18, 150, 120, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 600, color: "#c2410c", textAlign: "right" });
        text(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "right" });
      });
    case "family-minimal-prose":
      return sheet("متن", theme, "#ffffff", (add) => {
        text(add, "تصنيف", "قسم  ·  ٠٣", 18, 20, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "right" });
        text(add, "عنوان", "عنوان الفقرة", 18, 32, 174, 12, { fontFamily: "Tajawal", fontSize: 18, fontWeight: 800, color: INK, textAlign: "right" });
        rule(add, "فاصل", 18, 48, 174, "#e5e7eb", 0.3);
        text(add, "متن أول", "فقرة أولى بمحاذاة الهامش نفسه. الحجم والوزن والمسافة هم التسلسل، لا لون إضافي.", 18, 56, 174, 28, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.8 });
        text(add, "عنوان فرعي", "عنوان فرعي", 18, 96, 174, 8, { fontFamily: "Tajawal", fontSize: 13, fontWeight: 700, color: INK, textAlign: "right" });
        text(add, "متن ثان", "فقرة ثانية تبقى على الشبكة نفسها. يمكن استبدال النص دون تحريك أي عنصر.", 18, 108, 174, 32, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.8 });
        text(add, "رقم الصفحة", "٠٣", 18, 272, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#9ca3af", textAlign: "left" });
      });
    case "family-finance-ledger":
      return sheet("جدول مالي", theme, "#ffffff", (add) => {
        rule(add, "خط الرأس", 18, 20, 174, "#0f3d2e", 1.1);
        text(add, "تصنيف", "مالي  ·  مسودة", 18, 26, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#0f3d2e", textAlign: "right" });
        text(add, "العنوان", "ملخص الإنفاق", 18, 36, 174, 12, { fontFamily: "Tajawal", fontSize: 20, fontWeight: 800, color: "#0f3d2e", textAlign: "right" });
        add("table", {
          name: "جدول الإنفاق",
          x: 18,
          y: 58,
          w: 174,
          h: 78,
          content: JSON.stringify([
            ["البند", "المعتمد", "الفعلي", "الفرق"],
            ["التشغيل", "١٢٠", "١١٤", "٦"],
            ["المشاريع", "٨٠", "٨٦", "−٦"],
            ["الاحتياطي", "٢٠", "١٨", "٢"],
            ["الإجمالي", "٢٢٠", "٢١٨", "٢"],
          ]),
          style: { cols: 4, rows: 5, fontSize: 10, fontFamily: "IBM Plex Sans Arabic", cellAlign: "center", headerBg: "#0f3d2e", headerColor: "#ffffff" },
        });
        text(add, "الخلاصة", "الفرق الصافي ٢ لصالح المعتمد. عدّل الخلايا من الخصائص؛ الشبكة لا تتغير.", 18, 146, 174, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 10, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.6 });
        text(add, "الجهة", entity, 18, 268, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 600, color: "#62736b", textAlign: "right" });
      });
    case "family-media-spread":
      return sheet("صفحة بصرية", theme, "#ffffff", (add) => {
        add("image", { name: "الصورة", x: 0, y: 0, w: 210, h: 118, src: plate("#111827", "VISUAL"), style: { radius: 0 } });
        text(add, "كِكر", "اتصالات", 18, 128, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#2563eb", textAlign: "right" });
        text(add, "العنوان", "العنوان تحت الصورة، لا فوقها", 18, 138, 174, 14, { fontFamily: "Tajawal", fontSize: 20, fontWeight: 800, color: "#111827", textAlign: "right" });
        text(add, "عمود", "عمود أول يشرح الصورة دون إطار.", 18, 162, 82, 36, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
        text(add, "عمود مقابل", "عمود ثانٍ بعرض الشبكة نفسها، لا بطاقة.", 110, 162, 82, 36, { fontFamily: "Noto Naskh Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
      });
    case "family-leadership-close":
      return sheet("ختام", theme, IVORY, (add) => {
        rule(add, "فاصل", 78, 108, 54, BRASS, 0.8);
        text(add, "الختام", "شكرًا\nلكم", 18, 120, 174, 28, { fontFamily: "Tajawal", fontSize: 32, fontWeight: 800, color: CHARCOAL, textAlign: "center", lineHeight: 1.05 });
        text(add, "سطر", "النسخة التالية تصدر مع إغلاق الربع.", 30, 158, 150, 10, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: "#4b453c", textAlign: "center" });
        text(add, "التاريخ", "نهاية الفترة", 30, 174, 150, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 600, color: "#8a8175", textAlign: "center" });
        text(add, "الجهة", entity, 18, 210, 174, 8, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: CHARCOAL, textAlign: "center" });
      });
    case "family-project-phases":
      return sheet("مراحل", theme, "#ffffff", (add) => {
        text(add, "تصنيف", "تقرير مشروع", 18, 22, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: "#1d4ed8", textAlign: "right" });
        text(add, "العنوان", "أربع مراحل", 18, 32, 174, 12, { fontFamily: "Tajawal", fontSize: 22, fontWeight: 800, color: "#0f172a", textAlign: "right" });
        rule(add, "مسار", 18, 78, 174, "#cbd5e1", 0.6);
        ["الانطلاق", "البناء", "التسليم", "الإغلاق"].forEach((label, i) => {
          const x = 18 + i * 44;
          add("shape", { name: `نقطة ${i + 1}`, x: x + 14, y: 74, w: 8, h: 8, style: { fill: i === 0 ? "#1d4ed8" : "#ffffff", borderColor: "#1d4ed8", borderWidth: 0.6, radius: 4 } });
          text(add, `رقم ${i + 1}`, `٠${i + 1}`, x, 90, 40, 8, { fontFamily: "Tajawal", fontSize: 11, fontWeight: 800, color: "#1d4ed8", textAlign: "center" });
          text(add, `مرحلة ${i + 1}`, label, x, 100, 40, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: INK, textAlign: "center" });
        });
        text(add, "ملاحظة", "المرحلة الحالية هي البناء. بقية النص يُكتب هنا، لا داخل بطاقة لكل مرحلة.", 18, 128, 174, 20, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.7 });
      });
    case "family-performance":
      return sheet("أداء", theme, "#ffffff", (add) => {
        text(add, "تصنيف", "تقرير أداء", 18, 20, 174, 6, { fontFamily: "IBM Plex Sans Arabic", fontSize: 8, fontWeight: 700, color: FOREST, textAlign: "right" });
        text(add, "العنوان", "مقارنة ربعين", 18, 30, 120, 12, { fontFamily: "Tajawal", fontSize: 20, fontWeight: 800, color: FOREST, textAlign: "right" });
        text(add, "المؤشر", "+٦", 150, 26, 42, 14, { fontFamily: "Tajawal", fontSize: 22, fontWeight: 800, color: "#8a6232", textAlign: "left" });
        add("table", {
          name: "مقارنة",
          x: 18,
          y: 54,
          w: 174,
          h: 64,
          content: JSON.stringify([
            ["المؤشر", "الربع السابق", "هذا الربع"],
            ["الإنجاز", "٨٨", "٩٤"],
            ["الالتزام", "٩١", "٩٠"],
            ["الجودة", "٨٤", "٨٩"],
          ]),
          style: { cols: 3, rows: 4, fontSize: 10, fontFamily: "IBM Plex Sans Arabic", cellAlign: "center", headerBg: "#1b4d3e", headerColor: "#ffffff" },
        });
        text(add, "قراءة", "الالتزام هو المؤشر الوحيد الذي تراجع. الباقي تحسّن دون تغيير المنهج.", 18, 128, 174, 16, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: INK, textAlign: "right", lineHeight: 1.6 });
      });
    case "family-premium-cover":
      return sheet("غلاف فاخر", theme, CHARCOAL, (add) => {
        text(add, "تصنيف", "PREMIUM", 18, 36, 174, 8, { fontFamily: "IBM Plex Sans Arabic", fontSize: 9, fontWeight: 700, color: BRASS, textAlign: "right" });
        text(add, "العنوان", "تقرير\nالقيادة", 18, 78, 174, 40, { fontFamily: "Tajawal", fontSize: 40, fontWeight: 800, color: "#f6f3ee", textAlign: "right", lineHeight: 1.02 });
        rule(add, "خط", 18, 132, 36, BRASS, 0.9);
        text(add, "سطر", "نسخة محدودة التداول داخل الجهة.", 18, 144, 140, 10, { fontFamily: "IBM Plex Sans Arabic", fontSize: 11, fontWeight: 500, color: "#d6d3d1", textAlign: "right" });
        text(add, "الجهة", entity, 18, 250, 174, 8, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 700, color: BRASS, textAlign: "right" });
      });
    default:
      return null;
  }
}
