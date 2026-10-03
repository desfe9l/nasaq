/**
 * NASAQ — tests for the Home «إنشاء مستند جديد» configuration
 * (`new-document.ts`): page geometry, page-count limits, and the project
 * each configuration builds.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_NEW_PAGES,
  buildNewDocument,
  clampPages,
  configFromPage,
  defaultNewDocument,
  describeConfig,
  pageDimensions,
} from "./new-document.ts";
import { createProject } from "./templates.ts";

test("pageDimensions orients every size", () => {
  assert.deepEqual(pageDimensions("a4", "portrait"), { w: 210, h: 297 });
  assert.deepEqual(pageDimensions("a4", "landscape"), { w: 297, h: 210 });
  assert.deepEqual(pageDimensions("a3", "portrait"), { w: 297, h: 420 });
  const slide = pageDimensions("slide", "landscape");
  assert.ok(slide.w > slide.h);
  // A custom size is clamped to a printable range and still honours orientation.
  assert.deepEqual(pageDimensions("custom", "landscape", { w: 100, h: 20 }), {
    w: 100,
    h: 50,
  });
  assert.deepEqual(
    pageDimensions("custom", "portrait", { w: Number.NaN, h: 5000 }),
    { w: 210, h: 1200 },
  );
});

test("clampPages keeps the count between 1 and the limit", () => {
  assert.equal(clampPages(0), 1);
  assert.equal(clampPages(-4), 1);
  assert.equal(clampPages(3.9), 3);
  assert.equal(clampPages(Number.NaN), 1);
  assert.equal(clampPages(999), MAX_NEW_PAGES);
  assert.equal(clampPages(12, 5), 5);
});

test("the default configuration is one A4 portrait page", () => {
  const project = buildNewDocument(defaultNewDocument());
  assert.equal(project.pack, "blank");
  assert.equal(project.theme, "official");
  assert.equal(project.pages.length, 1);
  assert.equal(project.pages[0].w, 210);
  assert.equal(project.pages[0].h, 297);
  assert.ok(project.name.length > 0);
});

test("a blank configuration reaches every page with fresh ids", () => {
  const config = defaultNewDocument({
    size: "a3",
    orientation: "landscape",
    pages: 4,
    theme: "slate",
    name: "  جدول المؤشرات  ",
    orgName: "وزارة الاختبار",
  });
  const project = buildNewDocument(config);
  assert.equal(project.name, "جدول المؤشرات");
  assert.equal(project.orgName, "وزارة الاختبار");
  assert.equal(project.theme, "slate");
  assert.equal(project.pages.length, 4);
  for (const page of project.pages)
    assert.deepEqual([page.w, page.h], [420, 297]);
  const ids = project.pages.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notDeepEqual(
    buildNewDocument(config).pages.map((p) => p.id),
    ids,
  );
  assert.match(describeConfig(config), /A3 أفقي/);
});

test("a workspace document keeps the current sheet instead of an unrelated A4", () => {
  const wide = configFromPage({ w: 400, h: 180, bg: "#f4f6fa" });
  const project = buildNewDocument(defaultNewDocument(wide));
  assert.equal(project.pages.length, 1);
  assert.equal(project.pages[0].w, 400);
  assert.equal(project.pages[0].h, 180);
  assert.equal(project.pages[0].bg, "#f4f6fa");
  const a4 = configFromPage({ w: 297, h: 210 });
  assert.equal(a4.size, "a4");
  assert.equal(a4.orientation, "landscape");
  assert.deepEqual(
    [
      buildNewDocument(defaultNewDocument(a4)).pages[0].w,
      buildNewDocument(defaultNewDocument(a4)).pages[0].h,
    ],
    [297, 210],
  );
});

test("a blank start is a truly empty sheet by default", () => {
  const project = buildNewDocument(defaultNewDocument());
  const page = project.pages[0];
  assert.equal(page.elements.length, 0, "no header, footer or placeholder");
  assert.equal(page.bg, "#ffffff");
  assert.deepEqual([page.w, page.h], [210, 297]);
});

test("the blank start can carry the light chrome and a chosen background", () => {
  const chrome = buildNewDocument(
    defaultNewDocument({ content: "chrome", orgName: "وزارة الاختبار" }),
  );
  assert.ok(
    chrome.pages[0].elements.length > 0,
    "chrome start keeps its header/footer",
  );
  const tinted = buildNewDocument(defaultNewDocument({ bg: "#f4f6fa" }));
  assert.equal(tinted.pages[0].bg, "#f4f6fa");
  // A malformed colour falls back to white instead of shipping broken CSS.
  const safe = buildNewDocument(defaultNewDocument({ bg: "not-a-color" }));
  assert.equal(safe.pages[0].bg, "#ffffff");
});

test("letter and legal are first-class sizes", () => {
  assert.deepEqual(pageDimensions("letter", "portrait"), {
    w: 215.9,
    h: 279.4,
  });
  const legal = pageDimensions("legal", "landscape");
  assert.deepEqual(legal, { w: 355.6, h: 215.9 });
});

test("a template configuration keeps the pack's own pages and size", () => {
  const pack = createProject("official");
  const project = buildNewDocument(
    defaultNewDocument({
      start: "template",
      pack: "official",
      pages: 1,
      size: "a3",
    }),
  );
  assert.equal(project.pack, "official");
  assert.equal(project.pages.length, pack.pages.length);
  assert.deepEqual(
    project.pages.map((p) => [p.w, p.h]),
    pack.pages.map((p) => [p.w, p.h]),
  );
  assert.equal(project.name, pack.name);
});
