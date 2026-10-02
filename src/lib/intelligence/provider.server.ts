import { languageModelConfigured, type LanguageNoteRequest } from "./provider";

/**
 * Optional note from the configured language model.
 * Swap the fetch target here without touching layout or the critic.
 */
export async function requestLanguageNote(input: LanguageNoteRequest): Promise<string> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!languageModelConfigured({ XAI_API_KEY: apiKey })) {
    throw new Error("not_configured");
  }
  const model = process.env.NASAQ_AI_MODEL?.trim() || "grok-3-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
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
        temperature: 0.1,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You review a NASAQ layout critique. Reply in Arabic with at most three concrete corrections. Do not invent page content, numbers, or praise. If the issue list is empty, say the measured critique found nothing to change.",
          },
          {
            role: "user",
            content: JSON.stringify({
              score: input.score,
              issues: input.issues.slice(0, 8),
            }),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("provider_error");
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("provider_error");
    return text.slice(0, 600);
  } finally {
    clearTimeout(timeout);
  }
}
