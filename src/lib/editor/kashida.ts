/**
 * Kashida (تطويل) justification for formal Arabic prose.
 *
 * Arabic is meant to be justified with *elongation* — a connecting stroke drawn
 * inside a word — not with the enlarged word gaps that `text-align: justify`
 * produces. Word spacing is a Latin convention: in a formal Arabic document a
 * gap-justified paragraph reads as broken typesetting, because Arabic words are
 * joined by meaning and the whitespace is meant to stay constant.
 *
 * This module implements the classic rule set used by Arabic typesetting
 * engines:
 *
 *   1. Elongation only happens at a *connecting* gap — between two letters that
 *      BOTH join on both sides (dual-joining). `ا د ذ ر ز و ة` never join
 *      forward, `أ إ آ ء` never join at all, so a stroke placed next to them
 *      would be a typographic error rather than a stretch.
 *   2. Every elongation run stops short of the word's end (تطويل is not written
 *      on the final letter) and never crosses a space.
 *   3. The stretch is distributed as evenly as possible across all eligible gaps
 *      in the line, capped per gap (`maxPerGap`) so a two-word line does not
 *      grow one gigantic stroke.
 *   4. The last line of a paragraph is not stretched at all — it sits flush to
 *      the right, exactly as `justifyLastLine: "start"` already specifies.
 *   5. A line that is *already* full is never modified: kashida is added only
 *      while a line is short of the target width, and never by more than the
 *      space that is genuinely missing.
 *
 * The target width is reached through the caller's own measure function — the
 * same estimate the editor uses to size a text box — so "it fits" means the
 * same thing here as it does everywhere else in the document.
 *
 * The rendered stroke itself is the tatweel character (U+0640) — the character
 * Arabic script reserves for exactly this, and the one every text engine and
 * PDF pipeline renders as a connecting stroke without extra fonts or markup.
 *
 * Everything here is pure string arithmetic over an abstract "advance" unit, so
 * it runs on the canvas, in the properties panel preview, and in HTML/DOCX
 * export with the same result, and it is testable without a browser.
 */

/**
 * Characters that join on BOTH sides — the only legal kashida positions.
 * Arabic presentation-forms range is included for text pasted from old files.
 */
const DUAL_JOINING = new Set(
  [
    "ب",
    "ت",
    "ث",
    "ج",
    "ح",
    "خ",
    "س",
    "ش",
    "ص",
    "ض",
    "ط",
    "ظ",
    "ع",
    "غ",
    "ف",
    "ق",
    "ك",
    "ل",
    "م",
    "ن",
    "ه",
    "ي",
    "ى",
    "ئ",
    "پ",
    "چ",
    "ژ",
    "گ",
    "ﻻ",
    "ﻷ",
    "ﻹ",
  ].map((c) => c),
);

/**
 * Arabic letters, including the presentation forms. Checked by code point:
 * U+0640 (tatweel) sits inside the nominal-letter block but is a stroke, not a
 * letter, and must never be treated as one.
 */
export function isArabicLetter(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0x0640) return false;
  if (code >= 0x0621 && code <= 0x064a) return true;
  if (code >= 0x066e && code <= 0x06d3) return true;
  if (code >= 0x06f0 && code <= 0x06f9) return true;
  if (code >= 0xfb50 && code <= 0xfdff) return true;
  if (code >= 0xfe70 && code <= 0xfeff) return true;
  return false;
}

/**
 * Combining marks, tatweel and zero-width controls carry no advance of their
 * own, so they are never a kashida position — checked by code point rather than
 * a character class, which also keeps this off the linter's "combined character
 * in a character class" rule (these ARE combining marks; that is the point).
 */
function isNonAdvancing(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0x0640) return true; // tatweel itself
  if (code >= 0x064b && code <= 0x0652) return true; // harakat
  if (code === 0x0670) return true; // superscript alef
  if (code >= 0x06d6 && code <= 0x06ed) return true; // Quranic marks
  if (code >= 0x200b && code <= 0x200f) return true; // zero-width controls
  if (code === 0x061c) return true; // Arabic letter mark
  return false;
}

const TATWEEL = "\u0640";

