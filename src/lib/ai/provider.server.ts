import {
  normalizeDraft,
  normalizeDraftInput,
  type ReportDraft,
  type ReportDraftInput,
} from "./contract.ts";
import {
  normalizeImageAnalysis,
  normalizeImageAnalysisInput,
  type ImageAnalysis,
  type ImageAnalysisInput,
} from "./image-contract.ts";
import {
  cleanSelectionText,
  normalizeSelectionInput,
  selectionPrompt,
  validSelectionInput,
  type SelectionActionInput,
} from "./selection-contract.ts";
import {
  normalizeDesignBrief,
  normalizeDesignBriefInput,
  type DesignBrief,
  type DesignBriefInput,
} from "./design-contract.ts";

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export type GeminiProviderErrorCode =
  | "not_configured"
  | "invalid_model"
  | "provider_auth"
  | "provider_rate"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_aborted"
  | "provider_blocked"
  | "provider_empty"
  | "provider_malformed"
  | "provider_error";

export type GeminiRequest = {
  model?: string;
  system: string;
  userParts: GeminiPart[];
  temperature?: number;
  maxOutputTokens: number;
  jsonResponse?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class GeminiProviderError extends Error {
  readonly code: GeminiProviderErrorCode;

  constructor(code: GeminiProviderErrorCode) {
    super(code);
    this.name = "GeminiProviderError";
    this.code = code;
  }
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BLOCKED_FINISH_REASONS = new Set(["BLOCKED", "SAFETY", "RECITATION"]);

function modelName(): string {
  const configured = process.env.NASAQ_AI_MODEL?.trim() || DEFAULT_MODEL;
  const model = configured.replace(/^models\//, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model)) {
    throw new GeminiProviderError("invalid_model");
  }
  return model;
}

export function configuredGeminiModel(): string {
  return modelName();
}

function abortError(signal?: AbortSignal): GeminiProviderError {
  return new GeminiProviderError(signal?.aborted ? "provider_aborted" : "provider_timeout");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const cancel = () => {
      clearTimeout(timer);
      reject(new GeminiProviderError("provider_aborted"));
    };
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

/**
 * The only Gemini HTTP boundary in the application. The key is read here, on
 * the server, and provider details never cross this function as raw responses.
 */
export async function requestGemini(request: GeminiRequest): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiProviderError("not_configured");

  const model = request.model ? request.model.replace(/^models\//, "") : modelName();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model)) {
    throw new GeminiProviderError("invalid_model");
  }
  const timeoutMs = request.timeoutMs ?? 45_000;
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (request.signal?.aborted) throw new GeminiProviderError("provider_aborted");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort();
    request.signal?.addEventListener("abort", forwardAbort, { once: true });

    try {
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: request.system }] },
              contents: [{ role: "user", parts: request.userParts }],
              generationConfig: {
                temperature: request.temperature ?? 0.2,
                maxOutputTokens: request.maxOutputTokens,
                ...(request.jsonResponse ? { responseMimeType: "application/json" } : {}),
              },
            }),
          },
        );
      } catch (error) {
        if (request.signal?.aborted) throw new GeminiProviderError("provider_aborted");
        if (timedOut) throw new GeminiProviderError("provider_timeout");
        if (attempt + 1 < maxAttempts) {
          await delay(150 * 2 ** attempt, request.signal);
          continue;
        }
        throw new GeminiProviderError("provider_unavailable");
      }

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt + 1 < maxAttempts) {
          await delay(150 * 2 ** attempt, request.signal);
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          throw new GeminiProviderError("provider_auth");
        }
        if (response.status === 400) throw new GeminiProviderError("provider_error");
        if (response.status === 404) throw new GeminiProviderError("invalid_model");
        if (response.status === 408 || response.status === 504) {
          throw new GeminiProviderError("provider_timeout");
        }
        if (response.status === 429) throw new GeminiProviderError("provider_rate");
        if (response.status >= 500) throw new GeminiProviderError("provider_unavailable");
        throw new GeminiProviderError("provider_error");
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new GeminiProviderError("provider_error");
      }
      return extractGeminiText(payload);
    } catch (error) {
      if (error instanceof GeminiProviderError) throw error;
      if (request.signal?.aborted) throw new GeminiProviderError("provider_aborted");
      if (timedOut) throw abortError(request.signal);
      throw new GeminiProviderError("provider_error");
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", forwardAbort);
    }
  }
  throw new GeminiProviderError("provider_unavailable");
}

/** Extract text while preserving safe, actionable distinctions for callers. */
export function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") throw new GeminiProviderError("provider_error");
  const root = payload as {
    promptFeedback?: { blockReason?: unknown };
    candidates?: Array<{
      finishReason?: unknown;
      content?: { parts?: Array<{ text?: unknown }> };
    }>;
  };
  if (root.promptFeedback?.blockReason) throw new GeminiProviderError("provider_blocked");
  const candidate = root.candidates?.[0];
  if (!candidate) throw new GeminiProviderError("provider_empty");
  if (typeof candidate.finishReason === "string" && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) {
    throw new GeminiProviderError("provider_blocked");
  }
  const text = candidate.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (!text) throw new GeminiProviderError("provider_empty");
  return text;
}

