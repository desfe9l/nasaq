import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NASAQ_DESIGN_SKILL, boundDesignSurfaces } from "./design-skill.ts";
import "./template-layouts.ts";
import "./template-families.ts";
import "./templates.ts";
import "./product-templates.ts";
import { FAMILY_TEMPLATES } from "./template-families.ts";
import { PACKS, PAGE_TEMPLATES } from "./templates.ts";
import { buildProductTemplateSeeds } from "./product-templates.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const REQUIRED_PHRASES = [
  "NASAQ is not a generic document builder",
  "Arabic-first",
  "Do not take an English template and simply mirror it.",
  "QUALITY OVER QUANTITY.",
  "would a professional Saudi government communications team",
  "Do not flatten a professional template into an image.",
  "rounded cards",
  "Do not add a parallel catalog",
  "Display",
  "Page Number",
  "Government / Institutional",
  "Educational",
];

const KEPT_PACKS: (typeof PACKS)[number]["id"][] = ["official", "eid", "briefing", "slides", "blank"];
const KEPT_FAMILIES = [
  "family-gov-cover",
  "family-gov-opener",
  "family-corp-cover",
  "family-exec-brief",
  "family-annual-kpis",
  "family-editorial-open",
  "family-editorial-quote",
  "family-minimal-prose",
  "family-finance-ledger",
  "family-media-spread",
  "family-leadership-close",
  "family-project-phases",
  "family-performance",
  "family-premium-cover",
];
const KEPT_PAGES = [
  "cover",
  "cover-celebration",
  "text",
  "contents",
  "achievements",
  "images",
  "thanks",
  "closing",
  "stats",
  "stats-board",
  "table-data",
  "infographic",
  "slide-cover",
  "slide-stats",
  "editorial",
  "institutional-grid",
  "data-focus",
  "vertical-flow",
  "asymmetric",
  "modular",
  "executive",
  "statistical",
  "section-divider",
  "process",
];
const KEPT_PRODUCTS = [
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
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".output") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function definers(pattern: RegExp): string[] {
  return walk(join(root, "src"))
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
}

test("template generation is bound to the nasaq-media skill", () => {
  assert.equal(NASAQ_DESIGN_SKILL.id, "nasaq-media");
  assert.equal(NASAQ_DESIGN_SKILL.path, ".grok/skills/nasaq-media/SKILL.md");
  assert.deepEqual(boundDesignSurfaces(), ["layouts", "packs", "families", "products"]);

  const skill = readFileSync(join(root, NASAQ_DESIGN_SKILL.path), "utf8");
  for (const phrase of REQUIRED_PHRASES) {
    assert.ok(skill.includes(phrase), `skill missing: ${phrase}`);
  }

  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const project = readFileSync(join(root, "AGENTS.project.md"), "utf8");
  const productsScript = readFileSync(join(root, "package.json"), "utf8");
  for (const doc of [agents, project]) {
    assert.ok(doc.includes(NASAQ_DESIGN_SKILL.path), "workflow does not route to the skill");
  }
  assert.match(productsScript, /design-skill\.test\.ts/);
});

test("the skill does not replace the existing template catalog", () => {
  assert.deepEqual(definers(/export const PACKS\b/), ["src/lib/editor/templates.ts"]);
  assert.deepEqual(definers(/export const PAGE_TEMPLATES\b/), ["src/lib/editor/templates.ts"]);
  assert.deepEqual(definers(/export const FAMILY_TEMPLATES\b/), [
    "src/lib/editor/template-families.ts",
  ]);
  assert.deepEqual(definers(/export function buildProductTemplateSeeds\b/), [
    "src/lib/editor/product-templates.ts",
  ]);

  const packIds = PACKS.map((pack) => pack.id);
  const pageIds = PAGE_TEMPLATES.map((page) => page.id);
  const familyIds = FAMILY_TEMPLATES.map((family) => family.id);
  const productIds = buildProductTemplateSeeds().map((template) => template.id);

  for (const id of KEPT_PACKS) assert.ok(packIds.includes(id), id);
  for (const id of KEPT_PAGES) assert.ok(pageIds.includes(id), id);
  for (const id of KEPT_FAMILIES) {
    assert.ok(familyIds.includes(id), id);
    assert.ok(pageIds.includes(id), id);
  }
  for (const id of KEPT_PRODUCTS) assert.ok(productIds.includes(id), id);
  assert.equal(readFileSync(join(root, "src/lib/editor/design-skill.ts"), "utf8").includes("createElement"), false);
});
