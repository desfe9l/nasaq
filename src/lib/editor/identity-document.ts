import { createElement, type CanvasEl } from "./model";
import { buildNewDocument, defaultNewDocument } from "./new-document";
import type { BrandKit } from "../product/product";

export type IdentityDocumentKind = "cover" | "letter" | "certificate";
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
        : "عنوان التقرير";
  const project = buildNewDocument(
    defaultNewDocument({
      kind: kind === "cover" ? "report" : kind,
      name: title,
      orgName: kit.organizationName,
      orientation: kit.pageSize === "a4-landscape" ? "landscape" : "portrait",
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
  if (kind === "certificate") {
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
  text(title, h * 0.3, 24, 30, kit.primaryColor);
  if (kind === "certificate") {
    text("تُمنح هذه الشهادة إلى", h * 0.46, 12, 14);
    text(recipient, h * 0.54, 18, 24, kit.secondaryColor);
    text("تقديرًا لجهوده المتميزة ومساهمته الفاعلة", h * 0.65, 18, 15);
    text("التوقيع", h - 36, 10, 10);
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
