import { AUTO_TEXT_TYPES, type CanvasEl, type TextBoxMode } from "./model.ts";
import {
  estimateLines,
  fitFontSize,
  hasArabic,
  measureTextHeight,
  measureTextWidth,
  normalizeArabic,
  withParagraphSpacing,
} from "./arabic.ts";
import { resolveMacros, type MacroContext } from "./macros.ts";
import { justifyKashida, tatweelWidthMm } from "./kashida.ts";
import { arabicSafeLineHeight } from "./typography.ts";

/** Types whose font size may be auto-fitted to the element box. */
const FIT_TYPES = new Set(AUTO_TEXT_TYPES);

/**
 * Document facts a text element's macros resolve against.
 *
 * Held here rather than passed through every call site because `prepareText`
 * runs from the canvas, the properties panel and three exporters; each of them
 * already reaches the store, none of them should have to thread page numbers
 * through by hand. `editorTextContext()` in `store.ts` fills it in.
 */
let context: MacroContext = {};

/** Set the live macro context (page number/count, entity, transaction number). */
export function setTextContext(next: MacroContext | null): void {
  context = next ?? {};
}

/** The current context, for panels that want to preview a macro's value. */
export function getTextContext(): MacroContext {
  return context;
}

/**
 * Page facts a text element belongs to, for `{رقم_الصفحة_من_الكل}`.
 *
 * Passed per call rather than held in the ambient context because a document is
 * rendered whole: page 2 and page 9 resolve the same token differently in the
 * same paint pass, so the page number cannot be global. Surfaces that only ever
 * show the active page (the canvas, the properties panel) may omit it and fall
 * back to the ambient value in `context`.
 */
export interface PageContext {
  number: number;
  count: number;
}

export interface PreparedText {
  /** Content after numeral/tashkeel/line-break normalisation. */
  text: string;
  /** Font size to render at, after any auto-fit. */
  fontSize: number;
  /**
   * Leading to render at, after Arabic normalisation.
   *
   * Renderers must use THIS value rather than the raw style, so the canvas, the
   * measured box and every exporter agree on the height of a line.
   */
  lineHeight: number;
  /** True when auto-fit reduced the size, so the panel can flag it. */
  overflow: boolean;
  /** Height in mm the normalised block needs at `fontSize`, padding included. */
  neededHeight: number;
  /** Box width in mm the block wants, padding included (`autoWidth` only). */
  neededWidth: number;
  /** True when the content cannot fit the authored box and is visibly spilling. */
  clipped: boolean;
}

const DEFAULT_MODE: TextBoxMode = "autoHeight";

/** Text-box behaviour for an element, defaulting sensibly per type. */
export function textBoxMode(el: CanvasEl): TextBoxMode {
  const explicit = el.style?.textBoxMode;
  if (explicit) return explicit;
  // Prose grows; a stat tile or stamp is a designed frame the author sized on
  // purpose, so it stays put and reports overflow instead of resizing itself.
  if (el.type === "text" || el.type === "box") return DEFAULT_MODE;
  return "fixed";
}

/** Inner padding in mm for an element's text, per type. */
export function textPadding(el: CanvasEl): number {
  const s = el.style || {};
  if (s.padding != null) return Math.max(0, Number(s.padding) || 0);
  if (el.type === "box" || el.type === "stat") return 4;
  return 0;
}

/**
 * Resolve an element's text for rendering: apply its Arabic options, then size
 * the font and box according to its text-box mode.
 *
 * Shared by the canvas, the properties panel, the exporters and the HTML
 * writer so all of them derive the same string, the same size and the same box.
 * Implementing this twice is how the editor and an exported PDF drift apart.
 */
