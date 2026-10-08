/**
 * Style Presets Engine — the four architectural styles of the studio:
 *
 *   · sovereign  — «النمط المؤسسي السيادي»
 *   · executive  — «النمط التنفيذي الحديث»
 *   · editorial  — «النمط التحريري المعاصر»
 *   · digital    — «النمط التقني والتبسيطي»
 *
 * Every preset carries geographically and visually specific values for the
 * five style dimensions the generator and the editor agree on:
 *
 *   · Typography Scale  — display/h1/h2/body/meta/folio sizes + line heights
 *   · Spacing           — margin, gutter, section gap, card padding, and the
 *                         share of a prose page that stays empty on purpose
 *   · Border Radius     — card / image / chip / frame radii in millimetres
 *   · Shadow Elevation  — card / floating / overlay box-shadows, taken from
 *                         the editor's own SHADOWS vocabulary so canvas and
 *                         panel never disagree
 *   · Color Palette Rules — the 60-30-10 discipline: 60% paper (dominant),
 *                         30% field (secondary), 10% accent (thread/diamond)
 *
 * A preset is data plus a layout bias: the pattern rotation the planner starts
 * from, so two styles never produce the same page rhythm even with the same
 * palette.
 */

import { SHADOWS, type Page } from "@/lib/editor/model";
import type { DesignStyle, PaletteRoles } from "./schema";
import type { LayoutPatternId } from "./layout-variety";

export type StylePresetId = "sovereign" | "executive" | "editorial" | "digital";

export interface TypographyScale {
  /** Point sizes per role. */
  display: number;
  h1: number;
  h2: number;
  body: number;
  meta: number;
  folio: number;
  lineHeights: { display: number; body: number; meta: number };
  families: { display: string; body: string; meta: string; ceremony: string };
}

export interface SpacingPreset {
  /** Page margin in millimetres. */
  marginMm: number;
  /** Gutter between columns/cards in millimetres. */
  gutterMm: number;
  /** Vertical gap between sections in millimetres. */
  sectionGapMm: number;
  /** Inner padding of cards in millimetres. */
  cardPaddingMm: number;
  /** Target share of a prose page kept as deliberate whitespace (0–1). */
  whitespaceRatio: number;
}

export interface BorderRadiusPreset {
  card: number;
  image: number;
  chip: number;
  frame: number;
}

export interface ShadowElevationPreset {
  card: string;
  floating: string;
  overlay: string;
}

export interface PaletteRulePreset {
  rule: "60-30-10";
  /** Role that owns 60% of the page — always the paper. */
  dominant: "paper";
  /** Role that owns 30% — the field (bands, headers, footers). */
  secondary: "field";
  /** Role that owns 10% — the accent (threads, diamonds, emphasis). */
  accent: "accent";
  ratios: { dominant: 60; secondary: 30; accent: 10 };
  rules: string[];
}

export interface StylePreset {
  id: StylePresetId;
  /** Variation id used by the studio tabs. */
  name: string;
  label: string;
  badge: string;
  description: string;
  palette: PaletteRoles;
  typographyScale: TypographyScale;
  spacing: SpacingPreset;
  borderRadius: BorderRadiusPreset;
  shadowElevation: ShadowElevationPreset;
  paletteRules: PaletteRulePreset;
  /** Preferred interior pattern rotation for this style. */
  layoutBias: readonly LayoutPatternId[];
  /** Minimum quality score the studio promises for this style. */
  minScore: number;
}

function shadowValue(id: string): string {
  return SHADOWS.find((item) => item.id === id)?.value ?? "";
}

const PALETTE_RULES_COMMON: string[] = [
  "60% of every page is the paper (dominant) — the page breathes.",
  "30% is the field (secondary) — bands, headers, footers, stat cards.",
  "10% is the accent — a thread, a diamond, a number circle. Never body text.",
  "One field, one paper, one accent per document. No second accent.",
];

