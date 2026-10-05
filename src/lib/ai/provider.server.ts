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

type GeminiRequest = {
  model: string;
  system: string;
  userParts: GeminiPart[];
  temperature: number;
  maxOutputTokens: number;
  jsonResponse?: boolean;
};

/** Provider boundary: swap this adapter without changing editor code. */
async function requestGemini(request: GeminiRequest): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("not_configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const model = request.model || "gemini-2.5-flash";

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: request.userParts }],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
            ...(request.jsonResponse ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("provider_rejected");
      if (response.status === 429) throw new Error("provider_rate");
      throw new Error(`provider_${response.status}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (!text) throw new Error("provider_error");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function modelName(): string {
  return process.env.NASAQ_AI_MODEL?.trim() || "gemini-2.5-flash";
}

export async function generateReportDraft(
  rawInput: ReportDraftInput,
): Promise<ReportDraft> {
  const input = normalizeDraftInput(rawInput);
  const text = await requestGemini({
    model: modelName(),
    temperature: 0.2,
    maxOutputTokens: 2_400,
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
    userParts: [
      {
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
      },
    ],
  });
  return normalizeDraft(parseProviderJson(text), input.maxSections);
}

/** Gemini supplies art direction; NASAQ turns it into real editable elements. */
export async function generateDesignBrief(rawInput: DesignBriefInput): Promise<DesignBrief> {
  const input = normalizeDesignBriefInput(rawInput);
  if (!input.prompt) throw new Error("invalid");
  const text = await requestGemini({
    model: modelName(),
    temperature: input.mode === "professional" ? 0.25 : 0.45,
    maxOutputTokens: 1_800,
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

/**
 * Contextual action on a selection — same provider, same key, same failure
 * vocabulary as the report draft. Only the response shape differs: this path
 * returns the transformed TEXT itself (or table rows), not a JSON document.
 */
export async function transformSelection(
  rawInput: SelectionActionInput,
): Promise<string> {
  const input = normalizeSelectionInput(rawInput);
  if (!validSelectionInput(input)) throw new Error("invalid");

  const text = await requestGemini({
    model: modelName(),
    temperature: 0.2,
    maxOutputTokens: 1_600,
    system: [
      "You are an institutional Arabic-first editor for NASAQ.",
      "Never invent facts, figures, dates, names, citations or sources.",
      "Your answer replaces ONLY the selection the author made; do not describe the edit.",
      "Return the transformed content itself and nothing else.",
    ].join(" "),
    userParts: [{ text: `${selectionPrompt(input)}\n\n---\n${input.text}` }],
  });
  const cleaned = cleanSelectionText(text);
  if (!cleaned) throw new Error("empty_result");
  return cleaned;
}

export async function analyzeImage(
  rawInput: ImageAnalysisInput,
): Promise<ImageAnalysis> {
  const input = normalizeImageAnalysisInput(rawInput);
  if (!input) throw new Error("invalid");
  const match = input.imageData.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("invalid");

  const text = await requestGemini({
    model: modelName(),
    temperature: 0,
    maxOutputTokens: 1_600,
    jsonResponse: true,
    system:
      "Inspect the supplied image. Return JSON with description, recognizedText, and objects. Transcribe only legible text exactly and preserve line breaks. Describe visible objects and people only by non-sensitive visual attributes; do not identify people or infer sensitive traits. Do not invent unreadable text or objects. Keep recognizedText empty if no text is legible. Write description and object labels in " +
      (input.language === "ar" ? "Arabic." : "English."),
    userParts: [
      { text: "Analyze this image for editable OCR text and visible objects." },
      { inlineData: { mimeType: match[1], data: match[2] } },
    ],
  });
  const result = normalizeImageAnalysis(parseProviderJson(text));
  if (!result.description && !result.recognizedText && !result.objects.length) {
    throw new Error("provider_error");
  }
  return result;
}

/** Models sometimes wrap JSON in prose or a fence. Keep the object, drop the rest. */
function parseProviderJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("provider_error");
  }
}
