/**
 * Design twin — plan, execute editable NASAQ elements, review, correct once
 * or twice, then stop. Gemini may supply art direction; the document is
 * always built by the existing layout engine and opened through the editor
 * command bridge. This module does not call the network.
 */

import { contrastRatio } from "@/lib/intelligence/analyze";
import { validateProject } from "@/lib/intelligence/layout";
import { checkLayoutVariety, enforceLayoutVariety } from "@/lib/intelligence/layout-variety";
import { generateDesignFromPrompt } from "@/lib/intelligence/pipeline";
import type { PromptAnalysis } from "@/lib/intelligence/prompt-analyzer";
import type { PaletteRoles } from "@/lib/intelligence/schema";
import { clone, pageSize, type CanvasEl, type Page, type Project } from "@/lib/editor/model";
import type { DesignBrief } from "./design-contract";
import {
  categoryFromBrief,
  constitutionRulesFor,
  DESIGN_CONSTITUTION_VERSION,
  imposeNasaqPalette,
  type DesignCategory,
} from "./design-constitution";
import { memoryAppliesToCategory, resolveMemory, type DesignMemoryView } from "./design-memory";

export const TWIN_MAX_ROUNDS = 2;

const NASAQ_PALETTE: PaletteRoles = {
  field: "#0F1E33",
  paper: "#F7F6F3",
  ink: "#172033",
  accent: "#006C35",
  muted: "#8A8175",
  onField: "#F7F6F3",
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const ARABIC = /[\u0600-\u06FF]/;

export interface TwinPlan {
  constitutionVersion: string;
  category: DesignCategory;
  format: "a4-book" | "wide-slide" | "tall-story";
  style: string;
  pages: number;
  contentDensity: "light" | "balanced" | "dense";
  imposeNasaqPalette: boolean;
  preserveCustomerBrand: boolean;
  visualDirection: string;
  confirmedRuleIds: string[];
}

export interface TwinIssue {
  code: string;
  severity: "blocker" | "major" | "minor";
  message: string;
  pageId?: string;
  elementId?: string;
}

export interface TwinRound {
  inspected: number;
  fixed: string[];
}

export interface TwinMetrics {
  pages: number;
  elements: number;
  valid: boolean;
  outOfBounds: number;
  rtlDefects: number;
  overlaps: number;
  contrastDefects: number;
  varietyOk: boolean;
  firstPassIssues: number;
  unresolved: number;
}

export interface TwinDelivery {
  constitutionVersion: string;
  source: "gemini" | "constitution";
  plan: TwinPlan;
  project: Project;
  rounds: TwinRound[];
  unresolved: TwinIssue[];
  metrics: TwinMetrics;
  providerMessage?: string;
}

export interface TwinExecutionInput {
  prompt: string;
  audience?: string;
  format?: TwinPlan["format"];
  category?: DesignCategory;
  pages?: number;
  maxPages?: number;
  geminiBrief?: DesignBrief | null;
  memory?: readonly DesignMemoryView[];
  providerMessage?: string;
}

export function planTwin(input: Pick<TwinExecutionInput, "prompt" | "format" | "category" | "pages" | "maxPages" | "geminiBrief" | "memory">): TwinPlan {
  const prompt = input.prompt.trim();
  const category = input.category ?? categoryFromBrief(`${prompt} ${input.geminiBrief?.topic ?? ""}`);
  const memory = resolveMemory((input.memory ?? []).filter((row) => memoryAppliesToCategory(row, category)));
  const brief = input.geminiBrief;
  let format: TwinPlan["format"] = input.format
    ?? (brief?.format === "wide-slide" || brief?.format === "tall-story" || brief?.format === "a4-book" ? brief.format : undefined)
    ?? (category === "presentation" ? "wide-slide" : category === "social" ? "tall-story" : "a4-book");
  if (memory.rules.format === "a4-book" || memory.rules.format === "wide-slide" || memory.rules.format === "tall-story") {
    if (!input.format) format = memory.rules.format;
  }
  let pages = input.pages ?? brief?.pages ?? (format === "wide-slide" ? 4 : format === "tall-story" ? 1 : 3);
  pages = Math.min(12, Math.max(1, Math.round(pages)));
  if (input.maxPages && input.maxPages > 0) pages = Math.min(pages, input.maxPages);
  let contentDensity: TwinPlan["contentDensity"] = brief?.contentDensity ?? "balanced";
  if (!brief && (memory.rules.density === "light" || memory.rules.density === "balanced" || memory.rules.density === "dense")) {
    contentDensity = memory.rules.density;
  }
  const customer = Boolean(memory.rules["customer-brand"]) || /عميل|هوية العميل|شعار العميل/.test(prompt);
  const nasaqPalette = imposeNasaqPalette(prompt) && !customer;
  const style = brief?.style
    ?? (category === "presentation"
      ? "presentation"
      : category === "editorial"
        ? "editorial"
        : category === "corporate-document" || category === "marketing"
          ? "corporate"
          : category === "brand-identity"
            ? "executive"
            : category === "social"
              ? "infographic"
              : "institutional");
  return {
    constitutionVersion: DESIGN_CONSTITUTION_VERSION,
    category,
    format,
    style,
    pages,
    contentDensity,
    imposeNasaqPalette: nasaqPalette,
    preserveCustomerBrand: customer || !nasaqPalette,
    visualDirection: [
      brief?.visualDirection || "",
      constitutionRulesFor(category).map((item) => item.text).slice(0, 4).join(" "),
      nasaqPalette ? "استخدم أخضر #006C35 والكحلي #0F1E33 والذهبي #C9A86A بوظيفة واضحة فقط." : "لا تفرض لوحة نَسَق على هذا العمل.",
    ].filter(Boolean).join(" "),
    confirmedRuleIds: constitutionRulesFor(category).map((item) => item.id),
  };
}

function elementsOf(page: Page): CanvasEl[] {
  const out: CanvasEl[] = [];
  const walk = (list: readonly CanvasEl[]) => {
    for (const el of list) {
      if (el.hidden) continue;
      if (el.type === "group" && el.children?.length) walk(el.children);
      else out.push(el);
    }
  };
  walk(page.elements);
  return out;
}

function countElements(project: Project): number {
  return project.pages.reduce((total, page) => total + elementsOf(page).length, 0);
}

function outside(el: CanvasEl, w: number, h: number): boolean {
  return el.x < -1 || el.y < -1 || el.x + el.w > w + 1 || el.y + el.h > h + 1;
}

function intersectionRatio(a: CanvasEl, b: CanvasEl): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const smaller = Math.max(1, Math.min(Math.abs(a.w * a.h), Math.abs(b.w * b.h)));
  return (x * y) / smaller;
}

