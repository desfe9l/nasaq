/*
 * Template catalog view model.
 *
 * One place that turns the *existing* template sources — the starter packs and
 * the page templates from `lib/editor/templates.ts`, plus the author's own
 * saved templates — into the entries the catalog page renders. Nothing here
 * changes a data structure: every entry carries REAL `Page[]` objects built by
 * the same builders the editor uses, so previews, quick view and "use this
 * template" all show the document that will actually be created.
 *
 * The filter pills are a view taxonomy only. The model keeps its own
 * `TemplateCategoryId`; pills are derived (see `pillsFor`) and are never
 * written back onto a template.
 */

import {
  PAGE_TEMPLATES,
  PACKS,
  TEMPLATE_CATEGORIES,
  createProject,
  createTemplatePage,
  packPages,
  type PageTemplateDef,
  type TemplateCategoryId,
} from "@/lib/editor/templates";
import {
  THEMES,
  pageSize,
  sizeIdOf,
  type Page,
  type PackId,
  type SizeId,
  type Theme,
  type ThemeId,
} from "@/lib/editor/model";
import { freshPages, type CatalogPillId, type CustomTemplate } from "./custom-templates";

/**
 * Filter pills, in the order the catalog shows them.
 *
 * The first six are the official document families the product is organised
 * around — annual reports, letters, meeting minutes, closing presentations and
 * operational plans — followed by the two format-oriented pills (certificates,
 * infographics) and the author's own templates.
 */
export const CATALOG_PILLS: { id: CatalogPillId; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "annual", label: "تقارير سنوية" },
  { id: "letters", label: "خطابات رسمية" },
  { id: "minutes", label: "محاضر اجتماعات" },
  { id: "presentations", label: "عروض ختامية" },
  { id: "plans", label: "خطط تشغيلية" },
  { id: "certificates", label: "شهادات" },
  { id: "infographic", label: "إنفوجرافيك" },
  { id: "custom", label: "قوالبي الخاصة" },
];

export type CatalogEntryKind = "pack" | "page" | "custom";

export interface CatalogBadge {
  label: string;
  tone: "official" | "new" | "custom" | "pack";
}

export interface CatalogEntry {
  /** Stable across renders: `pack:<id>` · `page:<id>` · `custom:<id>`. */
  id: string;
  kind: CatalogEntryKind;
  /** Pack id, page-template id, or custom-template id. */
  sourceId: string;
  title: string;
  desc: string;
  category: TemplateCategoryId;
  categoryLabel: string;
  kindLabel: string;
  /** View pills this entry answers to (`all` is implicit). */
  pills: CatalogPillId[];
  tags: string[];
  badges: CatalogBadge[];
  size: { w: number; h: number };
  /** Real pages, built with the requested theme/org. */
  pages: Page[];
  /** Custom templates only — the stored record. */
  custom?: CustomTemplate;
}

/** Categories that belong to each pill. A category may answer to several. */
const PILL_BY_CATEGORY: Record<TemplateCategoryId, CatalogPillId[]> = {
  covers: ["annual", "letters"],
  reports: ["annual", "letters"],
  inner: ["annual"],
  stats: ["annual", "infographic", "presentations"],
  tables: ["infographic", "minutes"],
  kpis: ["infographic", "plans"],
  infographics: ["infographic"],
  slides: ["annual", "presentations"],
  editorial: ["annual"],
  institutional: ["annual", "plans"],
  data: ["annual", "infographic", "plans"],
  executive: ["annual", "minutes", "plans"],
  section: ["annual", "certificates", "presentations"],
  timeline: ["infographic", "plans"],
};

/** Starter packs and the pills they answer to (plus their representative category). */
const PACK_META: Record<PackId, { category: TemplateCategoryId; pills: CatalogPillId[] }> = {
  official: { category: "reports", pills: ["annual", "letters", "plans"] },
  eid: { category: "covers", pills: ["annual", "certificates"] },
  briefing: { category: "executive", pills: ["annual", "minutes", "plans"] },
  slides: { category: "slides", pills: ["annual", "presentations"] },
  blank: { category: "editorial", pills: ["letters", "annual", "plans"] },
};

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  TEMPLATE_CATEGORIES.map((c) => [c.id, c.title]),
);

const KIND_LABEL: Record<CatalogEntryKind, string> = {
  pack: "حزمة جاهزة",
  page: "صفحة قالب",
  custom: "قالب مخصص",
};

