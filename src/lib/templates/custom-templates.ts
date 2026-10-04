/*
 * Owner-scoped personal reusable templates.
 *
 * The built-in catalog stays static (PACKS + PAGE_TEMPLATES); templates an
 * author creates, duplicates or edits live in the editor's existing IndexedDB
 * database and its owner-scoped storage layer. The API is asynchronous because
 * the catalog contains full editable page trees, including embedded images.
 *
 * The old unscoped localStorage slots are read only by the one-time migration
 * below. A signed-out visitor cannot read or claim those rows. The first
 * authenticated owner migrates them atomically, and the legacy keys are
 * removed only after IndexedDB confirms the import.
 */

import { clone, pageSize, type CanvasEl, type PackId, type Page } from "@/lib/editor/model";
import {
  CustomTemplateRowLimitError,
  deleteCustomTemplateDraft as deleteStoredDraft,
  deleteCustomTemplateRow,
  getCustomTemplateDraft as getStoredDraft,
  listCustomTemplateRows,
  migrateLegacyCustomTemplateData,
  saveCustomTemplateRow,
  setCustomTemplateDraft as setStoredDraft,
} from "@/lib/editor/storage";
import {
  getStorageOwner,
  hasSignedInOwner,
  subscribeStorageOwner,
} from "@/lib/editor/storage-owner";
import { projectAccessBlock, type EditorAccessEntitlements } from "@/lib/editor/access-limits";
import type { TemplateCategoryId } from "@/lib/editor/templates";
import { uid } from "@/lib/utils";

/** Legacy localStorage keys; new template and draft data never writes here. */
export const LEGACY_CUSTOM_TEMPLATES_KEY = "nasaq.templates.custom.v1";
export const LEGACY_TEMPLATE_DRAFT_KEY = "nasaq.templates.draft.v1";

/** Catalog filter axis — a view taxonomy, never written onto the model. */
export type CatalogPillId =
  | "all"
  | "annual"
  | "letters"
  | "minutes"
  | "presentations"
  | "plans"
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
  /** Premium Admin template lineage; kept gated in the derived local copy. */
  licensedTemplateId?: string;
  /** Starter-pack lineage; preserves pack entitlements in every derived copy. */
  pack?: PackId;
}

/**
 * A template being edited in the editor.
 *
 * «تعديل القالب» builds a real project (a working copy) and remembers the link
 * here; the catalog can then write the edited pages back over the template.
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
  /** Internal boundary used to reject a draft held across an account switch. */
  ownerId?: string;
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
  licensedTemplateId?: string;
  pack?: PackId;
}

/** Thrown when IndexedDB is unavailable or a durable write cannot complete. */
export class TemplateStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateStorageError";
  }
}

/** A personal template action was refused by the same gates as project files. */
export class TemplateAccessError extends Error {
  constructor(block: "premium-template" | "page-limit") {
    super(
      block === "premium-template"
        ? "يتطلب هذا القالب ترخيصًا مناسبًا لمتابعة تعديله أو حفظه."
        : "يتجاوز هذا القالب حد الصفحات في خطتك الحالية.",
    );
    this.name = "TemplateAccessError";
  }
}

const PACK_IDS = new Set<PackId>([
  "official",
  "eid",
  "briefing",
  "blank",
  "slides",
]);

function validPack(value: unknown): PackId | undefined {
  return typeof value === "string" && PACK_IDS.has(value as PackId)
    ? (value as PackId)
    : undefined;
}

function packFromEntryId(value: unknown): PackId | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^pack:(official|eid|briefing|blank|slides)$/.exec(value);
  return match?.[1] as PackId | undefined;
}

const MAX_TITLE = 80;
const MAX_DESC = 240;
const MAX_TAG = 24;
const MAX_TAGS = 8;
const MAX_ITEMS = 60;
const CHANNEL_NAME = "nasaq-custom-templates-v1";

type TemplateEnvelope = { v?: number; items?: unknown[] };

