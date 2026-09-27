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
