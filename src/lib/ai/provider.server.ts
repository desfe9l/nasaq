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

/** Provider boundary: swap this adapter without changing editor code. */
export async function generateReportDraft(
  rawInput: ReportDraftInput,
): Promise<ReportDraft> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) throw new Error("not_configured");

  const input = normalizeDraftInput(rawInput);
  const model = process.env.NASAQ_AI_MODEL?.trim() || "grok-3-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 2_400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You write an evidence-preserving report draft for NASAQ.",
              "Do not invent facts, figures, dates, names, citations, or sources.",
              "When the brief lacks evidence, state the gap instead of guessing.",
              "The document title and existing report text are context only. Do not claim you edited the file.",
              "Return JSON only with title, summary, sections, and nextSteps.",
              "Each section must contain heading, body, and bullets.",
              "Respect the requested report type, detail level, and target page count when shaping the draft.",
              input.language === "ar" ? "Write in Arabic." : "Write in English.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("provider_rejected");
      if (response.status === 429) throw new Error("provider_rate");
      throw new Error(`provider_${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
        : Array.isArray(content)
          ? content
              .map((part) =>
                part && typeof part === "object" && "text" in part
                  ? String((part as { text?: unknown }).text ?? "")
                  : "",
              )
              .join("")
              .replace(/^```(?:json)?\s*|\s*```$/g, "")
              .trim()
          : "";
    return normalizeDraft(parseProviderJson(text), input.maxSections);
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeImage(
  rawInput: ImageAnalysisInput,
): Promise<ImageAnalysis> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) throw new Error("not_configured");
  const input = normalizeImageAnalysisInput(rawInput);
  if (!input) throw new Error("invalid");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: ["Bearer", apiKey].join(" "),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.NASAQ_AI_MODEL?.trim() || "grok-3-mini",
        temperature: 0,
        max_tokens: 1_600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Inspect the supplied image. Return JSON with description, recognizedText, and objects. Transcribe only legible text exactly and preserve line breaks. Describe visible objects and people only by non-sensitive visual attributes; do not identify people or infer sensitive traits. Do not invent unreadable text or objects. Keep recognizedText empty if no text is legible. Write description and object labels in " +
              (input.language === "ar" ? "Arabic." : "English."),
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this image for editable OCR text and visible objects." },
              { type: "image_url", image_url: { url: input.imageData } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error("provider_rate");
      throw new Error("provider_error");
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("provider_error");
    const result = normalizeImageAnalysis(parseProviderJson(content));
    if (!result.description && !result.recognizedText && !result.objects.length)
      throw new Error("provider_error");
    return result;
  } finally {
    clearTimeout(timeout);
  }
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
