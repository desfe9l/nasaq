/**
 * Layout Variety Engine — Anti-Monotony & Dynamic Layout Rules.
 *
 * The generation pipeline used to repeat one composition for every interior
 * page of long documents (every page after the fourth became the same
 * executive summary). This module is the fix, in four parts:
 *
 *   1. LAYOUT_PATTERNS — a catalog of named page structures (hero cover,
 *      asymmetric editorial grid, multi-column cards, stat cards, table
 *      matrix, airy summary callout, closing endorsement).
 *   2. planPageLayouts — assigns ONE pattern per page so that page 1 is a
 *      hero cover and no two consecutive pages share a pattern. Provider
 *      suggestions (`directives`) are honored only when they obey the same
 *      anti-monotony rule.
 *   3. checkLayoutVariety — the validator: fingerprints every page's
 *      structure and reports any pair of CONSECUTIVE pages that look alike.
 *   4. enforceLayoutVariety — when the validator fires, a secondary layout
 *      pattern is applied automatically: the generator path rebuilds the
 *      page with the next pattern; the editor path re-flows the existing
 *      elements into a two-column grid (or mirrors an existing column
 *      split). Content is never rewritten, only redistributed.
 *
 * Everything here is pure geometry and metadata over ordinary NASAQ
 * `Page` / `CanvasEl` values — no flattened output, ever.
 */

import {
  clone,
  pageSize,
  type CanvasEl,
  type ElementLayoutMeta,
  type Page,
  type Project,
} from "@/lib/editor/model";
import type { DesignStyle } from "./schema";

// ── Pattern catalog ────────────────────────────────────────────────────────

export const LAYOUT_PATTERNS = [
  "hero-cover",
  "executive-summary",
  "asymmetric-editorial",
  "multi-column-cards",
  "stat-cards",
  "table-matrix",
  "summary-callout",
  "closing-endorsement",
] as const;

export type LayoutPatternId = (typeof LAYOUT_PATTERNS)[number];

export type LayoutPositioning = "hero" | "asymmetric" | "grid" | "stacked";
export type LayoutWhitespace = "tight" | "balanced" | "airy";
export type LayoutHierarchyLevel = "display" | "h1" | "h2" | "body" | "meta";

export interface PageLayoutDirective {
  /** 1-based page number. */
  page: number;
  pattern: LayoutPatternId;
  columns: 1 | 2 | 3;
  positioning: LayoutPositioning;
  visualHierarchy: LayoutHierarchyLevel[];
  /** How many accent cards the page carries (0–3). */
  accentCards: number;
  /** Whether the page carries a summary callout / pull-quote. */
  summaryCallout: boolean;
  whitespace: LayoutWhitespace;
}

export interface LayoutPatternMeta {
  id: LayoutPatternId;
  label: string;
  columns: 1 | 2 | 3;
  positioning: LayoutPositioning;
  whitespace: LayoutWhitespace;
  accentCards: number;
  summaryCallout: boolean;
  visualHierarchy: LayoutHierarchyLevel[];
  description: string;
}

