import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { setStorageOwner } from "@/lib/editor/storage-owner";
import type { Page } from "@/lib/editor/model";
import {
  customTemplateById,
  customTemplatesSnapshot,
  clearDraft,
  deleteCustomTemplate,
  duplicateCustomTemplate,
  hydrateCustomTemplateStore,
  LEGACY_CUSTOM_TEMPLATES_KEY,
  LEGACY_TEMPLATE_DRAFT_KEY,
  loadCustomTemplates,
  loadDraft,
  refreshCustomTemplateStore,
  saveCustomTemplate,
  saveDraft,
  TemplateAccessError,
  TemplateStorageError,
} from "./custom-templates.ts";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

const legacyStorage = new MemoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: legacyStorage },
});

const FREE = {
  premium_templates: false,
  unlimited_projects: false,
  unlimited_pages: false,
};
const LICENSED = {
  premium_templates: true,
  unlimited_projects: true,
  unlimited_pages: true,
};

const imageData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n6sAAAAASUVORK5CYII=";

const page = (id = "page-1", withImage = false): Page => ({
  id,
  name: "صفحة اختبار",
  w: 210,
  h: 297,
  elements: withImage
    ? [{
        id: "embedded-image",
        type: "image",
        name: "صورة مضمنة",
        x: 12,
        y: 18,
        w: 40,
        h: 30,
        rotation: 0,
        opacity: 1,
        z: 1,
        src: imageData,
        style: {},
      }]
    : [],
});

const LEGACY_OWNER = "template-legacy-migration-owner";
const legacyTemplateRaw = JSON.stringify({
  v: 1,
  items: [{
    id: "legacy-template-preserved",
    title: "قالب قديم",
    desc: "يُرحَّل دون حذف الصور",
    category: "reports",
    pills: [],
    tags: [],
    pages: [page("legacy-page", true)],
    createdAt: 10,
    updatedAt: 20,
  }],
});
const legacyDraftRaw = JSON.stringify({
  entryId: "custom:legacy-template-preserved",
  title: "قالب قديم",
  projectId: "legacy-working-copy",
  kind: "custom",
  startedAt: 30,
});

let ownerSequence = 0;
beforeEach(async () => {
  legacyStorage.clear();
  setStorageOwner(null);
  setStorageOwner(`custom-template-test-${++ownerSequence}`);
  await hydrateCustomTemplateStore({ force: true });
});

test("owner A creates a reusable template; reload preserves editable pages and embedded images", async () => {
  const ownerA = "template-owner-a-create";
  setStorageOwner(ownerA);
  await hydrateCustomTemplateStore({ force: true });

  const created = await saveCustomTemplate(
    { title: "قالب أ", pages: [page("page-a", true)] },
    LICENSED,
  );
  assert.ok(created.id);
  assert.equal(created.pages[0]?.elements[0]?.src, imageData);
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY), null);
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), null);

  await refreshCustomTemplateStore(); // a fresh IndexedDB read, as on reload
  const reopened = await customTemplateById(created.id);
  assert.ok(reopened);
  assert.equal(reopened.title, "قالب أ");
  assert.equal(reopened.pages[0]?.elements[0]?.src, imageData);
  assert.equal(reopened.pages[0]?.w, 210);
});

test("owner B cannot see owner A's template; A can reopen it after an account switch", async () => {
  const ownerA = "template-owner-a-switch";
  setStorageOwner(ownerA);
  await hydrateCustomTemplateStore({ force: true });
  const template = await saveCustomTemplate(
    { title: "خاص بالحساب أ", pages: [page("page-private", true)] },
    LICENSED,
  );

  setStorageOwner("template-owner-b-switch");
  assert.deepEqual(customTemplatesSnapshot(), [], "the old owner's in-memory snapshot is dropped immediately");
  await refreshCustomTemplateStore();
  assert.deepEqual(await loadCustomTemplates(), []);
  assert.equal(await customTemplateById(template.id), undefined);

  setStorageOwner(null);
  assert.deepEqual(customTemplatesSnapshot(), [], "sign-out also drops the in-memory snapshot");
  await refreshCustomTemplateStore();
  assert.deepEqual(await loadCustomTemplates(), []);
  assert.equal(await customTemplateById(template.id), undefined);

  setStorageOwner(ownerA);
  await refreshCustomTemplateStore();
  const reopened = await customTemplateById(template.id);
  assert.equal(reopened?.title, "خاص بالحساب أ");
  assert.equal(reopened?.pages[0]?.elements[0]?.src, imageData);
});

