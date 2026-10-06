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

test("a caller payload missing required fields is rejected, never crashed", () => {
  // Server-function input is caller-controlled: the `.validator()` is a type
  // annotation, not a runtime guard, so `normalizeDraftInput` must be total.
  // Reading `input.brief.trim()` here used to throw out of the handler (HTTP
  // 500) instead of returning the typed "invalid" result the panel renders.
  const empty = normalizeDraftInput({} as never);
  assert.equal(empty.brief, "");
  assert.equal(empty.audience, "");
  assert.equal(validDraftInput(empty), false);

  const wrongTypes = normalizeDraftInput({
    brief: 42,
    audience: null,
    tone: "نبرة",
    language: "fr",
    maxSections: "many",
    reportType: "unknown",
    detailLevel: "unknown",
    pageTarget: -3,
  } as never);
  assert.equal(wrongTypes.brief, "");
  assert.equal(wrongTypes.audience, "");
  assert.equal(wrongTypes.reportType, "executive");
  assert.equal(wrongTypes.detailLevel, "standard");
  assert.equal(wrongTypes.pageTarget, 1);
  assert.equal(validDraftInput(wrongTypes), false);

  // Optional text fields are trimmed when present and defaulted when absent.
  // A payload with only the two required strings still fails validation (the
  // tone/language enums are required) — but it fails with the typed result.
  const partial = normalizeDraftInput({ brief: "تقرير", audience: "الإدارة" } as never);
  assert.equal(validDraftInput(partial), false);

  const withOptionals = normalizeDraftInput({
    brief: "تقرير",
    audience: "الإدارة",
    tone: "official",
    language: "ar",
    documentTitle: "  العنوان  ",
    documentContext: undefined,
  } as never);
  assert.equal(withOptionals.documentTitle, "العنوان");
  assert.equal(withOptionals.documentContext, "");
  assert.equal(validDraftInput(withOptionals), true);
});
