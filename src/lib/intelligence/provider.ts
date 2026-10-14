/**
 * Model boundary for template intelligence.
 *
 * The measurable critic does not call a network. A language model, when one
 * is configured on the server, may only add a note. It cannot replace the
 * NASAQ document, and its name is not shown to customers.
 */

export interface LanguageNoteRequest {
  score: number;
  issues: string[];
}

export interface LanguageNoteResult {
  ok: boolean;
  code: "ok" | "not_configured" | "unauthorized" | "provider_error" | "rate_limited";
  note: string;
}

export function languageModelConfigured(env: { GEMINI_API_KEY?: string; GOOGLE_AI_API_KEY?: string; GROK_API_KEY?: string; MISTRAL_API_KEY?: string; OPENROUTER_API_KEY?: string }): boolean {
	return Boolean(env.GOOGLE_AI_API_KEY?.trim() || env.GEMINI_API_KEY?.trim() || env.GROK_API_KEY?.trim() || env.MISTRAL_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim());
}

/** A visual note needs both a configured model and a real rendered image. */
export function visualNoteReady(env: { GEMINI_API_KEY?: string; GOOGLE_AI_API_KEY?: string; GROK_API_KEY?: string; MISTRAL_API_KEY?: string; OPENROUTER_API_KEY?: string }, images?: string[]): boolean {
  return (
    languageModelConfigured(env) &&
    Boolean(images?.some((item) => item.startsWith("data:image/") && item.length > 32 && item.length < 200_000))
  );
}

export const DETERMINISTIC_MODEL_ID = "nasaq-measured-critic";
