/**
 * مولد عناوين الفقرات — the section-heading generator.
 *
 * A report heading is *design*, not just text: an institutional document uses a
 * band, a rule, a hanging index or a filled plate to tell the reader where a new
 * section starts. Writing that by hand every time is why reports drift out of
 * alignment, so the generator emits it as plain canvas elements instead.
 *
 * Contract (the part that makes this editable, not a picture):
 *   · every preset returns ORDINARY elements — `text` for the words, `box` for
 *     bands and rules;
 *   · coordinates are **relative to the heading's own box**, in millimetres, so
 *     the caller places the whole thing in one move;
 *   · nothing is grouped, locked or painted as an image, so the author can
 *     select the title, retype it, restyle the band and delete the ornament.
 *
 * ## One measurement, two consumers
 *
 * {@link headingMetrics} is the single source of geometry for both
 * {@link headingHeight} (how much room to reserve) and {@link buildHeading}
 * (where each part goes). They used to measure independently, which is how a
 * two-line title inside a numbered plate ended up taller than the height it had
 * reserved — the classic way a generated heading clips its own subtitle.
 *
 * Pure and browser-free: no store, no DOM, no path aliases — runnable under
 * `node --experimental-strip-types` like the rest of `src/lib/editor`.
 */

export type HeadingField = "title" | "subtitle" | "index";

export interface HeadingPreset {
  id: HeadingPresetId;
  /** Arabic label shown in the picker. */
  label: string;
  /** Short description of the visual idea. */
  hint: string;
  /** Fields the preset renders; drives which inputs the dialog shows. */
  fields: HeadingField[];
}

export type HeadingPresetId =
  | "side-bar"
  | "numbered-plate"
  | "under-rule"
  | "framed-card"
  | "split-band"
  | "ribbon"
  | "indexed-rule"
  | "corner-mark";

/** Every element the generator can emit, described before it exists. */
export type HeadingPart =
  | {
      kind: "text";
      role: HeadingField | "eyebrow";
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      style: Record<string, string | number>;
    }
  | {
      kind: "box";
      role: "band" | "rule" | "plate" | "accent";
      x: number;
      y: number;
      w: number;
      h: number;
      style: Record<string, string | number>;
    };

export interface HeadingInput {
  preset: HeadingPresetId;
  /** Heading box width in millimetres (usually the page's text column). */
  width: number;
  title: string;
  subtitle?: string;
  /** Section number, e.g. `03`. */
  index?: string;
  /** Small label above the title («محور الأداء» style eyebrow). */
  eyebrow?: string;
}

export interface HeadingPalette {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  surface: string;
}

/** Default institutional palette (matches the emerald/gold brand tokens). */
export const DEFAULT_HEADING_PALETTE: HeadingPalette = {
  primary: "#006C35",
  accent: "#C9A86A",
  ink: "#14281F",
  muted: "#5B6B62",
  surface: "#FFFFFF",
};

/**
 * The catalogue. Order matters: it is the order the picker shows, from the most
 * formal to the most editorial.
 */
export const HEADING_PRESETS: HeadingPreset[] = [
  {
    id: "side-bar",
    label: "شريط جانبي",
    hint: "عمود لوني سميك يسار العنوان — الأكثر استخداماً في التقارير الرسمية",
    fields: ["title", "subtitle"],
  },
  {
    id: "numbered-plate",
    label: "لوحة مرقّمة",
    hint: "مربع بلون الهوية يحمل الرقم، وعنوان بمحاذاته",
    fields: ["title", "subtitle", "index"],
  },
  {
    id: "under-rule",
    label: "خط سفلي",
    hint: "عنوان كبير مع خط رفيع تحته يمتد بعرض العمود",
    fields: ["title", "subtitle"],
  },
  {
    id: "framed-card",
    label: "بطاقة مؤطّرة",
    hint: "إطار كامل بخلفية فاتحة وحدّ علوي بلون الهوية",
    fields: ["title", "subtitle", "index"],
  },
  {
    id: "split-band",
    label: "شريط مجزّأ",
    hint: "شريط علوي مجزّأ بلونين يفصل العنوان عن المحتوى",
    fields: ["title", "subtitle"],
  },
  {
    id: "ribbon",
    label: "شريطة مائلة",
    hint: "كتلة لونية خفيفة خلف أول كلمة من العنوان",
    fields: ["title", "subtitle"],
  },
  {
    id: "indexed-rule",
    label: "ترقيم مع خط",
    hint: "رقم كبير بخط رفيع، والعنوان تحته بمحاذاة واحدة",
    fields: ["title", "subtitle", "index"],
  },
  {
    id: "corner-mark",
    label: "علامة ركنية",
    hint: "قوس لوني في الركن مع عنوان مضغوط — مثالي للأقسام الفرعية",
    fields: ["title", "subtitle"],
  },
];

