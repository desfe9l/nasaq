/*
 * The identity bridge must be arithmetic, not opinion: the same kit always
 * produces the same palette, text roles clear WCAG AA on the kit's own paper,
 * remapping touches only exact role matches, fonts follow the script, and a
 * DEFAULT kit changes nothing at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { THEMES, type Project } from "./model.ts";
import {
  applyBrandToIntent,
  applyBrandToProject,
  brandFonts,
  brandIsConfigured,
  brandPalette,
  brandTheme,
  mixHex,
} from "./brand-design.ts";
import { contrastRatio } from "../product/contrast.ts";
import { DEFAULT_BRAND_KIT, type BrandKit } from "../product/product.ts";

const KIT: BrandKit = {
  ...DEFAULT_BRAND_KIT,
  organizationName: "شركة نَسَق للتقنية",
  primaryColor: "#103a2b",
  secondaryColor: "#5c6570",
  accentColor: "#c6a05a",
  paperColor: "#fbfaf6",
  textColor: "#1f2937",
  arabicFont: "Tajawal",
  englishFont: "IBM Plex Sans",
};

const SOURCE_PALETTE = {
  field: "#006c35",
  paper: "#ffffff",
  ink: "#172033",
  accent: "#c9a86a",
  muted: "#697184",
  onField: "#ffffff",
};

function projectWith(elements: Project["pages"][number]["elements"], bg = "#ffffff"): Project {
  return {
    version: 2,
    name: "مستند",
    theme: "official",
    orgName: "",
    pages: [{ id: "p1", name: "صفحة 1", w: 210, h: 297, bg, elements }],
  } as Project;
}

test("the palette comes from the kit and clears AA for text roles", () => {
  const palette = brandPalette(KIT);
  assert.equal(palette.field, KIT.primaryColor);
  assert.equal(palette.paper, KIT.paperColor);
  assert.equal(palette.accent, KIT.accentColor);
  assert.ok(contrastRatio(palette.ink, palette.paper) >= 4.5, "ink must clear AA on paper");
  assert.ok(contrastRatio(palette.muted, palette.paper) >= 4.5, "muted must clear AA on paper");
  assert.ok(
    contrastRatio(KIT.primaryColor!, palette.onField) >= 4.5,
    "on-field text must be readable on the identity's field",
  );
});

test("unusable values fall back to the documented default", () => {
  const broken = brandPalette({ ...KIT, primaryColor: "أخضر" });
  assert.equal(broken.field, DEFAULT_BRAND_KIT.primaryColor);
});

test("a default kit is not an identity, so applying it changes nothing", () => {
  assert.equal(brandIsConfigured(DEFAULT_BRAND_KIT), false);
  assert.equal(brandIsConfigured(null), false);
  assert.equal(brandIsConfigured(KIT), true);

  const project = projectWith([
    { id: "a", type: "text", x: 0, y: 0, w: 10, h: 10, z: 1, content: "نص", style: { color: "#172033" } } as never,
  ]);
  assert.equal(applyBrandToProject(project, DEFAULT_BRAND_KIT), project);
});

test("the theme is the base theme with the identity layered on it", () => {
  const theme = brandTheme(KIT);
  assert.equal(theme.id, "official");
  assert.equal(theme.primary, KIT.primaryColor);
  assert.equal(theme.accent, KIT.accentColor);
  assert.equal(theme.paper, KIT.paperColor);
  assert.equal(theme.name, KIT.organizationName);
  // The shared theme table is READ, never written.
  assert.equal(THEMES.official.primary, "#006c35");
  assert.equal(THEMES.official.name, "رسمي نَسَق");
});

test("the intent is rebranded without losing the prompt's own organisation", () => {
  const intent = { palette: SOURCE_PALETTE, org: "", title: "تقرير" };
  const named = applyBrandToIntent(intent, KIT);
  assert.equal(named.org, KIT.organizationName);
  assert.equal(named.palette.field, KIT.primaryColor);
  assert.equal(named.title, "تقرير");
  assert.equal(applyBrandToIntent({ ...intent, org: "جهة أخرى" }, KIT).org, "جهة أخرى");
});

test("a palette-painted document is remapped by exact match only", () => {
  const project = projectWith([
    { id: "a", type: "text", x: 0, y: 0, w: 10, h: 10, z: 1, content: "نص", style: { color: "#172033", fill: "#006c35" } } as never,
    { id: "b", type: "box", x: 0, y: 0, w: 10, h: 10, z: 2, style: { fill: "#123456" } } as never,
    { id: "c", type: "image", x: 0, y: 0, w: 10, h: 10, z: 3, style: { background: "#c9a86a" } } as never,
  ]);
  const next = applyBrandToProject(project, KIT, { from: SOURCE_PALETTE });
  const [a, b, c] = next.pages[0].elements;
  assert.equal(a.style.color, brandPalette(KIT).ink);
  assert.equal(a.style.fill, brandPalette(KIT).field);
  assert.equal(next.pages[0].bg, brandPalette(KIT).paper, "the paper role owns the page background");
  assert.equal(b.style.fill, "#123456", "unknown colours must survive");
  assert.equal(c.style.background, brandPalette(KIT).accent);
  // The source project is untouched.
  assert.equal(project.pages[0].elements[0].style.color, "#172033");
});

test("a theme-painted document (template / import) is remapped by theme roles", () => {
  const official = THEMES.official;
  const project = projectWith([
    { id: "title", type: "text", x: 0, y: 0, w: 10, h: 10, z: 1, content: "عنوان", style: { color: official.primary } } as never,
    { id: "body", type: "text", x: 0, y: 0, w: 10, h: 10, z: 2, content: "متن", style: { color: official.ink } } as never,
    { id: "band", type: "shape", x: 0, y: 0, w: 10, h: 10, z: 3, style: { fill: official.accent, borderColor: official.line } } as never,
  ]);
  const next = applyBrandToProject(project, KIT);
  const palette = brandPalette(KIT);
  assert.equal(next.pages[0].elements[0].style.color, palette.field);
  assert.equal(next.pages[0].elements[1].style.color, palette.ink);
  assert.equal(next.pages[0].elements[2].style.fill, palette.accent);
  assert.equal(next.pages[0].bg, palette.paper);
});

test("white text on a field fill becomes the identity's on-field colour", () => {
  const official = THEMES.official;
  const light: BrandKit = { ...KIT, primaryColor: "#f2e6c9", accentColor: "#8a6a1f" };
  const project = projectWith([
    {
      id: "cover-band",
      type: "box",
      x: 0,
      y: 0,
      w: 100,
      h: 40,
      z: 1,
      style: { fill: official.primary },
      children: [
        { id: "cover-title", type: "text", x: 0, y: 0, w: 90, h: 12, z: 1, content: "عنوان الغلاف", style: { color: "#ffffff" } },
      ],
    } as never,
  ]);
  const next = applyBrandToProject(project, light);
  const band = next.pages[0].elements[0];
  assert.equal(band.style.fill, brandPalette(light).field);
  assert.equal(
    band.children?.[0].style.color,
    brandPalette(light).onField,
    "unreadable white must be corrected to the identity's on-field colour",
  );
  assert.ok(contrastRatio(band.children![0].style.color!, brandPalette(light).field) >= 4.5);
});

test("fonts follow the script and only use fonts the platform ships", () => {
  const project = projectWith([
    { id: "ar", type: "text", x: 0, y: 0, w: 10, h: 10, z: 1, content: "تقرير الأداء", style: { fontFamily: "Amiri" } } as never,
    { id: "en", type: "text", x: 0, y: 0, w: 10, h: 10, z: 2, content: "NASAQ 2026", style: { fontFamily: "Amiri" } } as never,
  ]);
  const next = applyBrandToProject(project, KIT, { fonts: true });
  assert.equal(next.pages[0].elements[0].style.fontFamily, "Tajawal");
  assert.equal(next.pages[0].elements[1].style.fontFamily, "IBM Plex Sans Arabic");
  assert.deepEqual(brandFonts({ ...KIT, arabicFont: "Papyrus", englishFont: "Comic Sans" }), {
    arabic: "Tajawal",
    latin: "Tajawal",
  });

  const kept = applyBrandToProject(project, KIT, { fonts: false });
  assert.equal(kept.pages[0].elements[0].style.fontFamily, "Amiri");
});

test("the organisation is only stamped when the document has none, unless forced", () => {
  const project = { ...projectWith([]), orgName: "جهة أخرى" } as Project;
  assert.equal(applyBrandToProject(project, KIT).orgName, "جهة أخرى");
  assert.equal(applyBrandToProject(project, KIT, { forceOrg: true }).orgName, KIT.organizationName);
  assert.equal(applyBrandToProject({ ...project, orgName: "" } as Project, KIT).orgName, KIT.organizationName);
});

test("mixing stays inside the sRGB box", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0), "#000000");
  assert.equal(mixHex("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mixHex("#ffffff", "#000000", 0.5), "#808080");
});
