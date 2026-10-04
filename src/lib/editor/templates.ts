import { uid } from "@/lib/utils";
import {
  type CanvasEl,
  type PackId,
  type Page,
  type Project,
  type Theme,
  type ThemeId,
  THEMES,
  createElement,
  nextZ,
  normalizeZ,
} from "./model";
import { FAMILY_TEMPLATES, buildFamilyPage } from "./template-families";
import { bindDesignSkill } from "./design-skill";
import {
  A4,
  BODY,
  META,
  ROLE,
  SLIDE,
  band,
  cell,
  folio,
  hairline,
  kpiCard,
  mark,
  mediaInk,
  paint,
  plate,
  runningHead,
  tableStyle,
  tick,
} from "./template-layouts";

bindDesignSkill("packs");

function page(
  name: string,
  theme: Theme,
  build: (add: Add) => void,
  size?: { w?: number; h?: number; bg?: string },
): Page {
  const p: Page = {
    id: uid("page"),
    name,
    // A caller-supplied paint wins (truly blank sheets); themes otherwise own
    // the paper colour so every packed page keeps its identity.
    bg: size?.bg ?? theme.paper,
    w: size?.w,
    h: size?.h,
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

type Add = (type: CanvasEl["type"], over?: Partial<CanvasEl>) => CanvasEl;

function header(add: Add, theme: Theme, title: string, w = 210) {
  add("shape", {
    name: "رأس الصفحة",
    x: 0,
    y: 0,
    w,
    h: 24,
    style: { fill: theme.primary, borderWidth: 0, radius: 0 },
  });
  add("line", {
    name: "خط ذهبي",
    x: 0,
    y: 24.5,
    w,
    h: 3,
    style: { color: theme.accent, stroke: 0.7 },
  });
  add("text", {
    name: "عنوان الصفحة",
    x: 22,
    y: 6,
    w: w - 70,
    h: 12,
    content: title,
    style: {
      fontFamily: "Tajawal",
      fontSize: 16,
      color: "#ffffff",
      fontWeight: 800,
      textAlign: "right",
      lineHeight: 1,
    },
  });
  add("logo", { name: "شعار مصغر", x: w - 34, y: 4, w: 16, h: 16 });
}

function footer(add: Add, theme: Theme, org: string, w = 210, h = 297) {
  add("line", {
    name: "خط سفلي",
    x: 24,
    y: h - 21,
    w: w - 48,
    h: 3,
    style: { color: theme.line, stroke: 0.35 },
  });
  add("text", {
    name: "تذييل",
    x: 24,
    y: h - 16,
    w: w - 48,
    h: 8,
    content: `${org}  ·  وثيقة رسمية`,
    style: {
      fontFamily: "Cairo",
      fontSize: 8,
      color: theme.muted,
      fontWeight: 600,
      textAlign: "center",
      lineHeight: 1.2,
    },
  });
}

function officialPages(theme: Theme, org: string): Page[] {
  const entity = org.trim() || "الجهة التنفيذية";
  return [
    page("الغلاف", theme, (add) => {
      const ink = mediaInk(theme);
      mark(add, "زاوية هندسية", 168, 0, 42, 36, ink.soft, "triangle");
      mark(add, "معين الغلاف", 186, 16, 7, 7, ink.gold, "diamond");
      add("logo", { name: "شعار الجهة", x: 16, y: 14, w: 16, h: 16 });
      paint(add, "تصنيف", "تقرير سنوي  ·  ٢٠٢٦", 36, 16, 120, 6, { ...ROLE.meta, color: theme.muted });
      paint(add, "عنوان التقرير", "تقرير الأداء\nالسنوي", 16, 40, 170, 36, { ...ROLE.display, fontSize: 34, color: ink.green });
      hairline(add, "خيط ذهبي", 120, 82, 66, ink.gold, 1.1);
      paint(add, "نبذة الغلاف", "ما اكتمل في الخدمة، وما بقي مفتوحًا أمام اللجنة في الدورة القادمة.", 16, 90, 168, 14, { ...ROLE.body, fontSize: 12, color: theme.ink });
      add("image", {
        name: "صورة الغلاف", x: 0, y: 112, w: 210, h: 70,
        src: plate("field"), style: { objectFit: "cover", radius: 0 },
      });
      mark(add, "كتلة قطرية", 0, 176, 210, 121, ink.green, "diagonal");
      paint(add, "تعليق الصورة", "الميدان  ·  الربع الأخير", 16, 196, 178, 8, { ...ROLE.caption, color: "#f4f7f5" });
      paint(add, "تسمية الجهة", "الجهة", 16, 214, 178, 5, { ...ROLE.caption, color: ink.gold });
      paint(add, "اسم الجهة", entity, 16, 222, 178, 12, { ...ROLE.h2, fontSize: 16, color: "#f7f6f3" });
      paint(add, "الفترة", "يناير — ديسمبر", 16, 244, 100, 8, { ...ROLE.meta, color: "#d7e3dc" });
      paint(add, "النسخة", "نسخة داخلية", 120, 244, 74, 8, { ...ROLE.meta, color: ink.gold, textAlign: "left" });
    }, A4),

    page("المحتويات", theme, (add) => {
      runningHead(add, theme, "المحتويات");
      paint(add, "عنوان المحتويات", "ما في هذا التقرير", 16, 28, 120, 12, { ...ROLE.h1, color: theme.primary });
      paint(add, "مقدمة الفهرس", "من النطاق إلى التوصية، بالترتيب الذي يُعرض به على لجنة الأداء.", 16, 46, 118, 16, { ...ROLE.body, fontSize: 11, color: theme.ink });
      paint(add, "جمهور الوثيقة", "للجنة الأداء\nنسخة داخلية\nلا تُنشر", 144, 46, 50, 22, { ...ROLE.caption, color: theme.muted, lineHeight: 1.55 });
      const items: [string, string, string][] = [
        ["٠١", "المقدمة والنطاق", "٠٣"],
        ["٠٢", "الأهداف المعتمدة", "٠٤"],
        ["٠٣", "أثر الخدمة", "٠٥"],
        ["٠٤", "المؤشرات", "٠٦"],
        ["٠٥", "التوصية", "٠٧"],
        ["٠٦", "الخاتمة", "٠٨"],
      ];
      items.forEach(([num, title, pg], i) => {
        const y = 80 + i * 26;
        paint(add, `رقم ${num}`, num, 158, y, 36, 8, { ...ROLE.h3, color: theme.accent });
        paint(add, `بند ${title}`, title, 40, y, 112, 8, { ...ROLE.h2, fontSize: 14, color: theme.ink });
        paint(add, `صفحة ${num}`, pg, 16, y, 18, 8, { ...ROLE.meta, fontSize: 12, color: theme.muted, textAlign: "left" });
        hairline(add, `فاصل ${num}`, 16, y + 14, 178, theme.line, 0.3);
      });
      paint(add, "ملاحظة الإصدار", "إصدار ديسمبر ٢٠٢٦. أرقام الصفحات تُستبدل عند إعادة الترقيم.", 16, 242, 178, 8, { ...ROLE.caption, color: theme.muted });
      folio(add, theme, entity, "٠٢");
    }, A4),

    page("ملخص تنفيذي", theme, (add) => {
      runningHead(add, theme, "ملخص تنفيذي");
      paint(add, "عنوان الفقرة", "قبل التفاصيل", 16, 28, 110, 12, { ...ROLE.h1, color: theme.primary });
      paint(add, "الرقم القائد", "٩٤٪", 128, 28, 66, 16, { ...ROLE.display, fontSize: 28, color: theme.primary, lineHeight: 1 });
      paint(add, "تسمية الرقم", "من خطة العام", 128, 46, 66, 6, { ...ROLE.caption, color: theme.muted });
      paint(add, "العمود الأول", "أُنجز أربعة وتسعون في المئة من الخطة. الرضا ارتفع إلى ٤٫٧، وأُقفلت ثماني عشرة مبادرة من عشرين. الفجوة المتبقية في التحول الرقمي، وشراكة ما زالت في التعاقد.", 16, 62, 178, 32, { ...ROLE.body, color: theme.ink });
      band(add, "علامة الاقتباس", 16, 102, 1.4, 20, theme.accent);
      paint(add, "اقتباس الملخص", "الطلب ليس العائق. العائق طاقة التشغيل في وحدة واحدة.", 22, 102, 172, 14, { ...ROLE.h2, fontSize: 13, color: theme.primary, lineHeight: 1.4 });
      add("table", {
        name: "جدول الملخص",
        x: 16, y: 132, w: 178, h: 78,
        content: JSON.stringify([
          ["المحور", "المستهدف", "المتحقق", "الحالة"],
          ["التشغيل", "١٠٠٪", "٩٤٪", "ضمن المسار"],
          ["رضا المستفيدين", "٤٫٥", "٤٫٧", "تجاوز"],
          ["المبادرات", "٢٠", "١٨", "مبادرتان مفتوحتان"],
          ["الشراكات الفاعلة", "١٢", "١٢", "مكتمل"],
        ]),
        style: tableStyle(theme, 4, 5),
      });
      paint(add, "مصدر الجدول", "المصدر: مكتب التخطيط — إغلاق ديسمبر ٢٠٢٦.", 16, 216, 178, 6, { ...ROLE.caption, color: theme.muted });
      paint(add, "الحكم", "النتائج لا تطلب خطة جديدة. تطلب إغلاق ما فُتح، وتثبيت ما ثبت أثره.", 16, 228, 178, 16, { ...ROLE.body, fontSize: 12, color: theme.ink });
      folio(add, theme, entity, "٠٣");
    }, A4),

    page("الإنجازات", theme, (add) => {
      const ink = mediaInk(theme);
      runningHead(add, theme, "الأهداف");
      paint(add, "عنوان الصفحة", "ثلاثة أهداف لهذا العام", 16, 26, 178, 12, { ...ROLE.h1, color: ink.green });
      const photo = add("image", {
        name: "صورة القسم", x: 16, y: 46, w: 78, h: 96,
        src: plate("field"), style: { objectFit: "cover", radius: 0 },
      });
      const mask = mark(add, "قناع الصورة", 16, 46, 78, 96, "transparent", "curve-side");
      photo.clippedBy = mask.id;
      const goals: [string, string, string][] = [
        ["٠١", "تشغيل مستمر", "أربع بوابات انتقلت إلى تغطية كاملة، وانخفض الانتظار من ٢٦ دقيقة إلى ١١."],
        ["٠٢", "شراكة واحدة", "اتفقت الجهة مع الإسناد الطبي على تغطية المنافذ الغربية."],
        ["٠٣", "مرجع واحد", "حل دليل تشغيل واحد محل ثلاث نسخ ميدانية."],
      ];
      goals.forEach(([num, title, body], i) => {
        const y = 46 + i * 34;
        mark(add, `دائرة ${num}`, 104, y, 10, 10, ink.green, "circle");
        paint(add, `رقم ${num}`, num, 104, y + 2.2, 10, 5, { ...ROLE.caption, fontSize: 6, color: "#ffffff", textAlign: "center" });
        paint(add, `عنوان ${title}`, title, 118, y, 76, 8, { ...ROLE.h3, color: ink.green });
        paint(add, `متن ${title}`, body, 118, y + 10, 76, 18, { ...ROLE.body, fontSize: 10, color: theme.ink, lineHeight: 1.35 });
      });
      paint(add, "تعليق الصورة", "الميدان بعد تعديل المناوبة", 16, 146, 78, 8, { ...ROLE.caption, color: theme.muted });
      add("image", {
        name: "صورة ثانية", x: 16, y: 162, w: 178, h: 72,
        src: plate("court"), style: { objectFit: "cover", radius: 0 },
      });
      band(add, "تعليق ثان", 16, 218, 178, 14, ink.green);
      paint(add, "سطر التعليق", "تغطية كاملة  ·  بلا زيادة في عدد الموظفين", 24, 221, 162, 8, { ...ROLE.caption, color: "#f4f7f5" });
      folio(add, theme, entity, "٠٤");
    }, A4),

    page("المؤشرات", theme, (add) => {
      const ink = mediaInk(theme);
      runningHead(add, theme, "أبرز المؤشرات");
      paint(add, "عنوان المؤشرات", "قراءة الإغلاق", 16, 26, 178, 10, { ...ROLE.h1, fontSize: 20, color: ink.green });
      const cards: [string, string][] = [
        ["١٨٦", "معاملة مغلقة"],
        ["٩٤", "نسبة الإنجاز"],
        ["٤١", "زيارة ميدانية"],
        ["١٢", "شراكة سارية"],
        ["١١", "دقيقة انتظار"],
        ["٨", "مبادرات أُقفلت"],
      ];
      cards.forEach(([value, label], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = col === 0 ? 108 : 16;
        const y = 44 + row * 58;
        kpiCard(add, label, x, y, 86, 52, value, label, ink.green, ink.gold, theme.ink);
      });
      band(add, "شريط الملخص", 16, 220, 178, 16, ink.green);
      paint(add, "ملخص أول", "٣٤٨٦", 110, 222, 70, 8, { ...ROLE.h3, color: "#ffffff", textAlign: "center" });
      paint(add, "تسمية أول", "إجمالي العمليات", 110, 230, 70, 5, { ...ROLE.caption, color: ink.gold, textAlign: "center" });
      paint(add, "ملخص ثان", "٧٣٠", 24, 222, 70, 8, { ...ROLE.h3, color: "#ffffff", textAlign: "center" });
      paint(add, "تسمية ثان", "ما زال مفتوحًا", 24, 230, 70, 5, { ...ROLE.caption, color: ink.gold, textAlign: "center" });
      folio(add, theme, entity, "٠٥");
    }, A4),

    page("الخاتمة", theme, (add) => {
      runningHead(add, theme, "التوصية");
      paint(add, "عنوان الخاتمة", "ما نوصي باعتماده", 16, 28, 178, 12, { ...ROLE.h1, color: theme.primary });
      paint(add, "تمهيد التوصية", "ثلاثة بنود فقط. ما عداها يبقى في الملاحق.", 16, 46, 178, 8, { ...ROLE.body, fontSize: 12, color: theme.ink });
      const recs: [string, string, string][] = [
        ["٠١", "تمديد", "تمديد مبادرة التحول الرقمي إلى الربع الأول دون زيادة الاعتماد."],
        ["٠٢", "تجميد", "تجميد الشراكة غير المقيَّمة حتى يصدر تقرير أثرها."],
        ["٠٣", "تثبيت", "تثبيت دليل التشغيل الجديد مرجعًا وحيدًا للوحدات الميدانية."],
      ];
      recs.forEach(([num, title, body], i) => {
        const y = 64 + i * 32;
        paint(add, `توصية ${num}`, num, 166, y, 28, 8, { ...ROLE.h3, color: theme.accent });
        paint(add, `عنوان ${title}`, title, 16, y, 144, 8, { ...ROLE.h2, color: theme.ink });
        paint(add, `نص ${num}`, body, 16, y + 12, 178, 12, { ...ROLE.body, fontSize: 12, color: theme.ink });
      });
      paint(add, "خلاصة", "لا تُطلب خطة موازية. يُطلب إغلاق ما فُتح وتثبيت ما ثبت أثره.", 16, 168, 178, 14, { ...ROLE.body, color: theme.ink });
      hairline(add, "خط التوقيع", 118, 200, 76, theme.ink, 0.35);
      paint(add, "التوقيع", "اسم المسؤول\nالمنصب", 118, 206, 76, 14, { ...ROLE.meta, fontSize: 10, color: theme.ink, lineHeight: 1.45 });
      add("stamp", { name: "ختم الاعتماد", x: 16, y: 196, w: 32, h: 32, content: "خُتم" });
      paint(add, "تاريخ الاعتماد", "لاعتماد الدورة القادمة", 52, 206, 58, 12, { ...ROLE.caption, color: theme.muted, lineHeight: 1.35 });
      folio(add, theme, entity, "٠٦");
    }, A4),
  ];
}

function eidPages(theme: Theme, org: string): Page[] {
  const entity = org.trim() || "إدارة الإعلام والاتصال المؤسسي";
  return [
    page("غلاف العيد", theme, (add) => {
      const ink = mediaInk(theme);
      band(add, "حقل أخضر", 0, 0, 210, 297, ink.green);
      hairline(add, "خط أبيض", 16, 28, 178, "#ffffff", 0.7);
      hairline(add, "خط أخضر فاتح", 16, 31, 178, ink.line, 0.7);
      paint(add, "الجهة", entity, 16, 40, 150, 8, { ...ROLE.meta, fontSize: 10, color: ink.gold });
      add("logo", { name: "شعار الجهة", x: 172, y: 36, w: 18, h: 18 });
      paint(add, "عنوان التقرير", "توثيق ميدان\nعيد الأضحى", 16, 58, 178, 36, {
        ...ROLE.display, fontSize: 34, color: "#f7f6f3", lineHeight: 1.05,
      });
      paint(add, "السنة", "١٤٤٧ هـ", 16, 100, 80, 10, { ...ROLE.h2, fontSize: 16, color: ink.gold });
      add("image", {
        name: "صورة الغلاف", x: 0, y: 122, w: 210, h: 96,
        src: plate("court"), style: { objectFit: "cover", radius: 0 },
      });
      band(add, "شريط هندسي", 0, 230, 210, 18, "#145c42");
      paint(add, "تعليق الشريط", "المنافذ والفرق الميدانية", 16, 234, 178, 8, { ...ROLE.caption, color: "#f7f6f3" });
      paint(add, "جهة الإصدار", "إدارة الإعلام والاتصال المؤسسي", 16, 262, 178, 8, { ...ROLE.meta, color: "#d7e3dc" });
    }, { ...A4, bg: mediaInk(theme).green }),

    page("المؤشرات الميدانية", theme, (add) => {
      runningHead(add, theme, "الميدان");
      paint(add, "عنوان الصفحة", "ما عمله الميدان", 16, 28, 178, 12, { ...ROLE.h1, color: theme.primary });
      paint(add, "الرقم", "٤٨", 16, 48, 70, 22, { ...ROLE.display, fontSize: 42, color: theme.primary, lineHeight: 0.9 });
      paint(add, "تسمية الرقم", "موقعًا غُطّي\nعلى مدار العيد", 16, 74, 70, 14, { ...ROLE.caption, color: theme.muted, lineHeight: 1.4 });
      const side: [string, string][] = [
        ["١٢٠", "مشاركة توعوية"],
        ["١٦", "فرقة ميدانية"],
        ["١٠٠٪", "تغطية المنافذ بعد اليوم الأول"],
      ];
      side.forEach(([value, label], i) => {
        const y = 50 + i * 18;
        paint(add, `رقم ${label}`, value, 100, y, 36, 8, { ...ROLE.h2, color: theme.ink });
        paint(add, `تسمية ${label}`, label, 138, y, 56, 8, { ...ROLE.caption, color: theme.muted });
        if (i < side.length - 1) hairline(add, `حد ${label}`, 100, y + 14, 94, theme.line, 0.25);
      });
      hairline(add, "حد المتن", 16, 108, 178, theme.line, 0.35);
      paint(add, "المتن", "شملت الفعاليات تنظيم الحركة عند المنافذ، ونقاط توعية للقادمين والمغادرين، وتوثيقًا لكل محطة عملت فيها الفرق. الملاحظة الوحيدة: تأخر مواد التوعية إلى منفذين في اليوم الأول، وأُغلقت قبل الذروة.", 16, 118, 178, 36, { ...ROLE.body, color: theme.ink });
      band(add, "علامة الميدان", 16, 164, 1.4, 22, theme.accent);
      paint(add, "ملاحظة ميدانية", "ملاحظة قائد الفرق", 22, 162, 80, 6, { ...ROLE.meta, color: theme.accent });
      paint(add, "نص الملاحظة", "لا فجوة تغطية بعد اليوم الأول. التقرير التالي يقيس الأثر، ولا يعيد وصف الحركة.", 22, 172, 172, 16, { ...ROLE.body, fontSize: 12, color: theme.ink });
      folio(add, theme, entity, "٠٢");
    }, A4),

    page("معرض الصور", theme, (add) => {
      const ink = mediaInk(theme);
      add("image", {
        name: "صورة الاستقبال", x: 16, y: 16, w: 178, h: 88,
        src: plate("field"), style: { objectFit: "cover", radius: 0 },
      });
      band(add, "تعليق علوي", 16, 88, 178, 14, ink.green);
      paint(add, "تعليق الاستقبال", "استقبال المنفذ الرئيسي  ·  أول أيام العيد", 22, 91, 166, 8, { ...ROLE.caption, color: "#f7f6f3" });
      add("image", {
        name: "صورة التوعية", x: 16, y: 112, w: 178, h: 78,
        src: plate("court"), style: { objectFit: "cover", radius: 0 },
      });
      band(add, "تعليق سفلي", 16, 176, 178, 14, ink.green);
      paint(add, "تعليق التوعية", "نقطة التوعية  ·  تنظيم الحركة", 22, 179, 166, 8, { ...ROLE.caption, color: "#f7f6f3" });
      paint(add, "ملاحظة المعرض", "الصورتان من اليوم الأول. البيان صدر بعد إغلاق فجوة المواد، لا قبلها.", 16, 202, 178, 16, { ...ROLE.body, fontSize: 12, color: theme.ink });
      folio(add, theme, entity, "٠٣");
    }, A4),

    page("ختام", theme, (add) => {
      const ink = mediaInk(theme);
      band(add, "حقل الختام", 0, 0, 210, 297, ink.green);
      hairline(add, "خط أبيض", 16, 36, 80, "#ffffff", 0.8);
      hairline(add, "خط ذهبي", 16, 40, 48, ink.gold, 0.8);
      paint(add, "تسمية الختام", "ختام التوثيق", 16, 52, 178, 6, { ...ROLE.meta, color: ink.gold });
      paint(add, "عنوان الختام", "شكرًا لكم", 16, 66, 178, 20, {
        ...ROLE.display, fontSize: 40, color: "#f7f6f3", lineHeight: 1,
      });
      paint(add, "نص الختام", "نقدر جهد الفرق الميدانية والإسناد الإعلامي. النسخة التالية تصدر مع تقرير الأثر.", 16, 100, 168, 20, { ...ROLE.body, fontSize: 13, color: "#e7efe9" });
      add("image", {
        name: "شريط الختام", x: 16, y: 140, w: 178, h: 70,
        src: plate("night"), style: { objectFit: "cover", radius: 8 },
      });
      paint(add, "الجهة", entity, 16, 226, 178, 8, { ...ROLE.h3, color: ink.gold });
      paint(add, "الإدارة", "إدارة الإعلام والاتصال المؤسسي", 16, 238, 178, 8, { ...ROLE.meta, color: "#e7efe9" });
    }, { ...A4, bg: mediaInk(theme).green }),
  ];
}

function briefingPages(theme: Theme, org: string): Page[] {
  const entity = org.trim() || "مكتب المدير العام";
  return [
    page("غلاف العرض", theme, (add) => {
      const ink = mediaInk(theme);
      mark(add, "زاوية", 170, 0, 40, 34, ink.soft, "triangle");
      mark(add, "معين", 184, 18, 6, 6, ink.gold, "diamond");
      paint(add, "تصنيف العرض", "عرض قيادي  ·  للتداول الداخلي", 16, 20, 150, 6, { ...ROLE.meta, color: theme.muted });
      paint(add, "عنوان العرض", "موجز الاجتماع", 16, 34, 178, 16, { ...ROLE.display, fontSize: 32, color: ink.green, lineHeight: 1 });
      hairline(add, "خيط العنوان", 130, 56, 56, ink.gold, 1.1);
      paint(add, "جملة العرض", "صفحة للقرار. التفاصيل في المرفقات، لا في هذه الورقة.", 16, 66, 178, 12, { ...ROLE.body, fontSize: 13, color: theme.ink });
      const times: [string, string][] = [
        ["٠٥ د", "الحكم"],
        ["١٥ د", "القيد"],
        ["٢٥ د", "الاعتماد"],
      ];
      times.forEach(([time, label], i) => {
        const y = 100 + i * 28;
        mark(add, `دائرة ${label}`, 176, y, 12, 12, ink.green, "circle");
        paint(add, `وقت ${label}`, time, 16, y, 40, 10, { ...ROLE.h3, color: ink.green });
        paint(add, `بند ${label}`, label, 60, y, 100, 10, { ...ROLE.h2, color: theme.ink });
      });
      band(add, "كتلة البيانات", 0, 210, 210, 87, ink.green);
      hairline(add, "خيط الكتلة", 0, 210, 210, ink.gold, 0.8);
      paint(add, "الجهة", entity, 16, 224, 160, 10, { ...ROLE.h2, fontSize: 16, color: "#ffffff" });
      paint(add, "التاريخ", "سبتمبر ٢٠٢٦  ·  اجتماع القيادة", 16, 240, 160, 8, { ...ROLE.meta, color: ink.gold });
      add("logo", { name: "شعار الجهة", x: 176, y: 224, w: 16, h: 16 });
    }, A4),

    page("الموجز", theme, (add) => {
      runningHead(add, theme, "الموجز");
      paint(add, "العنوان", "القرار المطلوب", 16, 28, 178, 10, { ...ROLE.h1, fontSize: 20, color: theme.ink });
      paint(add, "الرقم", "٤٢٪", 16, 46, 90, 22, { ...ROLE.display, fontSize: 40, color: theme.primary, lineHeight: 0.9 });
      paint(add, "تسمية الرقم", "نمو الإيراد مقابل الخطة، والطاقة عند سقفها.", 16, 72, 90, 14, { ...ROLE.caption, color: theme.muted, lineHeight: 1.4 });
      paint(add, "الحكم", "الاستمرار على هذا الإيقاع يصطدم بسقف وحدة الإسناد. الخيار: تأجيل توسعة واحدة، والإبقاء على هدف الإيراد.", 112, 50, 82, 40, { ...ROLE.body, fontSize: 12, color: theme.ink });
      hairline(add, "حد القيد", 16, 100, 178, theme.line, 0.35);
      paint(add, "عنوان القيد", "القيد", 16, 110, 40, 6, { ...ROLE.meta, color: theme.accent });
      paint(add, "نص القيد", "القيد طاقة تشغيلية، لا طلب السوق. أي هدف أعلى من الطاقة الحالية قرار توظيف، لا قرار مبيعات.", 16, 120, 178, 20, { ...ROLE.body, color: theme.ink });
      paint(add, "الخيار", "الخيار المعروض", 16, 152, 178, 6, { ...ROLE.meta, color: theme.primary });
      paint(add, "نص الخيار", "تُؤجَّل التوسعة إلى الربع القادم. لا يُفتح مسار توظيف قبل خطة الطاقة.", 16, 162, 178, 16, { ...ROLE.h2, fontFamily: BODY, fontWeight: 500, fontSize: 13, color: theme.ink, lineHeight: 1.55 });
      folio(add, theme, entity, "٠٢");
    }, A4),

    page("القرار", theme, (add) => {
      runningHead(add, theme, "الاعتماد");
      paint(add, "العنوان", "ثلاثة بنود", 16, 28, 120, 12, { ...ROLE.h1, color: theme.primary });
      paint(add, "الحالة العامة", "معروض على الجلسة", 16, 32, 70, 8, { ...ROLE.meta, color: theme.accent, textAlign: "left" });
      const items: [string, string, string][] = [
        ["٠١", "اعتماد", "تأجيل التوسعة إلى الربع القادم مع الإبقاء على هدف الإيراد."],
        ["٠٢", "تكليف", "إدارة الإسناد ترفع خطة الطاقة خلال عشرة أيام."],
        ["٠٣", "إيقاف", "لا يُفتح مسار توظيف قبل اعتماد خطة الطاقة."],
      ];
      items.forEach(([num, title, body], i) => {
        const y = 56 + i * 40;
        paint(add, `رقم ${num}`, num, 166, y, 28, 8, { ...ROLE.meta, color: theme.accent });
        paint(add, `عنوان ${title}`, title, 16, y, 140, 10, { ...ROLE.h1, fontSize: 18, color: theme.ink });
        paint(add, `متن ${title}`, body, 16, y + 14, 178, 12, { ...ROLE.body, fontSize: 12, color: theme.ink });
        hairline(add, `حد ${title}`, 16, y + 30, 178, theme.line, 0.25);
      });
      hairline(add, "خط التوقيع", 118, 188, 76, theme.ink, 0.35);
      paint(add, "التوقيع", "الاسم\nالصفة", 118, 194, 76, 14, { ...ROLE.meta, fontSize: 10, color: theme.ink, lineHeight: 1.4 });
      paint(add, "الموعد", "يُحسم في الجلسة، لا بالتمرير.", 16, 198, 90, 12, { ...ROLE.caption, color: theme.muted, lineHeight: 1.4 });
      folio(add, theme, entity, "٠٣");
    }, A4),
  ];
}

function statsInfographicPage(theme: Theme, org: string): Page {
  const ink = mediaInk(theme);
  return page("لوحة مؤشرات", theme, (add) => {
    runningHead(add, theme, "أين يقف التنفيذ");
    paint(add, "عنوان اللوحة", "قراءة الأسبوع", 16, 26, 178, 10, { ...ROLE.h1, color: ink.green });
    const cards: [string, string][] = [
      ["٧٨٪", "الإنجاز العام"],
      ["٩٢٪", "رضا المستفيدين"],
      ["٩٠٤", "حالة مغلقة"],
      ["٢٧", "حالة مفتوحة"],
    ];
    cards.forEach(([value, label], i) => {
      const x = i % 2 === 0 ? 108 : 16;
      const y = 44 + Math.floor(i / 2) * 62;
      kpiCard(add, label, x, y, 86, 56, value, label, ink.green, ink.gold, theme.ink);
    });
    band(add, "شريط الملخص", 16, 176, 178, 16, ink.green);
    paint(add, "الملخص", "١٢ فرقة ميدانية ما زالت على الجدول", 24, 180, 162, 8, { ...ROLE.caption, color: "#f4f7f5" });
    paint(add, "القراءة", "الرضا يسبق الجدول. الحالات المفتوحة كلها في فرقة واحدة.", 16, 204, 178, 14, { ...ROLE.body, color: theme.ink });
    folio(add, theme, org, "٠٢");
  }, A4);
}

function tablePage(theme: Theme, org: string): Page {
  return page("جدول بيانات", theme, (add) => {
    runningHead(add, theme, "المقارنة");
    paint(add, "العنوان", "أين الفارق", 16, 28, 110, 12, { ...ROLE.h1, color: theme.primary });
    paint(add, "الفرق", "−٥", 150, 26, 44, 14, { ...ROLE.display, fontSize: 26, color: theme.accent, textAlign: "left", lineHeight: 1 });
    paint(add, "تسمية الفرق", "صافي الحالات", 150, 42, 44, 6, { ...ROLE.caption, color: theme.muted, textAlign: "left" });
    paint(add, "المقدمة", "الفارق السالب مركّز في التشغيل والصيانة. بقية البنود ضمن المسار أو أعلى بقليل.", 16, 52, 178, 14, { ...ROLE.body, fontSize: 12, color: theme.ink });
    add("table", {
      name: "جدول المقارنة",
      x: 16, y: 74, w: 178, h: 96,
      content: JSON.stringify([
        ["البند", "الوحدة", "المستهدف", "المتحقق", "الفارق"],
        ["تشغيل المنافذ", "حالة", "١٠٠", "٩٤", "−٦"],
        ["خدمة المستفيد", "حالة", "٨٠", "٨٣", "+٣"],
        ["الصيانة الدورية", "حالة", "٦٠", "٥٧", "−٣"],
        ["التدريب الميداني", "حالة", "٤٠", "٤١", "+١"],
        ["الإجمالي", "—", "٢٨٠", "٢٧٥", "−٥"],
      ]),
      style: tableStyle(theme, 5, 6),
    });
    band(add, "علامة القراءة", 16, 182, 1.4, 22, theme.accent);
    paint(add, "القراءة", "فارق خمس حالات لا يغيّر الحكم على العام، ويحدد أين تُراجع الخطة: التشغيل والصيانة.", 22, 180, 172, 20, { ...ROLE.body, color: theme.ink });
    paint(add, "المصدر", "المصدر: السجل التشغيلي — ديسمبر ٢٠٢٦.", 16, 214, 178, 6, { ...ROLE.caption, color: theme.muted });
    folio(add, theme, org, "٠٣");
  }, A4);
}

function infographicPage(theme: Theme, org: string): Page {
  return page("إنفوجرافيك", theme, (add) => {
    paint(add, "تسمية", "منهج العمل", 16, 18, 178, 6, { ...ROLE.meta, color: theme.accent });
    paint(add, "العنوان", "خمس مراحل، بترتيب واحد", 16, 28, 178, 12, { ...ROLE.h1, color: theme.primary });
    const steps: [string, string, string][] = [
      ["٠١", "التخطيط", "تحديد النطاق والجهة المالكة قبل جمع أي رقم."],
      ["٠٢", "الجمع", "البيانات من مصدر واحد، مع تاريخ إغلاق معلن."],
      ["٠٣", "التحليل", "المؤشر يُقرأ مع قيده، لا منفصلًا عنه."],
      ["٠٤", "الإخراج", "صفحة قرار ثم الملاحق، لا العكس."],
      ["٠٥", "الأثر", "ما تغيّر بعد النشر، لا عدد الصفحات."],
    ];
    steps.forEach(([num, title, body], i) => {
      const y = 54 + i * 38;
      tick(add, `عمود ${num}`, 186, y, 28, i === 2 ? theme.accent : theme.line);
      paint(add, `رقم ${num}`, num, 156, y, 24, 8, { ...ROLE.h3, color: i === 2 ? theme.accent : theme.primary });
      paint(add, `عنوان ${title}`, title, 16, y, 134, 8, { ...ROLE.h2, color: theme.ink });
      paint(add, `متن ${title}`, body, 16, y + 12, 164, 12, { ...ROLE.body, fontSize: 11, color: theme.ink, lineHeight: 1.45 });
    });
    folio(add, theme, org, "٠٤");
  }, A4);
}

function coverPage(theme: Theme, org: string): Page {
  return officialPages(theme, org)[0];
}

function slidesPages(theme: Theme, org: string): Page[] {
  const entity = org.trim() || "اسم الجهة";
  return [
    page("شريحة الغلاف", theme, (add) => {
      const ink = mediaInk(theme);
      band(add, "حقل أخضر", 0, 0, 338.7, 190.5, ink.green);
      hairline(add, "خيط", 24, 28, 120, ink.gold, 0.9);
      add("logo", { name: "شعار", x: 300, y: 18, w: 18, h: 18 });
      paint(add, "تصنيف", "عرض تنفيذي", 24, 40, 200, 6, { ...ROLE.meta, fontSize: 11, color: ink.gold });
      paint(add, "عنوان العرض", "النتائج الرئيسية", 24, 54, 250, 22, { ...ROLE.display, fontSize: 32, color: "#f7f6f3", lineHeight: 1 });
      paint(add, "الجملة", "رقمان للإغلاق، وجملة للحكم. الباقي في المرفق.", 24, 86, 220, 12, { ...ROLE.body, fontFamily: META, fontSize: 13, color: "#e7efe9" });
      add("image", {
        name: "حقل الغلاف", x: 0, y: 118, w: 338.7, h: 72.5,
        src: plate("night"), style: { objectFit: "cover", radius: 0 },
      });
    }, { ...SLIDE, bg: mediaInk(theme).green }),
    page("شريحة المؤشرات", theme, (add) => {
      runningHead(add, theme, "المؤشرات الرئيسية", SLIDE.w);
      paint(add, "الرقم القائد", "٩٦٪", 210, 36, 112, 28, { ...ROLE.display, fontSize: 44, color: theme.primary, lineHeight: 1 });
      paint(add, "تسمية القائد", "اكتمال الخطة", 210, 68, 112, 8, { ...ROLE.meta, fontSize: 12, color: theme.muted });
      tick(add, "فاصل المؤشرات", 196, 40, 40, theme.line);
      paint(add, "رقم ثان", "٩٠٤", 16, 38, 70, 14, { ...ROLE.display, fontSize: 24, color: theme.ink, lineHeight: 1 });
      paint(add, "تسمية ثانية", "حالة مغلقة", 90, 42, 96, 8, { ...ROLE.meta, fontSize: 12, color: theme.muted });
      paint(add, "رقم ثالث", "٢٧", 16, 62, 70, 12, { ...ROLE.h1, fontSize: 20, color: theme.ink });
      paint(add, "تسمية ثالثة", "حالة ما زالت مفتوحة", 90, 66, 96, 8, { ...ROLE.meta, fontSize: 12, color: theme.muted });
      band(add, "مسار الإنجاز", 16, 104, 306, 2, theme.line);
      band(add, "امتلاء الإنجاز", 16, 104, 240, 2, theme.primary);
      paint(add, "نسبة الشريط", "٧٨٪ إنجاز عام", 16, 112, 140, 6, { ...ROLE.caption, color: theme.muted });
      paint(add, "القراءة", "الإغلاق شبه مكتمل. الحالات المفتوحة لا تغيّر اتجاه الربع.", 16, 132, 306, 12, { ...ROLE.body, fontSize: 14, color: theme.ink });
      folio(add, theme, entity, "٠٢", SLIDE.w, SLIDE.h);
    }, SLIDE),
  ];
}

type TemplateInk = {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  line: string;
  surface: string;
};

function identity(theme: Theme): TemplateInk {
  return {
    primary: theme.id === "official" ? "#0c3d2c" : theme.primary,
    accent: theme.id === "official" ? "#c6a05a" : theme.accent,
    ink: theme.ink,
    muted: theme.muted,
    line: theme.line,
    surface: theme.surface,
  };
}

function editorialPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  const margin = cell(10, 2);
  const col = cell(0, 9);
  return page("تحريرية", theme, (add) => {
    paint(add, "كِكر", "ملف  ·  الخدمة", col.x, 20, col.w, 6, { ...ROLE.meta, color: c.accent });
    paint(add, "العنوان", "الطاقة ثابتة\nوالطلب ليس كذلك", col.x, 32, col.w, 28, { ...ROLE.h1, fontWeight: 800, fontSize: 24, color: c.primary });
    paint(add, "حقيقة هامشية", "١٨٪\nزيادة\nالمعاملات", margin.x, 36, margin.w, 28, { ...ROLE.caption, color: c.accent, lineHeight: 1.35 });
    hairline(add, "فاصل", col.x, 70, col.w, c.line, 0.35);
    paint(add, "المتن", "بقيت المنافذ على عددها، وارتفع الوارد. الانتظار الذي يراه المستفيد ليس ضعف حملة، بل مناوبة لم تُراجع منذ اعتماد الخطة.", col.x, 80, col.w, 36, { ...ROLE.body, color: c.ink });
    paint(add, "عنوان فرعي", "ما يُطلب من هذه الصفحة", col.x, 124, col.w, 8, { ...ROLE.h2, color: c.ink });
    paint(add, "التتمة", "أن تُقرأ الطاقة مع الرقم، لا بعده. التوصية في القسم التالي، وهذه الصفحة لا تلخّص العام.", col.x, 138, col.w, 28, { ...ROLE.body, color: c.ink });
    paint(add, "الجهة", org || "اسم الجهة", 16, 248, 120, 8, { ...ROLE.h3, color: c.primary });
    paint(add, "رقم الصفحة", "٠١", 16, 272, 178, 6, { ...ROLE.folio, color: c.muted });
  }, A4);
}

function institutionalGridPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("شبكة مؤسسية", theme, (add) => {
    band(add, "شريط الهوية", 0, 0, 210, 8, c.primary);
    paint(add, "العنوان", "كيف يُرفع الرقم", 16, 20, 178, 12, { ...ROLE.h1, fontSize: 20, color: c.primary });
    paint(add, "المقدمة", "كل صف ثلاثة حقول على خط واحد: البند، القيمة، والجملة التي تمنع إساءة قراءته.", 16, 38, 178, 14, { ...ROLE.body, fontSize: 12, color: c.ink });
    const rows: [string, string, string][] = [
      ["النطاق", "٦ قطاعات", "كل قطاع يرفع رقمه إلى مكتب واحد."],
      ["الإيقاع", "شهري", "الإغلاق في آخر خميس من الشهر."],
      ["المرجع", "دليل ٢٠٢٦", "النسخ السابقة أُخرجت من التداول."],
      ["الاعتماد", "لجنة واحدة", "لا يصدر رقم بلا توقيع المقرر."],
      ["النشر", "بعد الاعتماد", "لا يُرسل جدول إلى القيادة قبل التوقيع."],
    ];
    rows.forEach(([label, value, note], i) => {
      const y = 62 + i * 32;
      hairline(add, `خط ${label}`, 16, y, 178, c.line, 0.3);
      paint(add, `بند ${label}`, label, 150, y + 8, 44, 8, { ...ROLE.meta, color: c.accent });
      paint(add, `قيمة ${label}`, value, 96, y + 6, 48, 10, { ...ROLE.h2, color: c.primary });
      paint(add, `شرح ${label}`, note, 16, y + 8, 76, 14, { ...ROLE.body, fontSize: 11, color: c.ink, lineHeight: 1.4 });
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 236, 120, 8, { ...ROLE.meta, color: c.muted });
    paint(add, "التاريخ", "الفترة الحالية", 16, 248, 178, 6, { ...ROLE.caption, color: c.muted, textAlign: "left" });
  }, A4);
}

function dataFocusPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تركيز البيانات", theme, (add) => {
    runningHead(add, { ...theme, muted: c.muted, line: c.line }, "رقم واحد");
    paint(add, "الرقم", "٩٤", 16, 32, 178, 32, { ...ROLE.display, fontSize: 64, color: c.primary, lineHeight: 0.85 });
    paint(add, "التسمية", "من مئة  ·  إنجاز الخطة المعتمدة", 16, 70, 178, 8, { ...ROLE.meta, fontSize: 11, color: c.muted });
    paint(add, "الجملة", "الستة الناقصة كلها في محور التشغيل. الخدمة والتمكين أُغلقا على الخطة.", 16, 84, 178, 14, { ...ROLE.body, fontSize: 13, color: c.ink });
    add("table", {
      name: "جدول التركيز",
      x: 16, y: 108, w: 178, h: 58,
      content: JSON.stringify([
        ["المحور", "الخطة", "الفعلي"],
        ["التشغيل", "٤٠", "٣٤"],
        ["الخدمة", "٣٥", "٣٥"],
        ["التمكين", "٢٥", "٢٥"],
      ]),
      style: tableStyle({ ...theme, primary: c.primary, surface: c.surface, line: c.line, ink: c.ink }, 3, 4),
    });
    paint(add, "فرق موجب", "٠", 120, 178, 36, 12, { ...ROLE.h1, fontSize: 20, color: c.primary });
    paint(add, "شرح موجب", "الخدمة والتمكين على الخطة", 120, 192, 74, 10, { ...ROLE.caption, color: c.muted, lineHeight: 1.35 });
    tick(add, "فاصل الفرق", 108, 180, 24, c.line);
    paint(add, "فرق سالب", "−٦", 16, 178, 50, 12, { ...ROLE.h1, fontSize: 20, color: c.accent });
    paint(add, "شرح سالب", "عجز التشغيل وحده", 16, 192, 80, 8, { ...ROLE.caption, color: c.muted });
    paint(add, "الأثر", "معالجة العجز لا تمر برفع هدف الخدمة. الخدمة أغلقت.", 16, 214, 178, 12, { ...ROLE.body, fontSize: 12, color: c.ink });
    folio(add, { ...theme, line: c.line, muted: c.muted }, org, "٠٥");
  }, A4);
}

function verticalFlowPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تدفق رأسي", theme, (add) => {
    paint(add, "العنوان", "من الطلب إلى الأثر", 16, 18, 140, 10, { ...ROLE.h1, fontSize: 20, color: c.primary });
    paint(add, "الجهة", org || "اسم الجهة", 16, 32, 140, 6, { ...ROLE.caption, color: c.muted });
    const steps: [string, string, string, boolean][] = [
      ["٠١", "الطلب", "يصل مكتوبًا، برقم وتاريخ، ولا يُعتمد شفهيًا.", false],
      ["٠٢", "الفرز", "غير المكتمل يُرد في اليوم نفسه.", false],
      ["٠٣", "التنفيذ", "هذه المرحلة الحالية. لها مالك واحد، وموعد واحد، ولا تُفتح مرحلة المراجعة قبلها.", true],
      ["٠٤", "المراجعة", "المراجع ليس المنفّذ.", false],
      ["٠٥", "الأثر", "يُقاس بعد ثلاثين يومًا من التسليم.", false],
    ];
    let y = 48;
    steps.forEach(([num, title, body, current]) => {
      paint(add, `رقم ${num}`, num, 166, y, 28, 8, { ...ROLE.h3, color: current ? c.accent : c.primary });
      paint(add, `عنوان ${title}`, title, 16, y, 144, 8, { ...ROLE.h2, color: current ? c.primary : c.ink });
      paint(add, `متن ${title}`, body, 16, y + 12, 178, current ? 18 : 10, {
        ...ROLE.body, fontSize: 11, fontWeight: current ? 700 : 500, color: c.ink, lineHeight: 1.45,
      });
      y += current ? 40 : 30;
    });
  }, A4);
}

function asymmetricPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تحريرية غير متماثلة", theme, (add) => {
    add("image", {
      name: "الصورة القائدة", x: 122, y: 0, w: 88, h: 297,
      src: plate("press"), style: { objectFit: "cover", radius: 0 },
    });
    paint(add, "كِكر", "تغطية", 16, 28, 96, 6, { ...ROLE.meta, color: c.accent });
    paint(add, "العنوان", "البيان تأخر\nيومًا عن الصورة", 16, 40, 96, 28, { ...ROLE.h1, fontWeight: 800, fontSize: 18, color: c.primary, lineHeight: 1.25 });
    hairline(add, "فاصل", 16, 76, 36, c.accent, 1);
    paint(add, "المتن", "الصورة من المنفذ الغربي في اليوم الثاني. البيان صدر في اليوم الثالث، بعد إغلاق فجوة المواد لا قبلها.", 16, 88, 96, 48, { ...ROLE.body, fontSize: 12, color: c.ink });
    paint(add, "التعليق", "اليوم الثاني  ·  المنفذ الغربي  ·  قبل البيان", 16, 148, 96, 16, { ...ROLE.caption, color: c.muted, lineHeight: 1.45 });
    paint(add, "الجهة", org || "اسم الجهة", 16, 260, 96, 10, { ...ROLE.h3, color: c.primary });
  }, A4);
}

function modularPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("وحدات معيارية", theme, (add) => {
    paint(add, "كِكر", "قراءة مركّبة", 16, 18, 178, 6, { ...ROLE.meta, color: c.accent });
    paint(add, "الوحدة العريضة", "أربع بوابات صارت تغطية كاملة، وانخفض الانتظار إلى الثلث.", 16, 28, 178, 16, { ...ROLE.h2, fontSize: 16, color: c.primary, lineHeight: 1.35 });
    add("image", {
      name: "وحدة الصورة", x: 16, y: 54, w: 78, h: 96,
      src: plate("field"), style: { objectFit: "cover", radius: 0 },
    });
    paint(add, "وحدة جانبية", "الانخفاض لم يحتج موظفين جدد. الذي تغيّر هو توزيع المناوبة.", 102, 54, 92, 24, { ...ROLE.body, fontSize: 12, color: c.ink });
    paint(add, "بند أول", "٢٦ دقيقة كان متوسط الانتظار قبل التعديل", 102, 86, 92, 12, { ...ROLE.meta, fontSize: 10, color: c.ink, lineHeight: 1.35 });
    paint(add, "بند ثان", "١١ دقيقة بعد أن صارت المناوبة كاملة", 102, 102, 92, 12, { ...ROLE.meta, fontSize: 10, color: c.ink, lineHeight: 1.35 });
    paint(add, "بند ثالث", "صفر زيادة في عدد الموظفين الميدانيين", 102, 118, 92, 12, { ...ROLE.meta, fontSize: 10, color: c.ink, lineHeight: 1.35 });
    paint(add, "تعليق الصورة", "المنفذ الرئيسي  ·  بعد تعديل المناوبة", 16, 152, 78, 10, { ...ROLE.caption, color: c.muted, lineHeight: 1.3 });
    hairline(add, "فاصل الاقتباس", 16, 172, 178, c.line, 0.35);
    band(add, "علامة الاقتباس", 16, 184, 22, 1.1, c.accent);
    paint(add, "اقتباس", "الطلب لم يكن العائق. العائق مناوبة لم تُراجع منذ اعتماد الخطة.", 16, 192, 178, 16, { ...ROLE.body, fontSize: 13, color: c.ink });
    paint(add, "الجهة", org || "اسم الجهة", 16, 248, 178, 8, { ...ROLE.meta, color: c.muted });
  }, A4);
}

