import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { setStorageOwner } from "@/lib/editor/storage-owner";
import type { Page } from "@/lib/editor/model";
import {
  customTemplateById,
  hydrateCustomTemplateStore,
  LEGACY_TEMPLATE_DRAFT_KEY,
  loadDraft,
  refreshCustomTemplateStore,
  saveCustomTemplate,
  saveDraft,
} from "./custom-templates.ts";
import { commitTemplateDraft, type DraftProject } from "./draft-commit.ts";

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

const FREE = { premium_templates: false, unlimited_projects: false, unlimited_pages: false };
const LICENSED = { premium_templates: true, unlimited_projects: true, unlimited_pages: true };

const textPage = (content: string): Page => ({
  id: "page-1",
  name: "صفحة",
  w: 210,
  h: 297,
  elements: [{
    id: "el-1",
    type: "text",
    name: "عنوان",
    x: 10,
    y: 10,
    w: 100,
    h: 20,
    rotation: 0,
    opacity: 1,
    z: 1,
    content,
    style: {},
  }],
});

let sequence = 0;
beforeEach(async () => {
  legacyStorage.clear();
  setStorageOwner(null);
  setStorageOwner(`draft-template-owner-${++sequence}`);
  await hydrateCustomTemplateStore({ force: true });
});

const projects = (map: Record<string, DraftProject>) => async (id: string) => map[id] ?? null;

test("a custom draft overwrites its template with the saved project pages and clears the draft", async () => {
  const original = await saveCustomTemplate(
    { title: "قالبي", desc: "وصف", category: "reports", tags: ["أ"], pages: [textPage("قبل")] },
    LICENSED,
  );
  await saveDraft({ entryId: `custom:${original.id}`, title: "قالبي", projectId: "proj-1", kind: "custom", startedAt: 1 });
  assert.equal(legacyStorage.getItem(LEGACY_TEMPLATE_DRAFT_KEY), null);
  const entries = (await import("./catalog.ts")).buildCatalog({ themeId: "official", custom: [original] });

  const result = await commitTemplateDraft((await loadDraft())!, {
    entries,
    entitlements: LICENSED,
    readProject: projects({ "proj-1": { pages: [textPage("بعد")] } }),
  });

  assert.equal(result.status, "saved");
  assert.ok(result.status === "saved" && result.updated);
  const stored = await customTemplateById(original.id);
  assert.equal(stored?.pages[0]?.elements[0]?.content, "بعد");
  assert.equal(stored?.title, "قالبي");
  assert.equal(stored?.desc, "وصف");
  assert.deepEqual(stored?.tags, ["أ"]);
  assert.equal(await loadDraft(), null);
});

test("a copy draft of a shipped template is saved as a new derived custom template", async () => {
  const { buildCatalog } = await import("./catalog.ts");
  const entries = buildCatalog({ themeId: "official" });
  const source = entries.find((entry) => entry.kind === "page")!;
  await saveDraft({ entryId: source.id, title: source.title, projectId: "proj-2", kind: "copy", startedAt: 1 });

  const result = await commitTemplateDraft((await loadDraft())!, {
    entries,
    entitlements: LICENSED,
    readProject: projects({ "proj-2": { pages: [textPage("نسخة معدلة")] } }),
  });

  assert.equal(result.status, "saved");
  if (result.status !== "saved") return;
  assert.equal(result.updated, false);
  assert.equal(result.template.derivedFrom, source.id);
  assert.equal((await customTemplateById(result.template.id))?.pages[0]?.elements[0]?.content, "نسخة معدلة");
  assert.equal(await loadDraft(), null);
});

test("a deleted working copy clears the stale owner-scoped draft without writing a template", async () => {
  await saveDraft({ entryId: "page:x", title: "x", projectId: "gone", kind: "copy", startedAt: 1 });
  const result = await commitTemplateDraft((await loadDraft())!, {
    entries: [],
    entitlements: LICENSED,
    readProject: projects({}),
  });
  assert.deepEqual(result, { status: "missing" });
  assert.equal(await loadDraft(), null);
});

test("premium content is not written for an account without the entitlement", async () => {
  await saveDraft({ entryId: "pack:official", title: "حزمة", projectId: "proj-3", kind: "copy", startedAt: 1 });
  const result = await commitTemplateDraft((await loadDraft())!, {
    entries: [],
    entitlements: FREE,
    readProject: projects({
      "proj-3": { pages: [textPage("x")], licensedTemplateId: "builtin_pack_official" },
    }),
  });
  assert.deepEqual(result, { status: "blocked", block: "premium-template" });
  assert.ok(await loadDraft(), "the draft stays so the edit is not lost");
  await refreshCustomTemplateStore();
  assert.ok(await loadDraft(), "the owner-scoped draft remains after a reload");
});

test("a draft captured by owner A cannot be committed after switching to owner B", async () => {
  const ownerA = "draft-owner-a-switch";
  setStorageOwner(ownerA);
  await hydrateCustomTemplateStore({ force: true });
  await saveDraft({ entryId: "page:x", title: "A", projectId: "proj-a", kind: "copy", startedAt: 1 });
  const ownerADraft = (await loadDraft())!;
  setStorageOwner("draft-owner-b-switch");
  await refreshCustomTemplateStore();

  const result = await commitTemplateDraft(ownerADraft, {
    entries: [],
    entitlements: LICENSED,
    readProject: projects({ "proj-a": { pages: [textPage("must not be read")] } }),
  });
  assert.deepEqual(result, { status: "missing" });
  assert.equal(await loadDraft(), null);
  setStorageOwner(ownerA);
  await refreshCustomTemplateStore();
  assert.equal((await loadDraft())?.projectId, "proj-a");
});
