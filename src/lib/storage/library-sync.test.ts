import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeLibraryCatalog,
  planLibraryDuplicate,
  repairParents,
  type LibraryCatalog,
} from "./library-sync.ts";

const base = (over: Partial<LibraryCatalog> = {}): LibraryCatalog => ({
  folders: [],
  assets: [],
  customItems: [],
  removedAssets: [],
  removedFolders: [],
  updatedAt: 1,
  ...over,
});

test("merge keeps both devices' folders and does not resurrect a deletion", () => {
  const local = base({
    folders: [{ id: "local", name: "شعارات", createdAt: 2, parentId: null }],
    assets: [{ id: "a", remoteId: "r1", name: "ختم", folderId: "local", w: 10, h: 10, addedAt: 2 }],
    removedAssets: [{ id: "gone", at: 5 }],
  });
  const remote = base({
    folders: [{ id: "cloud", name: "سحابة", createdAt: 3, parentId: null }],
    assets: [
      { id: "gone", remoteId: "rx", name: "قديم", folderId: null, w: 1, h: 1, addedAt: 1 },
      { id: "b", remoteId: "r2", name: "شعار", folderId: "cloud", w: 4, h: 4, addedAt: 3 },
    ],
    updatedAt: 3,
  });
  const merged = mergeLibraryCatalog(local, remote);
  assert.deepEqual(merged.folders.map((folder) => folder.id).sort(), ["cloud", "local"]);
  assert.deepEqual(merged.assets.map((asset) => asset.id).sort(), ["a", "b"]);
});

test("dangling and cyclic parents are lifted instead of orphaning children", () => {
  const repaired = repairParents(base({
    folders: [
      { id: "a", name: "أ", createdAt: 1, parentId: "missing" },
      { id: "b", name: "ب", createdAt: 1, parentId: "c" },
      { id: "c", name: "ج", createdAt: 1, parentId: "b" },
    ],
    assets: [{ id: "x", name: "ملف", folderId: "nope", w: 1, h: 1, addedAt: 1 }],
  }));
  const byId = new Map(repaired.folders.map((folder) => [folder.id, folder.parentId]));
  assert.equal(byId.get("a"), null);
  assert.ok(byId.get("b") === null || byId.get("c") === null);
  assert.equal(repaired.assets[0]?.folderId, null);
});

test("a folder copy is an independent tree and does not reuse remote ids", () => {
  const plan = planLibraryDuplicate({
    folders: [
      { id: "root", name: "أصل", createdAt: 1, parentId: null },
      { id: "child", name: "فرعي", createdAt: 1, parentId: "root" },
    ],
    assets: [
      { id: "logo", remoteId: "remote-1", name: "شعار", folderId: "child", w: 8, h: 8, addedAt: 1 },
      { id: "keep", remoteId: "remote-2", name: "يبقى", folderId: null, w: 2, h: 2, addedAt: 1 },
    ],
    assetIds: [],
    folderIds: ["root"],
    now: 9,
    mint: () => `id-${Math.random().toString(36).slice(2, 6)}`,
  });
  assert.equal(plan.folders.length, 2);
  assert.equal(plan.assets.length, 1);
  assert.notEqual(plan.assets[0]?.id, "logo");
  assert.equal(plan.assets[0]?.remoteId, null);
  assert.equal(plan.assets[0]?.sourceRemoteId, "remote-1");
  const child = plan.folders.find((folder) => folder.name.includes("فرعي"));
  const root = plan.folders.find((folder) => folder.name.includes("أصل"));
  assert.equal(child?.parentId, root?.id);
  assert.equal(plan.assets[0]?.folderId, child?.id);
});
