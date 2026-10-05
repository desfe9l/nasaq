/*
 * Raw content is measured, never guessed: the analysis reports what the paste
 * contains, the deterministic draft keeps every line, and no summary or fact is
 * invented when the paste does not carry one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RAW_MAX_SECTIONS,
  analyzeRawContent,
  draftFromRawContent,
  rawBrief,
} from "./raw-content.ts";
import { buildDraftDocument } from "../editor/raw-document.ts";
import { textsOf } from "./layout.ts";

const PASTE = `تقرير الأداء التشغيلي
مقدمة
عملت الفرق خلال الربع على ثلاث مبادرات، وتجاوز الإنجاز الخطة بنسبة 12٪.

المبادرات
- رقمنة الطلبات
- تقليل زمن المعالجة إلى 3 أيام
- تدريب 45 موظفًا

التوصيات
- تثبيت الفريق الحالي على المبادرة الثانية
- رفع تقرير قياس بعد 30 يومًا`;

test("the analysis reports only what the paste contains", () => {
  const analysis = analyzeRawContent(PASTE);
  assert.equal(analysis.chars, PASTE.length);
  assert.ok(analysis.words > 20);
  assert.ok(analysis.lines >= 9);
  assert.equal(analysis.suggestedTitle, "تقرير الأداء التشغيلي");
  assert.ok(analysis.headings.includes("المبادرات"));
  assert.ok(analysis.bullets.some((item) => item.includes("رقمنة الطلبات")));
  // Figures are detected as evidence, not transformed.
  assert.ok(analysis.numbers.some((item) => item.includes("12")));
  assert.ok(analysis.numbers.some((item) => item.includes("45")));
});

test("a delimited paste is recognised as a table and a prose paste is not", () => {
  const table = analyzeRawContent("البند | القيمة\nالعدد | 12");
  assert.equal(table.tableRows.length, 2);
  assert.deepEqual(table.tableRows[1], ["العدد", "12"]);
  assert.equal(analyzeRawContent(PASTE).tableRows.length, 0);
});

test("the deterministic draft keeps every line, grouped by the author's headings", () => {
  const draft = draftFromRawContent(PASTE);
  assert.equal(draft.title, "تقرير الأداء التشغيلي");
  assert.equal(draft.summary, "");
  assert.ok(draft.sections.length <= RAW_MAX_SECTIONS);
  const text = JSON.stringify(draft);
  for (const line of ["رقمنة الطلبات", "45 موظفًا", "تثبيت الفريق الحالي", "30 يومًا"]) {
    assert.ok(text.includes(line), `${line} must survive the local draft`);
  }
});

test("a long paste is not truncated by the section cap", () => {
  const long = Array.from({ length: 40 }, (_, index) => `سطر رقم ${index + 1}`).join("\n");
  const draft = draftFromRawContent(long);
  assert.equal(draft.sections.length, RAW_MAX_SECTIONS);
  const text = draft.sections.map((section) => section.body).join("\n");
  assert.ok(text.includes("سطر رقم 40"), "the tail of the paste must stay in the document");
});

test("an empty paste produces an empty draft instead of a fabricated one", () => {
  const draft = draftFromRawContent("   \n\n ");
  assert.equal(draft.sections.length, 0);
  assert.equal(draft.summary, "");
  assert.equal(draft.title, "مستند جديد");
});

test("the provider brief carries the content and the no-invention rule", () => {
  const brief = rawBrief(PASTE, "تقرير الربع", "الإدارة العليا");
  assert.match(brief, /لا تضف أي رقم أو اسم أو تاريخ/);
  assert.match(brief, /تقرير الربع/);
  assert.match(brief, /الإدارة العليا/);
  assert.match(brief, /رقمنة الطلبات/);
  // The brief is bounded, whatever the paste's length.
  assert.ok(brief.length <= 7_600 + 400);
});

test("the draft becomes a real NASAQ project through the existing builders", () => {
  const draft = draftFromRawContent(PASTE);
  const project = buildDraftDocument({ draft, theme: "official", orgName: "شركة نَسَق" });

  // A real Project/Page/CanvasEl document — the same shape the editor opens.
  assert.equal(project.version, 2);
  assert.equal(project.pack, "blank");
  assert.equal(project.name, draft.title);
  assert.equal(project.orgName, "شركة نَسَق");
  assert.equal(project.pages.length, 1);

  // The draft's own words are in the document, as text (editable), not as an image.
  const written = textsOf(project).join("\n");
  assert.ok(written.includes("رقمنة الطلبات"), "bullets must be in the document");
  assert.ok(written.includes("45 موظفًا"), "figures must survive into the document");
  // Chrome carries the organisation, so the document is institutional from birth.
  assert.ok(written.includes("شركة نَسَق"));
});
