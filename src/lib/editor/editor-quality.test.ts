import test from "node:test";
import assert from "node:assert/strict";
import { createElement, pageSize } from "./model";
import { strokePatch, strokePixels } from "./stroke";
import { clampPanel } from "./panel-geometry";
import { measuredSelectionBox } from "./ui-state";
import { buildIdentityDocument } from "./identity-document";
import { DEFAULT_BRAND_KIT } from "../product/product";
import { buildScenePage } from "./scene";

test("stroke round trips CSS pixels through actual metric and native SVG fields", () => {
  for (const type of [
    "shape",
    "box",
    "table",
    "line",
    "divider",
    "icon",
    "svg",
  ] as const) {
    const el = createElement(type, {
      w: 40,
      h: 30,
      content: '<svg viewBox="0 0 24 24"></svg>',
    });
    for (const value of [0, 0.5, 8, 50]) {
      el.style = { ...el.style, ...strokePatch(el, value) };
      assert.equal(
        strokePixels(JSON.parse(JSON.stringify(el))),
        value,
        `${type}: ${value}`,
      );
    }
  }
});

test("stroke rejects nonfinite values and unsupported artwork", () => {
  assert.equal(strokePatch(createElement("text"), 2), null);
  assert.equal(strokePatch(createElement("shape"), NaN), null);
  assert.equal(strokePixels(createElement("svg")), undefined);
});

test("panels remain entirely inside each requested viewport after drag/resize", () => {
  for (const [width, height] of [
    [1920, 1080],
    [768, 1024],
    [375, 812],
  ]) {
    for (const rect of [
      { left: -500, top: -300, width: 900, height: 1400 },
      { left: 3000, top: 2000, width: 320, height: 420 },
    ]) {
      const out = clampPanel(rect, { width, height }, 80);
      assert.ok(out.left >= 8 && out.top >= 80);
      assert.ok(out.left + out.width <= width - 8);
      assert.ok(out.top + out.height <= height - 8);
    }
  }
});

test("small rotations cannot inflate selection by inverse-rotating an AABB", () => {
  assert.equal(
    measuredSelectionBox({
      node: { left: 0, top: 0, right: 11, bottom: 11 },
      page: { left: 0, top: 0, width: 210 },
      pageWidthMm: 210,
      model: { x: 0, y: 0, w: 10, h: 10 },
      rotation: 3,
    }),
    null,
  );
});

test("certificate preview, persisted document and export scene share real A4 dimensions", () => {
  for (const orientation of ["a4-portrait", "a4-landscape"] as const) {
    const project = buildIdentityDocument(
      {
        ...DEFAULT_BRAND_KIT,
        pageSize: orientation,
        organizationName: "جهة اختبار",
      },
      "certificate",
      "2026",
      "مستلم اختبار",
    );
    const page = JSON.parse(JSON.stringify(project)).pages[0];
    assert.deepEqual(
      pageSize(page),
      orientation === "a4-portrait" ? { w: 210, h: 297 } : { w: 297, h: 210 },
    );
    assert.ok(
      page.elements.some(
        (el: { content: string }) => el.content === "مستلم اختبار",
      ),
    );
    assert.ok(
      page.elements.every(
        (el: { x: number; y: number; w: number; h: number }) =>
          el.x >= 0 &&
          el.y >= 0 &&
          el.x + el.w <= page.w &&
          el.y + el.h <= page.h,
      ),
    );
    const scene = buildScenePage(page);
    assert.equal(scene.w, page.w);
    assert.equal(scene.h, page.h);
  }
  assert.deepEqual(
    pageSize(buildIdentityDocument(DEFAULT_BRAND_KIT, "certificate").pages[0]),
    { w: 210, h: 297 },
  );
});

test("zero line stroke stays invisible in Office export scenes", () => {
  const project = buildIdentityDocument(DEFAULT_BRAND_KIT, "certificate");
  project.pages[0].elements = [
    createElement("line", { style: { stroke: 0 } }),
    createElement("divider", { style: { stroke: 0 } }),
  ];
  assert.equal(buildScenePage(project.pages[0]).items.length, 0);
});

test("toolbar finds a free band rather than covering a floating panel close button", async () => {
  const { placeFloatingToolbar } = await import("./ui-state");
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const avoid = [
    box(0, 0, 375, 124),
    box(42, 200, 320, 436),
    box(314, 134, 52, 480),
  ];
  const p = placeFloatingToolbar(
    box(155, 355, 66, 52),
    { width: 290, height: 42 },
    { width: 375, height: 812 },
    16,
    8,
    avoid,
  );
  for (const r of avoid)
    assert.ok(
      p.left + 290 <= r.left ||
        p.left >= r.right ||
        p.top + 42 <= r.top ||
        p.top >= r.bottom,
    );
});

test("zero table borders survive the scene boundary without a default being reintroduced", () => {
  const project = buildIdentityDocument(DEFAULT_BRAND_KIT, "certificate");
  project.pages[0].elements = [
    createElement("table", { style: { borderWidth: 0 } }),
  ];
  const item = buildScenePage(project.pages[0]).items[0];
  assert.equal(item.kind, "table");
  if (item.kind === "table") assert.equal(item.border.width, 0);
});

test("active page rail and artboard use clean green active-state tokens and license copy avoids awkward phrasing", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("src/styles.css", "utf8");
  assert.match(css, /\.page-rail-item\.is-active\s*\{[^}]*--editor-success/);
  assert.match(css, /\.page-rail-number-active\s*\{[^}]*--editor-success/);
  assert.match(css, /\.artboard-active-outline\s*\{[^}]*--editor-success/);

  /*
   * A premium template carries its requirement AND its price: the shelf shows
   * the shared access note, and every card carries the compact chip. The old
   * assertion pinned a phrase that said "available in the full version" without
   * ever saying what that costs; the requirement is now stronger, so the test
   * is too.
   */
  const premium = readFileSync(
    "src/components/site/PremiumTemplates.tsx",
    "utf8",
  );
  assert.doesNotMatch(premium, /قالب مرخص/);
  assert.match(premium, /PremiumAccessNote/);
  const access = readFileSync("src/components/site/TemplateAccess.tsx", "utf8");
  assert.match(access, /PREMIUM_FROM_SAR/);
  assert.match(access, /يتطلب ترخيصًا/);
  assert.match(access, /احصل على الترخيص/);
  assert.match(access, /تواصل مع المبيعات/);
});
