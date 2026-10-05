/*
 * «التنظيم الذكي للقوالب» — the content-derived analysis.
 *
 * These assertions are about the promises the catalogue makes to an author:
 * a document is classified from what is actually inside it, a generated name is
 * meaningful Arabic rather than a file stem, a stored category the filters do
 * not know is replaced by a derived one, and the shelf order is stable.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeTemplate,
  needsGeneratedName,
  orderTemplates,
  resolveCategory,
  suggestTemplateCategory,
  suggestTemplateName,
} from "./organization.ts";
import { KNOWN_CATEGORY_IDS } from "./naming.ts";
import type { Page } from "@/lib/editor/model";

/** A page whose elements are the only thing under test. */
function page(
  elements: Partial<Page["elements"][number]>[],
  size: { w: number; h: number } = { w: 210, h: 297 },
): Page {
  return {
    id: `p${Math.random().toString(36).slice(2)}`,
    name: "صفحة",
    w: size.w,
    h: size.h,
    bg: "#ffffff",
    elements: elements.map((el, index) => ({ id: `e${index}`, z: index, ...el }) as never),
  } as unknown as Page;
}

test("an annual report cover is recognised from its title, not its filename", () => {
  const analysis = analyzeTemplate([
    page([
      { type: "text", content: "التقرير السنوي 2025", style: { fontSize: 46 } },
      { type: "text", content: "وزارة الاتصالات وتقنية المعلومات", style: { fontSize: 16 } },
    ]),
  ]);
  assert.equal(analysis.documentType, "annual-report");
  const name = suggestTemplateName(analysis);
  assert.match(name, /التقرير السنوي/);
  assert.doesNotMatch(name, /[A-Za-z]{4,}\.(json|svg)/i);
  assert.ok(KNOWN_CATEGORY_IDS.has(suggestTemplateCategory(analysis)));
});

test("a letter classifies as correspondence and a table page as data", () => {
  const letter = analyzeTemplate([
    page([
      { type: "text", content: "خطاب رسمي", style: { fontSize: 24 } },
      { type: "text", content: "السلام عليكم ورحمة الله وبركاته، نرفق لكم ما يلزم." },
    ]),
  ]);
  assert.equal(letter.documentType, "letter");
  const tabular = analyzeTemplate([
    page([
      { type: "table", content: "" },
      { type: "stat", content: "الإيرادات" },
      { type: "text", content: "ملخص الأرقام المالية للربع" },
    ]),
  ]);
  assert.equal(tabular.structure.tables, 1);
  assert.ok(tabular.structure.charts >= 1);
  assert.ok(KNOWN_CATEGORY_IDS.has(suggestTemplateCategory(tabular)));
});

test("a placeholder name is regenerated; a real name is respected", () => {
  for (const placeholder of ["Untitled", "New Template", "قالب 3", "img_4821.json", ""]) {
    assert.equal(needsGeneratedName(placeholder), true, `${placeholder} must be regenerated`);
  }
  assert.equal(needsGeneratedName("التقرير السنوي للجهة"), false);
});

test("a stored free-text category is replaced by a derived id, never left unknown", () => {
  const analysis = analyzeTemplate([
    page([{ type: "text", content: "عرض تقديمي مؤسسي", style: { fontSize: 40 } }]),
  ]);
  const resolved = resolveCategory("رفوف قسمي الداخلي", analysis);
  // The author's own wording stays the label, but the FILTER it answers to is
  // an id the catalogue actually knows.
  assert.equal(resolved.derived, false);
  assert.equal(resolved.title, "رفوف قسمي الداخلي");
  assert.ok(KNOWN_CATEGORY_IDS.has(resolved.id));

  // A category the filters already understand is kept as the author set it.
  const kept = resolveCategory("covers", analysis);
  assert.equal(kept.id, "covers");
  assert.equal(kept.derived, false);
});

test("ordering is stable and honours an explicit author order first", () => {
  const entries = [
    {
      id: "b",
      title: "خطاب رسمي",
      sortOrder: 5,
      pages: [page([{ type: "text", content: "خطاب رسمي", style: { fontSize: 24 } }])],
    },
    {
      id: "a",
      title: "التقرير السنوي",
      sortOrder: 1,
      pages: [page([{ type: "text", content: "التقرير السنوي 2025", style: { fontSize: 44 } }])],
    },
    {
      id: "c",
      title: "صفحة بيانات",
      sortOrder: 0,
      pages: [page([{ type: "table", content: "" }, { type: "stat", content: "٪" }])],
    },
  ];
  const ordered = orderTemplates(entries);
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["c", "a", "b"],
  );
  // Deterministic: the same input never reorders between reads.
  assert.deepEqual(orderTemplates(entries).map((e) => e.id), ["c", "a", "b"]);
});
