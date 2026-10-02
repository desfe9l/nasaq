import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject } from "@/lib/editor/templates";
import { pageSize } from "@/lib/editor/model";
import { critiqueProject } from "./critic";
import { literalDraft, validateProject } from "./layout";
import {
  designDna,
  generateTemplate,
  improveProject,
  improveReference,
  referenceAnalyses,
} from "./pipeline";
import { languageModelConfigured, DETERMINISTIC_MODEL_ID } from "./provider";

test("measured corpus keeps real page counts and does not invent missing text", () => {
  const analyses = referenceAnalyses();
  assert.equal(analyses.length, 18);
  const athil = analyses.find((item) => item.document.pages === 13);
  assert.ok(athil);
  assert.equal(athil.document.primary.w, 210);
  assert.equal(athil.document.primary.h, 297);
  const bronze = analyses.find((item) => item.document.pages === 34);
  assert.ok(bronze);
  assert.equal(bronze.document.pages, 34);
  assert.equal(bronze.document.format, "wide-slide");
  const namaa = analyses.find((item) => item.source.file.includes("النماء"));
  assert.ok(namaa);
  assert.equal(namaa.extractedLines.length, 0);
  assert.ok(namaa.limitations.some((line) => line.includes("No extractable text")));
  assert.match(namaa.palette.field, /^#[0-9a-fA-F]{6}$/);
  const khobar = analyses.find((item) => item.document.primary.w === 218);
  assert.ok(khobar);
  assert.match(khobar.title, /مزاد أرض الخبر/);
  assert.equal(/[\uFE70-\uFEFF]/.test(khobar.extractedLines.join("")), false);
});

test("design DNA is a system, not a copy of one reference", () => {
  const dna = designDna();
  assert.equal(dna.id, "nasaq-design-dna-v1");
  assert.equal(dna.sourceCount, 18);
  assert.equal(dna.direction, "rtl");
  assert.equal(dna.typography.display, "Tajawal");
  assert.ok(dna.styles.institutional.field === "#0c3d2c");
  assert.ok(dna.styles.auction.field !== dna.styles.institutional.field);
  assert.equal(dna.components.some((item) => item.nasaqTypes.includes("text")), true);
  const titles = referenceAnalyses().map((item) => item.title);
  assert.equal(dna.rules.join(" ").includes(titles[0]), false);
  assert.ok(dna.typography.observedFamilies.length > 3);
});

test("original generation is an editable RTL NASAQ project and does not copy a reference", () => {
  const result = generateTemplate({
    title: "تقرير الأداء الربعي",
    subtitle: "ملخص للجنة دون أرقام غير موثقة",
    org: "مكتب الخطة",
    style: "institutional",
    pages: 4,
    kind: "report",
  });
  assert.equal(result.path, "generate");
  assert.equal(result.project.pages.length, 4);
  assert.deepEqual(pageSize(result.project.pages[0]), { w: 210, h: 297 });
  assert.deepEqual(validateProject(result.project), []);
  assert.ok(result.iterations.length <= 3);
  const blob = JSON.stringify(result.project);
  assert.equal(blob.includes("0558494111"), false);
  assert.equal(blob.includes("برونز"), false);
  const title = result.project.pages[0].elements.find((el) => el.name === "العنوان");
  assert.equal(title?.content, "تقرير الأداء الربعي");
  assert.equal(title?.style.direction, "rtl");
  assert.equal(title?.style.textAlign, "right");
  assert.ok(result.critique.score >= 70);
  assert.equal(result.stoppedBecause === "stable" || result.stoppedBecause === "no-safe-fix" || result.stoppedBecause === "max-iterations", true);
});

test("the critic names a fix, and the improve path keeps existing NASAQ text", () => {
  const official = createProject("official", "official", "جهة الاختبار");
  const before = official.pages[0].elements.map((el) => el.content);
  const improved = improveProject(official, "القالب الرسمي");
  assert.equal(improved.path, "improve");
  assert.equal(improved.verdict?.contentKept, true);
  assert.equal(improved.verdict?.sizeKept, true);
  assert.equal(improved.project.pages.length, official.pages.length);
  assert.deepEqual(
    improved.project.pages[0].elements.map((el) => el.content),
    before,
  );
  assert.ok((improved.verdict?.scoreAfter ?? 0) >= (improved.verdict?.scoreBefore ?? 0));

  const athil = referenceAnalyses().find((item) => item.document.pages === 13);
  assert.ok(athil);
  const draft = literalDraft(athil);
  const weak = critiqueProject(draft);
  assert.ok(weak.issues.some((item) => item.metric === "rtl" && item.instruction.includes("rtl")));
  assert.ok(weak.score < 40);

  const rebuilt = improveReference(athil.id);
  assert.ok(rebuilt);
  assert.equal(rebuilt.project.pages.length, 13);
  assert.equal(rebuilt.verdict?.sizeKept, true);
  assert.equal(rebuilt.verdict?.titleKept, true);
  assert.equal(rebuilt.verdict?.realImprovement, true);
  assert.ok(rebuilt.verdict && rebuilt.verdict.scoreAfter > rebuilt.verdict.scoreBefore);
  assert.deepEqual(validateProject(rebuilt.project), []);
});

test("language model stays unwired unless a key exists", () => {
  assert.equal(DETERMINISTIC_MODEL_ID, "nasaq-measured-critic");
  assert.equal(languageModelConfigured({}), false);
  assert.equal(languageModelConfigured({ XAI_API_KEY: "  " }), false);
  assert.equal(languageModelConfigured({ XAI_API_KEY: "present" }), true);
});
