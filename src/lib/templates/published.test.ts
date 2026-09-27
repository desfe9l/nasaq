import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedTemplatePath, publishedTemplateSeed, slugifyTitle, templateDisplaySlug, publishedTemplateAbsoluteUrl } from "./published.ts";
import type { AdminTemplate } from "@/lib/admin/types";

const base = { id: "tpl_1", slug: "nasaq-model", title: "نموذج", description: "", category: "general", tier: "free", status: "published", kind: "json", thumbnail: null, sortOrder: 0, createdAt: "", updatedAt: "" } as AdminTemplate;

test("published links identify a template without leaking content", () => {
  assert.equal(publishedTemplatePath("tpl_1"), "/templates/tpl_1");
  assert.equal(publishedTemplatePath("a/b"), "/templates/a%2Fb");
  assert.equal(templateDisplaySlug({ id: "tpl_1", slug: "my-template" }), "my-template");
  assert.equal(templateDisplaySlug({ id: "tpl_1", slug: null }), "tpl_1");
  assert.equal(slugifyTitle("تقرير سنوي 2025"), "تقرير-سنوي-2025");
  assert.equal(slugifyTitle("Annual Report 2025"), "annual-report-2025");
  assert.equal(publishedTemplateAbsoluteUrl("my-template"), "https://nasaq-sa.vercel.app/templates/my-template");
});

test("published JSON opens as an independent copy, without original project identity", () => {
  const original = { id: "private-project", name: "private", pages: [{ id: "old-page", name: "صفحة", w: 210, h: 297, elements: [{ id: "old-el", type: "text", content: "hello", children: [{ id: "child", type: "text" }] }] }] };
  const template = { ...base, content: JSON.stringify(original) };
  const first = publishedTemplateSeed(template);
  const second = publishedTemplateSeed(template);
  assert.deepEqual(Object.keys(first).sort(), ["name", "pages"]);
  assert.equal(first.name, base.title);
  assert.notEqual(first.pages[0].id, original.pages[0].id);
  assert.notEqual(first.pages[0].id, second.pages[0].id);
  assert.notEqual(first.pages[0].elements[0].id, original.pages[0].elements[0].id);
  assert.notEqual(first.pages[0].elements[0].children?.[0].id, "child");
  first.pages[0].elements[0].content = "edited";
  assert.equal(JSON.parse(template.content).pages[0].elements[0].content, "hello");
});

test("SVG uses an editable working page; malformed JSON is refused", () => {
  const svg = publishedTemplateSeed({ ...base, kind: "svg", content: "<svg/>" });
  assert.equal(svg.pages[0].elements[0].type, "svg");
  assert.equal(svg.pages[0].elements[0].content, "<svg/>");
  assert.throws(() => publishedTemplateSeed({ ...base, content: '{"pages":[]}' }));
});
