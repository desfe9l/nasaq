import assert from "node:assert/strict";
import test from "node:test";
import {
  draftAsText,
  normalizeDraft,
  normalizeDraftInput,
  validDraftInput,
} from "./contract.ts";

test("report draft input is trimmed and bounded", () => {
  const input = normalizeDraftInput({
    brief: `  ${"x".repeat(9_000)}  `,
    audience: "  الإدارة  ",
    tone: "official",
    language: "ar",
    maxSections: 99,
    reportType: "performance",
    detailLevel: "detailed",
    pageTarget: 3,
  });

  assert.equal(input.brief.length, 8_000);
  assert.equal(input.audience, "الإدارة");
  assert.equal(input.maxSections, 8);
  assert.equal(input.reportType, "performance");
  assert.equal(input.detailLevel, "detailed");
  assert.equal(input.pageTarget, 3);
  assert.equal(validDraftInput(input), true);
});

test("report draft normalisation removes unusable sections", () => {
  const draft = normalizeDraft(
    {
      title: "  تقرير  ",
      summary: "ملخص",
      sections: [
        { heading: "فارغ", body: "", bullets: [] },
        { heading: "نتائج", body: "النص", bullets: ["نقطة", 4] },
      ],
      nextSteps: ["مراجعة", null],
    },
    4,
  );

  assert.equal(draft.title, "تقرير");
  assert.equal(draft.sections.length, 1);
  assert.deepEqual(draft.sections[0].bullets, ["نقطة"]);
  assert.match(draftAsText(draft), /نتائج/);
});