/** Words that route a template to a pill regardless of its category. */
const PILL_KEYWORDS: { pill: CatalogPillId; words: string[] }[] = [
  { pill: "certificates", words: ["شهادة", "شهادات", "ختم", "توقيع", "اعتماد", "تكريم"] },
  { pill: "letters", words: ["خطاب", "رسالة", "مذكرة", "تعميم", "ترويسة"] },
  { pill: "minutes", words: ["محضر", "اجتماع", "قرار", "قرارات", "حضور", "توصيات", "جدول أعمال", "مداولات"] },
  { pill: "presentations", words: ["عرض", "تقديم", "شريحة", "شرائح", "ختامي", "ختامية", "منصة"] },
  { pill: "plans", words: ["خطة", "خطط", "تشغيلي", "تشغيلية", "مبادرة", "مبادرات", "مستهدف", "أهداف", "مؤشرات أداء"] },
  { pill: "infographic", words: ["إنفوجرافيك", "انفوجرافيك", "مؤشر", "إحصاء", "احصاء", "جدول", "رسم بياني"] },
  { pill: "annual", words: ["تقرير", "سنوي", "أداء", "انجاز", "إنجاز"] },
];

function pillsFor(
  category: TemplateCategoryId,
  extra: { text?: string; hasStamp?: boolean; hasData?: boolean } = {},
): CatalogPillId[] {
  const pills = new Set<CatalogPillId>(PILL_BY_CATEGORY[category] ?? ["annual"]);
  const haystack = String(extra.text || "");
  for (const { pill, words } of PILL_KEYWORDS) {
    if (words.some((word) => haystack.includes(word))) pills.add(pill);
  }
  // Element evidence beats wording: a stamp IS a certificate surface, a table or
  // progress bar IS an infographic surface.
  if (extra.hasStamp) pills.add("certificates");
  if (extra.hasData) pills.add("infographic");
  return [...pills];
}

function elementEvidence(pages: Page[]) {
  let hasStamp = false;
  let hasData = false;
  for (const page of pages) {
    for (const el of page.elements ?? []) {
      if (el.type === "stamp" || el.type === "qr") hasStamp = true;
      if (el.type === "table" || el.type === "progress" || el.type === "stat") hasData = true;
    }
  }
  return { hasStamp, hasData };
}

function badgesFor(
  kind: CatalogEntryKind,
  updatedAt: number | undefined,
  count: number,
): CatalogBadge[] {
  const badges: CatalogBadge[] = [];
  if (kind === "custom") badges.push({ label: "مخصص", tone: "custom" });
  else badges.push({ label: "رسمي", tone: "official" });
  if (kind === "pack") badges.push({ label: "حزمة", tone: "pack" });
  const fresh = updatedAt ? Date.now() - updatedAt < 7 * 24 * 60 * 60 * 1000 : false;
  if (kind === "custom" && fresh) badges.push({ label: "جديد", tone: "new" });
  if (kind === "pack" || count > 1) badges.push({ label: `${count} صفحات`, tone: "pack" });
  return badges;
}

function pageEntry(def: PageTemplateDef, theme: Theme, org: string): CatalogEntry {
  const pages = [createTemplatePage(def.id, theme, org)];
  const size = pageSize(pages[0]);
  const evidence = elementEvidence(pages);
  const tags = [def.concept, CATEGORY_LABEL[def.category], "قالب"].filter(
    (t): t is string => Boolean(t),
  );
  return {
    id: `page:${def.id}`,
    kind: "page",
    sourceId: def.id,
    title: def.title,
    desc: def.desc,
    category: def.category,
    categoryLabel: CATEGORY_LABEL[def.category] || def.category,
    kindLabel: KIND_LABEL.page,
    pills: pillsFor(def.category, {
      text: `${def.title} ${def.desc} ${def.concept || ""}`,
      ...evidence,
    }),
    tags,
    badges: badgesFor("page", undefined, 1),
    size: { w: size.w, h: size.h },
    pages,
  };
}

function packEntry(pack: (typeof PACKS)[number], theme: Theme, org: string): CatalogEntry {
  const pages = packPages(pack.id, theme, org);
  const meta = PACK_META[pack.id];
  const size = pageSize(pages[0]);
  const evidence = elementEvidence(pages);
  return {
    id: `pack:${pack.id}`,
    kind: "pack",
    sourceId: pack.id,
    title: pack.title,
    desc: pack.desc,
    category: meta.category,
    categoryLabel: CATEGORY_LABEL[meta.category] || meta.category,
    kindLabel: KIND_LABEL.pack,
    pills: [
      ...new Set([
        ...meta.pills,
        ...pillsFor(meta.category, { text: `${pack.title} ${pack.desc}`, ...evidence }),
      ]),
    ],
    tags: [pack.pages, KIND_LABEL.pack],
    badges: badgesFor("pack", undefined, pages.length),
    size: { w: size.w, h: size.h },
    pages,
  };
}

function customEntry(item: CustomTemplate): CatalogEntry {
  const pages = item.pages;
  const size = item.size?.w ? item.size : pageSize(pages[0]);
  const evidence = elementEvidence(pages);
  const inferred = pillsFor(item.category, {
    text: `${item.title} ${item.desc} ${(item.tags ?? []).join(" ")}`,
    ...evidence,
  });
  return {
    id: `custom:${item.id}`,
    kind: "custom",
    sourceId: item.id,
    title: item.title,
    desc: item.desc,
    category: item.category,
    categoryLabel: CATEGORY_LABEL[item.category] || item.category,
    kindLabel: KIND_LABEL.custom,
    pills: [...new Set<CatalogPillId>([...item.pills, ...inferred, "custom"])],
    tags: item.tags ?? [],
    badges: badgesFor("custom", item.updatedAt, pages.length),
    size: { w: size.w, h: size.h },
    pages,
    custom: item,
  };
}