test("template edit drafts are private across sign-out and account switches", async () => {
  const ownerA = "template-draft-owner-a";
  setStorageOwner(ownerA);
  await hydrateCustomTemplateStore({ force: true });
  const draft = {
    entryId: "custom:private-draft",
    title: "مسودة الحساب أ",
    projectId: "project-private-draft",
    kind: "custom" as const,
    startedAt: 50,
  };
  await saveDraft(draft);
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), null);

  setStorageOwner("template-draft-owner-b");
  await refreshCustomTemplateStore();
  assert.equal(await loadDraft(), null);

  setStorageOwner(null);
  await refreshCustomTemplateStore();
  assert.equal(await loadDraft(), null);

  setStorageOwner(ownerA);
  await refreshCustomTemplateStore();
  const reopened = await loadDraft();
  assert.equal(reopened?.projectId, draft.projectId);
  assert.equal(reopened?.ownerId, ownerA);
});

test("a stale owner cannot clear the current account's template draft", async () => {
  const ownerA = "template-stale-clear-owner-a";
  setStorageOwner(ownerA);
  await hydrateCustomTemplateStore({ force: true });
  await saveDraft({
    entryId: "page:a",
    title: "مسودة أ",
    projectId: "draft-a",
    kind: "copy",
    startedAt: 60,
  });

  const ownerB = "template-stale-clear-owner-b";
  setStorageOwner(ownerB);
  await hydrateCustomTemplateStore({ force: true });
  await saveDraft({
    entryId: "page:b",
    title: "مسودة ب",
    projectId: "draft-b",
    kind: "copy",
    startedAt: 61,
  });

  await assert.rejects(clearDraft(ownerA), TemplateStorageError);
  assert.equal((await loadDraft())?.projectId, "draft-b");
  setStorageOwner(ownerA);
  await refreshCustomTemplateStore();
  assert.equal((await loadDraft())?.projectId, "draft-a");
});

test("rename updates the existing owned row and duplicate creates independent ids", async () => {
  const original = await saveCustomTemplate(
    { title: "اسم سابق", pages: [page("page-rename")] },
    LICENSED,
  );
  const renamed = await saveCustomTemplate(
    { id: original.id, title: "اسم جديد", pages: [page("page-renamed")] },
    LICENSED,
  );
  assert.equal(renamed.id, original.id);
  assert.equal((await customTemplateById(original.id))?.title, "اسم جديد");

  const copy = await duplicateCustomTemplate(original.id, LICENSED);
  assert.ok(copy);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.title, "اسم جديد — نسخة");
  assert.notEqual(copy.pages[0]?.id, renamed.pages[0]?.id);
});

test("deleting an owned template survives an IndexedDB reload", async () => {
  const template = await saveCustomTemplate(
    { title: "سيحذف", pages: [page("page-delete")] },
    LICENSED,
  );
  assert.equal(await deleteCustomTemplate(template.id), true);
  await refreshCustomTemplateStore();
  assert.equal(await customTemplateById(template.id), undefined);
  assert.deepEqual(await loadCustomTemplates(), []);
});

test("personal template writes preserve premium and page-limit gates", async () => {
  const source = await saveCustomTemplate(
    {
      title: "قالب مشتق من حزمة",
      derivedFrom: "pack:slides",
      pack: "slides",
      pages: [page("premium-source")],
    },
    LICENSED,
  );
  assert.equal(source.pack, "slides");

  await assert.rejects(
    saveCustomTemplate(
      { id: source.id, title: "محاولة تعديل", pages: [page("page-2")] },
      FREE,
    ),
    TemplateAccessError,
    "an edit must inherit and re-check its existing premium-pack lineage",
  );
  await assert.rejects(
    duplicateCustomTemplate(source.id, FREE),
    TemplateAccessError,
    "duplicating a premium-derived custom template must remain gated",
  );
  await assert.rejects(
    saveCustomTemplate(
      {
        title: "نسخة من الحزمة",
        derivedFrom: "pack:slides",
        pages: [page("page-3")],
      },
      FREE,
    ),
    TemplateAccessError,
    "legacy derivedFrom metadata must still enforce pack access",
  );
  await assert.rejects(
    saveCustomTemplate(
      {
        title: "مستند طويل",
        pages: [page("1"), page("2"), page("3"), page("4")],
      },
      FREE,
    ),
    (error: unknown) =>
      error instanceof TemplateAccessError && error.message.includes("حد الصفحات"),
    "the custom-template data action must enforce the page allowance",
  );
});

