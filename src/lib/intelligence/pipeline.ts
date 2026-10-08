import { clone, pageSize, type Project } from "@/lib/editor/model";
import { REFERENCE_FACTS } from "./corpus/references";
import { analyzeFacts } from "./analyze";
import { applyGatedFixes, compareQuality, critiqueProject } from "./critic";
import { buildDesignDna } from "./dna";
import { composeReference, generateOriginal, literalDraft } from "./layout";
import type { DesignAnalysis, DesignBrief, DesignDna, PipelineResult } from "./schema";
import { INTELLIGENCE_SCHEMA_VERSION } from "./schema";
import { parsePrompt, type PromptAnalysis } from "./prompt-analyzer";
import { generateFromIntent } from "./design-generator";
import { generateVariations, type DesignVariation } from "./variations";
import { checkLayoutVariety, type LayoutVarietyReport } from "./layout-variety";
import {
  applyBrandToIntent,
  applyBrandToProject,
  brandIsConfigured,
} from "@/lib/editor/brand-design";
import type { BrandKit } from "@/lib/product/product";

/** Two correction passes, then a final critique. Not an open loop. */
export const MAX_APPLY_ROUNDS = 2;

const ANALYSES = analyzeFacts(REFERENCE_FACTS);
const DNA = buildDesignDna(ANALYSES);

export function referenceAnalyses(): DesignAnalysis[] {
  return ANALYSES;
}

export function referenceById(id: string): DesignAnalysis | undefined {
  return ANALYSES.find((item) => item.id === id);
}

export function designDna(): DesignDna {
  return DNA;
}

export function runLoop(
  project: Project,
  label: string,
  path: PipelineResult["path"],
): PipelineResult & { project: Project } {
  let current = clone(project);
  const iterations: PipelineResult["iterations"] = [];
  let stopped: PipelineResult["stoppedBecause"] = "max-iterations";

  for (let round = 0; round < MAX_APPLY_ROUNDS; round += 1) {
    const critique = critiqueProject(current);
    const serious = critique.issues.some((item) => item.severity !== "low");
    if (!serious) {
      iterations.push({ score: critique.score, applied: [] });
      stopped = "stable";
      break;
    }
    const gated = applyGatedFixes(current);
    iterations.push({ score: critique.score, applied: gated.corrections });
    if (!gated.accepted) {
      stopped = "no-safe-fix";
      break;
    }
    current = gated.project;
  }

  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    path,
    label,
    projectName: current.name,
    iterations,
    critique: critiqueProject(current),
    stoppedBecause: stopped,
    project: current,
  };
}

export function generateTemplate(brief: DesignBrief): PipelineResult & { project: Project } {
  return runLoop(generateOriginal(brief), brief.title, "generate");
}

export interface StudioGenerationResult {
  intent: PromptAnalysis;
  primaryResult: PipelineResult & { project: Project };
  variations: DesignVariation[];
  /** Layout Variety Check over the primary project: no two consecutive pages
   * share a structure (the anti-monotony guarantee). */
  layoutVariety: LayoutVarietyReport;
}

/**
 * Primary Natural-Language Prompt -> Production-Ready NASAQ Design
 *
 * `brand` is the institutional identity from «الهوية». When it is supplied —
 * and the caller has already checked the `brand_kit` entitlement — the palette
 * is injected into the intent BEFORE any
 * builder runs, so the cover, the KPI boards, the tables and the closing page
 * are all generated in the organisation's own colours, and the identity's fonts
 * are applied to the finished pages. No builder needed to know about it.
 */
export function generateDesignFromPrompt(
  prompt: string,
  overrides?: Partial<PromptAnalysis>,
  brand?: BrandKit | null,
): StudioGenerationResult {
  const parsed = parsePrompt(prompt);
  const base: PromptAnalysis = {
    ...parsed,
    ...(overrides || {}),
  };
  const identity = brand && brandIsConfigured(brand) ? brand : null;
  const intent = identity ? applyBrandToIntent(base, identity) : base;

  const initialProject = generateFromIntent(intent);
  const primary = runLoop(initialProject, intent.title, "generate");
  const primaryResult = identity
    ? {
        ...primary,
        project: applyBrandToProject(primary.project, identity, {
          from: intent.palette,
        }),
      }
    : primary;
  const variations = generateVariations(
    intent,
    identity ? intent.palette : undefined,
  ).map((variation) =>
    identity
      ? {
          ...variation,
          project: applyBrandToProject(variation.project, identity, {
            from: variation.palette,
          }),
        }
      : variation,
  );

  return {
    intent,
    primaryResult,
    variations,
    layoutVariety: checkLayoutVariety(primaryResult.project),
  };
}

