/*
 * RAW TEXT → COMPOSED NASAQ DOCUMENT — the pipeline, wired once.
 *
 * This module is deliberately thin. It contains no composer, no critic and no
 * measurement of its own; it is the seam that connects four things that already
 * existed separately:
 *
 *   analyseRawText   → `analyzeRawContent`  (what the paste actually contains)
 *   composeFromText  → `composeText`        (the reference composer, generalized)
 *   the "before"     → `literalTextDraft`   (the critic's cramped baseline)
 *   the improvement  → `runLoop`            (the standard critic + gated fixes)
 *
 * WHY THE SPLIT MATTERS
 * ---------------------
 * The reference path (`improveReference`) and the raw-content path (this file)
 * must produce the same *kind* of document and be judged by the same critic, or
 * the «قبل/بعد» numbers shown to a visitor would not mean anything. Duplicating
 * the composer here would have made a second, quietly-diverging product.
 */

import { pageSize, type Project } from "@/lib/editor/model";
import { compareQuality, critiqueProject } from "./critic";
import { paletteForStyle } from "./dna";
import {
  composeText,
  literalTextDraft,
  splitCopy,
  type TextComposition,
} from "./layout";
import { runLoop } from "./pipeline";
import {
  analyzeRawContent,
  RAW_MAX_SECTIONS,
  type RawContentAnalysis,
} from "./raw-content";
import type {
  DesignFormat,
  ImprovementVerdict,
  PaletteRoles,
  PipelineResult,
} from "./schema";

/** The measurement, under the name the public page uses. */
export function analyseRawText(raw: string): RawContentAnalysis {
  return analyzeRawContent(raw);
}

/** A4 portrait, the size every institutional NASAQ document starts from. */
export const RAW_PAGE = { w: 210, h: 297 } as const;

const DEFAULTS: Required<Pick<TextComposition, "w" | "h" | "total" | "format" | "palette" | "orgLine" | "subtitle">> = {
  w: RAW_PAGE.w,
  h: RAW_PAGE.h,
  total: 1,
  format: "a4-book",
  palette: paletteForStyle("institutional"),
  orgLine: "",
  subtitle: "",
};

/**
 * Compose a real document out of a title plus the paste's own lines.
 * `lines` is the raw text split on newlines — order preserved, nothing added.
 */
export function composeFromText(
  input: {
    title: string;
    lines: string[];
    total?: number;
    format?: DesignFormat;
    palette?: PaletteRoles;
    w?: number;
    h?: number;
    orgLine?: string;
  },
): Project {
  const copy = splitCopy(input.title, input.lines);
  return composeText({
    ...DEFAULTS,
    ...copy,
    w: input.w ?? DEFAULTS.w,
    h: input.h ?? DEFAULTS.h,
    total: input.total ?? DEFAULTS.total,
    format: input.format ?? DEFAULTS.format,
    palette: input.palette ?? DEFAULTS.palette,
    orgLine: input.orgLine ?? DEFAULTS.orgLine,
  });
}

export interface RawTextInput {
  text: string;
  /** The author's own title; the paste's first heading is used when absent. */
  title?: string;
  /** Pages requested by the author. Capped by the section budget, never padded. */
  total?: number;
  orgLine?: string;
  palette?: PaletteRoles;
}

export interface RawDocumentResult extends PipelineResult {
  /** The same content as a cramped literal dump — the critic's baseline. */
  before: Project;
  /** The composed, corrected, critic-approved document. */
  after: Project;
  verdict: ImprovementVerdict;
  measurement: RawContentAnalysis;
}

function filledLines(text: string): string[] {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The whole raw-content story in one call: measure → compose → critique.
 *
 * Nothing is invented. Every line the composer writes comes from the paste; the
 * verdict says plainly which of the author's lines survived and by how much the
 * standard score moved, exactly as the reference path reports.
 */
export function improveRawText(input: RawTextInput): RawDocumentResult {
  const measurement = analyzeRawContent(input.text);
  const lines = filledLines(input.text);
  const title = input.title?.trim() || measurement.suggestedTitle || "مستند جديد";
  const total = Math.max(
    1,
    Math.min(Math.round(input.total ?? 1), RAW_MAX_SECTIONS + 1),
  );

  const copy = splitCopy(title, lines);
  const origin = {
    title,
    lines,
    total,
    format: "a4-book" as const,
    palette: input.palette ?? DEFAULTS.palette,
    orgLine: input.orgLine ?? "",
  };

  const before = literalTextDraft(title, lines, RAW_PAGE.w, RAW_PAGE.h);
  const beforeCritique = critiqueProject(before);
  const loop = runLoop(composeFromText(origin), title, "improve");
  const after = loop.project;

  const sizeAfter = pageSize(after.pages[0]);
  const written = after.pages
    .flatMap((page) => page.elements.map((element) => element.content || ""))
    .join("\n");
  const contentKept =
    copy.body.every((line) => written.includes(line)) &&
    copy.meta.every((line) => written.includes(line));
  const titleKept = written.includes(title) || after.name.includes(title);
  const sizeKept =
    Math.abs(sizeAfter.w - RAW_PAGE.w) < 0.2 &&
    Math.abs(sizeAfter.h - RAW_PAGE.h) < 0.2 &&
    after.pages.length === total;
  const compared = compareQuality(beforeCritique, loop.critique);
  const realImprovement = contentKept && sizeKept && compared.realImprovement;

  return {
    ...loop,
    before,
    after,
    measurement,
    verdict: {
      sizeKept,
      titleKept,
      contentKept,
      scoreBefore: beforeCritique.score,
      scoreAfter: loop.critique.score,
      axesBefore: beforeCritique.axes,
      axesAfter: loop.critique.axes,
      improvedAxes: compared.improvedAxes,
      realImprovement,
      notes: [
        "المقارنة بين نقل حرفي لسطورك وبين تكوين مؤسسي على A4 بنفس المحتوى. لا معلومة أُضيفت.",
        contentKept
          ? "كل سطر من نصك ما زال في المستند."
          : "سقط سطر من نصك — النتيجة لا تُعتمد كتحسين.",
        sizeKept
          ? `المقاس A4 وعدد الصفحات (${total}) محفوظان.`
          : "المقاس أو عدد الصفحات تغيّر — هذا ليس تحسينًا مقبولًا.",
        realImprovement
          ? `الدرجة ارتفعت من ${beforeCritique.score} إلى ${loop.critique.score}.`
          : "الدرجة لم ترتفع بما يكفي. لا تُعتمد النسخة كتحسين.",
      ],
    },
  };
}
