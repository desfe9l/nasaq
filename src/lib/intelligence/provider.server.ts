import { languageModelConfigured, visualNoteReady, type LanguageNoteRequest } from "./provider";

function modelName(): string {
  return process.env.NASAQ_AI_MODEL?.trim() || "gemini-2.5-flash";
}

async function requestGemini(input: {
  system: string;
  userParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
  maxOutputTokens: number;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("not_configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName())}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: input.userParts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: input.maxOutputTokens },
        }),
      },
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("provider_rejected");
      if (response.status === 429) throw new Error("provider_rate");
      throw new Error("provider_error");
    }
    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (!text) throw new Error("provider_error");
    return text.slice(0, 600);
  } finally {
    clearTimeout(timeout);
  }
}

/** Optional note from the configured language model. */
export async function requestLanguageNote(input: LanguageNoteRequest): Promise<string> {
  if (!languageModelConfigured({ GEMINI_API_KEY: process.env.GEMINI_API_KEY })) {
    throw new Error("not_configured");
  }
  return requestGemini({
    maxOutputTokens: 400,
    system:
      "You review a NASAQ layout critique. Reply in Arabic with at most three concrete corrections. Do not invent page content, numbers, or praise. If the issue list is empty, say the measured critique found nothing to change.",
    userParts: [{ text: JSON.stringify({ score: input.score, issues: input.issues.slice(0, 8) }) }],
  });
}

/** Optional visual note. Without a rendered page image, or without a key, this throws `not_configured`. */
export async function requestVisualNote(input: LanguageNoteRequest & { images?: string[] }): Promise<string> {
  if (!visualNoteReady({ GEMINI_API_KEY: process.env.GEMINI_API_KEY }, input.images)) {
    throw new Error("not_configured");
  }
  const image = input.images?.find((item) => item.startsWith("data:image/"));
  if (!image) throw new Error("not_configured");
  const match = image.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("not_configured");
  return requestGemini({
    maxOutputTokens: 400,
    system:
      "You review one rendered NASAQ page. Reply in Arabic with at most three concrete corrections about composition, hierarchy, whitespace, type, balance, and RTL. Do not invent page content. If the image is missing, say so.",
    userParts: [
      { text: JSON.stringify({ score: input.score, issues: input.issues.slice(0, 8) }) },
      { inlineData: { mimeType: match[1], data: match[2] } },
    ],
  });
}