/**
 * Improve path.
 *
 * The PDF is not a NASAQ document, so the "before" is a literal dump of the
 * extracted words (cramped, left-aligned). The "after" is a composed document
 * in the measured size and palette, then the critic. Wording that was
 * extracted is kept. Nothing that was not extracted is presented as fact.
 */
export function improveReference(id: string): (PipelineResult & { project: Project }) | null {
  const analysis = referenceById(id);
  if (!analysis) return null;
  const before = literalDraft(analysis);
  const beforeCritique = critiqueProject(before);
  const loop = runLoop(composeReference(analysis), analysis.title, "improve");
  const project = loop.project;
  const after = loop.critique;
  const compared = compareQuality(beforeCritique, after);
  const size = pageSize(project.pages[0]);
  const written = project.pages
    .flatMap((page) => page.elements.map((el) => el.content || ""))
    .join("\n");
  const titleKept = written.includes(analysis.title);
  const contentKept = analysis.extractedLines.slice(0, 6).every((line) => written.includes(line));
  const sizeKept =
    Math.abs(size.w - analysis.document.primary.w) < 0.2 &&
    Math.abs(size.h - analysis.document.primary.h) < 0.2 &&
    project.pages.length === analysis.document.pages;
  const real = titleKept && sizeKept && compared.realImprovement;
  return {
    ...loop,
    project,
    verdict: {
      sizeKept,
      titleKept,
      contentKept,
      scoreBefore: beforeCritique.score,
      scoreAfter: after.score,
      axesBefore: beforeCritique.axes,
      axesAfter: after.axes,
      improvedAxes: compared.improvedAxes,
      realImprovement: real,
      notes: [
        "المقارنة بين نقل حرفي للنص المستخرج وبين تكوين جديد على نفس المقاس والألوان. الملف الأصلي بلا طبقات.",
        sizeKept
          ? "المقاس الغالب وعدد الصفحات محفوظان."
          : "المقاس أو عدد الصفحات تغيّر — هذا ليس تحسينًا مقبولًا.",
        titleKept ? "العنوان المستخرج ما زال في المستند." : "العنوان المستخرج سقط من النسخة المطورة.",
        contentKept ? "الأسطر المستخرجة الأولى ما زالت في المستند." : "سقط سطر مستخرج من النسخة المطورة.",
        real
          ? `الدرجة ارتفعت من ${beforeCritique.score} إلى ${after.score}. المحاور التي تحسنت: ${compared.improvedAxes.join("، ") || "لا محور منفرد"}.`
          : "الدرجة لم ترتفع أو تراجعت السلامة البنيوية. لا تُعتمد النسخة كتطوير.",
        ...analysis.limitations,
      ],
    },
  };
}

/** Improve a document that is already a NASAQ project. Content and size stay. */
export function improveProject(project: Project, label = project.name): PipelineResult & { project: Project } {
  const beforeCritique = critiqueProject(project);
  const beforeTexts = JSON.stringify(project.pages.map((page) => page.elements.map((el) => el.content)));
  const beforeSize = project.pages.map((page) => pageSize(page));
  const loop = runLoop(project, label, "improve");
  const next = loop.project;
  const afterTexts = JSON.stringify(next.pages.map((page) => page.elements.map((el) => el.content)));
  const sizeKept = beforeSize.every((size, index) => {
    const now = pageSize(next.pages[index]);
    return Math.abs(now.w - size.w) < 0.2 && Math.abs(now.h - size.h) < 0.2;
  });
  const compared = compareQuality(beforeCritique, loop.critique);
  const contentKept = beforeTexts === afterTexts && next.pages.length === project.pages.length;
  return {
    ...loop,
    project: next,
    verdict: {
      sizeKept,
      titleKept: next.name === project.name,
      contentKept,
      scoreBefore: beforeCritique.score,
      scoreAfter: loop.critique.score,
      axesBefore: beforeCritique.axes,
      axesAfter: loop.critique.axes,
      improvedAxes: compared.improvedAxes,
      realImprovement: sizeKept && contentKept && loop.critique.score >= beforeCritique.score,
      notes: [
        "المسار يعمل على مشروع NASAQ موجود. النصوص والمقاس لا يتغيران.",
        loop.critique.score > beforeCritique.score
          ? "التقييم القياسي تحسن بعد التصحيح، والتصحيح الذي يخفض الدرجة يُرفض."
          : "لم تُوجد مشاكل قابلة للتصحيح دون خفض الدرجة.",
      ],
    },
  };
}
