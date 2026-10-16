import assert from "node:assert/strict";
import { test } from "node:test";
import { THEMES, pageSize, type CanvasEl, type Page } from "./model.ts";
import {
  PACKS,
  PAGE_TEMPLATES,
  createTemplatePage,
  packPages,
} from "./templates.ts";
import { buildProductTemplateSeeds } from "./product-templates.ts";
import { estimateLines, hasArabic, measureTextHeight, measureTextWidth } from "./arabic.ts";
import { arabicSafeLineHeight } from "./typography.ts";
/**
 * What a printed catalog page must never do — checked on the REAL builders of
 * every page template, every pack, and every licensed product master, with the
 * same text measurement the renderer uses.
 *
 * This is deliberately not a style review: gold micro-labels on white are the
 * catalog's own accent language (`.grok/skills/nasaq-media/SKILL.md`) and stay.
 * What must not ship:
 *
 *   · two text boxes fighting over the same space,
 *   · copy painted under an opaque shape,
 *   · copy whose colour sits on the same end of the scale as its field
 *     (ink on deep green, ivory on white — an accent is a mid tone),
 *   · Arabic set LTR, or a wide Arabic frame flush left,
 *   · content growing into the footer band,
 *   · geometry the editor cannot place.
 */

const theme = THEMES.official;
const org = "جهة الاختبار";
const HEX = /^#[0-9a-f]{6}$/i;

function catalogPages(): { label: string; page: Page }[] {
  const pages: { label: string; page: Page }[] = [];
  for (const meta of PAGE_TEMPLATES) {
    pages.push({
      label: `page:${meta.id}`,
      page: createTemplatePage(meta.id, theme, org),
    });
  }
  for (const pack of PACKS) {
    packPages(pack.id, theme, org).forEach((page, index) =>
      pages.push({ label: `pack:${pack.id}[${index}]`, page }),
    );
  }
  for (const template of buildProductTemplateSeeds()) {
    const document = JSON.parse(template.content) as { pages: Page[] };
    document.pages.forEach((page, index) =>
      pages.push({ label: `product:${template.id}[${index}]`, page }),
    );
  }
  return pages;
}

function walk(elements: CanvasEl[], out: CanvasEl[] = []): CanvasEl[] {
  for (const element of elements ?? []) {
    out.push(element);
    if (element.children) walk(element.children, out);
  }
  return out;
}

const isText = (el: CanvasEl) => el.type === "text";
const fontSizeOf = (el: CanvasEl) => Number(el.style?.fontSize) || 12;

/** The painted height of a frame: the declared box, or the grown text, whichever is taller. */
function renderedHeight(el: CanvasEl): number {
  const measured =
    isText(el) && el.content
      ? (() => {
          const lineHeight = Number(el.style?.lineHeight) || 1.45;
          const multiLineArabic =
            hasArabic(el.content) &&
            estimateLines(
              el.content,
              Math.max(8, el.w),
              fontSizeOf(el),
              el.style?.fontFamily,
            ) > 1;
          // Match the renderer: multi-line Arabic is raised to the safe floor,
          // so the measured height never under-estimates the painted box.
          const effectiveLineHeight = multiLineArabic
            ? arabicSafeLineHeight(lineHeight, el.style?.fontFamily)
            : lineHeight;
          return measureTextHeight(
            el.content,
            Math.max(8, el.w),
            fontSizeOf(el),
            effectiveLineHeight,
            0,
            el.style?.fontFamily,
          );
        })()
      : 0;
  return Math.max(el.h, measured);
}

function sharedArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** WCAG relative luminance — used only to decide which end of a scale a colour sits on. */
function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const channels = [0, 2, 4].map((index) => {
    const value = Number.parseInt(raw.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Opaque fills painted under the text, in paint order. */
function coverFills(
  elements: CanvasEl[],
  text: CanvasEl,
  minShapeHeight = 0,
): string[] {
  const rect = { x: text.x, y: text.y, w: text.w, h: renderedHeight(text) };
  const fills: string[] = [];
  for (const candidate of elements) {
    if (candidate === text) break;
    if (isText(candidate) || candidate.type === "line") continue;
    const fill = candidate.style?.fill;
    if (typeof fill !== "string" || !HEX.test(fill)) continue;
    if (candidate.opacity < 0.9 || candidate.h < minShapeHeight) continue;
    if (sharedArea(rect, candidate) / Math.max(1, rect.w * rect.h) >= 0.6) {
      fills.push(fill);
    }
  }
  return fills;
}

/** The background actually painted under a text: the topmost opaque band, else the page field. */
function backgroundsOf(
  page: Page,
  elements: CanvasEl[],
  text: CanvasEl,
): string[] {
  const covered = coverFills(elements, text);
  if (covered.length) return [covered[covered.length - 1]];
  const stops = page.bgGradient?.stops
    ?.map((stop) => stop.color)
    .filter((color): color is string => typeof color === "string" && HEX.test(color));
  return stops?.length ? stops : [page.bg ?? "#ffffff"];
}

test("every catalog page keeps its copy readable, placed and RTL", () => {
  const pages = catalogPages();
  assert.ok(pages.length >= 60, `the catalog built ${pages.length} pages`);

  for (const { label, page } of pages) {
    const size = pageSize(page);
    const elements = walk(page.elements);
    const texts = elements.filter((el) => isText(el) && el.content?.trim());

    for (const el of elements) {
      assert.ok(
        [el.x, el.y, el.w, el.h].every(Number.isFinite),
        `${label}/${el.name}: geometry is not finite`,
      );
      assert.ok(
        el.x >= -0.2 &&
          el.y >= -0.2 &&
          el.x + el.w <= size.w + 0.6 &&
          el.y + el.h <= size.h + 0.6,
        `${label}/${el.name}: outside the page`,
      );
    }

    const footerTop = size.h - 14;
    for (const text of texts) {
      if (/[\u0600-\u06FF]/.test(text.content ?? "")) {
        assert.notEqual(
          text.style?.direction,
          "ltr",
          `${label}/${text.name}: Arabic set LTR`,
        );
        if (text.style?.textAlign === "left") {
          const content = text.content ?? "";
          const ink = measureTextWidth(
            content,
            fontSizeOf(text),
            Number(text.style?.fontWeight) || 400,
          );
          // A short label in a box that hugs it (the folio number) is furniture;
          // alignment inside it is invisible. A column or a prose line set flush
          // left is what breaks Arabic typography.
          const slack = text.w - ink;
          assert.ok(
            !(slack > 8 && (content.length >= 40 || text.w >= 24)),
            `${label}/${text.name}: wide Arabic frame set flush left (box ${text.w.toFixed(1)} vs ink ${ink.toFixed(1)})`,
          );
        }
      }

      // Same end of the scale on both sides of the text — ink on deep green,
      // ivory on white. Gold accents are mid tones and stay allowed.
      if (typeof text.style?.color === "string" && HEX.test(text.style.color)) {
        const textLuma = luminance(text.style.color);
        for (const background of backgroundsOf(page, elements, text)) {
          const fieldLuma = luminance(background);
          assert.ok(
            !(textLuma < 0.22 && fieldLuma < 0.22),
            `${label}/${text.name}: ${text.style.color} on ${background} is dark on dark`,
          );
          assert.ok(
            !(textLuma > 0.75 && fieldLuma > 0.75),
            `${label}/${text.name}: ${text.style.color} on ${background} is light on light`,
          );
        }
      }

      // Content may not grow into the green footer band — unless it IS the band.
      const bottom = text.y + renderedHeight(text);
      if (bottom > footerTop - 0.5 && text.y < footerTop) {
        assert.ok(
          coverFills(elements, text, 12).length > 0,
          `${label}/${text.name}: content grows into the footer (bottom ${bottom.toFixed(1)})`,
        );
      }
    }

    // Rendered (auto-grown) text must never run past the page bottom edge.
    for (const text of texts) {
      const overrun = text.y + renderedHeight(text);
      assert.ok(
        overrun <= size.h + 0.5,
        `${label}/${text.name}: text extends below the page (bottom ${overrun.toFixed(1)} of ${size.h})`,
      );
    }

    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i];
        const b = texts[j];
        if (a.hfRole !== b.hfRole && (a.hfRole || b.hfRole)) continue;
        const aHeight = renderedHeight(a);
        const bHeight = renderedHeight(b);
        const shared = sharedArea(
          { x: a.x, y: a.y, w: a.w, h: aHeight },
          { x: b.x, y: b.y, w: b.w, h: bHeight },
        );
        const ratio =
          shared / Math.max(1, Math.min(a.w * aHeight, b.w * bHeight));
        assert.ok(
          ratio < 0.3,
          `${label}: "${a.name}" and "${b.name}" fight over the same space (${Math.round(ratio * 100)}%)`,
        );
      }
    }

    for (let i = 0; i < elements.length; i += 1) {
      const text = elements[i];
      if (!isText(text) || !text.content?.trim()) continue;
      for (let j = i + 1; j < elements.length; j += 1) {
        const shape = elements[j];
        if (isText(shape) || shape.type === "line" || shape.type === "group") continue;
        const fill = shape.style?.fill;
        if (typeof fill !== "string" || !HEX.test(fill)) continue;
        if (shape.opacity < 0.9) continue;
        const shared = sharedArea(
          { x: text.x, y: text.y, w: text.w, h: renderedHeight(text) },
          shape,
        );
        assert.ok(
          shared / Math.max(1, text.w * renderedHeight(text)) < 0.6,
          `${label}: "${text.name}" is painted under "${shape.name}"`,
        );
      }
    }
  }
});
