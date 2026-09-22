/*
 * Custom template library — client-side persistence.
 *
 * The catalog ships with the static library (PACKS + PAGE_TEMPLATES, both
 * built from code in `lib/editor/templates.ts`). This module adds the missing
 * half: templates an author creates, duplicates or edits in the catalog, kept
 * in `localStorage` as plain JSON.
 *
 * Why localStorage and not the project IndexedDB store: a template is small
 * config (pages of elements), it must be readable synchronously the moment the
 * public catalog renders, and it must survive reloads and other tabs without
 * any server round-trip or rebuild. Writes are quota-aware — a template that
 * embeds large images can exceed the ~5 MB browser budget, which is reported to
 * the caller instead of failing silently.
 *
 * The files written here are pure data: `CustomTemplate` extends the existing
 * document model (`Page` / `CanvasEl`) rather than replacing it, so a template
 * round-trips through the editor and the export pipeline untouched.
 */

import { clone, pageSize, type CanvasEl, type Page } from "@/lib/editor/model";
import type { TemplateCategoryId } from "@/lib/editor/templates";
import { uid } from "@/lib/utils";

/** One versioned slot for the whole library. Bumping `v` retires old shapes. */
export const CUSTOM_TEMPLATES_KEY = "nasaq.templates.custom.v1";
/** The single in-progress «تعديل القالب» draft (see `TemplateDraft`). */
export const TEMPLATE_DRAFT_KEY = "nasaq.templates.draft.v1";

/** Catalog filter axis — a view taxonomy, never written onto the model. */
export type CatalogPillId =
  | "all"
  | "annual"
  | "letters"
  | "certificates"
  | "infographic"
  | "custom";

export interface CustomTemplate {
  id: string;
  title: string;
  desc: string;
  /** Always one of the model's own categories, so filters keep working. */
  category: TemplateCategoryId;
  /** Extra catalog pills the author picked; `custom` is always implied. */
  pills: CatalogPillId[];
  tags: string[];
  /** Page geometry of the first page, cached for the card (mm). */
  size: { w: number; h: number };
  pages: Page[];
  createdAt: number;
  updatedAt: number;
  /** Entry this one was duplicated/derived from, for provenance. */
  derivedFrom?: string;
}

/**
 * A template being edited in the editor.
 *
 * «تعديل القالب» builds a real project (a working copy) and remembers the link
 * here; the catalog can then write the edited pages back over the template —
 * which is how an edit made in the editor reaches the public catalog.
 */
export interface TemplateDraft {
  /** Catalog entry id (`pack:…` / `page:…` / `custom:…`). */
  entryId: string;
  title: string;
  /** Project id in the project library that holds the working copy. */
  projectId: string;
  /** `custom` updates that template; `copy` saves a brand-new one. */
  kind: "custom" | "copy";
  startedAt: number;
}

export interface CustomTemplateInput {
  id?: string;
  title: string;
  desc?: string;
  category?: TemplateCategoryId;
  pills?: CatalogPillId[];
  tags?: string[];
  pages: Page[];
  derivedFrom?: string;
}

/** Thrown when the browser refuses the write because the quota is full. */
export class TemplateStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateStorageError";
  }
}

const MAX_TITLE = 80;
const MAX_DESC = 240;
const MAX_TAG = 24;
const MAX_TAGS = 8;
const MAX_ITEMS = 60;

/* ── small helpers ───────────────────────────────────────────────────────── */

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    /* hardened/blocked storage — the catalog still renders, read-only */
    return null;
  }
}

function readJson<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    /* corrupt slot: treated as "no saved templates" rather than a crash */
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) {
    throw new TemplateStorageError(
      "التخزين المحلي غير متاح في هذا المتصفح — تعذّر حفظ القالب.",
    );
  }
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    throw new TemplateStorageError(
      "المساحة المحلية ممتلئة — احذف قالبًا مخصصًا أو قالبًا يحتوي صورًا كبيرة ثم أعد المحاولة.",
    );
  }
}

/** Fresh ids for a page tree, so using a template never shares element ids. */
export function freshPages(pages: Page[]): Page[] {
  return clone(pages ?? []).map((page) => ({
    ...page,
    id: uid("page"),
    elements: (page.elements ?? []).map(freshElement),
  }));
}

function freshElement(el: CanvasEl): CanvasEl {
  const copy: CanvasEl = { ...el, id: uid("el") };
  if (el.children?.length) copy.children = el.children.map(freshElement);
  return copy;
}

/* ── validation (localStorage is user-writable, so nothing is trusted) ──── */

function asString(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeTemplate(raw: unknown): CustomTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<CustomTemplate>;
  const pages = Array.isArray(item.pages)
    ? item.pages.filter(
        (page): page is Page =>
          Boolean(page) && typeof page === "object" && Array.isArray(page.elements),
      )
    : [];
  if (!item.id || !pages.length) return null;
  const size = pageSize(pages[0]);
  const tags = Array.isArray(item.tags)
    ? item.tags.map((t) => asString(t, MAX_TAG)).filter(Boolean).slice(0, MAX_TAGS)
    : [];
  const pills = Array.isArray(item.pills)
    ? (item.pills.filter((p): p is CatalogPillId =>
        ["annual", "letters", "certificates", "infographic", "custom"].includes(String(p)),
      ) as CatalogPillId[])
    : [];
  const now = Date.now();
  return {
    id: asString(item.id, 64),
    title: asString(item.title, MAX_TITLE) || "قالب بلا اسم",
    desc: asString(item.desc, MAX_DESC),
    category: (item.category || "editorial") as TemplateCategoryId,
    pills,
    tags,
    size: { w: size.w, h: size.h },
    pages,
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || Number(item.createdAt) || now,
    derivedFrom: item.derivedFrom ? asString(item.derivedFrom, 64) : undefined,
  };
}

