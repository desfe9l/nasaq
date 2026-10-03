import assert from "node:assert/strict";
import test from "node:test";
import { buildReportBlock, buildReportDraftBlock, REPORT_BLOCKS } from "./report-blocks.ts";

test("report blocks are editable groups built from existing element types", () => {
  for (const definition of REPORT_BLOCKS) {
    const block = buildReportBlock(definition.id, "official");
    assert.ok(block);
    assert.equal(block.type, "group");
    assert.ok((block.children?.length || 0) >= 2);
    assert.ok(block.children?.every((child) => child.type !== "group" || child.children?.length));
  }
});

test("AI drafts become a structured group instead of a single text box", () => {
  const block = buildReportDraftBlock("official", {
    title: "تقرير الأداء",
    summary: "ملخص قابل للمراجعة",
    sections: [
      { heading: "النتائج", body: "تحسن الأداء", bullets: ["نقطة قابلة للتحقق"] },
      { heading: "التحديات", body: "تحتاج البيانات إلى مراجعة", bullets: [] },
    ],
    nextSteps: ["اعتماد المؤشر"],
  });

  assert.ok(block);
  assert.equal(block.type, "group");
  assert.equal(block.children?.filter((child) => child.type === "box").length, 4);
  assert.ok(block.children?.some((child) => child.name === "عنوان قسم التقرير 1"));
});
