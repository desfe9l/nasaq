import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyImport } from "../editor/import/detect.ts";
import { normalizeProjectJson } from "./normalize.ts";
import { buildTemplateDocument, serializeTemplateDocument } from "../templates/document-template.ts";

test("normalizes canonical JSON and isolates unsupported elements", () => {
  const normalized = normalizeProjectJson({
    schema: "nasaq.document",
    modelVersion: 2,
    project: { name: "قالب", theme: "official", orgName: "جهة", defaultSize: "a4-portrait" },
    pages: [{ id: "p1", w: 210, h: 297, elements: [
      { id: "ok", type: "text", x: 1, y: 1, w: 40, h: 10, content: "مرحبا", style: {} },
      { id: "bad", type: "future-widget", x: 0, y: 0, w: 10, h: 10 },
    ] }],
  });
  assert.equal(normalized.project.name, "قالب");
  assert.equal(normalized.project.pages[0].elements.length, 1);
  assert.ok(normalized.warnings.length > 0);
});

test("template JSON carries the NSQ canonical metadata envelope", () => {
  const doc = buildTemplateDocument({ name: "قالب", pages: [{ id: "p", name: "صفحة 1", w: 210, h: 297, elements: [] }] });
  const parsed = JSON.parse(serializeTemplateDocument(doc));
  assert.equal(parsed.schema, "nasaq.document");
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.project.name, "قالب");
});

test("classifies NSQ and JSON before external converters", () => {
  assert.equal(classifyImport("x.nsq", new Uint8Array([0x50, 0x4b, 0x03, 0x04])).format, "nsq");
  assert.equal(classifyImport("x.json", new TextEncoder().encode('{"pages":[]}')).format, "json");
});
