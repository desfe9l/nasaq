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
import {
  A4,
  BODY,
  CEREMONY,
  DISPLAY,
  META,
  SLIDE,
  band,
  folio,
  hairline,
  paint,
  plate,
  runningHead,
  tableStyle,
  tick,
} from "./template-layouts";

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
      band(add, "عمود التجليد", 188, 0, 22, 297, theme.primary);
      band(add, "خط الهوية", 186, 0, 1.6, 297, theme.accent);
      add("logo", { name: "شعار الجهة", x: 191, y: 16, w: 16, h: 16 });
      paint(add, "سنة الغلاف", "٢٠٢٦", 188, 250, 22, 14, {
        fontFamily: DISPLAY,
        fontSize: 11,
        fontWeight: 700,
        color: theme.accent,
        textAlign: "center",
      });
      paint(add, "تصنيف", "تقرير أداء  ·  استخدام داخلي", 16, 24, 164, 6, {
        fontFamily: META,
        fontSize: 9,
        fontWeight: 600,
        color: theme.muted,
        textAlign: "right",
      });
      paint(add, "عنوان التقرير", "تقرير الأداء\nالسنوي", 16, 36, 164, 34, {
        fontFamily: DISPLAY,
        fontSize: 34,
        fontWeight: 800,
        color: theme.primary,
        textAlign: "right",
        lineHeight: 1.05,
      });
      hairline(add, "فاصل العنوان", 132, 76, 48, theme.accent, 1);
      add("image", {
        name: "صورة الغلاف",
        x: 16,
        y: 88,
        w: 52,
        h: 70,
        src: plate("facade"),
        style: { objectFit: "cover", radius: 0 },
      });
      paint(add, "نبذة الغلاف", "ملخص العام في سطرين: نطاق التقرير، أبرز نتيجة، والقرار الذي تحتاجه الدورة القادمة.", 74, 90, 106, 28, {
        fontFamily: BODY,
        fontSize: 12,
        fontWeight: 500,
        color: theme.ink,
        textAlign: "right",
        lineHeight: 1.75,
      });
      paint(add, "تعليق الصورة", "مقر الجهة  ·  أرشيف ٢٠٢٦", 16, 160, 52, 10, {
        fontFamily: META,
        fontSize: 7.5,
        fontWeight: 600,
        color: theme.muted,
        textAlign: "right",
        lineHeight: 1.35,
      });
      hairline(add, "خط البيانات", 16, 186, 164, theme.line, 0.35);
      paint(add, "تسمية الجهة", "الجهة", 124, 194, 56, 5, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      paint(add, "اسم الجهة", entity, 110, 202, 70, 10, {
        fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, color: theme.primary, textAlign: "right",
      });
      paint(add, "تسمية الفترة", "الفترة", 62, 194, 44, 5, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      paint(add, "الفترة", "يناير — ديسمبر", 52, 202, 54, 10, {
        fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, color: theme.ink, textAlign: "right",
      });
      paint(add, "تسمية الحالة", "الحالة", 16, 194, 32, 5, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      paint(add, "الحالة", "للمراجعة", 16, 202, 36, 10, {
        fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, color: theme.ink, textAlign: "right",
      });
      add("stamp", { name: "ختم رسمي", x: 16, y: 236, w: 34, h: 34, content: "رسمي" });
      paint(add, "التاريخ", "محرم ١٤٤٨ هـ", 58, 246, 120, 8, {
        fontFamily: META, fontSize: 10, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
    }, A4),

    page("المحتويات", theme, (add) => {
      runningHead(add, theme, "المحتويات");
      paint(add, "عنوان المحتويات", "ما في هذا التقرير", 16, 32, 178, 14, {
        fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      paint(add, "مقدمة الفهرس", "من النطاق إلى التوصية، بالترتيب الذي يُعرض به على القيادة.", 16, 50, 178, 8, {
        fontFamily: BODY, fontSize: 11, fontWeight: 500, color: theme.ink, textAlign: "right",
      });
      const items: [string, string, string][] = [
        ["٠١", "المقدمة والنطاق", "٠٣"],
        ["٠٢", "الأهداف الاستراتيجية", "٠٤"],
        ["٠٣", "الإنجازات الرئيسية", "٠٥"],
        ["٠٤", "المؤشرات والإحصائيات", "٠٦"],
        ["٠٥", "التوصيات", "٠٧"],
        ["٠٦", "الخاتمة", "٠٨"],
      ];
      items.forEach(([num, title, pg], i) => {
        const y = 72 + i * 30;
        paint(add, `رقم ${num}`, num, 168, y, 26, 8, {
          fontFamily: DISPLAY, fontSize: 13, fontWeight: 800, color: theme.accent, textAlign: "right",
        });
        paint(add, `بند ${title}`, title, 36, y, 126, 8, {
          fontFamily: DISPLAY, fontSize: 15, fontWeight: 700, color: theme.ink, textAlign: "right",
        });
        paint(add, `صفحة ${num}`, pg, 16, y, 16, 8, {
          fontFamily: META, fontSize: 12, fontWeight: 600, color: theme.muted, textAlign: "left",
        });
        hairline(add, `فاصل ${num}`, 16, y + 16, 178, theme.line, 0.3);
      });
      folio(add, theme, entity, "٠٢");
    }, A4),

    page("ملخص تنفيذي", theme, (add) => {
      runningHead(add, theme, "ملخص تنفيذي");
      paint(add, "عنوان الفقرة", "نظرة عامة", 16, 30, 178, 12, {
        fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      paint(add, "العمود الأول", "يغلق هذا العام بإنجاز ٩٤٪ من الخطة التشغيلية. الرضا ارتفع إلى ٤٫٧، وأُقفلت ١٨ مبادرة من ٢٠. الفجوة المتبقية مبادرة واحدة في التحول الرقمي، ومبادرة شراكة ما زالت في التعاقد.", 100, 50, 94, 52, {
        fontFamily: BODY, fontSize: 11.5, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.8,
      });
      paint(add, "العمود الثاني", "التوصية للقيادة: اعتماد تمديد مبادرة التحول إلى الربع الأول، دون زيادة الاعتماد، مقابل تجميد شراكة لم يُستكمل تقييم أثرها.", 16, 50, 76, 52, {
        fontFamily: BODY, fontSize: 11.5, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.8,
      });
      band(add, "علامة الاقتباس", 16, 112, 1.4, 22, theme.accent);
      paint(add, "اقتباس الملخص", "الطلب ليس العائق. العائق طاقة التشغيل في وحدة واحدة.", 22, 112, 172, 16, {
        fontFamily: DISPLAY, fontSize: 14, fontWeight: 700, color: theme.primary, textAlign: "right", lineHeight: 1.4,
      });
      add("table", {
        name: "جدول الملخص",
        x: 16,
        y: 144,
        w: 178,
        h: 78,
        content: JSON.stringify([
          ["المحور", "المستهدف", "المتحقق", "الحالة"],
          ["التشغيل", "١٠٠٪", "٩٤٪", "ضمن المسار"],
          ["رضا المستفيدين", "٤٫٥", "٤٫٧", "تجاوز"],
          ["المبادرات", "٢٠", "١٨", "مبادرتان مفتوحتان"],
          ["الشراكات الفاعلة", "١٢", "١٢", "مكتمل"],
        ]),
        style: tableStyle(theme, 4, 5),
      });
      paint(add, "مصدر الجدول", "المصدر: مكتب التخطيط — إغلاق ديسمبر ٢٠٢٦.", 16, 228, 178, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      folio(add, theme, entity, "٠٣");
    }, A4),

    page("الإنجازات", theme, (add) => {
      runningHead(add, theme, "الإنجازات");
      paint(add, "تسمية", "الأثر", 16, 30, 178, 6, {
        fontFamily: META, fontSize: 9, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      paint(add, "عنوان الصفحة", "ما تغيّر هذا العام", 16, 40, 178, 12, {
        fontFamily: DISPLAY, fontSize: 24, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      paint(add, "رقم الإنجاز الأول", "٠١", 156, 64, 38, 16, {
        fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: theme.primary, textAlign: "right", lineHeight: 1,
      });
      paint(add, "عنوان الإنجاز الأول", "تشغيل المنافذ على مدار الساعة", 16, 68, 134, 12, {
        fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: theme.ink, textAlign: "right",
      });
      paint(add, "متن الإنجاز الأول", "انتقلت أربع بوابات من مناوبة نهارية إلى تغطية كاملة، وانخفض متوسط الانتظار من ٢٦ دقيقة إلى ١١. الجهة المنفذة: إدارة العمليات، والمؤشر المرتبط هو زمن الخدمة.", 16, 86, 178, 28, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.75,
      });
      hairline(add, "فاصل الأثر", 16, 122, 178, theme.line, 0.35);
      const rows: [string, string, string][] = [
        ["٠٢", "شراكات الخدمة", "اثنتا عشرة اتفاقية سارية، آخرها مع جهة الإسناد الطبي في المنافذ الغربية."],
        ["٠٣", "رضا المستفيدين", "ارتفع المتوسط من ٤٫٢ إلى ٤٫٧ بعد توحيد نموذج الشكوى وإغلاقها خلال خمسة أيام."],
        ["٠٤", "توثيق المعرفة", "أُرشف منهج التشغيل في دليل واحد، واستُبدل به ثلاث نسخ متباينة كانت تُستخدم ميدانيًا."],
      ];
      rows.forEach(([num, title, body], i) => {
        const y = 134 + i * 40;
        paint(add, `رقم ${num}`, num, 164, y, 30, 8, {
          fontFamily: DISPLAY, fontSize: 13, fontWeight: 800, color: theme.accent, textAlign: "right",
        });
        paint(add, `عنوان ${title}`, title, 16, y, 142, 8, {
          fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, color: theme.ink, textAlign: "right",
        });
        paint(add, `متن ${title}`, body, 16, y + 12, 178, 16, {
          fontFamily: BODY, fontSize: 11, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.6,
        });
      });
      folio(add, theme, entity, "٠٤");
    }, A4),

    page("المؤشرات", theme, (add) => {
      runningHead(add, theme, "المؤشرات");
      paint(add, "عنوان المؤشرات", "أربعة أرقام تكفي للقراءة", 16, 30, 178, 12, {
        fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      paint(add, "الرقم القائد", "٩٤٪", 120, 50, 74, 22, {
        fontFamily: DISPLAY, fontSize: 40, fontWeight: 800, color: theme.primary, textAlign: "right", lineHeight: 1,
      });
      paint(add, "تسمية الرقم القائد", "نسبة الإنجاز مقابل الخطة", 120, 74, 74, 8, {
        fontFamily: META, fontSize: 9, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      const side: [string, string][] = [
        ["١٨", "مبادرة مكتملة"],
        ["٤٫٧", "متوسط الرضا"],
        ["١٢", "شراكة فاعلة"],
      ];
      side.forEach(([value, label], i) => {
        const y = 50 + i * 18;
        paint(add, `رقم جانبي ${i + 1}`, value, 16, y, 28, 10, {
          fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: theme.ink, textAlign: "right",
        });
        paint(add, `تسمية جانبية ${i + 1}`, label, 46, y + 1, 60, 8, {
          fontFamily: META, fontSize: 9, fontWeight: 600, color: theme.muted, textAlign: "right",
        });
      });
      hairline(add, "خط الرسم", 16, 112, 178, theme.line, 0.35);
      paint(add, "عنوان الرسم", "الإنجاز الشهري  ·  النسبة من الخطة", 16, 118, 178, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      const bars = [42, 55, 61, 74, 88, 96];
      const months = ["يناير", "مارس", "مايو", "يوليو", "سبتمبر", "ديسمبر"];
      bars.forEach((height, i) => {
        const x = 22 + i * 28;
        const h = height * 0.72;
        band(add, `عمود ${months[i]}`, x, 210 - h, 14, h, i === bars.length - 1 ? theme.accent : theme.primary);
        paint(add, `شهر ${months[i]}`, months[i], x - 4, 214, 22, 8, {
          fontFamily: META, fontSize: 7, fontWeight: 600, color: theme.muted, textAlign: "center",
        });
      });
      paint(add, "قراءة الرسم", "التسارع بدأ في يوليو مع إغلاق مبادرات التشغيل، لا مع زيادة الإنفاق.", 16, 228, 178, 12, {
        fontFamily: BODY, fontSize: 11, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.6,
      });
      folio(add, theme, entity, "٠٥");
    }, A4),

    page("الخاتمة", theme, (add) => {
      runningHead(add, theme, "الخاتمة والتوصيات");
      paint(add, "عنوان الخاتمة", "ما نوصي باعتماده", 16, 30, 178, 12, {
        fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      const recs: [string, string][] = [
        ["٠١", "تمديد مبادرة التحول الرقمي إلى الربع الأول دون زيادة الاعتماد."],
        ["٠٢", "تجميد الشراكة غير المقيَّمة حتى يصدر تقرير أثرها."],
        ["٠٣", "تثبيت دليل التشغيل الجديد مرجعًا وحيدًا للوحدات الميدانية."],
      ];
      recs.forEach(([num, text], i) => {
        const y = 56 + i * 28;
        paint(add, `توصية ${num}`, num, 166, y, 28, 8, {
          fontFamily: DISPLAY, fontSize: 13, fontWeight: 800, color: theme.accent, textAlign: "right",
        });
        paint(add, `نص ${num}`, text, 16, y, 146, 14, {
          fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.6,
        });
        hairline(add, `خط ${num}`, 16, y + 20, 178, theme.line, 0.25);
      });
      paint(add, "خلاصة", "النتائج لا تطلب خطة جديدة. تطلب إغلاق ما فُتح، وتثبيت ما ثبت أثره.", 16, 150, 178, 16, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.7,
      });
      hairline(add, "خط التوقيع", 110, 196, 64, theme.ink, 0.35);
      paint(add, "التوقيع", "اسم المسؤول\nالمنصب", 110, 202, 64, 14, {
        fontFamily: META, fontSize: 10, fontWeight: 600, color: theme.ink, textAlign: "right", lineHeight: 1.45,
      });
      add("stamp", { name: "ختم الاعتماد", x: 16, y: 188, w: 36, h: 36, content: "خُتم" });
      paint(add, "تاريخ الاعتماد", "للاعتماد في اجتماع الدورة القادمة", 58, 206, 48, 16, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right", lineHeight: 1.4,
      });
      folio(add, theme, entity, "٠٦");
    }, A4),
  ];
}

function eidPages(theme: Theme, org: string): Page[] {
  const entity = org.trim() || "إدارة الإعلام والاتصال المؤسسي";
  return [
    page("غلاف العيد", theme, (add) => {
      add("image", {
        name: "صورة الغلاف",
        x: 0, y: 0, w: 210, h: 128,
        src: plate("court"),
        style: { objectFit: "cover", radius: 0 },
      });
      band(add, "فاصل ذهبي", 0, 128, 210, 1.6, theme.accent);
      add("logo", { name: "شعار الجهة", x: 174, y: 142, w: 22, h: 22 });
      paint(add, "الجهة", entity, 16, 146, 150, 8, {
        fontFamily: META, fontSize: 10, fontWeight: 600, color: theme.accent, textAlign: "right",
      });
      paint(add, "عنوان التقرير", "مجهودات فعاليات\nعيد الأضحى المبارك", 16, 164, 178, 36, {
        fontFamily: CEREMONY, fontSize: 28, fontWeight: 700, color: "#f7f3e8", textAlign: "right", lineHeight: 1.25,
      });
      paint(add, "السنة", "١٤٤٧ هـ", 16, 208, 80, 10, {
        fontFamily: CEREMONY, fontSize: 16, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      hairline(add, "خط سفلي داخلي", 16, 236, 48, theme.accent, 0.8);
      paint(add, "جهة الإصدار", "إدارة الإعلام والاتصال المؤسسي\nتوثيق الميدان والمنافذ", 16, 248, 178, 16, {
        fontFamily: META, fontSize: 11, fontWeight: 600, color: "#e7efe9", textAlign: "right", lineHeight: 1.5,
      });
    }, { ...A4, bg: theme.primary }),

    page("المؤشرات الميدانية", theme, (add) => {
      runningHead(add, theme, "المؤشرات الميدانية");
      paint(add, "عنوان الصفحة", "الميدان هذا الموسم", 16, 30, 178, 12, {
        fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      const stats: [string, string][] = [
        ["٤٨", "موقعًا ميدانيًا"],
        ["١٢٠", "مشاركة توعوية"],
        ["١٦", "فرقة ميدانية"],
        ["١٠٠٪", "تغطية المنافذ"],
      ];
      stats.forEach(([value, label], i) => {
        const x = 16 + i * 46;
        if (i > 0) tick(add, `فاصل ${i}`, x - 4, 54, 28, theme.line);
        paint(add, `رقم ${label}`, value, x, 52, 40, 14, {
          fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, color: theme.primary, textAlign: "right", lineHeight: 1,
        });
        paint(add, `تسمية ${label}`, label, x, 68, 40, 12, {
          fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right", lineHeight: 1.3,
        });
      });
      hairline(add, "خط القراءة", 16, 92, 178, theme.line, 0.35);
      paint(add, "المتن الأيمن", "شملت الفعاليات تنظيم الحركة عند المنافذ، ونقاط توعية للقادمين والمغادرين، وتوثيقًا بصريًا لكل محطة عملت فيها الفرق.", 100, 104, 94, 40, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.75,
      });
      paint(add, "المتن الأيسر", "لم تُسجَّل فجوة تغطية. الملاحظة الوحيدة تأخر وصول مواد التوعية إلى منفذين في اليوم الأول، وأُغلقت قبل ذروة الحركة.", 16, 104, 76, 40, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.75,
      });
      paint(add, "ملاحظة ميدانية", "ملاحظة الميدان", 16, 158, 178, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      paint(add, "نص الملاحظة", "تُستبدل هذه الفقرة بتقرير قائد الفرق عند اعتماد النسخة النهائية.", 16, 168, 178, 14, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.7,
      });
      folio(add, theme, entity, "٠٢");
    }, A4),

    page("معرض الصور", theme, (add) => {
      runningHead(add, theme, "التوثيق البصري");
      add("image", {
        name: "صورة الاستقبال",
        x: 16, y: 30, w: 118, h: 132,
        src: plate("field"),
        style: { objectFit: "cover", radius: 0 },
      });
      add("image", {
        name: "صورة التوعية",
        x: 140, y: 30, w: 54, h: 62,
        src: plate("dune"),
        style: { objectFit: "cover", radius: 0 },
      });
      add("image", {
        name: "صورة التنظيم",
        x: 140, y: 100, w: 54, h: 62,
        src: plate("archive"),
        style: { objectFit: "cover", radius: 0 },
      });
      paint(add, "تعليق الاستقبال", "استقبال عند المنفذ الرئيسي", 16, 164, 118, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      paint(add, "تعليق جانبي", "توعية  ·  تنظيم", 140, 164, 54, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      add("image", {
        name: "صورة الإغلاق",
        x: 16, y: 180, w: 178, h: 62,
        src: plate("night"),
        style: { objectFit: "cover", radius: 0 },
      });
      paint(add, "تعليق الإغلاق", "إغلاق المناوبة  ·  اليوم الثالث من العيد", 16, 246, 178, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      folio(add, theme, entity, "٠٣");
    }, A4),

    page("ختام", theme, (add) => {
      band(add, "خط علوي", 0, 0, 210, 1.6, theme.accent);
      paint(add, "تسمية الختام", "ختام التوثيق", 16, 36, 178, 6, {
        fontFamily: META, fontSize: 9, fontWeight: 600, color: theme.accent, textAlign: "right",
      });
      paint(add, "عنوان الختام", "شكرًا\nلكم", 16, 56, 160, 40, {
        fontFamily: CEREMONY, fontSize: 40, fontWeight: 700, color: "#f7f3e8", textAlign: "right", lineHeight: 1.05,
      });
      hairline(add, "فاصل الختام", 140, 108, 36, theme.accent, 0.9);
      paint(add, "نص الختام", "نقدر جهد الفرق الميدانية والإسناد الإعلامي. النسخة التالية تصدر مع تقرير الأثر، لا مع تكرار الوصف.", 16, 122, 160, 28, {
        fontFamily: BODY, fontSize: 13, fontWeight: 500, color: "#e7efe9", textAlign: "right", lineHeight: 1.75,
      });
      paint(add, "الجهة", entity, 16, 230, 178, 8, {
        fontFamily: DISPLAY, fontSize: 13, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      paint(add, "الإدارة", "إدارة الإعلام والاتصال المؤسسي", 16, 242, 178, 8, {
        fontFamily: META, fontSize: 10, fontWeight: 600, color: "#e7efe9", textAlign: "right",
      });
    }, { ...A4, bg: theme.primary }),
  ];
}

function briefingPages(theme: Theme, org: string): Page[] {
  const entity = org.trim() || "مكتب المدير العام";
  return [
    page("غلاف العرض", theme, (add) => {
      paint(add, "تصنيف العرض", "عرض قيادي  ·  للتداول الداخلي", 16, 28, 178, 6, {
        fontFamily: META, fontSize: 9, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      paint(add, "عنوان العرض", "ما يجب\nأن يُحسم", 16, 48, 178, 42, {
        fontFamily: DISPLAY, fontSize: 40, fontWeight: 800, color: theme.ink, textAlign: "right", lineHeight: 1.02,
      });
      hairline(add, "فاصل العنوان", 146, 98, 48, theme.accent, 1.1);
      paint(add, "جملة العرض", "صفحة واحدة للقرار، لا لسرد الأعمال. التفاصيل في المرفقات.", 16, 112, 140, 18, {
        fontFamily: BODY, fontSize: 13, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.7,
      });
      band(add, "شريط البيانات", 0, 228, 210, 69, theme.primary);
      add("logo", { name: "شعار الجهة", x: 176, y: 240, w: 18, h: 18 });
      paint(add, "الجهة", entity, 16, 242, 150, 10, {
        fontFamily: DISPLAY, fontSize: 14, fontWeight: 700, color: "#ffffff", textAlign: "right",
      });
      paint(add, "التاريخ", "سبتمبر ٢٠٢٦  ·  اجتماع القيادة الأسبوعي", 16, 258, 150, 8, {
        fontFamily: META, fontSize: 10, fontWeight: 600, color: theme.accent, textAlign: "right",
      });
    }, A4),

    page("الموجز", theme, (add) => {
      runningHead(add, theme, "موجز تنفيذي");
      paint(add, "العنوان", "القرار المطلوب هذا الأسبوع", 16, 30, 178, 12, {
        fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, color: theme.ink, textAlign: "right",
      });
      paint(add, "الرقم", "٤٢٪", 120, 52, 74, 20, {
        fontFamily: DISPLAY, fontSize: 36, fontWeight: 800, color: theme.primary, textAlign: "right", lineHeight: 1,
      });
      paint(add, "تسمية الرقم", "نمو الإيراد مقابل الخطة", 120, 74, 74, 8, {
        fontFamily: META, fontSize: 9, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      paint(add, "العمود الأول", "الأداء تجاوز الخطة لأن الطلب ثبت، لا لأن الطاقة زادت. الاستمرار على هذا الإيقاع يصطدم بسقف التشغيل في وحدة الإسناد.", 16, 96, 86, 40, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.75,
      });
      paint(add, "العمود الثاني", "الخيار المعروض: تأجيل توسعة واحدة إلى الربع القادم، والإبقاء على هدف الإيراد كما هو.", 108, 96, 86, 40, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.75,
      });
      band(add, "علامة القيد", 16, 150, 1.6, 28, theme.accent);
      paint(add, "عنوان القيد", "القيد", 22, 148, 40, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      paint(add, "نص القيد", "القيد طاقة تشغيلية، لا طلب السوق. أي هدف أعلى من الطاقة الحالية قرار توظيف، لا قرار مبيعات.", 22, 158, 172, 16, {
        fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.65,
      });
      folio(add, theme, entity, "٠٢");
    }, A4),

    page("القرار", theme, (add) => {
      runningHead(add, theme, "القرار");
      paint(add, "العنوان", "ثلاثة بنود للاعتماد", 16, 30, 178, 12, {
        fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      const items: [string, string, string][] = [
        ["٠١", "اعتماد", "تأجيل التوسعة إلى الربع القادم مع الإبقاء على هدف الإيراد."],
        ["٠٢", "تكليف", "إدارة الإسناد ترفع خطة الطاقة خلال عشرة أيام."],
        ["٠٣", "إيقاف", "لا يُفتح مسار توظيف قبل اعتماد خطة الطاقة."],
      ];
      items.forEach(([num, title, body], i) => {
        const y = 56 + i * 42;
        paint(add, `رقم ${num}`, num, 166, y, 28, 10, {
          fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: theme.accent, textAlign: "right",
        });
        paint(add, `عنوان ${title}`, title, 16, y, 144, 8, {
          fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, color: theme.ink, textAlign: "right",
        });
        paint(add, `متن ${title}`, body, 16, y + 12, 178, 12, {
          fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.55,
        });
      });
      hairline(add, "خط التوقيع", 110, 196, 70, theme.ink, 0.35);
      paint(add, "التوقيع", "الاسم\nالصفة", 110, 202, 70, 14, {
        fontFamily: META, fontSize: 10, fontWeight: 600, color: theme.ink, textAlign: "right", lineHeight: 1.4,
      });
      paint(add, "الموعد", "يُحسم في الجلسة، لا بالتمرير.", 16, 206, 86, 10, {
        fontFamily: META, fontSize: 9, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      folio(add, theme, entity, "٠٣");
    }, A4),
  ];
}

function statsInfographicPage(theme: Theme, org: string): Page {
  return page("لوحة مؤشرات", theme, (add) => {
    runningHead(add, theme, "لوحة المؤشرات");
    paint(add, "عنوان اللوحة", "أين يقف التنفيذ", 16, 30, 110, 12, {
      fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
    });
    paint(add, "الرقم القائد", "٧٨٪", 132, 28, 62, 20, {
      fontFamily: DISPLAY, fontSize: 32, fontWeight: 800, color: theme.primary, textAlign: "left", lineHeight: 1,
    });
    paint(add, "تسمية الرقم", "الإنجاز العام", 132, 50, 62, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "left",
    });
    const bars: [string, number, string][] = [
      ["نسبة الإنجاز العام", 78, theme.primary],
      ["رضا المستفيدين", 92, theme.accent],
      ["الالتزام بالجدول", 64, theme.primarySoft],
    ];
    bars.forEach(([label, value, color], i) => {
      const y = 72 + i * 28;
      paint(add, `عنوان ${label}`, label, 16, y, 120, 6, {
        fontFamily: META, fontSize: 9, fontWeight: 600, color: theme.ink, textAlign: "right",
      });
      paint(add, `قيمة ${label}`, `${value}٪`, 150, y, 44, 6, {
        fontFamily: DISPLAY, fontSize: 11, fontWeight: 800, color: theme.primary, textAlign: "left",
      });
      add("progress", {
        name: label,
        x: 16,
        y: y + 8,
        w: 178,
        h: 8,
        content: label,
        style: { value, fill: color, showValue: false },
      });
    });
    hairline(add, "فاصل القراءة", 16, 164, 178, theme.line, 0.3);
    const notes: [string, string][] = [
      ["٩٠٤", "حالة مغلقة"],
      ["٢٧", "حالة مفتوحة"],
      ["١٢", "فرقة ميدانية"],
    ];
    notes.forEach(([value, label], i) => {
      const x = 16 + i * 60;
      if (i > 0) tick(add, `فاصل ملاحظة ${i}`, x - 3, 176, 22, theme.line);
      paint(add, `ملاحظة ${label}`, value, x, 174, 52, 10, {
        fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: theme.ink, textAlign: "right",
      });
      paint(add, `شرح ${label}`, label, x, 186, 52, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
    });
    paint(add, "القراءة", "الرضا يسبق الجدول. الحالات المفتوحة كلها في فرقة واحدة، لا في المنهج.", 16, 208, 178, 14, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.65,
    });
    paint(add, "المصدر", "المصدر: لوحة المتابعة — الأسبوع الحالي. الأرقام قابلة للاستبدال.", 16, 230, 178, 8, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
    });
    folio(add, theme, org, "٠٢");
  }, A4);
}

function tablePage(theme: Theme, org: string): Page {
  return page("جدول بيانات", theme, (add) => {
    runningHead(add, theme, "الجدول");
    paint(add, "العنوان", "مقارنة البنود", 16, 30, 178, 12, {
      fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
    });
    paint(add, "المقدمة", "الفارق السالب مركّز في التشغيل. بقية البنود إما ضمن المسار أو أعلى من المستهدف بقليل.", 16, 48, 178, 14, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.65,
    });
    add("table", {
      name: "جدول المقارنة",
      x: 16,
      y: 70,
      w: 178,
      h: 96,
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
    band(add, "علامة القراءة", 16, 178, 1.4, 20, theme.accent);
    paint(add, "القراءة", "فارق خمس حالات لا يغيّر الحكم على العام، ويحدد أين تُراجع الخطة: التشغيل والصيانة.", 22, 176, 172, 18, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.65,
    });
    paint(add, "المصدر", "المصدر: السجل التشغيلي — ديسمبر ٢٠٢٦.", 16, 210, 178, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: theme.muted, textAlign: "right",
    });
    folio(add, theme, org, "٠٣");
  }, A4);
}

function infographicPage(theme: Theme, org: string): Page {
  return page("إنفوجرافيك", theme, (add) => {
    paint(add, "تسمية", "منهج العمل", 16, 20, 178, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 700, color: theme.accent, textAlign: "right",
    });
    paint(add, "العنوان", "خمس مراحل، بترتيب واحد", 16, 30, 178, 12, {
      fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.primary, textAlign: "right",
    });
    band(add, "مسار رأسي", 174, 58, 0.6, 190, theme.line);
    const steps: [string, string, string][] = [
      ["٠١", "التخطيط", "تحديد النطاق والجهة المالكة قبل جمع أي رقم."],
      ["٠٢", "الجمع", "البيانات من مصدر واحد، مع تاريخ إغلاق معلن."],
      ["٠٣", "التحليل", "المؤشر يُقرأ مع قيده، لا منفصلًا عنه."],
      ["٠٤", "الإخراج", "صفحة قرار ثم الملاحق، لا العكس."],
      ["٠٥", "الأثر", "ما تغيّر بعد النشر، لا عدد الصفحات."],
    ];
    steps.forEach(([num, title, body], i) => {
      const y = 56 + i * 38;
      band(add, `نقطة ${num}`, 170, y + 2, 8, 8, i === 0 ? theme.accent : theme.primary);
      paint(add, `رقم ${num}`, num, 146, y, 20, 8, {
        fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, color: theme.primary, textAlign: "right",
      });
      paint(add, `عنوان ${title}`, title, 16, y, 124, 8, {
        fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, color: theme.ink, textAlign: "right",
      });
      paint(add, `متن ${title}`, body, 16, y + 12, 150, 12, {
        fontFamily: BODY, fontSize: 11, fontWeight: 500, color: theme.ink, textAlign: "right", lineHeight: 1.45,
      });
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
      add("image", {
        name: "حقل الغلاف",
        x: 0, y: 0, w: 124, h: 190.5,
        src: plate("night"),
        style: { objectFit: "cover", radius: 0 },
      });
      band(add, "فاصل", 124, 0, 1.4, 190.5, theme.accent);
      add("logo", { name: "شعار", x: 296, y: 18, w: 22, h: 22 });
      paint(add, "تصنيف", "عرض تنفيذي", 146, 28, 140, 6, {
        fontFamily: META, fontSize: 10, fontWeight: 700, color: theme.accent, textAlign: "right",
      });
      paint(add, "عنوان العرض", "النتائج\nالرئيسية", 146, 44, 170, 40, {
        fontFamily: DISPLAY, fontSize: 36, fontWeight: 800, color: "#f7f6f3", textAlign: "right", lineHeight: 1.05,
      });
      paint(add, "الجهة", `${entity}  ·  سبتمبر ٢٠٢٦`, 146, 156, 170, 8, {
        fontFamily: META, fontSize: 11, fontWeight: 600, color: "#e7e5e4", textAlign: "right",
      });
    }, { ...SLIDE, bg: theme.primary }),
    page("شريحة المؤشرات", theme, (add) => {
      runningHead(add, theme, "المؤشرات الرئيسية", SLIDE.w);
      paint(add, "الرقم القائد", "٩٦٪", 220, 36, 100, 28, {
        fontFamily: DISPLAY, fontSize: 48, fontWeight: 800, color: theme.primary, textAlign: "right", lineHeight: 1,
      });
      paint(add, "تسمية القائد", "اكتمال الخطة", 220, 68, 100, 8, {
        fontFamily: META, fontSize: 11, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      tick(add, "فاصل المؤشرات", 200, 40, 48, theme.line);
      paint(add, "رقم ثان", "٩٠٤", 16, 40, 70, 16, {
        fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, color: theme.ink, textAlign: "right",
      });
      paint(add, "تسمية ثانية", "حالة مغلقة", 90, 46, 90, 8, {
        fontFamily: META, fontSize: 11, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      paint(add, "رقم ثالث", "٢٧", 16, 66, 70, 14, {
        fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color: theme.ink, textAlign: "right",
      });
      paint(add, "تسمية ثالثة", "حالة ما زالت مفتوحة", 90, 70, 90, 8, {
        fontFamily: META, fontSize: 11, fontWeight: 600, color: theme.muted, textAlign: "right",
      });
      add("progress", {
        name: "مؤشر الإنجاز",
        x: 16, y: 108, w: 306, h: 12,
        content: "نسبة الإنجاز العام",
        style: { value: 78, fill: theme.primary, showValue: true },
      });
      paint(add, "القراءة", "الإغلاق شبه مكتمل. الحالات المفتوحة لا تغيّر اتجاه الربع.", 16, 132, 306, 10, {
        fontFamily: BODY, fontSize: 13, fontWeight: 500, color: theme.ink, textAlign: "right",
      });
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
  return page("تحريرية", theme, (add) => {
    paint(add, "كِكر", "ملف  ·  مذكرة تحريرية", 16, 22, 178, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 700, color: c.accent, textAlign: "right",
    });
    paint(add, "العنوان", "العنوان الذي\nيقود الصفحة\nلا يزينها", 16, 36, 128, 48, {
      fontFamily: "Noto Kufi Arabic", fontSize: 26, fontWeight: 700, color: c.primary, textAlign: "right", lineHeight: 1.15,
    });
    paint(add, "الرقم البصري", "٠١", 152, 40, 42, 18, {
      fontFamily: DISPLAY, fontSize: 32, fontWeight: 800, color: c.accent, textAlign: "left", lineHeight: 1,
    });
    hairline(add, "فاصل", 16, 96, 178, c.line, 0.35);
    paint(add, "المتن", "فقرة تمهيدية بمقياس القراءة، لا داخل إطار. المسافة البيضاء هي الهامش، والعمود يقف عند قياس واحد حتى تُستبدل الكلمات دون أن ينكسر السطر.", 16, 108, 120, 48, {
      fontFamily: BODY, fontSize: 13, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.8,
    });
    paint(add, "ملاحظة هامشية", "ملاحظة\nعلى الهامش\nلا بطاقة", 146, 112, 48, 28, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right", lineHeight: 1.5,
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 250, 120, 8, {
      fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, color: c.primary, textAlign: "right",
    });
    paint(add, "رقم الصفحة", "٠١", 16, 272, 178, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "left",
    });
  }, A4);
}

function institutionalGridPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("شبكة مؤسسية", theme, (add) => {
    band(add, "شريط الهوية", 0, 0, 210, 14, c.primary);
    paint(add, "عنوان الشريط", "تقرير مؤسسي", 16, 3, 140, 8, {
      fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, color: "#f7f6f3", textAlign: "right",
    });
    add("logo", { name: "شعار الجهة", x: 178, y: 2, w: 10, h: 10 });
    paint(add, "العنوان", "وحدات المعلومات على شبكة واحدة", 16, 26, 178, 12, {
      fontFamily: DISPLAY, fontSize: 18, fontWeight: 800, color: c.primary, textAlign: "right",
    });
    paint(add, "المقدمة", "الصف يُقرأ من اليمين: البند، ثم الرقم، ثم الجملة التي تفسره. لا صندوق حول أي صف.", 16, 44, 178, 14, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.6,
    });
    const rows: [string, string, string][] = [
      ["النطاق", "٦ قطاعات", "كل قطاع يرفع رقمه إلى مكتب واحد."],
      ["الإيقاع", "شهري", "الإغلاق في آخر خميس من الشهر."],
      ["المرجع", "دليل ٢٠٢٦", "النسخ السابقة أُخرجت من التداول."],
      ["الاعتماد", "لجنة واحدة", "لا يصدر رقم بلا توقيع المقرر."],
    ];
    rows.forEach(([label, value, note], i) => {
      const y = 70 + i * 36;
      hairline(add, `خط ${label}`, 16, y, 178, c.line, 0.3);
      paint(add, `بند ${label}`, label, 150, y + 6, 44, 8, {
        fontFamily: META, fontSize: 9, fontWeight: 700, color: c.accent, textAlign: "right",
      });
      paint(add, `قيمة ${label}`, value, 96, y + 6, 48, 10, {
        fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, color: c.primary, textAlign: "right",
      });
      paint(add, `شرح ${label}`, note, 16, y + 8, 76, 14, {
        fontFamily: BODY, fontSize: 11, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.45,
      });
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 230, 178, 8, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "التاريخ", "الفترة الحالية", 16, 242, 178, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "left",
    });
  }, A4);
}

function dataFocusPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تركيز البيانات", theme, (add) => {
    runningHead(add, { ...theme, muted: c.muted, line: c.line }, "تركيز البيانات");
    paint(add, "الرقم", "٩٤", 16, 32, 178, 28, {
      fontFamily: DISPLAY, fontSize: 56, fontWeight: 800, color: c.primary, textAlign: "right", lineHeight: 0.9,
    });
    paint(add, "التسمية", "من مئة  ·  إنجاز الخطة المعتمدة", 16, 64, 178, 8, {
      fontFamily: META, fontSize: 10, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "الجملة", "الرقم بلا جملته مضلِّل: الستة الناقصة كلها في محور واحد.", 16, 80, 178, 12, {
      fontFamily: BODY, fontSize: 13, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.6,
    });
    add("table", {
      name: "جدول التركيز",
      x: 16, y: 104, w: 178, h: 62,
      content: JSON.stringify([
        ["المحور", "الخطة", "الفعلي"],
        ["التشغيل", "٤٠", "٣٤"],
        ["الخدمة", "٣٥", "٣٥"],
        ["التمكين", "٢٥", "٢٥"],
      ]),
      style: tableStyle({ ...theme, primary: c.primary, surface: c.surface, line: c.line, ink: c.ink }, 3, 4),
    });
    paint(add, "فرق موجب", "+٠", 120, 178, 40, 12, {
      fontFamily: DISPLAY, fontSize: 18, fontWeight: 800, color: c.primary, textAlign: "right",
    });
    paint(add, "شرح موجب", "الخدمة والتمكين", 120, 192, 74, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "فرق سالب", "−٦", 16, 178, 40, 12, {
      fontFamily: DISPLAY, fontSize: 18, fontWeight: 800, color: c.accent, textAlign: "right",
    });
    paint(add, "شرح سالب", "عجز التشغيل وحده", 16, 192, 70, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 250, 178, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    folio(add, { ...theme, line: c.line, muted: c.muted }, org, "٠٥");
  }, A4);
}

function verticalFlowPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تدفق رأسي", theme, (add) => {
    paint(add, "العنوان", "من الطلب إلى الأثر", 16, 20, 150, 12, {
      fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, color: c.primary, textAlign: "right",
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 36, 150, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    band(add, "العمود", 186, 58, 0.5, 200, c.line);
    const steps: [string, string, string, boolean][] = [
      ["٠١", "الطلب", "يصل مكتوبًا، لا شفهيًا.", false],
      ["٠٢", "الفرز", "يُرد غير المكتمل في اليوم نفسه.", false],
      ["٠٣", "التنفيذ", "هذه المرحلة الحالية. لها مالك واحد وموعد واحد.", true],
      ["٠٤", "المراجعة", "المراجع ليس المنفّذ.", false],
      ["٠٥", "الأثر", "يُقاس بعد ثلاثين يومًا، لا عند التسليم.", false],
    ];
    steps.forEach(([num, title, body, current], i) => {
      const y = 56 + i * 40;
      band(add, `علامة ${num}`, 182, y + 2, 8, 8, current ? c.accent : c.primary);
      paint(add, `رقم ${num}`, num, 154, y, 24, 8, {
        fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, color: current ? c.accent : c.primary, textAlign: "right",
      });
      paint(add, `عنوان ${title}`, title, 16, y, 132, 8, {
        fontFamily: DISPLAY, fontSize: 14, fontWeight: 800, color: c.ink, textAlign: "right",
      });
      paint(add, `متن ${title}`, body, 16, y + 12, 160, 12, {
        fontFamily: BODY, fontSize: 11, fontWeight: current ? 700 : 500, color: c.ink, textAlign: "right",
      });
    });
  }, A4);
}

function asymmetricPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تحريرية غير متماثلة", theme, (add) => {
    add("image", {
      name: "الصورة القائدة",
      x: 118, y: 0, w: 92, h: 297,
      src: plate("press"),
      style: { objectFit: "cover", radius: 0 },
    });
    paint(add, "كِكر", "ملف", 16, 28, 92, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 700, color: c.accent, textAlign: "right",
    });
    paint(add, "العنوان", "الصورة\nعلى الحافة\nوالنص في الداخل", 16, 42, 92, 42, {
      fontFamily: "Noto Kufi Arabic", fontSize: 18, fontWeight: 700, color: c.primary, textAlign: "right", lineHeight: 1.25,
    });
    hairline(add, "فاصل", 16, 96, 40, c.accent, 1);
    paint(add, "المتن", "العمود ضيق عمدًا. الجملة الطويلة تُكسر، والصورة لا تتنافس معها على العرض.", 16, 108, 92, 48, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.75,
    });
    paint(add, "التعليق", "تعليق الصورة يقف في عمود النص، لا فوق الصورة.", 16, 170, 92, 16, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right", lineHeight: 1.45,
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 260, 92, 8, {
      fontFamily: DISPLAY, fontSize: 11, fontWeight: 700, color: c.primary, textAlign: "right",
    });
  }, A4);
}

function modularPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("وحدات معيارية", theme, (add) => {
    paint(add, "كِكر", "وحدات  ·  بأحجام مختلفة", 16, 18, 178, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 700, color: c.accent, textAlign: "right",
    });
    paint(add, "الوحدة العريضة", "وحدة النص أعرض من وحدة الصورة، لأن القراءة هنا هي العمل.", 16, 30, 178, 16, {
      fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: c.primary, textAlign: "right", lineHeight: 1.35,
    });
    add("image", {
      name: "وحدة الصورة",
      x: 16, y: 58, w: 72, h: 88,
      src: plate("archive"),
      style: { objectFit: "cover", radius: 0 },
    });
    paint(add, "وحدة جانبية", "وحدة قائمة أضيق. ثلاثة أسطر تكفي، والرابع يُحذف.", 96, 58, 98, 28, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.7,
    });
    paint(add, "بند أول", "٠١  وضوح المرجع", 96, 96, 98, 8, {
      fontFamily: META, fontSize: 10, fontWeight: 700, color: c.ink, textAlign: "right",
    });
    paint(add, "بند ثان", "٠٢  مقياس واحد للعنوان", 96, 108, 98, 8, {
      fontFamily: META, fontSize: 10, fontWeight: 700, color: c.ink, textAlign: "right",
    });
    paint(add, "بند ثالث", "٠٣  صورة لها تعليق", 96, 120, 98, 8, {
      fontFamily: META, fontSize: 10, fontWeight: 700, color: c.ink, textAlign: "right",
    });
    hairline(add, "فاصل الاقتباس", 16, 162, 178, c.line, 0.35);
    band(add, "علامة الاقتباس", 16, 174, 18, 1.2, c.accent);
    paint(add, "اقتباس", "الوحدة لا تعني البطاقة. تعني أن لكل كتلة عرضًا يليق بمهمتها.", 16, 182, 178, 20, {
      fontFamily: BODY, fontSize: 13, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.7,
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 250, 178, 8, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "تعليق الصورة", "تعليق الوحدة البصرية", 16, 148, 72, 8, {
      fontFamily: META, fontSize: 7.5, fontWeight: 600, color: c.muted, textAlign: "right",
    });
  }, A4);
}

function executivePage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("ملخص تنفيذي", theme, (add) => {
    paint(add, "تصنيف", "ملخص تنفيذي", 16, 36, 178, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 700, color: c.accent, textAlign: "right",
    });
    paint(add, "الرسالة", "جملة واحدة\nتكفي لهذا\nالاجتماع.", 16, 52, 178, 48, {
      fontFamily: DISPLAY, fontSize: 32, fontWeight: 800, color: c.primary, textAlign: "right", lineHeight: 1.12,
    });
    hairline(add, "فاصل", 150, 112, 44, c.accent, 1);
    paint(add, "الرقم", "٤٢٪", 16, 130, 70, 16, {
      fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: c.ink, textAlign: "right", lineHeight: 1,
    });
    paint(add, "تسمية الرقم", "فوق الخطة، وتحت الطاقة", 16, 148, 80, 8, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "المتن", "لا تُطلب شريحة إضافية. يُطلب قرار: نبقي الهدف، ونؤجل التوسعة.", 100, 132, 94, 28, {
      fontFamily: BODY, fontSize: 13, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.7,
    });
    hairline(add, "خط التوقيع", 16, 220, 48, c.line, 0.4);
    paint(add, "التوقيع", "الاسم\nالصفة", 16, 226, 60, 14, {
      fontFamily: META, fontSize: 10, fontWeight: 600, color: c.muted, textAlign: "right", lineHeight: 1.4,
    });
    paint(add, "الجهة", org || "اسم الجهة", 100, 236, 94, 8, {
      fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, color: c.primary, textAlign: "right",
    });
  }, A4);
}

function statisticalPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("قراءة إحصائية", theme, (add) => {
    runningHead(add, { ...theme, muted: c.muted, line: c.line }, "قراءة إحصائية");
    paint(add, "الرقم", "٤٫٧", 120, 32, 74, 20, {
      fontFamily: DISPLAY, fontSize: 36, fontWeight: 800, color: c.primary, textAlign: "right", lineHeight: 1,
    });
    paint(add, "التسمية", "متوسط الرضا", 120, 54, 74, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    const mini: [string, string][] = [
      ["ن = ١٢٠٠", "العينة"],
      ["±٠٫٢", "هامش الخطأ"],
      ["٩٢٪", "اكتمال الاستجابة"],
    ];
    mini.forEach(([value, label], i) => {
      const y = 32 + i * 14;
      paint(add, `قيمة ${label}`, value, 16, y, 50, 6, {
        fontFamily: DISPLAY, fontSize: 11, fontWeight: 800, color: c.ink, textAlign: "right",
      });
      paint(add, `اسم ${label}`, label, 68, y, 40, 6, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right",
      });
    });
    hairline(add, "قاعدة الرسم", 16, 188, 178, c.ink, 0.4);
    const bars: [string, number][] = [
      ["الخدمة", 86],
      ["السرعة", 74],
      ["الوضوح", 91],
      ["المتابعة", 68],
    ];
    bars.forEach(([label, value], i) => {
      const x = 28 + i * 44;
      const h = value * 0.9;
      band(add, `عمود ${label}`, x, 188 - h, 18, h, i === 2 ? c.accent : c.primary);
      paint(add, `محور ${label}`, String(label), x - 6, 192, 30, 8, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "center",
      });
    });
    paint(add, "القراءة", "الوضوح أعلى المحاور، والمتابعة أدناها. الفجوة إجراء، لا حملة.", 16, 210, 178, 14, {
      fontFamily: BODY, fontSize: 12, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.6,
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 236, 178, 6, {
      fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    folio(add, { ...theme, line: c.line, muted: c.muted }, org, "٠٦");
  }, A4);
}

function sectionDividerPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("فاصل قسم", theme, (add) => {
    paint(add, "الجهة", org || "اسم الجهة", 16, 28, 178, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right",
    });
    paint(add, "رقم القسم", "٠٢", 16, 70, 178, 36, {
      fontFamily: DISPLAY, fontSize: 72, fontWeight: 800, color: c.primary, textAlign: "right", lineHeight: 0.85,
    });
    hairline(add, "فاصل", 140, 118, 54, c.accent, 1.1);
    paint(add, "عنوان القسم", "النتائج\nوالأثر", 16, 132, 150, 28, {
      fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: c.ink, textAlign: "right", lineHeight: 1.1,
    });
    paint(add, "وصف القسم", "ما الذي تغيّر، ولماذا يهم القرار التالي.", 16, 170, 140, 14, {
      fontFamily: BODY, fontSize: 13, fontWeight: 500, color: c.muted, textAlign: "right", lineHeight: 1.6,
    });
    paint(add, "الفهرس", "٠١ النطاق\n٠٢ النتائج\n٠٣ التوصية", 16, 220, 80, 24, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right", lineHeight: 1.6,
    });
  }, A4);
}

function processPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("مراحل إجرائية", theme, (add) => {
    paint(add, "تسمية", "تسلسل إجرائي", 16, 22, 178, 6, {
      fontFamily: META, fontSize: 9, fontWeight: 700, color: c.accent, textAlign: "right",
    });
    paint(add, "العنوان", "أربع مراحل على خط واحد", 16, 34, 178, 12, {
      fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, color: c.primary, textAlign: "right",
    });
    hairline(add, "المسار", 20, 78, 170, c.line, 0.6);
    const stages: [string, string][] = [
      ["تحديد", "نطاق مكتوب ومالك."],
      ["تحليل", "رقم مع مصدر."],
      ["تنفيذ", "هذه المرحلة الآن."],
      ["قياس", "بعد ثلاثين يومًا."],
    ];
    stages.forEach(([label, note], i) => {
      const x = 16 + i * 46;
      band(add, `نقطة ${label}`, x + 14, 74, 8, 8, i === 2 ? c.accent : c.primary);
      paint(add, `رقم ${label}`, `٠${i + 1}`, x, 90, 42, 8, {
        fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, color: i === 2 ? c.accent : c.primary, textAlign: "center",
      });
      paint(add, `اسم ${label}`, label, x, 102, 42, 8, {
        fontFamily: DISPLAY, fontSize: 12, fontWeight: 800, color: c.ink, textAlign: "center",
      });
      paint(add, `شرح ${label}`, note, x, 114, 42, 16, {
        fontFamily: META, fontSize: 8, fontWeight: 600, color: c.muted, textAlign: "center", lineHeight: 1.4,
      });
    });
    paint(add, "الحالة", "المرحلة الحالية هي التنفيذ. القياس لا يبدأ عند التسليم.", 16, 150, 178, 16, {
      fontFamily: BODY, fontSize: 13, fontWeight: 500, color: c.ink, textAlign: "right", lineHeight: 1.7,
    });
    paint(add, "الجهة", org || "اسم الجهة", 16, 250, 178, 8, {
      fontFamily: META, fontSize: 9, fontWeight: 600, color: c.muted, textAlign: "right",
    });
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
    desc: "عمود تجليد، عنوان، وصورة بمعيار الغلاف",
    category: "covers",
    size: A4_SIZE,
  },
  {
    id: "cover-celebration",
    title: "غلاف مناسبة",
    desc: "غلاف مناسبة: صورة ثم عنوان أميري",
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
