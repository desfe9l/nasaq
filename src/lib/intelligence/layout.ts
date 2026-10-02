import { uid } from "@/lib/utils";
import {
  THEMES,
  createElement,
  nextZ,
  pageSize,
  sizeIdOf,
  type CanvasEl,
  type ElType,
  type Page,
  type Project,
} from "@/lib/editor/model";
import type { DesignAnalysis, DesignBrief, DesignFormat, PaletteRoles } from "./schema";
import { paletteForStyle } from "./dna";

const ARABIC = /[\u0600-\u06FF]/;

function sheet(name: string, w: number, h: number, paper: string): Page {
  return { id: uid("page"), name, bg: paper, w, h, elements: [] };
}

function put(page: Page, type: ElType, over: Partial<CanvasEl>): CanvasEl {
  const el = createElement(type, over, THEMES.official);
  el.z = nextZ(page);
  page.elements.push(el);
  return el;
}

function write(
  page: Page,
  name: string,
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: CanvasEl["style"],
): CanvasEl {
  return put(page, "text", {
    name,
    content,
    x,
    y,
    w,
    h,
    style: {
      textAlign: "right",
      direction: "rtl",
      textBoxMode: "autoHeight",
      overflowVisible: true,
      ...style,
    },
  });
}

function marginOf(w: number): number {
  return Math.min(16, Math.max(10, Math.round(w * 0.06)));
}

function onAccent(palette: PaletteRoles): string {
  const raw = palette.accent.replace("#", "");
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? palette.ink : palette.paper;
}

function footer(page: Page, palette: PaletteRoles, org: string, index: number, total: number) {
  const { w, h } = pageSize(page);
  if (h < 80) return;
  const bar = 22;
  const m = marginOf(w);
  const s = 12;
  put(page, "shape", {
    name: "تذييل",
    x: 0,
    y: h - bar,
    w,
    h: bar,
    hfRole: "footer",
    style: { fill: palette.field, borderWidth: 0, radius: 0, shape: "rect", shapeId: "rect" },
  });
  const label = write(page, "اسم الجهة", org || "الجهة", m + s + 6, h - 16, w - m * 2 - s - 8, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8,
    fontWeight: 600,
    color: palette.onField,
    lineHeight: 1.2,
  });
  label.hfRole = "footer";
  put(page, "shape", {
    name: "دائرة الرقم",
    x: m,
    y: h - 17,
    w: s,
    h: s,
    style: { fill: palette.accent, borderWidth: 0, shape: "circle", shapeId: "circle" },
  });
  const folio = put(page, "text", {
    name: "رقم الصفحة",
    x: m,
    y: h - 17,
    w: s,
    h: s,
    content: String(index),
    style: {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 8,
      fontWeight: 700,
      color: onAccent(palette),
      textAlign: "center",
      direction: "rtl",
      verticalAlign: "middle",
      lineHeight: 1,
      textBoxMode: "fixed",
    },
  });
  folio.hfRole = "footer";
  void total;
}

function head(page: Page, palette: PaletteRoles, labelText: string) {
  const { w } = pageSize(page);
  put(page, "shape", {
    name: "ترويسة",
    x: 0,
    y: 0,
    w,
    h: 16,
    hfRole: "header",
    style: { fill: palette.field, borderWidth: 0, radius: 0, shape: "rect", shapeId: "rect" },
  });
  const label = write(page, "عنوان الترويسة", labelText, 16, 3, w - 32, 10, {
    fontFamily: "Tajawal",
    fontSize: 10,
    fontWeight: 700,
    color: palette.onField,
    lineHeight: 1.1,
  });
  label.hfRole = "header";
}

function projectShell(name: string, org: string, pages: Page[]): Project {
  return {
    version: 2,
    name,
    theme: "official",
    orgName: org,
    defaultSize: sizeIdOf(pages[0]),
    pages,
  };
}

