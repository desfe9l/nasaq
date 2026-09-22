import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FOLDER_ID,
  DEFAULT_FOLDER_NAME,
  normalizeNasaqLibrary,
} from "./library-manager.ts";
import { planLibraryImport } from "./library-export.ts";
import type { Asset, AssetFolder } from "./storage";

const PNG_1 = "data:image/png;base64,AAAA";

describe("normalizeNasaqLibrary", () => {
  it("unshifts the default folder when the file has none", () => {
    const out = normalizeNasaqLibrary({ kind: "nasaq-library", assets: [] });
    assert.equal(out.folders[0].id, DEFAULT_FOLDER_ID);
    assert.equal(out.folders[0].name, DEFAULT_FOLDER_NAME);
    assert.equal(out.kind, "nasaq-library");
    assert.equal(out.version, 1);
  });

  it("keeps a present default folder and does not duplicate it", () => {
    const out = normalizeNasaqLibrary({
      folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }],
      assets: [],
    });
    const hits = out.folders.filter((f) => f.id === DEFAULT_FOLDER_ID);
    assert.equal(hits.length, 1);
  });

  it("restores a blanked default-folder name", () => {
    const out = normalizeNasaqLibrary({
      folders: [{ id: DEFAULT_FOLDER_ID, name: "   " }],
      assets: [],
    });
    assert.equal(out.folders[0].name, DEFAULT_FOLDER_NAME);
  });

  it("classifies folderless assets into the default folder", () => {
    const out = normalizeNasaqLibrary({
      assets: [{ src: PNG_1 }, { src: PNG_1, folderId: "" }],
    });
    for (const asset of out.assets) {
      assert.equal(asset.folderId, DEFAULT_FOLDER_ID);
    }
  });

  it("repoints dangling folder references at the default folder", () => {
    const out = normalizeNasaqLibrary({
      folders: [{ id: "folder-real", name: "شعارات" }],
      assets: [
        { src: PNG_1, folderId: "folder-missing" },
        { src: PNG_1, folderId: "folder-real" },
      ],
    });
    assert.equal(out.assets[0].folderId, DEFAULT_FOLDER_ID);
    assert.equal(out.assets[1].folderId, "folder-real");
    const ids = new Set(out.folders.map((f) => f.id));
    for (const asset of out.assets) assert.ok(ids.has(asset.folderId));
  });

  it("fills missing id/name and clamps dimensions", () => {
    const out = normalizeNasaqLibrary({
      assets: [
        { src: PNG_1, w: 40, h: 0, addedAt: 123 },
        { src: PNG_1, w: NaN, h: 7, addedAt: Infinity },
      ],
    });
    assert.ok(out.assets[0].id.startsWith("asset-"));
    assert.equal(out.assets[0].name, "عنصر بدون عنوان");
    assert.equal(out.assets[0].w, 40);
    assert.equal(out.assets[0].h, 1); // clamped from 0
    assert.equal(out.assets[1].w, 100); // NaN → default
    assert.ok(out.assets[0].addedAt > 0);
    assert.ok(Number.isFinite(out.assets[1].addedAt));
  });

  it("survives garbage input without throwing", () => {
    for (const garbage of [null, "x", 7, [], { folders: "no", assets: 1 }]) {
      const out = normalizeNasaqLibrary(garbage);
      assert.equal(out.folders[0].id, DEFAULT_FOLDER_ID);
      assert.equal(out.assets.length, 0);
    }
  });

  it("does not mutate the input object", () => {
    const input = {
      folders: [{ id: "folder-a", name: "أ" }],
      assets: [{ id: "a1", name: "ن", src: PNG_1, folderId: "folder-a" }],
    };
    const snapshot = JSON.stringify(input);
    normalizeNasaqLibrary(input);
    assert.equal(JSON.stringify(input), snapshot);
  });
});

