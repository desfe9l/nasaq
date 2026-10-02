import { createElement, THEMES, type CanvasEl, type Page, type PackId } from "./model";
import {
  createProject,
  createTemplatePage,
  PACKS,
  PAGE_TEMPLATES,
  type TemplateCategoryId,
} from "./templates";
import { uid } from "@/lib/utils";
import { canUseDemoPack } from "@/lib/product/product";
import { bindDesignSkill } from "./design-skill";

bindDesignSkill("products");

export interface ProductTemplateSeed {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  tier: "free" | "licensed";
  status: "draft" | "published";
  kind: "json";
  sortOrder: number;
  content: string;
  thumbnail: string;
}

const INK = "#18332b";
const GREEN = "#006c35";
const GREEN_SOFT = "#e9f3ed";
const GOLD = "#c9a86a";
const MUTED = "#62736b";
const LINE = "#dce5df";
const PAPER = "#ffffff";

function page(name: string, w = 210, h = 297): Page {
  return { id: uid("page"), name, w, h, bg: PAPER, elements: [] };
}

function add(
  target: Page,
  type: CanvasEl["type"],
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  content = "",
  style: CanvasEl["style"] = {},
  src?: string,
): CanvasEl {
  const element = createElement(type, {
    name,
    x,
    y,
    w,
    h,
    content,
    src,
    style,
  });
  element.z = target.elements.length + 1;
  target.elements.push(element);
  return element;
}

function text(
  target: Page,
  name: string,
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: {
    size?: number;
    color?: string;
    weight?: number;
    align?: "right" | "center" | "left" | "justify";
    font?: string;
    fill?: string;
    borderColor?: string;
    padding?: number;
  } = {},
) {
  return add(target, "text", name, x, y, w, h, content, {
    fontFamily: options.font ?? "Tajawal",
    fontSize: options.size ?? 10,
    fontWeight: options.weight ?? 500,
    color: options.color ?? INK,
    textAlign: options.align ?? "right",
    lineHeight: 1.35,
    fill: options.fill,
    borderColor: options.borderColor,
    borderWidth: options.borderColor ? 0.25 : 0,
    padding: options.padding ?? 0,
  });
}

function shape(
  target: Page,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  borderColor = "",
) {
  return add(target, "shape", name, x, y, w, h, "", {
    fill,
    borderColor: borderColor || undefined,
    borderWidth: borderColor ? 0.3 : 0,
    radius: 1.5,
  });
}

function rule(target: Page, y: number, x = 17, w = 176, color = LINE) {
  return add(target, "line", "فاصل قابل للتحرير", x, y, w, 0, "", {
    color,
    stroke: 0.35,
  });
}