/* ── small helpers ───────────────────────────────────────────────────────── */

function asString(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
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

/* ── validation (browser storage is user-writable, so nothing is trusted) ─── */

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
  const safePages = clone(pages);
  const size = pageSize(safePages[0]);
  const tags = Array.isArray(item.tags)
    ? item.tags.map((tag) => asString(tag, MAX_TAG)).filter(Boolean).slice(0, MAX_TAGS)
    : [];
  const pills = Array.isArray(item.pills)
    ? (item.pills.filter((pill): pill is CatalogPillId =>
        ["annual", "letters", "certificates", "infographic", "custom"].includes(String(pill)),
      ) as CatalogPillId[])
    : [];
  const now = Date.now();
  const derivedFrom = item.derivedFrom
    ? asString(item.derivedFrom, 64)
    : undefined;
  return {
    id: asString(item.id, 64),
    title: asString(item.title, MAX_TITLE) || "قالب بلا اسم",
    desc: asString(item.desc, MAX_DESC),
    category: (item.category || "editorial") as TemplateCategoryId,
    pills,
    tags,
    size: { w: size.w, h: size.h },
    pages: safePages,
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || Number(item.createdAt) || now,
    derivedFrom,
    licensedTemplateId: item.licensedTemplateId
      ? asString(item.licensedTemplateId, 120)
      : undefined,
    pack: validPack(item.pack) ?? packFromEntryId(derivedFrom),
  };
}

function normalizeDraft(raw: unknown, ownerId = getStorageOwner()): TemplateDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const draft = raw as Partial<TemplateDraft>;
  if (!draft.entryId || !draft.projectId) return null;
  return {
    entryId: asString(draft.entryId, 96),
    title: asString(draft.title, MAX_TITLE) || "قالب",
    projectId: asString(draft.projectId, 64),
    kind: draft.kind === "custom" ? "custom" : "copy",
    startedAt: Number(draft.startedAt) || Date.now(),
    ownerId,
  };
}

function templateStorageError(error: unknown): TemplateStorageError {
  if (error instanceof TemplateStorageError) return error;
  if (error instanceof Error && error.message.includes("Legacy template data changed")) {
    return new TemplateStorageError(
      "تغيّرت بيانات القالب القديمة بعد ترحيل سابق؛ بقيت النسخة الجديدة محفوظة كما هي ولم تُحذف.",
    );
  }
  if (error instanceof Error && error.message.includes("Legacy template id conflicts")) {
    return new TemplateStorageError(
      "تعذّر ترحيل قالب قديم لأن المعرّف مستخدم لقالب آخر؛ بقيت البيانات القديمة محفوظة كما هي.",
    );
  }
  if (error instanceof CustomTemplateRowLimitError) {
    return new TemplateStorageError(
      `وصلت إلى الحد الأقصى (${MAX_ITEMS}) من القوالب المخصصة — احذف بعضها أولًا.`,
    );
  }
  if (error instanceof Error && error.message.includes("another owner's")) {
    return new TemplateStorageError("لا يمكن تعديل قالب تابع لحساب آخر.");
  }
  if (error instanceof Error && error.message.includes("IndexedDB is required")) {
    return new TemplateStorageError(
      "يتطلب حفظ القوالب تفعيل تخزين IndexedDB في المتصفح؛ لم يُستخدم التخزين المحلي لضمان خصوصية القوالب.",
    );
  }
  return new TemplateStorageError(
    "تعذّر الوصول إلى مكتبة القوالب المحفوظة في هذا المتصفح. أعد المحاولة؛ لم يُحذف المحتوى القديم.",
  );
}

function browserStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function parseLegacyEnvelope(raw: string): CustomTemplate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TemplateStorageError(
      "تعذّرت قراءة مكتبة القوالب القديمة؛ بقيت محفوظة كما هي ولم تُحذف.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TemplateStorageError(
      "بنية مكتبة القوالب القديمة غير صالحة؛ بقيت محفوظة كما هي ولم تُحذف.",
    );
  }
  const envelope = parsed as TemplateEnvelope;
  if (!Array.isArray(envelope.items) || envelope.items.length > MAX_ITEMS) {
    throw new TemplateStorageError(
      "تعذّر ترحيل كل القوالب القديمة؛ بقيت محفوظة كما هي ولم تُحذف.",
    );
  }
  const items = envelope.items.map(normalizeTemplate);
  if (items.some((item) => item === null)) {
    throw new TemplateStorageError(
      "يوجد قالب قديم تالف؛ بقيت المكتبة كاملة محفوظة ولم يُحذف أي محتوى.",
    );
  }
  return items as CustomTemplate[];
}

async function legacySourceFingerprints(
  templateRaw: string | null,
  draftRaw: string | null,
): Promise<{ templates: string | null; draft: string | null }> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new TemplateStorageError(
      "تعذّر التحقق من نسخة البيانات القديمة في هذا المتصفح؛ بقيت محفوظة كما هي ولم تُحذف.",
    );
  }
  const fingerprint = async (raw: string | null): Promise<string | null> => {
    if (raw === null) return null;
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  const [templates, draft] = await Promise.all([fingerprint(templateRaw), fingerprint(draftRaw)]);
  return { templates, draft };
}

/** Import the pre-owner-scoping localStorage keys once; never read them for guests. */
async function migrateLegacyLocalData(ownerId: string): Promise<void> {
  if (!hasSignedInOwner() || ownerId !== getStorageOwner()) return;
  const storage = browserStorage();
  if (!storage) return;
  let templateRaw: string | null;
  let draftRaw: string | null;
  try {
    templateRaw = storage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY);
    draftRaw = storage.getItem(LEGACY_TEMPLATE_DRAFT_KEY);
  } catch {
    throw new TemplateStorageError(
      "تعذّر الوصول إلى البيانات القديمة في هذا المتصفح؛ لم يُحذف أي محتوى.",
    );
  }
  const sourcePresent = templateRaw !== null || draftRaw !== null;
  if (!sourcePresent) return;
  const sourceFingerprints = await legacySourceFingerprints(templateRaw, draftRaw);

  const templates = templateRaw === null ? [] : parseLegacyEnvelope(templateRaw);
  let draft: TemplateDraft | null = null;
  if (draftRaw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftRaw);
    } catch {
      throw new TemplateStorageError(
        "تعذّرت قراءة مسودة القالب القديمة؛ بقيت محفوظة كما هي ولم تُحذف.",
      );
    }
    draft = normalizeDraft(parsed, ownerId);
    if (parsed !== null && !draft) {
      throw new TemplateStorageError(
        "بنية مسودة القالب القديمة غير صالحة؛ بقيت محفوظة كما هي ولم تُحذف.",
      );
    }
  }

  if (!hasSignedInOwner() || ownerId !== getStorageOwner()) return;

  let result: { complete: boolean; alreadyMigrated: boolean; imported: number };
  try {
    result = await migrateLegacyCustomTemplateData(templates, draft, sourceFingerprints);
  } catch (error) {
    throw templateStorageError(error);
  }
  if (!result.complete) return;

  // Recheck before cleanup: an old tab may have written again while this
  // migration was waiting on IndexedDB. Leave any changed payload recoverable.
  let latestFingerprints: { templates: string | null; draft: string | null };
  try {
    latestFingerprints = await legacySourceFingerprints(
      storage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY),
      storage.getItem(LEGACY_TEMPLATE_DRAFT_KEY),
    );
  } catch {
    throw new TemplateStorageError(
      "تعذّر التحقق من البيانات القديمة قبل التنظيف؛ بقيت محفوظة كما هي ولم تُحذف.",
    );
  }
  const changedSinceRead =
    (latestFingerprints.templates !== null && latestFingerprints.templates !== sourceFingerprints.templates) ||
    (latestFingerprints.draft !== null && latestFingerprints.draft !== sourceFingerprints.draft);
  if (changedSinceRead) {
    throw new TemplateStorageError(
      "تغيّرت بيانات القالب القديمة أثناء الترحيل؛ بقيت النسخة الجديدة محفوظة كما هي ولم تُحذف.",
    );
  }

  // The migration marker and imported rows committed together; removing the
  // unchanged unscoped copies is now safe. Partial cleanup is retried later.
  try {
    storage.removeItem(LEGACY_CUSTOM_TEMPLATES_KEY);
    storage.removeItem(LEGACY_TEMPLATE_DRAFT_KEY);
  } catch {
    console.warn("[templates] legacy localStorage cleanup deferred after durable IndexedDB migration");
  }
}