export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  sovereign: {
    id: "sovereign",
    name: "النمط المؤسسي السيادي",
    label: "مؤسسي سيادي",
    badge: "الهوية الرسمية",
    description:
      "هوية مؤسسية رصينة بالأخضر والذهب، شبكة رسمية متوازنة، وتوزيع كلاسيكي للمستندات الحكومية والسنوية.",
    palette: {
      field: "#0c3d2c",
      paper: "#faf8f4",
      ink: "#17231c",
      accent: "#c6a05a",
      muted: "#5c6660",
      onField: "#faf8f4",
    },
    typographyScale: {
      display: 24,
      h1: 16,
      h2: 12,
      body: 9.5,
      meta: 7.5,
      folio: 6.5,
      lineHeights: { display: 1.15, body: 1.6, meta: 1.1 },
      families: {
        display: "Tajawal",
        body: "Noto Naskh Arabic",
        meta: "IBM Plex Sans Arabic",
        ceremony: "Amiri",
      },
    },
    spacing: {
      marginMm: 16,
      gutterMm: 4,
      sectionGapMm: 10,
      cardPaddingMm: 6,
      whitespaceRatio: 0.22,
    },
    borderRadius: { card: 3, image: 4, chip: 3, frame: 2 },
    shadowElevation: {
      card: shadowValue("soft"),
      floating: shadowValue("medium"),
      overlay: shadowValue("strong"),
    },
    paletteRules: {
      rule: "60-30-10",
      dominant: "paper",
      secondary: "field",
      accent: "accent",
      ratios: { dominant: 60, secondary: 30, accent: 10 },
      rules: PALETTE_RULES_COMMON,
    },
    layoutBias: [
      "executive-summary",
      "stat-cards",
      "table-matrix",
      "multi-column-cards",
      "asymmetric-editorial",
      "summary-callout",
    ],
    minScore: 88,
  },
  executive: {
    id: "executive",
    name: "النمط التنفيذي الحديث",
    label: "تنفيذي حديث",
    badge: "قيادي وتنفيذي",
    description:
      "تباين عالٍ بالكحلي والبرونز، بطاقات عائمة لمؤشرات الأداء، وعناوين قيادية بارزة موجهة للإدارة العليا.",
    palette: {
      field: "#071d3d",
      paper: "#f7f8fb",
      ink: "#172033",
      accent: "#d4b483",
      muted: "#5c6570",
      onField: "#f7f8fb",
    },
    typographyScale: {
      display: 26,
      h1: 18,
      h2: 13,
      body: 10,
      meta: 8,
      folio: 7,
      lineHeights: { display: 1.12, body: 1.65, meta: 1.3 },
      families: {
        display: "Tajawal",
        body: "Noto Naskh Arabic",
        meta: "IBM Plex Sans Arabic",
        ceremony: "Amiri",
      },
    },
    spacing: {
      marginMm: 18,
      gutterMm: 5,
      sectionGapMm: 12,
      cardPaddingMm: 7,
      whitespaceRatio: 0.28,
    },
    borderRadius: { card: 6, image: 6, chip: 7, frame: 3 },
    shadowElevation: {
      card: shadowValue("medium"),
      floating: shadowValue("strong"),
      overlay: shadowValue("strong"),
    },
    paletteRules: {
      rule: "60-30-10",
      dominant: "paper",
      secondary: "field",
      accent: "accent",
      ratios: { dominant: 60, secondary: 30, accent: 10 },
      rules: PALETTE_RULES_COMMON,
    },
    layoutBias: [
      "stat-cards",
      "executive-summary",
      "table-matrix",
      "multi-column-cards",
      "summary-callout",
      "asymmetric-editorial",
    ],
    minScore: 86,
  },
  editorial: {
    id: "editorial",
    name: "النمط التحريري المعاصر",
    label: "تحريري معاصر",
    badge: "تحريري ونشر",
    description:
      "تنسيق صحفي أنيق بمساحات بيضاء مدروسة، اقتباسات مميزة، وأسلوب مجلي يلائم التقارير الاستراتيجية والتعريفية.",
    palette: {
      field: "#1c1917",
      paper: "#fcfbfa",
      ink: "#1c1917",
      accent: "#b45309",
      muted: "#6b7280",
      onField: "#fcfbfa",
    },
    typographyScale: {
      display: 28,
      h1: 18,
      h2: 13,
      body: 10.5,
      meta: 8,
      folio: 7,
      lineHeights: { display: 1.2, body: 1.7, meta: 1.4 },
      families: {
        display: "Tajawal",
        body: "Noto Naskh Arabic",
        meta: "IBM Plex Sans Arabic",
        ceremony: "Amiri",
      },
    },
    spacing: {
      marginMm: 20,
      gutterMm: 6,
      sectionGapMm: 14,
      cardPaddingMm: 5,
      whitespaceRatio: 0.35,
    },
    borderRadius: { card: 0, image: 0, chip: 0, frame: 0 },
    shadowElevation: {
      card: shadowValue("none"),
      floating: shadowValue("soft"),
      overlay: shadowValue("soft"),
    },
    paletteRules: {
      rule: "60-30-10",
      dominant: "paper",
      secondary: "field",
      accent: "accent",
      ratios: { dominant: 60, secondary: 30, accent: 10 },
      rules: PALETTE_RULES_COMMON,
    },
    layoutBias: [
      "asymmetric-editorial",
      "summary-callout",
      "executive-summary",
      "multi-column-cards",
      "stat-cards",
      "table-matrix",
    ],
    minScore: 85,
  },
  digital: {
    id: "digital",
    name: "النمط التقني والتبسيطي",
    label: "تقني تبسيط",
    badge: "تقني ورقمي",
    description:
      "لوحة ألوان زرقاء وسماوية حديثة، بطاقات بيانات منظمة ومصفوفات رقمية تناسب التقنية والأمن السيبراني.",
    palette: {
      field: "#0a2239",
      paper: "#f6f9fc",
      ink: "#0c1b2c",
      accent: "#00a3c4",
      muted: "#5a6b7c",
      onField: "#f6f9fc",
    },
    typographyScale: {
      display: 22,
      h1: 16,
      h2: 12,
      body: 9,
      meta: 7.5,
      folio: 6.5,
      lineHeights: { display: 1.1, body: 1.55, meta: 1.25 },
      families: {
        display: "Tajawal",
        body: "Noto Naskh Arabic",
        meta: "IBM Plex Sans Arabic",
        ceremony: "Amiri",
      },
    },
    spacing: {
      marginMm: 14,
      gutterMm: 4,
      sectionGapMm: 8,
      cardPaddingMm: 5,
      whitespaceRatio: 0.18,
    },
    borderRadius: { card: 8, image: 8, chip: 9, frame: 4 },
    shadowElevation: {
      card: shadowValue("soft"),
      floating: shadowValue("medium"),
      overlay: shadowValue("strong"),
    },
    paletteRules: {
      rule: "60-30-10",
      dominant: "paper",
      secondary: "field",
      accent: "accent",
      ratios: { dominant: 60, secondary: 30, accent: 10 },
      rules: PALETTE_RULES_COMMON,
    },
    layoutBias: [
      "multi-column-cards",
      "stat-cards",
      "table-matrix",
      "asymmetric-editorial",
      "executive-summary",
      "summary-callout",
    ],
    minScore: 87,
  },
};