/**
 * Is the gap between `left` and `right` a legal place for a kashida stroke?
 *
 * Presentation forms are decomposed to their nominal letter first, so a glyph
 * copied out of an older document is judged by the letter it stands for.
 */
function joins(left: string, right: string): boolean {
  if (!left || !right) return false;
  return (
    DUAL_JOINING.has(normalizeForm(left)) &&
    DUAL_JOINING.has(normalizeForm(right))
  );
}

/**
 * The nominal letter behind an Arabic glyph.
 *
 * Presentation forms carry the joining state of the letter they came from, but
 * not its identity as a plain codepoint. NASAQ's own text always uses nominal
 * letters; this mapping exists so text pasted out of older systems, where
 * «ـبـ» may arrive as U+FE91 etc., is still judged correctly.
 */
const PRESENTATION_FORMS: Record<string, string> = {
  ﺀ: "ء",
  ﺁ: "آ",
  ﺂ: "آ",
  ﺃ: "أ",
  ﺄ: "أ",
  ﺅ: "ؤ",
  ﺆ: "ؤ",
  ﺇ: "إ",
  ﺈ: "إ",
  ﺉ: "ئ",
  ﺊ: "ئ",
  ﺋ: "ئ",
  ﺌ: "ئ",
  ﺍ: "ا",
  ﺎ: "ا",
  ﺏ: "ب",
  ﺐ: "ب",
  ﺑ: "ب",
  ﺒ: "ب",
  ﺓ: "ة",
  ﺔ: "ة",
  ﺕ: "ت",
  ﺖ: "ت",
  ﺗ: "ت",
  ﺘ: "ت",
  ﺙ: "ث",
  ﺚ: "ث",
  ﺛ: "ث",
  ﺜ: "ث",
  ﺝ: "ج",
  ﺞ: "ج",
  ﺟ: "ج",
  ﺠ: "ج",
  ﺡ: "ح",
  ﺢ: "ح",
  ﺣ: "ح",
  ﺤ: "ح",
  ﺥ: "خ",
  ﺦ: "خ",
  ﺧ: "خ",
  ﺨ: "خ",
  ﺩ: "د",
  ﺪ: "د",
  ﺫ: "ذ",
  ﺬ: "ذ",
  ﺭ: "ر",
  ﺮ: "ر",
  ﺯ: "ز",
  ﺰ: "ز",
  ﺱ: "س",
  ﺲ: "س",
  ﺳ: "س",
  ﺴ: "س",
  ﺵ: "ش",
  ﺶ: "ش",
  ﺷ: "ش",
  ﺸ: "ش",
  ﺹ: "ص",
  ﺺ: "ص",
  ﺻ: "ص",
  ﺼ: "ص",
  ﺽ: "ض",
  ﺾ: "ض",
  ﺿ: "ض",
  ﻀ: "ض",
  ﻁ: "ط",
  ﻂ: "ط",
  ﻃ: "ط",
  ﻄ: "ط",
  ﻅ: "ظ",
  ﻆ: "ظ",
  ﻇ: "ظ",
  ﻈ: "ظ",
  ﻉ: "ع",
  ﻊ: "ع",
  ﻋ: "ع",
  ﻌ: "ع",
  ﻍ: "غ",
  ﻎ: "غ",
  ﻏ: "غ",
  ﻐ: "غ",
  ﻑ: "ف",
  ﻒ: "ف",
  ﻓ: "ف",
  ﻔ: "ف",
  ﻕ: "ق",
  ﻖ: "ق",
  ﻗ: "ق",
  ﻘ: "ق",
  ﻙ: "ك",
  ﻚ: "ك",
  ﻛ: "ك",
  ﻜ: "ك",
  ﻝ: "ل",
  ﻞ: "ل",
  ﻟ: "ل",
  ﻠ: "ل",
  ﻡ: "م",
  ﻢ: "م",
  ﻣ: "م",
  ﻤ: "م",
  ﻥ: "ن",
  ﻦ: "ن",
  ﻧ: "ن",
  ﻨ: "ن",
  ﻩ: "ه",
  ﻪ: "ه",
  ﻫ: "ه",
  ﻬ: "ه",
  ﻭ: "و",
  ﻮ: "و",
  ﻯ: "ى",
  ﻰ: "ى",
  ﻱ: "ي",
  ﻲ: "ي",
  ﻳ: "ي",
  ﻴ: "ي",
  ﻵ: "لا",
  ﻶ: "لا",
  ﻷ: "لأ",
  ﻸ: "لأ",
  ﻹ: "لإ",
  ﻺ: "لإ",
  ﻻ: "لا",
  ﻼ: "لا",
};