const TEXTUAL = new Set(["text", "box", "stat", "table"]);

export function reviewDesign(project: Project): TwinIssue[] {
  const issues: TwinIssue[] = [];
  for (const problem of validateProject(project)) {
    issues.push({ code: "invalid", severity: "blocker", message: problem });
  }
  const variety = checkLayoutVariety(project);
  if (!variety.ok) {
    issues.push({
      code: "variety",
      severity: "major",
      message: "صفحتان متتاليتان تشتركان في الهيكل نفسه.",
    });
  }
  project.pages.forEach((page, index) => {
    const size = pageSize(page);
    const els = elementsOf(page);
    if (!els.length) {
      issues.push({
        code: "empty-page",
        severity: "blocker",
        pageId: page.id,
        message: `الصفحة ${index + 1} بلا عناصر.`,
      });
    }
    for (const el of els) {
      const hairline = el.type === "line" || el.type === "divider";
      if (![el.x, el.y, el.w, el.h].every((value) => Number.isFinite(value)) || el.w < 0 || el.h < 0) {
        issues.push({
          code: "geometry",
          severity: "blocker",
          pageId: page.id,
          elementId: el.id,
          message: `«${el.name || el.type}» أبعاده غير صالحة.`,
        });
        continue;
      }
      if (hairline ? el.w < 0.2 && el.h < 0.2 : el.w < 1 || el.h < 1) {
        issues.push({
          code: "geometry",
          severity: "major",
          pageId: page.id,
          elementId: el.id,
          message: `«${el.name || el.type}» بلا سماكة مرئية.`,
        });
        continue;
      }
      const area = Math.abs(el.w * el.h);
      const fullBleed = area >= size.w * size.h * 0.9;
      if (!fullBleed && outside(el, size.w, size.h)) {
        issues.push({
          code: "out-of-bounds",
          severity: "major",
          pageId: page.id,
          elementId: el.id,
          message: `«${el.name || el.type}» يخرج عن حدود الصفحة ${index + 1}.`,
        });
      }
      if (ARABIC.test(el.content || "") && (el.style.textAlign === "left" || el.style.direction === "ltr")) {
        issues.push({
          code: "rtl",
          severity: "major",
          pageId: page.id,
          elementId: el.id,
          message: `النص العربي في «${el.name || el.type}» ليس باتجاه RTL.`,
        });
      }
      if (
        HEX.test(el.style.color || "") &&
        HEX.test(el.style.fill || "") &&
        contrastRatio(el.style.color || "", el.style.fill || "") < 3
      ) {
        issues.push({
          code: "contrast",
          severity: "major",
          pageId: page.id,
          elementId: el.id,
          message: `تباين «${el.name || el.type}» أضعف من 3:1.`,
        });
      }
    }
    const textual = els.filter((el) => TEXTUAL.has(el.type) && (el.content || "").trim());
    for (let i = 0; i < textual.length; i += 1) {
      for (let j = i + 1; j < textual.length; j += 1) {
        if (intersectionRatio(textual[i], textual[j]) >= 0.4) {
          issues.push({
            code: "overlap",
            severity: "major",
            pageId: page.id,
            elementId: textual[j].id,
            message: `«${textual[j].name || textual[j].type}» يتداخل مع عنصر نصي آخر.`,
          });
        }
      }
    }
  });
  return issues;
}