/* ── the store ───────────────────────────────────────────────────────────── */

let cache: CustomTemplate[] | null = null;
/** `undefined` = not read yet, `null` = read and empty. */
let draftCache: TemplateDraft | null | undefined;
const listeners = new Set<() => void>();
let crossTabBound = false;

function parseLibrary(): CustomTemplate[] {
  const env = readJson<{ v?: number; items?: unknown[] }>(CUSTOM_TEMPLATES_KEY);
  const items = Array.isArray(env?.items) ? env.items : [];
  return items
    .map(normalizeTemplate)
    .filter((t): t is CustomTemplate => t !== null)
    .slice(0, MAX_ITEMS)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Stable snapshot for `useSyncExternalStore` — re-parsed only when it changes. */
export function customTemplatesSnapshot(): CustomTemplate[] {
  if (cache === null) cache = parseLibrary();
  return cache;
}

function invalidate(): void {
  cache = null;
  draftCache = undefined;
  for (const listener of listeners) listener();
}

/**
 * Subscribe to library changes.
 *
 * Local writes notify immediately; the `storage` event covers a second tab (a
 * live session), so an edit published in one window shows up in the other
 * without a reload.
 */
export function subscribeCustomTemplates(listener: () => void): () => void {
  listeners.add(listener);
  if (!crossTabBound && typeof window !== "undefined") {
    crossTabBound = true;
    window.addEventListener("storage", (event) => {
      if (event.key === CUSTOM_TEMPLATES_KEY || event.key === TEMPLATE_DRAFT_KEY) {
        invalidate();
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function persist(items: CustomTemplate[]): void {
  writeJson(CUSTOM_TEMPLATES_KEY, { v: 1, items });
  invalidate();
}

/** All saved templates, newest edit first. */
export function loadCustomTemplates(): CustomTemplate[] {
  return customTemplatesSnapshot();
}

export function customTemplateById(id: string): CustomTemplate | undefined {
  return customTemplatesSnapshot().find((t) => t.id === id);
}

/** Create or update (by `id`) a template. Returns the stored record. */
export function saveCustomTemplate(input: CustomTemplateInput): CustomTemplate {
  if (!input.pages?.length) {
    throw new TemplateStorageError("لا يمكن حفظ قالب بلا صفحات.");
  }
  const items = [...customTemplatesSnapshot()];
  const existingIndex = input.id ? items.findIndex((t) => t.id === input.id) : -1;
  const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
  const size = pageSize(input.pages[0]);
  const record: CustomTemplate = {
    id: existing?.id || uid("tpl"),
    title: asString(input.title, MAX_TITLE) || existing?.title || "قالب جديد",
    desc: asString(input.desc ?? existing?.desc ?? "", MAX_DESC),
    category: (input.category || existing?.category || "editorial") as TemplateCategoryId,
    pills: (input.pills ?? existing?.pills ?? []).filter((p) => p !== "all" && p !== "custom"),
    tags: (input.tags ?? existing?.tags ?? [])
      .map((t) => asString(t, MAX_TAG))
      .filter(Boolean)
      .slice(0, MAX_TAGS),
    size: { w: size.w, h: size.h },
    pages: input.pages,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    derivedFrom: input.derivedFrom ?? existing?.derivedFrom,
  };
  if (existingIndex >= 0) items[existingIndex] = record;
  else items.unshift(record);
  if (items.length > MAX_ITEMS) {
    throw new TemplateStorageError(
      `وصلت إلى الحد الأقصى (${MAX_ITEMS}) من القوالب المخصصة — احذف بعضها أولًا.`,
    );
  }
  persist(items);
  return record;
}

export function deleteCustomTemplate(id: string): boolean {
  const items = customTemplatesSnapshot();
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return false;
  persist(next);
  return true;
}

/** Copy a template under a new id and name — the «تكرار» action. */
export function duplicateCustomTemplate(id: string): CustomTemplate | null {
  const source = customTemplateById(id);
  if (!source) return null;
  return saveCustomTemplate({
    title: `${source.title} — نسخة`,
    desc: source.desc,
    category: source.category,
    pills: source.pills,
    tags: source.tags,
    derivedFrom: source.derivedFrom || source.id,
    pages: freshPages(source.pages),
  });
}

/** Rough size of the library in bytes — surfaced when a write threatens quota. */
export function customTemplatesBytes(): number {
  const store = storage();
  if (!store) return 0;
  try {
    return (store.getItem(CUSTOM_TEMPLATES_KEY) || "").length;
  } catch {
    return 0;
  }
}

/* ── the in-progress edit draft ──────────────────────────────────────────── */

function parseDraft(): TemplateDraft | null {
  const raw = readJson<Partial<TemplateDraft>>(TEMPLATE_DRAFT_KEY);
  if (!raw?.entryId || !raw?.projectId) return null;
  return {
    entryId: asString(raw.entryId, 96),
    title: asString(raw.title, MAX_TITLE) || "قالب",
    projectId: asString(raw.projectId, 64),
    kind: raw.kind === "custom" ? "custom" : "copy",
    startedAt: Number(raw.startedAt) || Date.now(),
  };
}

/** Stable snapshot of the in-progress edit draft (see `useSyncExternalStore`). */
export function draftSnapshot(): TemplateDraft | null {
  if (draftCache === undefined) draftCache = parseDraft();
  return draftCache;
}

export function loadDraft(): TemplateDraft | null {
  return draftSnapshot();
}

export function saveDraft(draft: TemplateDraft): void {
  writeJson(TEMPLATE_DRAFT_KEY, draft);
  invalidate();
}

export function clearDraft(): void {
  const store = storage();
  try {
    store?.removeItem(TEMPLATE_DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
  invalidate();
}
