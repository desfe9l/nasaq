/**
 * Stable contract between the editor and the replaceable report-writing
 * provider. The editor never depends on a provider-specific response shape.
 */

export type AiLanguage = "ar" | "en";
export type AiTone = "official" | "executive" | "plain";
export type ReportType =
  | "executive"
  | "performance"
  | "project"
  | "policy"
  | "briefing";
export type ReportDetail = "concise" | "standard" | "detailed";

export interface ReportDraftInput {
  brief: string;
  audience: string;
  tone: AiTone;
  language: AiLanguage;
  maxSections: number;
  reportType: ReportType;
  detailLevel: ReportDetail;
  pageTarget: number;
}

export interface ReportDraftSection {
  heading: string;
  body: string;
  bullets: string[];
}

export interface ReportDraft {
  title: string;
  summary: string;
  sections: ReportDraftSection[];
  nextSteps: string[];
}

export type ReportDraftResult =
  | { ok: true; draft: ReportDraft }
  | {
      ok: false;
      code:
        | "unauthorized"
        | "license_required"
        | "not_configured"
        | "rate_limited"
        | "invalid"
        | "provider_error";
      message: string;
    };

const MAX_BRIEF = 8_000;
const MAX_AUDIENCE = 240;

export function normalizeDraftInput(input: ReportDraftInput): ReportDraftInput {
  return {
    brief: input.brief.trim().slice(0, MAX_BRIEF),
    audience: input.audience.trim().slice(0, MAX_AUDIENCE),
    tone: input.tone,
    language: input.language,
    maxSections: Math.min(8, Math.max(1, Math.round(input.maxSections || 4))),
    reportType: ["executive", "performance", "project", "policy", "briefing"].includes(
      input.reportType,
    )
      ? input.reportType
      : "executive",
    detailLevel: ["concise", "standard", "detailed"].includes(input.detailLevel)
      ? input.detailLevel
      : "standard",
    pageTarget: Math.min(4, Math.max(1, Math.round(input.pageTarget || 1))),
  };
}

export function validDraftInput(input: ReportDraftInput): boolean {
  return Boolean(
    input.brief &&
      input.brief.length <= MAX_BRIEF &&
      input.audience.length <= MAX_AUDIENCE &&
      ["ar", "en"].includes(input.language) &&
      ["official", "executive", "plain"].includes(input.tone) &&
      ["executive", "performance", "project", "policy", "briefing"].includes(
        input.reportType,
      ) &&
      ["concise", "standard", "detailed"].includes(input.detailLevel) &&
      Number.isInteger(input.pageTarget) &&
      input.pageTarget >= 1 &&
      input.pageTarget <= 4,
  );
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeDraft(value: unknown, maxSections: number): ReportDraft {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = rawSections
    .slice(0, maxSections)
    .map((section, index) => {
      const item = section && typeof section === "object" ? (section as Record<string, unknown>) : {};
      const bullets = Array.isArray(item.bullets)
        ? item.bullets.filter((bullet): bullet is string => typeof bullet === "string" && Boolean(bullet.trim())).slice(0, 6)
        : [];
      return {
        heading: cleanText(item.heading, `القسم ${index + 1}`),
        body: cleanText(item.body, ""),
        bullets,
      };
    })
    .filter((section) => section.body || section.bullets.length);

  if (!sections.length) throw new Error("empty_draft");

  const nextSteps = Array.isArray(raw.nextSteps)
    ? raw.nextSteps.filter((step): step is string => typeof step === "string" && Boolean(step.trim())).slice(0, 6)
    : [];

  return {
    title: cleanText(raw.title, "مسودة تقرير"),
    summary: cleanText(raw.summary, ""),
    sections,
    nextSteps,
  };
}

export function draftAsText(draft: ReportDraft): string {
  return [
    draft.title,
    draft.summary,
    ...draft.sections.flatMap((section) => [
      section.heading,
      section.body,
      ...section.bullets.map((bullet) => `• ${bullet}`),
    ]),
    ...(draft.nextSteps.length ? ["الخطوات التالية", ...draft.nextSteps.map((step) => `• ${step}`)] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}
