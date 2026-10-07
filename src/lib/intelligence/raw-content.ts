/*
 * RAW CONTENT → STRUCTURE — the measurement, before anything is generated.
 *
 * WHY MEASURE FIRST
 * -----------------
 * "Turn my paste into a document" must not mean "let a model guess what my text
 * says". This module reads the author's own text and reports ONLY what is
 * observable in it: how much there is, which lines look like headings, which
 * look like bullets, which contain numbers, and whether a table is already
 * delimited in the paste. The AI step then REORDERS that content; it is never
 * asked to supply facts the paste does not contain.
 *
 * The fallback draft is built from the same measurements, so a deployment
 * without an AI key still gets a real, honest document — "النص كما هو، مرتّبًا",
 * clearly labelled as such — instead of an error or an invention.
 */

import { parsePastedTable } from "@/lib/editor/tables";
import type { ReportDraft, ReportDraftSection } from "@/lib/ai/contract";

export interface RawContentAnalysis {
  chars: number;
  words: number;
  lines: number;
  paragraphs: number;
  /** Short, standalone lines — the paste's own candidate titles and headings. */
  headings: string[];
  /** Lines the author already wrote as bullets or numbered items. */
  bullets: string[];
  /** Tokens that carry figures, dates or percentages — evidence, not decoration. */
  numbers: string[];
  /** A delimited paste (tab/pipe/semicolon/comma) recognised as a table. */
  tableRows: string[][];
  /** The first usable line, offered as the document's title. */
  suggestedTitle: string;
}

/** A single-page draft cannot honestly preserve an unbounded provider payload. */
export const RAW_MAX_CHARS = 7_600;

export interface RawContentRetentionVerdict {
  ok: boolean;
  sourceLines: number;
  retainedLines: number;
  missingLines: string[];
}

const BULLET = /^\s*(?:[-–—•*·]|\(?\d{1,2}\)?[.)-]|[\u0660-\u0669]{1,2}[.)-])\s+/;
/*
 * A figure is a WHOLE number (Western or Arabic-Indic) with an optional unit —
 * matching single digits would report "12٪" as "2٪" and lose the evidence the
 * author actually wrote.
 */
const NUMERIC =
  /[\d٠-٩]+(?:[.,٬][\d٠-٩]+)?\s*(?:%|٪|مليون|مليار|ألف|ريال|ر\.س|مم|كم|صفحة|صفحات|يوم|أيام|شهر|أشهر|سنة|سنوات)?/g;

/** A heading candidate: short, and not a sentence someone finished. */
function looksLikeHeading(line: string): boolean {
  const text = line.trim().replace(/[:：]$/, "");
  if (!text || text.length > 60) return false;
  if (BULLET.test(line)) return false;
  if (/[.!؟?]$/.test(text)) return false;
  return text.split(/\s+/).length <= 9;
}

function cleanLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function normalizedContentLine(line: string): string {
  return cleanLine(line)
    .replace(BULLET, "")
    .replace(/[:：]$/, "")
    .trim();
}

export function rawContentCharCount(raw: string): number {
  return [...String(raw ?? "").replace(/\r\n?/g, "\n")].length;
}

export function assertRawContentWithinLimit(raw: string): void {
  const chars = rawContentCharCount(raw);
  if (chars > RAW_MAX_CHARS) {
    throw new Error(`المحتوى يتجاوز الحد الواضح البالغ ${RAW_MAX_CHARS.toLocaleString("ar-SA")} حرفًا؛ قسّمه إلى مستندات منفصلة قبل التنظيم.`);
  }
}

export function analyzeRawContent(raw: string): RawContentAnalysis {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n").map((line) => line.trim());
  const filled = lines.filter(Boolean);
  const headingCandidates = filled.filter(looksLikeHeading);
  const bullets = filled.filter((line) => BULLET.test(line));
  const numbers = (text.match(NUMERIC) || []).map((item) => item.trim()).filter(Boolean);
  const delimited = parsePastedTable(text);
  const tableRows = delimited.some((row) => row.length > 1) ? delimited.slice(0, 60) : [];

  return {
    chars: rawContentCharCount(text),
    words: text.split(/\s+/).filter(Boolean).length,
    lines: filled.length,
    paragraphs: filled.filter((line, index) => index > 0 && lines[index - 1] === "").length + (filled.length ? 1 : 0),
    headings: headingCandidates.slice(0, 12),
    bullets: bullets.slice(0, 40),
    numbers: [...new Set(numbers)].slice(0, 24),
    tableRows,
    suggestedTitle: headingCandidates[0] || (filled[0] ? cleanLine(filled[0]).slice(0, 60) : ""),
  };
}

