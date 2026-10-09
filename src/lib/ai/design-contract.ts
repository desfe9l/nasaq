import { normalizeCompositions, type DesignComposition } from "./design-composition";
import {
  normalizePageLayoutDirectives,
  planPageLayouts,
  type PageLayoutDirective,
} from "@/lib/intelligence/layout-variety";
import { presetForDesignStyle } from "@/lib/intelligence/style-presets";
import type { DesignStyle } from "@/lib/intelligence/schema";

export type { LayoutPatternId, PageLayoutDirective } from "@/lib/intelligence/layout-variety";

export type DesignGenerationMode = "generate" | "balance" | "professional";
export type CoverStyle =
  | "minimal"
  | "editorial"
  | "premium"
  | "gradient"
  | "wave"
  | "geometric"
  | "image-led"
  | "executive"
  | "formal"
  | "legal"
  | "media"
  | "annual-report";

export interface DesignBriefInput {
  prompt: string;
  mode: DesignGenerationMode;
  requestedPages?: number;
  style?: string;
  format?: string;
  coverStyle?: CoverStyle;
  bilingual?: boolean;
  contentDensity?: "light" | "balanced" | "dense";
}

export interface DesignBrief {
  compositions?: DesignComposition[];
  title: string;
  subtitle: string;
  org: string;
  topic: string;
  style: string;
  format: "a4-book" | "wide-slide" | "tall-story";
  pages: number;
  coverStyle: CoverStyle;
  bilingual: boolean;
  contentDensity: "light" | "balanced" | "dense";
  visualDirection: string;
  /**
   * Per-page layout directives (Anti-Monotony & Dynamic Layout Rules):
   * one entry per page with its pattern, grid, positioning, visual hierarchy,
   * accent cards and summary callouts. Page 1 is always a hero cover and no
   * two consecutive pages share a pattern — the planner enforces that even
   * when the provider returns a monotonous array.
   */
  pageLayouts: PageLayoutDirective[];
}

export type DesignBriefResult =
  | { ok: true; brief: DesignBrief }
  | {
      ok: false;
      code: "unauthorized" | "license_required" | "not_configured" | "rate_limited" | "invalid" | "provider_error";
      message: string;
    };

const MAX_PROMPT = 8_000;
const STYLES = new Set([
  "institutional",
  "government",
  "corporate",
  "executive",
  "editorial",
  "presentation",
  "report",
  "infographic",
  "auction",
]);
const FORMATS = new Set(["a4-book", "wide-slide", "tall-story"]);
const COVER_STYLES = new Set([
  "minimal",
  "editorial",
  "premium",
  "gradient",
  "wave",
  "geometric",
  "image-led",
  "executive",
  "formal",
  "legal",
  "media",
  "annual-report",
]);

export function normalizeDesignBriefInput(input: Partial<DesignBriefInput>): DesignBriefInput {
  return {
    prompt: String(input.prompt ?? "").trim().slice(0, MAX_PROMPT),
    mode: input.mode === "balance" || input.mode === "professional" ? input.mode : "generate",
    requestedPages:
      input.requestedPages == null ? undefined : Math.min(12, Math.max(1, Math.round(Number(input.requestedPages) || 1))),
    style: typeof input.style === "string" && STYLES.has(input.style) ? input.style : undefined,
    format: typeof input.format === "string" && FORMATS.has(input.format) ? input.format : undefined,
    coverStyle: input.coverStyle && COVER_STYLES.has(input.coverStyle) ? input.coverStyle : undefined,
    bilingual: Boolean(input.bilingual),
    contentDensity:
      input.contentDensity === "light" || input.contentDensity === "dense" ? input.contentDensity : "balanced",
  };
}

export function validDesignBriefInput(input: DesignBriefInput): boolean {
  return Boolean(input.prompt && input.prompt.length <= MAX_PROMPT);
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : fallback;
}

export function normalizeDesignBrief(value: unknown, input: DesignBriefInput): DesignBrief {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const requestedFormat = String(raw.format ?? "");
  const format = FORMATS.has(requestedFormat)
    ? (requestedFormat as DesignBrief["format"])
    : input.format === "wide-slide"
      ? "wide-slide"
      : input.format === "tall-story"
        ? "tall-story"
        : "a4-book";
  const pages = Math.min(12, Math.max(1, input.requestedPages ?? Math.round(Number(raw.pages) || (format === "wide-slide" ? 6 : 4))));
  const requestedStyle = String(raw.style ?? input.style ?? "institutional");
  const coverStyle = String(raw.coverStyle ?? "formal");
  return {
    ...(raw.compositions !== undefined ? { compositions: normalizeCompositions(raw.compositions, pages) } : {}),
    // Provider omissions are fields for the owner to fill, never facts for the
    // generator to infer or institutional claims for it to make.
    title: text(raw.title, "[عنوان المستند]"),
    subtitle: text(raw.subtitle, "[أضف ملخصًا موثقًا من المصدر]"),
    org: text(raw.org, "[اسم الجهة]"),
    topic: text(raw.topic, input.prompt.slice(0, 120)),
    style: STYLES.has(requestedStyle) ? requestedStyle : "institutional",
    format,
    pages,
    coverStyle: COVER_STYLES.has(coverStyle) ? (coverStyle as DesignBrief["coverStyle"]) : "formal",
    bilingual: input.bilingual || raw.bilingual === true,
    contentDensity:
      raw.contentDensity === "light" || raw.contentDensity === "dense"
        ? raw.contentDensity
        : input.contentDensity ?? "balanced",
    visualDirection: text(raw.visualDirection, "تكوين عربي RTL بهرمية واضحة ومساحات بيضاء مقصودة"),
    pageLayouts: planPageLayouts({
      pages,
      format,
      mode: input.mode,
      density: input.contentDensity,
      styleBias: STYLES.has(requestedStyle)
        ? presetForDesignStyle(requestedStyle as DesignStyle).layoutBias
        : undefined,
      directives: normalizePageLayoutDirectives(raw.pageLayouts, pages),
    }),
  };
}
