/**
 * Arabic text utilities.
 *
 * These are pure, dependency-free string helpers shared by the canvas renderer,
 * the properties panel and the HTML exporter, so identical input always yields
 * identical output in every surface.
 */

/** Arabic-Indic (٠-٩) and the Eastern Arabic variant used in some Gulf documents. */
const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export type Numerals = "western" | "arabic";

/** Convert Western digits to Arabic-Indic. Non-digits pass through untouched. */
export function toArabicDigits(text: string): string {
  return String(text ?? "").replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

/** Convert Arabic-Indic digits back to Western. */
export function toWesternDigits(text: string): string {
  return String(text ?? "").replace(/[٠-٩]/g, (d) =>
    String(AR_DIGITS.indexOf(d)),
  );
}

/**
 * Force the chosen numeral system.
 *
 * Converts in both directions: content pasted from an Arabic source is often
 * Arabic-Indic already, so a one-way converter would make the "western" choice
 * silently do nothing for exactly the documents that need it most.
 */
export function applyNumerals(
  text: string,
  numerals: Numerals | undefined,
): string {
  const src = String(text ?? "");
  if (numerals === "arabic") return toArabicDigits(src);
  if (numerals === "western") return toWesternDigits(src);
  return src;
}

/**
 * Arabic letter forms differ by context, so a naive uppercase is meaningless and
 * `text-transform` does nothing. "Highlight" is offered instead: the first
 * letter of each word is kept, the rest is left intact — matching how Arabic
 * headings are emphasised with weight, not case.
 */
export function arabicHeadline(text: string): string {
  return String(text ?? "")
    .split("\n")
    .map((line) =>
      line
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0) + word.slice(1))
        .join(" "),
    )
    .join("\n");
}

/**
 * Remove Arabic diacritics (tashkeel) and tatweel.
 *
 * Exporters that rasterise or convert to Word/PowerPoint cannot always carry
 * combining marks across, and long tatweel runs break measurement; offering
 * "بدون تشكيل" lets the author emit a clean copy.
 */
export function stripTashkeel(text: string): string {
  return String(text ?? "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "");
}

/** Arabic comma/semicolon/question marks are preferred in running Arabic text. */
export function toArabicPunctuation(text: string): string {
  return String(text ?? "")
    .replace(/\s*,\s*/g, "، ")
    .replace(/\s*;\s*/g, "؛ ")
    .replace(/\s*\?\s*/g, "؟ ");
}

/**
 * Join a hard-wrapped Arabic paragraph back into one flow.
 *
 * Imported text often arrives with a newline every ~70 characters (email, PDF
 * copy-paste). Those breaks are not authorial and read as ragged columns in a
 * report, so they are collapsed while genuine paragraph breaks (blank lines)
 * survive.
 */
export function unwrapParagraphs(text: string): string {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Does this text contain Arabic script at all?
 *
 * Used to scope the Arabic-specific rules (the leading floor, elongation) so a
 * Latin-only caption keeps the metrics its author chose.
 */
export function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
    String(text ?? ""),
  );
}

/** A non-breaking space keeps a number's unit and its digits on one line. */
export function bindUnits(text: string): string {
  return String(text ?? "").replace(
    /([0-9\u0660-\u0669]+)\s+(ريال|درهم|دينار|دولار|مليون|مليار|ألف|%|٪|كم|كجم|مم|سم|م²|م3)/g,
    "$1\u00A0$2",
  );
}

export interface NormalizeOptions {
  numerals?: Numerals;
  stripTashkeel?: boolean;
  unwrap?: boolean;
  bindUnits?: boolean;
  punctuation?: boolean;
}

/** Apply the chosen text clean-up steps in a fixed, predictable order. */
export function normalizeArabic(
  text: string,
  opts: NormalizeOptions = {},
): string {
  let out = String(text ?? "");
  if (opts.punctuation) out = toArabicPunctuation(out);
  if (opts.unwrap) out = unwrapParagraphs(out);
  if (opts.stripTashkeel) out = stripTashkeel(out);
  if (opts.bindUnits) out = bindUnits(out);
  if (opts.numerals) out = applyNumerals(out, opts.numerals);
  return out;
}

