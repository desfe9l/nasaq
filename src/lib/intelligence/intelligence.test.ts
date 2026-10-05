import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, pageSize, THEMES, type Project } from "@/lib/editor/model";
import { createProject } from "@/lib/editor/templates";
import { applyGatedFixes, critiqueProject } from "./critic";
import { literalDraft, validateProject } from "./layout";
import {
  designDna,
  generateTemplate,
  improveProject,
  improveReference,
  referenceAnalyses,
} from "./pipeline";
import { languageModelConfigured, visualNoteReady, DETERMINISTIC_MODEL_ID } from "./provider";
import { adapterFor } from "./sources";

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
  assert.equal(JSON.stringify(rebuilt.project).includes("أضف محتوى"), false);
  assert.equal(/[\uFE70-\uFEFF]/.test(JSON.stringify(rebuilt.project)), false);
  assert.ok((rebuilt.verdict?.improvedAxes.length ?? 0) > 0);
  assert.ok(rebuilt.verdict?.axesAfter.structure >= rebuilt.verdict?.axesBefore.structure);
});

test("language model stays unwired unless a key exists", () => {
  assert.equal(DETERMINISTIC_MODEL_ID, "nasaq-measured-critic");
  assert.equal(languageModelConfigured({}), false);
	assert.equal(languageModelConfigured({ GEMINI_API_KEY: "  " }), false);
	assert.equal(languageModelConfigured({ GEMINI_API_KEY: "present" }), true);
	assert.equal(visualNoteReady({ GEMINI_API_KEY: "present" }, []), false);
	assert.equal(visualNoteReady({ GEMINI_API_KEY: "present" }, ["data:image/png;base64,abcd"]), false);
	assert.equal(
		visualNoteReady({ GEMINI_API_KEY: "present" }, [`data:image/png;base64,${"a".repeat(40)}`]),
    true,
  );
  assert.equal(adapterFor("psd").kind, "psd");
  assert.equal(adapterFor("psd").readsBytes, true);
  assert.match(adapterFor("psd").note, /does not parse PSD/);
  assert.equal(adapterFor("pdf").readsBytes, false);
});

test("a move that would overlap another element is not kept", () => {
  const upper = createElement(
    "text",
    {
      name: "أعلى",
      content: "عنوان القسم",
      x: 16,
      y: 250,
      w: 100,
      h: 30,
      style: { fontSize: 18, textAlign: "right", direction: "rtl", color: "#172033" },
    },
    THEMES.official,
  );
  const lower = createElement(
    "text",
    {
      name: "أسفل",
      content: "متن طويل",
      x: 16,
      y: 270,
      w: 100,
      h: 40,
      style: { fontSize: 11, textAlign: "right", direction: "rtl", color: "#172033" },
    },
    THEMES.official,
  );
  const project: Project = {
    version: 2,
    name: "حراسة",
    theme: "official",
    orgName: "",
    pages: [{ id: "p", name: "ص", w: 210, h: 297, elements: [upper, lower] }],
  };
  const beforeY = lower.y;
  const before = critiqueProject(project).score;
  const gated = applyGatedFixes(project);
  assert.ok(gated.scoreAfter >= before);
  assert.equal(gated.project.pages[0].elements.find((el) => el.name === "أسفل")?.y, beforeY);
  assert.equal(gated.accepted, false);
});

test("editorial composition is not the same cover as the institutional report", () => {
  const editorial = generateTemplate({
    title: "مذكرة داخلية",
    subtitle: "نص من الموجز فقط",
    org: "مكتب الخطة",
    style: "editorial",
    pages: 2,
    kind: "report",
  });
  const institutional = generateTemplate({
    title: "مذكرة داخلية",
    subtitle: "نص من الموجز فقط",
    org: "مكتب الخطة",
    style: "institutional",
    pages: 2,
    kind: "report",
  });
  const editorialTitle = editorial.project.pages[0].elements.find((el) => el.name === "العنوان");
  const institutionalTitle = institutional.project.pages[0].elements.find((el) => el.name === "العنوان");
  assert.ok(editorialTitle && institutionalTitle);
  assert.ok(editorialTitle.y > institutionalTitle.y + 40);
  assert.equal(editorial.project.pages[0].elements.some((el) => el.name === "حقل الغلاف"), false);
  assert.deepEqual(validateProject(editorial.project), []);
});

import { parsePrompt } from "./prompt-analyzer";
import { generateDesignFromPrompt } from "./pipeline";
import { generateVariations } from "./variations";

test("prompt analyzer correctly parses prompt intent, docType, and page count", () => {
  const cyber = parsePrompt("صمم تقريرًا رسميًا عن الأمن السيبراني");
  assert.equal(cyber.docType, "official_report");
  assert.ok(cyber.title.includes("السيبراني"));
  assert.equal(cyber.format, "a4-book");

  const govCover = parsePrompt("صمم غلاف تقرير سنوي لجهة حكومية");
  assert.equal(govCover.docType, "cover");
  assert.equal(govCover.pages, 1);
  assert.ok(govCover.title.includes("التقرير السنوي"));

  const presentation8 = parsePrompt("صمم عرضًا قياديًا من 8 صفحات");
  assert.equal(presentation8.docType, "presentation");
  assert.equal(presentation8.pages, 8);
  assert.equal(presentation8.format, "wide-slide");
  assert.equal(presentation8.orientation, "landscape");

  const companyProfile = parsePrompt("صمم صفحة تعريفية احترافية لشركة");
  assert.equal(companyProfile.docType, "company_profile");
  assert.ok(companyProfile.pages >= 1);
});

test("generateDesignFromPrompt creates production-ready editable NASAQ project with variations", () => {
  const result = generateDesignFromPrompt("صمم تقريرًا رسميًا عن الأمن السيبراني");
  assert.ok(result.primaryResult.project);
  assert.ok(result.primaryResult.project.pages.length >= 4);
  assert.deepEqual(validateProject(result.primaryResult.project), []);

  // Assert all elements are real NASAQ elements
  const allElements = result.primaryResult.project.pages.flatMap((p) => p.elements);
  assert.ok(allElements.length > 15);
  assert.ok(allElements.some((el) => el.type === "text"));
  assert.ok(allElements.some((el) => el.type === "shape"));
  assert.ok(allElements.some((el) => el.type === "table"));

  // Check variations
  assert.equal(result.variations.length, 4);
  for (const variation of result.variations) {
    assert.ok(variation.id);
    assert.ok(variation.name);
    assert.ok(variation.project.pages.length >= 4);
    assert.deepEqual(validateProject(variation.project), []);
    assert.ok(variation.score >= 80);
  }

  // Ensure filenames are not in user visible content
  const stringified = JSON.stringify(result.primaryResult.project);
  assert.equal(stringified.includes(".pdf"), false);
  assert.equal(stringified.includes("ref-"), false);
});
