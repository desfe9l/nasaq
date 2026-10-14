import { requestGemini } from "@/lib/ai/provider.server";
import { languageModelConfigured, visualNoteReady, type LanguageNoteRequest } from "./provider";

/** Optional note from the configured language model, using the shared AI boundary. */
export async function requestLanguageNote(input: LanguageNoteRequest): Promise<string> {
  if (!languageModelConfigured({ GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GROK_API_KEY: process.env.GROK_API_KEY, MISTRAL_API_KEY: process.env.MISTRAL_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY })) {
    throw new Error("not_configured");
  }
  return requestGemini({
    task: "design",
    maxOutputTokens: 400,
    timeoutMs: 30_000,
    system:
      "You review a NASAQ layout critique. Reply in Arabic with at most three concrete corrections. Do not invent page content, numbers, or praise. If the issue list is empty, say the measured critique found nothing to change.",
    userParts: [{ text: JSON.stringify({ score: input.score, issues: input.issues.slice(0, 8) }) }],
  });
}

/** A visual note needs both a configured model and a real rendered image. */
export async function requestVisualNote(input: LanguageNoteRequest & { images?: string[] }): Promise<string> {
  if (!visualNoteReady({ GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GROK_API_KEY: process.env.GROK_API_KEY, MISTRAL_API_KEY: process.env.MISTRAL_API_KEY, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }, input.images)) {
    throw new Error("not_configured");
  }
  const image = input.images?.find((item) => item.startsWith("data:image/"));
  if (!image) throw new Error("not_configured");
  const match = image.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("not_configured");
  return requestGemini({
    task: "image",
    maxOutputTokens: 400,
    timeoutMs: 45_000,
    system:
      "You review one rendered NASAQ page. Reply in Arabic with at most three concrete corrections about composition, hierarchy, whitespace, type, balance, and RTL. Do not invent page content. If the image is missing, say so.",
    userParts: [
      { text: JSON.stringify({ score: input.score, issues: input.issues.slice(0, 8) }) },
      { inlineData: { mimeType: match[1], data: match[2] } },
    ],
  });
}
