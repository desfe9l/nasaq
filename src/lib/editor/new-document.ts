/*
 * New-document configuration.
 *
 * The «إنشاء مستند جديد» flow turns a handful of choices — document type, page
 * size, orientation, page count, theme, and a blank or starter-pack start —
 * into a real `Project` built by the editor's own builders (`blankPages`,
 * `createProject`). Nothing here stores anything: the store's
 * `createDocument` persists the result through the one project library.
 *
 * Kept free of React and of the store so the node test runner can exercise it.
 */

import {
  pageSize,
  sizeIdOf,
  type PackId,
  type Project,
  type SizeId,
  type ThemeId,
} from "./model";
import { blankPages, createProject, plainPages } from "./templates";

export type PageSizeId = "a4" | "a3" | "letter" | "legal" | "slide" | "custom";
export type Orientation = "portrait" | "landscape";
export type DocKindId =
  | "report"
  | "letter"
  | "certificate"
  | "presentation"
  | "poster"
  | "sheet";

/** Base page sizes, stored portrait-first (the slide is inherently wide). */
export const PAGE_SIZES: {
  id: PageSizeId;
  name: string;
  desc: string;
  w: number;
  h: number;
}[] = [
  { id: "a4", name: "A4", desc: "210 × 297 مم", w: 210, h: 297 },
  { id: "a3", name: "A3", desc: "297 × 420 مم", w: 297, h: 420 },
  {
    id: "letter",
    name: "Letter",
    desc: "215.9 × 279.4 مم",
    w: 215.9,
    h: 279.4,
  },
  {
    id: "legal",
    name: "Legal",
    desc: "215.9 × 355.6 مم",
    w: 215.9,
    h: 355.6,
  },
  {
    id: "slide",
    name: "عرض 16:9",
    desc: "338.7 × 190.5 مم",
    w: 338.7,
    h: 190.5,
  },
  { id: "custom", name: "مخصص", desc: "بالمليمتر", w: 210, h: 297 },
];

/**
 * What a blank start puts on the sheet.
 *
 * `empty` is a truly blank canvas — no header, no footer, nothing but the
 * page's own background — which is what authors expect from «مستند فارغ».
 * `chrome` keeps the light institutional header/footer the blank pages used
 * to carry, one click away for letters that need it.
 */
export type BlankContent = "empty" | "chrome";

/** Backgrounds offered for a blank sheet; white is the print default. */
export const BLANK_BACKGROUNDS: { id: string; name: string; color: string }[] = [
  { id: "white", name: "أبيض", color: "#ffffff" },
  { id: "ivory", name: "عاجي", color: "#fbf8f1" },
  { id: "mist", name: "رمادي فاتح", color: "#f4f6fa" },
  { id: "custom", name: "لون مخصص", color: "" },
];

/** Document types — each one is just a sensible starting size, orientation and name. */
export const DOC_KINDS: {
  id: DocKindId;
  title: string;
  desc: string;
  size: PageSizeId;
  orientation: Orientation;
  name: string;
}[] = [
  {
    id: "report",
    title: "تقرير رسمي",
    desc: "A4 رأسي",
    size: "a4",
    orientation: "portrait",
    name: "تقرير جديد",
  },
  {
    id: "letter",
    title: "خطاب رسمي",
    desc: "A4 رأسي",
    size: "a4",
    orientation: "portrait",
    name: "خطاب رسمي",
  },
  {
    /*
     * A certificate is A4 PORTRAIT by definition here: awards and appreciation
     * certificates are printed and framed, so the default (and every reset that
     * follows from it) must never hand the author a landscape sheet. Landscape
     * stays one click away through «مقاس الصفحة / الاتجاه».
     */
    id: "certificate",
    title: "شهادة تقدير",
    desc: "A4 رأسي",
    size: "a4",
    orientation: "portrait",
    name: "شهادة تقدير",
  },
  {
    id: "presentation",
    title: "عرض تقديمي",
    desc: "16:9 أفقي",
    size: "slide",
    orientation: "landscape",
    name: "عرض تقديمي",
  },
  {
    id: "sheet",
    title: "جدول عريض",
    desc: "A4 أفقي",
    size: "a4",
    orientation: "landscape",
    name: "جدول بيانات",
  },
  {
    id: "poster",
    title: "ملصق ولوحة",
    desc: "A3 رأسي",
    size: "a3",
    orientation: "portrait",
    name: "لوحة إعلانية",
  },
];

/** Starter packs offered as a template start (the blank pack IS the blank start). */
export const STARTER_PACKS: PackId[] = [
  "official",
  "eid",
  "briefing",
  "slides",
];

export const MAX_NEW_PAGES = 50;
export const MIN_CUSTOM_MM = 50;
export const MAX_CUSTOM_MM = 1200;

export interface NewDocumentConfig {
  start: "blank" | "template";
  /** Starter pack used when `start === "template"`. */
  pack: PackId;
  kind: DocKindId;
  size: PageSizeId;
  orientation: Orientation;
  /** Custom size in mm, portrait-first, used when `size === "custom"`. */
  custom: { w: number; h: number };
  pages: number;
  theme: ThemeId;
  name: string;
  orgName: string;
  /** Blank starts only: a truly empty sheet or the light header/footer chrome. */
  content: BlankContent;
  /** Blank starts only: the sheet's own background paint. */
  bg: string;
}