function photoPlaceholder(label: string, landscape = false): string {
  void label;
  const width = landscape ? 900 : 600;
  const height = landscape ? 560 : 760;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#143028"/><rect y="${height * 0.62}" width="100%" height="${height * 0.38}" fill="#0d241c"/><rect x="${width * 0.08}" y="${height * 0.18}" width="${width * 0.12}" height="${height * 0.62}" fill="#1d4a38"/><rect x="${width * 0.24}" y="${height * 0.28}" width="${width * 0.18}" height="${height * 0.52}" fill="#245743"/><rect x="${width * 0.46}" y="${height * 0.12}" width="${width * 0.22}" height="${height * 0.68}" fill="#1a3d2e"/><rect x="${width * 0.72}" y="${height * 0.22}" width="${width * 0.16}" height="${height * 0.1}" fill="#c9a86a"/><rect y="${height * 0.96}" width="100%" height="${height * 0.04}" fill="#c9a86a"/></svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function resumePage(language: "ar" | "en"): Page {
  const arabic = language === "ar";
  const target = page(arabic ? "السيرة الذاتية" : "Resume");
  const align = arabic ? "right" : "left";
  const startX = arabic ? 18 : 18;
  const bodyW = arabic ? 140 : 174;
  shape(target, "خط الهوية", 0, 0, 210, 2.2, GREEN);
  if (arabic) {
    add(target, "image", "صورة شخصية اختيارية", 168, 12, 24, 28, "", {}, photoPlaceholder("صورة اختيارية"));
  }
  text(target, "الاسم", arabic ? "الاسم الكامل" : "FULL NAME", startX, 12, bodyW, 12, {
    size: 24,
    color: GREEN,
    weight: 800,
    align,
    font: arabic ? "Tajawal" : "Georgia",
  });
  text(target, "المسمى المهني", arabic ? "المسمى المهني المستهدف" : "TARGET ROLE", startX, 26, bodyW, 7, {
    size: 10,
    color: INK,
    weight: 600,
    align,
  });
  rule(target, 36, startX, bodyW, GOLD);
  text(target, "معلومات التواصل", arabic
    ? "المدينة  ·  البريد الإلكتروني  ·  الهاتف  ·  LinkedIn"
    : "City  ·  email@example.com  ·  +1 555 0100  ·  LinkedIn", startX, 40, bodyW, 6, {
    size: 7.5,
    color: MUTED,
    align,
  });

  let y = 54;
  const section = (title: string, content: string, height: number) => {
    text(target, `عنوان ${title}`, title, startX, y, bodyW, 7, {
      size: 11,
      color: GREEN,
      weight: 800,
      align,
    });
    rule(target, y + 9, startX, bodyW, GOLD);
    text(target, title, content, startX, y + 12, bodyW, height, {
      size: 8.5,
      align,
      font: arabic ? "Tajawal" : "Georgia",
    });
    y += height + 18;
  };
  section(
    arabic ? "الملخص المهني" : "PROFILE",
    arabic
      ? "ملخص مهني من 3 إلى 4 أسطر يوضح الخبرة والتخصص والقيمة التي تقدمها. استخدم كلمات مفتاحية مرتبطة بالوظيفة."
      : "Write a concise 3–4 line profile focused on role, years of experience, strengths, and measurable value.",
    17,
  );
  section(
    arabic ? "الخبرة المهنية" : "EXPERIENCE",
    arabic
      ? "المسمى الوظيفي  |  اسم الجهة  |  2022–الآن\n• إنجاز قابل للقياس يبدأ بفعل واضح\n• أثر مهني مدعوم برقم أو نتيجة"
      : "Job Title | Company | 2022–Present\n• Start with a strong action verb and measurable result.\n• Keep each achievement specific and relevant.",
    34,
  );
  section(
    arabic ? "التعليم" : "EDUCATION",
    arabic
      ? "الدرجة العلمية والتخصص  |  اسم الجامعة  |  سنة التخرج"
      : "Degree and Major | University | Graduation Year",
    12,
  );
  section(
    arabic ? "المهارات واللغات" : "SKILLS & LANGUAGES",
    arabic
      ? "مهارة تقنية  ·  مهارة تخصصية  ·  إدارة مشاريع\nالعربية: اللغة الأم  |  الإنجليزية: متقدم"
      : "Technical skill · Domain skill · Project management\nEnglish: Fluent  |  Arabic: Professional",
    17,
  );
  section(
    arabic ? "المشاريع" : "PROJECTS",
    arabic
      ? "اسم المشروع — دورك والنتيجة التي حققتها في سطرين. أضف رابطًا عند الحاجة."
      : "Project Name — your contribution and outcome in two short lines. Add a link when useful.",
    13,
  );
  return target;
}

