import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTemplateShareCopy, ensureTemplateShareUrl } from "./sharing-copy.ts";
import { shortTemplateToken, templateIdFromShortToken } from "./published.ts";

const templateId = "tpl_123e4567-e89b-12d3-a456-426614174000";

function decoded(url: string, key: string): string {
  return new URL(url).searchParams.get(key) || "";
}

test("Admin share links use a short reversible URL", () => {
  const token = shortTemplateToken(templateId);
  assert.ok(token);
  assert.equal(token.length, 22);
  assert.equal(templateIdFromShortToken(token), templateId);
});

test("X and Pinterest copy use the selected template's title, category, purpose and value", () => {
  const copy = buildTemplateShareCopy(
    {
      id: templateId,
      slug: "quarterly-performance-report",
      title: "تقرير أداء ربع سنوي",
      description: "إبراز نتائج الأداء ومتابعة مؤشرات الإنجاز خلال الربع.",
      category: "reports",
      kind: "json",
      content: JSON.stringify({
        pages: [{ w: 210, h: 297, elements: [{ type: "stat" }, { type: "table" }] }],
      }),
    },
    "https://nasaq.example",
  );

  assert.match(copy.url, /^https:\/\/nasaq\.example\/t\/[A-Za-z0-9_-]{22}$/);
  assert.match(copy.tweet, /تقرير أداء ربع سنوي/);
  assert.match(copy.tweet, /تقارير رسمية/);
  assert.match(copy.tweet, /إبراز نتائج الأداء/);
  assert.match(copy.tweet, /مؤشرات ونتائج/);
  assert.ok(copy.tweet.endsWith(copy.url));
  assert.match(copy.pinterestTitle, /تقرير أداء ربع سنوي/);
  assert.match(copy.pinterestDescription, /تقارير رسمية/);
  assert.ok(copy.pinterestDescription.includes(copy.url));
});

test("edited X copy retains the selected template short URL", () => {
  const url = "https://nasaq.example/t/Ej5FZ-ibEtOkVkJmFBdAAA";
  assert.equal(ensureTemplateShareUrl("Edited post", url), `Edited post\n${url}`);
  assert.equal(ensureTemplateShareUrl(`Edited post\n${url}`, url), `Edited post\n${url}`);
});

test("Pinterest flow fields are safely URL-encoded", () => {
  const copy = buildTemplateShareCopy({
    id: templateId,
    title: "عرض شركة احترافي",
    description: "عرض تعريفي للشركة",
    category: "slides",
    kind: "json",
    thumbnail: "https://images.example/template.jpg",
    content: JSON.stringify({ pages: [{ w: 338, h: 190, elements: [] }] }),
  }, "https://nasaq.example");
  const intent = new URL("https://www.pinterest.com/pin/create/button/");
  intent.searchParams.set("url", copy.url);
  intent.searchParams.set("media", copy.mediaUrl);
  intent.searchParams.set("title", copy.pinterestTitle);
  intent.searchParams.set("description", copy.pinterestDescription);
  assert.equal(decoded(intent.toString(), "url"), copy.url);
  assert.equal(decoded(intent.toString(), "media"), copy.mediaUrl);
  assert.equal(decoded(intent.toString(), "title"), copy.pinterestTitle);
  assert.ok(decoded(intent.toString(), "description").includes(copy.url));
});
