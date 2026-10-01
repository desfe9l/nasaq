import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { setStorageOwner } from "./storage-owner";
import {
  saveAsset,
  listAssets,
  deleteAsset,
  saveProject,
  getProject,
  getSetting,
  setSetting,
} from "./storage";
import { createProject } from "./templates";

const webStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => webStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      webStorage.set(key, value);
    },
    removeItem: (key: string) => {
      webStorage.delete(key);
    },
  },
});

test("legacy binary libraries migrate durably even when another legacy key is corrupt", async () => {
  localStorage.setItem("nasaq-projects-v1", "{");
  localStorage.setItem(
    "diwan-projects-v1",
    JSON.stringify([
      {
        ...createProject("blank"),
        id: "legacy-project",
        ownerId: "legacy-owner",
      },
    ]),
  );
  localStorage.setItem(
    "nasaq-assets-v1",
    JSON.stringify([
      {
        id: "legacy-asset",
        name: "legacy-logo",
        src: "data:image/png;base64,AA",
        w: 10,
        h: 10,
        ownerId: "legacy-owner",
      },
    ]),
  );
  setStorageOwner("legacy-owner");
  assert.equal((await listAssets())[0].name, "legacy-logo");
  assert.ok(await getProject("legacy-project"));
  assert.equal(localStorage.getItem("nasaq-assets-v1"), null);
  assert.equal(localStorage.getItem("diwan-projects-v1"), null);
  localStorage.removeItem("nasaq-projects-v1");
  setStorageOwner("different-owner");
  assert.deepEqual(await listAssets(), []);
  assert.equal(await getProject("legacy-project"), null);
});

test("assets follow the same boundary", async () => {
  setStorageOwner("user-a");
  await saveAsset({
    name: "شعار",
    src: "data:image/png;base64,AA",
    w: 10,
    h: 10,
  });

  setStorageOwner(null);
  assert.deepEqual(await listAssets(), []);
  setStorageOwner("user-b");
  assert.deepEqual(await listAssets(), []);

  setStorageOwner("user-a");
  const assets = await listAssets();
  const asset = assets[0];
  assert.ok(asset);
  assert.equal(asset.name, "شعار");
  assert.equal(
    "ownerId" in asset,
    false,
    "rows re-enter app state without the storage stamp",
  );

  setStorageOwner("user-b");
  await deleteAsset(asset.id); // foreign — must no-op
  setStorageOwner("user-a");
  assert.equal((await listAssets()).length, 1);
});

test("asset folder ids, hierarchy, and names persist with their assets", async () => {
  setStorageOwner("library-owner");
  const folders = [
    { id: "folder-brand", name: "الهوية", createdAt: 1, parentId: null },
    { id: "folder-logos", name: "الشعارات", createdAt: 2, parentId: "folder-brand" },
  ];
  await setSetting("assetFolders", folders);
  await saveAsset({
    name: "الشعار الرئيسي",
    src: "data:image/png;base64,AA",
    w: 10,
    h: 10,
    folderId: "folder-logos",
  });

  setStorageOwner("other-owner");
  assert.deepEqual(await getSetting("assetFolders"), null);
  assert.deepEqual(await listAssets(), []);

  setStorageOwner("library-owner");
  assert.deepEqual(await getSetting("assetFolders"), folders);
  assert.equal((await listAssets())[0]?.folderId, "folder-logos");
});

test("foreign asset and project ids cannot be overwritten", async () => {
  setStorageOwner("owner-a");
  const asset = await saveAsset({
    name: "original",
    src: "data:image/png;base64,AA",
    w: 10,
    h: 10,
  });
  const project = await saveProject({
    ...createProject("blank"),
    id: "owned-document",
  });
  setStorageOwner("owner-b");
  await assert.rejects(saveAsset({ ...asset, name: "stolen" }));
  await assert.rejects(saveProject({ ...project, name: "stolen" }));
  setStorageOwner("owner-a");
  assert.equal((await getProject(project.id!))?.name, project.name);
  assert.ok(
    (await listAssets()).some(
      (a) => a.id === asset.id && a.name === "original",
    ),
  );
});

test("identity profiles and logo binaries are isolated in the existing IndexedDB settings store", async () => {
  const {
    saveBrandKit,
    readBrandKit,
    createBrandProfile,
    listBrandProfiles,
    importBrandProfiles,
  } = await import("../product/brand-kit");
  const { DEFAULT_BRAND_KIT } = await import("../product/product");
  setStorageOwner("identity-a");
  await saveBrandKit({
    ...DEFAULT_BRAND_KIT,
    organizationName: "private-a",
    logoSrc: "data:image/png;base64,AA",
    pageSize: "a4-landscape",
  });
  assert.equal((await readBrandKit()).pageSize, "a4-landscape");
  setStorageOwner("identity-b");
  assert.equal((await readBrandKit()).logoSrc, undefined);
  await createBrandProfile("هوية ب");
  assert.equal((await listBrandProfiles()).profiles.length, 2);
  setStorageOwner("identity-a");
  assert.equal((await readBrandKit()).organizationName, "private-a");
  assert.equal((await readBrandKit()).logoSrc, "data:image/png;base64,AA");
  const longName = "أ".repeat(60);
  assert.equal(
    await importBrandProfiles({
      kind: "nasaq-brand-kit",
      profiles: Array.from({ length: 4 }, () => ({
        name: longName,
        kit: DEFAULT_BRAND_KIT,
      })),
    }),
    4,
  );
  assert.equal(
    new Set((await listBrandProfiles()).profiles.map((p) => p.name)).size,
    5,
  );
});

test("legacy identity is claimed once by a signed-in owner, never by another account", async () => {
  const { readBrandKit } = await import("../product/brand-kit");
  localStorage.setItem(
    "diwan-brand-kit-v1",
    JSON.stringify({
      organizationName: "legacy-brand",
      logoSrc: "data:image/png;base64,AA",
    }),
  );
  setStorageOwner(null);
  assert.notEqual((await readBrandKit()).organizationName, "legacy-brand");
  assert.ok(localStorage.getItem("diwan-brand-kit-v1"));
  setStorageOwner("brand-legacy-owner");
  assert.equal((await readBrandKit()).logoSrc, "data:image/png;base64,AA");
  assert.equal(localStorage.getItem("diwan-brand-kit-v1"), null);
  setStorageOwner("brand-other-owner");
  assert.equal((await readBrandKit()).logoSrc, undefined);
  setStorageOwner("brand-legacy-owner");
  assert.equal((await readBrandKit()).organizationName, "legacy-brand");
});