function coverPortrait(
  page: Page,
  palette: PaletteRoles,
  title: string,
  subtitle: string,
  org: string,
  format: DesignFormat,
) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const tall = format === "tall-story";
  const band = tall ? Math.min(240, h * 0.18) : Math.min(118, h * 0.38);
  put(page, "shape", {
    name: "حقل الغلاف",
    x: 0,
    y: 0,
    w,
    h: band,
    style: { fill: palette.field, borderWidth: 0, radius: 0, shape: "rect", shapeId: "rect" },
  });
  put(page, "shape", {
    name: "خيط ذهبي",
    x: 0,
    y: band,
    w,
    h: 1.6,
    style: { fill: palette.accent, borderWidth: 0, radius: 0 },
  });
  put(page, "shape", {
    name: "معين",
    x: w - m - 8,
    y: 14,
    w: 8,
    h: 8,
    style: { fill: palette.accent, borderWidth: 0, shapeId: "diamond", shape: "rect" },
  });
  put(page, "logo", { name: "شعار قابل للاستبدال", x: w - m - 28, y: 28, w: 16, h: 16 });
  write(page, "تصنيف", "وثيقة قابلة للتحرير", m, 18, w * 0.5, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8,
    fontWeight: 600,
    color: palette.accent,
    lineHeight: 1.2,
  });
  write(page, "العنوان", title, m, tall ? 36 : 32, w - m * 2, tall ? 28 : 36, {
    fontFamily: "Tajawal",
    fontSize: tall ? 26 : 28,
    fontWeight: 800,
    color: palette.onField,
    lineHeight: 1.12,
  });
  if (subtitle) {
    write(page, "المقدمة", subtitle, m, band - 22, w - m * 2, 14, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 12,
      fontWeight: 500,
      color: palette.onField,
      lineHeight: 1.5,
    });
  }
  if (!tall && h - band > 90) {
    put(page, "image", {
      name: "صورة قابلة للاستبدال",
      x: m,
      y: band + 12,
      w: w - m * 2,
      h: Math.min(78, h - band - 70),
      style: { objectFit: "cover", radius: 0 },
    });
  }
  footer(page, palette, org, 1, 1);
}

function coverWide(page: Page, palette: PaletteRoles, title: string, subtitle: string, org: string) {
  const { w, h } = pageSize(page);
  const panel = Math.round(w * 0.4);
  put(page, "shape", {
    name: "حقل الغلاف",
    x: w - panel,
    y: 0,
    w: panel,
    h,
    style: { fill: palette.field, borderWidth: 0, radius: 0 },
  });
  put(page, "shape", {
    name: "خيط ذهبي",
    x: w - panel - 1.6,
    y: 0,
    w: 1.6,
    h,
    style: { fill: palette.accent, borderWidth: 0 },
  });
  write(page, "العنوان", title, w - panel + 16, 36, panel - 32, 48, {
    fontFamily: "Tajawal",
    fontSize: 28,
    fontWeight: 800,
    color: palette.onField,
    lineHeight: 1.12,
  });
  if (subtitle) {
    write(page, "المقدمة", subtitle, w - panel + 16, 96, panel - 32, 24, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 12,
      fontWeight: 500,
      color: palette.onField,
      lineHeight: 1.5,
    });
  }
  write(page, "الجهة", org || "الجهة", 16, h / 2 - 10, w - panel - 40, 16, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 700,
    color: palette.ink,
    lineHeight: 1.3,
  });
  footer(page, palette, org, 1, 1);
}