export function prepareText(el: CanvasEl, page?: PageContext): PreparedText {
  const s = el.style || {};
  /*
   * Order matters and is the contract every surface shares:
   *   macros → Arabic clean-up → paragraph gaps → kashida justification.
   *
   * Macros come first because they produce the digits the numeral style then
   * formats; kashida comes last because it has to see the final string, and it
   * only ever inserts tatweel characters, which the height estimate already
   * treats as zero-advance.
   */
  const expanded = resolveMacros(String(el.content ?? ""), {
    ...context,
    ...(page
      ? {
          pageNumber: page.number,
          pageCount: Math.max(page.number, page.count),
        }
      : null),
    numerals: s.numerals,
  });
  const normalized = normalizeArabic(expanded, {
    numerals: s.numerals,
    stripTashkeel: s.stripTashkeel,
    unwrap: !s.preserveBreaks,
    bindUnits: s.bindUnits,
    punctuation: s.arabicPunctuation,
  });
  const base = Number(s.fontSize) || 14;
  const paragraphSpacing = s.paragraphSpacing || 0;
  const spaced = withParagraphSpacing(normalized, paragraphSpacing);
  const padding = textPadding(el);
  const innerW = Math.max(1, el.w - padding * 2);
  const innerH = Math.max(1, el.h - padding * 2);
  const mode = textBoxMode(el);
  const lineHeight = resolveLineHeight(el, spaced, innerW, base);
  const justified = s.kashida
    ? justifyText(spaced, innerW, base, s.justifyLastLine !== "stretch")
    : spaced;

  if (!FIT_TYPES.has(el.type)) {
    return {
      text: justified,
      fontSize: base,
      lineHeight,
      overflow: false,
      neededHeight: el.h,
      neededWidth: el.w,
      clipped: false,
    };
  }

  // `fit` is the only mode that trades font size for space. The legacy
  // `textFit` values map onto it so projects authored before this existed keep
  // their behaviour: `shrink`/`grow` were an explicit authorial choice.
  const legacyFit = s.textFit || "clip";
  const fontSize =
    mode === "fit" || legacyFit === "shrink" || legacyFit === "grow"
      ? fitFontSize(
          justified,
          { w: innerW, h: innerH },
          base,
          lineHeight,
          legacyFit,
          paragraphSpacing,
        )
      : base;

  const neededHeight =
    measureTextHeight(
      justified,
      innerW,
      fontSize,
      lineHeight,
      paragraphSpacing,
    ) +
    padding * 2;
  const neededWidth =
    mode === "autoWidth"
      ? measureTextWidth(justified, fontSize, el.w) + padding * 2
      : el.w;

  const overflow = fontSize < base - 0.05;
  // Only a fixed box can visibly cut text: every other mode resizes to fit, so
  // reporting clipping there would be a false alarm.
  const clipped = mode === "fixed" && neededHeight > el.h + 0.4;

  return {
    text: justified,
    fontSize,
    lineHeight,
    overflow,
    neededHeight,
    neededWidth,
    clipped,
  };
}

/**
 * Leading for one text block.
 *
 * Arabic glyphs are taller than the Latin em box, so a paragraph set tighter
 * than `ARABIC_LINE_HEIGHT_FLOOR` renders with its lines touching — the tops of
 * أ إ ل and the descenders of ج ر و get shaved. The floor is applied to Arabic
 * text that occupies more than one line: a single-line title is left alone,
 * because a tight line box merely shifts it and nothing is cut.
 *
 * The stored style is never rewritten — the normalisation happens at render, so
 * opening an old document does not silently "fix" the author's numbers while a
 * new one is authored correctly from the start.
 */
function resolveLineHeight(
  el: CanvasEl,
  text: string,
  widthMm: number,
  fontSizePt: number,
): number {
  const requested =
    Number(el.style?.lineHeight) || (el.type === "stamp" ? 1.2 : 1.45);
  if (!hasArabic(text)) return requested;
  if (estimateLines(text, widthMm, fontSizePt) <= 1) return requested;
  /*
   * The floor is per FAMILY: Naskh faces (Amiri, Noto Naskh) need noticeably
   * more leading than Cairo or Tajawal to keep their ascenders and descenders
   * inside the line box, so "safe for Arabic" cannot be one number.
   */
  return arabicSafeLineHeight(requested, el.style?.fontFamily);
}

/**
 * Auto-kashida for one block.
 *
 * The measurement is the same 0.5em-per-character estimate the height and
 * auto-fit maths use, so the stretch targets the width the rest of the editor
 * already believes the line occupies — a kashida line and a measured line can
 * never disagree about whether the text fits.
 */
function justifyText(
  text: string,
  widthMm: number,
  fontSizePt: number,
  keepLastLineFlush: boolean,
): string {
  const em = fontSizePt * 0.3528;
  const result = justifyKashida(text, {
    width: widthMm,
    tatweelWidth: tatweelWidthMm(fontSizePt),
    maxPerGap: 6,
    justifyLastLine: !keepLastLineFlush,
    measureWidth: (value) => value.length * em * 0.5,
  });
  return result.text;
}

/**
 * The box an element should occupy after its text mode is applied.
 *
 * `null` means "leave the author's box alone". `autoHeight` grows downwards
 * only — shrinking back would make the box jump while the author types, and an
 * element that only ever grows is predictable. Text boxes may live outside the
 * page, so fitting never clamps them to page edges.
 */
export function resolveTextBox(el: CanvasEl): { w: number; h: number } | null {
  if (!FIT_TYPES.has(el.type)) return null;
  const prepared = prepareText(el);
  const mode = textBoxMode(el);
  if (mode === "autoHeight") {
    const h = Math.max(el.h, prepared.neededHeight + (el.style?.slackMm || 0));
    return h > el.h + 0.2 ? { w: el.w, h } : null;
  }
  if (mode === "autoWidth") {
    const w = Math.max(el.w, prepared.neededWidth);
    return w > el.w + 0.2 ? { w, h: el.h } : null;
  }
  return null;
}

/** Writing direction for an element's text, as a CSS value. */
export function textDirection(): "rtl" {
  return "rtl";
}
