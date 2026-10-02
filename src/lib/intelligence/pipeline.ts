import { clone, pageSize, type Project } from "@/lib/editor/model";
import { REFERENCE_FACTS } from "./corpus/references";
import { analyzeFacts } from "./analyze";
import { applySafeFixes, critiqueProject } from "./critic";
import { buildDesignDna } from "./dna";
import { composeReference, generateOriginal, literalDraft } from "./layout";
import type { DesignAnalysis, DesignBrief, DesignDna, PipelineResult } from "./schema";
import { INTELLIGENCE_SCHEMA_VERSION } from "./schema";

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

function runLoop(project: Project, label: string, path: PipelineResult["path"]): PipelineResult {
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
    const fixed = applySafeFixes(current);
    iterations.push({ score: critique.score, applied: fixed.corrections });
    if (!fixed.corrections.length) {
      current = fixed.project;
      stopped = "no-safe-fix";
      break;
    }
    current = fixed.project;
  }

  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    path,
    label,
    projectName: current.name,
    iterations,
    critique: critiqueProject(current),
    stoppedBecause: stopped,
  };
}

export function generateTemplate(brief: DesignBrief): PipelineResult & { project: Project } {
  const project = generateOriginal(brief);
  const result = runLoop(project, brief.title, "generate");
  return { ...result, project: resultProject(project, result) };
}

function resultProject(start: Project, result: PipelineResult): Project {
  let current = clone(start);
  if (result.iterations.some((step) => step.applied.length)) {
    for (let round = 0; round < result.iterations.length; round += 1) {
      if (!result.iterations[round].applied.length && result.stoppedBecause === "stable") break;
      const fixed = applySafeFixes(current);
      if (!fixed.corrections.length) break;
      current = fixed.project;
    }
  }
  return current;
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
  const composed = composeReference(analysis);
  const loop = runLoop(composed, analysis.title, "improve");
  const project = resultProject(composed, loop);
  const after = loop.critique;
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
  const real = titleKept && sizeKept && after.score > beforeCritique.score;
  return {
    ...loop,
    project,
    verdict: {
      sizeKept,
      titleKept,
      contentKept,
      scoreBefore: beforeCritique.score,
      scoreAfter: after.score,
      realImprovement: real,
      notes: [
        "المقارنة بين نقل حرفي للنص المستخرج وبين النسخة المركّبة. الملف الأصلي بلا طبقات.",
        sizeKept
          ? "المقاس الغالب وعدد الصفحات محفوظان."
          : "المقاس أو عدد الصفحات تغيّر — هذا ليس تحسينًا مقبولًا.",
        titleKept ? "العنوان المستخرج ما زال في المستند." : "العنوان المستخرج سقط من النسخة المطورة.",
        real
          ? `الدرجة ارتفعت من ${beforeCritique.score} إلى ${after.score}.`
          : "الدرجة لم ترتفع. لا تُعتمد النسخة كتطوير.",
        ...analysis.limitations,
      ],
    },
  };
}

/** Improve a document that is already a NASAQ project. Content and size stay. */
export function improveProject(project: Project, label = project.name): PipelineResult & { project: Project } {
  const beforeScore = critiqueProject(project).score;
  const beforeTexts = JSON.stringify(project.pages.map((page) => page.elements.map((el) => el.content)));
  const beforeSize = project.pages.map((page) => pageSize(page));
  const loop = runLoop(project, label, "improve");
  const next = resultProject(project, loop);
  const afterTexts = JSON.stringify(next.pages.map((page) => page.elements.map((el) => el.content)));
  const sizeKept = beforeSize.every((size, index) => {
    const now = pageSize(next.pages[index]);
    return Math.abs(now.w - size.w) < 0.2 && Math.abs(now.h - size.h) < 0.2;
  });
  return {
    ...loop,
    project: next,
    verdict: {
      sizeKept,
      titleKept: next.name === project.name,
      contentKept: beforeTexts === afterTexts && next.pages.length === project.pages.length,
      scoreBefore: beforeScore,
      scoreAfter: loop.critique.score,
      realImprovement: sizeKept && beforeTexts === afterTexts && loop.critique.score >= beforeScore,
      notes: [
        "المسار يعمل على مشروع NASAQ موجود. النصوص والمقاس لا يتغيران.",
        loop.critique.score > beforeScore
          ? "التقييم القياسي تحسن بعد التصحيح."
          : "لم تُوجد مشاكل قابلة للتصحيح، أو الدرجة لم تنخفض.",
      ],
    },
  };
}
