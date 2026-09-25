/**
 * مولد عناوين الفقرات — the section-heading generator.
 * Fixed for RTL balanced layout, organized groups, proper spacing.
 */

export type HeadingField = "title" | "subtitle" | "index";

export interface HeadingPreset {
  id: HeadingPresetId;
  label: string;
  hint: string;
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
  width: number;
  title: string;
  subtitle?: string;
  index?: string;
  eyebrow?: string;
}

export interface HeadingPalette {
  primary: string;
  accent: string;
  ink: string;
  muted: string;
  surface: string;
}

export const DEFAULT_HEADING_PALETTE: HeadingPalette = {
  primary: "#006C35",
  accent: "#C9A86A",
  ink: "#14281F",
  muted: "#5B6B62",
  surface: "#FFFFFF",
};

export const HEADING_PRESETS: HeadingPreset[] = [
  {
    id: "side-bar",
    label: "شريط جانبي",
    hint: "عمود لوني سميك يمين العنوان — الأكثر استخداماً في التقارير الرسمية",
    fields: ["title", "subtitle"],
  },
  {
    id: "numbered-plate",
    label: "لوحة مرقّمة",
    hint: "مربع بلون الهوية يحمل الرقم يميناً، وعنوان بمحاذاته",
    fields: ["title", "subtitle", "index"],
  },
  {
    id: "under-rule",
    label: "خط سفلي",
    hint: "عنوان كبير مع خط رفيع تحته وزخرفة ذهبية يميناً",
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
    hint: "رقم كبير يميناً بخط رفيع، والعنوان تحته",
    fields: ["title", "subtitle", "index"],
  },
  {
    id: "corner-mark",
    label: "علامة ركنية",
    hint: "قوس لوني في الركن الأيمن مع عنوان مضغوط — مثالي للأقسام الفرعية",
    fields: ["title", "subtitle"],
  },
];

const TITLE_FONT = 18;
const TITLE_LINE = 10;
const CORNER_TITLE_FONT = 16;
const CORNER_TITLE_LINE = 9;
const SUBTITLE_FONT = 9.5;
const SUBTITLE_LINE = 5.4;
const SUBTITLE_BLOCK = SUBTITLE_LINE + 2;
const EYEBROW_FONT = 7.4;
const EYEBROW_BLOCK = EYEBROW_FONT + 3.4;

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
  width: number;
  textWidth: number;
  plateSize: number;
  titleFont: number;
  titleLine: number;
  titleHeight: number;
  subtitleHeight: number;
  eyebrowHeight: number;
  height: number;
}

