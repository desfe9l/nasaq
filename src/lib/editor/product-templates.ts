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
import { BODY, META, balancedFrame, plate } from "./template-layouts";
import { shapeSvgMarkup } from "./shape-render";

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
    lineHeight?: number;
  } = {},
) {
  const align = options.align ?? "right";
  const fontSize = options.size ?? 10;
  const lineHeight = options.lineHeight ?? 1.5;
  const frame = balancedFrame(content, x, y, w, h, fontSize, lineHeight, align);
  return add(target, "text", name, frame.x, frame.y, frame.w, frame.h, content, {
    fontFamily: options.font ?? "Tajawal",
    fontSize,
    fontWeight: options.weight ?? 500,
    color: options.color ?? INK,
    textAlign: align,
    lineHeight,
    textBoxMode: "autoHeight",
    overflowVisible: true,
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
  shapeId = "rect",
) {
  return add(target, "shape", name, x, y, w, h, "", {
    fill,
    borderColor: borderColor || undefined,
    borderWidth: borderColor ? 0.3 : 0,
    radius: shapeId === "rounded" ? 2 : 0,
    shapeId,
  });
}

function rule(target: Page, y: number, x = 17, w = 176, color = LINE) {
  return add(target, "line", "فاصل قابل للتحرير", x, y, w, 0, "", {
    color,
    stroke: 0.35,
  });
}

function resumePage(language: "ar" | "en"): Page {
  const arabic = language === "ar";
  const target = page(arabic ? "السيرة الذاتية" : "Resume");
  const align = arabic ? "right" : "left";
  const x = 18;
  const textW = arabic ? 142 : 174;
  shape(target, "شريط الهوية", 0, 0, 210, 8, GREEN);
  add(target, "line", "خيط ذهبي", 0, 8, 210, 0, "", { color: GOLD, stroke: 0.7 });
  if (arabic) {
    add(target, "image", "صورة شخصية", 164, 18, 28, 36, "", { objectFit: "cover", radius: 14 }, plate("portrait"));
  }
  text(target, "الاسم", arabic ? "نورة السبيعي" : "FULL NAME", x, 14, textW, 12, {
    size: 26, color: GREEN, weight: 800, align, font: arabic ? "Tajawal" : "Georgia",
  });
  text(target, "المسمى المهني", arabic ? "أخصائية اتصال مؤسسي" : "Communications Lead", x, 28, textW, 7, {
    size: 11, color: INK, weight: 600, align, font: arabic ? "IBM Plex Sans Arabic" : "Georgia",
  });
  text(target, "معلومات التواصل", arabic
    ? "الرياض  ·  nora@example.com  ·  ٠٥٥ ٠٠٠ ٠٠٠٠"
    : "Riyadh  ·  name@example.com  ·  +966 55 000 0000", x, arabic ? 40 : 38, textW, 6, {
    size: 8, color: MUTED, align, font: META,
  });
  add(target, "line", "فاصل الهوية", x, arabic ? 50 : 48, textW, 0, "", { color: GOLD, stroke: 0.6 });

  let y = arabic ? 58 : 56;
  const section = (title: string, content: string, height: number) => {
    text(target, `عنوان ${title}`, title, x, y, textW, 7, {
      size: 12, color: GREEN, weight: 700, align, font: arabic ? "Tajawal" : "Georgia",
    });
    add(target, "line", `خط ${title}`, arabic ? x + textW - 28 : x, y + 8, 28, 0, "", { color: GOLD, stroke: 0.7 });
    text(target, title, content, x, y + 12, textW, height, {
      size: 10, color: INK, align, font: arabic ? BODY : "Georgia", lineHeight: 1.65,
    });
    y += height + 16;
  };
  section(
    arabic ? "الملخص" : "PROFILE",
    arabic
      ? "ثماني سنوات في الاتصال المؤسسي للجهات الخدمية. أكتب ما يُعرض على القيادة، وأضبط ما يصل إلى الجمهور، وأقيس الأثر بعد النشر لا بعدد المواد."
      : "Eight years leading institutional communications. I write what leadership reads, and I measure the effect after publication rather than by the volume of output.",
    20,
  );
  section(
    arabic ? "الخبرة" : "EXPERIENCE",
    arabic
      ? "رئيسة تحرير المحتوى  |  جهة خدمية  |  ٢٠٢٢ — الآن\nأعدت هيكل التقرير السنوي فصار يُعتمد في جلسة واحدة.\nخفضت زمن إعداد البيان الميداني من يومين إلى ست ساعات.\n\nأخصائية محتوى  |  مكتب استشاري  |  ٢٠١٨ — ٢٠٢٢\nأدارت ملفات اتصال لثلاث جهات بمعجم واحد."
      : "Head of Content  |  Public institution  |  2022–Present\nRebuilt the annual report so leadership could decide it in one sitting.\nCut field-statement turnaround from two days to six hours.\n\nContent Specialist  |  Advisory office  |  2018–2022\nHeld one voice across three institutions.",
    42,
  );
  section(
    arabic ? "التعليم" : "EDUCATION",
    arabic ? "بكالوريوس إعلام  |  جامعة الملك سعود  |  ٢٠١٨" : "BA Media  |  King Saud University  |  2018",
    8,
  );
  section(
    arabic ? "المهارات" : "SKILLS",
    arabic
      ? "تحرير مؤسسي  ·  تقارير قيادية  ·  بيان ميداني\nالعربية: اللغة الأم  ·  الإنجليزية: مهنية"
      : "Institutional editing  ·  Executive reports  ·  Field statements\nArabic: Native  ·  English: Professional",
    14,
  );
  return target;
}

function letterheadPage(title: string, subtitle: string): Page {
  const target = page(title);
  shape(target, "شريط علوي", 0, 0, 210, 10, GREEN);
  add(target, "line", "خيط ذهبي", 0, 10, 210, 0, "", { color: GOLD, stroke: 0.6 });
  add(target, "image", "شعار الجهة", 168, 16, 22, 16, "", { objectFit: "cover", radius: 0 }, plate("archive"));
  text(target, "اسم الجهة", "اسم الجهة", 18, 16, 140, 8, { size: 18, weight: 800, color: GREEN });
  text(target, "بيانات الجهة", "الإدارة العامة  ·  مكتب المراسلات", 18, 26, 140, 6, { size: 9, color: MUTED, font: META });
  add(target, "line", "خط الرأس", 18, 38, 174, 0, "", { color: GREEN, stroke: 0.45 });
  add(target, "line", "خط الرأس الثاني", 18, 39.6, 174, 0, "", { color: GOLD, stroke: 0.35 });
  text(target, "نوع المراسلة", subtitle, 18, 46, 174, 7, { size: 11, color: GREEN, weight: 700 });
  text(target, "التاريخ والمرجع", "التاريخ  ١٤٤٧ / ٠٦ / ١٢          المرجع  ص / ٤٤٢١", 18, 56, 174, 6, { size: 9, color: MUTED, font: META });
  text(target, "مخاطب إليه", "السادة / إدارة التخطيط", 18, 70, 174, 8, { size: 13, weight: 700 });
  text(target, "تحية", "السلام عليكم ورحمة الله وبركاته", 18, 84, 174, 7, { size: 12, font: BODY, lineHeight: 1.6 });
  text(target, "الموضوع", "الموضوع: اعتماد صيغة التقرير الربعي", 18, 100, 174, 8, { size: 13, weight: 700 });
  text(target, "نص الخطاب", "نفيدكم بأن صيغة التقرير الربعي أصبحت جاهزة للعرض: غلاف، محتويات، حكم، أثر، مؤشرات، وتوصية.\n\nنرجو اعتمادها في اجتماع الأسبوع حتى تُقفل النسخة قبل نهاية الشهر. المرفقات تحمل الجدول كما أُغلق.", 18, 116, 174, 48, { size: 12, font: BODY, lineHeight: 1.75 });
  text(target, "الختام", "وتفضلوا بقبول فائق الاحترام", 18, 172, 174, 8, { size: 12, font: BODY });
  add(target, "line", "خط التوقيع", 112, 210, 60, 0, "", { color: INK, stroke: 0.3 });
  text(target, "التوقيع", "الاسم\nمدير مكتب المراسلات", 112, 214, 60, 14, { size: 9, color: MUTED, font: META, lineHeight: 1.4 });
  shape(target, "تذييل أخضر", 0, 274, 210, 23, GREEN);
  text(target, "تذييل الجهة", "الرياض  ·  ٠١١ ٠٠٠ ٠٠٠٠  ·  mail@example.com", 18, 280, 174, 7, { size: 8, color: "#f4f7f5", align: "center", font: META });
  return target;
}

function voucherPage(title: string, kind: "receipt" | "cash" | "payment"): Page {
  const target = page(title);
  const party = kind === "payment" ? "ادفعوا لأمر" : kind === "cash" ? "استلمنا نقدًا من" : "استلمنا من";
  const copy = kind === "payment" ? "نسخة الحسابات" : kind === "cash" ? "نسخة الصندوق" : "أصل للمستفيد";
  const detail = kind === "payment"
    ? "مركز التكلفة ٤٢٠  ·  الحساب ٥١٠٣  ·  مرجع TR-٢٠٤١"
    : kind === "cash"
      ? "صندوق المقر  ·  أمين الصندوق يوقّع في الخانة اليسرى"
      : "تحويل  ·  مصرف الراجحي  ·  مرجع العملية ٢٠٤١";
  shape(target, "رأس السند", 0, 0, 210, 22, GREEN);
  add(target, "line", "خيط ذهبي", 0, 22, 210, 0, "", { color: GOLD, stroke: 0.7 });
  text(target, "تصنيف السند", copy, 16, 7, 120, 6, { size: 8, color: "#f4f7f5", font: META });
  text(target, "عنوان السند", title, 16, 32, 118, 12, { size: 22, color: GREEN, weight: 800 });
  text(target, "رقم السند", "٤٤١٨", 138, 36, 56, 14, { size: 22, color: INK, weight: 800, align: "left" });
  text(target, "تسمية الرقم", "رقم السند", 138, 52, 56, 5, { size: 8, color: MUTED, align: "left", font: META });
  text(target, "التاريخ", "١٢ / ٠٦ / ١٤٤٧", 16, 56, 90, 6, { size: 10, color: INK, font: META });
  add(target, "line", "حد البيانات", 16, 70, 178, 0, "", { color: LINE, stroke: 0.35 });
  text(target, "تسمية الطرف", party, 16, 80, 178, 6, { size: 8, color: MUTED, font: META });
  text(target, "اسم الطرف", "مؤسسة أفق للإسناد", 16, 90, 178, 10, { size: 16, weight: 700 });
  text(target, "تسمية المبلغ", "المبلغ", 116, 110, 78, 6, { size: 8, color: MUTED, font: META });
  text(target, "المبلغ", "١٢٬٥٠٠", 116, 118, 78, 14, { size: 26, color: GREEN, weight: 800 });
  text(target, "العملة", "ريال سعودي", 16, 124, 92, 8, { size: 12, weight: 600 });
  text(target, "المبلغ كتابة", "فقط اثنا عشر ألفًا وخمسمائة ريال سعودي لا غير.", 16, 146, 178, 8, { size: 12, font: BODY });
  text(target, "سبب السند", kind === "payment" ? "مقابل دفعة عقد الإسناد للربع الحالي." : "عن خدمات الإسناد الميداني لشهر سبتمبر.", 16, 162, 178, 8, { size: 12, font: BODY });
  text(target, "تفصيل الدفع", detail, 16, 178, 178, 8, { size: 10, color: MUTED, font: META });
  add(target, "line", "حد التواقيع", 16, 200, 178, 0, "", { color: LINE, stroke: 0.35 });
  text(target, "توقيع المستلم", "المستلم", 16, 214, 78, 6, { size: 8, color: MUTED, align: "center", font: META });
  add(target, "line", "خط المستلم", 28, 246, 54, 0, "", { color: INK, stroke: 0.3 });
  text(target, "توقيع المسؤول", "المسؤول المالي", 116, 214, 78, 6, { size: 8, color: MUTED, align: "center", font: META });
  add(target, "line", "خط المسؤول", 128, 246, 54, 0, "", { color: INK, stroke: 0.3 });
  text(target, "تذييل", "يُحفظ مع أصل المعاملة. الأرقام عينة وتُستبدل من المحرر.", 16, 270, 178, 6, { size: 8, color: MUTED, align: "center", font: META });
  return target;
}

function portfolioPages(): Page[] {
  const cover = page("الغلاف");
  shape(cover, "حقل علوي", 0, 0, 210, 168, "#ffffff");
  shape(cover, "كتلة خضراء", 0, 168, 210, 129, GREEN);
  add(cover, "line", "خيط ذهبي", 0, 168, 210, 0, "", { color: GOLD, stroke: 0.8 });
  add(cover, "image", "صورة الغلاف", 16, 36, 178, 110, "", { objectFit: "cover", radius: 0 }, plate("facade"));
  text(cover, "عنوان الملف", "أعمال مختارة", 18, 180, 174, 6, { size: 10, color: GOLD, weight: 700, font: META });
  text(cover, "اسم المصمم", "ليان القاسم", 18, 192, 174, 14, { size: 26, weight: 800, color: "#f6f3ee" });
  text(cover, "التخصص", "هوية  ·  تقارير  ·  أنظمة بصرية", 18, 214, 174, 8, { size: 12, color: "#d7e3dc", font: META });
  text(cover, "بيانات التواصل", "layan@example.com", 18, 232, 174, 7, { size: 11, color: GOLD, font: META });

  const about = page("نبذة");
  text(about, "كِكر", "المنهج", 18, 22, 174, 6, { size: 9, color: GREEN, weight: 700, font: META });
  text(about, "عنوان النبذة", "الوضوح قبل الزينة", 18, 34, 174, 12, { size: 24, weight: 800 });
  text(about, "نبذة تعريفية", "أعمل مع الجهات التي تقدّم تقريرًا لا منشورًا. الصفحة تبدأ بالحكم، والصورة تُستخدم حين تكون دليلًا، واللون يبقى قليلًا حتى يُرى.", 18, 54, 174, 28, { size: 13, font: BODY, lineHeight: 1.7 });
  add(about, "image", "صورة شخصية", 18, 98, 52, 66, "", { objectFit: "cover", radius: 0 }, plate("portrait"));
  text(about, "سنوات الخبرة", "ثماني سنوات", 82, 100, 110, 8, { size: 14, weight: 800, color: GREEN });
  text(about, "تفاصيل الخبرة", "تقارير سنوية، هويات جهات، وعروض تُحسم في الجلسة.", 82, 114, 110, 16, { size: 11, font: BODY, lineHeight: 1.6 });
  text(about, "مبادئ التصميم", "الحكم أولًا، ثم السند، ثم الشكل الذي لا يزاحمهما.", 82, 138, 110, 18, { size: 12, font: BODY, lineHeight: 1.6 });
  add(about, "line", "فاصل", 18, 184, 174, 0, "", { color: GOLD, stroke: 0.45 });
  text(about, "ملاحظة", "المقر في الرياض. جهة واحدة في كل ربع، حتى تُغلق الوثيقة.", 18, 194, 174, 10, { size: 10, color: MUTED, font: META });

  const projects = page("أعمال");
  text(projects, "عنوان المشاريع", "ثلاثة أعمال", 18, 16, 174, 10, { size: 20, weight: 800 });
  add(projects, "image", "صورة المشروع الأول", 18, 32, 174, 72, "", { objectFit: "cover", radius: 0 }, plate("facade"));
  text(projects, "عنوان المشروع الأول", "تقرير سنوي لجهة خدمية", 18, 108, 120, 8, { size: 13, weight: 800 });
  text(projects, "نوع المشروع الأول", "ست صفحات  ·  ٢٠٢٥", 140, 110, 52, 6, { size: 8, color: GREEN, align: "left", font: META });
  add(projects, "image", "صورة المشروع الثاني", 18, 128, 82, 48, "", { objectFit: "cover", radius: 0 }, plate("archive"));
  text(projects, "عنوان المشروع الثاني", "هوية مراسلات", 18, 180, 82, 7, { size: 11, weight: 700 });
  text(projects, "وصف المشروع الثاني", "ورق المراسلات على المقاس الرسمي.", 18, 190, 82, 10, { size: 8, color: MUTED, font: META });
  add(projects, "image", "صورة المشروع الثالث", 110, 128, 82, 48, "", { objectFit: "cover", radius: 0 }, plate("press"));
  text(projects, "عنوان المشروع الثالث", "ملف ميداني", 110, 180, 82, 7, { size: 11, weight: 700 });
  text(projects, "وصف المشروع الثالث", "تغطية عيد في أربع صفحات.", 110, 190, 82, 10, { size: 8, color: MUTED, font: META });
  text(projects, "سطر ختامي", "كل عمل هنا طُبع أو عُرض في جلسة، ولم يبقَ ملفًا على الشاشة.", 18, 214, 174, 10, { size: 12, font: BODY });

  const contact = page("تواصل");
  text(contact, "كِكر", "للمشاريع القادمة", 18, 40, 174, 6, { size: 9, color: GREEN, weight: 700, font: META });
  text(contact, "عنوان التواصل", "لنتحدّث\nعن وثيقة\nتُحسم.", 18, 54, 174, 46, { size: 30, weight: 800 });
  add(contact, "line", "فاصل", 18, 112, 32, 0, "", { color: GOLD, stroke: 0.9 });
  text(contact, "دعوة تواصل", "متاحة لتقارير القيادة، والهويات المؤسسية، والصفحات التي ستُطبع.", 18, 124, 160, 16, { size: 12, font: BODY, lineHeight: 1.6 });
  text(contact, "البريد", "البريد", 18, 156, 174, 5, { size: 8, color: MUTED, font: META });
  text(contact, "عنوان البريد", "layan@example.com", 18, 164, 174, 8, { size: 14, weight: 700, color: GREEN });
  text(contact, "الهاتف", "الهاتف", 18, 182, 174, 5, { size: 8, color: MUTED, font: META });
  text(contact, "رقم الهاتف", "٠٥٥ ٠٠٠ ٠٠٠٠", 18, 190, 174, 8, { size: 14, weight: 700 });
  text(contact, "المدينة", "الرياض", 18, 210, 174, 8, { size: 12, color: MUTED, font: META });
  return [cover, about, projects, contact];
}

function digitalCardPage(): Page {
  const target = page("بطاقة رقمية", 108, 192);
  shape(target, "حقل الاسم", 0, 0, 108, 72, GREEN);
  add(target, "image", "الصورة الشخصية", 36, 54, 36, 36, "", { objectFit: "cover", radius: 0 }, plate("portrait"));
  text(target, "الاسم", "نورة السبيعي", 8, 98, 92, 10, { size: 14, color: GREEN, weight: 800, align: "center" });
  text(target, "المسمى", "اتصال مؤسسي", 8, 110, 92, 6, { size: 8, color: MUTED, align: "center", font: META });
  add(target, "line", "فاصل", 30, 122, 48, 0, "", { color: GOLD, stroke: 0.5 });
  ["٠٥٥ ٠٠٠ ٠٠٠٠", "nora@example.com", "example.com", "الرياض"].forEach((label, index) => {
    text(target, label, label, 8, 130 + index * 11, 92, 7, { size: 8, color: INK, align: "center", font: META });
  });
  return target;
}

function businessCardPages(): Page[] {
  const front = page("الوجه الأمامي", 94.9, 56.8);
  shape(front, "أرضية", 0, 0, 94.9, 56.8, "#f7f6f3");
  shape(front, "حافة الهوية", 90.5, 0, 4.4, 56.8, GREEN);
  text(front, "اسم الموظف", "نورة السبيعي", 6, 8, 80, 8, { size: 11, color: GREEN, weight: 800 });
  text(front, "المسمى الوظيفي", "اتصال مؤسسي", 6, 18, 80, 5, { size: 7, color: INK, font: META });
  add(front, "line", "فاصل", 6, 26, 24, 0, "", { color: GOLD, stroke: 0.45 });
  text(front, "بيانات البطاقة", "٠٥٥ ٠٠٠ ٠٠٠٠\nnora@example.com", 6, 30, 80, 12, { size: 6.5, color: INK, font: META, lineHeight: 1.35 });
  text(front, "ملاحظة الطباعة", "٨٨٫٩ × ٥٠٫٨ مم", 6, 48, 80, 4, { size: 4.5, color: MUTED, font: META });

  const back = page("الوجه الخلفي", 94.9, 56.8);
  shape(back, "أرضية", 0, 0, 94.9, 56.8, GREEN);
  text(back, "اسم العلامة", "اسم الجهة", 8, 14, 78, 8, { size: 12, color: "#f7f6f3", weight: 800 });
  add(back, "line", "فاصل", 56, 26, 28, 0, "", { color: GOLD, stroke: 0.5 });
  text(back, "عنوان الشركة", "الرياض  ·  مراسلات ومطبوعات", 8, 32, 78, 8, { size: 7, color: "#e7efe9", font: META });
  text(back, "ملاحظة الطباعة", "وجه خلفي", 8, 48, 78, 4, { size: 4.5, color: GOLD, font: META });
  return [front, back];
}

function greetingPages(): Page[] {
  const photo = page("تهنئة بمشهد", 108, 135);
  shape(photo, "حقل أخضر", 0, 0, 108, 135, GREEN);
  add(photo, "image", "مشهد التهنئة", 8, 8, 92, 58, "", { objectFit: "cover", radius: 2 }, plate("dune"));
  text(photo, "نص التهنئة", "كل عام وأنتم بخير", 8, 74, 92, 12, { size: 14, color: "#ffffff", weight: 800 });
  add(photo, "line", "خيط", 8, 90, 28, 0, "", { color: GOLD, stroke: 0.7 });
  text(photo, "رسالة البطاقة", "أيامكم عامرة بما يسرّكم.", 8, 96, 92, 8, { size: 9, color: "#e7efe9", font: BODY });
  text(photo, "اسم المرسل", "نورة", 8, 114, 92, 6, { size: 8, color: GOLD, font: META });

  const typeLed = page("تهنئة مكتوبة", 108, 135);
  shape(typeLed, "أرضية", 0, 0, 108, 135, "#f6f3ee");
  shape(typeLed, "حافة", 0, 0, 3.5, 135, "#1b4d3e");
  text(typeLed, "المناسبة", "معايدة", 12, 18, 88, 5, { size: 8, color: "#1b4d3e", weight: 700, font: META });
  text(typeLed, "نص التهنئة", "أجمل\nالأمنيات", 12, 30, 88, 28, { size: 22, weight: 800, font: "Amiri" });
  add(typeLed, "line", "فاصل", 12, 66, 22, 0, "", { color: GOLD, stroke: 0.7 });
  text(typeLed, "رسالة البطاقة", "للأيام التي تأتون بها،\nوللجهد الذي سبقها.", 12, 76, 86, 18, { size: 10, font: BODY, lineHeight: 1.6 });
  text(typeLed, "اسم المرسل", "مع التحية  ·  نورة", 12, 114, 86, 6, { size: 8, color: MUTED, font: META });
  return [photo, typeLed];
}

function ministryPages(): Page {
  const target = page("مراسلات تعليمية");
  target.bg = "#f7f6f3";
  shape(target, "زاوية", 176, 0, 34, 28, "#e7efe9", "", "triangle");
  add(target, "line", "خط الهوية", 0, 0, 210, 0, "", { color: "#1b4d3e", stroke: 2 });
  text(target, "اسم الجهة التعليمية", "مدرسة النور الأهلية", 18, 14, 174, 9, { size: 16, color: "#1b4d3e", weight: 800 });
  text(target, "الإدارة والقسم", "المرحلة المتوسطة  ·  العام الدراسي ١٤٤٧ — ١٤٤٨", 18, 26, 174, 6, { size: 9, color: MUTED, font: META });
  add(target, "line", "فاصل الرأس", 18, 38, 174, 0, "", { color: GOLD, stroke: 0.45 });
  text(target, "صفة النموذج", "نموذج قابل للتخصيص — ليس اعتمادًا حكوميًا", 18, 44, 174, 6, { size: 8, color: MUTED, align: "center", font: META });
  text(target, "رقم الخطاب", "٤٤ / م", 18, 58, 50, 6, { size: 10, weight: 700, font: META });
  text(target, "تاريخ الخطاب", "١٢ / ٠٣ / ١٤٤٧", 74, 58, 60, 6, { size: 10, font: META });
  text(target, "المرفقات", "مرفق واحد", 140, 58, 52, 6, { size: 10, align: "left", font: META });
  add(target, "line", "حد الحقول", 18, 70, 174, 0, "", { color: LINE, stroke: 0.3 });
  text(target, "الجهة المرسل إليها", "أولياء أمور الصف الثاني المتوسط", 18, 80, 174, 8, { size: 13, weight: 700 });
  text(target, "الموضوع", "الموضوع: اجتماع الأداء الفصلي", 18, 96, 174, 8, { size: 13, weight: 700, color: "#1b4d3e" });
  text(target, "متن الخطاب", "السلام عليكم ورحمة الله وبركاته،\n\nيسعدنا دعوتكم إلى اجتماع الأداء الفصلي يوم الأحد القادم في قاعة الاجتماعات. سنعرض نتائج الفترة وخطة المتابعة.\n\nوتقبلوا خالص التحية.", 18, 114, 174, 58, { size: 12, font: BODY, lineHeight: 1.75 });
  add(target, "line", "خط التوقيع", 136, 190, 56, 0, "", { color: "#1b4d3e", stroke: 0.3 });
  text(target, "التوقيع", "مديرة المرحلة\nالاسم", 122, 194, 70, 14, { size: 9, color: MUTED, font: META, lineHeight: 1.4 });
  add(target, "line", "خط التذييل", 18, 268, 174, 0, "", { color: "#1b4d3e", stroke: 0.35 });
  text(target, "بيانات التواصل", "الرياض  ·  ٠١١ ٠٠٠ ٠٠٠٠  ·  nore@example.com", 18, 274, 174, 6, { size: 8, color: MUTED, align: "center", font: META });
  text(target, "تنبيه الملكية", "استبدلوا أي شعار بأصل تملكه الجهة. هذا النموذج بلا شعار محمي.", 18, 284, 174, 6, { size: 7.5, color: MUTED, align: "center", font: META });
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
    if (element.type === "shape") {
      const markup = shapeSvgMarkup(style.shapeId || "rect", {
        fill: style.fill && style.fill !== "transparent" ? String(style.fill) : "none",
        stroke: style.borderColor || "none",
        strokeUnits: Math.max(0, Number(style.borderWidth) || 0) * (100 / Math.max(w, h, 1)),
        radiusMm: Number(style.radius) || undefined,
        box: { w, h },
      });
      return markup
        .replace("<svg ", `<svg x="${x}" y="${y}" width="${w}" height="${h}" `)
        .replace(' width="100%" height="100%"', "");
    }
    const frame = element.type === "box"
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