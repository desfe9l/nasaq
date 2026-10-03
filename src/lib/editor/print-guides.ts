/**
 * Print guides for the A4 canvas.
 *
 * A report that will be printed and bound has three invisible constraints the
 * on-screen page does not show: the safe type area, the binding (gutter) margin
 * on the RTL side, and the bleed a commercial printer needs around the trim.
 * This module is the single source of truth for all three — the canvas draws
 * from it, and the pre-flight checker measures against exactly the same
 * numbers, so what the guides show and what the export complains about can
 * never disagree.
 *
 * Units are millimetres throughout, matching the document model.
 */

import type { CanvasEl, Page } from "./model.ts";

/** Distance from the trim edge to the safe type area. */
export const SAFE_MARGIN_MM = 10;
/**
 * Binding margin. Arabic documents bind on the RIGHT, so this band always sits
 * against the page's right edge — in a left-bound document the author simply
 * turns the guide off.
 */
export const GUTTER_MARGIN_MM = 15;
/** Bleed: artwork extended past the trim so a 1mm cutting drift shows no white. */
export const BLEED_MM = 3;
/** Length of each crop-mark tick, measured outward from the trim corner. */
export const CROP_MARK_LENGTH_MM = 4;
/** Gap between the trim corner and the start of its crop mark. */
export const CROP_MARK_GAP_MM = 1.5;

export interface PrintGuideSettings {
  /** Dotted inner boundary marking the safe type area. */
  safe: boolean;
  /** Binding-safe band on the right edge. */
  gutter: boolean;
  /** Bleed area plus corner crop marks. */
  bleed: boolean;
}

export const DEFAULT_PRINT_GUIDES: PrintGuideSettings = {
  safe: false,
  gutter: false,
  bleed: false,
};

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GuideGeometry {
  /** Inner boundary of the type area (dotted). */
  safe: Box;
  /** Binding band against the right edge of the page. */
  gutter: Box;
  /** Area outside the trim edge, up to the bleed line. */
  bleed: Box;
  /** The trim box itself, in page coordinates. */
  trim: Box;
  /** Eight corner ticks (two per corner) drawn outside the bleed. */
  cropMarks: Box[];
  /** The innermost rectangle an element may safely occupy. */
  content: Box;
  margins: { safe: number; gutter: number; bleed: number };
}

/**
 * All guide geometry for one page size.
 *
 * Returned whole (rather than one call per guide) so a page can be painted with
 * a single derived object and the numbers stay internally consistent.
 */
export function guideGeometry(
  size: { w: number; h: number },
  settings: PrintGuideSettings = DEFAULT_PRINT_GUIDES,
  overrides: { safe?: number; gutter?: number; bleed?: number } = {},
): GuideGeometry {
  const safe = Math.max(2, overrides.safe ?? SAFE_MARGIN_MM);
  const gutter = Math.max(0, overrides.gutter ?? GUTTER_MARGIN_MM);
  const bleed = Math.max(0, overrides.bleed ?? BLEED_MM);

  const trim: Box = { x: 0, y: 0, w: size.w, h: size.h };
  const safeBox: Box = {
    x: safe,
    y: safe,
    w: Math.max(0, size.w - safe * 2),
    h: Math.max(0, size.h - safe * 2),
  };
  const gutterBox: Box = {
    x: Math.max(0, size.w - gutter),
    y: 0,
    w: Math.min(gutter, size.w),
    h: size.h,
  };
  const bleedBox: Box = {
    x: -bleed,
    y: -bleed,
    w: size.w + bleed * 2,
    h: size.h + bleed * 2,
  };

  const gap = CROP_MARK_GAP_MM;
  const len = CROP_MARK_LENGTH_MM;
  const stroke = 0.2;
  const cropMarks: Box[] =
    bleed <= 0 || !settings.bleed
      ? []
      : [
          // top-left
          {
            x: -bleed - gap - len,
            y: -bleed - gap - stroke,
            w: len,
            h: stroke,
          },
          {
            x: -bleed - gap - stroke,
            y: -bleed - gap - len,
            w: stroke,
            h: len,
          },
          // top-right
          {
            x: size.w + bleed + gap,
            y: -bleed - gap - stroke,
            w: len,
            h: stroke,
          },
          { x: size.w + bleed + gap, y: -bleed - gap - len, w: stroke, h: len },
          // bottom-left
          { x: -bleed - gap - len, y: size.h + bleed + gap, w: len, h: stroke },
          {
            x: -bleed - gap - stroke,
            y: size.h + bleed + gap,
            w: stroke,
            h: len,
          },
          // bottom-right
          {
            x: size.w + bleed + gap,
            y: size.h + bleed + gap,
            w: len,
            h: stroke,
          },
          {
            x: size.w + bleed + gap,
            y: size.h + bleed + gap,
            w: stroke,
            h: len,
          },
        ];

  // The binding band eats into the type area, so the safe content rectangle is
  // the safe box minus whatever the gutter overlaps.
  const contentRight = Math.min(safeBox.x + safeBox.w, gutterBox.x);
  const content: Box = {
    x: safeBox.x,
    y: safeBox.y,
    w: Math.max(0, contentRight - safeBox.x),
    h: safeBox.h,
  };

  return {
    safe: safeBox,
    gutter: gutterBox,
    bleed: bleedBox,
    trim,
    cropMarks,
    content,
    margins: { safe, gutter, bleed },
  };
}

