import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegacyTemplateSeeds, buildProductTemplateSeeds } from "./product-templates.ts";
import { PACKS, PAGE_TEMPLATES } from "./templates.ts";
import { buildCatalog } from "@/lib/templates/catalog";
import { normalizeSection } from "@/lib/admin/types";

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

test("all legacy packs and page templates receive stable Admin records preserving visibility", () => {
  const templates = buildLegacyTemplateSeeds();
  assert.equal(templates.length, PACKS.length + PAGE_TEMPLATES.length);
  assert.equal(new Set(templates.map((template) => template.id)).size, templates.length);
  assert.deepEqual(
    templates.filter((template) => template.id.startsWith("builtin_pack_")).map((template) => template.id),
    PACKS.map((pack) => `builtin_pack_${pack.id}`),
  );
  assert.deepEqual(
    templates.filter((template) => template.id.startsWith("builtin_page_")).map((template) => template.id),
    PAGE_TEMPLATES.map((page) => `builtin_page_${page.id}`),
  );
  for (const template of templates) {
    assert.equal(template.status, "published");
    assert.equal(template.kind, "json");
    assert.match(template.thumbnail, /^data:image\/svg\+xml;base64,/);
    const document = JSON.parse(template.content) as { pages: { elements: unknown[] }[] };
    assert.ok(document.pages.length > 0, template.id);
    // The blank pack IS an empty sheet by product intent — every other seed
    // must still carry real artwork.
    if (template.id !== "builtin_pack_blank")
      assert.ok(document.pages.every((page) => page.elements.length > 0), template.id);
  }
  assert.equal(templates.find((template) => template.id === "builtin_pack_blank")?.tier, "free");
  assert.ok(templates.filter((template) => template.id.startsWith("builtin_pack_") && template.id !== "builtin_pack_blank").every((template) => template.tier === "licensed"));
  assert.ok(templates.filter((template) => template.id.startsWith("builtin_page_")).every((template) => template.tier === "free"));
});

test("Admin template overrides replace their catalog entry and drafts hide the fallback", () => {
  const managed = {
    id: "builtin_page_cover",
    slug: "nasaq-page-cover",
    title: "غلاف معدل من الإدارة",
    description: "بيانات محدثة",
    category: "covers",
    tier: "free" as const,
    status: "published" as const,
    kind: "json" as const,
    thumbnail: "data:image/svg+xml;base64,PHN2Zy8+",
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };
  const published = buildCatalog({
    themeId: "official",
    managedTemplates: [managed],
    managedStates: [{ id: managed.id, status: "published" }],
  });
  const entry = published.find((item) => item.id === "page:cover");
  assert.equal(entry?.title, managed.title);
  assert.equal(entry?.thumbnail, managed.thumbnail);
  assert.equal(entry?.managedTemplate?.id, managed.id);

  const draft = buildCatalog({
    themeId: "official",
    managedTemplates: [],
    managedStates: [{ id: managed.id, status: "draft" }],
  });
  assert.equal(draft.some((item) => item.id === "page:cover"), false);
});

test("homepage feature stores one real Admin catalog ID and can be explicitly removed", () => {
  const legacy = normalizeSection("texts", {
    heroTitle: "عنوان قديم",
    // Old preset tabs are deliberately ignored; they are not catalog records.
    showcaseTabs: [{ templateId: "slides", label: "عرض", enabled: true }],
  });
  assert.equal(legacy.heroTitle, "عنوان قديم");
  assert.equal(legacy.featuredTemplateId, "builtin_page_cover");

  const selected = normalizeSection("texts", {
    featuredTemplateId: "tpl_catalog_record_01",
  });
  assert.equal(selected.featuredTemplateId, "tpl_catalog_record_01");

  const removed = normalizeSection("texts", { featuredTemplateId: "" });
  assert.equal(removed.featuredTemplateId, "");
});