describe("planLibraryImport", () => {
  const kindOk = (doc: unknown) =>
    planLibraryImport(doc, { folders: [], assets: [] });

  const folder = (id: string, name: string): AssetFolder => ({
    id,
    name,
    createdAt: 1,
  });
  const asset = (
    src: string,
    name: string,
    folderId?: string | null,
  ): Asset => ({
    id: `id-${name}`,
    name,
    src,
    w: 10,
    h: 10,
    addedAt: 1,
    folderId: folderId ?? null,
  });

  it("throws an Arabic error for a non-library document", () => {
    assert.throws(() => kindOk({ kind: "other", version: 1 }), /مكتبة/);
    assert.throws(() => kindOk(null), /مكتبة/);
  });

  it("throws an Arabic error for a future version", () => {
    assert.throws(() => kindOk({ kind: "nasaq-library", version: 99 }), /أحدث/);
  });

  it("gives every planned asset a folderId that resolves in the plan", () => {
    const plan = kindOk({
      kind: "nasaq-library",
      version: 1,
      folders: [{ id: "f-a", name: "شعارات" }],
      assets: [
        { name: "أ", src: PNG_1, folderId: "f-a" },
        { name: "ب", src: PNG_1 }, // no folderId at all
        { name: "ج", src: PNG_1, folderId: "gone" }, // dangling
      ],
    });
    const known = new Set([
      ...plan.folders.map((f) => f.id),
      ...([] as AssetFolder[]).map((f) => f.id),
    ]);
    assert.ok(plan.assets.length >= 3);
    for (const a of plan.assets) {
      assert.ok(a.folderId, "folderId must never be null/empty");
      assert.ok(
        known.has(a.folderId!),
        `folderId ${a.folderId} must exist in the plan`,
      );
    }
    // folderless + dangling land in the shipped default folder.
    const byName = new Map(plan.assets.map((a) => [a.name, a.folderId]));
    assert.equal(byName.get("ب"), DEFAULT_FOLDER_ID);
    assert.equal(byName.get("ج"), DEFAULT_FOLDER_ID);
    assert.ok(plan.folders.some((f) => f.id === DEFAULT_FOLDER_ID));
  });

  it("keeps the stable folder-uncategorized id when it is free", () => {
    const plan = kindOk({
      kind: "nasaq-library",
      version: 1,
      assets: [{ name: "أ", src: PNG_1 }],
    });
    assert.ok(plan.folders.some((f) => f.id === DEFAULT_FOLDER_ID));
    assert.equal(plan.assets[0].folderId, DEFAULT_FOLDER_ID);
  });

  it("matches an existing store folder by name instead of re-creating it", () => {
    const existing = {
      folders: [folder("store-1", DEFAULT_FOLDER_NAME)],
      assets: [],
    };
    const plan = planLibraryImport(
      {
        kind: "nasaq-library",
        version: 1,
        assets: [{ name: "أ", src: PNG_1 }],
      },
      existing,
    );
    assert.equal(plan.folders.length, 0); // already present by name
    assert.equal(plan.assets[0].folderId, "store-1");
  });

  it("falls back to a fresh id when the store folder was renamed", () => {
    // Store holds folder-uncategorized under a new name — the file's default
    // folder must not collide with it, so a fresh id is minted for «غير مصنّف».
    const existing = {
      folders: [folder(DEFAULT_FOLDER_ID, "أرشيف")],
      assets: [],
    };
    const plan = planLibraryImport(
      {
        kind: "nasaq-library",
        version: 1,
        assets: [{ name: "أ", src: PNG_1 }],
      },
      existing,
    );
    const def = plan.folders.find((f) => f.name === DEFAULT_FOLDER_NAME);
    assert.ok(def);
    assert.notEqual(def!.id, DEFAULT_FOLDER_ID); // id already taken
    assert.notEqual(plan.assets[0].folderId, DEFAULT_FOLDER_ID);
    assert.ok(plan.folders.some((f) => f.id === plan.assets[0].folderId));
  });

  it("skips exact duplicates and counts them", () => {
    const existing = { folders: [], assets: [asset(PNG_1, "أ")] };
    const plan = planLibraryImport(
      {
        kind: "nasaq-library",
        version: 1,
        assets: [
          { name: "أ", src: PNG_1 }, // duplicate
          { name: "ب", src: PNG_1 }, // new (same bytes, other name)
        ],
      },
      existing,
    );
    assert.equal(plan.skipped, 1);
    assert.equal(plan.assets.length, 1);
    assert.equal(plan.assets[0].name, "ب");
  });

  it("drops unsafe javascript: sources entirely", () => {
    const plan = kindOk({
      kind: "nasaq-library",
      version: 1,
      assets: [
        { name: "خطر", src: "javascript:alert(1)" },
        { name: "آمن", src: PNG_1 },
      ],
    });
    assert.equal(plan.assets.length, 1);
    assert.equal(plan.assets[0].name, "آمن");
  });
});
