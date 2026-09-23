import {
  normalizeDraft,
  normalizeDraftInput,
  type ReportDraft,
  type ReportDraftInput,
} from "./contract.ts";

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
        messages: [
          {
            role: "system",
            content: [
              "You write an evidence-preserving report draft for NASAQ.",
              "Do not invent facts, figures, dates, names, citations, or sources.",
              "When the brief lacks evidence, state the gap instead of guessing.",
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
            }),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`provider_${response.status}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()
        : "";
    return normalizeDraft(JSON.parse(text), input.maxSections);
  } finally {
    clearTimeout(timeout);
  }
}
