import { createElement, type CanvasEl } from "./model";
import { buildNewDocument, defaultNewDocument } from "./new-document";
import type { BrandKit } from "../product/product";

/*
 * The document kinds the identity page renders.
 *
 * Each one exists because it exercises the kit differently, and each is a real
 * editable NASAQ document — not a mock-up: portrait A4 pages (cover, letter,
 * certificate), a landscape 16:9 slide, and a vertical social/announcement
 * card. Adding a kind here makes it available to the preview, to «إنشاء
 * مستند», and to export through the same builder.
 */
export type IdentityDocumentKind =
  | "cover"
  | "letter"
  | "certificate"
  | "slide"
  | "card";

/** Which kit size each kind is built on. */
export const IDENTITY_DOCUMENT_KINDS: readonly IdentityDocumentKind[] = [
  "cover",
  "letter",
  "certificate",
  "slide",
  "card",
];
/** Real editable artwork shared by Identity preview, creation, persistence and export. */
export function buildIdentityDocument(
  kit: BrandKit,
  kind: IdentityDocumentKind,
  date = "",
  recipient = "اسم المستلم",
) {
  const title =
    kind === "certificate"
      ? "شهادة تقدير"
      : kind === "letter"
        ? "خطاب رسمي"
        : kind === "slide"
          ? "عنوان العرض التقديمي"
          : kind === "card"
            ? "بطاقة تهنئة رسمية"
            : "عنوان التقرير";
  const docKind =
    kind === "cover" || kind === "card"
      ? "report"
      : kind === "slide"
        ? "presentation"
        : kind;
  const project = buildNewDocument(
    defaultNewDocument({
      kind: docKind,
      name: title,
      orgName: kit.organizationName,
      ...(kind === "slide"
        ? { size: "slide" as const, orientation: "landscape" as const }
        : kind === "card"
          ? { size: "story" as const, orientation: "portrait" as const }
          : { orientation: kit.pageSize === "a4-landscape" ? ("landscape" as const) : ("portrait" as const) }),
    }),
  );
  const page = project.pages[0];
  const w = page.w!,
    h = page.h!;
  const elements: CanvasEl[] = [];
  const add = (type: CanvasEl["type"], over: Partial<CanvasEl>) => {
    const el = createElement(type, { ...over, z: elements.length + 1 });
    elements.push(el);
  };
  const text = (
    content: string,
    y: number,
    height: number,
    size = 16,
    color = kit.textColor || "#1f2937",
  ) =>
    add("text", {
      name: content,
      content,
      x: 24,
      y,
      w: w - 48,
      h: height,
      style: {
        fontFamily: kit.arabicFont,
        fontSize: size,
        fontWeight: 600,
        textAlign: "center",
        color,
        lineHeight: 1.5,
      },
    });
  if (kind === "card") {
    for (const [inset, color, width] of [
      [7, kit.accentColor, 0.5],
      [9.5, kit.primaryColor, 1],
    ] as const)
      add("shape", {
        name: "إطار البطاقة",
        x: inset,
        y: inset,
        w: w - inset * 2,
        h: h - inset * 2,
        style: {
          shape: "rect",
          fill: "none",
          borderColor: color,
          borderWidth: width,
        },
      });
  } else if (kind === "certificate") {
    for (const [inset, color, width] of [
      [10, kit.primaryColor, 0.8],
      [13, kit.accentColor, 0.35],
    ] as const)
      add("shape", {
        name: "إطار الشهادة",
        x: inset,
        y: inset,
        w: w - inset * 2,
        h: h - inset * 2,
        style: {
          shape: "rect",
          fill: "none",
          borderColor: color,
          borderWidth: width,
        },
      });
  } else {
    add("shape", {
      name: "شريط الهوية",
      x: 0,
      y: 0,
      w,
      h: 7,
      style: { shape: "rect", fill: kit.primaryColor, borderWidth: 0 },
    });
  }
  if (kit.logoSrc)
    add("logo", {
      name: "شعار الجهة",
      src: kit.logoSrc,
      x: w / 2 - 14,
      y: 20,
      w: 28,
      h: 24,
    });
  text(kit.organizationName || "اسم الجهة", 49, 14, 16, kit.secondaryColor);
  if (kit.subDepartment) text(kit.subDepartment, 63, 10, 11);
  text(
    title,
    kind === "slide" ? h * 0.36 : kind === "card" ? h * 0.28 : h * 0.3,
    24,
    kind === "slide" ? 34 : 30,
    kit.primaryColor,
  );
  if (kind === "card") {
    text("بمناسبة غالية، نتقدّم إليكم", h * 0.4, 12, 14);
    text("بأطيب التهاني والتبريكات", h * 0.47, 18, 22, kit.secondaryColor);
    text(kit.subDepartment ? kit.subDepartment : "وتقبلوا خالص التحايا والتقدير", h * 0.6, 14, 12);
  } else if (kind === "certificate") {
    text("تُمنح هذه الشهادة إلى", h * 0.46, 12, 14);
    text(recipient, h * 0.54, 18, 24, kit.secondaryColor);
    text("تقديرًا لجهوده المتميزة ومساهمته الفاعلة", h * 0.65, 18, 15);
    text("التوقيع", h - 36, 10, 10);
  } else if (kind === "slide") {
    text("عرض مؤسسي — يمكن تحرير كل عنصر في المحرر", h * 0.55, h * 0.16, 15);
  } else {
    text(
      kind === "letter"
        ? "السلام عليكم ورحمة الله وبركاته،\nنص الخطاب الرسمي — قابل للتحرير في المحرر."
        : "ملخص التقرير وأهدافه الرئيسية",
      h * 0.47,
      h * 0.24,
      16,
    );
  }
  if (kit.stampSrc)
    add("image", {
      name: "الختم",
      src: kit.stampSrc,
      x: w - 54,
      y: h - 56,
      w: 24,
      h: 24,
    });
  if (date) text(date, h - 25, 8, 9);
  if (kit.footerStyle !== "none" && kit.contactLine)
    text(kit.contactLine, h - 16, 7, 8);
  page.bg = kit.paperColor || "#fbfaf6";
  page.elements = elements;
  return project;
}