export const LAYOUT_PATTERN_META: Record<LayoutPatternId, LayoutPatternMeta> = {
  "hero-cover": {
    id: "hero-cover",
    label: "غلاف بؤري",
    columns: 1,
    positioning: "hero",
    whitespace: "airy",
    accentCards: 0,
    summaryCallout: false,
    visualHierarchy: ["display", "meta"],
    description: "الصفحة الأولى: حقل بملء الصفحة، صورة محورية، عنوان واحد مهيمن، ومساحات بيضاء مقصودة.",
  },
  "executive-summary": {
    id: "executive-summary",
    label: "ملخص تنفيذي",
    columns: 1,
    positioning: "stacked",
    whitespace: "balanced",
    accentCards: 1,
    summaryCallout: true,
    visualHierarchy: ["h1", "body", "meta"],
    description: "مستخلص بعمود واحد مع بطاقة مميزة ومقولة مقتبسة.",
  },
  "asymmetric-editorial": {
    id: "asymmetric-editorial",
    label: "شبكة غير متماثلة",
    columns: 2,
    positioning: "asymmetric",
    whitespace: "balanced",
    accentCards: 1,
    summaryCallout: true,
    visualHierarchy: ["h1", "h2", "body"],
    description: "شبكة 7/5 غير متماثلة: عمود نصي عريض بجانب شريط جانبي للبطاقات والمقتطفات.",
  },
  "multi-column-cards": {
    id: "multi-column-cards",
    label: "بطاقات متعددة الأعمدة",
    columns: 3,
    positioning: "grid",
    whitespace: "tight",
    accentCards: 3,
    summaryCallout: false,
    visualHierarchy: ["h1", "h2", "meta"],
    description: "شبكة من 2–3 أعمدة من بطاقات متساوية الارتفاع مع شريط علوي ملوّن.",
  },
  "stat-cards": {
    id: "stat-cards",
    label: "بطاقات إحصائية",
    columns: 2,
    positioning: "grid",
    whitespace: "balanced",
    accentCards: 0,
    summaryCallout: false,
    visualHierarchy: ["display", "h2", "meta"],
    description: "لوحة مؤشرات: بطاقات 2×2 بأرقام كبيرة وتسميات موجزة.",
  },
  "table-matrix": {
    id: "table-matrix",
    label: "مصفوفة بيانات",
    columns: 1,
    positioning: "stacked",
    whitespace: "balanced",
    accentCards: 1,
    summaryCallout: false,
    visualHierarchy: ["h1", "body", "meta"],
    description: "جدول بترويسة ملوّنة + بطاقة ملاحظات أسفله.",
  },
  "summary-callout": {
    id: "summary-callout",
    label: "مقتطفات ومساحات بيضاء",
    columns: 1,
    positioning: "stacked",
    whitespace: "airy",
    accentCards: 0,
    summaryCallout: true,
    visualHierarchy: ["display", "h2", "body"],
    description: "صفحة هادئة: مقولة بحجم العرض + بطاقات مقتطفات ومساحات بيضاء متزنة.",
  },
  "closing-endorsement": {
    id: "closing-endorsement",
    label: "خاتمة واعتماد",
    columns: 1,
    positioning: "stacked",
    whitespace: "balanced",
    accentCards: 0,
    summaryCallout: false,
    visualHierarchy: ["h1", "body", "meta"],
    description: "توصيات مرقّمة + إطار اعتماد مع ختم وتوقيعات.",
  },
};

/**
 * Interior rotation — the default rhythm for portrait documents. The order is
 * a content-coverage guarantee (summary → stats → table → columns) followed
 * by the two editorial patterns that break the repetition in long documents.
 */
const INTERIOR_ROTATION: readonly LayoutPatternId[] = [
  "executive-summary",
  "stat-cards",
  "table-matrix",
  "multi-column-cards",
  "asymmetric-editorial",
  "summary-callout",
];

/** Documents with at least this many pages end on an endorsement page. */
const CLOSING_FROM_PAGES = 6;

const POSITIONINGS: readonly LayoutPositioning[] = ["hero", "asymmetric", "grid", "stacked"];
const WHITESPACES: readonly LayoutWhitespace[] = ["tight", "balanced", "airy"];
const HIERARCHY_LEVELS: readonly LayoutHierarchyLevel[] = ["display", "h1", "h2", "body", "meta"];

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Build one complete, contract-shaped directive for a pattern. */
export function directiveForPattern(
  pattern: LayoutPatternId,
  page: number,
  partial?: Partial<PageLayoutDirective>,
): PageLayoutDirective {
  const meta = LAYOUT_PATTERN_META[pattern];
  return {
    page,
    pattern,
    columns: partial?.columns ?? meta.columns,
    positioning: partial?.positioning ?? meta.positioning,
    visualHierarchy: partial?.visualHierarchy?.length ? [...partial.visualHierarchy] : [...meta.visualHierarchy],
    accentCards: partial?.accentCards ?? meta.accentCards,
    summaryCallout: partial?.summaryCallout ?? meta.summaryCallout,
    whitespace: partial?.whitespace ?? meta.whitespace,
  };
}

/**
 * Sanitize a provider-returned `pageLayouts` array: whitelist patterns, clamp
 * page numbers into the document, drop duplicates and garbage, and fill every
 * directive from the pattern defaults. Returns [] for anything unusable — the
 * planner then falls back to the default rotation.
 */
