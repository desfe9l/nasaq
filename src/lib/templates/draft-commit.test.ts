import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog } from "./catalog.ts";
import {
  customTemplateById,
  draftSnapshot,
  saveCustomTemplate,
  saveDraft,
} from "./custom-templates.ts";
import { commitTemplateDraft, type DraftProject } from "./draft-commit.ts";
import type { Page } from "@/lib/editor/model";

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

const FREE = { premium_templates: false, unlimited_projects: false, unlimited_pages: false };
const LICENSED = { premium_templates: true, unlimited_projects: true, unlimited_pages: true };

const textPage = (content: string): Page => ({
  id: "page-1",
  name: "صفحة",
  w: 210,
  h: 297,
  elements: [
    {
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
    },
  ],
});

function freshStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: new MemoryStorage() },
  });
}

const projects = (map: Record<string, DraftProject>) => async (id: string) => map[id] ?? null;

test("a custom draft overwrites its template with the saved project pages and clears the draft", async () => {
  freshStorage();
  const original = saveCustomTemplate(
    { title: "قالبي", desc: "وصف", category: "reports", tags: ["أ"], pages: [textPage("قبل")] },
    LICENSED,
  );
  saveDraft({ entryId: `custom:${original.id}`, title: "قالبي", projectId: "proj-1", kind: "custom", startedAt: 1 });
  const entries = buildCatalog({ themeId: "official", custom: [original] });

  const result = await commitTemplateDraft(draftSnapshot()!, {
    entries,
    entitlements: LICENSED,
    readProject: projects({ "proj-1": { pages: [textPage("بعد")] } }),
  });

  assert.equal(result.status, "saved");
  assert.ok(result.status === "saved" && result.updated);
  const stored = customTemplateById(original.id)!;
  assert.equal(stored.pages[0].elements[0].content, "بعد");
  assert.equal(stored.title, "قالبي");
  assert.equal(stored.desc, "وصف");
  assert.deepEqual(stored.tags, ["أ"]);
  assert.equal(draftSnapshot(), null);
});

test("a copy draft of a shipped template is saved as a new derived custom template", async () => {
  freshStorage();
  const entries = buildCatalog({ themeId: "official" });
  const source = entries.find((e) => e.kind === "page")!;
  saveDraft({ entryId: source.id, title: source.title, projectId: "proj-2", kind: "copy", startedAt: 1 });

  const result = await commitTemplateDraft(draftSnapshot()!, {
    entries,
    entitlements: LICENSED,
    readProject: projects({ "proj-2": { pages: [textPage("نسخة معدلة")] } }),
  });

  assert.equal(result.status, "saved");
  if (result.status !== "saved") return;
  assert.equal(result.updated, false);
  assert.equal(result.template.derivedFrom, source.id);
  assert.equal(customTemplateById(result.template.id)!.pages[0].elements[0].content, "نسخة معدلة");
  assert.equal(draftSnapshot(), null);
});

test("a deleted working copy clears the stale draft without writing anything", async () => {
  freshStorage();
  saveDraft({ entryId: "page:x", title: "x", projectId: "gone", kind: "copy", startedAt: 1 });
  const result = await commitTemplateDraft(draftSnapshot()!, {
    entries: [],
    entitlements: LICENSED,
    readProject: projects({}),
  });
  assert.deepEqual(result, { status: "missing" });
  assert.equal(draftSnapshot(), null);
});

test("premium content is not written for an account without the entitlement", async () => {
  freshStorage();
  saveDraft({ entryId: "pack:official", title: "حزمة", projectId: "proj-3", kind: "copy", startedAt: 1 });
  const result = await commitTemplateDraft(draftSnapshot()!, {
    entries: [],
    entitlements: FREE,
    readProject: projects({
      "proj-3": { pages: [textPage("x")], licensedTemplateId: "builtin_pack_official" },
    }),
  });
  assert.deepEqual(result, { status: "blocked", block: "premium-template" });
  assert.notEqual(draftSnapshot(), null, "the draft stays so the edit is not lost");
});