/** All presets, in studio tab order. */
export function stylePresets(): StylePreset[] {
  return [STYLE_PRESETS.sovereign, STYLE_PRESETS.executive, STYLE_PRESETS.editorial, STYLE_PRESETS.digital];
}

/** Lookup by variation id; null for anything unknown. */
export function stylePresetFor(id: string): StylePreset | null {
  return (STYLE_PRESETS as Record<string, StylePreset>)[id] ?? null;
}

/**
 * The preset a raw `DesignStyle` maps to. The studio's four architectural
 * styles cover the whole catalog: institutional/government/report speak
 * sovereign, executive speaks executive, editorial speaks editorial, and the
 * corporate/presentation/infographic/auction family speaks digital.
 */
export function presetForDesignStyle(style: DesignStyle): StylePreset {
  switch (style) {
    case "executive":
      return STYLE_PRESETS.executive;
    case "editorial":
      return STYLE_PRESETS.editorial;
    case "corporate":
    case "presentation":
    case "infographic":
    case "auction":
      return STYLE_PRESETS.digital;
    case "institutional":
    case "government":
    case "report":
    default:
      return STYLE_PRESETS.sovereign;
  }
}

// ── 60-30-10 palette discipline ────────────────────────────────────────────

function luma(hex: string): number {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return -1;
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Verify a palette actually follows the 60-30-10 rule: the paper must be the
 * light dominant (60%), the field the dark secondary (30%), and the accent a
 * third value that is clearly distinct from both (10% — threads and diamonds,
 * never large areas).
 */
export function paletteFollows60_30_10(palette: PaletteRoles): boolean {
  const paper = luma(palette.paper);
  const field = luma(palette.field);
  const accent = luma(palette.accent);
  if (paper < 0 || field < 0 || accent < 0) return false;
  return (
    paper > 150 &&
    field < 100 &&
    Math.abs(accent - paper) >= 40 &&
    Math.abs(accent - field) >= 40
  );
}

/** One-line, human-readable summary of a preset's five style dimensions. */
export function describePreset(preset: StylePreset): string {
  const scale = preset.typographyScale;
  const spacing = preset.spacing;
  const radius = preset.borderRadius;
  return [
    `${preset.name} — ${preset.badge}`,
    `Type: display ${scale.display} / h1 ${scale.h1} / h2 ${scale.h2} / body ${scale.body} / meta ${scale.meta}`,
    `Spacing: margin ${spacing.marginMm}mm, gutter ${spacing.gutterMm}mm, section gap ${spacing.sectionGapMm}mm, whitespace ${(spacing.whitespaceRatio * 100).toFixed(0)}%`,
    `Radius: card ${radius.card}mm, image ${radius.image}mm, chip ${radius.chip}mm, frame ${radius.frame}mm`,
    `Palette 60-30-10: ${preset.paletteRules.dominant} ${preset.paletteRules.ratios.dominant}% / ${preset.paletteRules.secondary} ${preset.paletteRules.ratios.secondary}% / ${preset.paletteRules.accent} ${preset.paletteRules.ratios.accent}%`,
  ].join("\n");
}

/**
 * Apply a preset's radius and shadow elevation to the stamped elements of one
 * page. Only real cards (accent cards, stat cards, summary callouts) and
 * images are touched; furniture, ornaments, threads and strips keep the flat
 * geometry the builders gave them.
 */
export function applyStylePreset(page: Page, preset: StylePreset): void {
  for (const el of page.elements) {
    const role = el.layout?.role;
    if (!role || role === "furniture" || role === "ornament") continue;
    if (role === "accent-card" || role === "stat-card" || role === "summary-callout") {
      if (el.h < 12 || el.w < 24) continue;
      el.style.radius = preset.borderRadius.card;
      if (preset.shadowElevation.card) el.style.shadow = preset.shadowElevation.card;
    } else if (role === "image" && el.type === "image") {
      el.style.radius = preset.borderRadius.image;
    }
  }
}