export function normalizePageLayoutDirectives(value: unknown, totalPages: number): PageLayoutDirective[] {
  if (!Array.isArray(value)) return [];
  const total = Math.min(12, Math.max(1, Math.round(Number(totalPages) || 1)));
  const seen = new Set<number>();
  const out: PageLayoutDirective[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const page = Math.round(Number(record.page));
    if (!Number.isFinite(page) || page < 1 || page > total || seen.has(page)) continue;
    if (!LAYOUT_PATTERNS.includes(record.pattern as LayoutPatternId)) continue;
    const pattern = record.pattern as LayoutPatternId;
    seen.add(page);
    const hierarchy = Array.isArray(record.visualHierarchy)
      ? (record.visualHierarchy.filter((level): level is LayoutHierarchyLevel =>
          HIERARCHY_LEVELS.includes(level as LayoutHierarchyLevel),
        ) as LayoutHierarchyLevel[])
      : [];
    out.push(
      directiveForPattern(pattern, page, {
        columns: [1, 2, 3].includes(Number(record.columns)) ? (Number(record.columns) as 1 | 2 | 3) : undefined,
        positioning: POSITIONINGS.includes(record.positioning as LayoutPositioning)
          ? (record.positioning as LayoutPositioning)
          : undefined,
        visualHierarchy: hierarchy.length ? hierarchy : undefined,
        accentCards: clampInt(record.accentCards, 0, 3, LAYOUT_PATTERN_META[pattern].accentCards),
        summaryCallout: typeof record.summaryCallout === "boolean" ? record.summaryCallout : undefined,
        whitespace: WHITESPACES.includes(record.whitespace as LayoutWhitespace)
          ? (record.whitespace as LayoutWhitespace)
          : undefined,
      }),
    );
    if (out.length >= total) break;
  }
  return out.sort((a, b) => a.page - b.page);
}

// ── Layout planner ─────────────────────────────────────────────────────────

export interface LayoutPlanInput {
  pages: number;
  format?: string;
  mode?: "generate" | "balance" | "professional";
  density?: "light" | "balanced" | "dense";
  style?: DesignStyle;
  /** Style-biased pattern rotation (Style Presets Engine). */
  styleBias?: readonly LayoutPatternId[];
  /** Provider-suggested directives (already normalized or raw). */
  directives?: unknown;
}

/**
 * One pattern per page, anti-monotony enforced:
 *
 *   · Page 1 is ALWAYS a hero cover (a provider directive cannot override it).
 *   · No two consecutive pages share a pattern — provider suggestions that
 *     would repeat the previous page are rotated to the next pattern instead.
 *   · Documents with 6+ pages end on a closing endorsement page.
 *   · Documents with 4–5 pages keep the classic rhythm (summary, stats,
 *     table [, columns]) so short reports stay complete.
 */
export function planPageLayouts(input: LayoutPlanInput): PageLayoutDirective[] {
  const total = Math.min(12, Math.max(1, Math.round(Number(input.pages) || 1)));
  const rotation = input.styleBias?.length ? input.styleBias : INTERIOR_ROTATION;
  const byPage = new Map(
    normalizePageLayoutDirectives(input.directives, total).map((directive) => [directive.page, directive]),
  );

  const plan: PageLayoutDirective[] = [directiveForPattern("hero-cover", 1, byPage.get(1))];
  if (total === 1) return plan;

  const closingLast = total >= CLOSING_FROM_PAGES;
  const interiorCount = closingLast ? total - 2 : total - 1;
  let previous = plan[0].pattern;

  for (let i = 0; i < interiorCount; i += 1) {
    const pageNo = i + 2;
    const suggestion = byPage.get(pageNo);
    let pattern: LayoutPatternId;
    if (suggestion && suggestion.pattern !== previous) {
      pattern = suggestion.pattern;
    } else {
      pattern = rotation[i % rotation.length];
      if (pattern === previous) pattern = rotation[(i + 1) % rotation.length];
    }
    const directive =
      suggestion && suggestion.pattern === pattern
        ? suggestion
        : directiveForPattern(pattern, pageNo);
    plan.push(directive);
    previous = pattern;
  }

  if (closingLast) {
    plan.push(directiveForPattern("closing-endorsement", total, byPage.get(total)));
  }
  return plan;
}

