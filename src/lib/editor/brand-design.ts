/*
 * Institutional identity → an actual document. ONE module, pure functions.
 *
 * «هوية مستندك» already stores the organisation's colours and fonts, and can
 * already build its own identity document. What it could not do is reach the
 * documents the platform PRODUCES:
 *
 *   · a design generated in the AI studio (painted from a `PaletteRoles`)
 *   · a template instantiated from the catalogue (painted from a `Theme`)
 *   · an imported file (painted from a `Theme`)
 *
 * This module is that reach — the single implementation, not one per surface.
 * Three rules keep it from becoming a second identity system:
 *
 *   1. **No new document model.** Nothing is added to `Project`; the identity is
 *      applied by remapping colours and fonts that already exist in the model,
 *      so the editor, the exporters and the importers stay unchanged.
 *   2. **No global theme mutation.** `THEMES` is read, never written: mutating it
 *      would leak one account's identity into the next server render.
 *   3. **Exact-match remapping only.** A colour is replaced only when it is
 *      byte-for-byte a role colour of the palette/theme the document was built
 *      with. Photographs, imported artwork and hand-picked colours survive.
 *
 * The entitlement is checked by the CALLER (`entitlements.brand_kit`): this
 * module is the "how", not the "may".
 */

import { hasArabic } from "./arabic";
import {
  THEMES,
  type CanvasEl,
  type Page,
  type Project,
  type Theme,
  type ThemeId,
} from "./model";
import type { PaletteRoles } from "@/lib/intelligence/schema";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/product/product";
import { contrastRatio, readableOn } from "@/lib/product/contrast";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHex(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!HEX.test(raw)) return fallback;
  if (raw.length === 7) return raw.toLowerCase();
  const [, r, g, b] = raw.toLowerCase();
  return `#${r}${r}${g}${g}${b}${b}`;
}