function normalizeForm(ch: string): string {
  return PRESENTATION_FORMS[ch] ?? ch;
}

/**
 * Indices inside `word` where a tatweel may be inserted (0 = before the first
 * letter, `word.length` = after the last). Only strictly INSIDE runs of
 * dual-joining letters qualify, which automatically excludes word edges and any
 * position that would follow a non-joining letter.
 */
export function kashidaSlots(word: string): number[] {
  const slots: number[] = [];
  if (!word || word.length < 3) return slots;
  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1];
    const next = word[i];
    // Never place a stroke where a mark or an existing tatweel already sits.
    if (!prev || !next) continue;
    if (isNonAdvancing(prev)) continue;
    if (joins(prev, next)) slots.push(i);
  }
  // Every returned index is interior by construction, so the stroke always has
  // a letter on both sides — which is what makes it a كشيدة and not a stray
  // dash. A gap that only joins on one side is never offered.
  return slots;
}

/**
 * Insert tatweel strokes into one word.
 *
 * `counts` is parallel to `slots`: how many strokes that particular gap
 * receives. A gap that gets none is left exactly as it was, so a word with one
 * stretchable pair is not rewritten at all when it needs no elongation.
 */
function stretchWord(word: string, slots: number[], counts: number[]): string {
  if (!slots.length) return word;
  let out = "";
  let cursor = 0;
  slots.forEach((slot, index) => {
    out += word.slice(cursor, slot);
    const count = counts[index] ?? 0;
    if (count > 0) out += TATWEEL.repeat(count);
    cursor = slot;
  });
  return out + word.slice(cursor);
}

/** Split text into words and the whitespace between them, losslessly. */
function splitWords(line: string): { word: string; space: string }[] {
  const parts: { word: string; space: string }[] = [];
  // Runs of non-space characters, each followed by the whitespace after it.
  const re = /(\S+)(\s*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    parts.push({ word: match[1], space: match[2] });
  }
  if (!parts.length && line.length) parts.push({ word: line, space: "" });
  return parts;
}

export interface KashidaMetrics {
  /** Advance of a kashida stroke, in the same unit as `measureWidth`. */
  tatweelWidth: number;
  /** Upper bound on strokes added per eligible gap. */
  maxPerGap?: number;
}

export interface KashidaOptions extends KashidaMetrics {
  /** Target content width for a full line (element width minus padding). */
  width: number;
  /**
   * Measure the advance of a string; defaults to a 0.5em-per-char estimate.
   *
   * One function measures everything — words, spaces, whole lines — so the
   * wrapper, the per-line deficit and the "does it still fit?" check can never
   * disagree with each other or with the box maths that sized the element.
   */
  measureWidth?: (text: string) => number;
  /**
   * Stretch the last line of a paragraph as well.
   *
   * Off by default — a closing line sits flush to the right, which is what
   * «إلى اليمين» (the default `justifyLastLine`) already means. Turning it on
   * can be worth it for a short centred-looking label the author wants blocky.
   */
  justifyLastLine?: boolean;
}

export interface KashidaResult {
  /** The justified text, ready to render/export verbatim. */
  text: string;
  /** Strokes added across the whole block. */
  added: number;
  /** True when at least one line was stretched. */
  applied: boolean;
}

/**
 * Break one paragraph into the lines it will occupy at `target` width.
 *
 * The wrap uses the caller's own measure function, i.e. the same estimate the
 * height maths and auto-fit use — so "which line is the last one" here agrees
 * with the line count the box was sized against. Rebuilding lines collapses runs
 * of spaces to one, which only happens for text that actually wraps: text that
 * already fits is returned untouched, whitespace and all.
 */