/**
 * Every catalog entry for a theme + organisation.
 *
 * Custom templates come first — the author's own work is the thing they came to
 * manage — then the page templates, then the multi-page starter packs.
 */
export function buildCatalog(options: {
  themeId: ThemeId;
  orgName?: string;
  custom?: CustomTemplate[];
}): CatalogEntry[] {
  const theme = THEMES[options.themeId] ?? THEMES.official;
  const org = options.orgName ?? "";
  const custom = (options.custom ?? []).map(customEntry);
  const pages = PAGE_TEMPLATES.map((def) => pageEntry(def, theme, org));
  const packs = PACKS.map((pack) => packEntry(pack, theme, org));
  return [...custom, ...pages, ...packs];
}

/**
 * Searchable words per pill: its label plus the usage synonyms, both normalised
 * so «إنفوجرافيك»/«انفوجرافيك» and «شهادة»/«شهاده» land on the same entry.
 */
const PILL_HAYSTACK: Map<CatalogPillId, string> = new Map(
  CATALOG_PILLS.map((pill) => [
    pill.id,
    norm(
      [pill.label, ...(PILL_KEYWORDS.find((k) => k.pill === pill.id)?.words ?? [])].join(" "),
    ),
  ]),
);

/**
 * Case/diacritic-tolerant match over title, description, tags, taxonomy AND the
 * usage type — the pill a template answers to («تقرير سنوي», «خطاب رسمي»,
 * «شهادة», «إنفوجرافيك») is searchable text too.
 */
export function matchesQuery(entry: CatalogEntry, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const haystack = norm(
    [
      entry.title,
      entry.desc,
      entry.categoryLabel,
      entry.kindLabel,
      entry.tags.join(" "),
      entry.custom?.desc ?? "",
      `${entry.pages.length}`,
      entry.pills.join(" "),
      entry.pills.map((pill) => PILL_HAYSTACK.get(pill) ?? "").join(" "),
      ...entry.badges.map((b) => b.label),
    ].join(" "),
  );
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Arabic-aware normalisation: strips harakat, unifies alef/ya/ta-marbuta forms. */
function norm(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

export function filterCatalog(
  entries: CatalogEntry[],
  options: { pill?: CatalogPillId; query?: string },
): CatalogEntry[] {
  const pill = options.pill ?? "all";
  const query = options.query ?? "";
  return entries.filter(
    (entry) =>
      (pill === "all" || entry.pills.includes(pill)) && matchesQuery(entry, query),
  );
}

export interface EntryProjectSeed {
  name: string;
  theme: ThemeId;
  orgName: string;
  defaultSize: SizeId;
  pages: Page[];
}

/**
 * The project a catalog entry turns into — for «استخدام القالب» and «تعديل».
 *
 * Static entries are rebuilt from their builders (fresh element ids each call);
 * a custom template is deep-copied with fresh ids too, so two projects created
 * from the same template never share an element identity.
 */
export function entryProjectSeed(
  entry: CatalogEntry,
  options: { themeId: ThemeId; orgName?: string },
): EntryProjectSeed {
  const org = options.orgName ?? "";
  const theme = THEMES[options.themeId] ?? THEMES.official;

  /*
   * A starter pack IS a project: `createProject` is the exact builder the
   * editor's own «مشاريع جاهزة» action calls, so the catalogue and the editor
   * open the same document — same name, same theme, same page set.
   */
  if (entry.kind === "pack") {
    const project = createProject(entry.sourceId as PackId, options.themeId, org);
    return {
      name: project.name,
      theme: project.theme,
      orgName: org,
      defaultSize: project.defaultSize || sizeIdOf(pageSize(project.pages[0])),
      pages: project.pages,
    };
  }

  const pages =
    entry.kind === "custom"
      ? freshPages(entry.pages)
      : [createTemplatePage(entry.sourceId, theme, org)];
  return {
    name: entry.title,
    theme: options.themeId,
    orgName: org,
    defaultSize: sizeIdOf(pageSize(pages[0])),
    pages,
  };
}

/** Pages for a NEW custom template derived from an entry (duplicate/customize). */
export function entryTemplatePages(
  entry: CatalogEntry,
  options: { themeId: ThemeId; orgName?: string },
): Page[] {
  return entryProjectSeed(entry, options).pages;
}

/** Human label for a page count. */
export function pagesLabel(count: number): string {
  if (count === 1) return "صفحة واحدة";
  if (count === 2) return "صفحتان";
  return `${count} صفحات`;
}