function letterheadPage(title: string, subtitle: string): Page {
  const target = page(title);
  shape(target, "رأس أخضر", 0, 0, 210, 3.2, GREEN);
  shape(target, "لمسة ذهبية", 16, 18, 2, 17, GOLD);
  add(target, "image", "شعار الجهة — استبدل من المكتبة", 164, 14, 30, 22, "", {}, photoPlaceholder("الشعار"));
  text(target, "اسم الجهة", "اسم الجهة / الشركة", 24, 16, 126, 8, { size: 16, weight: 800 });
  text(target, "بيانات الجهة", "العنوان  ·  الهاتف  ·  البريد الإلكتروني  ·  الموقع", 24, 27, 126, 6, { size: 7.5, color: MUTED });
  text(target, "نوع المراسلة", subtitle, 24, 46, 162, 8, { size: 10, color: GREEN, weight: 700 });
  text(target, "التاريخ والمرجع", "التاريخ:  ____ / ____ / ______      الرقم:  ______________", 24, 59, 162, 7, { size: 8, color: MUTED });
  rule(target, 70, 24, 162, LINE);
  text(target, "مخاطب إليه", "السادة / ____________________________________________", 24, 77, 162, 9, { size: 10 });
  text(target, "الموضوع", "الموضوع: ___________________________________________", 24, 91, 162, 9, { size: 10, weight: 700 });
  text(target, "نص الخطاب", "تحية طيبة وبعد،\n\nاكتب نص الخطاب هنا. تبقى مساحة المتن مرنة لاستيعاب أطوال مختلفة مع هوامش طباعة آمنة.\n\nوتفضلوا بقبول فائق الاحترام والتقدير.", 24, 108, 162, 92, { size: 10, align: "justify" });
  text(target, "التوقيع", "الاسم: ____________________     المسمى: ____________________", 24, 220, 162, 8, { size: 8.5 });
  rule(target, 273, 16, 178, GOLD);
  text(target, "تذييل الجهة", "العنوان الكامل  ·  البريد الإلكتروني  ·  الهاتف  ·  الموقع الإلكتروني", 20, 279, 170, 7, { size: 7, color: MUTED, align: "center" });
  return target;
}

function voucherPage(title: string, kind: "receipt" | "cash" | "payment"): Page {
  const target = page(title);
  shape(target, "شريط العنوان", 0, 0, 210, 38, GREEN);
  text(target, "عنوان السند", title, 18, 8, 174, 12, { size: 20, color: PAPER, weight: 800 });
  text(target, "الرقم والتاريخ", "رقم السند:  ____________                         التاريخ:  ____ / ____ / ______", 20, 47, 170, 8, { size: 9, color: MUTED });
  const nameLabel = kind === "payment" ? "ادفعوا إلى" : kind === "cash" ? "استلمنا من" : "استلمت من";
  const amountLabel = kind === "payment" ? "مبلغ وقدره" : "مبلغ وقدره";
  shape(target, "حقل الطرف", 20, 63, 170, 25, PAPER, LINE);
  text(target, "اسم الطرف", `${nameLabel}:  ______________________________________________`, 25, 70, 160, 8, { size: 10 });
  shape(target, "حقل المبلغ", 20, 96, 170, 23, GREEN_SOFT, LINE);
  text(target, "المبلغ", `${amountLabel}:  ___________________________`, 25, 103, 160, 8, { size: 11, color: GREEN, weight: 700 });
  text(target, "المبلغ كتابة", "فقط وقدره كتابة: _________________________________________________", 22, 127, 166, 9, { size: 9 });
  text(target, "سبب السند", kind === "payment" ? "سبب الصرف / التفاصيل" : "وذلك عن", 22, 147, 166, 7, { size: 9, weight: 700 });
  shape(target, "مربع الوصف", 20, 156, 170, 43, PAPER, LINE);
  text(target, "وصف العملية", "____________________________________________________________\n____________________________________________________________", 25, 164, 160, 25, { size: 9, color: MUTED });
  text(target, "طريقة الدفع", "طريقة الدفع:   □ نقداً     □ تحويل     □ بطاقة     □ أخرى: __________", 22, 210, 166, 8, { size: 8.5 });
  if (kind === "payment") {
    text(target, "مرجع المحاسبة", "مركز التكلفة: __________  ·  الحساب: __________  ·  المرجع: __________", 22, 224, 166, 8, { size: 7.5, color: MUTED });
  }
  rule(target, 249, 22, 166, LINE);
  text(target, "توقيع المستلم", "توقيع المستلم\n\n____________________", 24, 255, 70, 24, { size: 8, align: "center" });
  text(target, "توقيع المسؤول", "اسم وتوقيع المسؤول\n\n____________________", 116, 255, 70, 24, { size: 8, align: "center" });
  return target;
}