function wrapParagraph(
  parts: { word: string; space: string }[],
  target: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let width = 0;
  const gap = measure(" ");
  for (const part of parts) {
    const advance = current.length
      ? gap + measure(part.word)
      : measure(part.word);
    if (current.length && width + advance > target + 0.001) {
      lines.push(current.join(" "));
      current = [part.word];
      width = measure(part.word);
      continue;
    }
    current.push(part.word);
    width += advance;
  }
  if (current.length) lines.push(current.join(" "));
  return lines.length ? lines : [""];
}

/**
 * Stretch the gap in one rendered line.
 *
 * Returns the line unchanged when it already fills its measure, when it has no
 * eligible gap, or when the missing space is smaller than a single stroke — a
 * line must never be pushed past the target.
 */
function justifyLine(
  line: string,
  options: {
    target: number;
    perGap: number;
    stroke: number;
    measure: (value: string) => number;
  },
): { text: string; added: number } {
  const parts = splitWords(line);
  if (parts.length < 2) return { text: line, added: 0 };

  const natural = options.measure(line);
  if (natural >= options.target) return { text: line, added: 0 };

  const slotMap = parts.map((part) => kashidaSlots(part.word));
  const slotTotal = slotMap.reduce((sum, list) => sum + list.length, 0);
  if (!slotTotal) return { text: line, added: 0 };

  /*
   * How many strokes fit in the space that is actually missing, capped per gap
   * so a short line with two long words cannot grow one absurd stroke.
   */
  const needed = options.target - natural;
  const budget = Math.min(
    options.perGap * slotTotal,
    Math.floor(needed / options.stroke),
  );
  if (budget < 1) return { text: line, added: 0 };

  /*
   * Even distribution: hand the strokes out one gap at a time, so any two
   * stretchable gaps in the line differ by at most one stroke. Ordering is
   * logical — in RTL the line's first word is its visually right-hand one — so
   * the extra strokes land where the eye starts.
   */
  const counts: number[] = [];
  let remaining = budget;
  let gaps = slotTotal;
  for (let i = 0; i < slotTotal; i++) {
    const share = Math.floor(remaining / gaps);
    counts.push(share);
    remaining -= share;
    gaps -= 1;
  }

  let cursor = 0;
  const text = parts
    .map((part, index) => {
      const slots = slotMap[index];
      if (!slots.length) return part.word + part.space;
      const slice = counts.slice(cursor, cursor + slots.length);
      cursor += slots.length;
      if (!slice.some((n) => n > 0)) return part.word + part.space;
      return stretchWord(part.word, slots, slice) + part.space;
    })
    .join("");

  return { text, added: budget };
}

/**
 * Justify a text block with kashida.
 *
 * Explicit line breaks are honoured, and each line is re-wrapped at `width`
 * first so the closing line of every paragraph can be recognised and left
 * flush. Lines that already fill their measure, lines with no dual-joining gap,
 * and lines whose missing space is smaller than one stroke are returned exactly
 * as they came in.
 */
export function justifyKashida(
  text: string,
  options: KashidaOptions,
): KashidaResult {
  const source = String(text ?? "");
  const target = Math.max(1, options.width || 1);
  const perGap = Math.max(0, options.maxPerGap ?? 6);
  const stroke = Math.max(0, options.tatweelWidth || 0);
  const measure =
    options.measureWidth ?? ((value: string) => value.length * stroke * 2);

  if (!source.trim() || stroke <= 0)
    return { text: source, added: 0, applied: false };

  let added = 0;
  let applied = false;

  const out = source.split("\n").map((segment) => {
    if (!segment.trim()) return segment;
    const lines = wrapParagraph(splitWords(segment), target, measure);
    const stretched = lines.map((line, index) => {
      const last = index === lines.length - 1;
      if (last && !options.justifyLastLine) return line;
      const result = justifyLine(line, { target, perGap, stroke, measure });
      if (result.added > 0) {
        added += result.added;
        applied = true;
      }
      return result.text;
    });
    return stretched.join("\n");
  });

  return { text: out.join("\n"), added, applied };
}

/** Default advance of one tatweel stroke at a given point size, in mm. */
export function tatweelWidthMm(fontSizePt: number): number {
  // A tatweel is roughly half an em wide in the Arabic families NASAQ ships.
  return Math.max(0.35, (Number(fontSizePt) || 14) * 0.3528 * 0.5);
}