/* ── asynchronous IndexedDB-backed store ─────────────────────────────────── */

let cacheOwner = getStorageOwner();
let cache: CustomTemplate[] = [];
let draftCache: TemplateDraft | null = null;
let cacheLoaded = false;
const listeners = new Set<() => void>();
let inFlight: { ownerId: string; promise: Promise<void> } | null = null;
let channel: BroadcastChannel | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function resetCache(ownerId: string, shouldNotify = true): void {
  cacheOwner = ownerId;
  cache = [];
  draftCache = null;
  cacheLoaded = false;
  if (shouldNotify) notify();
}

function ensureOwnerCache(): string {
  const ownerId = getStorageOwner();
  if (ownerId !== cacheOwner) resetCache(ownerId, false);
  return ownerId;
}

function currentTemplateSnapshot(): CustomTemplate[] {
  ensureOwnerCache();
  return cache;
}

function currentDraftSnapshot(): TemplateDraft | null {
  ensureOwnerCache();
  return draftCache;
}

function setCache(ownerId: string, templates: CustomTemplate[], draft: TemplateDraft | null): void {
  if (getStorageOwner() !== ownerId) return;
  cacheOwner = ownerId;
  cache = templates;
  draftCache = draft;
  cacheLoaded = true;
  notify();
}

/** Load templates and their edit draft into the current owner's UI snapshot. */
export async function hydrateCustomTemplateStore(options: { force?: boolean } = {}): Promise<void> {
  const ownerId = ensureOwnerCache();
  if (!options.force && cacheLoaded) return;
  if (inFlight?.ownerId === ownerId && !options.force) return inFlight.promise;

  const promise = (async () => {
    try {
      await migrateLegacyLocalData(ownerId);
      if (getStorageOwner() !== ownerId) return;
      const [rows, storedDraft] = await Promise.all([
        listCustomTemplateRows<CustomTemplate>(),
        getStoredDraft<unknown>(),
      ]);
      if (getStorageOwner() !== ownerId) return;
      const templates = rows
        .map(normalizeTemplate)
        .filter((template): template is CustomTemplate => template !== null)
        .slice(0, MAX_ITEMS)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      const draft = normalizeDraft(storedDraft, ownerId);
      setCache(ownerId, templates, draft);
    } catch (error) {
      throw templateStorageError(error);
    }
  })();
  inFlight = { ownerId, promise };
  try {
    await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

/** Stable snapshot for `useSyncExternalStore`; the data itself loads asynchronously. */
export function customTemplatesSnapshot(): CustomTemplate[] {
  return currentTemplateSnapshot();
}

/** Stable snapshot of the current owner's in-progress template edit. */
export function draftSnapshot(): TemplateDraft | null {
  return currentDraftSnapshot();
}

let channelBound = false;
function bindCrossTabChanges(): void {
  if (channelBound || typeof window === "undefined" || !window.document) return;
  channelBound = true;
  if (typeof window.BroadcastChannel === "undefined") return;
  try {
    channel = new window.BroadcastChannel(CHANNEL_NAME);
  } catch {
    // Cross-tab notification is an optimization; durable IndexedDB writes stay valid.
    channel = null;
    return;
  }
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!event.data || typeof event.data !== "object" || (event.data as { type?: unknown }).type !== "changed") return;
    cacheLoaded = false;
    void hydrateCustomTemplateStore({ force: true }).catch((error) => {
      console.error("[templates] cross-tab refresh failed", error);
    });
  });
}