function onFill(fill: string): string {
  const raw = fill.replace("#", "");
  const channel = (start: number) => Number.parseInt(raw.slice(start, start + 2), 16) / 255;
  const luma = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luma > 0.62 ? "#172033" : "#F7F6F3";
}

function findMutable(project: Project, id: string): CanvasEl | undefined {
  const walk = (list: CanvasEl[]): CanvasEl | undefined => {
    for (const el of list) {
      if (el.id === id) return el;
      if (el.children?.length) {
        const hit = walk(el.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  for (const page of project.pages) {
    const hit = walk(page.elements);
    if (hit) return hit;
  }
  return undefined;
}

/** Safe geometry and RTL fixes only. Content strings are not rewritten. */
export function correctDesign(project: Project, issues: readonly TwinIssue[]): { project: Project; fixed: string[] } {
  const next = clone(project);
  const fixed: string[] = [];
  if (issues.some((issue) => issue.code === "variety")) {
    const enforced = enforceLayoutVariety(next);
    if (enforced.applied.length) {
      fixed.push(...enforced.applied.map((item) => `variety:${item}`));
      return { project: enforced.project, fixed };
    }
  }
  for (const issue of issues) {
    if (!issue.elementId) continue;
    if (issue.code !== "out-of-bounds" && issue.code !== "rtl" && issue.code !== "contrast" && issue.code !== "overlap" && issue.code !== "geometry") continue;
    const el = findMutable(next, issue.elementId);
    const page = next.pages.find((item) => item.id === issue.pageId) ?? next.pages.find((item) => elementsOf(item).some((child) => child.id === issue.elementId));
    if (!el || !page) continue;
    const size = pageSize(page);
    if (issue.code === "rtl") {
      el.style.textAlign = "right";
      el.style.direction = "rtl";
      fixed.push(`rtl:${el.id}`);
    } else if (issue.code === "geometry" && (el.type === "line" || el.type === "divider")) {
      if (el.h < 0.3 && el.w >= 1) el.h = 0.4;
      else if (el.w < 0.3 && el.h >= 1) el.w = 0.4;
      else continue;
      fixed.push(`geometry:${el.id}`);
    } else if (issue.code === "contrast" && HEX.test(el.style.fill || "")) {
      el.style.color = onFill(el.style.fill || "#ffffff");
      fixed.push(`contrast:${el.id}`);
    } else if (issue.code === "out-of-bounds") {
      const margin = 4;
      el.w = Math.max(4, Math.min(el.w, size.w - margin * 2));
      el.h = Math.max(4, Math.min(el.h, size.h - margin * 2));
      el.x = Math.min(Math.max(el.x, margin), Math.max(margin, size.w - margin - el.w));
      el.y = Math.min(Math.max(el.y, margin), Math.max(margin, size.h - margin - el.h));
      fixed.push(`bounds:${el.id}`);
    } else if (issue.code === "overlap") {
      const room = size.h - 4 - (el.y + el.h);
      const shift = Math.min(12, Math.max(0, room));
      if (shift >= 4) {
        el.y += shift;
        fixed.push(`overlap:${el.id}`);
      }
    }
  }
  return { project: next, fixed };
}

export function cycleDesign(project: Project): { project: Project; rounds: TwinRound[]; unresolved: TwinIssue[]; firstPassIssues: number } {
  let current = clone(project);
  const firstPassIssues = reviewDesign(current).length;
  const rounds: TwinRound[] = [];
  for (let round = 0; round < TWIN_MAX_ROUNDS; round += 1) {
    const issues = reviewDesign(current);
    const actionable = issues.filter((issue) => issue.severity !== "minor");
    if (!actionable.length) {
      rounds.push({ inspected: issues.length, fixed: [] });
      return { project: current, rounds, unresolved: issues, firstPassIssues };
    }
    const corrected = correctDesign(current, actionable);
    rounds.push({ inspected: issues.length, fixed: corrected.fixed });
    if (!corrected.fixed.length) {
      return { project: current, rounds, unresolved: issues, firstPassIssues };
    }
    current = corrected.project;
  }
  return { project: current, rounds, unresolved: reviewDesign(current), firstPassIssues };
}

function metricsOf(project: Project, unresolved: TwinIssue[], firstPassIssues: number): TwinMetrics {
  const codes = unresolved.map((issue) => issue.code);
  return {
    pages: project.pages.length,
    elements: countElements(project),
    valid: validateProject(project).length === 0,
    outOfBounds: codes.filter((code) => code === "out-of-bounds").length,
    rtlDefects: codes.filter((code) => code === "rtl").length,
    overlaps: codes.filter((code) => code === "overlap").length,
    contrastDefects: codes.filter((code) => code === "contrast").length,
    varietyOk: checkLayoutVariety(project).ok,
    firstPassIssues,
    unresolved: unresolved.length,
  };
}

export function executeDesignTwin(input: TwinExecutionInput): TwinDelivery {
  const prompt = input.prompt.trim();
  const plan = planTwin(input);
  const source = input.geminiBrief ? "gemini" : "constitution";
  const overrides: Record<string, unknown> = {
    topic: input.geminiBrief?.topic || prompt.slice(0, 120),
    style: plan.style,
    format: plan.format,
    pages: plan.pages,
    contentDensity: plan.contentDensity,
    visualDirection: plan.visualDirection,
  };
  if (input.geminiBrief?.title) overrides.title = input.geminiBrief.title;
  if (input.geminiBrief?.subtitle) overrides.subtitle = input.geminiBrief.subtitle;
  if (input.geminiBrief?.org) overrides.org = input.geminiBrief.org;
  if (input.geminiBrief?.coverStyle) overrides.coverStyle = input.geminiBrief.coverStyle;
  if (input.geminiBrief) overrides.bilingual = input.geminiBrief.bilingual;
  if (input.geminiBrief?.pageLayouts) overrides.pageLayouts = input.geminiBrief.pageLayouts;
  if (plan.imposeNasaqPalette) overrides.palette = NASAQ_PALETTE;
  const generated = generateDesignFromPrompt(prompt, overrides as Partial<PromptAnalysis>);
  const cycled = cycleDesign(generated.primaryResult.project);
  return {
    constitutionVersion: plan.constitutionVersion,
    source,
    plan,
    project: cycled.project,
    rounds: cycled.rounds,
    unresolved: cycled.unresolved,
    metrics: metricsOf(cycled.project, cycled.unresolved, cycled.firstPassIssues),
    providerMessage: input.providerMessage,
  };
}

export interface TwinBenchmarkBrief {
  id: string;
  category: DesignCategory;
  prompt: string;
  format?: TwinPlan["format"];
  pages: number;
}

/** Stable briefs. Scores come from running them, not from a promised target. */
export const TWIN_BENCHMARKS: readonly TwinBenchmarkBrief[] = [
  { id: "report", category: "institutional-report", prompt: "تقرير مؤسسي عربي من صفحتين عن جاهزية موسم الحج دون أرقام مخترعة", pages: 2 },
  { id: "corporate", category: "corporate-document", prompt: "ملف تعريفي لشركة العميل من صفحتين، حافظ على هوية العميل ولا تستخدم شعار نَسَق", pages: 2 },
  { id: "slides", category: "presentation", prompt: "عرض تقديمي عربي من شريحتين عن خطة التحول الرقمي", format: "wide-slide", pages: 2 },
  { id: "editorial", category: "editorial", prompt: "افتتاحية تحريرية عربية من صفحتين عن المدن الجديدة", pages: 2 },
  { id: "story", category: "social", prompt: "قصة إنستغرام عربية واحدة لإعلان موعد التسجيل", format: "tall-story", pages: 1 },
  { id: "marketing", category: "marketing", prompt: "مادة تسويقية عربية من صفحة واحدة لخدمة استشارية", pages: 1 },
  { id: "identity", category: "brand-identity", prompt: "لوحة هوية بصرية لجهة العميل من صفحة واحدة تعرض الاسم والألوان كما وردت", pages: 1 },
  { id: "minutes", category: "institutional-report", prompt: "محضر اجتماع عربي من صفحتين بدون قرارات غير مذكورة", pages: 2 },
  { id: "bilingual", category: "corporate-document", prompt: "ملخص تنفيذي ثنائي اللغة عربي وإنجليزي من صفحتين لشركة العميل", pages: 2 },
  { id: "nasaq", category: "brand-identity", prompt: "لوحة هوية داخلية لنَسَق NASAQ من صفحة واحدة بالأخضر والكحلي والذهبي", pages: 1 },
];

export interface TwinBenchmarkRow {
  id: string;
  category: DesignCategory;
  source: TwinDelivery["source"];
  pages: number;
  elements: number;
  valid: boolean;
  varietyOk: boolean;
  rtlDefects: number;
  outOfBounds: number;
  overlaps: number;
  firstPassIssues: number;
  unresolved: number;
  rounds: number;
  nasaqPalette: boolean;
  roundTripOk: boolean;
}

export interface TwinBenchmarkReport {
  constitutionVersion: string;
  briefs: number;
  rows: TwinBenchmarkRow[];
  valid: number;
  rtlClean: number;
  inBounds: number;
  roundTripOk: number;
}

export function runDesignTwinBenchmarks(): TwinBenchmarkReport {
  const rows = TWIN_BENCHMARKS.map((brief) => {
    const delivery = executeDesignTwin({
      prompt: brief.prompt,
      category: brief.category,
      format: brief.format,
      pages: brief.pages,
      maxPages: brief.pages,
    });
    const restored = JSON.parse(JSON.stringify(delivery.project)) as Project;
    return {
      id: brief.id,
      category: brief.category,
      source: delivery.source,
      pages: delivery.metrics.pages,
      elements: delivery.metrics.elements,
      valid: delivery.metrics.valid && validateProject(restored).length === 0,
      varietyOk: delivery.metrics.varietyOk,
      rtlDefects: delivery.metrics.rtlDefects,
      outOfBounds: delivery.metrics.outOfBounds,
      overlaps: delivery.metrics.overlaps,
      firstPassIssues: delivery.metrics.firstPassIssues,
      unresolved: delivery.metrics.unresolved,
      rounds: delivery.rounds.length,
      nasaqPalette: delivery.plan.imposeNasaqPalette,
      roundTripOk: restored.pages.length === delivery.project.pages.length
        && countElements(restored) === delivery.metrics.elements,
    };
  });
  return {
    constitutionVersion: DESIGN_CONSTITUTION_VERSION,
    briefs: rows.length,
    rows,
    valid: rows.filter((row) => row.valid).length,
    rtlClean: rows.filter((row) => row.rtlDefects === 0).length,
    inBounds: rows.filter((row) => row.outOfBounds === 0).length,
    roundTripOk: rows.filter((row) => row.roundTripOk).length,
  };
}
