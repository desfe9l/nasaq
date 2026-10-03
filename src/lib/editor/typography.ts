/**
 * Arabic typography presets.
 *
 * A report author should pick INTENT — «عنوان تقرير», «نص رسمي» — not a point
 * size, a weight and a line height. Each preset here is that intent spelled out
 * once, in the document's own palette, so a formal Saudi report looks like one
 * document instead of a collection of individually-tuned text boxes.
 *
 * Two rules make the presets safe to apply to an existing selection:
 *
 *   • they only ever touch TEXT properties (family, size, weight, leading,
 *     alignment, colour role). Geometry, position, rotation and layer order are
 *     left exactly as the author set them, so applying a preset can never move
 *     an element or change the document's structure.
 *   • colours are expressed as a ROLE (`primary`, `accent`, `ink`, `muted`)
 *     resolved against the active theme. A preset therefore matches whatever
 *     palette the document already uses — the same promise the KPI cards make.
 *
 * Line heights are set at or above the Arabic-safe floor: Arabic glyphs carry
 * ascenders, descenders and marks that Latin metrics do not account for, so the
 * browser's `normal` leading clips them. See `ARABIC_LINE_HEIGHT_FLOOR`.
 */

import {
  type CanvasEl,
  type ElStyle,
  type Theme,
  type ThemeId,
  THEMES,
} from "./model.ts";

/**
 * The lowest multiple of the font size that renders Arabic without clipping.
 *
 * Arabic ascenders (أ إ ل) and descenders (ج ح خ ر و ي) reach further than the
 * Latin em box, and a mark above a tall letter adds more. Below ≈1.5 the
 * browser clips the tops of tall letters in most of the bundled families;
 * `normal` in Chrome resolves to ≈1.15–1.2, which is exactly why text looked
 * shaved at the top. Every preset and the normaliser in `arabicSafeLineHeight`
 * respect this floor.
 */
export const ARABIC_LINE_HEIGHT_FLOOR = 1.5;

/**
 * Per-family leading floors.
 *
 * One number for "Arabic" is not enough: Naskh faces (Amiri, Noto Naskh) draw
 * their ascenders well above the em box and their descenders well below it, so a
 * paragraph set at Cairo's comfortable 1.55 still clips its own أ and ج. Kufi
 * faces sit tall and wide and need room for their ligature stacks. These are the
 * floors each family needs to render a multi-line Arabic paragraph unclipped;
 * an unknown or user-uploaded family falls back to `ARABIC_LINE_HEIGHT_FLOOR`.
 */
export const FONT_LINE_HEIGHT_FLOOR: Record<string, number> = {
  Tajawal: 1.5,
  Cairo: 1.55,
  "IBM Plex Sans Arabic": 1.6,
  "Noto Sans Arabic": 1.55,
  "Noto Naskh Arabic": 1.7,
  Amiri: 1.7,
  "Noto Kufi Arabic": 1.65,
  "Reem Kufi": 1.65,
};

/** The floor for one font family (falls back to the global Arabic floor). */
export function fontLineHeightFloor(family?: string): number {
  const key = String(family ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return FONT_LINE_HEIGHT_FLOOR[key] ?? ARABIC_LINE_HEIGHT_FLOOR;
}

/** Preferred family per role — all bundled, all Arabic-complete. */
const FAMILY = {
  display: "Cairo",
  body: "Tajawal",
  serif: "Amiri",
} as const;

export type ColorRole = "primary" | "accent" | "ink" | "muted" | "onPrimary";

export type TypographyPresetId =
  "report-title" | "subtitle" | "official-body" | "letter-ref" | "signature";

export interface TypographyPreset {
  id: TypographyPresetId;
  label: string;
  hint: string;
  /** Text properties the preset writes. Geometry is never included. */
  style: {
    fontFamily?: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    letterSpacing?: number;
    textAlign: "right" | "center" | "left" | "justify";
    color: ColorRole;
    kashida?: boolean;
    textBoxMode?: ElStyle["textBoxMode"];
    justifyLastLine?: ElStyle["justifyLastLine"];
  };
  /** A starting box for a NEW element of this kind (mm). */
  box: { w: number; h: number };
  /** Text written into an empty element when the preset is applied. */
  sample: string;
  /** Label for the preview chip — shows the preset's own voice. */
  preview: string;
}

export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  {
    id: "report-title",
    label: "عنوان تقرير",
    hint: "غلاف أو رأس قسم — ثقيل، متوسّط، بتباعد محكم",
    style: {
      fontFamily: FAMILY.display,
      fontSize: 26,
      fontWeight: 800,
      lineHeight: 1.6,
      letterSpacing: 0,
      textAlign: "center",
      color: "primary",
    },
    box: { w: 150, h: 20 },
    sample: "التقرير السنوي",
    preview: "التقرير السنوي",
  },
  {
    id: "subtitle",
    label: "عنوان فرعي",
    hint: "يشرح العنوان الرئيسي تحته مباشرة",
    style: {
      fontFamily: FAMILY.display,
      fontSize: 16,
      fontWeight: 700,
      lineHeight: 1.65,
      textAlign: "right",
      color: "ink",
    },
    box: { w: 140, h: 12 },
    sample: "ملخص الأداء للعام المالي المنقضي",
    preview: "ملخص الأداء للعام المنقضي",
  },
  {
    id: "official-body",
    label: "نص رسمي",
    hint: "فقرات التقارير — مع تطويل تلقائي للمحاذاة",
    style: {
      fontFamily: FAMILY.body,
      fontSize: 12.5,
      fontWeight: 500,
      lineHeight: 1.85,
      textAlign: "right",
      color: "ink",
      kashida: true,
      textBoxMode: "autoHeight",
      justifyLastLine: "start",
    },
    box: { w: 154, h: 40 },
    sample:
      "تلتزم الجهة بتنفيذ خطتها التشغيلية وفق المؤشرات المعتمدة، وتُرفع تقارير المتابعة الدورية إلى الجهة المختصة.",
    preview: "تلتزم الجهة بتنفيذ خطتها التشغيلية وفق المؤشرات المعتمدة",
  },
  {
    id: "letter-ref",
    label: "مرجع الخطاب",
    hint: "سطر الصادر والتاريخ — صغير، رمادي، بمحاذاة اليمين",
    style: {
      fontFamily: FAMILY.body,
      fontSize: 10,
      fontWeight: 600,
      lineHeight: 1.75,
      textAlign: "right",
      color: "muted",
    },
    box: { w: 120, h: 8 },
    sample: "الرقم: {رقم_المعاملة} — التاريخ: {التاريخ_الهجري}",
    preview: "الرقم: ٤٤١٧ — التاريخ: ١١ ربيع الآخر ١٤٤٨ هـ",
  },
  {
    id: "signature",
    label: "هامش توقيع",
    hint: "خانة التوقيع والاعتماد أسفل الجدول أو الخطاب",
    style: {
      fontFamily: FAMILY.serif,
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 2.2,
      letterSpacing: 0,
      textAlign: "center",
      color: "primary",
      textBoxMode: "fixed",
    },
    box: { w: 70, h: 32 },
    sample: "الاسم: ……………\nالصفة: ……………\nالتوقيع: ……………",
    preview: "الاسم والصفة والتوقيع",
  },
];

