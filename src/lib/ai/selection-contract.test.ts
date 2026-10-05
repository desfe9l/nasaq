/*
 * The selection contract is the promise the panel makes to the author: one
 * element's text in, one transformed result out, table rows that are real rows,
 * and no invented facts requested of the model.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SELECTION_CHARS,
  SELECTION_ACTIONS,
  cleanSelectionText,
  describeSelectionResult,
  normalizeSelectionInput,
  rowsForSelection,
  selectionAction,
  selectionPrompt,
  validSelectionInput,
} from "./selection-contract.ts";

test("every declared action is complete and unique", () => {
  const ids = SELECTION_ACTIONS.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const action of SELECTION_ACTIONS) {
    assert.ok(action.label.length > 0, `${action.id} needs a label`);
    assert.ok(action.hint.length > 0, `${action.id} needs a hint`);
    assert.equal(typeof selectionAction(action.id)?.label, "string");
  }
  assert.equal(selectionAction("table")?.expects, "rows");
  assert.equal(selectionAction("summarize")?.expects, "text");
});

test("input is normalised, bounded and never empty", () => {
  const long = "ا".repeat(MAX_SELECTION_CHARS + 500);
  const input = normalizeSelectionInput({ action: "summarize", text: long, language: "ar" });
  assert.equal(input.text.length, MAX_SELECTION_CHARS);
  assert.ok(validSelectionInput(input));

  const empty = normalizeSelectionInput({ action: "summarize", text: "   " });
  assert.equal(empty.text, "");
  assert.ok(!validSelectionInput(empty));

  // An unknown action cannot reach the provider.
  const unknown = normalizeSelectionInput({ action: "delete-everything" as never, text: "نص" });
  assert.equal(unknown.action, "rewrite");
});

test("the prompt forbids invention and keeps the language", () => {
  const arabic = selectionPrompt(
    normalizeSelectionInput({ action: "expand", text: "نص", language: "ar" }),
  );
  assert.match(arabic, /Do NOT invent/);
  assert.match(arabic, /Write the result in Arabic/);

  const table = selectionPrompt(normalizeSelectionInput({ action: "table", text: "نص" }));
  assert.match(table, /vertical bar/);
  assert.match(table, /never invent a cell/);

  const withInstruction = selectionPrompt(
    normalizeSelectionInput({ action: "rewrite", text: "نص", instructions: "اجعلها مهذبة" }),
  );
  assert.match(withInstruction, /اجعلها مهذبة/);
});

test("provider text is unwrapped but never rewritten", () => {
  assert.equal(cleanSelectionText("```text\nمرحبا\n```"), "مرحبا");
  assert.equal(cleanSelectionText('"مرحبا"'), "مرحبا");
  assert.equal(cleanSelectionText("  مرحبا  "), "مرحبا");
  assert.equal(cleanSelectionText(""), "");
});

test("table rows are real rows through the canvas parser", () => {
  const rows = rowsForSelection("البند | القيمة\nالعدد | ١٢\nالنسبة | ٤٢٪");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ["البند", "القيمة"]);
  assert.deepEqual(rows[2], ["النسبة", "٤٢٪"]);

  // Plain prose is still a table: one cell per line.
  const single = rowsForSelection("سطر أول\nسطر ثانٍ");
  assert.equal(single.length, 2);
  assert.deepEqual(single[0], ["سطر أول"]);
});

test("the result receipt is honest about what was produced", () => {
  assert.match(describeSelectionResult("summarize", "نص قصير"), /حرفًا/);
  assert.match(describeSelectionResult("table", "أ | ب\nج | د"), /صفًا/);
});