function portfolioPages(): Page[] {
  const cover = page("الغلاف");
  shape(cover, "حقل الغلاف", 0, 118, 210, 179, "#143028");
  add(cover, "image", "صورة غلاف — استبدل من المكتبة", 0, 118, 210, 179, "", {}, photoPlaceholder("صورة المشروع", true));
  shape(cover, "خط الهوية", 0, 0, 210, 2.2, GREEN);
  text(cover, "عنوان الملف", "ملف أعمال", 20, 22, 170, 10, { size: 11, color: GREEN, weight: 700 });
  text(cover, "اسم المصمم", "اسم المصمم", 20, 38, 170, 16, { size: 28, weight: 800 });
  text(cover, "التخصص", "هوية  ·  تحرير  ·  أنظمة بصرية", 20, 60, 150, 8, { size: 11, color: MUTED });
  rule(cover, 76, 20, 42, GOLD);
  text(cover, "بيانات التواصل", "الموقع  ·  البريد  ·  الهاتف", 20, 88, 170, 8, { size: 8, color: MUTED });

  const about = page("نبذة عن المصمم");
  shape(about, "شريط علوي", 0, 0, 210, 5, GOLD);
  text(about, "عنوان النبذة", "الفكرة خلف العمل", 20, 28, 170, 15, { size: 22, color: GREEN, weight: 800 });
  text(about, "نبذة تعريفية", "منهج مختصر: وضوح أولًا، ثم اتساق، ثم أثر يمكن قياسه. النص يُستبدل دون تحريك الشبكة.", 20, 52, 170, 28, { size: 12, align: "right" });
  rule(about, 88, 20, 170, GOLD);
  text(about, "التخصصات", "التخصص", 110, 98, 80, 6, { size: 8, color: GREEN, weight: 700 });
  text(about, "تفاصيل التخصص", "هوية · تحرير · أنظمة رقمية", 110, 108, 80, 8, { size: 11, weight: 700 });
  text(about, "سنوات الخبرة", "الخبرة", 20, 98, 70, 6, { size: 8, color: MUTED, weight: 700 });
  text(about, "تفاصيل الخبرة", "خمس سنوات · مشاريع متنوعة", 20, 108, 80, 8, { size: 11, weight: 700 });
  add(about, "image", "صورة شخصية — استبدل من المكتبة", 20, 132, 48, 58, "", {}, photoPlaceholder("صورة المصمم"));
  text(about, "مبادئ التصميم", "٠١  وضوح المرجع\n٠٢  مقياس واحد للعناوين\n٠٣  صورة لا تُترك بلا تعليق", 80, 140, 110, 28, { size: 11, color: INK });

  const projects = page("مشاريع مختارة");
  text(projects, "عنوان المشاريع", "مشاريع مختارة", 20, 22, 170, 13, { size: 20, color: GREEN, weight: 800 });
  const cards = [
    { x: 20, y: 51, name: "المشروع الأول", category: "هوية بصرية" },
    { x: 108, y: 51, name: "المشروع الثاني", category: "تجربة رقمية" },
  ];
  cards.forEach((card, index) => {
    add(projects, "image", `صورة ${card.name} — استبدل من المكتبة`, card.x, card.y, 80, 79, "", {}, photoPlaceholder(`مشروع ${index + 1}`, true));
    text(projects, `عنوان ${card.name}`, card.name, card.x, 136, 80, 8, { size: 11, weight: 800 });
    text(projects, `نوع ${card.name}`, card.category, card.x, 147, 80, 6, { size: 8, color: GREEN });
    text(projects, `وصف ${card.name}`, "التحدي · الفكرة · النتيجة\nاكتب وصفاً موجزاً يوضح دورك والأثر.", card.x, 158, 80, 22, { size: 8, color: MUTED });
  });
  rule(projects, 204, 20, 170, GOLD);
  text(projects, "مشروع إضافي", "مشروع ثالث  ·  الجهة  ·  السنة\nوصف مختصر أو مؤشر نتيجة قابل للقياس.", 20, 216, 170, 23, { size: 9 });
  add(projects, "image", "صورة مشروع ثالث — استبدل من المكتبة", 20, 246, 170, 33, "", {}, photoPlaceholder("مساحة صورة إضافية", true));

  const contact = page("تواصل");
  shape(contact, "خلفية التواصل", 0, 0, 210, 297, GREEN);
  shape(contact, "خط ذهبي", 18, 30, 2, 231, GOLD);
  text(contact, "عنوان التواصل", "لنبنِ شيئاً\nيُحدث فرقاً", 30, 56, 154, 42, { size: 27, color: PAPER, weight: 800 });
  text(contact, "دعوة تواصل", "متاح لمشاريع الهوية والتصميم الرقمي والتحرير البصري.", 30, 116, 148, 19, { size: 11, color: "#e0eee5" });
  text(contact, "قنوات التواصل", "البريد الإلكتروني\nhello@example.com\n\nالموقع\nexample.com\n\nالهاتف\n+966 5X XXX XXXX", 30, 164, 150, 57, { size: 10, color: PAPER });
  return [cover, about, projects, contact];
}