/**
 * Count lines a text block will occupy at a given font size.
 *
 * Deliberately layout-free (average glyph advance, no DOM measurement) because
 * it runs on every render and inside the auto-fit search.
 */
export function estimateLines(
  text: string,
  boxWidthMm: number,
  fontSizePt: number,
): number {
  const content = String(text ?? "");
  if (!content.trim()) return 0;
  // Average Arabic glyph advance is ≈0.5em; 1pt ≈ 0.3528mm.
  const charWidthMm = fontSizePt * 0.3528 * 0.5;
  const perLine = Math.max(
    1,
    Math.floor(boxWidthMm / Math.max(0.1, charWidthMm)),
  );
  return content.split("\n").reduce((total, line) => {
    const len = line.trim().length;
    return total + (len === 0 ? 1 : Math.ceil(len / perLine));
  }, 0);
}

/**
 * Count paragraphs (blank-line-separated runs) in a block.
 *
 * Used to add the inter-paragraph gaps to the height estimate: a two-paragraph
 * block is taller than the same number of lines run together, and auto-fit has
 * to know that or it shrinks to the wrong size.
 */
export function countParagraphs(text: string): number {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0).length;
}

export type TextFit = "clip" | "shrink" | "grow";

/**
 * Presets for the gap between paragraphs, counted in blank lines.
 *
 * Whole lines on purpose: the block renders with `white-space: pre-wrap`, so a
 * gap is literally an extra newline. Using whole steps keeps what the author
 * sees identical to what `fitFontSize` budgets for, instead of the two drifting
 * apart by a fraction of a line.
 */
export const PARAGRAPH_SPACINGS: {
  id: string;
  label: string;
  value: number;
}[] = [
  { id: "none", label: "بلا فراغ", value: 0 },
  { id: "one", label: "فراغ سطر", value: 1 },
  { id: "two", label: "فراغ سطرين", value: 2 },
];

/**
 * Normalise the blank-line gap between paragraphs to `lines` extra blank lines.
 *
 * A paragraph break already renders as one blank line (`\n\n` between two
 * non-empty lines under `white-space: pre-wrap`), so `lines` counts only the
 * *additional* ones: the run becomes `lines + 2` newlines. Whole lines on
 * purpose — a gap here is literally a newline, and whole steps keep what the
 * author sees identical to what `fitFontSize` budgets for, instead of the two
 * drifting apart by a fraction of a line.
 *
 * Runs on the display string only. `el.content` keeps the author's own
 * newlines, so returning the preset to "بلا فراغ" restores the original text
 * rather than leaving the padding baked into what they typed.
 */
export function withParagraphSpacing(text: string, lines: number): string {
  const extra = Math.round(lines);
  if (!extra || extra < 1) return text;
  const gap = "\n".repeat(Math.min(6, extra + 2));
  return text.replace(/\n{2,}/g, gap);
}

/**
 * Largest font size (pt) at which `text` still fits `box`, within [minScale, 1]
 * of the requested size (or above it, for `grow`).
 *
 * Long Arabic paragraphs are the common failure here: imported copy carries hard
 * line breaks and verbatim prose, and a fixed point size pushes the tail past the
 * element's bottom edge where it is silently clipped. Scaling the size down keeps
 * the whole paragraph visible and readable.
 *
 * The estimate uses average glyph advance, so it is approximate by design — it
 * runs on every render and must stay layout-free. `grow` is capped at 1.6× so a
 * single short word cannot balloon to fill a whole page.
 */
export function fitFontSize(
  text: string,
  box: { w: number; h: number },
  fontSizePt: number,
  lineHeight = 1.45,
  mode: TextFit = "shrink",
  paragraphSpacing = 0,
): number {
  const base = Math.max(1, Number(fontSizePt) || 14);
  if (mode === "clip") return base;
  if (!String(text ?? "").trim()) return base;

  // Leading beyond the visible lines. A `\n\n` paragraph break renders as one
  // blank line, and each extra step adds one more, so `paragraphSpacing` of n
  // contributes n + 1 lines per boundary. Deriving it here rather than counting
  // `\n\n` runs keeps this aligned with `withParagraphSpacing`.
  const fits = (pt: number) =>
    measureTextHeight(text, box.w, pt, lineHeight, paragraphSpacing) <=
    box.h + 0.4;

  if (mode === "shrink") {
    if (fits(base)) return base;
    const min = base * 0.5;
    // Six halvings land inside 0.1pt, well below what the eye can resolve.
    let lo = min;
    let hi = base;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    return Math.max(min, Math.round(lo * 10) / 10);
  }

  const cap = base * 1.6;
  let best = base;
  for (let pt = base + 0.5; pt <= cap; pt += 0.5) {
    if (fits(pt)) best = pt;
    else break;
  }
  return Math.round(best * 10) / 10;
}