function sectionPage(
  page: Page,
  palette: PaletteRoles,
  running: string,
  heading: string,
  body: string,
  index: number,
  total: number,
  org: string,
  withData: boolean,
) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  head(page, palette, running);
  write(page, "عنوان القسم", heading, m, 24, w - m * 2, 16, {
    fontFamily: "Tajawal",
    fontSize: 18,
    fontWeight: 800,
    color: palette.field,
    lineHeight: 1.2,
  });
  put(page, "shape", {
    name: "خيط القسم",
    x: w - m - 42,
    y: 44,
    w: 42,
    h: 1.2,
    style: { fill: palette.accent, borderWidth: 0 },
  });
  write(page, "متن", body, m, 52, w - m * 2, Math.min(36, h * 0.16), {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 11,
    fontWeight: 500,
    color: palette.ink,
    lineHeight: 1.7,
  });
  if (withData && h > 180 && w > 140) {
    const cardW = (w - m * 2 - 8) / 2;
    put(page, "stat", {
      name: "مؤشر أول",
      x: w - m - cardW,
      y: 100,
      w: cardW,
      h: 28,
      content: "—\nالمؤشر",
      style: {
        fill: "#ffffff",
        color: palette.field,
        borderColor: palette.accent,
        borderWidth: 0.4,
        fontFamily: "Tajawal",
        fontSize: 16,
        fontWeight: 800,
        textAlign: "center",
        direction: "rtl",
        radius: 2,
      },
    });
    put(page, "stat", {
      name: "مؤشر ثان",
      x: m,
      y: 100,
      w: cardW,
      h: 28,
      content: "—\nالمقارنة",
      style: {
        fill: "#ffffff",
        color: palette.field,
        borderColor: palette.accent,
        borderWidth: 0.4,
        fontFamily: "Tajawal",
        fontSize: 16,
        fontWeight: 800,
        textAlign: "center",
        direction: "rtl",
        radius: 2,
      },
    });
    if (h > 230) {
      put(page, "table", {
        name: "جدول",
        x: m,
        y: 138,
        w: w - m * 2,
        h: Math.min(48, h - 138 - 30),
        content: JSON.stringify([
          ["البند", "البيان", "الحالة"],
          ["البند ١", "يُستبدل", "مسودة"],
          ["البند ٢", "يُستبدل", "مسودة"],
        ]),
        style: {
          cols: 3,
          rows: 3,
          headerBg: palette.field,
          headerColor: palette.onField,
          tableBg: "#ffffff",
          borderColor: "#d5dbe3",
          color: palette.ink,
          fontFamily: "IBM Plex Sans Arabic",
          fontSize: 10,
          cellAlign: "right",
        },
      });
    }
  }
  footer(page, palette, org, index, total);
}

function sectionsFor(brief: DesignBrief): string[] {
  const count = Math.min(12, Math.max(1, Math.round(brief.pages) || 1));
  const custom = [brief.title];
  const defaults = ["المقدمة", "النطاق", "المؤشرات", "التوصية", "الخاتمة"];
  while (custom.length < count) custom.push(defaults[(custom.length - 1) % defaults.length]);
  return custom.slice(0, count);
}

export function pagePlan(brief: DesignBrief): { w: number; h: number; format: DesignFormat } {
  if (brief.kind === "presentation" || brief.style === "presentation") {
    return { w: 338.7, h: 190.5, format: "wide-slide" };
  }
  if (brief.kind === "infographic" && brief.pages <= 1) {
    return { w: 210, h: 640, format: "tall-story" };
  }
  return { w: 210, h: 297, format: "a4-book" };
}

export function generateOriginal(brief: DesignBrief): Project {
  const palette = paletteForStyle(brief.style);
  const plan = pagePlan(brief);
  const titles = sectionsFor(brief);
  const org = (brief.org || "").trim();
  const subtitle = (brief.subtitle || "").trim();
  const pages = titles.map((heading, index) => {
    const page = sheet(index === 0 ? "الغلاف" : heading, plan.w, plan.h, palette.paper);
    if (index === 0) {
      if (plan.format === "wide-slide") coverWide(page, palette, brief.title, subtitle, org);
      else coverPortrait(page, palette, brief.title, subtitle || "نسخة أصلية وفق لغة نَسَق، لا نسخة من مرجع.", org, plan.format);
      return page;
    }
    const data = brief.style === "executive" ? index === 1 : index === 2;
    sectionPage(
      page,
      palette,
      brief.title,
      heading,
      index === titles.length - 1
        ? "الختام يُكتب هنا. لا تُضاف أرقام لم ترد في الموجز."
        : "متن هذا القسم يُكتب هنا. الهيكل ثابت والمحتوى قابل للاستبدال.",
      index + 1,
      titles.length,
      org,
      data && plan.format !== "wide-slide",
    );
    return page;
  });
  return projectShell(brief.title || "قالب جديد", org, pages);
}