function digitalCardPage(): Page {
  const target = page("بطاقة رقمية", 108, 192);
  shape(target, "خلفية البطاقة", 0, 0, 108, 192, "#f2f6f3");
  shape(target, "ترويسة البطاقة", 0, 0, 108, 64, GREEN);
  add(target, "image", "الصورة الشخصية — استبدل من المكتبة", 37, 19, 34, 34, "", {}, photoPlaceholder("الصورة"));
  text(target, "الاسم", "الاسم الكامل", 10, 70, 88, 11, { size: 18, color: GREEN, weight: 800, align: "center" });
  text(target, "المسمى", "المسمى المهني  ·  اسم الجهة", 10, 84, 88, 7, { size: 9, color: MUTED, align: "center" });
  rule(target, 98, 16, 76, GOLD);
  const links = ["اتصال مباشر", "البريد الإلكتروني", "الموقع الإلكتروني", "LinkedIn  ·  Instagram"];
  links.forEach((label, index) => {
    shape(target, `زر ${label}`, 13, 108 + index * 15, 82, 10, PAPER, LINE);
    text(target, label, label, 17, 110 + index * 15, 74, 6, { size: 8, color: GREEN, weight: 700, align: "center" });
  });
  text(target, "شعار اختياري", "مساحة شعار", 27, 174, 54, 7, { size: 7, color: MUTED, align: "center" });
  return target;
}

function businessCardPages(): Page[] {
  const make = (name: string, back: boolean) => {
    const target = page(name, 94.9, 56.8);
    shape(target, "لون خلفية", 0, 0, 94.9, 56.8, back ? INK : GREEN);
    shape(target, "هامش قص آمن", 3, 3, 88.9, 50.8, "transparent", "#ffffff99");
    if (!back) {
      add(target, "image", "شعار قابل للاستبدال", 7, 11, 17, 17, "", {}, photoPlaceholder("شعار"));
      text(target, "اسم الموظف", "الاسم الكامل", 28, 11, 58, 8, { size: 12, color: PAPER, weight: 800 });
      text(target, "المسمى الوظيفي", "المسمى الوظيفي", 28, 21, 58, 6, { size: 7, color: "#e0eee5" });
      text(target, "بيانات البطاقة", "+966 5X XXX XXXX  ·  name@example.com\nwww.example.com  ·  @social", 7, 36, 80, 11, { size: 6, color: PAPER });
    } else {
      text(target, "اسم العلامة", "اسم الشركة", 9, 10, 76, 8, { size: 13, color: PAPER, weight: 800, align: "center" });
      shape(target, "علامة زخرفية", 40, 22, 14, 1, GOLD);
      text(target, "عنوان الشركة", "العنوان المختصر  ·  المدينة\nرمز QR أو عبارة تعريفية اختيارية", 8, 29, 78, 14, { size: 6.5, color: "#e0eee5", align: "center" });
    }
    text(target, "ملاحظة الطباعة", "88.9 × 50.8 مم + نزف 3 مم", 8, 51, 78, 3, { size: 4.5, color: "#e0eee5", align: "center" });
    return target;
  };
  return [make("الوجه الأمامي", false), make("الوجه الخلفي", true)];
}

