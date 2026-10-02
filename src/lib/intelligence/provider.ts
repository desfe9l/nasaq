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
  code: "ok" | "not_configured" | "unauthorized" | "provider_error";
  note: string;
}

export function languageModelConfigured(env: { XAI_API_KEY?: string }): boolean {
  return Boolean(env.XAI_API_KEY?.trim());
}

export const DETERMINISTIC_MODEL_ID = "nasaq-measured-critic";