export interface BoxLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Do two rectangles overlap at all (edges touching do not count)? */
export function boxesOverlap(a: BoxLike, b: BoxLike): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

/** Is any part of `box` outside `frame`? */
export function escapesFrame(box: BoxLike, frame: BoxLike): boolean {
  return (
    box.x < frame.x - 0.01 ||
    box.y < frame.y - 0.01 ||
    box.x + box.w > frame.x + frame.w + 0.01 ||
    box.y + box.h > frame.y + frame.h + 0.01
  );
}

/**
 * Top-level elements that intrude into the binding band.
 *
 * Page-wide background art (a full-width header strip, a footer bar) is
 * deliberately excluded: those are meant to bleed to the edge, and flagging them
 * would make the guide useless by crying wolf on every page.
 */
export function elementsInGutter(
  page: Page,
  size: { w: number; h: number },
  gutterWidth = GUTTER_MARGIN_MM,
): CanvasEl[] {
  const band: Box = {
    x: Math.max(0, size.w - gutterWidth),
    y: 0,
    w: gutterWidth,
    h: size.h,
  };
  return (page.elements ?? []).filter((el) => {
    if (el.hidden || el.type === "group") return false;
    const box = { x: el.x, y: el.y, w: el.w, h: el.h };
    // Full-width or near-full-width furniture is page decoration, not content.
    if (box.w >= size.w - 4) return false;
    return boxesOverlap(box, band);
  });
}

/** Elements that reach outside the safe type area but not into full bleed. */
export function elementsOutsideSafe(
  page: Page,
  size: { w: number; h: number },
  settings: PrintGuideSettings = DEFAULT_PRINT_GUIDES,
): CanvasEl[] {
  const geometry = guideGeometry(size, settings);
  return (page.elements ?? []).filter((el) => {
    if (el.hidden || el.type === "group") return false;
    return escapesFrame(
      { x: el.x, y: el.y, w: el.w, h: el.h },
      geometry.content,
    );
  });
}

/** A printable page with no visible content — usually a stray blank sheet. */
export function isEmptyPage(page: Page): boolean {
  const visible = (page.elements ?? []).filter((el) => !el.hidden);
  if (!visible.length) return true;
  // A page holding nothing but an empty text box is still blank on paper.
  return visible.every(
    (el) =>
      (el.type === "text" || el.type === "box" || el.type === "stat") &&
      !String(el.content ?? "").trim(),
  );
}

/** Points per inch → pixels of artwork needed for `mm` at print quality. */
export function requiredPixels(mm: number, dpi: number): number {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

/** Effective resolution (dots per inch) of an image placed at a given size. */
export function effectiveDpi(
  pixels: { w: number; h: number },
  placedMm: { w: number; h: number },
): number {
  const widthIn = Math.max(0.01, placedMm.w / 25.4);
  const heightIn = Math.max(0.01, placedMm.h / 25.4);
  // The worst axis is what a printer will show.
  return Math.floor(Math.min(pixels.w / widthIn, pixels.h / heightIn));
}
