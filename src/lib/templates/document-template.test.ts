import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTemplateDocument,
  publicTemplateContent,
  serializeTemplateDocument,
  templateDocumentSummary,
  templateToProjectSeed,
  validateTemplateDocument,
} from "./document-template.ts";
import type { Page } from "@/lib/editor/model";

const page: Page = {
  id: "page-1",
  name: "غلاف",
  w: 297,
  h: 210,
  bg: "#f7f6f3",
  bgImage: "data:image/png;base64,aaaa",
  elements: [
    {
      id: "el-1",
      type: "text",
      name: "عنوان",
      x: 10,
      y: 12,
      w: 80,
      h: 16,
      rotation: 0,
      opacity: 1,
      z: 1,
      content: "تقرير سنوي — من اليمين إلى اليسار",
      style: {},
    },
  ],
};

test("template payload keeps editable pages and does not flatten", () => {
  const doc = buildTemplateDocument({
    name: "قالب الجهة",
    theme: "official",
    orgName: "نَسَق",
    defaultSize: "a4-landscape",
    pages: [page],
    licensedTemplateId: "tpl_secret",
  });
  const raw = serializeTemplateDocument(doc);
  assert.equal(validateTemplateDocument(raw), null);
  assert.equal(doc.rtl, true);
  assert.equal(doc.pages[0].w, 297);
  assert.equal(doc.pages[0].h, 210);
  assert.equal(doc.pages[0].bgImage, page.bgImage);
  assert.equal(doc.pages[0].elements[0].content, page.elements[0].content);
  assert.equal(raw.includes("data:image/png"), true);
  assert.equal(raw.includes("\"type\":\"image\"") && raw.includes("flattened"), false);
  const summary = templateDocumentSummary(raw);
  assert.equal(summary?.pageCount, 1);
  assert.equal(summary?.w, 297);
  assert.equal(summary?.h, 210);
  const seed = templateToProjectSeed(raw, "نسخة");
  assert.notEqual(seed.pages[0].id, "page-1");
  assert.equal(seed.pages[0].elements[0].content, page.elements[0].content);
  assert.equal(seed.licensedTemplateId, "tpl_secret");
});

test("template payload drops account and payment fields", () => {
  const dirty = {
    ...page,
    elements: [{ ...page.elements[0], licenseKey: "secret-key", email: "a@b.c" }],
  } as unknown as Page;
  const raw = serializeTemplateDocument(
    buildTemplateDocument({ name: "خاص", pages: [dirty] }),
  );
  assert.equal(raw.includes("secret-key"), false);
  assert.equal(raw.includes("a@b.c"), false);
  const pub = publicTemplateContent(raw);
  assert.ok(pub);
  assert.equal(pub!.includes("licenseKey"), false);
});

test("corrupt template JSON is rejected", () => {
  assert.match(validateTemplateDocument("{") || "", /تالف/);
  assert.match(validateTemplateDocument("{\"pages\":[]}") || "", /صفحات/);
  assert.equal(publicTemplateContent("nope"), null);
});
