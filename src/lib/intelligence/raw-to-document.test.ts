/*
 * The raw-content pipeline is the SAME pipeline as the reference path.
 *
 * These tests pin the three things that would quietly break the promise made on
 * the public page: (1) every line of the author's paste survives into the
 * document, (2) the "before" baseline is a different, honestly worse object, and
 * (3) the composer invents no figures — no number appears in the document that
 * was not in the paste.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { pageSize } from "../editor/model.ts";
import { critiqueProject } from "./critic.ts";
import { textsOf } from "./layout.ts";
import { RAW_PAGE, analyseRawText, composeFromText, improveRawText } from "./raw-to-document.ts";

const PASTE = `تقرير الأداء التشغيلي — الربع الثالث
عملت الفرق على ثلاث مبادرات: رقمنة الطلبات، وتقليل زمن المعالجة إلى 3 أيام، وتدريب 45 موظفًا.
بلغت نسبة الإنجاز 92٪ مقارنة بالخطة، وارتفع رضا المستفيدين إلى 4.7 من 5.
التوصيات: تثبيت الفريق على المبادرة الثانية، ورفع تقرير قياس بعد 30 يومًا.`;

const lines = PASTE.split("\n").map((line) => line.trim()).filter(Boolean);

test("the measurement is the shared analyzer, not a second one", () => {
  const measured = analyseRawText(PASTE);
  assert.equal(measured.words, PASTE.split(/\s+/).filter(Boolean).length);
  assert.ok(measured.numbers.some((token) => token.includes("92")));
  assert.equal(measured.suggestedTitle, "تقرير الأداء التشغيلي — الربع الثالث");
});

test("composeFromText keeps every line and stays A4", () => {
  const project = composeFromText({ title: "تقرير الأداء التشغيلي", lines });
  const written = textsOf(project).join("\n");
  for (const line of lines) {
    assert.ok(written.includes(line), `lost line: ${line}`);
  }
  const size = pageSize(project.pages[0]);
  assert.ok(Math.abs(size.w - RAW_PAGE.w) < 0.2 && Math.abs(size.h - RAW_PAGE.h) < 0.2);
  assert.equal(project.pages.length, 1);
});

test("improveRawText returns a real before/after pair with an honest verdict", () => {
  const result = improveRawText({ text: PASTE });

  // Real NASAQ documents — the editor's own shape — and two distinct documents.
  assert.equal(result.after.version, 2);
  assert.notEqual(result.before.pages[0].elements[0].id, result.after.pages[0].elements[0].id);
  assert.equal(result.before.pages.length, 1);
  assert.ok(result.after.pages[0].elements.length > result.before.pages[0].elements.length);

  // The author's content is all there, and the verdict says so.
  const written = textsOf(result.after).join("\n");
  for (const line of lines) assert.ok(written.includes(line), `lost line: ${line}`);
  assert.equal(result.verdict.contentKept, true);
  assert.equal(result.verdict.sizeKept, true);
  assert.equal(result.verdict.titleKept, true);

  // The critic ran on both sides; the reported numbers are the critic's own.
  assert.equal(result.verdict.scoreBefore, critiqueProject(result.before).score);
  assert.equal(result.verdict.scoreAfter, result.critique.score);
  assert.ok(result.iterations.length >= 1);
});

test("the composed document invents no figures", () => {
  const result = improveRawText({ text: PASTE });
  const written = textsOf(result.after).join("\n");
  const found: string[] = written.match(/[\d٠-٩]+(?:[.,٬][\d٠-٩]+)?/g) || [];
  const source: string[] = PASTE.match(/[\d٠-٩]+(?:[.,٬][\d٠-٩]+)?/g) || [];
  for (const token of found) {
    assert.ok(source.includes(token), `invented figure: ${token}`);
  }
});

test("the same paste composes the same document twice", () => {
  const first = improveRawText({ text: PASTE });
  const second = improveRawText({ text: PASTE });
  assert.deepEqual(
    first.after.pages.map((page) => page.elements.map((element) => element.content)),
    second.after.pages.map((page) => page.elements.map((element) => element.content)),
  );
  assert.equal(first.verdict.scoreAfter, second.verdict.scoreAfter);
});

test("an explicit title overrides the paste's first heading", () => {
  const result = improveRawText({ text: PASTE, title: "محضر اجتماع" });
  assert.ok(textsOf(result.after).join("\n").includes("محضر اجتماع"));
});