function executivePage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("ملخص تنفيذي", theme, (add) => {
    paint(add, "تصنيف", "ملخص تنفيذي", 16, 28, 178, 6, { ...ROLE.meta, color: c.accent });
    paint(add, "الرسالة", "نبقي الهدف.\nونؤجل التوسعة.", 16, 42, 178, 36, { ...ROLE.display, fontSize: 30, color: c.primary, lineHeight: 1.12 });
    hairline(add, "فاصل", 154, 88, 40, c.accent, 1);
    paint(add, "الرقم", "٤٢٪", 16, 104, 70, 16, { ...ROLE.display, fontSize: 28, color: c.ink, lineHeight: 1 });
    paint(add, "تسمية الرقم", "فوق الخطة\nوتحت الطاقة", 16, 122, 70, 12, { ...ROLE.caption, color: c.muted, lineHeight: 1.35 });
    paint(add, "المتن", "لا تُطلب شريحة إضافية. يُطلب قرار في هذه الجلسة، والمرفقات لمن أراد السند.", 96, 106, 98, 32, { ...ROLE.body, fontSize: 13, color: c.ink });
    hairline(add, "خط التوقيع", 16, 210, 52, c.line, 0.4);
    paint(add, "التوقيع", "الاسم\nالصفة", 16, 216, 60, 14, { ...ROLE.meta, fontSize: 10, color: c.muted, lineHeight: 1.4 });
    paint(add, "الجهة", org || "اسم الجهة", 100, 220, 94, 8, { ...ROLE.h3, color: c.primary });
    paint(add, "الجلسة", "اجتماع القيادة  ·  هذا الأسبوع", 100, 232, 94, 6, { ...ROLE.caption, color: c.muted });
  }, A4);
}

function statisticalPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("قراءة إحصائية", theme, (add) => {
    runningHead(add, { ...theme, muted: c.muted, line: c.line }, "الرضا");
    paint(add, "الرقم", "٤.٧", 120, 28, 74, 18, { ...ROLE.display, fontSize: 32, color: c.primary, lineHeight: 1 });
    paint(add, "التسمية", "متوسط الرضا من خمسة", 120, 48, 74, 8, { ...ROLE.caption, color: c.muted });
    paint(add, "العينة", "١٢٠٠ مستفيد  ·  هامش ±٠.٢  ·  اكتمال ٩٢٪", 16, 36, 96, 16, { ...ROLE.caption, color: c.muted, lineHeight: 1.45 });
    const bars: [string, number][] = [
      ["الخدمة", 86],
      ["السرعة", 74],
      ["الوضوح", 91],
      ["المتابعة", 68],
    ];
    const base = 176;
    hairline(add, "قاعدة الرسم", 20, base, 170, c.ink, 0.4);
    bars.forEach(([label, value], i) => {
      const x = 32 + i * 42;
      const h = value * 0.85;
      band(add, `عمود ${label}`, x, base - h, 16, h, i === 2 ? c.accent : c.primary);
      const digits = "٠١٢٣٤٥٦٧٨٩";
      paint(add, `قيمة ${label}`, String(value).replace(/[0-9]/g, (d) => digits[Number(d)]), x - 4, base - h - 8, 24, 6, { ...ROLE.caption, color: c.ink, textAlign: "center" });
      paint(add, `محور ${label}`, label, x - 8, base + 4, 32, 8, { ...ROLE.caption, color: c.muted, textAlign: "center" });
    });
    paint(add, "القراءة", "الوضوح أعلى المحاور، والمتابعة أدناها. الفجوة إجراء داخل الفريق، لا حملة للجمهور.", 16, 196, 178, 16, { ...ROLE.body, color: c.ink });
    folio(add, { ...theme, line: c.line, muted: c.muted }, org, "٠٦");
  }, A4);
}

function sectionDividerPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("فاصل قسم", theme, (add) => {
    paint(add, "الجهة", org || "اسم الجهة", 16, 24, 140, 6, { ...ROLE.meta, color: c.muted });
    paint(add, "الوثيقة", "تقرير الأداء", 16, 24, 178, 6, { ...ROLE.meta, color: c.muted, textAlign: "left" });
    tick(add, "حافة القسم", 194, 48, 120, c.accent);
    paint(add, "رقم القسم", "٠٢", 16, 64, 170, 36, { ...ROLE.display, fontSize: 68, color: c.primary, lineHeight: 0.85 });
    hairline(add, "فاصل", 140, 112, 46, c.accent, 1.1);
    paint(add, "عنوان القسم", "النتائج والأثر", 16, 124, 160, 14, { ...ROLE.h1, fontSize: 26, color: c.ink });
    paint(add, "وصف القسم", "ما الذي تغيّر في الخدمة، ولماذا يهم ذلك القرار التالي.", 16, 146, 150, 16, { ...ROLE.body, color: c.muted });
    paint(add, "الفهرس", "٠١   النطاق\n٠٢   النتائج\n٠٣   التوصية", 16, 210, 80, 24, { ...ROLE.meta, color: c.muted, lineHeight: 1.7 });
    paint(add, "التالي", "يليه جدول المؤشرات", 16, 250, 160, 8, { ...ROLE.caption, color: c.muted });
  }, A4);
}

function processPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("مراحل إجرائية", theme, (add) => {
    paint(add, "تسمية", "تسلسل إجرائي", 16, 20, 120, 6, { ...ROLE.meta, color: c.accent });
    paint(add, "العنوان", "أربع مراحل", 16, 30, 120, 12, { ...ROLE.h1, color: c.primary });
    paint(add, "الحالة", "الآن: التنفيذ", 120, 34, 74, 8, { ...ROLE.meta, color: c.accent, textAlign: "left" });
    hairline(add, "المسار", 24, 72, 164, c.line, 0.7);
    const stages: [string, string][] = [
      ["تحديد", "نطاق مكتوب"],
      ["تحليل", "رقم ومصدر"],
      ["تنفيذ", "المرحلة الحالية"],
      ["قياس", "بعد ٣٠ يومًا"],
    ];
    stages.forEach(([label, note], i) => {
      const x = 18 + i * 46;
      band(add, `نقطة ${label}`, x + 16, 68, 8, 8, i === 2 ? c.accent : c.primary);
      paint(add, `رقم ${label}`, `٠${i + 1}`, x, 84, 42, 8, { ...ROLE.h3, color: i === 2 ? c.accent : c.primary, textAlign: "center" });
      paint(add, `اسم ${label}`, label, x, 96, 42, 8, { ...ROLE.h3, color: c.ink, textAlign: "center" });
      paint(add, `شرح ${label}`, note, x, 108, 42, 10, { ...ROLE.caption, color: c.muted, textAlign: "center" });
    });
    band(add, "إسقاط", 126, 76, 0.7, 28, c.accent);
    paint(add, "الحالة المفصّلة", "التنفيذ مفتوح. القياس لا يبدأ عند التسليم، بل بعد ثلاثين يومًا من استخدام المخرج.", 16, 136, 178, 18, { ...ROLE.body, color: c.ink });
    paint(add, "المالك", "المالك: مكتب الخطة  ·  الموعد: نهاية هذا الربع.", 16, 162, 178, 8, { ...ROLE.caption, color: c.muted });
    paint(add, "الجهة", org || "اسم الجهة", 16, 250, 178, 8, { ...ROLE.meta, color: c.muted });
  }, A4);
}

export const PACKS: {
  id: PackId;
  title: string;
  desc: string;
  pages: string;
}[] = [
  {
    id: "official",
    title: "تقرير رسمي متكامل",
    desc: "غلاف، محتويات، ملخص، إنجازات، مؤشرات، خاتمة",
    pages: "6 صفحات",
  },
  {
    id: "eid",
    title: "تقرير فعالية ومناسبة",
    desc: "غلاف احتفالي، مؤشرات، معرض صور، ختام",
    pages: "4 صفحات",
  },
  {
    id: "briefing",
    title: "عرض قيادي موجز",
    desc: "غلاف عرض مع موجز وقرار",
    pages: "3 صفحات",
  },
  {
    id: "slides",
    title: "عرض تقديمي 16:9",
    desc: "شرائح بنسبة 16:9 للاجتماعات",
    pages: "2 شريحة",
  },
  {
    id: "blank",
    title: "مستند فارغ A4",
    desc: "صفحة بيضاء فارغة تمامًا — بلا أي محتوى",
    pages: "1 صفحة",
  },
];

export function createProject(
  pack: PackId,
  themeId: ThemeId = "official",
  orgName = "",
): Project {
  const theme =
    THEMES[
      pack === "eid" ? (themeId === "official" ? "eid" : themeId) : themeId
    ];
  const pages =
    pack === "official"
      ? officialPages(theme, orgName)
      : pack === "eid"
        ? eidPages(THEMES.eid, orgName)
        : pack === "briefing"
          ? briefingPages(theme, orgName)
          : pack === "slides"
            ? slidesPages(theme, orgName)
            : // The «blank» pack IS the empty sheet: no header, no footer —
              // «مستند فارغ» means nothing on the page but its background.
              [page("صفحة 1", theme, () => undefined, { bg: "#ffffff" })];

  return {
    version: 2,
    name:
      pack === "eid"
        ? "تقرير فعالية"
        : pack === "briefing"
          ? "عرض قيادي"
          : pack === "slides"
            ? "عرض تقديمي"
            : pack === "blank"
              ? "مستند جديد"
              : "تقرير رسمي",
    pack,
    theme: pack === "eid" ? "eid" : themeId,
    orgName,
    defaultSize: pack === "slides" ? "slide-16-9" : "a4-portrait",
    pages,
  };
}

/**
 * Blank pages at any size — the «مستند فارغ» body of the new-document flow.
 *
 * Same furniture as the `blank` pack (a light header band and footer rule),
 * but laid out on the requested page so a landscape A4, an A3 poster or a
 * 16:9 slide gets a header that spans its real width instead of an A4 band
 * clamped onto a wider sheet.
 */
export function blankPages(
  count: number,
  themeId: ThemeId = "official",
  orgName = "",
  size: { w: number; h: number } = { w: 210, h: 297 },
  title = "مستند جديد",
): Page[] {
  const theme = THEMES[themeId] ?? THEMES.official;
  const total = Math.max(1, Math.floor(count) || 1);
  return Array.from({ length: total }, (_, i) =>
    page(
      `صفحة ${i + 1}`,
      theme,
      (add) => {
        header(add, theme, title, size.w);
        footer(add, theme, orgName, size.w, size.h);
      },
      { w: size.w, h: size.h },
    ),
  );
}

/**
 * Truly blank sheets: no header, no footer, no placeholder — only the page's
 * own background at the requested size.
 *
 * «مستند فارغ» means EMPTY to the authors who ask for it; the header/footer
 * variant stays available as `blankPages` (the «chrome» start), so neither
 * workflow loses its sheet.
 */
export function plainPages(
  count: number,
  size: { w: number; h: number } = { w: 210, h: 297 },
  bg = "#ffffff",
): Page[] {
  const total = Math.max(1, Math.floor(count) || 1);
  return Array.from({ length: total }, (_, i) =>
    page(`صفحة ${i + 1}`, THEMES.official, () => undefined, {
      w: size.w,
      h: size.h,
      bg,
    }),
  );
}

export type TemplateCategoryId =
  | "covers"
  | "reports"
  | "stats"
  | "tables"
  | "kpis"
  | "infographics"
  | "inner"
  | "slides"
  | "editorial"
  | "institutional"
  | "data"
  | "executive"
  | "section"
  | "timeline";