// ── Structural fingerprint ─────────────────────────────────────────────────

const CONTENT_TYPES = new Set([
  "text",
  "box",
  "stat",
  "table",
  "shape",
  "image",
  "logo",
  "icon",
  "stamp",
  "qr",
  "progress",
  "svg",
  "line",
  "divider",
  "group",
]);

const TYPE_CODE: Record<string, string> = {
  text: "T",
  box: "B",
  stat: "S",
  table: "M",
  shape: "H",
  image: "I",
  logo: "G",
  icon: "N",
  stamp: "P",
  qr: "Q",
  progress: "R",
  svg: "V",
  line: "L",
  divider: "D",
  group: "U",
};

function isFurniture(el: CanvasEl): boolean {
  return Boolean(el.hfRole) || el.name === "رقم الصفحة" || el.layout?.role === "furniture";
}

function isOrnament(el: CanvasEl): boolean {
  if (el.layout?.role === "ornament") return true;
  if (el.content) return false;
  if (el.type === "shape" || el.type === "line" || el.type === "divider") {
    return Number(el.opacity ?? 1) <= 0.25 || /زخرفي|خيط|فاصل|معين/.test(el.name);
  }
  return false;
}

/** Content blocks of a page: real, visible, non-furniture elements. */
export function contentBlocks(page: Page): CanvasEl[] {
  return page.elements
    .filter((el) => !el.hidden && CONTENT_TYPES.has(el.type))
    .filter((el) => !isFurniture(el) && !isOrnament(el))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A page's structural fingerprint: the sequence of content bands, each encoded
 * as type + horizontal bucket (L/C/R thirds) + width/height buckets. Two
 * pages with the same fingerprint are the SAME composition — the monotony
 * the engine exists to kill. Furniture and ornaments never count.
 */
export function pageFingerprint(page: Page): string {
  const size = pageSize(page);
  return contentBlocks(page)
    .map((el) => {
      const center = el.x + el.w / 2;
      const col = center < size.w / 3 ? "L" : center > (size.w * 2) / 3 ? "R" : "C";
      const wBucket = Math.max(1, Math.round(el.w / Math.max(1, size.w / 6)));
      const hBucket = Math.max(1, Math.round(el.h / 8));
      return `${TYPE_CODE[el.type] ?? "?"}${col}${wBucket}x${hBucket}`;
    })
    .join("|");
}

// ── Variety validator ──────────────────────────────────────────────────────

export interface LayoutSimilarity {
  /** Index of the earlier page (0-based). */
  a: number;
  /** Index of the later page (0-based). */
  b: number;
  identical: boolean;
  /** 0–1 multiset overlap of the two fingerprints. */
  score: number;
}

export interface LayoutVarietyReport {
  ok: boolean;
  /** 100 = every consecutive pair differs structurally. */
  score: number;
  pairs: LayoutSimilarity[];
  fingerprints: string[];
}

function jaccard(a: string, b: string): number {
  const left = a.split("|").filter(Boolean);
  const right = b.split("|").filter(Boolean);
  if (!left.length && !right.length) return 1;
  const count = new Map<string, number>();
  for (const band of left) count.set(band, (count.get(band) ?? 0) + 1);
  let shared = 0;
  for (const band of right) {
    const have = count.get(band) ?? 0;
    if (have > 0) {
      shared += 1;
      count.set(band, have - 1);
    }
  }
  return shared / Math.max(1, new Set([...left, ...right]).size);
}

/** Pages with fewer than two content blocks cannot be compared — skip them. */
function comparable(page: Page): boolean {
  return contentBlocks(page).length >= 2;
}

/**
 * THE validator (Layout Variety Check): verify that no two CONSECUTIVE pages
 * share a structure. A pair is monotonous when the fingerprints are identical
 * or overlap by ≥ 80%.
 */
export function checkLayoutVariety(project: Project): LayoutVarietyReport {
  const fingerprints = project.pages.map(pageFingerprint);
  const pairs: LayoutSimilarity[] = [];
  for (let i = 0; i + 1 < project.pages.length; i += 1) {
    if (!comparable(project.pages[i]) || !comparable(project.pages[i + 1])) continue;
    const identical = fingerprints[i] === fingerprints[i + 1];
    const score = identical ? 1 : jaccard(fingerprints[i], fingerprints[i + 1]);
    if (identical || score >= 0.8) {
      pairs.push({ a: i, b: i + 1, identical, score: Math.round(score * 100) / 100 });
    }
  }
  const score = Math.max(0, 100 - pairs.length * 20);
  return { ok: pairs.length === 0, score, pairs, fingerprints };
}

// ── Automatic secondary-pattern enforcement ────────────────────────────────

/**
 * Re-flow a page's existing content blocks into the secondary layout pattern.
 * Geometry only — no text is added, removed, or rewritten, so the structure
 * survives intact and every element stays fully editable.
 *
 *   · stacked full-width rows  → two-column grid (first half keeps the
 *     document's own column convention: left column first);
 *   · an existing column split → mirrored to the opposite side.
 */
export function applySecondaryLayout(page: Page): string | null {
  const size = pageSize(page);
  const blocks = contentBlocks(page);
  if (blocks.length < 2) return null;
  const m = Math.min(16, Math.max(10, Math.round(size.w * 0.06)));
  const contentW = size.w - m * 2;
  const fullWidth = blocks.every((el) => el.w >= contentW * 0.8);

  if (fullWidth) {
    const gap = Math.max(3, Math.round(contentW * 0.025));
    const colW = (contentW - gap) / 2;
    const top = Math.min(...blocks.map((el) => el.y));
    const columns: CanvasEl[][] = [[], []];
    blocks.forEach((el, index) => columns[index % 2].push(el));
    columns.forEach((column, columnIndex) => {
      let y = top;
      for (const el of column) {
        el.x = columnIndex === 0 ? m : m + colW + gap;
        el.w = Math.min(el.w, colW);
        el.y = Math.min(y, Math.max(top, size.h - 26 - el.h));
        y += el.h + gap;
      }
    });
    return "stacked-to-columns";
  }

  for (const el of blocks) {
    el.x = size.w - el.x - el.w;
  }
  return "mirrored-columns";
}

/** The pattern a page was generated with (majority vote of element meta). */
export function pagePattern(page: Page): LayoutPatternId | null {
  const counts = new Map<string, number>();
  for (const el of page.elements) {
    if (el.layout?.pattern) counts.set(el.layout.pattern, (counts.get(el.layout.pattern) ?? 0) + 1);
  }
  let best: LayoutPatternId | null = null;
  let bestCount = 0;
  for (const [pattern, count] of counts) {
    if (count > bestCount) {
      best = pattern as LayoutPatternId;
      bestCount = count;
    }
  }
  return best;
}

/** Next pattern for a page that must differ from BOTH of its neighbours. */
function nextDirectiveFor(project: Project, pageIndex: number): PageLayoutDirective {
  const neighbours = new Set<LayoutPatternId>();
  const before = pageIndex > 0 ? pagePattern(project.pages[pageIndex - 1]) : null;
  const after = pageIndex < project.pages.length - 1 ? pagePattern(project.pages[pageIndex + 1]) : null;
  if (before) neighbours.add(before);
  if (after) neighbours.add(after);
  const candidates: LayoutPatternId[] = [...INTERIOR_ROTATION, "hero-cover", "closing-endorsement"];
  const pattern = candidates.find((candidate) => !neighbours.has(candidate)) ?? "summary-callout";
  return directiveForPattern(pattern, pageIndex + 1);
}

export interface EnforceLayoutVarietyOptions {
  /**
   * Generator path: rebuild the offending page with the given directive
   * (fresh elements, real builders). When absent — the editor boundary path —
   * the page's existing elements are re-flowed by `applySecondaryLayout`.
   */
  rebuildPage?: (pageIndex: number, directive: PageLayoutDirective) => Page | null;
}

export interface EnforceLayoutVarietyResult {
  project: Project;
  /** Human-readable log of every automatic secondary pattern applied. */
  applied: string[];
  report: LayoutVarietyReport;
}

const MAX_ENFORCE_PASSES = 2;

/**
 * Run the variety check and, when two consecutive pages share a structure,
 * apply a secondary layout pattern AUTOMATICALLY. Bounded to two passes —
 * this is a safety net, never an open loop.
 */
export function enforceLayoutVariety(
  project: Project,
  options: EnforceLayoutVarietyOptions = {},
): EnforceLayoutVarietyResult {
  const current = clone(project);
  const applied: string[] = [];
  for (let pass = 0; pass < MAX_ENFORCE_PASSES; pass += 1) {
    const report = checkLayoutVariety(current);
    if (report.ok) return { project: current, applied, report };
    for (const pair of report.pairs) {
      const directive = nextDirectiveFor(current, pair.b);
      if (options.rebuildPage) {
        const rebuilt = options.rebuildPage(pair.b, directive);
        if (rebuilt) {
          current.pages[pair.b] = rebuilt;
          applied.push(
            `page ${pair.b + 1}: rebuilt with secondary pattern «${LAYOUT_PATTERN_META[directive.pattern].label}»`,
          );
          continue;
        }
      }
      const change = applySecondaryLayout(current.pages[pair.b]);
      if (change) applied.push(`page ${pair.b + 1}: secondary layout applied (${change})`);
    }
  }
  return { project: current, applied, report: checkLayoutVariety(current) };
}

// ── Per-element layout metadata ────────────────────────────────────────────

const FURNITURE_NAME = /ترويسة|تذييل|رقم الصفحة|خلفية الترويسة/;
const CALLOUT_NAME = /مقولة|اقتباس|مقتطف|ملخص|اعتماد|توقيع|ختم|صيغة الاعتماد/;
const STAT_NAME = /مؤشر|قيمة|اتجاه/;
const CARD_NAME = /بطاقة|محور|ركيزة|قرار|توصية|إطار/;

function marginOf(page: Page): number {
  const { w } = pageSize(page);
  return Math.min(16, Math.max(10, Math.round(w * 0.06)));
}

function classify(el: CanvasEl, page: Page, pattern: LayoutPatternId): ElementLayoutMeta {
  const size = pageSize(page);
  const m = marginOf(page);
  const contentW = size.w - m * 2;
  const centerRel = el.x - m + el.w / 2;
  const anchor: "right" | "left" | "center" | "full" =
    el.w >= contentW * 0.9 ? "full" : centerRel > contentW * 0.66 ? "right" : centerRel < contentW * 0.33 ? "left" : "center";
  const columnSpan: 1 | 2 | 3 = el.w >= contentW * 0.8 ? 3 : el.w >= contentW * 0.45 ? 2 : 1;
  const positioning = { anchor, columnSpan };
  const base = { pattern, positioning };

  if (isFurniture(el) || (el.type !== "text" && FURNITURE_NAME.test(el.name))) {
    return { role: "furniture", pattern };
  }
  if (isOrnament(el)) {
    return { role: "ornament", pattern, positioning };
  }
  if (el.type === "table") return { role: "table", hierarchy: 2, ...base };
  if (el.type === "image" || el.type === "logo") return { role: "image", hierarchy: 2, ...base };
  if (el.type === "stat") return { role: "stat-card", hierarchy: 2, ...base };
  if (CALLOUT_NAME.test(el.name)) return { role: "summary-callout", hierarchy: 2, ...base };
  if (STAT_NAME.test(el.name)) return { role: "stat-card", hierarchy: 2, ...base };
  if (CARD_NAME.test(el.name)) return { role: "accent-card", hierarchy: 2, ...base };
  if (el.type === "shape" && el.w > 20 && el.h > 10) return { role: "accent-card", hierarchy: 2, ...base };
  if (el.type === "text") {
    const sizePt = Number(el.style.fontSize || 0);
    if (sizePt >= 18) return { role: "heading", hierarchy: 1, ...base };
    if (sizePt >= 13) return { role: "heading", hierarchy: 2, ...base };
    return { role: "body", hierarchy: 3, ...base };
  }
  return { role: "body", hierarchy: 3, ...base };
}

/**
 * Stamp every element of a generated page with its independent
 * visual-distribution options: role (accent card / summary callout / heading /
 * body / …), hierarchy level, grid anchor and column span, and the page
 * pattern it belongs to. Pure metadata — geometry and content are untouched.
 */
export function stampLayoutMeta(page: Page, pattern: LayoutPatternId): void {
  for (const el of page.elements) {
    if (el.layout) continue;
    el.layout = classify(el, page, pattern);
  }
}