export function headingMetrics(input: HeadingInput): HeadingMetrics {
  const width = Math.max(60, input.width);
  const hasIndex = Boolean(input.index?.trim());
  const isCorner = input.preset === "corner-mark";
  const titleFont = isCorner ? CORNER_TITLE_FONT : TITLE_FONT;
  const titleLine = isCorner ? CORNER_TITLE_LINE : TITLE_LINE;

  const plateSize = hasIndex ? Math.min(16, Math.max(12, width * 0.11)) : 0;

  const textWidth =
    input.preset === "side-bar"
      ? width - 8
      : input.preset === "numbered-plate"
        ? width - plateSize - (hasIndex ? 5 : 0)
        : input.preset === "framed-card"
          ? width - 10
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
      height = Math.max(18, 2 + body + 3);
      break;
    case "numbered-plate":
      height = Math.max(plateSize + 2, 1 + body + 4);
      break;
    case "under-rule":
      height = Math.max(18, 1 + body + (subtitleHeight ? 4.3 : 2.9));
      break;
    case "framed-card":
      height = Math.max(24, 4.4 + body + 8);
      break;
    case "split-band":
      height = Math.max(18, 1.8 + 3 + body + 3);
      break;
    case "ribbon":
      height = Math.max(18, 1 + body + (subtitleHeight ? 3.8 : 2.4));
      break;
    case "indexed-rule":
      height = Math.max(22, (hasIndex ? 11 : 0) + 0.5 + 2.2 + body + 2);
      break;
    case "corner-mark":
      height = Math.max(16, 3 + body + 3);
      break;
    default:
      height = body + 6;
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

  switch (input.preset) {
    case "side-bar": {
      // Bar on RIGHT for RTL
      parts.push(boxPart("band", width - 3.2, 0, 3.2, height, { fill: palette.primary, radius: 1 }));
      let y = 2;
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
    case "numbered-plate": {
      const plate = m.plateSize;
      if (index) {
        // Plate on RIGHT
        parts.push(
          boxPart("plate", width - plate, 0, plate, plate, { fill: palette.primary, radius: 2 }),
        );
        parts.push(
          textPart("index", width - plate, 0, plate, plate, index, {
            fontSize: 11,
            fontWeight: 800,
            color: "#FFFFFF",
            textAlign: "center",
          }),
        );
      }
      let y = 1.5;
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
      parts.push(boxPart("rule", 0, y, width, 0.6, { fill: "#D9E2DC", radius: 0 }));
      // Accent on RIGHT for RTL
      parts.push(
        boxPart("accent", width - Math.min(36, width * 0.3), y, Math.min(36, width * 0.3), 0.6, { fill: palette.accent, radius: 0 }),
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
          strokeWidth: 0.35,
          radius: 3,
        }),
      );
      parts.push(boxPart("band", 0, 0, width, 1.4, { fill: palette.primary, radius: 3 }));
      let y = 4;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 5, y, width - 10, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 5, y, width - 10, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 5, y, width - 10, subtitleHeight, subtitle, subtitleStyle));
      }
      if (index) {
        parts.push(
          textPart("index", 5, height - 7, 14, 5, index, {
            fontSize: 8,
            fontWeight: 800,
            color: palette.primary,
            textAlign: "right",
          }),
        );
      }
      break;
    }
    case "split-band": {
      const bandH = 1.6;
      // RTL: primary on right, accent on left
      parts.push(boxPart("band", width - width * 0.62, 0, width * 0.62, bandH, { fill: palette.primary, radius: 0 }));
      parts.push(
        boxPart("accent", 0, 0, width * 0.38, bandH, { fill: palette.accent, radius: 0 }),
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
      const firstWord = title.split(/\s+/)[0] ?? title;
      const ribbonW = Math.min(width * 0.68, Math.max(28, firstWord.length * 5.2 + 12));
      // Ribbon on right for RTL (behind first word which is on right)
      parts.push(
        boxPart("band", width - ribbonW, y, ribbonW, m.titleLine + 3.2, {
          fill: palette.primary,
          radius: 2,
          opacity: 0.12,
        }),
      );
      parts.push(
        boxPart("accent", width - ribbonW, y, 1.2, m.titleLine + 3.2, {
          fill: palette.primary,
          radius: 0,
        }),
      );
      parts.push(textPart("title", 0, y + 1.2, width, titleHeight, title, titleStyle));
      y += 1.2 + titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, width, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
    case "indexed-rule": {
      let y = 0;
      if (index) {
        // Index on RIGHT for RTL
        parts.push(
          textPart("index", width - 20, y, 20, 10, index, {
            fontSize: 15,
            fontWeight: 800,
            color: palette.accent,
            textAlign: "right",
            lineHeight: 1,
          }),
        );
        y += 10;
      }
      parts.push(boxPart("rule", 0, y, width, 0.5, { fill: "#D9E2DC", radius: 0 }));
      y += 2;
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
      const markW = Math.min(24, width * 0.28);
      // Marks on RIGHT
      parts.push(boxPart("accent", width - markW, 0, markW, 0.8, { fill: palette.primary, radius: 0 }));
      parts.push(
        boxPart("accent", width - 0.8, 0, 0.8, Math.min(11, height), {
          fill: palette.primary,
          radius: 0,
        }),
      );
      let y = 3;
      if (eyebrow) {
        parts.push(textPart("eyebrow", 0, y, width - 4, EYEBROW_FONT + 1.6, eyebrow, eyebrowStyle));
        y += m.eyebrowHeight;
      }
      parts.push(textPart("title", 0, y, width - 4, titleHeight, title, titleStyle));
      y += titleHeight;
      if (subtitle) {
        parts.push(textPart("subtitle", 0, y, width - 4, subtitleHeight, subtitle, subtitleStyle));
      }
      break;
    }
  }

  return parts;
}
