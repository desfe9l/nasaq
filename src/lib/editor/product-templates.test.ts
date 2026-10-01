import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProductTemplateSeeds } from "./product-templates.ts";

test("product masters are licensed native documents with complete editable pages", () => {
  const templates = buildProductTemplateSeeds();
  assert.equal(templates.length, 11);
  assert.deepEqual(
    templates.map((template) => template.id),
    [
      "builtin_resume_ar",
      "builtin_resume_en",
      "builtin_letterhead",
      "builtin_receipt_voucher",
      "builtin_designer_portfolio",
      "builtin_cash_receipt",
      "builtin_education_letterhead",
      "builtin_digital_business_card",
      "builtin_business_card",
      "builtin_payment_voucher",
      "builtin_greeting_card",
    ],
  );

  for (const template of templates) {
    assert.equal(template.tier, "licensed");
    assert.equal(template.status, "published");
    assert.equal(template.kind, "json");
    const document = JSON.parse(template.content) as {
      name: string;
      pages: { id: string; w: number; h: number; elements: { id: string; type: string; x: number; y: number; w: number; h: number; content?: string; src?: string }[] }[];
    };
    assert.equal(document.name, template.title);
    assert.ok(document.pages.length > 0, template.id);
    assert.match(template.thumbnail, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(template.thumbnail.split(",")[1], "base64").toString();
    const dimensions = svg.match(/width="(\d+)" height="(\d+)"/);
    assert.ok(dimensions, `${template.id} has intrinsic preview dimensions`);
    assert.ok(svg.includes("<text "), `${template.id} preview renders page text`);
    const previewRatio = Number(dimensions[1]) / Number(dimensions[2]);
    assert.ok(
      Math.abs(previewRatio - document.pages[0].w / document.pages[0].h) < 0.002,
      `${template.id} preview preserves page aspect ratio`,
    );
    for (const page of document.pages) {
      assert.ok(page.w > 0 && page.h > 0, `${template.id}/${page.id} has page geometry`);
      assert.ok(page.elements.length >= 5, `${template.id}/${page.id} has editable elements`);
      assert.equal(new Set(page.elements.map((element) => element.id)).size, page.elements.length);
      for (const element of page.elements) {
        assert.ok(element.x >= -0.01 && element.y >= -0.01, `${template.id}/${element.id} starts inside page`);
        assert.ok(element.x + element.w <= page.w + 0.5, `${template.id}/${element.id} fits page width`);
        assert.ok(element.y + element.h <= page.h + 0.5, `${template.id}/${element.id} fits page height`);
      }
    }
  }

  const portfolio = JSON.parse(templates.find((item) => item.id === "builtin_designer_portfolio")!.content);
  assert.equal(portfolio.pages.length, 4);
  assert.ok(portfolio.pages.flatMap((page: { elements: { type: string }[] }) => page.elements).some((element: { type: string }) => element.type === "image"));
  const portfolioPreview = Buffer.from(templates.find((item) => item.id === "builtin_designer_portfolio")!.thumbnail.split(",")[1], "base64").toString();
  assert.ok(portfolioPreview.includes("<image "));
  const resumePreview = Buffer.from(templates.find((item) => item.id === "builtin_resume_en")!.thumbnail.split(",")[1], "base64").toString();
  assert.ok(resumePreview.includes("FULL NAME"));
  const card = JSON.parse(templates.find((item) => item.id === "builtin_business_card")!.content);
  assert.equal(card.pages.length, 2);
  assert.deepEqual(card.pages.map((page: { w: number; h: number }) => [page.w, page.h]), [[94.9, 56.8], [94.9, 56.8]]);
  const education = templates.find((item) => item.id === "builtin_education_letterhead")!;
  assert.match(education.description, /بلا شعارات محمية أو ادعاء اعتماد حكومي/);
});