test("existing unscoped localStorage templates and draft migrate once without losing embedded images", async () => {
  const ownerA = LEGACY_OWNER;
  legacyStorage.setItem(LEGACY_CUSTOM_TEMPLATES_KEY, legacyTemplateRaw);
  legacyStorage.setItem(LEGACY_TEMPLATE_DRAFT_KEY, legacyDraftRaw);

  setStorageOwner(ownerA);
  await refreshCustomTemplateStore();
  const migrated = await customTemplateById("legacy-template-preserved");
  assert.equal(migrated?.title, "قالب قديم");
  assert.equal(migrated?.pages[0]?.elements[0]?.src, imageData);
  assert.equal((await loadDraft())?.projectId, "legacy-working-copy");
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY), null);
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), null);

  setStorageOwner("template-legacy-migration-other");
  await refreshCustomTemplateStore();
  assert.deepEqual(await loadCustomTemplates(), []);
  assert.equal(await loadDraft(), null);
  setStorageOwner(ownerA);
  await refreshCustomTemplateStore();
  assert.equal((await customTemplateById("legacy-template-preserved"))?.pages[0]?.elements[0]?.src, imageData);
});

test("legacy data changed after a durable migration is retained for recovery", async () => {
  legacyStorage.setItem(LEGACY_CUSTOM_TEMPLATES_KEY, legacyTemplateRaw);
  legacyStorage.setItem(LEGACY_TEMPLATE_DRAFT_KEY, legacyDraftRaw);
  setStorageOwner(LEGACY_OWNER);
  await refreshCustomTemplateStore();
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY), null);

  const changedTemplate = JSON.parse(legacyTemplateRaw) as { items: { title: string }[] };
  changedTemplate.items[0]!.title = "تعديل محفوظ من تبويب قديم";
  const newerLegacyData = JSON.stringify(changedTemplate);
  legacyStorage.setItem(LEGACY_CUSTOM_TEMPLATES_KEY, newerLegacyData);
  await assert.rejects(refreshCustomTemplateStore(), TemplateStorageError);
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY), newerLegacyData);
  assert.equal(customTemplatesSnapshot()[0]?.title, "قالب قديم");
});

test("partial legacy-key cleanup retries safely on the next load", async () => {
  legacyStorage.setItem(LEGACY_CUSTOM_TEMPLATES_KEY, legacyTemplateRaw);
  legacyStorage.setItem(LEGACY_TEMPLATE_DRAFT_KEY, legacyDraftRaw);
  setStorageOwner(LEGACY_OWNER);

  const remove = legacyStorage.removeItem.bind(legacyStorage);
  let failDraftCleanup = true;
  legacyStorage.removeItem = (key: string) => {
    if (key === LEGACY_TEMPLATE_DRAFT_KEY && failDraftCleanup) {
      failDraftCleanup = false;
      throw new Error("simulated storage cleanup failure");
    }
    remove(key);
  };
  try {
    await refreshCustomTemplateStore();
  } finally {
    legacyStorage.removeItem = remove;
  }
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY), null);
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), legacyDraftRaw);
  await refreshCustomTemplateStore();
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), null);
  assert.equal((await customTemplateById("legacy-template-preserved"))?.pages[0]?.elements[0]?.src, imageData);
  assert.equal((await loadDraft())?.projectId, "legacy-working-copy");
});

test("failed legacy migration retains every source key instead of dropping corrupted data", async () => {
  const templateRaw = JSON.stringify({ v: 1, items: [{ id: "legacy", title: "قديم", pages: [] }] });
  const draftRaw = "{not-valid-json";
  legacyStorage.setItem(LEGACY_CUSTOM_TEMPLATES_KEY, templateRaw);
  legacyStorage.setItem(LEGACY_TEMPLATE_DRAFT_KEY, draftRaw);

  setStorageOwner("template-legacy-corrupt-owner");
  await assert.rejects(refreshCustomTemplateStore(), /قالب قديم تالف/);
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY), templateRaw);
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), draftRaw);
});

test("legacy private templates are not exposed to a signed-out visitor before migration", async () => {
  legacyStorage.setItem(
    LEGACY_CUSTOM_TEMPLATES_KEY,
    JSON.stringify({ v: 1, items: [{ id: "unclaimed-legacy", title: "خاص", pages: [page()] }] }),
  );
  setStorageOwner(null);
  await refreshCustomTemplateStore();
  assert.deepEqual(await loadCustomTemplates(), []);
  assert.equal(legacyStorage.getItem(LEGACY_CUSTOM_TEMPLATES_KEY) !== null, true);
});