/** A cramped left-aligned dump of the extracted lines. The critic's "before". */
export function literalDraft(analysis: DesignAnalysis): Project {
  const { w, h } = analysis.document.primary;
  const page = sheet("نقل حرفي", w, h, "#ffffff");
  const lines = [analysis.title, ...analysis.extractedLines.filter((line) => line !== analysis.title)].slice(0, 8);
  lines.forEach((line, index) => {
    write(page, `سطر ${index + 1}`, line, 3, 4 + index * 7, Math.min(w - 4, 90), 8, {
      fontFamily: "Cairo",
      fontSize: 7,
      fontWeight: 500,
      color: "#9aa0a6",
      fill: "#e6e6e6",
      textAlign: "left",
      direction: "ltr",
      lineHeight: 1,
      textBoxMode: "fixed",
    });
  });
  if (!lines.length) {
    write(page, "بلا نص", analysis.title, 3, 4, 40, 8, {
      fontFamily: "Cairo",
      fontSize: 7,
      color: "#bbbbbb",
      fill: "#dddddd",
      textAlign: "left",
      direction: "ltr",
    });
  }
  return projectShell(analysis.title, "", [page]);
}

export function composeReference(analysis: DesignAnalysis): Project {
  const { w, h } = analysis.document.primary;
  const palette = analysis.palette;
  const total = Math.max(1, analysis.document.pages);
  const orgLine = analysis.extractedLines.find((line) => /إنفاذ|انفاذ|شركة|مؤسس/.test(line)) || "";
  const pages: Page[] = [];
  for (let index = 0; index < total; index += 1) {
    const page = sheet(index === 0 ? "الغلاف" : `صفحة ${index + 1}`, w, h, palette.paper);
    if (index === 0) {
      const subtitle = analysis.extractedLines.find((line) => line !== analysis.title) || "";
      if (analysis.document.format === "wide-slide") {
        coverWide(page, palette, analysis.title, subtitle, orgLine);
      } else {
        coverPortrait(page, palette, analysis.title, subtitle, orgLine, analysis.document.format);
      }
    } else if (index === 1 && analysis.extractedLines.length) {
      head(page, palette, analysis.title);
      write(page, "عنوان القسم", "النص المستخرج", marginOf(w), 24, w - marginOf(w) * 2, 14, {
        fontFamily: "Tajawal",
        fontSize: 16,
        fontWeight: 800,
        color: palette.field,
        lineHeight: 1.2,
      });
      write(
        page,
        "متن المصدر",
        analysis.extractedLines.slice(0, 6).join("\n"),
        marginOf(w),
        46,
        w - marginOf(w) * 2,
        Math.min(80, h * 0.35),
        {
          fontFamily: "Noto Naskh Arabic",
          fontSize: 11,
          fontWeight: 500,
          color: palette.ink,
          lineHeight: 1.7,
        },
      );
      footer(page, palette, orgLine, index + 1, total);
    } else {
      sectionPage(
        page,
        palette,
        analysis.title,
        `قسم ${index + 1}`,
        "أضف محتوى هذا القسم. المقاس والعنوان الأصلي محفوظان.",
        index + 1,
        total,
        orgLine,
        index === 2 && analysis.document.format === "a4-book",
      );
    }
    pages.push(page);
  }
  return projectShell(analysis.title, orgLine, pages);
}

export function textsOf(project: Project): string[] {
  const out: string[] = [];
  const walk = (els: CanvasEl[]) => {
    for (const el of els) {
      if (el.content && ARABIC.test(el.content)) out.push(el.content);
      if (el.children) walk(el.children);
    }
  };
  project.pages.forEach((page) => walk(page.elements));
  return out;
}

export function validateProject(project: Project): string[] {
  const problems: string[] = [];
  if (project.version !== 2) problems.push("version");
  if (!project.pages.length) problems.push("pages");
  const types = new Set([
    "text",
    "box",
    "table",
    "shape",
    "line",
    "divider",
    "image",
    "logo",
    "icon",
    "stamp",
    "qr",
    "stat",
    "progress",
    "svg",
    "group",
  ]);
  for (const page of project.pages) {
    const size = pageSize(page);
    if (!(size.w > 10) || !(size.h > 10)) problems.push(`size:${page.id}`);
    for (const el of page.elements) {
      if (!types.has(el.type)) problems.push(`type:${el.type}`);
      if (!el.id) problems.push("id");
      if (![el.x, el.y, el.w, el.h].every((value) => Number.isFinite(value))) problems.push("geometry");
      if ((el.type === "text" || el.type === "box") && typeof el.content !== "string") problems.push("content");
    }
  }
  return problems;
}
