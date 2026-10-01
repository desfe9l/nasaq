import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalog, entryProjectSeed } from "./catalog.ts";
import {
  TemplateAccessError,
  duplicateCustomTemplate,
  saveCustomTemplate,
} from "./custom-templates.ts";
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

const page = (id = "page-1"): Page => ({
  id,
  name: "صفحة اختبار",
  w: 210,
  h: 297,
  elements: [],
});

test("custom templates retain source-pack lineage and enforce entitlement limits", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: new MemoryStorage() },
  });

  const source = saveCustomTemplate(
    {
      title: "قالب مشتق من حزمة",
      derivedFrom: "pack:slides",
      pack: "slides",
      pages: [page()],
    },
    LICENSED,
  );
  assert.equal(source.pack, "slides");

  const entry = buildCatalog({
    themeId: "official",
    custom: [source],
  }).find((item) => item.id === `custom:${source.id}`)!;
  const seed = entryProjectSeed(entry, { themeId: "official" });
  assert.equal(seed.pack, "slides");

  assert.throws(
    () =>
      saveCustomTemplate(
        { id: source.id, title: "محاولة تعديل", pages: [page("page-2")] },
        FREE,
      ),
    TemplateAccessError,
    "an edit must inherit and re-check its existing premium-pack lineage",
  );
  assert.throws(
    () => duplicateCustomTemplate(source.id, FREE),
    TemplateAccessError,
    "duplicating a premium-derived custom template must remain gated",
  );
  assert.throws(
    () =>
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
  assert.throws(
    () =>
      saveCustomTemplate(
        {
          title: "مستند طويل",
          pages: [page("1"), page("2"), page("3"), page("4")],
        },
        FREE,
      ),
    (error: unknown) =>
      error instanceof TemplateAccessError &&
      error.message.includes("حد الصفحات"),
    "the custom-template data action must enforce the page allowance",
  );
});