export function typographyPreset(id: string): TypographyPreset | undefined {
  return TYPOGRAPHY_PRESETS.find((p) => p.id === id);
}

/** Resolve a preset's colour role against the document's own theme. */
export function presetColor(role: ColorRole, theme: Theme): string {
  switch (role) {
    case "primary":
      return theme.primary;
    case "accent":
      return theme.accent;
    case "muted":
      return theme.muted;
    case "onPrimary":
      return "#ffffff";
    default:
      return theme.ink;
  }
}

/**
 * The style patch a preset contributes, resolved against a theme.
 *
 * The line height is clamped to the Arabic floor, so a preset can never be the
 * reason a paragraph clips — even if a future edit lowers a number by mistake.
 */
export function presetStyle(preset: TypographyPreset, theme: Theme): ElStyle {
  const s = preset.style;
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    /* Clamped against the PRESET's own family floor, not the global one. */
    lineHeight: arabicSafeLineHeight(s.lineHeight, s.fontFamily),
    letterSpacing: s.letterSpacing,
    textAlign: s.textAlign,
    color: presetColor(s.color, theme),
    ...(s.kashida ? { kashida: true, justifyLastLine: "start" } : {}),
    ...(s.textBoxMode ? { textBoxMode: s.textBoxMode } : {}),
  };
}

/**
 * Apply a preset to an existing element.
 *
 * Returns a new element with only its `style` (and, when the element is empty,
 * its `content`) replaced: the authored `w`/`h` are kept unless the caller asks
 * for the preset's own starting box, and nothing else about the element moves.
 */
export function applyTypographyPreset(
  el: CanvasEl,
  preset: TypographyPreset,
  themeId: ThemeId,
  options: { resizeBox?: boolean } = {},
): CanvasEl {
  const theme = THEMES[themeId] ?? THEMES.official;
  const style = { ...el.style, ...presetStyle(preset, theme) };
  const next: CanvasEl = {
    ...el,
    style,
    content: String(el.content ?? "").trim() ? el.content : preset.sample,
  };
  if (options.resizeBox) {
    next.w = preset.box.w;
    next.h = preset.box.h;
  }
  return next;
}

/**
 * Raise a legacy line height to the Arabic-safe floor.
 *
 * Documents authored before the floor existed can still carry `lineHeight: 1.2`
 * from the typography panel's «متراص» step, and that is what clips the tops of
 * tall letters. This returns the value to use, leaving anything already at or
 * above the floor untouched — including deliberately airy settings.
 */
export function arabicSafeLineHeight(
  lineHeight: number | undefined,
  family?: string,
): number {
  const floor = fontLineHeightFloor(family);
  const value = Number(lineHeight);
  if (!Number.isFinite(value) || value <= 0) return floor;
  return Math.max(floor, value);
}

/** True when a document still carries a line height below the safe floor. */
export function belowArabicFloor(
  lineHeight: number | undefined,
  family?: string,
): boolean {
  const value = Number(lineHeight);
  return (
    Number.isFinite(value) && value > 0 && value < fontLineHeightFloor(family)
  );
}