/** Everything a user can accept as-is: one EMPTY A4 portrait page, white. */
export function defaultNewDocument(
  overrides: Partial<NewDocumentConfig> = {},
): NewDocumentConfig {
  return {
    start: "blank",
    pack: "official",
    kind: "report",
    size: "a4",
    orientation: "portrait",
    custom: { w: 210, h: 297 },
    pages: 1,
    theme: "official",
    name: "",
    orgName: "",
    content: "empty",
    bg: "#ffffff",
    ...overrides,
  };
}

/**
 * Seed «مستند جديد» from the page the author is already looking at.
 *
 * The dialog still has to confirm size, orientation and dimensions before a
 * page exists. What it must not do is throw away a custom sheet and open on
 * an unrelated A4. Preset sheets stay presets; anything else is an explicit
 * custom size carrying the same millimetres.
 */
export function configFromPage(
  page?: { w?: number; h?: number; bg?: string } | null,
): Partial<NewDocumentConfig> {
  const size = pageSize(page);
  const long = Math.max(size.w, size.h);
  const short = Math.min(size.w, size.h);
  const square = Math.abs(size.w - size.h) < 0.5;
  const orientation: Orientation = square
    ? "portrait"
    : size.w > size.h
      ? "landscape"
      : "portrait";
  const hit = PAGE_SIZES.find(
    (entry) =>
      entry.id !== "custom" &&
      Math.abs(Math.max(entry.w, entry.h) - long) < 0.6 &&
      Math.abs(Math.min(entry.w, entry.h) - short) < 0.6,
  );
  const bg =
    typeof page?.bg === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(page.bg)
      ? page.bg
      : undefined;
  return {
    start: "blank",
    size: hit?.id ?? "custom",
    orientation,
    ...(hit ? {} : { custom: { w: short, h: square ? short : long } }),
    ...(bg ? { bg } : {}),
  };
}

/** Normalise a stored/derived background into a usable CSS colour. */
export function blankBackground(color: unknown): string {
  if (typeof color !== "string") return "#ffffff";
  const value = color.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value.toLowerCase();
  return "#ffffff";
}

export function docKind(id: DocKindId) {
  return DOC_KINDS.find((k) => k.id === id) ?? DOC_KINDS[0];
}

/** The default title for a configuration (what an empty name field stands for). */
export function defaultDocumentName(
  config: Pick<NewDocumentConfig, "start" | "pack" | "kind">,
): string {
  if (config.start === "template") return createProject(config.pack).name;
  return docKind(config.kind).name;
}

function clampMm(value: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(
    MAX_CUSTOM_MM,
    Math.max(MIN_CUSTOM_MM, Math.round(n * 10) / 10),
  );
}

/** Final page dimensions in mm for a size + orientation. */
export function pageDimensions(
  size: PageSizeId,
  orientation: Orientation,
  custom: { w: number; h: number } = { w: 210, h: 297 },
): { w: number; h: number } {
  const base = PAGE_SIZES.find((s) => s.id === size) ?? PAGE_SIZES[0];
  const w = size === "custom" ? clampMm(custom.w, 210) : base.w;
  const h = size === "custom" ? clampMm(custom.h, 297) : base.h;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return orientation === "landscape"
    ? { w: long, h: short }
    : { w: short, h: long };
}

export function clampPages(value: number, max = MAX_NEW_PAGES): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(1, max), Math.max(1, n));
}

/**
 * The project a configuration creates.
 *
 * A template start is the exact starter pack the editor's «مشاريع جاهزة»
 * builds (its own page size and page set win — that IS the template's
 * configuration); a blank start is `pages` blank sheets at the chosen size.
 * Element ids are fresh on every call, so no two documents share identity.
 */
export function buildNewDocument(config: NewDocumentConfig): Project {
  const orgName = config.orgName.trim();
  const name = config.name.trim() || defaultDocumentName(config);

  if (config.start === "template") {
    const project = createProject(config.pack, config.theme, orgName);
    return { ...project, name, orgName };
  }

  const size = pageDimensions(config.size, config.orientation, config.custom);
  const sizeId: SizeId = sizeIdOf(size);
  const count = clampPages(config.pages);
  return {
    version: 2,
    name,
    theme: config.theme,
    orgName,
    pack: "blank",
    defaultSize: sizeId,
    pages:
      config.content === "chrome"
        ? blankPages(count, config.theme, orgName, size, name)
        : plainPages(count, size, blankBackground(config.bg)),
  };
}

/** One-line human summary: «A4 رأسي · 3 صفحات». */
export function describeConfig(config: NewDocumentConfig): string {
  if (config.start === "template") {
    const project = createProject(config.pack, config.theme);
    const count = project.pages.length;
    const first = project.pages[0];
    const orient = (first?.w ?? 210) > (first?.h ?? 297) ? "أفقي" : "رأسي";
    return `${sizeLabel(first?.w ?? 210, first?.h ?? 297)} ${orient} · ${pagesText(count)}`;
  }
  const size = pageDimensions(config.size, config.orientation, config.custom);
  const orient = config.orientation === "landscape" ? "أفقي" : "رأسي";
  return `${sizeLabel(size.w, size.h)} ${orient} · ${pagesText(clampPages(config.pages))}`;
}

function sizeLabel(w: number, h: number): string {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const hit = PAGE_SIZES.find(
    (s) =>
      s.id !== "custom" &&
      Math.abs(Math.max(s.w, s.h) - long) < 0.5 &&
      Math.abs(Math.min(s.w, s.h) - short) < 0.5,
  );
  return hit ? hit.name : `${Math.round(w)} × ${Math.round(h)} مم`;
}

export function pagesText(count: number): string {
  if (count === 1) return "صفحة واحدة";
  if (count === 2) return "صفحتان";
  if (count <= 10) return `${count} صفحات`;
  return `${count} صفحة`;
}
