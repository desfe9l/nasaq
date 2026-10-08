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
  const arabic = ARABIC.test(content);
  return put(page, "text", {
    name,
    content,
    x,
    y,
    w,
    h,
    style: {
      textAlign: arabic ? "right" : "left",
      direction: arabic ? "rtl" : "ltr",
      textBoxMode: "fixed",
      overflowVisible: false,
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
  const label = org
    ? write(page, "اسم الجهة", org, m + s + 6, h - 16, w - m * 2 - s - 8, 8, {
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 8,
        fontWeight: 600,
        color: palette.onField,
        lineHeight: 1.2,
      })
    : null;
  if (label) label.hfRole = "footer";
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
  withImage = true,
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
  put(page, "logo", { name: "شعار قابل للاستبدال", x: w - m - 18, y: 14, w: 14, h: 14 });
  write(page, "تصنيف", "وثيقة قابلة للتحرير", m, 18, w - m * 2 - 22, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8,
    fontWeight: 600,
    color: palette.accent,
    lineHeight: 1.2,
  });
  write(page, "العنوان", title, m, tall ? 36 : 32, w - m * 2 - 22, tall ? 28 : 36, {
    fontFamily: "Tajawal",
    fontSize: tall ? 26 : 28,
    fontWeight: 800,
    color: palette.onField,
    lineHeight: 1.12,
  });
  if (subtitle) {
    write(page, "المقدمة", subtitle, m, band - 22, w - m * 2 - 22, 14, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 12,
      fontWeight: 500,
      color: palette.onField,
      lineHeight: 1.5,
    });
  }
  if (!tall && withImage && h - band > 90) {
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
  return band;
}

function coverEditorial(page: Page, palette: PaletteRoles, title: string, subtitle: string, org: string) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const titleY = Math.max(48, Math.round(h * 0.42));
  put(page, "shape", {
    name: "شريط علوي",
    x: 0,
    y: 0,
    w,
    h: 8,
    style: { fill: palette.field, borderWidth: 0, radius: 0, shape: "rect", shapeId: "rect" },
  });
  write(page, "تصنيف", "وثيقة قابلة للتحرير", m, 16, w - m * 2, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8,
    fontWeight: 600,
    color: palette.accent,
    lineHeight: 1.2,
  });
  put(page, "shape", {
    name: "خيط ذهبي",
    x: w - m - 36,
    y: titleY - 6,
    w: 36,
    h: 1.4,
    style: { fill: palette.accent, borderWidth: 0 },
  });
  write(page, "العنوان", title, m, titleY, w - m * 2, 32, {
    fontFamily: "Tajawal",
    fontSize: 32,
    fontWeight: 800,
    color: palette.field,
    lineHeight: 1.12,
  });
  if (subtitle) {
    write(page, "المقدمة", subtitle, m, titleY + 36, w - m * 2, 16, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 12,
      fontWeight: 500,
      color: palette.ink,
      lineHeight: 1.5,
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
  if (org) {
    write(page, "الجهة", org, 16, h / 2 - 10, Math.max(24, w - panel - 40), 16, {
      fontFamily: "Tajawal",
      fontSize: 16,
      fontWeight: 700,
      color: palette.ink,
      lineHeight: 1.3,
    });
  }
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
      const lead = subtitle || "نسخة أصلية وفق لغة نَسَق، لا نسخة من مرجع.";
      if (plan.format === "wide-slide" || brief.style === "corporate" || brief.style === "executive") {
        coverWide(page, palette, brief.title, lead, org);
      } else if (brief.style === "editorial") {
        coverEditorial(page, palette, brief.title, lead, org);
      } else {
        coverPortrait(page, palette, brief.title, lead, org, plan.format);
      }
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

/**
 * A cramped left-aligned dump of lines. The critic's "before".
 *
 * Generalized from `literalDraft` so the reference path and the raw-content path
 * use the same "before" object: a single sheet, tiny left-to-right text, one line
 * per row — exactly what content looks like when nobody has composed it yet.
 */
export function literalTextDraft(title: string, lines: string[], w: number, h: number): Project {
  const page = sheet("نقل حرفي", w, h, "#ffffff");
  const kept = [title, ...lines.filter((line) => line !== title)].slice(0, 8);
  kept.forEach((line, index) => {
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
  if (!kept.length) {
    write(page, "بلا نص", title, 3, 4, 40, 8, {
      fontFamily: "Cairo",
      fontSize: 7,
      color: "#bbbbbb",
      fill: "#dddddd",
      textAlign: "left",
      direction: "ltr",
    });
  }
  return projectShell(title, "", [page]);
}

export function literalDraft(analysis: DesignAnalysis): Project {
  return literalTextDraft(
    analysis.title,
    analysis.extractedLines,
    analysis.document.primary.w,
    analysis.document.primary.h,
  );
}

const META_LINE = /@|https?:\/\/|\b05\d{7,}\b|9200\d{3,}/;

/** Split raw lines into contact/metadata lines and prose — one definition. */
export function splitMetaLines(lines: string[]): { meta: string[]; body: string[] } {
  const meta = lines.filter((line) => META_LINE.test(line));
  return { meta, body: lines.filter((line) => !META_LINE.test(line)) };
}

/**
 * Which line is the subtitle, which are contact metadata and which are prose.
 * One definition, shared by the reference path and the raw-content path so the
 * two can never disagree about what counts as content.
 */
export function splitCopy(
  title: string,
  lines: string[],
): { title: string; subtitle: string; meta: string[]; body: string[] } {
  const rest = lines.filter((line) => line !== title);
  const { meta, body: prose } = splitMetaLines(rest);
  const subtitle = prose.find((line) => line.length <= 90) || "";
  return { title, subtitle, meta, body: prose.filter((line) => line !== subtitle) };
}

function copyBlocks(analysis: DesignAnalysis): {
  title: string;
  subtitle: string;
  meta: string[];
  body: string[];
} {
  return splitCopy(analysis.title, analysis.extractedLines);
}

function chunkBody(lines: string[], slots: number): string[][] {
  if (slots <= 0) return [];
  if (!lines.length) return Array.from({ length: slots }, () => []);
  const size = Math.max(1, Math.ceil(lines.length / slots));
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
  while (chunks.length < slots) chunks.push([]);
  return chunks.slice(0, slots);
}

function sourcePage(
  page: Page,
  palette: PaletteRoles,
  running: string,
  lines: string[],
  index: number,
  total: number,
  org: string,
) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  head(page, palette, running);
  const heading = lines.find((line) => line.length <= 48) || running;
  const rest = lines.filter((line) => line !== heading);
  write(page, "عنوان القسم", heading, m, 24, w - m * 2, 16, {
    fontFamily: "Tajawal",
    fontSize: 18,
    fontWeight: 800,
    color: palette.field,
    lineHeight: 1.2,
  });
  put(page, "shape", {
    name: "خيط القسم",
    x: w - m - 36,
    y: 42,
    w: 36,
    h: 1.2,
    style: { fill: palette.accent, borderWidth: 0 },
  });
  if (rest.length) {
    write(page, "متن المصدر", rest.join("\n"), m, 50, w - m * 2, Math.max(16, h - 50 - 28), {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 11,
      fontWeight: 500,
      color: palette.ink,
      lineHeight: 1.7,
      textBoxMode: "fixed",
      overflowVisible: false,
    });
  }
  footer(page, palette, org, index, total);
}

function quietPage(
  page: Page,
  palette: PaletteRoles,
  running: string,
  index: number,
  total: number,
  org: string,
) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  head(page, palette, running);
  write(page, "بيان الصفحة", "لا نص مستخرج لهذه الصفحة.", m, 28, w - m * 2, 12, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 12,
    fontWeight: 600,
    color: palette.ink,
    lineHeight: 1.5,
  });
  if (h > 120) {
    put(page, "image", {
      name: "موضع صورة من الأصل",
      x: m,
      y: 48,
      w: w - m * 2,
      h: Math.min(96, h - 48 - 30),
      style: { objectFit: "cover", radius: 0 },
    });
  }
  footer(page, palette, org, index, total);
}

export interface TextComposition {
  title: string;
  subtitle: string;
  meta: string[];
  body: string[];
  /** Page geometry of the composed document. */
  w: number;
  h: number;
  palette: PaletteRoles;
  /** Total pages, cover included. */
  total: number;
  format: DesignFormat;
  /** One line under the title — the organisation, when it is known. */
  orgLine: string;
}

/**
 * THE composer: content + a palette + a page plan → a real document.
 *
 * It was extracted from `composeReference` so the reference path and the
 * raw-content path are literally the same code. The composer never invents a
 * line: every string it writes comes from the caller's `title`, `subtitle`,
 * `meta` or `body`, and the only authored sentences are the structural labels
 * the platform already used («لا نص مستخرج لهذه الصفحة», «الختام…»).
 */
export function composeText(input: TextComposition): Project {
  const { w, h, palette, total, format, title, subtitle, meta, body, orgLine } = input;
  const slots = Math.max(0, total - 1);
  const pageLines = format === "wide-slide" ? [...body, ...meta] : body;
  const chunks = chunkBody(pageLines, slots);
  const pages: Page[] = [];
  for (let index = 0; index < total; index += 1) {
    const page = sheet(index === 0 ? "الغلاف" : `صفحة ${index + 1}`, w, h, palette.paper);
    if (index === 0) {
      if (format === "wide-slide") {
        coverWide(page, palette, title, subtitle, orgLine);
      } else {
        const band = coverPortrait(page, palette, title, subtitle, orgLine, format, total > 1);
        if (total === 1) {
          const m = marginOf(w);
          const column = w - m * 2 - 22;
          const extra = [...body, ...meta].filter(Boolean);
          if (extra.length) {
            const top = Math.min(band + 8, h - 40);
            write(page, "متن المصدر", extra.join("\n"), m, top, column, Math.max(12, h - top - 28), {
              fontFamily: "Noto Naskh Arabic",
              fontSize: 11,
              fontWeight: 500,
              color: palette.ink,
              lineHeight: 1.6,
              textBoxMode: "fixed",
              overflowVisible: false,
            });
          }
        } else if (meta.length) {
          const m = marginOf(w);
          write(page, "بيانات المصدر", meta.slice(0, 3).join("\n"), m, h - 40, w - m * 2 - 22, 12, {
            fontFamily: "IBM Plex Sans Arabic",
            fontSize: 8,
            fontWeight: 600,
            color: palette.ink,
            lineHeight: 1.3,
            textBoxMode: "fixed",
            overflowVisible: false,
          });
        }
      }
    } else if (chunks[index - 1]?.length) {
      sourcePage(page, palette, title, chunks[index - 1], index + 1, total, orgLine);
    } else {
      quietPage(page, palette, title, index + 1, total, orgLine);
    }
    pages.push(page);
  }
  if (format === "wide-slide" && total === 1) {
    const extra = [...body, ...meta].filter(Boolean);
    if (extra.length) {
      const page = pages[0];
      const panel = Math.round(w * 0.4);
      write(page, "متن المصدر", extra.join("\n"), 16, 28, Math.max(40, w - panel - 36), Math.max(16, h - 56), {
        fontFamily: "Noto Naskh Arabic",
        fontSize: 12,
        fontWeight: 500,
        color: palette.ink,
        lineHeight: 1.5,
        textBoxMode: "fixed",
        overflowVisible: false,
      });
    }
  }
  return projectShell(title, orgLine, pages);
}

export function composeReference(analysis: DesignAnalysis): Project {
  const { w, h } = analysis.document.primary;
  const copy = copyBlocks(analysis);
  const orgLine =
    analysis.extractedLines.find((line) => /إنفاذ|انفاذ|شركة|مؤسس|للمزاد/.test(line) && line.length <= 42) ||
    "";
  return composeText({
    ...copy,
    w,
    h,
    palette: analysis.palette,
    total: Math.max(1, analysis.document.pages),
    format: analysis.document.format,
    orgLine,
  });
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
      const layoutProblem = validateElementLayout(el);
      if (layoutProblem) problems.push(`layout:${el.id}`);
    }
  }
  return problems;
}

const LAYOUT_ROLES = new Set([
  "heading",
  "body",
  "accent-card",
  "stat-card",
  "summary-callout",
  "table",
  "image",
  "ornament",
  "furniture",
]);
const LAYOUT_ANCHORS = new Set(["right", "left", "center", "full"]);

/**
 * Per-element layout metadata (stamped by the AI layout engine) must be
 * well-formed when present: a known role, a hierarchy of 1–3, and a valid
 * grid anchor. The editor ignores the marker; this keeps generated JSON
 * honest for every consumer of the canvas output.
 */
function validateElementLayout(el: CanvasEl): boolean {
  const meta = el.layout;
  if (!meta) return false;
  if (!LAYOUT_ROLES.has(meta.role)) return true;
  if (meta.hierarchy !== undefined && ![1, 2, 3].includes(meta.hierarchy)) return true;
  if (meta.positioning) {
    if (!LAYOUT_ANCHORS.has(meta.positioning.anchor)) return true;
    if (meta.positioning.columnSpan !== undefined && ![1, 2, 3].includes(meta.positioning.columnSpan)) return true;
  }
  return false;
}