export interface TemplateCategory {
  id: TemplateCategoryId;
  title: string;
  desc: string;
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: "covers", title: "أغلفة التقارير", desc: "أغلفة رسمية وشريط هوية" },
  { id: "reports", title: "تقارير رسمية", desc: "صفحات نصية وملخصات" },
  { id: "inner", title: "صفحات داخلية", desc: "محتويات، إنجازات، ختام" },
  { id: "stats", title: "إحصائيات", desc: "بطاقات أرقام ولوحات" },
  { id: "tables", title: "جداول", desc: "جداول بيانات قابلة للتعديل" },
  { id: "kpis", title: "مؤشرات", desc: "مؤشرات ونِسب أداء" },
  { id: "infographics", title: "إنفوجرافيك", desc: "مسارات ومراحل عمل" },
  { id: "slides", title: "عروض 16:9", desc: "شرائح عريضة للاجتماعات" },
  { id: "editorial", title: "تحريرية", desc: "عناوين ومساحات بيضاء" },
  { id: "institutional", title: "مؤسسية", desc: "شبكات ووحدات متوازنة" },
  { id: "data", title: "بيانات", desc: "أرقام وجداول في مركز التكوين" },
  { id: "executive", title: "تنفيذية", desc: "ملخصات هادئة ومركزة" },
  { id: "section", title: "فواصل", desc: "بدايات الأقسام" },
  { id: "timeline", title: "مراحل", desc: "تدفقات ومسارات إجرائية" },
];

export interface PageTemplateDef {
  id: string;
  title: string;
  desc: string;
  category: TemplateCategoryId;
  size?: { w: number; h: number };
  concept?: string;
  preview?:
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

const A4_SIZE = { w: 210, h: 297 };
const SLIDE_SIZE = { w: 338.7, h: 190.5 };

export const PAGE_TEMPLATES: PageTemplateDef[] = [
  {
    id: "cover",
    title: "غلاف رسمي",
    desc: "غلاف أبيض، عنوان أخضر، وكتلة سفلية بخيط ذهبي",
    category: "covers",
    size: A4_SIZE,
  },
  {
    id: "cover-celebration",
    title: "غلاف مناسبة",
    desc: "غلاف أخضر بخط أبيض وصورة عرض",
    category: "covers",
    size: A4_SIZE,
  },
  {
    id: "text",
    title: "صفحة نصية",
    desc: "عمودان وقراءة ثم جدول",
    category: "reports",
    size: A4_SIZE,
  },
  {
    id: "contents",
    title: "محتويات",
    desc: "فهرس بنود مرقم",
    category: "inner",
    size: A4_SIZE,
  },
  {
    id: "achievements",
    title: "إنجازات",
    desc: "أثر واحد ثم ثلاثة بنود",
    category: "inner",
    size: A4_SIZE,
  },
  {
    id: "images",
    title: "معرض صور",
    desc: "تكوين صور غير متماثل مع تعليق",
    category: "inner",
    size: A4_SIZE,
  },
  {
    id: "thanks",
    title: "شكر وختام",
    desc: "صفحة ختامية هادئة",
    category: "inner",
    size: A4_SIZE,
  },
  {
    id: "closing",
    title: "توقيع وختم",
    desc: "خلاصة وتوقيع",
    category: "inner",
    size: A4_SIZE,
  },
  {
    id: "stats",
    title: "مؤشرات ميدانية",
    desc: "أرقام ورسم أعمدة",
    category: "kpis",
    size: A4_SIZE,
  },
  {
    id: "stats-board",
    title: "لوحة مؤشرات",
    desc: "رقم قائد وأشرطة تقدم وقراءة",
    category: "stats",
    size: A4_SIZE,
  },
  {
    id: "table-data",
    title: "جدول تفصيلي",
    desc: "جدول خمسة أعمدة للمقارنة",
    category: "tables",
    size: A4_SIZE,
  },
  {
    id: "infographic",
    title: "مسار من خمس مراحل",
    desc: "إنفوجرافيك عمودي جاهز",
    category: "infographics",
    size: A4_SIZE,
  },
  {
    id: "slide-cover",
    title: "شريحة غلاف",
    desc: "شريحة عريضة للعرض",
    category: "slides",
    size: SLIDE_SIZE,
  },
  {
    id: "slide-stats",
    title: "شريحة مؤشرات",
    desc: "مؤشر قائد وقراءتان وشريط تقدم",
    category: "slides",
    size: SLIDE_SIZE,
  },
  {
    id: "editorial",
    title: "تحريرية حديثة",
    desc: "عنوان مسيطر ومساحة بيضاء ورقم بصري",
    category: "editorial",
    concept: "Editorial",
    preview: "editorial",
    size: A4_SIZE,
  },
  {
    id: "institutional-grid",
    title: "شبكة مؤسسية",
    desc: "تقسيم شبكي واضح لوحدات المعلومات",
    category: "institutional",
    concept: "Institutional Grid",
    preview: "grid",
    size: A4_SIZE,
  },
  {
    id: "data-focus",
    title: "تركيز البيانات",
    desc: "رقم رئيسي وجدول ومؤشرات ثانوية",
    category: "data",
    concept: "Data Focus",
    preview: "data",
    size: A4_SIZE,
  },
  {
    id: "vertical-flow",
    title: "تدفق رأسي",
    desc: "كتل متدرجة تقود العين إلى الأسفل",
    category: "timeline",
    concept: "Vertical Flow",
    preview: "flow",
    size: A4_SIZE,
  },
  {
    id: "asymmetric",
    title: "تحريرية غير متماثلة",
    desc: "كتلة جانبية ومرساة بصرية خارج المركز",
    category: "editorial",
    concept: "Asymmetric Editorial",
    preview: "asymmetric",
    size: A4_SIZE,
  },
  {
    id: "modular",
    title: "وحدات معيارية",
    desc: "موزاييك من وحدات مستقلة بأحجام مختلفة",
    category: "institutional",
    concept: "Modular",
    preview: "modular",
    size: A4_SIZE,
  },
  {
    id: "executive",
    title: "ملخص تنفيذي",
    desc: "تكوين هادئ برسالة واحدة ورقم واضح",
    category: "executive",
    concept: "Executive Report",
    preview: "executive",
    size: A4_SIZE,
  },
  {
    id: "statistical",
    title: "قراءة إحصائية",
    desc: "رقم كبير وأعمدة ومؤشرات للقراءة السريعة",
    category: "stats",
    concept: "Statistical",
    preview: "statistical",
    size: A4_SIZE,
  },
  {
    id: "section-divider",
    title: "فاصل قسم",
    desc: "رقم قسم كبير ومساحة بيضاء واسعة",
    category: "section",
    concept: "Section Divider",
    preview: "section",
    size: A4_SIZE,
  },
  {
    id: "process",
    title: "مراحل إجرائية",
    desc: "تسلسل أفقي قابل للتحرير للمراحل",
    category: "timeline",
    concept: "Timeline / Process",
    preview: "process",
    size: A4_SIZE,
  },
  ...FAMILY_TEMPLATES.map((entry) => ({
    ...entry,
    size: A4_SIZE,
  })),
];

export function templateById(id: string): PageTemplateDef | undefined {
  return PAGE_TEMPLATES.find((t) => t.id === id);
}

/**
 * Builds a fresh page for a gallery entry. Every call returns new element ids,
 * so inserting a template copies it rather than editing the template source.
 */
export function createTemplatePage(
  id: string,
  theme: Theme,
  org: string,
): Page {
  switch (id) {
    case "cover":
      return coverPage(theme, org);
    case "cover-celebration":
      return eidPages(theme, org)[0];
    case "contents":
      return officialPages(theme, org)[1];
    case "text":
      return officialPages(theme, org)[2];
    case "achievements":
      return officialPages(theme, org)[3];
    case "stats":
      return officialPages(theme, org)[4];
    case "closing":
      return officialPages(theme, org)[5];
    case "images":
      return eidPages(theme, org)[2];
    case "thanks":
      return eidPages(theme, org)[3];
    case "stats-board":
      return statsInfographicPage(theme, org);
    case "table-data":
      return tablePage(theme, org);
    case "infographic":
      return infographicPage(theme, org);
    case "slide-cover":
      return slidesPages(theme, org)[0];
    case "slide-stats":
      return slidesPages(theme, org)[1];
    case "editorial":
      return editorialPage(theme, org);
    case "institutional-grid":
      return institutionalGridPage(theme, org);
    case "data-focus":
      return dataFocusPage(theme, org);
    case "vertical-flow":
      return verticalFlowPage(theme, org);
    case "asymmetric":
      return asymmetricPage(theme, org);
    case "modular":
      return modularPage(theme, org);
    case "executive":
      return executivePage(theme, org);
    case "statistical":
      return statisticalPage(theme, org);
    case "section-divider":
      return sectionDividerPage(theme, org);
    case "process":
      return processPage(theme, org);
    default: {
      const family = buildFamilyPage(id, theme, org);
      return family ?? coverPage(theme, org);
    }
  }
}

/** Pages of a starter pack, for the "new project from template" flow. */
export function packPages(pack: PackId, theme: Theme, org: string): Page[] {
  return createProject(pack, theme.id, org).pages;
}
