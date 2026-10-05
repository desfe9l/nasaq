import assert from "node:assert/strict";
import { test } from "node:test";
import { THEMES } from "./model.ts";
import { FAMILY_TEMPLATES, buildFamilyPage } from "./template-families.ts";
import { PAGE_TEMPLATES, createTemplatePage } from "./templates.ts";

test("family templates stay inside the page and stay distinct", () => {
  const seen = new Set<string>();
  for (const meta of FAMILY_TEMPLATES) {
    assert.ok(PAGE_TEMPLATES.some((item) => item.id === meta.id), meta.id);
    const page = createTemplatePage(meta.id, THEMES.official, "جهة الاختبار");
    assert.equal(page.w, 210);
    assert.equal(page.h, 297);
    // Templates carry no forced clip; the workspace preference decides.
    assert.equal(page.clipContent, undefined);
    assert.ok(page.elements.length >= 5, meta.id);
    assert.equal(buildFamilyPage(meta.id, THEMES.official, "")?.elements.length, page.elements.length);
    const signature = page.elements
      .map((el) => `${el.type}:${Math.round(el.x)}:${Math.round(el.y)}:${el.style.fill ?? ""}:${el.style.fontSize ?? ""}`)
      .join("|");
    assert.ok(!seen.has(signature), `${meta.id} repeats another family layout`);
    seen.add(signature);
    for (const el of page.elements) {
      assert.ok(el.x >= -0.2 && el.y >= -0.2, `${meta.id}/${el.name} origin`);
      assert.ok(el.x + el.w <= page.w + 0.6, `${meta.id}/${el.name} width ${el.x}+${el.w}`);
      assert.ok(el.y + el.h <= page.h + 0.6, `${meta.id}/${el.name} height ${el.y}+${el.h}`);
    }
  }
});