function greetingPages(): Page[] {
  const layouts = [
    { name: "تهنئة خضراء", bg: "#eaf3ec", accent: GREEN, greeting: "كل عام وأنتم بخير" },
    { name: "تهنئة ذهبية", bg: "#f5f1e8", accent: "#8b6d35", greeting: "أجمل الأمنيات" },
  ];
  return layouts.map((layout) => {
    const target = page(layout.name, 108, 135);
    shape(target, "خلفية البطاقة", 0, 0, 108, 135, layout.bg);
    add(target, "image", "صورة أو شعار — استبدل من المكتبة", 0, 0, 108, 46, "", {}, photoPlaceholder("صورة اختيارية", true));
    shape(target, "خط الهوية", 0, 46, 108, 1.2, layout.accent);
    text(target, "اسم المستلم", "إلى: الاسم الكريم", 10, 54, 88, 6, { size: 8, color: MUTED, align: "right" });
    text(target, "نص التهنئة", layout.greeting, 10, 64, 88, 14, { size: 16, color: layout.accent, weight: 800, align: "right" });
    text(target, "رسالة البطاقة", "أطيب التمنيات بالسعادة والنجاح،\nولتكن الأيام القادمة على قدر الجهد.", 10, 84, 88, 16, { size: 9, align: "right" });
    text(target, "اسم المرسل", "مع التحية  ·  اسم المرسل", 10, 116, 88, 6, { size: 7, color: MUTED, align: "right" });
    return target;
  });
}

function ministryPages(): Page {
  const target = page("مراسلات تعليمية");
  shape(target, "رأس المستند", 0, 0, 210, 2.4, GREEN);
  add(target, "image", "شعار تملكه الجهة — استبدل من المكتبة", 167, 12, 25, 25, "", {}, photoPlaceholder("شعار مصرح به"));
  text(target, "اسم الجهة التعليمية", "اسم الجهة التعليمية", 22, 12, 133, 8, { size: 14, color: GREEN, weight: 800 });
  text(target, "الإدارة والقسم", "الإدارة العامة  ·  الإدارة / القسم", 22, 23, 133, 7, { size: 9, color: MUTED });
  text(target, "صفة النموذج", "نموذج مراسلات قابل للتخصيص — غير معتمد حكومياً", 22, 37, 167, 7, { size: 8, color: MUTED, align: "center" });
  rule(target, 49, 20, 170, GOLD);
  text(target, "رقم وتاريخ الخطاب", "الرقم: _____________     التاريخ: ____ / ____ / ______     المرفقات: ______", 23, 61, 164, 8, { size: 8.5 });
  text(target, "الجهة المرسل إليها", "إلى / _________________________________________________", 23, 78, 164, 8, { size: 10 });
  text(target, "الموضوع", "الموضوع / _____________________________________________", 23, 94, 164, 8, { size: 10, weight: 700 });
  text(target, "متن الخطاب", "السلام عليكم ورحمة الله وبركاته،\n\nيكتب نص الخطاب هنا. الحقول والعناصر قابلة للتعديل، ويمكن استبدال مساحة الشعار بصورة تملك الجهة حق استخدامها.\n\nوتقبلوا خالص التحية والتقدير.", 23, 111, 164, 84, { size: 10, align: "justify" });
  text(target, "التوقيع", "الاسم: _______________________\nالمسمى الوظيفي: ________________\nالتوقيع: ______________________", 103, 213, 82, 31, { size: 8.5 });
  rule(target, 272, 18, 174, LINE);
  text(target, "بيانات التواصل", "العنوان  ·  الهاتف  ·  البريد الإلكتروني  ·  الرمز البريدي", 20, 279, 170, 7, { size: 7, color: MUTED, align: "center" });
  return target;
}

function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[char]!);
}

function wrapPreviewText(value: string, maxCharacters: number): string[] {
  return value.split("\n").flatMap((paragraph) => {
    if (!paragraph) return [""];
    const words = paragraph.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (word.length > maxCharacters) {
        if (line) lines.push(line);
        for (let index = 0; index < word.length; index += maxCharacters) {
          const part = word.slice(index, index + maxCharacters);
          if (index + maxCharacters < word.length) lines.push(part);
          else line = part;
        }
      } else if (!line) {
        line = word;
      } else if (line.length + word.length + 1 <= maxCharacters) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  });
}