/** The brief handed to the provider: the paste itself, plus the no-invention rule. */
export const RAW_BRIEF_LIMIT = RAW_MAX_CHARS;

export function rawBrief(raw: string, title: string, audience: string): string {
  assertRawContentWithinLimit(raw);
  const analysis = analyzeRawContent(raw);
  return [
    "حوّل المحتوى الخام التالي إلى مسودة تقرير مؤسسي منظّم.",
    "لا تضف أي رقم أو اسم أو تاريخ أو مصدر أو مثال غير موجود في المحتوى نفسه.",
    "إن نقصت معلومة فاذكر أنها غير واردة في المحتوى بدل تخمينها.",
    title ? `العنوان المقترح: ${title}.` : "",
    audience ? `الجمهور: ${audience}.` : "",
    analysis.headings.length ? `العناوين المذكورة في المحتوى: ${analysis.headings.slice(0, 6).join(" · ")}.` : "",
    "المحتوى الخام:",
    String(raw ?? ""),
  ]
    .filter(Boolean)
    .join("\n");
}

/** How many sections fit the composed single page without overflowing it. */
export const RAW_MAX_SECTIONS = 4;

/**
 * The deterministic draft: the author's own text, grouped and ordered.
 *
 * Every heading and every bullet is taken verbatim from the paste. The only
 * authored string is the section fallback name («القسم ١») when a block has no
 * heading candidate of its own — a structural label, never a claim.
 */
export function draftFromRawContent(
  raw: string,
  options: { title?: string; maxSections?: number } = {},
): ReportDraft {
  assertRawContentWithinLimit(raw);
  const maxSections = Math.min(
    RAW_MAX_SECTIONS,
    Math.max(1, Math.round(options.maxSections ?? RAW_MAX_SECTIONS)),
  );
  const lines = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  if (!lines.length) {
    return { title: options.title?.trim() || "مستند جديد", summary: "", sections: [], nextSteps: [] };
  }

  const sections: ReportDraftSection[] = [];
  let current: ReportDraftSection | null = null;
  const open = (heading: string): ReportDraftSection => {
    const section: ReportDraftSection = { heading, body: "", bullets: [] };
    sections.push(section);
    return section;
  };

  for (const line of lines) {
    const full = sections.length >= maxSections;
    // Once the section budget is used, the remaining text is APPENDED to the
    // last section instead of being dropped: the structural cap must never lose
    // the author's content.
    if (!full && looksLikeHeading(line) && (!current || current.body || current.bullets.length)) {
      current = open(line.replace(/[:：]$/, ""));
      continue;
    }
    if (!current) current = open(options.title?.trim() || "القسم ١");
    const target = current;
    if (!full && BULLET.test(line)) {
      target.bullets.push(line.replace(BULLET, "").trim());
    } else if (!target.body) {
      target.body = line;
    } else {
      target.body = `${target.body}\n${line}`;
    }
  }

  const title = options.title?.trim() || analyzeRawContent(raw).suggestedTitle || "مستند جديد";
  return {
    title: title.slice(0, 180),
    // No summary is invented: the builder states the gap if there is one, and
    // the author's first line stays where they wrote it.
    summary: "",
    sections: sections.filter((section) => section.body || section.bullets.length),
    nextSteps: [],
  };
}

/**
 * A draft may be organised differently, but it must retain every meaningful
 * source line verbatim before this flow can create an editable document.
 */
export function rawContentRetentionVerdict(raw: string, draft: ReportDraft): RawContentRetentionVerdict {
  const source = [...new Set(
    String(raw ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map(normalizedContentLine)
      .filter(Boolean),
  )];
  const drafted = [
    draft.title,
    draft.summary,
    ...draft.sections.flatMap((section) => [section.heading, section.body, ...section.bullets]),
    ...draft.nextSteps,
  ]
    .flatMap((value) => String(value ?? "").split("\n"))
    .map(normalizedContentLine)
    .filter(Boolean)
    .join("\n");
  const missingLines = source.filter((line) => !drafted.includes(line));
  return {
    ok: missingLines.length === 0,
    sourceLines: source.length,
    retainedLines: source.length - missingLines.length,
    missingLines: missingLines.slice(0, 8),
  };
}