/**
 * Height in mm a text block occupies at a given point size.
 *
 * This is the single budget the text-box modes reason about: `autoHeight` grows
 * the box to it, `fixed` compares it against the author's box to report
 * overflow, and `fit` search-shrinks against it. Sharing one function is what
 * keeps "the box fits" and "the text fits" from disagreeing.
 */
export function measureTextHeight(
  text: string,
  boxWidthMm: number,
  fontSizePt: number,
  lineHeight = 1.45,
  paragraphSpacing = 0,
): number {
  const lines = estimateLines(text, boxWidthMm, fontSizePt);
  if (lines === 0) return 0;
  const boundaries = Math.max(0, countParagraphs(text) - 1);
  const extraGapLines = boundaries * (Math.max(0, paragraphSpacing) + 1);
  return (lines + extraGapLines) * fontSizePt * 0.3528 * (lineHeight || 1.45);
}

/**
 * Smallest box width (mm) that keeps a block's line count from growing.
 *
 * `autoWidth` has to stop somewhere: without a cap, one long paragraph would
 * expand to the page width and every later line would still wrap, so the search
 * targets the width at which the current wrapping is already as good as it gets.
 */
export function measureTextWidth(
  text: string,
  fontSizePt: number,
  maxWidthMm: number,
): number {
  const longest = String(text ?? "")
    .split("\n")
    .reduce((max, line) => Math.max(max, line.trim().length), 0);
  if (longest === 0) return maxWidthMm;
  // Average Arabic glyph advance is ≈0.5em; 1pt ≈ 0.3528mm.
  const perChar = fontSizePt * 0.3528 * 0.5;
  return Math.min(maxWidthMm, longest * perChar);
}

/**
 * Line-height presets that suit Arabic ascenders/descenders.
 *
 * Nothing here goes below 1.5: Arabic tall letters (أ إ ل) reach above the Latin
 * em box and the descenders of ج ح خ ر و ي reach below it, so a tighter leading
 * makes consecutive lines overlap — the "cut letters" authors report. The floor
 * is enforced again at render time (`arabicSafeLineHeight`), so a legacy
 * document carrying 1.2 is still painted correctly.
 */
export const LINE_HEIGHTS: { id: string; label: string; value: number }[] = [
  { id: "tight", label: "متراص", value: 1.5 },
  { id: "snug", label: "قريب", value: 1.65 },
  { id: "normal", label: "عادي", value: 1.8 },
  { id: "airy", label: "واسع", value: 2 },
  { id: "loose", label: "فاصل", value: 2.2 },
];

/** Letter-spacing presets, in mm — Arabic joins letters, so values stay small. */
export const LETTER_SPACINGS: { id: string; label: string; value: number }[] = [
  { id: "none", label: "طبيعي", value: 0 },
  { id: "slight", label: "خفيف", value: 0.15 },
  { id: "medium", label: "متوسط", value: 0.35 },
  { id: "wide", label: "واسع", value: 0.6 },
];

/** Numeral systems offered in the properties panel. */
export const NUMERAL_OPTIONS: {
  id: Numerals;
  label: string;
  sample: string;
}[] = [
  { id: "western", label: "أرقام لاتينية", sample: "2026" },
  { id: "arabic", label: "أرقام عربية", sample: "٢٠٢٦" },
];

/** Text-overflow strategies. `shrink` is what makes long Arabic strings safe. */
export const TEXT_FIT_OPTIONS: { id: TextFit; label: string; hint: string }[] =
  [
    { id: "clip", label: "قص", hint: "اترك النص يتجاوز دون تصغير" },
    { id: "shrink", label: "تصغير تلقائي", hint: "صغّر الخط حتى يتسع النص" },
    { id: "grow", label: "تكبير تلقائي", hint: "كبّر الخط ليملأ المساحة" },
  ];