/** Parse fenced, prose-wrapped, or directly returned JSON without hiding malformed output. */
export function parseProviderJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        throw new GeminiProviderError("provider_malformed");
      }
    }
    throw new GeminiProviderError("provider_malformed");
  }
}

export async function generateReportDraft(rawInput: ReportDraftInput): Promise<ReportDraft> {
  const input = normalizeDraftInput(rawInput);
  const text = await requestGemini({
    model: modelName(),
    temperature: 0.2,
    maxOutputTokens: 2_400,
    timeoutMs: 45_000,
    jsonResponse: true,
    system: [
      "You write an evidence-preserving report draft for NASAQ.",
      "Do not invent facts, figures, dates, names, citations, or sources.",
      "When the brief lacks evidence, state the gap instead of guessing.",
      "The document title and existing report text are context only. Do not claim you edited the file.",
      "Return JSON only with title, summary, sections, and nextSteps.",
      "Each section must contain heading, body, and bullets.",
      "Respect the requested report type, detail level, and target page count when shaping the draft.",
      input.language === "ar" ? "Write in Arabic." : "Write in English.",
    ].join(" "),
    userParts: [{
      text: JSON.stringify({
        brief: input.brief,
        audience: input.audience,
        tone: input.tone,
        maxSections: input.maxSections,
        reportType: input.reportType,
        detailLevel: input.detailLevel,
        pageTarget: input.pageTarget,
        documentTitle: input.documentTitle || "",
        documentContext: input.documentContext || "",
      }),
    }],
  });
  return normalizeDraft(parseProviderJson(text), input.maxSections);
}

export async function generateDesignBrief(rawInput: DesignBriefInput): Promise<DesignBrief> {
  const input = normalizeDesignBriefInput(rawInput);
  if (!input.prompt) throw new GeminiProviderError("provider_error");
  const text = await requestGemini({
    model: modelName(),
    temperature: input.mode === "professional" ? 0.25 : 0.45,
    maxOutputTokens: 1_800,
    timeoutMs: 45_000,
    jsonResponse: true,
    system: [
      "You are the art director for NASAQ, an Arabic-first institutional design platform.",
      "Return JSON only with title, subtitle, org, topic, style, format, pages, coverStyle, bilingual, contentDensity, and visualDirection.",
      "Use professional Arabic-first RTL direction. Do not invent real organizations, logos, people, facts, dates, numbers, or official endorsements.",
      "Use only the supported NASAQ style, format, and coverStyle values from the user input contract.",
      "The result will be converted into real editable NASAQ text, shape, image, table, line, and group elements; never return SVG or a flattened image.",
      `Generation mode: ${input.mode}. Content density: ${input.contentDensity}. Bilingual requested: ${input.bilingual ? "yes" : "no"}.`,
    ].join(" "),
    userParts: [{ text: JSON.stringify(input) }],
  });
  return normalizeDesignBrief(parseProviderJson(text), input);
}

export async function transformSelection(rawInput: SelectionActionInput): Promise<string> {
  const input = normalizeSelectionInput(rawInput);
  if (!validSelectionInput(input)) throw new GeminiProviderError("provider_error");
  const text = await requestGemini({
    model: modelName(),
    temperature: 0.2,
    maxOutputTokens: 1_600,
    timeoutMs: 30_000,
    system: [
      "You are an institutional Arabic-first editor for NASAQ.",
      "Never invent facts, figures, dates, names, citations or sources.",
      "Your answer replaces ONLY the selection the author made; do not describe the edit.",
      "Return the transformed content itself and nothing else.",
    ].join(" "),
    userParts: [{ text: `${selectionPrompt(input)}\n\n---\n${input.text}` }],
  });
  const cleaned = cleanSelectionText(text);
  if (!cleaned) throw new GeminiProviderError("provider_empty");
  return cleaned;
}

export async function analyzeImage(rawInput: ImageAnalysisInput): Promise<ImageAnalysis> {
  const input = normalizeImageAnalysisInput(rawInput);
  if (!input) throw new GeminiProviderError("provider_error");
  const match = input.imageData.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new GeminiProviderError("provider_error");
  const text = await requestGemini({
    model: modelName(),
    temperature: 0,
    maxOutputTokens: 1_600,
    timeoutMs: 45_000,
    jsonResponse: true,
    system: "Inspect the supplied image. Return JSON with description, recognizedText, and objects. Transcribe only legible text exactly and preserve line breaks. Describe visible objects and people only by non-sensitive visual attributes; do not identify people or infer sensitive traits. Do not invent unreadable text or objects. Keep recognizedText empty if no text is legible. Write description and object labels in " + (input.language === "ar" ? "Arabic." : "English."),
    userParts: [
      { text: "Analyze this image for editable OCR text and visible objects." },
      { inlineData: { mimeType: match[1], data: match[2] } },
    ],
  });
  const result = normalizeImageAnalysis(parseProviderJson(text));
  if (!result.description && !result.recognizedText && !result.objects.length) {
    throw new GeminiProviderError("provider_empty");
  }
  return result;
}