/** Blend two hex colours; `ratio` 0 keeps `a`, 1 keeps `b`. */
export function mixHex(a: string, b: string, ratio: number): string {
  const pick = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = pick(expandHex(a, "#000000"));
  const [br, bg, bb] = pick(expandHex(b, "#ffffff"));
  const t = Math.min(1, Math.max(0, ratio));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** True when the kit actually says something — the default kit is not a choice. */
export function brandIsConfigured(kit: BrandKit | null | undefined): boolean {
  if (!kit) return false;
  if ((kit.organizationName || "").trim()) return true;
  const base = DEFAULT_BRAND_KIT;
  return (
    kit.primaryColor !== base.primaryColor ||
    kit.accentColor !== base.accentColor ||
    kit.paperColor !== base.paperColor ||
    kit.textColor !== base.textColor ||
    kit.secondaryColor !== base.secondaryColor
  );
}

/**
 * The kit as the role palette the generators and the critic already speak.
 *
 * `ink` and `muted` are darkened until they clear WCAG AA on the kit's own
 * paper: an identity whose text colour is unreadable is corrected in the
 * document, not silently reproduced. The accent is kept as chosen — it paints
 * rules and bands, it is not body text.
 */
export function brandPalette(kit: BrandKit): PaletteRoles {
  const base = DEFAULT_BRAND_KIT;
  const field = expandHex(kit.primaryColor, expandHex(base.primaryColor, "#006c35"));
  const paper = expandHex(kit.paperColor, expandHex(base.paperColor, "#ffffff"));
  const inkRaw = expandHex(kit.textColor, expandHex(base.textColor, "#172033"));
  const accent = expandHex(kit.accentColor, expandHex(base.accentColor, "#c9a86a"));

  const lightTextWins = contrastRatio("#ffffff", field) >= contrastRatio(inkRaw, field);
  return {
    field,
    paper,
    ink: readableOn(inkRaw, paper),
    accent,
    muted: readableOn(mixHex(inkRaw, paper, 0.35), paper),
    onField: readableOn(lightTextWins ? "#ffffff" : inkRaw, field),
  };
}

/** The theme-valued view of a kit, for surfaces that need a whole `Theme`. */
export function brandTheme(kit: BrandKit, base: ThemeId = "official"): Theme {
  const theme = THEMES[base] ?? THEMES.official;
  const palette = brandPalette(kit);
  return {
    ...theme,
    name: (kit.organizationName || "").trim() || theme.name,
    primary: palette.field,
    primarySoft: mixHex(palette.field, "#ffffff", 0.22),
    accent: palette.accent,
    paper: palette.paper,
    ink: palette.ink,
    muted: palette.muted,
    line: mixHex(palette.ink, palette.paper, 0.82),
    surface: mixHex(palette.paper, "#f6f7f9", 0.5),
  };
}

/** Fonts as NASAQ's renderer can actually draw them. */
export function brandFonts(kit: BrandKit): { arabic: string; latin: string } {
  const arabicOptions = ["Tajawal", "Cairo", "IBM Plex Sans Arabic", "Noto Sans Arabic"];
  const arabic = arabicOptions.includes(kit.arabicFont) ? kit.arabicFont : "Tajawal";
  /*
   * The kit's `englishFont` is free text in «هوية مستندك». Only fonts this
   * platform ships are applied — an unknown family would silently fall back to a
   * system font in the PDF, which is worse than keeping the document's own.
   */
  const latin = /ibm plex sans|plex/i.test(kit.englishFont || "")
    ? "IBM Plex Sans Arabic"
    : arabic;
  return { arabic, latin };
}

/**
 * The identity applied to a PROMPT, before any builder runs.
 *
 * `design-generator.ts` reads `intent.palette` in every builder, so replacing it
 * here reaches the cover, the KPI boards, the tables and the closing page
 * without touching a single builder.
 */
export function applyBrandToIntent<T extends { palette: PaletteRoles; org?: string }>(
  intent: T,
  kit: BrandKit,
): T {
  if (!brandIsConfigured(kit)) return intent;
  return {
    ...intent,
    palette: brandPalette(kit),
    org: intent.org?.trim() || kit.organizationName?.trim() || intent.org,
  };
}

/* ── remapping ───────────────────────────────────────────────────────────── */

/**
 * One colour can serve two roles — a white that is BOTH the paper and the
 * text-on-field is the normal case, not an edge case. A flat map would let the
 * later role overwrite the earlier one, so mapping is per CONTEXT with the role
 * that owns the context winning: paint (fills, page paper) follows
 * field/paper/accent, text follows ink/muted/on-field.
 */
const PAINT_ORDER: Array<keyof PaletteRoles> = ["field", "paper", "accent", "ink", "muted", "onField"];
const TEXT_ORDER: Array<keyof PaletteRoles> = ["ink", "muted", "onField", "field", "accent", "paper"];

function roleMaps(from: PaletteRoles, to: PaletteRoles, pair?: (a: string, b: string) => string) {
  const convert = pair ?? ((a: string, b: string) => b);
  const build = (order: Array<keyof PaletteRoles>) => {
    const map = new Map<string, string>();
    for (const role of order) {
      const source = expandHex(from[role], "");
      if (!source) continue;
      if (!map.has(source)) map.set(source, convert(source, to[role]));
    }
    return map;
  };
  return { paint: build(PAINT_ORDER), text: build(TEXT_ORDER) };
}

function themeMaps(theme: Theme, to: PaletteRoles, pair?: (a: string, b: string) => string) {
  const convert = pair ?? ((a: string, b: string) => b);
  const build = (entries: Array<[string, string]>) => {
    const map = new Map<string, string>();
    for (const [source, target] of entries) {
      const key = expandHex(source, "");
      if (key && !map.has(key)) map.set(key, convert(key, target));
    }
    return map;
  };
  const paper = to.paper;
  const line = mixHex(to.ink, to.paper, 0.82);
  const shared: Array<[string, string]> = [
    [theme.paper, paper],
    [theme.surface, mixHex(paper, "#f6f7f9", 0.5)],
    [theme.line, line],
  ];
  return {
    paint: build([...shared, [theme.primary, to.field], [theme.primarySoft, to.field], [theme.accent, to.accent], [theme.ink, to.ink], [theme.muted, to.muted]]),
    text: build([...shared, [theme.ink, to.ink], [theme.muted, to.muted], [theme.primary, to.field], [theme.accent, to.accent]]),
  };
}

function remap(value: string | undefined, map: Map<string, string>): string | undefined {
  if (typeof value !== "string") return value;
  const key = expandHex(value, "");
  return key ? map.get(key) ?? value : value;
}

/** Relative luminance, for the "is this a near-white" question. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function isNearWhite(hex: string): boolean {
  return HEX.test(hex) && luminance(expandHex(hex, "#000000")) > 0.75;
}

function isTextBearer(el: CanvasEl): boolean {
  return typeof el.content === "string" && el.content.trim().length > 0;
}

interface Maps {
  paint: Map<string, string>;
  text: Map<string, string>;
}

/**
 * One element tree, recoloured.
 *
 * `onField` is the subtle part: a filled block whose fill became the identity's
 * field colour must not keep white text if that field is light. A block that
 * carried the field fill converts its own near-white text — and its children's —
 * to the identity's readable on-field colour.
 */
function applyToElement(
  el: CanvasEl,
  maps: Maps,
  palette: PaletteRoles,
  fonts: { arabic: string; latin: string },
  onFieldContext: boolean,
  withFonts: boolean,
): CanvasEl {
  const style = { ...el.style };
  const fillWasField =
    remap(style.fill, maps.paint) === palette.field ||
    remap(style.background, maps.paint) === palette.field;

  style.color = remap(style.color, maps.text);
  style.fill = remap(style.fill, maps.paint);
  style.background = remap(style.background, maps.paint);
  style.borderColor = remap(style.borderColor, maps.paint);
  style.svgFill = remap(style.svgFill, maps.paint);
  style.svgStroke = remap(style.svgStroke, maps.paint);
  if (style.gradient?.stops?.length) {
    style.gradient = {
      ...style.gradient,
      stops: style.gradient.stops.map((stop) => ({
        ...stop,
        color: remap(stop.color, maps.paint) ?? stop.color,
      })),
    };
  }

  const onField = onFieldContext || fillWasField;
  if (onField && typeof style.color === "string" && isNearWhite(style.color)) {
    style.color = palette.onField;
  }
  if (withFonts && isTextBearer(el)) {
    style.fontFamily = hasArabic(String(el.content)) ? fonts.arabic : fonts.latin;
  }

  return {
    ...el,
    style,
    children: el.children?.map((child) =>
      applyToElement(child, maps, palette, fonts, onField, withFonts),
    ),
  };
}

export interface BrandApplyOptions {
  /**
   * The palette the document was PAINTED with, when it was not theme colours —
   * a generated design carries its variation's `PaletteRoles`. Omit it for
   * documents painted from a `Theme` (templates, imports, the editor).
   */
  from?: PaletteRoles;
  /** Re-type every text element in the identity's fonts (default true). */
  fonts?: boolean;
  /** Stamp the organisation's name even if the document already has one. */
  forceOrg?: boolean;
}

/** Apply the identity to a project. Returns a NEW project; never mutates. */
export function applyBrandToProject(
  project: Project,
  kit: BrandKit,
  options: BrandApplyOptions = {},
): Project {
  if (!brandIsConfigured(kit)) return project;
  const palette = brandPalette(kit);
  const theme = THEMES[project.theme] ?? THEMES.official;
  const maps = options.from ? roleMaps(options.from, palette) : themeMaps(theme, palette);
  const fonts = brandFonts(kit);
  const withFonts = options.fonts !== false;

  const pages: Page[] = project.pages.map((page) => ({
    ...page,
    bg: remap(page.bg, maps.paint),
    bgGradient: page.bgGradient?.stops?.length
      ? {
          ...page.bgGradient,
          stops: page.bgGradient.stops.map((stop) => ({
            ...stop,
            color: remap(stop.color, maps.paint) ?? stop.color,
          })),
        }
      : page.bgGradient,
    elements: page.elements.map((el) =>
      applyToElement(el, maps, palette, fonts, false, withFonts),
    ),
  }));

  const org = (kit.organizationName || "").trim();
  return {
    ...project,
    pages,
    orgName:
      options.forceOrg || !project.orgName?.trim() ? org || project.orgName : project.orgName,
  };
}

/** The same application for a page set that has no project wrapper yet. */
export function applyBrandToPages(
  pages: Page[],
  themeId: ThemeId,
  kit: BrandKit,
  options: BrandApplyOptions = {},
): Page[] {
  return applyBrandToProject(
    { version: 2, name: "", theme: themeId, orgName: "", pages } as Project,
    kit,
    options,
  ).pages;
}

/**
 * The same application for a "seed" — the `{ pages, theme, orgName }` shape the
 * catalogue builds before a project exists. Returns the seed unchanged when
 * there is no identity to apply, so callers need no extra branching.
 */
export function applyBrandToSeed<
  T extends { pages: Page[]; theme: ThemeId; orgName: string },
>(seed: T, kit: BrandKit | null | undefined): T {
  if (!kit || !brandIsConfigured(kit)) return seed;
  const org = (kit.organizationName || "").trim();
  return {
    ...seed,
    pages: applyBrandToPages(seed.pages, seed.theme, kit),
    orgName: seed.orgName?.trim() ? seed.orgName : org || seed.orgName,
  };
}

/** A one-line summary for the UI: what will be applied, and from where. */
export function describeBrandApplication(kit: BrandKit): string {
  const name = (kit.organizationName || "").trim() || "هوية مستندك";
  return `تُطبَّق ${name}: الألوان والخطوط على المستند`;
}