const TITLE_FONT = 20;
const TITLE_LINE = 11;
const CORNER_TITLE_FONT = 17;
const CORNER_TITLE_LINE = 9.5;
const SUBTITLE_FONT = 9.5;
const SUBTITLE_LINE = 5.4;
const SUBTITLE_BLOCK = SUBTITLE_LINE + 2;
const EYEBROW_FONT = 7.4;
const EYEBROW_BLOCK = EYEBROW_FONT + 3.4;

/**
 * Measure how tall a title needs to be.
 *
 * Approximation, deliberately: the generator must lay out without a DOM. It
 * assumes ~0.52 em per Arabic glyph at the title size, which keeps a long
 * heading on two lines instead of overflowing its band.
 */
export function estimateTitleHeight(
  text: string,
  width: number,
  fontSize = TITLE_FONT,
  lineHeight = TITLE_LINE,
): number {
  const usable = Math.max(40, width);
  const perLine = Math.max(6, Math.floor((usable / fontSize) * 1.9));
  const lines = Math.max(1, Math.ceil(text.trim().length / perLine));
  return Math.max(lineHeight, lines * lineHeight);
}

export interface HeadingMetrics {
  /** Usable column width. */
  width: number;
  /** Width available to the title once the preset's own ornament is removed. */
  textWidth: number;
  /** Index plate size (numbered-plate only, 0 elsewhere). */
  plateSize: number;
  titleFont: number;
  titleLine: number;
  titleHeight: number;
  /** Height of the subtitle block; 0 when there is no subtitle. */
  subtitleHeight: number;
  /** Height of the eyebrow block; 0 when there is no eyebrow. */
  eyebrowHeight: number;
  /** Total height the preset needs. */
  height: number;
}

/**
 * The one measurement both the reservation and the layout read from.
 *
 * Derived entirely from the input, which is what makes
 * `headingHeight(input) >= every part's bottom` true by construction instead of
 * by coincidence.
 */
export function headingMetrics(input: HeadingInput): HeadingMetrics {
  const width = Math.max(60, input.width);
  const hasIndex = Boolean(input.index?.trim());
  const isCorner = input.preset === "corner-mark";
  const titleFont = isCorner ? CORNER_TITLE_FONT : TITLE_FONT;
  const titleLine = isCorner ? CORNER_TITLE_LINE : TITLE_LINE;

  // The number plate steals width from the title, which is exactly the case
  // that used to be measured twice with two different answers.
  const plateSize = hasIndex ? Math.min(18, Math.max(13, width * 0.12)) : 0;

  const textWidth =
    input.preset === "side-bar"
      ? width - 9
      : input.preset === "numbered-plate"
        ? width - plateSize - (hasIndex ? 5 : 0)
        : input.preset === "framed-card"
          ? width - 12
          : isCorner
            ? width - 4
            : width;

  const titleHeight = estimateTitleHeight(
    input.title.trim() || "عنوان الفقرة",
    textWidth,
    titleFont,
    titleLine,
  );
  const subtitleHeight = input.subtitle?.trim() ? SUBTITLE_BLOCK : 0;
  const eyebrowHeight = input.eyebrow?.trim() ? EYEBROW_BLOCK : 0;

  const body = eyebrowHeight + titleHeight + subtitleHeight;
  let height: number;
  switch (input.preset) {
    case "side-bar":
      height = Math.max(20, 2 + body + 3);
      break;
    case "numbered-plate":
      height = Math.max(plateSize + 1, 1 + body + 4);
      break;
    case "under-rule":
      // title → rule → (subtitle) with breathing room after the rule.
      height = Math.max(20, 1 + body + (subtitleHeight ? 4.3 : 2.9));
      break;
    case "framed-card":
      height = Math.max(26, 4.4 + body + 9);
      break;
    case "split-band":
      height = Math.max(20, 1.8 + 3 + body + 3);
      break;
    case "ribbon":
      height = Math.max(20, 1 + body + (subtitleHeight ? 3.8 : 2.4));
      break;
    case "indexed-rule":
      height = Math.max(24, (hasIndex ? 11 : 0) + 0.5 + 2.2 + body + 2);
      break;
    case "corner-mark":
      height = Math.max(18, 3 + body + 3);
      break;
  }

  return {
    width,
    textWidth,
    plateSize,
    titleFont,
    titleLine,
    titleHeight,
    subtitleHeight,
    eyebrowHeight,
    height,
  };
}

