import { AUTO_TEXT_TYPES, type CanvasEl, type TextBoxMode } from "./model";
import {
  fitFontSize,
  measureTextHeight,
  measureTextWidth,
  normalizeArabic,
  withParagraphSpacing,
} from "./arabic";

/** Types whose font size may be auto-fitted to the element box. */
const FIT_TYPES = new Set(AUTO_TEXT_TYPES);

export interface PreparedText {
  /** Content after numeral/tashkeel/line-break normalisation. */
  text: string;
  /** Font size to render at, after any auto-fit. */
  fontSize: number;
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
export function prepareText(el: CanvasEl): PreparedText {
  const s = el.style || {};
  const normalized = normalizeArabic(String(el.content ?? ""), {
    numerals: s.numerals,
    stripTashkeel: s.stripTashkeel,
    unwrap: !s.preserveBreaks,
    bindUnits: s.bindUnits,
    punctuation: s.arabicPunctuation,
  });
  const text = withParagraphSpacing(normalized, s.paragraphSpacing || 0);
  const base = Number(s.fontSize) || 14;
  const lineHeight = s.lineHeight || 1.45;
  const paragraphSpacing = s.paragraphSpacing || 0;
  const padding = textPadding(el);
  const innerW = Math.max(1, el.w - padding * 2);
  const innerH = Math.max(1, el.h - padding * 2);
  const mode = textBoxMode(el);

  if (!FIT_TYPES.has(el.type)) {
    return {
      text,
      fontSize: base,
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
          text,
          { w: innerW, h: innerH },
          base,
          lineHeight,
          legacyFit,
          paragraphSpacing,
        )
      : base;

  const neededHeight =
    measureTextHeight(text, innerW, fontSize, lineHeight, paragraphSpacing) +
    padding * 2;
  const neededWidth =
    mode === "autoWidth"
      ? measureTextWidth(text, fontSize, el.w) + padding * 2
      : el.w;

  const overflow = fontSize < base - 0.05;
  // Only a fixed box can visibly cut text: every other mode resizes to fit, so
  // reporting clipping there would be a false alarm.
  const clipped = mode === "fixed" && neededHeight > el.h + 0.4;

  return { text, fontSize, overflow, neededHeight, neededWidth, clipped };
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