function announceCrossTabChange(): void {
  bindCrossTabChanges();
  channel?.postMessage({ type: "changed" });
}

/** Subscribe to local writes, owner changes and other-tab IndexedDB writes. */
export function subscribeCustomTemplates(listener: () => void): () => void {
  listeners.add(listener);
  bindCrossTabChanges();
  return () => listeners.delete(listener);
}

subscribeStorageOwner((ownerId) => {
  resetCache(ownerId);
});

/** Force a fresh IndexedDB read, useful after returning to a catalog or reload. */
export async function refreshCustomTemplateStore(): Promise<void> {
  await hydrateCustomTemplateStore({ force: true });
}

/** All saved templates, newest edit first. */
export async function loadCustomTemplates(): Promise<CustomTemplate[]> {
  await hydrateCustomTemplateStore();
  return [...currentTemplateSnapshot()];
}

export async function customTemplateById(id: string): Promise<CustomTemplate | undefined> {
  const items = await loadCustomTemplates();
  return items.find((template) => template.id === id);
}

/** Create or update (by `id`) a template. Returns the stored record. */
export async function saveCustomTemplate(
  input: CustomTemplateInput,
  entitlements: EditorAccessEntitlements,
): Promise<CustomTemplate> {
  if (!input.pages?.length) {
    throw new TemplateStorageError("لا يمكن حفظ قالب بلا صفحات.");
  }
  const ownerId = getStorageOwner();
  const items = await loadCustomTemplates();
  if (ownerId !== getStorageOwner()) throw new TemplateStorageError("تغيّر الحساب أثناء حفظ القالب؛ أعد المحاولة.");
  const existingIndex = input.id ? items.findIndex((template) => template.id === input.id) : -1;
  const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
  const pack = validPack(input.pack) ?? existing?.pack ?? packFromEntryId(input.derivedFrom);
  const licensedTemplateId = input.licensedTemplateId ?? existing?.licensedTemplateId;
  const block = projectAccessBlock(
    { pack, licensedTemplateId, pages: input.pages },
    entitlements,
  );
  if (block) throw new TemplateAccessError(block);

  const size = pageSize(input.pages[0]);
  const record: CustomTemplate = {
    id: existing?.id || uid("tpl"),
    title: asString(input.title, MAX_TITLE) || existing?.title || "قالب جديد",
    desc: asString(input.desc ?? existing?.desc ?? "", MAX_DESC),
    category: (input.category || existing?.category || "editorial") as TemplateCategoryId,
    pills: (input.pills ?? existing?.pills ?? []).filter((pill) => pill !== "all" && pill !== "custom"),
    tags: (input.tags ?? existing?.tags ?? [])
      .map((tag) => asString(tag, MAX_TAG))
      .filter(Boolean)
      .slice(0, MAX_TAGS),
    size: { w: size.w, h: size.h },
    pages: clone(input.pages),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    derivedFrom: input.derivedFrom ?? existing?.derivedFrom,
    licensedTemplateId,
    pack,
  };
  try {
    await saveCustomTemplateRow(record, MAX_ITEMS);
    if (getStorageOwner() !== ownerId) throw new TemplateStorageError("تغيّر الحساب أثناء حفظ القالب؛ أعد المحاولة.");
    const rows = await listCustomTemplateRows<CustomTemplate>();
    if (getStorageOwner() !== ownerId) throw new TemplateStorageError("تغيّر الحساب أثناء حفظ القالب؛ أعد المحاولة.");
    const templates = rows
      .map(normalizeTemplate)
      .filter((template): template is CustomTemplate => template !== null)
      .slice(0, MAX_ITEMS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setCache(ownerId, templates, draftCache);
    announceCrossTabChange();
    return clone(record);
  } catch (error) {
    throw templateStorageError(error);
  }
}

export async function deleteCustomTemplate(id: string): Promise<boolean> {
  const ownerId = getStorageOwner();
  await loadCustomTemplates();
  if (ownerId !== getStorageOwner()) throw new TemplateStorageError("تغيّر الحساب أثناء حذف القالب؛ أعد المحاولة.");
  try {
    const deleted = await deleteCustomTemplateRow(id);
    if (!deleted) return false;
    const rows = await listCustomTemplateRows<CustomTemplate>();
    if (getStorageOwner() !== ownerId) throw new TemplateStorageError("تغيّر الحساب أثناء حذف القالب؛ أعد المحاولة.");
    const templates = rows
      .map(normalizeTemplate)
      .filter((template): template is CustomTemplate => template !== null)
      .slice(0, MAX_ITEMS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    setCache(ownerId, templates, draftCache);
    announceCrossTabChange();
    return true;
  } catch (error) {
    throw templateStorageError(error);
  }
}

/** Copy a template under a new id and name — the «تكرار» action. */
export async function duplicateCustomTemplate(
  id: string,
  entitlements: EditorAccessEntitlements,
): Promise<CustomTemplate | null> {
  const source = await customTemplateById(id);
  if (!source) return null;
  return saveCustomTemplate(
    {
      title: `${source.title} — نسخة`,
      desc: source.desc,
      category: source.category,
      pills: source.pills,
      tags: source.tags,
      derivedFrom: source.derivedFrom || source.id,
      licensedTemplateId: source.licensedTemplateId,
      pack: source.pack,
      pages: freshPages(source.pages),
    },
    entitlements,
  );
}

/** Encoded size for diagnostics; no localStorage quota is involved. */
export async function customTemplatesBytes(): Promise<number> {
  const items = await loadCustomTemplates();
  return new TextEncoder().encode(JSON.stringify(items)).byteLength;
}

/* ── the in-progress edit draft ──────────────────────────────────────────── */

export async function loadDraft(): Promise<TemplateDraft | null> {
  await hydrateCustomTemplateStore();
  return currentDraftSnapshot();
}

export async function saveDraft(draft: TemplateDraft): Promise<void> {
  const ownerId = getStorageOwner();
  const normalized = normalizeDraft(draft, ownerId);
  if (!normalized) throw new TemplateStorageError("مسودة تعديل القالب غير صالحة.");
  await hydrateCustomTemplateStore();
  if (ownerId !== getStorageOwner()) throw new TemplateStorageError("تغيّر الحساب أثناء حفظ المسودة؛ أعد المحاولة.");
  try {
    await setStoredDraft(normalized);
    if (ownerId !== getStorageOwner()) throw new TemplateStorageError("تغيّر الحساب أثناء حفظ المسودة؛ أعد المحاولة.");
    draftCache = normalized;
    cacheOwner = ownerId;
    notify();
    announceCrossTabChange();
  } catch (error) {
    throw templateStorageError(error);
  }
}

export async function clearDraft(expectedOwnerId?: string): Promise<void> {
  const ownerId = getStorageOwner();
  if (expectedOwnerId !== undefined && ownerId !== expectedOwnerId) {
    throw new TemplateStorageError("تغيّر الحساب قبل تجاهل المسودة؛ لم تُحذف مسودة الحساب الآخر.");
  }
  await hydrateCustomTemplateStore();
  if (ownerId !== getStorageOwner()) throw new TemplateStorageError("تغيّر الحساب أثناء تجاهل المسودة؛ أعد المحاولة.");
  try {
    await deleteStoredDraft();
    if (ownerId !== getStorageOwner()) throw new TemplateStorageError("تغيّر الحساب أثناء تجاهل المسودة؛ أعد المحاولة.");
    draftCache = null;
    notify();
    announceCrossTabChange();
  } catch (error) {
    throw templateStorageError(error);
  }
}
