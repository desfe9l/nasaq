import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTemplateNameToContent,
  generateTemplateName,
  isTemplatePlaceholderName,
  resolveTemplateName,
} from "./naming.ts";

const reportDocument = {
  name: "New Template",
  project: { name: "New Template", theme: "official" },
  pages: [
    {
      w: 210,
      h: 297,
      elements: [
        { type: "text", content: "مؤشرات الأداء والنتائج للربع الرابع" },
        { type: "table", content: "" },
      ],
    },
  ],
};

test("placeholder titles are replaced with a professional, content-aware name", () => {
  assert.equal(isTemplatePlaceholderName("Untitled"), true);
  assert.equal(isTemplatePlaceholderName("New Template"), true);
  assert.equal(isTemplatePlaceholderName("Template 1"), true);
  assert.equal(isTemplatePlaceholderName("قالب جديد"), true);
  assert.equal(
    resolveTemplateName({
      title: "Untitled",
      category: "reports",
      kind: "json",
      content: reportDocument,
    }),
    "تقرير أداء ربع سنوي",
  );
});

test("source filenames are cleaned and translated into a professional name", () => {
  assert.equal(
    generateTemplateName({
      title: "quarterly-performance-report-v2-final.docx",
      sourceName: "quarterly-performance-report-v2-final.docx",
      category: "reports",
      kind: "json",
      content: reportDocument,
    }),
    "تقرير أداء ربع سنوي",
  );
});

test("format, category and purpose produce professional defaults", () => {
  assert.equal(generateTemplateName({ category: "slides", kind: "json" }), "عرض مؤسسي احترافي");
  assert.equal(generateTemplateName({ category: "executive", format: "pptx", description: "عرض قيادي" }), "عرض قيادي رسمي");
  assert.equal(generateTemplateName({ category: "reports", kind: "json" }), "تقرير إداري احترافي");
});

test("language-sensitive naming recognizes Arabic CV content", () => {
  assert.equal(
    generateTemplateName({
      sourceName: "resume-final-v3.docx",
      category: "general",
      content: { pages: [{ elements: [{ type: "text", content: "السيرة الذاتية والخبرات المهنية" }] }] },
    }),
    "نموذج سيرة ذاتية عربية",
  );
});

test("meaningful manually entered names are preserved exactly", () => {
  const manual = "  Q4 Leadership Review — Final  ";
  assert.equal(
    resolveTemplateName({
      title: manual,
      titleIsManual: true,
      sourceName: "quarterly-performance-report.docx",
      category: "reports",
    }),
    manual,
  );
  assert.equal(resolveTemplateName({ title: "Annual Board Review" }), "Annual Board Review");
});

test("catalog title is persisted in both document and project metadata", () => {
  const result = applyTemplateNameToContent(JSON.stringify(reportDocument), "تقرير أداء ربع سنوي");
  const parsed = JSON.parse(result);
  assert.equal(parsed.name, "تقرير أداء ربع سنوي");
  assert.equal(parsed.project.name, "تقرير أداء ربع سنوي");
});