/** Total height the preset needs, so the caller can reserve space. */
export function headingHeight(input: HeadingInput): number {
  return headingMetrics(input).height;
}

function textPart(
  role: HeadingField | "eyebrow",
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  style: Record<string, string | number>,
): Extract<HeadingPart, { kind: "text" }> {
  return { kind: "text", role, x, y, w, h, text, style };
}

function boxPart(
  role: "band" | "rule" | "plate" | "accent",
  x: number,
  y: number,
  w: number,
  h: number,
  style: Record<string, string | number>,
): Extract<HeadingPart, { kind: "box" }> {
  return { kind: "box", role, x, y, w, h, style };
}

/**
 * Build the parts for one preset.
 *
 * Coordinates are millimetres relative to the heading's top-left. Every part is
 * placed from {@link headingMetrics}, so the union of them always fits
 * `metrics.height` — a caller that reserves that height never clips its own
 * heading.
 */
export function buildHeading(
  input: HeadingInput,
  palette: HeadingPalette = DEFAULT_HEADING_PALETTE,
): HeadingPart[] {
  const m = headingMetrics(input);
  const { width, textWidth, titleHeight, subtitleHeight, height } = m;
  const title = input.title.trim() || "عنوان الفقرة";
  const subtitle = input.subtitle?.trim() ?? "";
  const index = (input.index ?? "").trim();
  const eyebrow = input.eyebrow?.trim() ?? "";

  const titleStyle: Record<string, string | number> = {
    fontSize: m.titleFont,
    fontWeight: 800,
    color: palette.ink,
    textAlign: "right",
    lineHeight: 1.35,
  };
  const subtitleStyle: Record<string, string | number> = {
    fontSize: SUBTITLE_FONT,
    fontWeight: 500,
    color: palette.muted,
    textAlign: "right",
    lineHeight: 1.6,
  };
  const eyebrowStyle: Record<string, string | number> = {
    fontSize: EYEBROW_FONT,
    fontWeight: 700,
    color: palette.accent,
    textAlign: "right",
    letterSpacing: 0.4,
  };

  const parts: HeadingPart[] = [];
  /** Left edge of the text column for this preset. */
  const textX =
    input.preset === "side-bar"
      ? 7
      : input.preset === "framed-card"
        ? 6
        : 0;

  switch (input.preset) {
    case "side-bar": {
      parts.push(boxPart("band", 0, 0, 3.2, height, { fill: palette.primary, radius: 0 }));
      let y = 2;
      if (eyebrow) {
        parts.push(textPart("eyebrow", textX, y, textWidth, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", textX, y, textWidth, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", textX, y, textWidth, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
    case "numbered-plate": {
      const plate = m.plateSize;
      if (index) {
        parts.push(
          boxPart("plate", width - plate, 0, plate, plate, { fill: palette.primary, radius: 2 }),
        );
        parts.push(
          textPart("index", width - plate, 0, plate, plate, index, {
            fontSize: 12,
            fontWeight: 800,
            color: "#FFFFFF",
            textAlign: "center",
          }),
        );
      }
      let y = 1;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, textWidth, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 0, y, textWidth, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, textWidth, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
    case "under-rule": {
      let y = 1;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, width, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 0, y, width, titleHeight, title, titleStyle));
      y += titleHeight + 1.2;
      parts.push(boxPart("rule", 0, y, width, 0.7, { fill: palette.primary, radius: 0 }));
      parts.push(
        boxPart("accent", 0, y, Math.min(34, width * 0.28), 0.7, { fill: palette.accent, radius: 0 }),
      );
      if (subtitle) {
        parts.push(
          textPart("subtitle", 0, y + 2.4, width, subtitleHeight, subtitle, subtitleStyle),
        );
      }
      break;
    }
    case "framed-card": {
      parts.push(
        boxPart("plate", 0, 0, width, height, {
          fill: palette.surface,
          stroke: "#D9E2DC",
          strokeWidth: 0.4,
          radius: 2.4,
        }),
      );
      parts.push(boxPart("band", 0, 0, width, 1.6, { fill: palette.primary, radius: 2.4 }));
      let y = 4.4;
      if (eyebrow) {
        parts.push(textPart("eyebrow", textX, y, textWidth, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", textX, y, textWidth, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", textX, y, textWidth, subtitleHeight, subtitle, subtitleStyle));
      }
      if (index) {
        parts.push(
          textPart("index", width - 22, height - 8, 16, 6, index, {
            fontSize: 8.5,
            fontWeight: 800,
            color: palette.primary,
            textAlign: "left",
          }),
        );
      }
      break;
    }
    case "split-band": {
      const bandH = 1.8;
      parts.push(boxPart("band", 0, 0, width * 0.62, bandH, { fill: palette.primary, radius: 0 }));
      parts.push(
        boxPart("accent", width * 0.62, 0, width * 0.38, bandH, { fill: palette.accent, radius: 0 }),
      );
      let y = bandH + 3;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, width, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 0, y, width, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, width, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
    case "ribbon": {
      let y = 1;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, width, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      // The plate sits behind the first word, sized from that word's own length
      // so a short heading is not swamped by its own band.
      const firstWord = title.split(/\s+/)[0] ?? title;
      const ribbonW = Math.min(width * 0.7, Math.max(26, firstWord.length * 5.6 + 8));
      parts.push(
        boxPart("band", width - ribbonW, y, ribbonW, m.titleLine + 3.4, {
          fill: palette.primary,
          radius: 1.6,
          opacity: 0.14,
        }),
      );
      parts.push(
        boxPart("accent", width - ribbonW, y, 1.4, m.titleLine + 3.4, {
          fill: palette.primary,
          radius: 0,
        }),
      );
      parts.push(textPart("title", 0, y + 1.4, width, titleHeight, title, titleStyle));
      y += 1.4 + titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, width, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
    case "indexed-rule": {
      let y = 0;
      if (index) {
        parts.push(
          textPart("index", 0, y, width, 11, index, {
            fontSize: 16,
            fontWeight: 800,
            color: palette.accent,
            textAlign: "right",
            lineHeight: 1,
          }),
        );
        y += 11;
      }
      parts.push(boxPart("rule", 0, y, width, 0.5, { fill: "#D9E2DC", radius: 0 }));
      y += 2.2;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, width, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 0, y, width, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, width, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
    case "corner-mark": {
      const markW = Math.min(26, width * 0.3);
      parts.push(boxPart("accent", width - markW, 0, markW, 0.9, { fill: palette.primary, radius: 0 }));
      parts.push(
        boxPart("accent", width - 0.9, 0, 0.9, Math.min(12, height), {
          fill: palette.primary,
          radius: 0,
        }),
      );
      let y = 3;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, textWidth, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 0, y, textWidth, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, textWidth, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
  }

  return parts;
}
