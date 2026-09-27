import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setStorageOwner } from "./storage-owner";
import {
  deleteAsset,
  deleteProject,
  getProject,
  getSetting,
  listAssets,
  listProjects,
  saveAsset,
  saveProject,
  setSetting,
} from "./storage";
import type { Project } from "./model";

/**
 * The logout / auth boundary, enforced at the data layer.
 *
 * These run `storage.ts` for real on the localStorage-fallback path (node has
 * no `indexedDB`, so `openDb()` resolves null and every call takes the
 * fallback) — the same owner-scoping code the IndexedDB path uses. The
 * invariants under test:
 *
 *  - a signed-out visitor never reads an account's library (the logout leak);
 *  - a second account never reads — or deletes — the first account's rows;
 *  - pre-isolation (unstamped) rows are invisible while signed out and are
 *    adopted exclusively by the first account that reads them;
 *  - a visitor's own demo work survives their sign-in (adoption), then follows
 *    the account boundary like any other row.
 */

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

const memory = new MemoryStorage();
(globalThis as Record<string, unknown>).localStorage = memory;

function project(id: string, name: string): Project {
  return {
    version: 2,
    name,
    theme: "official",
    orgName: "",
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: [],
  };
}

const LS_PROJECTS = "nasaq-projects-v1";

beforeEach(() => {
  memory.clear();
  setStorageOwner(null);
});

test("logout: an account's library is invisible — and undeletable — while signed out", async () => {
  setStorageOwner("user-a");
  await saveProject(project("proj-a", "تقرير user-a"));
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    ["proj-a"],
  );

  setStorageOwner(null); // ← sign-out
  assert.deepEqual(await listProjects(), []);
  assert.equal(await getProject("proj-a"), null);
  await deleteProject("proj-a"); // must silently no-op on a foreign row

  setStorageOwner("user-a"); // ← the same account signs back in
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    ["proj-a"],
    "the row survived the signed-out delete attempt",
  );
});

test("a second account never sees or deletes the first account's library", async () => {
  setStorageOwner("user-a");
  await saveProject(project("proj-a", "تقرير user-a"));

  setStorageOwner("user-b");
  assert.deepEqual(await listProjects(), []);
  assert.equal(await getProject("proj-a"), null);
  await deleteProject("proj-a");

  setStorageOwner("user-a");
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    ["proj-a"],
  );
});

test("a visitor's demo project is adopted at sign-in, then follows the account boundary", async () => {
  // Signed-out visitor works in the open editor.
  await saveProject(project("proj-v", "تجربة زائر"));
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    ["proj-v"],
  );

  // They sign in: the demo work is theirs now.
  setStorageOwner("user-c");
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    ["proj-v"],
  );

  // …and once it belongs to the account, signing out hides it again.
  setStorageOwner(null);
  assert.deepEqual(await listProjects(), []);
});

test("pre-isolation unstamped rows: invisible signed out, adopted exclusively by the first account", async () => {
  // A library written before ownership tracking: no ownerId on the rows.
  memory.setItem(
    LS_PROJECTS,
    JSON.stringify([project("proj-legacy", "مكتبة قديمة")]),
  );

  assert.deepEqual(await listProjects(), [], "a signed-out visitor adopts nothing");

  setStorageOwner("user-d");
  assert.deepEqual(
    (await listProjects()).map((p) => p.id),
    ["proj-legacy"],
  );
  // Adoption is durable: the stamp was written back.
  const raw = JSON.parse(memory.getItem(LS_PROJECTS) ?? "[]") as {
    ownerId?: string;
  }[];
  assert.equal(raw[0]?.ownerId, "user-d");

  setStorageOwner("user-e");
  assert.deepEqual(await listProjects(), [], "the claim is exclusive");
});

test("account-scoped settings are per-owner; device-level settings stay shared", async () => {
  setStorageOwner("user-a");
  await setSetting("activeProjectId", "proj-a");
  await setSetting("zoom", 1.2);

  assert.equal(await getSetting<string>("activeProjectId"), "proj-a");

  setStorageOwner(null);
  assert.equal(
    await getSetting<string>("activeProjectId"),
    null,
    "a signed-out visitor never reads an account's active document",
  );

  setStorageOwner("user-b");
  assert.equal(await getSetting<string>("activeProjectId"), null);
  assert.equal(
    await getSetting<number>("zoom"),
    1.2,
    "device-level UI preferences remain shared",
  );
});

test("assets follow the same boundary", async () => {
  setStorageOwner("user-a");
  await saveAsset({ name: "شعار", src: "data:image/png;base64,AA", w: 10, h: 10 });

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

test("getProject returns rows without the owner stamp (exports stay clean)", async () => {
  setStorageOwner("user-a");
  await saveProject(project("proj-a", "تقرير"));
  const loaded = await getProject("proj-a");
  assert.ok(loaded);
  assert.equal("ownerId" in loaded, false);
});