function pagePreview(page: Page): string {
  const width = page.w ?? 210;
  const height = page.h ?? 297;
  const artwork = page.elements.map((element) => {
    const x = element.x;
    const y = element.y;
    const w = element.w;
    const h = element.h;
    const style = element.style ?? {};
    const fill = escapeXml(style.fill || "none");
    const stroke = escapeXml(style.borderColor || "none");
    const strokeWidth = Math.max(0, Number(style.borderWidth) || 0);
    if (element.type === "image") {
      const source = element.src && /^data:image\//i.test(element.src) ? escapeXml(element.src) : "";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#edf3ef" stroke="#9db7a7" stroke-width="0.35"/><image href="${source}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
    }
    if (element.type === "line" || element.type === "divider") {
      return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${escapeXml(style.color || LINE)}" stroke-width="${Math.max(0.25, Number(style.stroke) || 0.35)}"/>`;
    }
    const frame = element.type === "shape" || element.type === "box"
      ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.max(0, Number(style.radius) || 0)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
      : "";
    if (!element.content) return frame;

    const fontSize = Math.max(1, (Number(style.fontSize) || 10) * 0.3528);
    const padding = Math.max(0, Number(style.padding) || 0);
    const maxCharacters = Math.max(1, Math.floor((w - padding * 2) / (fontSize * 0.52)));
    const lineHeight = fontSize * (Number(style.lineHeight) || 1.35);
    const maxLines = Math.max(1, Math.floor((h - padding * 2) / lineHeight));
    const lines = wrapPreviewText(element.content, maxCharacters).slice(0, maxLines);
    const align = style.textAlign || "right";
    const textAnchor = align === "center" ? "middle" : align === "left" ? "start" : "end";
    const textX = align === "center" ? x + w / 2 : align === "left" ? x + padding : x + w - padding;
    const textY = y + padding + fontSize;
    const text = lines.map((line, index) =>
      `<text x="${textX}" y="${textY + index * lineHeight}" text-anchor="${textAnchor}" font-family="${escapeXml(style.fontFamily || "Tajawal")}" font-size="${fontSize}" font-weight="${escapeXml(style.fontWeight || 500)}" fill="${escapeXml(style.color || INK)}">${escapeXml(line)}</text>`,
    ).join("");
    return `${frame}${text}`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="${Math.round(640 * height / width)}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${escapeXml(page.bg || PAPER)}"/>${artwork}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

const PACK_CATEGORY: Record<PackId, TemplateCategoryId> = {
  official: "reports",
  eid: "covers",
  briefing: "executive",
  slides: "slides",
  blank: "editorial",
};

/** Existing code-bundled catalog entries, mirrored into Admin as editable native drafts. */
export function buildLegacyTemplateSeeds(): ProductTemplateSeed[] {
  const packSeeds = PACKS.map((pack, index) => {
    const project = createProject(pack.id);
    return {
      id: `builtin_pack_${pack.id}`,
      slug: `nasaq-pack-${pack.id}`,
      title: pack.title,
      description: pack.desc,
      category: PACK_CATEGORY[pack.id],
      tier: canUseDemoPack(pack.id) ? "free" as const : "licensed" as const,
      status: "published" as const,
      kind: "json" as const,
      sortOrder: 300 + index,
      content: JSON.stringify({ name: project.name, pages: project.pages }),
      thumbnail: pagePreview(project.pages[0]),
    };
  });
  const pageSeeds = PAGE_TEMPLATES.map((definition, index) => {
    const page = createTemplatePage(definition.id, THEMES.official, "");
    return {
      id: `builtin_page_${definition.id}`,
      slug: `nasaq-page-${definition.id}`,
      title: definition.title,
      description: definition.desc,
      category: definition.category,
      tier: "free" as const,
      status: "published" as const,
      kind: "json" as const,
      sortOrder: 320 + index,
      content: JSON.stringify({ name: definition.title, pages: [page] }),
      thumbnail: pagePreview(page),
    };
  });
  return [...packSeeds, ...pageSeeds];
}

const DEFINITIONS = [
  { id: "builtin_resume_ar", slug: "ats-resume-ar", title: "سيرة ذاتية عربية — ATS", description: "سيرة ذاتية عربية RTL من صفحة واحدة، منظمة لتوافق أنظمة تتبع المتقدمين، مع أقسام قابلة لإعادة التحرير.", category: "سير ذاتية", build: () => [resumePage("ar")] },
  { id: "builtin_resume_en", slug: "ats-resume-en", title: "ATS Resume — English", description: "One-page, single-column English resume with editable profile, experience, education, skills, languages and projects.", category: "سير ذاتية", build: () => [resumePage("en")] },
  { id: "builtin_letterhead", slug: "corporate-letterhead-a4", title: "ورق مراسلات مؤسسي A4", description: "ورق مراسلات للطباعة بهوامش آمنة، وشعار وبيانات جهة ومتَن وتذييل قابل للاستبدال.", category: "خطابات رسمية", build: () => [letterheadPage("ورق مراسلات مؤسسي", "خطاب مؤسسي")] },
  { id: "builtin_receipt_voucher", slug: "receipt-voucher", title: "سند قبض", description: "سند قبض منظم برقم وتاريخ وطرف ومبلغ وكتابةً وسبب وطريقة دفع وتوقيعات.", category: "سندات مالية", build: () => [voucherPage("سند قبض", "receipt")] },
  { id: "builtin_designer_portfolio", slug: "designer-portfolio", title: "ملف أعمال المصمم", description: "ملف أعمال متعدد الصفحات مع صور قابلة للاستبدال من المكتبة، ونبذة ومشاريع وتواصل.", category: "ملفات أعمال", build: portfolioPages },
  { id: "builtin_cash_receipt", slug: "cash-receipt", title: "إيصال استلام نقدي", description: "إيصال نقدي قابل للتحرير مع بيانات المستلم والمبلغ والتفقيط والوصف والتوقيعات.", category: "سندات مالية", build: () => [voucherPage("إيصال استلام نقدي", "cash")] },
  { id: "builtin_education_letterhead", slug: "education-correspondence", title: "مراسلات تعليمية — نموذج غير رسمي", description: "بنية مراسلات تعليمية A4 عامة بلا شعارات محمية أو ادعاء اعتماد حكومي؛ استخدم أصولاً تملك الجهة حق توزيعها فقط.", category: "خطابات رسمية", build: () => [ministryPages()] },
  { id: "builtin_digital_business_card", slug: "digital-business-card", title: "بطاقة أعمال رقمية", description: "بطاقة رقمية رأسية للروابط والتواصل والصورة والشعار والألوان والنصوص القابلة للتحرير.", category: "بطاقات أعمال", build: () => [digitalCardPage()] },
  { id: "builtin_business_card", slug: "business-card-front-back", title: "بطاقة أعمال — وجهان", description: "بطاقتا وجه وخلف بأبعاد 88.9 × 50.8 مم مع نزف طباعة 3 مم وهوامش آمنة.", category: "بطاقات أعمال", build: businessCardPages },
  { id: "builtin_payment_voucher", slug: "payment-voucher", title: "سند صرف", description: "سند صرف عائلي مع سند القبض وإيصال النقد، وحقول مرجع ومركز تكلفة وتواقيع.", category: "سندات مالية", build: () => [voucherPage("سند صرف", "payment")] },
  { id: "builtin_greeting_card", slug: "arabic-greeting-cards", title: "بطاقات تهنئة عربية", description: "تخطيطان رقميان عربيان برسالة ومستلم وصورة أو شعار قابل للاستبدال من المكتبة.", category: "بطاقات رقمية", build: greetingPages },
] as const;

export function buildProductTemplateSeeds(): ProductTemplateSeed[] {
  return DEFINITIONS.map((definition, index) => {
    const pages = definition.build();
    return {
      id: definition.id,
      slug: definition.slug,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      tier: "licensed",
      status: "published",
      kind: "json",
      sortOrder: 100 + index,
      content: JSON.stringify({ name: definition.title, pages }),
      thumbnail: pagePreview(pages[0]),
    };
  });
}