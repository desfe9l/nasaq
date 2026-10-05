/*
 * Contextual actions for the SELECTED content — the contract.
 *
 * WHAT THIS IS
 * ------------
 * The editor already has document-scoped AI (`ai_report`: a whole report draft
 * from a brief) and image AI (`analyzeImageFn`). What was missing is the action
 * an author actually reaches for while editing: «أعد صياغة هذا», «لخّص الفقرة»,
 * «حوّلها إلى جدول» — applied to ONE selected element, replacing only that
 * element.
 *
 * This module is the contract between the panel and the provider, exactly like
 * `contract.ts` is for the report draft: the editor never depends on a
 * provider-specific shape, and the same rules (never invent facts, keep the
 * language, return only the transformed text) are declared in one place.
 *
 * The table action is deliberately NOT a model choice: the model only turns
 * prose into rows; the rows become a real NASAQ `table` element through the
 * existing `parsePastedTable`/`parseTable` code path, so converting text to a
 * table can never produce a fake picture of a table.
 */

import { parsePastedTable } from "@/lib/editor/tables";

export type SelectionActionId =
  | "rewrite"
  | "summarize"
  | "expand"
  | "shorten"
  | "formal"
  | "bullets"
  | "translate-en"
  | "table";

export interface SelectionAction {
  id: SelectionActionId;
  /** The button label, in the author's language. */
  label: string;
  /** One line of what the action does — shown as the button's title. */
  hint: string;
  /** What the provider must return. */
  expects: "text" | "rows";
}

/**
 * The actions, in the order they appear. `text` actions replace the element's
 * text; `rows` actions produce the data of a real table element.
 */
export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  { id: "rewrite", label: "إعادة صياغة", hint: "نفس المعنى بصياغة أوضح", expects: "text" },
  { id: "summarize", label: "تلخيص", hint: "اختصر إلى جوهر النص", expects: "text" },
  { id: "expand", label: "توسيع", hint: "وسّع الفكرة دون اختراع أرقام", expects: "text" },
  { id: "shorten", label: "تقصير", hint: "احذف الحشو مع حفظ الحقائق", expects: "text" },
  { id: "formal", label: "صيغة رسمية", hint: "نبرة مؤسسية معتمدة", expects: "text" },
  { id: "bullets", label: "نقاط مختصرة", hint: "حوّل الفقرة إلى نقاط", expects: "text" },
  { id: "translate-en", label: "ترجمة إنجليزية", hint: "ترجمة احترافية للنص", expects: "text" },
  { id: "table", label: "تحويل إلى جدول", hint: "صفوف وأعمدة قابلة للتحرير", expects: "rows" },
];

export function selectionAction(id: SelectionActionId): SelectionAction | undefined {
  return SELECTION_ACTIONS.find((action) => action.id === id);
}

export interface SelectionActionInput {
  action: SelectionActionId;
  /** The selected element's own text. Nothing else travels. */
  text: string;
  /** Optional author instruction, appended to the action's own rule. */
  instructions: string;
  language: "ar" | "en";
}

export type SelectionErrorCode =
  | "unauthorized"
  | "license_required"
  | "not_configured"
  | "rate_limited"
  | "invalid"
  | "provider_error";

export type SelectionActionResult =
  | { ok: true; text: string }
  | { ok: false; code: SelectionErrorCode; message: string };

/**
 * The ceiling on a single selection. It is a UI-sized number, not a model
 * limit: one element's text in a report page is paragraphs, not chapters.
 */
export const MAX_SELECTION_CHARS = 6_000;

export function normalizeSelectionInput(input: Partial<SelectionActionInput>): SelectionActionInput {
  const actions = SELECTION_ACTIONS.map((action) => action.id);
  return {
    action: actions.includes(input.action as SelectionActionId)
      ? (input.action as SelectionActionId)
      : "rewrite",
    text: String(input.text ?? "").trim().slice(0, MAX_SELECTION_CHARS),
    instructions: String(input.instructions ?? "").trim().slice(0, 400),
    language: input.language === "en" ? "en" : "ar",
  };
}

export function validSelectionInput(input: SelectionActionInput): boolean {
  return Boolean(input.text && input.text.length <= MAX_SELECTION_CHARS);
}

/**
 * The instruction handed to the provider. One place, so the studio panel, the
 * server function and the tests all describe the same behaviour.
 */
export function selectionPrompt(input: SelectionActionInput): string {
  const action = selectionAction(input.action);
  const expectRows = action?.expects === "rows";
  const rules: Record<SelectionActionId, string> = {
    rewrite: "Rewrite the text so it is clearer and better ordered, keeping the exact same meaning and every fact, number, name, date and unit.",
    summarize: "Summarize the text into its essential point. Keep every number, name, date and unit that carries information.",
    expand: "Expand the text by making its existing ideas explicit and adding transitions between them. Do NOT invent facts, figures, dates, names, sources or examples.",
    shorten: "Shorten the text by removing repetition and filler. Keep every fact, number, name, date and unit.",
    formal: "Rewrite the text in a formal institutional register suitable for an official Saudi document. Keep every fact.",
    bullets: "Convert the text into short bullet points, one idea per line, starting each line with a dash and a space. Keep every fact.",
    "translate-en": "Translate the text into professional business English. Keep names, numbers, dates and units exact.",
    table: "Extract the structured data from the text as a table. Return rows of cells separated by a vertical bar (|), one row per line, with the header row first. Use the text's own labels and values; never invent a cell.",
  };
  return [
    rules[input.action],
    expectRows ? "Return only the rows, with no explanation and no code fences." : "Return only the rewritten text, with no explanation, no preamble and no code fences.",
    input.instructions ? `Additional instruction from the author: ${input.instructions}` : "",
    input.language === "ar" && input.action !== "translate-en" ? "Write the result in Arabic." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Models sometimes wrap a plain-text answer in a fence or quotes. Keep the content. */
export function cleanSelectionText(raw: string): string {
  return String(raw ?? "")
    .replace(/^\s*```(?:text|markdown|md)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .trim();
}

/**
 * The matrix for the table action.
 *
 * Reuses `parsePastedTable` — the SAME parser the canvas uses when an author
 * pastes from Excel or a CSV — so a model-produced table and a pasted table are
 * the same kind of object. Plain prose falls back to one cell per line, which is
 * still a real, editable table.
 */
export function rowsForSelection(text: string): string[][] {
  const rows = parsePastedTable(cleanSelectionText(text)).filter((row) =>
    row.some((cell) => cell.trim() !== ""),
  );
  return rows.slice(0, 60).map((row) => row.slice(0, 12));
}

/** A one-line summary of what a text action returns, for the panel's receipt. */
export function describeSelectionResult(action: SelectionActionId, result: string): string {
  const chars = result.trim().length;
  const rows = action === "table" ? rowsForSelection(result).length : 0;
  return action === "table" ? `${rows} صفًا جاهزًا للتحرير` : `${chars} حرفًا`;
}
