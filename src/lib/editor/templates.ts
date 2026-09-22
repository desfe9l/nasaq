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

function page(
  name: string,
  theme: Theme,
  build: (add: Add) => void,
  size?: { w: number; h: number },
): Page {
  const p: Page = {
    id: uid("page"),
    name,
    bg: theme.paper,
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
  return [
    page("الغلاف", theme, (add) => {
      add("shape", {
        name: "الشريط الجانبي",
        x: 0,
        y: 0,
        w: 26,
        h: 297,
        style: { fill: theme.primary, borderWidth: 0 },
      });
      add("line", {
        name: "خط ذهبي رأسي",
        x: 29,
        y: 18,
        w: 1.4,
        h: 252,
        style: { color: theme.accent, stroke: 1.2 },
      });
      add("logo", { name: "شعار الجهة", x: 154, y: 18, w: 32, h: 32 });
      add("text", {
        name: "تصنيف",
        x: 40,
        y: 64,
        w: 140,
        h: 8,
        content: "تقرير رسمي  ·  سري للاستخدام الداخلي",
        style: {
          fontFamily: "Cairo",
          fontSize: 10,
          color: theme.muted,
          fontWeight: 600,
          textAlign: "right",
        },
      });
      add("text", {
        name: "عنوان التقرير",
        x: 40,
        y: 80,
        w: 146,
        h: 40,
        content: "تقرير الأداء السنوي\nللجهة التنفيذية",
        style: {
          fontFamily: "Tajawal",
          fontSize: 28,
          color: theme.primary,
          fontWeight: 800,
          textAlign: "right",
          lineHeight: 1.2,
        },
      });
      add("box", {
        name: "نبذة الغلاف",
        x: 40,
        y: 132,
        w: 132,
        h: 44,
        content:
          "ملخص تنفيذي موجز يعرض نطاق التقرير، أبرز النتائج، والمؤشرات الرئيسية، مع توصيات قابلة للتنفيذ خلال الدورة القادمة.",
        style: {
          fontFamily: "Cairo",
          fontSize: 12,
          color: theme.ink,
          fill: theme.surface,
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
          fontWeight: 500,
          textAlign: "right",
          lineHeight: 1.7,
          padding: 4,
        },
      });
      add("text", {
        name: "الجهة",
        x: 40,
        y: 188,
        w: 130,
        h: 10,
        content: org,
        style: {
          fontFamily: "IBM Plex Sans Arabic",
          fontSize: 12,
          color: theme.primary,
          fontWeight: 700,
          textAlign: "right",
        },
      });
      add("text", {
        name: "التاريخ",
        x: 40,
        y: 236,
        w: 90,
        h: 10,
        content: "سبتمبر 2026  ·  محرم 1448 هـ",
        style: {
          fontFamily: "IBM Plex Sans Arabic",
          fontSize: 11,
          color: theme.muted,
          fontWeight: 600,
          textAlign: "right",
        },
      });
      add("stamp", {
        name: "ختم رسمي",
        x: 142,
        y: 216,
        w: 40,
        h: 40,
        content: "رسمي",
      });
    }),
    page("المحتويات", theme, (add) => {
      header(add, theme, "المحتويات");
      [
        ["المقدمة والنطاق", "03"],
        ["الأهداف الاستراتيجية", "04"],
        ["الإنجازات الرئيسية", "05"],
        ["المؤشرات والإحصائيات", "06"],
        ["التوصيات", "07"],
        ["الخاتمة", "08"],
      ].forEach(([item, num], i) => {
        add("text", {
          name: `بند ${i + 1}`,
          x: 28,
          y: 48 + i * 22,
          w: 154,
          h: 12,
          content: `${item}  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ${num}`,
          style: {
            fontFamily: "Cairo",
            fontSize: 13,
            color: theme.ink,
            fontWeight: 600,
            textAlign: "right",
            lineHeight: 1.2,
          },
        });
      });
      footer(add, theme, org);
    }),
    page("ملخص تنفيذي", theme, (add) => {
      header(add, theme, "ملخص تنفيذي");
      add("text", {
        name: "عنوان فقرة",
        x: 24,
        y: 38,
        w: 162,
        h: 12,
        content: "نظرة عامة",
        style: {
          fontFamily: "Tajawal",
          fontSize: 18,
          color: theme.primary,
          fontWeight: 800,
          textAlign: "right",
        },
      });
      add("box", {
        name: "فقرة رئيسية",
        x: 24,
        y: 54,
        w: 162,
        h: 78,
        content:
          "يستعرض هذا القسم المعلومات الأساسية للتقرير بلغة واضحة ومنظمة. يمكن تعديل النص، الخط، اللون، التباعد، والمحاذاة من لوحة الخصائص بدقة كاملة. يُبرز الملخص أهم النتائج والتوصيات ليكون قابلاً للعرض أمام القيادة دون الحاجة إلى قراءة الوثيقة كاملة.",
        style: {
          fontFamily: "Cairo",
          fontSize: 12.5,
          color: theme.ink,
          fill: "#ffffff",
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
          fontWeight: 500,
          textAlign: "right",
          lineHeight: 1.85,
          padding: 5,
        },
      });
      add("divider", { x: 36, y: 142, w: 138, h: 8 });
      add("table", {
        name: "جدول ملخص",
        x: 24,
        y: 158,
        w: 162,
        h: 72,
        content: JSON.stringify([
          ["المحور", "المستهدف", "المتحقق"],
          ["التشغيل", "100%", "94%"],
          ["الرضا", "4.5", "4.7"],
          ["المبادرات", "20", "18"],
        ]),
        style: {
          cols: 3,
          rows: 4,
          fontSize: 11,
          fontFamily: "Cairo",
          headerBg: theme.primary,
          headerColor: "#ffffff",
          tableBg: "#ffffff",
          borderColor: theme.line,
        },
      });
      footer(add, theme, org);
    }),
    page("الإنجازات", theme, (add) => {
      header(add, theme, "الإنجازات");
      for (let i = 0; i < 4; i++) {
        add("box", {
          name: `بطاقة إنجاز ${i + 1}`,
          x: 24,
          y: 40 + i * 50,
          w: 162,
          h: 42,
          content: `إنجاز رقم ${i + 1}\nوصف مختصر للأثر والنتيجة المتحققة خلال الفترة، مع الإشارة إلى الجهة المنفذة والمؤشر المرتبط.`,
          style: {
            fontFamily: "Cairo",
            fontSize: 12,
            color: theme.ink,
            fill: theme.surface,
            borderColor: theme.line,
            borderWidth: 0.35,
            radius: 4,
            fontWeight: 600,
            textAlign: "right",
            lineHeight: 1.55,
            padding: 4,
          },
        });
        add("icon", {
          name: `أيقونة ${i + 1}`,
          icon: "check",
          x: 168,
          y: 48 + i * 50,
          w: 12,
          h: 12,
          style: { color: "#087f5b", stroke: 2 },
        });
      }
      footer(add, theme, org);
    }),
    page("المؤشرات", theme, (add) => {
      header(add, theme, "المؤشرات والإحصائيات");
      const stats: [string, string][] = [
        ["94%", "نسبة الإنجاز"],
        ["18", "مبادرة مكتملة"],
        ["4.7", "متوسط الرضا"],
        ["12", "شراكة فاعلة"],
      ];
      stats.forEach((stat, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        add("stat", {
          name: `مؤشر ${i + 1}`,
          x: 24 + col * 84,
          y: 42 + row * 52,
          w: 76,
          h: 42,
          content: `${stat[0]}\n${stat[1]}`,
        });
      });
      add("shape", {
        name: "خلفية الرسم",
        x: 24,
        y: 152,
        w: 162,
        h: 88,
        style: {
          fill: theme.surface,
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
        },
      });
      [42, 58, 70, 84, 96].forEach((height, i) => {
        add("shape", {
          name: `عمود ${i + 1}`,
          x: 42 + i * 28,
          y: 228 - height * 0.7,
          w: 14,
          h: height * 0.7,
          style: {
            fill: i === 4 ? theme.accent : theme.primary,
            borderWidth: 0,
            radius: 2,
          },
        });
      });
      footer(add, theme, org);
    }),
    page("الخاتمة", theme, (add) => {
      header(add, theme, "الخاتمة والتوصيات");
      add("box", {
        name: "خلاصة",
        x: 24,
        y: 44,
        w: 162,
        h: 70,
        content:
          "تؤكد نتائج التقرير أهمية الاستمرار في تنفيذ المبادرات وفق منهجية واضحة، مع قياس مستمر للأثر وتحسين دوري للعمليات. نوصي بتعزيز التكامل بين الوحدات وتوثيق الدروس المستفادة للعام القادم.",
        style: {
          fontFamily: "Cairo",
          fontSize: 13,
          color: theme.ink,
          fill: "#ffffff",
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
          fontWeight: 500,
          textAlign: "right",
          lineHeight: 1.8,
          padding: 5,
        },
      });
      add("stamp", { x: 140, y: 132, w: 42, h: 42, content: "خُتم" });
      add("line", {
        x: 28,
        y: 168,
        w: 78,
        h: 4,
        style: { color: theme.ink, stroke: 0.4 },
      });
      add("text", {
        name: "توقيع",
        x: 28,
        y: 174,
        w: 78,
        h: 16,
        content: "اسم المسؤول\nالمنصب",
        style: {
          fontFamily: "Cairo",
          fontSize: 11,
          color: theme.ink,
          fontWeight: 600,
          textAlign: "center",
          lineHeight: 1.45,
        },
      });
      footer(add, theme, org);
    }),
  ];
}

function eidPages(theme: Theme, org: string): Page[] {
  return [
    page("غلاف العيد", theme, (add) => {
      add("shape", {
        name: "خلفية الغلاف",
        x: 0,
        y: 0,
        w: 210,
        h: 297,
        style: { fill: theme.primary, borderWidth: 0 },
      });
      add("shape", {
        name: "شريط ذهبي",
        x: 0,
        y: 0,
        w: 210,
        h: 6,
        style: { fill: theme.accent, borderWidth: 0 },
      });
      add("logo", { name: "شعار", x: 16, y: 16, w: 28, h: 16 });
      add("logo", { name: "شعار وطني", x: 166, y: 16, w: 28, h: 16 });
      add("text", {
        name: "عنوان علوي",
        x: 24,
        y: 48,
        w: 162,
        h: 10,
        content: org,
        style: {
          fontFamily: "Tajawal",
          fontSize: 13,
          color: theme.accent,
          fontWeight: 700,
          textAlign: "center",
        },
      });
      add("text", {
        name: "عنوان التقرير",
        x: 18,
        y: 72,
        w: 174,
        h: 36,
        content: "مجهودات فعاليات\nعيد الأضحى المبارك",
        style: {
          fontFamily: "Amiri",
          fontSize: 28,
          color: "#ffffff",
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.35,
        },
      });
      add("text", {
        name: "السنة",
        x: 24,
        y: 112,
        w: 162,
        h: 10,
        content: "١٤٤٧ هـ",
        style: {
          fontFamily: "Amiri",
          fontSize: 16,
          color: theme.accent,
          fontWeight: 700,
          textAlign: "center",
        },
      });
      add("image", {
        name: "صورة الغلاف",
        x: 18,
        y: 132,
        w: 174,
        h: 96,
        style: { objectFit: "cover", radius: 3 },
      });
      add("text", {
        name: "جهة الإصدار",
        x: 24,
        y: 244,
        w: 162,
        h: 16,
        content: "إدارة الإعلام والاتصال المؤسسي",
        style: {
          fontFamily: "Cairo",
          fontSize: 12,
          color: "#ffffff",
          fontWeight: 600,
          textAlign: "center",
          lineHeight: 1.4,
        },
      });
      add("shape", {
        name: "شريط سفلي",
        x: 0,
        y: 291,
        w: 210,
        h: 6,
        style: { fill: theme.accent, borderWidth: 0 },
      });
    }),
    page("المؤشرات الميدانية", theme, (add) => {
      header(add, theme, "المؤشرات الميدانية");
      const stats: [string, string][] = [
        ["48", "موقعاً ميدانياً"],
        ["120", "مشاركة توعوية"],
        ["16", "فرقاً ميدانية"],
        ["100%", "تغطية المنافذ"],
      ];
      stats.forEach((stat, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        add("stat", {
          x: 24 + col * 84,
          y: 42 + row * 52,
          w: 76,
          h: 42,
          content: `${stat[0]}\n${stat[1]}`,
        });
      });
      add("box", {
        x: 24,
        y: 154,
        w: 162,
        h: 86,
        content:
          "شملت الفعاليات تعزيز الحضور الميداني، وتنظيم الحركة، وبرامج التوعية للقادمين والمغادرين، مع توثيق بصري لكافة المحطات. يمكن استبدال هذا النص بتفاصيل الجهة وإرفاق الصور في الصفحة التالية.",
        style: {
          fontFamily: "Cairo",
          fontSize: 13,
          color: theme.ink,
          fill: theme.surface,
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
          padding: 5,
          textAlign: "right",
          lineHeight: 1.75,
          fontWeight: 500,
        },
      });
      footer(add, theme, org);
    }),
    page("معرض الصور", theme, (add) => {
      header(add, theme, "التوثيق البصري");
      for (let i = 0; i < 4; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        add("image", {
          name: `صورة ${i + 1}`,
          x: 22 + col * 86,
          y: 40 + row * 100,
          w: 80,
          h: 72,
          style: { objectFit: "cover", radius: 3 },
        });
        add("text", {
          name: `تعليق ${i + 1}`,
          x: 22 + col * 86,
          y: 114 + row * 100,
          w: 80,
          h: 8,
          content: "تعليق مختصر للصورة",
          style: {
            fontFamily: "Cairo",
            fontSize: 9,
            color: theme.muted,
            fontWeight: 600,
            textAlign: "center",
          },
        });
      }
      footer(add, theme, org);
    }),
    page("ختام", theme, (add) => {
      add("shape", {
        x: 0,
        y: 0,
        w: 210,
        h: 297,
        style: { fill: theme.primary, borderWidth: 0 },
      });
      add("logo", { x: 88, y: 52, w: 34, h: 34 });
      add("text", {
        x: 24,
        y: 104,
        w: 162,
        h: 22,
        content: "شكراً لكم",
        style: {
          fontFamily: "Amiri",
          fontSize: 32,
          color: "#ffffff",
          fontWeight: 700,
          textAlign: "center",
        },
      });
      add("divider", {
        x: 70,
        y: 132,
        w: 70,
        h: 8,
        style: { color: theme.accent },
      });
      add("text", {
        x: 30,
        y: 148,
        w: 150,
        h: 28,
        content:
          "نقدر جهود الفرق الميدانية والإسناد الإعلامي، ونتطلع إلى مواصلة العمل بروح الفريق.",
        style: {
          fontFamily: "Cairo",
          fontSize: 13,
          color: "#e8efe9",
          fontWeight: 500,
          textAlign: "center",
          lineHeight: 1.7,
        },
      });
      add("text", {
        x: 24,
        y: 220,
        w: 162,
        h: 20,
        content: `${org}\nإدارة الإعلام والاتصال المؤسسي`,
        style: {
          fontFamily: "Tajawal",
          fontSize: 13,
          color: theme.accent,
          fontWeight: 700,
          textAlign: "center",
          lineHeight: 1.5,
        },
      });
    }),
  ];
}

function briefingPages(theme: Theme, org: string): Page[] {
  return [
    page("غلاف العرض", theme, (add) => {
      add("shape", {
        x: 0,
        y: 0,
        w: 210,
        h: 297,
        style: { fill: theme.primary, borderWidth: 0 },
      });
      add("shape", {
        x: 0,
        y: 210,
        w: 210,
        h: 87,
        style: { fill: theme.primarySoft, borderWidth: 0 },
      });
      add("line", {
        x: 28,
        y: 198,
        w: 40,
        h: 4,
        style: { color: theme.accent, stroke: 1.4 },
      });
      add("logo", { x: 28, y: 28, w: 28, h: 28 });
      add("text", {
        x: 28,
        y: 88,
        w: 154,
        h: 40,
        content: "عرض موجز\nللقيادة",
        style: {
          fontFamily: "Tajawal",
          fontSize: 32,
          color: "#ffffff",
          fontWeight: 800,
          textAlign: "right",
          lineHeight: 1.2,
        },
      });
      add("text", {
        x: 28,
        y: 228,
        w: 154,
        h: 20,
        content: `${org}\nسبتمبر 2026`,
        style: {
          fontFamily: "Cairo",
          fontSize: 13,
          color: "#ffffff",
          fontWeight: 600,
          textAlign: "right",
          lineHeight: 1.5,
        },
      });
    }),
    ...officialPages(theme, org).slice(4, 6),
  ];
}

/**
 * Standalone builders reused by the page-template gallery. Each returns a fresh
 * page (new ids), so inserting one never touches the template source.
 */
function statsInfographicPage(theme: Theme, org: string): Page {
  return page("لوحة مؤشرات", theme, (add) => {
    header(add, theme, "لوحة المؤشرات — بيانات تجريبية");
    add("progress", {
      name: "مؤشر تقدم",
      x: 24,
      y: 40,
      w: 162,
      h: 14,
      content: "نسبة الإنجاز العام",
      style: { value: 78, fill: theme.primary },
    });
    add("progress", {
      name: "مؤشر تقدم",
      x: 24,
      y: 60,
      w: 162,
      h: 14,
      content: "رضا المستفيدين",
      style: { value: 92, fill: theme.accent },
    });
    add("progress", {
      name: "مؤشر تقدم",
      x: 24,
      y: 80,
      w: 162,
      h: 14,
      content: "الالتزام بالجدول الزمني",
      style: { value: 64, fill: theme.primarySoft },
    });
    const cards: [string, string][] = [
      ["904", "إجمالي الحالات"],
      ["27", "إصابة"],
      ["96%", "نسبة الاكتمال"],
      ["12", "فرق ميدانية"],
    ];
    cards.forEach(([value, label], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 24 + col * 84;
      const y = 104 + row * 44;
      add("shape", {
        name: `خلفية بطاقة ${i + 1}`,
        x,
        y,
        w: 78,
        h: 38,
        style: {
          fill: theme.surface,
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
        },
      });
      add("text", {
        name: `رقم ${i + 1}`,
        x,
        y: y + 4,
        w: 78,
        h: 16,
        content: value,
        style: {
          fontFamily: "Tajawal",
          fontSize: 26,
          color: theme.primary,
          fontWeight: 800,
          textAlign: "center",
          lineHeight: 1.1,
        },
      });
      add("text", {
        name: `تسمية ${i + 1}`,
        x,
        y: y + 23,
        w: 78,
        h: 8,
        content: label,
        style: {
          fontFamily: "Cairo",
          fontSize: 10,
          color: theme.muted,
          fontWeight: 600,
          textAlign: "center",
        },
      });
    });
    add("text", {
      name: "تنويه بيانات",
      x: 24,
      y: 196,
      w: 162,
      h: 8,
      content: "بيانات تجريبية للعرض فقط — استبدلها بأرقامك الفعلية",
      style: {
        fontFamily: "Cairo",
        fontSize: 9,
        color: theme.muted,
        fontWeight: 600,
        textAlign: "center",
      },
    });
    footer(add, theme, org);
  });
}

function tablePage(theme: Theme, org: string): Page {
  return page("جدول بيانات", theme, (add) => {
    header(add, theme, "جدول البيانات التفصيلي — بيانات تجريبية");
    add("table", {
      name: "جدول تفصيلي",
      x: 22,
      y: 40,
      w: 166,
      h: 96,
      content: JSON.stringify([
        ["البند", "الوحدة", "المستهدف", "المتحقق", "الفارق"],
        ["البنود 1", "حالة", "100", "94", "-6"],
        ["البنود 2", "حالة", "80", "83", "+3"],
        ["البنود 3", "حالة", "60", "57", "-3"],
        ["البنود 4", "حالة", "40", "41", "+1"],
        ["الإجمالي", "—", "280", "275", "-5"],
      ]),
      style: {
        cols: 5,
        rows: 6,
        fontSize: 10.5,
        cellAlign: "center",
      },
    });
    add("text", {
      name: "مصدر",
      x: 22,
      y: 142,
      w: 166,
      h: 8,
      content: "المصدر: بيانات تجريبية (Demo) — عدّل الخلايا من لوحة الخصائص",
      style: {
        fontFamily: "Cairo",
        fontSize: 9,
        color: theme.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
    footer(add, theme, org);
  });
}

function infographicPage(theme: Theme, org: string): Page {
  return page("إنفوجرافيك", theme, (add) => {
    add("shape", {
      name: "خلفية",
      x: 0,
      y: 0,
      w: 210,
      h: 297,
      style: { fill: theme.surface, borderWidth: 0 },
    });
    add("shape", {
      name: "شريط رأسي",
      x: 0,
      y: 0,
      w: 14,
      h: 297,
      style: { fill: theme.primary, borderWidth: 0 },
    });
    add("text", {
      name: "العنوان",
      x: 30,
      y: 28,
      w: 156,
      h: 20,
      content: "مسار العمل في خمس مراحل",
      style: {
        fontFamily: "Tajawal",
        fontSize: 24,
        color: theme.primary,
        fontWeight: 800,
        textAlign: "right",
      },
    });
    add("line", {
      name: "خط ذهبي",
      x: 30,
      y: 52,
      w: 60,
      h: 4,
      style: { color: theme.accent, stroke: 1 },
    });
    const steps: [string, string][] = [
      ["01", "التخطيط وتحديد النطاق"],
      ["02", "جمع البيانات والتحقق منها"],
      ["03", "التحليل واستخراج المؤشرات"],
      ["04", "إعداد التقرير وإخراجه"],
      ["05", "المتابعة وقياس الأثر"],
    ];
    steps.forEach(([num, label], i) => {
      const y = 72 + i * 40;
      add("shape", {
        name: `دائرة ${num}`,
        x: 162,
        y,
        w: 24,
        h: 24,
        style: { fill: theme.primary, shape: "circle", borderWidth: 0 },
      });
      add("text", {
        name: `رقم ${num}`,
        x: 162,
        y: y + 6,
        w: 24,
        h: 12,
        content: num,
        style: {
          fontFamily: "Cairo",
          fontSize: 13,
          color: "#ffffff",
          fontWeight: 800,
          textAlign: "center",
        },
      });
      add("box", {
        name: `مرحلة ${num}`,
        x: 30,
        y,
        w: 124,
        h: 24,
        content: label,
        style: {
          fontFamily: "Cairo",
          fontSize: 12,
          color: theme.ink,
          fill: "#ffffff",
          borderColor: theme.line,
          borderWidth: 0.35,
          radius: 4,
          padding: 5,
          textAlign: "right",
          fontWeight: 600,
        },
      });
      if (i < steps.length - 1) {
        add("line", {
          name: `وصلة ${num}`,
          x: 173,
          y: y + 25,
          w: 2,
          h: 14,
          style: { color: theme.line, stroke: 0.5 },
        });
      }
    });
    footer(add, theme, org);
  });
}

function coverPage(theme: Theme, org: string): Page {
  return officialPages(theme, org)[0];
}

function slidesPages(theme: Theme, org: string): Page[] {
  const size = { w: 338.7, h: 190.5 };
  return [
    page(
      "شريحة الغلاف",
      theme,
      (add) => {
        add("shape", {
          name: "خلفية",
          x: 0,
          y: 0,
          w: 338.7,
          h: 190.5,
          style: { fill: theme.primary, borderWidth: 0 },
        });
        add("shape", {
          name: "كتلة سفلية",
          x: 0,
          y: 140,
          w: 338.7,
          h: 50.5,
          style: { fill: theme.primarySoft, borderWidth: 0 },
        });
        add("line", {
          name: "خط ذهبي",
          x: 30,
          y: 126,
          w: 56,
          h: 4,
          style: { color: theme.accent, stroke: 1.6 },
        });
        add("logo", { name: "شعار", x: 284, y: 26, w: 30, h: 30 });
        add("text", {
          name: "عنوان العرض",
          x: 30,
          y: 62,
          w: 230,
          h: 36,
          content: "عرض تنفيذي\nللنتائج الرئيسية",
          style: {
            fontFamily: "Tajawal",
            fontSize: 34,
            color: "#ffffff",
            fontWeight: 800,
            textAlign: "right",
            lineHeight: 1.2,
          },
        });
        add("text", {
          name: "الجهة",
          x: 30,
          y: 156,
          w: 260,
          h: 16,
          content: `${org}  ·  بيانات تجريبية للعرض`,
          style: {
            fontFamily: "Cairo",
            fontSize: 12,
            color: "#ffffff",
            fontWeight: 600,
            textAlign: "right",
          },
        });
      },
      size,
    ),
    page(
      "شريحة المؤشرات",
      theme,
      (add) => {
        header(add, theme, "المؤشرات الرئيسية — بيانات تجريبية", size.w);
        const cards: [string, string][] = [
          ["904", "إجمالي الحالات"],
          ["27", "إصابة"],
          ["96%", "نسبة الاكتمال"],
        ];
        cards.forEach(([value, label], i) => {
          const x = 28 + i * 100;
          add("shape", {
            name: `بطاقة ${i + 1}`,
            x,
            y: 48,
            w: 92,
            h: 62,
            style: {
              fill: theme.surface,
              borderColor: theme.line,
              borderWidth: 0.35,
              radius: 5,
            },
          });
          add("text", {
            name: `رقم ${i + 1}`,
            x,
            y: 58,
            w: 92,
            h: 24,
            content: value,
            style: {
              fontFamily: "Tajawal",
              fontSize: 30,
              color: theme.primary,
              fontWeight: 800,
              textAlign: "center",
              lineHeight: 1.1,
            },
          });
          add("text", {
            name: `تسمية ${i + 1}`,
            x,
            y: 86,
            w: 92,
            h: 10,
            content: label,
            style: {
              fontFamily: "Cairo",
              fontSize: 11,
              color: theme.muted,
              fontWeight: 600,
              textAlign: "center",
            },
          });
        });
        add("progress", {
          name: "مؤشر",
          x: 28,
          y: 124,
          w: 288,
          h: 16,
          content: "نسبة الإنجاز العام",
          style: { value: 78, fill: theme.primary },
        });
        footer(add, theme, org, size.w, size.h);
      },
      size,
    ),
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

function officialMark(add: Add, colors: TemplateInk, title: string, y = 18) {
  add("logo", { name: "مساحة الشعار الرسمي", x: 24, y, w: 22, h: 22 });
  add("text", {
    name: "عنوان القالب",
    x: 52,
    y: y + 2,
    w: 132,
    h: 12,
    content: title,
    style: {
      fontFamily: "Tajawal",
      fontSize: 16,
      color: colors.primary,
      fontWeight: 800,
      textAlign: "right",
    },
  });
  add("text", {
    name: "تاريخ التقرير",
    x: 24,
    y: y + 28,
    w: 160,
    h: 8,
    content: "التاريخ",
    style: {
      fontFamily: "Cairo",
      fontSize: 9,
      color: colors.muted,
      fontWeight: 600,
      textAlign: "right",
    },
  });
}

function editorialPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تحريرية", theme, (add) => {
    officialMark(add, c, "عنوان التقرير");
    add("text", {
      name: "عنوان رئيسي",
      x: 24,
      y: 70,
      w: 112,
      h: 42,
      content: "العنوان الرئيسي\nللتقرير",
      style: {
        fontFamily: "Tajawal",
        fontSize: 27,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
        lineHeight: 1.18,
      },
    });
    add("stat", {
      name: "الرقم البصري",
      x: 150,
      y: 66,
      w: 36,
      h: 42,
      content: "01\nمؤشر",
      style: {
        fontFamily: "Tajawal",
        fontSize: 22,
        color: c.primary,
        fontWeight: 800,
        textAlign: "center",
      },
    });
    add("box", {
      name: "كتلة النص",
      x: 24,
      y: 132,
      w: 112,
      h: 58,
      content:
        "نص تمهيدي مختصر يشرح موضوع الصفحة ويترك مساحة مريحة للقراءة والتحرير.",
      style: {
        fontFamily: "Cairo",
        fontSize: 12,
        color: c.ink,
        fill: "#ffffff",
        borderColor: c.line,
        borderWidth: 0.35,
        radius: 0,
        padding: 5,
        lineHeight: 1.8,
        textAlign: "right",
      },
    });
    add("shape", {
      name: "كتلة لونية هادئة",
      x: 151,
      y: 128,
      w: 34,
      h: 70,
      style: { fill: c.primary, borderWidth: 0, radius: 0 },
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 240,
      w: 110,
      h: 10,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 11,
        color: c.primary,
        fontWeight: 700,
        textAlign: "right",
      },
    });
    add("text", {
      name: "تذييل الصفحة",
      x: 24,
      y: 268,
      w: 162,
      h: 8,
      content: "ملاحظة تحريرية",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
}

function institutionalGridPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("شبكة مؤسسية", theme, (add) => {
    add("shape", {
      name: "منطقة الترويسة",
      x: 0,
      y: 0,
      w: 210,
      h: 52,
      style: { fill: c.primary, borderWidth: 0, radius: 0 },
    });
    add("logo", { name: "مساحة الشعار الرسمي", x: 166, y: 12, w: 22, h: 22 });
    add("text", {
      name: "عنوان الشبكة",
      x: 24,
      y: 15,
      w: 130,
      h: 13,
      content: "تقرير مؤسسي",
      style: {
        fontFamily: "Tajawal",
        fontSize: 17,
        color: "#ffffff",
        fontWeight: 800,
        textAlign: "right",
      },
    });
    add("text", {
      name: "التاريخ",
      x: 24,
      y: 35,
      w: 130,
      h: 7,
      content: "التاريخ",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: "#ffffff",
        fontWeight: 600,
        textAlign: "right",
      },
    });
    const cells = [
      [24, 70, 76, 62],
      [110, 70, 76, 62],
      [24, 144, 76, 82],
      [110, 144, 76, 82],
    ] as const;
    cells.forEach(([x, y, w, h], i) => {
      add("shape", {
        name: `وحدة شبكية ${i + 1}`,
        x,
        y,
        w,
        h,
        style: {
          fill: "#ffffff",
          borderColor: c.line,
          borderWidth: 0.35,
          radius: 0,
        },
      });
      add(i === 0 ? "stat" : "box", {
        name: `محتوى الوحدة ${i + 1}`,
        x: x + 6,
        y: y + 8,
        w: w - 12,
        h: h - 16,
        content:
          i === 0 ? "01\nمؤشر رئيسي" : "عنوان الوحدة\nنص مختصر قابل للتحرير",
        style: {
          fontFamily: i === 0 ? "Tajawal" : "Cairo",
          fontSize: i === 0 ? 22 : 11,
          color: i === 0 ? c.primary : c.ink,
          fontWeight: 700,
          textAlign: "right",
          lineHeight: 1.6,
          padding: 2,
        },
      });
    });
    add("text", {
      name: "الجهة",
      x: 24,
      y: 253,
      w: 162,
      h: 9,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 9,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
}

function dataFocusPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تركيز البيانات", theme, (add) => {
    officialMark(add, c, "البيانات أولًا");
    add("text", {
      name: "عنوان صغير",
      x: 24,
      y: 68,
      w: 162,
      h: 10,
      content: "ملخص المؤشر",
      style: {
        fontFamily: "Cairo",
        fontSize: 11,
        color: c.muted,
        fontWeight: 700,
        textAlign: "right",
      },
    });
    add("text", {
      name: "رقم رئيسي",
      x: 24,
      y: 82,
      w: 100,
      h: 38,
      content: "000",
      style: {
        fontFamily: "Tajawal",
        fontSize: 48,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
        lineHeight: 1,
      },
    });
    add("text", {
      name: "وصف الرقم",
      x: 24,
      y: 124,
      w: 100,
      h: 9,
      content: "وصف الرقم الرئيسي",
      style: {
        fontFamily: "Cairo",
        fontSize: 10,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
    ["مؤشر ثانوي", "مؤشر ثانوي", "مؤشر ثانوي"].forEach((label, i) =>
      add("stat", {
        name: label,
        x: 145,
        y: 78 + i * 30,
        w: 41,
        h: 24,
        content: `0${i + 1}\n${label}`,
        style: {
          fontFamily: "Tajawal",
          fontSize: 13,
          color: c.ink,
          fontWeight: 700,
          textAlign: "center",
        },
      }),
    );
    add("table", {
      name: "جدول البيانات",
      x: 24,
      y: 158,
      w: 162,
      h: 74,
      content: JSON.stringify([
        ["المؤشر", "القيمة", "الحالة"],
        ["بند قابل للتحرير", "000", "--"],
        ["بند قابل للتحرير", "000", "--"],
      ]),
      style: {
        cols: 3,
        rows: 3,
        fontSize: 10,
        headerBg: c.primary,
        headerColor: "#ffffff",
        tableBg: "#ffffff",
        borderColor: c.line,
        cellAlign: "center",
      },
    });
    add("text", {
      name: "مصدر البيانات",
      x: 24,
      y: 246,
      w: 162,
      h: 8,
      content: "مصدر البيانات",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 266,
      w: 162,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.primary,
        fontWeight: 700,
        textAlign: "right",
      },
    });
  });
}

function verticalFlowPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تدفق رأسي", theme, (add) => {
    officialMark(add, c, "تدفق العمل", 14);
    add("text", {
      name: "عنوان التدفق",
      x: 24,
      y: 58,
      w: 162,
      h: 24,
      content: "من الفكرة إلى الأثر",
      style: {
        fontFamily: "Tajawal",
        fontSize: 24,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
      },
    });
    const blocks = [
      [24, 98, 162, 30],
      [42, 140, 144, 38],
      [60, 190, 126, 48],
      [78, 250, 108, 25],
    ] as const;
    blocks.forEach(([x, y, w, h], i) => {
      add("shape", {
        name: `مرحلة ${i + 1}`,
        x,
        y,
        w,
        h,
        style: {
          fill: i % 2 ? "#ffffff" : c.surface,
          borderColor: c.line,
          borderWidth: 0.35,
          radius: 0,
        },
      });
      add("text", {
        name: `عنوان مرحلة ${i + 1}`,
        x: x + 7,
        y: y + 7,
        w: w - 14,
        h: 10,
        content: `0${i + 1}  ·  عنوان المرحلة`,
        style: {
          fontFamily: "Cairo",
          fontSize: 11,
          color: c.ink,
          fontWeight: 700,
          textAlign: "right",
        },
      });
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 278,
      w: 162,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
}

function asymmetricPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("تحريرية غير متماثلة", theme, (add) => {
    add("shape", {
      name: "كتلة جانبية",
      x: 0,
      y: 0,
      w: 72,
      h: 297,
      style: { fill: c.primary, borderWidth: 0, radius: 0 },
    });
    add("logo", { name: "مساحة الشعار الرسمي", x: 24, y: 20, w: 22, h: 22 });
    add("text", {
      name: "عنوان جانبي",
      x: 18,
      y: 62,
      w: 38,
      h: 90,
      content: "قسم\nالتقرير",
      style: {
        fontFamily: "Tajawal",
        fontSize: 22,
        color: "#ffffff",
        fontWeight: 800,
        textAlign: "center",
        writingMode: "vertical",
      },
    });
    add("text", {
      name: "العنوان الرئيسي",
      x: 92,
      y: 42,
      w: 92,
      h: 38,
      content: "عنوان غير\nمتماثل",
      style: {
        fontFamily: "Tajawal",
        fontSize: 25,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
        lineHeight: 1.2,
      },
    });
    add("stat", {
      name: "مرساة بصرية",
      x: 94,
      y: 102,
      w: 48,
      h: 46,
      content: "01\nنتيجة",
      style: {
        fontFamily: "Tajawal",
        fontSize: 20,
        color: c.primary,
        fontWeight: 800,
        textAlign: "center",
      },
    });
    add("box", {
      name: "النص الرئيسي",
      x: 92,
      y: 166,
      w: 94,
      h: 56,
      content: "نص موجز يشرح الفكرة الأساسية للصفحة.",
      style: {
        fontFamily: "Cairo",
        fontSize: 12,
        color: c.ink,
        fill: "#ffffff",
        borderColor: c.line,
        borderWidth: 0.35,
        radius: 0,
        padding: 5,
        lineHeight: 1.8,
        textAlign: "right",
      },
    });
    add("text", {
      name: "التاريخ",
      x: 92,
      y: 254,
      w: 94,
      h: 8,
      content: "التاريخ  ·  " + (org || "اسم الجهة"),
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
}

function modularPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("وحدات معيارية", theme, (add) => {
    officialMark(add, c, "وحدات التقرير", 12);
    const modules = [
      [24, 62, 78, 54, "عنوان ونص"],
      [112, 62, 74, 32, "01  رقم"],
      [112, 104, 74, 72, "ملاحظة"],
      [24, 128, 78, 48, "مؤشر"],
      [24, 188, 162, 42, "جدول أو رسم"],
    ] as const;
    modules.forEach(([x, y, w, h, label], i) => {
      add("shape", {
        name: `وحدة ${i + 1}`,
        x,
        y,
        w,
        h,
        style: {
          fill: i === 1 ? c.primary : "#ffffff",
          borderColor: c.line,
          borderWidth: 0.35,
          radius: 0,
        },
      });
      add(i === 1 ? "stat" : i === 4 ? "table" : "box", {
        name: `محتوى الوحدة ${i + 1}`,
        x: x + 5,
        y: y + 5,
        w: w - 10,
        h: h - 10,
        content:
          i === 4
            ? JSON.stringify([
                ["البند", "القيمة"],
                ["بند قابل للتحرير", "000"],
              ])
            : label,
        style: {
          fontFamily: i === 1 ? "Tajawal" : "Cairo",
          fontSize: i === 1 ? 20 : 11,
          color: i === 1 ? "#ffffff" : c.ink,
          fontWeight: 700,
          textAlign: "right",
          cols: i === 4 ? 2 : undefined,
          rows: i === 4 ? 2 : undefined,
          headerBg: c.primary,
          headerColor: "#ffffff",
          tableBg: "#ffffff",
          borderColor: c.line,
          padding: 2,
          lineHeight: 1.6,
        },
      });
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 260,
      w: 162,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
}

function executivePage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("ملخص تنفيذي", theme, (add) => {
    add("logo", { name: "مساحة الشعار الرسمي", x: 94, y: 20, w: 22, h: 22 });
    add("text", {
      name: "التاريخ",
      x: 24,
      y: 24,
      w: 62,
      h: 8,
      content: "التاريخ",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "left",
      },
    });
    add("text", {
      name: "العنوان التنفيذي",
      x: 34,
      y: 72,
      w: 142,
      h: 36,
      content: "ملخص تنفيذي",
      style: {
        fontFamily: "Tajawal",
        fontSize: 31,
        color: c.primary,
        fontWeight: 800,
        textAlign: "center",
      },
    });
    add("line", {
      name: "خط مرجعي",
      x: 82,
      y: 120,
      w: 46,
      h: 2,
      style: { color: c.accent, stroke: 0.8 },
    });
    add("box", {
      name: "الرسالة التنفيذية",
      x: 46,
      y: 142,
      w: 118,
      h: 48,
      content: "رسالة واحدة مركزة تلخص القرار أو النتيجة الأهم.",
      style: {
        fontFamily: "Cairo",
        fontSize: 13,
        color: c.ink,
        fill: "#ffffff",
        borderWidth: 0,
        padding: 4,
        lineHeight: 1.8,
        textAlign: "center",
      },
    });
    add("text", {
      name: "الرقم التنفيذي",
      x: 72,
      y: 210,
      w: 66,
      h: 32,
      content: "000",
      style: {
        fontFamily: "Tajawal",
        fontSize: 38,
        color: c.primary,
        fontWeight: 800,
        textAlign: "center",
      },
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 266,
      w: 162,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "center",
      },
    });
  });
}

function statisticalPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("إحصائية", theme, (add) => {
    officialMark(add, c, "قراءة إحصائية", 14);
    add("text", {
      name: "الرقم الأكبر",
      x: 24,
      y: 70,
      w: 86,
      h: 46,
      content: "000",
      style: {
        fontFamily: "Tajawal",
        fontSize: 55,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
      },
    });
    add("text", {
      name: "وصف الإحصائية",
      x: 24,
      y: 120,
      w: 86,
      h: 9,
      content: "المؤشر الأساسي",
      style: {
        fontFamily: "Cairo",
        fontSize: 10,
        color: c.muted,
        fontWeight: 700,
        textAlign: "right",
      },
    });
    ["مؤشر 01", "مؤشر 02", "مؤشر 03"].forEach((label, i) =>
      add("stat", {
        name: label,
        x: 132,
        y: 72 + i * 34,
        w: 54,
        h: 28,
        content: `00${i + 1}\n${label}`,
        style: {
          fontFamily: "Tajawal",
          fontSize: 14,
          color: c.ink,
          fontWeight: 700,
          textAlign: "center",
        },
      }),
    );
    add("shape", {
      name: "مساحة الرسم",
      x: 24,
      y: 154,
      w: 162,
      h: 66,
      style: {
        fill: c.surface,
        borderColor: c.line,
        borderWidth: 0.35,
        radius: 0,
      },
    });
    [24, 44, 68, 52, 82].forEach((h, i) =>
      add("shape", {
        name: `عمود قابل للتحرير ${i + 1}`,
        x: 42 + i * 25,
        y: 210 - h,
        w: 11,
        h,
        style: {
          fill: i === 4 ? c.accent : c.primary,
          borderWidth: 0,
          radius: 0,
        },
      }),
    );
    add("table", {
      name: "جدول الإحصائية",
      x: 24,
      y: 232,
      w: 162,
      h: 34,
      content: JSON.stringify([
        ["البند", "القيمة"],
        ["بند قابل للتحرير", "000"],
      ]),
      style: {
        cols: 2,
        rows: 2,
        fontSize: 9,
        headerBg: c.primary,
        headerColor: "#ffffff",
        tableBg: "#ffffff",
        borderColor: c.line,
      },
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 278,
      w: 162,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
}

function sectionDividerPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("فاصل قسم", theme, (add) => {
    add("logo", { name: "مساحة الشعار الرسمي", x: 24, y: 22, w: 22, h: 22 });
    add("text", {
      name: "اسم الجهة",
      x: 52,
      y: 28,
      w: 134,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 9,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
    add("text", {
      name: "رقم القسم",
      x: 24,
      y: 90,
      w: 162,
      h: 70,
      content: "01",
      style: {
        fontFamily: "Tajawal",
        fontSize: 88,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
        lineHeight: 0.9,
      },
    });
    add("text", {
      name: "عنوان القسم",
      x: 24,
      y: 174,
      w: 120,
      h: 22,
      content: "عنوان القسم",
      style: {
        fontFamily: "Tajawal",
        fontSize: 25,
        color: c.ink,
        fontWeight: 800,
        textAlign: "right",
      },
    });
    add("text", {
      name: "وصف القسم",
      x: 24,
      y: 208,
      w: 108,
      h: 26,
      content: "وصف مختصر للقسم ومساره.",
      style: {
        fontFamily: "Cairo",
        fontSize: 11,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
        lineHeight: 1.7,
      },
    });
    add("shape", {
      name: "علامة القسم",
      x: 158,
      y: 174,
      w: 28,
      h: 28,
      style: { fill: c.accent, borderWidth: 0, shape: "circle" },
    });
  });
}

function processPage(theme: Theme, org: string): Page {
  const c = identity(theme);
  return page("مراحل إجرائية", theme, (add) => {
    officialMark(add, c, "المراحل الإجرائية", 14);
    add("text", {
      name: "عنوان المسار",
      x: 24,
      y: 62,
      w: 162,
      h: 18,
      content: "منهجية التنفيذ",
      style: {
        fontFamily: "Tajawal",
        fontSize: 22,
        color: c.primary,
        fontWeight: 800,
        textAlign: "right",
      },
    });
    const stages = ["تحديد", "تحليل", "تنفيذ", "قياس"];
    stages.forEach((label, i) => {
      const x = 24 + i * 43;
      if (i < stages.length - 1)
        add("line", {
          name: `صلة المرحلة ${i + 1}`,
          x: x + 18,
          y: 128,
          w: 25,
          h: 2,
          style: { color: c.line, stroke: 0.7 },
        });
      add("shape", {
        name: `نقطة المرحلة ${i + 1}`,
        x,
        y: 116,
        w: 24,
        h: 24,
        style: {
          fill: i === 0 ? c.primary : "#ffffff",
          borderColor: c.primary,
          borderWidth: 0.7,
          shape: "circle",
        },
      });
      add("text", {
        name: `رقم المرحلة ${i + 1}`,
        x,
        y: 122,
        w: 24,
        h: 8,
        content: `0${i + 1}`,
        style: {
          fontFamily: "Tajawal",
          fontSize: 10,
          color: i === 0 ? "#ffffff" : c.primary,
          fontWeight: 800,
          textAlign: "center",
        },
      });
      add("text", {
        name: `اسم المرحلة ${i + 1}`,
        x: x - 5,
        y: 150,
        w: 34,
        h: 10,
        content: label,
        style: {
          fontFamily: "Cairo",
          fontSize: 10,
          color: c.ink,
          fontWeight: 700,
          textAlign: "center",
        },
      });
    });
    add("box", {
      name: "ملاحظة المسار",
      x: 24,
      y: 190,
      w: 162,
      h: 42,
      content: "ملاحظة أو وصف مختصر للعملية.",
      style: {
        fontFamily: "Cairo",
        fontSize: 12,
        color: c.ink,
        fill: "#ffffff",
        borderColor: c.line,
        borderWidth: 0.35,
        radius: 0,
        padding: 4,
        lineHeight: 1.7,
        textAlign: "right",
      },
    });
    add("text", {
      name: "اسم الجهة",
      x: 24,
      y: 266,
      w: 162,
      h: 8,
      content: org || "اسم الجهة",
      style: {
        fontFamily: "Cairo",
        fontSize: 8,
        color: c.muted,
        fontWeight: 600,
        textAlign: "right",
      },
    });
  });
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
    desc: "غلاف عرض مع مؤشرات وخاتمة",
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
    desc: "صفحة بيضاء مع رأس وتذييل خفيف",
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
            : [
                page("صفحة 1", theme, (add) => {
                  header(add, theme, "مستند جديد");
                  footer(add, theme, orgName);
                }),
              ];

  return {
    version: 2,
    name:
      pack === "eid"
        ? "تقرير فعالية"
        : pack === "briefing"
          ? "عرض قيادي"
          : pack === "slides"
            ? "عرض تقديمي 16:9"
            : pack === "blank"
              ? "مستند جديد"
              : "تقرير رسمي",
    theme: pack === "eid" ? "eid" : themeId,
    orgName,
    defaultSize: pack === "slides" ? "slide-16-9" : "a4-portrait",
    pages,
  };
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
    desc: "شريط كحلي وشعار وعنوان",
    category: "covers",
    size: A4_SIZE,
  },
  {
    id: "cover-celebration",
    title: "غلاف مناسبة",
    desc: "غلاف احتفالي بخلفية داكنة",
    category: "covers",
    size: A4_SIZE,
  },
  {
    id: "text",
    title: "صفحة نصية",
    desc: "عنوان وفقرة وجدول",
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
    desc: "بطاقات أثر",
    category: "inner",
    size: A4_SIZE,
  },
  {
    id: "images",
    title: "معرض صور",
    desc: "أربع صور مع تعليق",
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
    desc: "أربع بطاقات أرقام وأشرطة تقدم",
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
    desc: "ثلاث بطاقات ومؤشر تقدم",
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
    default:
      return coverPage(theme, org);
  }
}

/** Pages of a starter pack, for the "new project from template" flow. */
export function packPages(pack: PackId, theme: Theme, org: string): Page[] {
  return createProject(pack, theme.id, org).pages;
}
