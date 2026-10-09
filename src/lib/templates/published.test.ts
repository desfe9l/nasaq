import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergePublishedTemplateContext,
  publishedTemplatePath,
  publishedTemplateSeed,
  slugifyTitle,
  templateDisplaySlug,
  publishedTemplateAbsoluteUrl,
} from "./published.ts";
import type { AdminTemplate } from "@/lib/admin/types";

const base = { id: "tpl_1", slug: "nasaq-model", title: "نموذج", description: "", category: "general", tier: "free", status: "published", kind: "json", thumbnail: null, sortOrder: 0, createdAt: "", updatedAt: "" } as AdminTemplate;

test("published links identify a template without leaking content", () => {
  assert.equal(publishedTemplatePath("tpl_1"), "/templates/tpl_1");
  assert.equal(publishedTemplatePath("a/b"), "/templates/a%2Fb");
  assert.equal(templateDisplaySlug({ id: "tpl_1", slug: "my-template" }), "my-template");
  assert.equal(templateDisplaySlug({ id: "tpl_1", slug: null }), "tpl_1");
  assert.equal(slugifyTitle("تقرير سنوي 2025"), "تقرير-سنوي-2025");
  assert.equal(slugifyTitle("Annual Report 2025"), "annual-report-2025");
  assert.equal(publishedTemplateAbsoluteUrl("my-template"), "https://www.nasaq.team/templates/my-template");
});

test("published JSON opens as an independent copy, without original project identity", () => {
  const original = {
    id: "private-project",
    name: "private",
    pack: "official",
    pages: [
      {
        id: "old-page",
        name: "صفحة",
        w: 210,
        h: 297,
        elements: [
          {
            id: "old-el",
            type: "text",
            content: "hello",
            children: [{ id: "child", type: "text" }],
          },
        ],
      },
    ],
  };
  const template = { ...base, content: JSON.stringify(original) };
  const first = publishedTemplateSeed(template);
  const second = publishedTemplateSeed(template);
  assert.deepEqual(Object.keys(first).sort(), [
    "defaultSize",
    "name",
    "orgName",
    "pack",
    "pages",
    "theme",
  ]);
  assert.equal(first.pack, "official");
  assert.equal(first.defaultSize, "a4-portrait");
  const licensed = publishedTemplateSeed({
    ...template,
    tier: "licensed",
  });
  assert.equal(licensed.licensedTemplateId, template.id);
  assert.equal(first.name, base.title);
  const merged = mergePublishedTemplateContext(licensed, {
    ...first,
    theme: "sand",
    orgName: "الجهة",
    defaultSize: "a4-landscape",
    pack: "briefing",
    licensedTemplateId: "stale-client-tier",
  });
  assert.equal(merged.theme, "sand");
  assert.equal(merged.orgName, "الجهة");
  assert.equal(merged.defaultSize, "a4-portrait");
  assert.equal(merged.pack, "official");
  assert.equal(merged.licensedTemplateId, base.id);
  assert.notEqual(first.pages[0].id, original.pages[0].id);
  assert.notEqual(first.pages[0].id, second.pages[0].id);
  assert.notEqual(first.pages[0].elements[0].id, original.pages[0].elements[0].id);
  assert.notEqual(first.pages[0].elements[0].children?.[0].id, "child");
  first.pages[0].elements[0].content = "edited";
  assert.equal(JSON.parse(template.content).pages[0].elements[0].content, "hello");
});

test("a saved nasaq template keeps pages, size, theme and fonts", () => {
  const content = JSON.stringify({
    format: "nasaq.template",
    version: 1,
    name: "سري",
    theme: "ministry",
    orgName: "الجهة",
    defaultSize: "a4-landscape",
    transactionNo: "1447",
    rtl: true,
    userId: "must-not-survive",
    licenseKey: "must-not-survive",
    embeddedFonts: [{ family: "IBM Plex Sans Arabic", dataUrl: "data:font/ttf;base64,AA" }],
    pages: [
      {
        id: "p1",
        name: "غلاف",
        w: 297,
        h: 210,
        bg: "#071d3d",
        elements: [{ id: "e1", type: "text", content: "من اليمين", x: 10, y: 10, w: 40, h: 12 }],
      },
    ],
  });
  const seed = publishedTemplateSeed({ ...base, content });
  assert.equal(seed.theme, "ministry");
  assert.equal(seed.orgName, "الجهة");
  assert.equal(seed.transactionNo, "1447");
  assert.equal(seed.defaultSize, "a4-landscape");
  assert.equal(seed.pages[0].w, 297);
  assert.equal(seed.pages[0].h, 210);
  assert.equal(seed.pages[0].bg, "#071d3d");
  assert.equal(seed.pages[0].elements[0].content, "من اليمين");
  assert.equal(seed.embeddedFonts?.[0].family, "IBM Plex Sans Arabic");
  assert.equal("userId" in seed, false);
  assert.equal("licenseKey" in seed, false);
  assert.notEqual(seed.pages[0].id, "p1");
});

test("SVG uses an editable working page; malformed JSON is refused", () => {
  const svg = publishedTemplateSeed({ ...base, kind: "svg", content: "<svg/>" });
  assert.equal(svg.pages[0].elements[0].type, "svg");
  assert.equal(svg.pages[0].elements[0].content, "<svg/>");
  assert.throws(() => publishedTemplateSeed({ ...base, content: '{"pages":[]}' }));
});
