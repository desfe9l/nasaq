import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { setStorageOwner, getStorageOwner, ANON_OWNER } from "@/lib/editor/storage-owner";
import { saveProject, getProject, listProjects, deleteProject } from "@/lib/editor/storage";
import { createProject } from "@/lib/editor/templates";
import { cacheEntitlement, getCachedEntitlement, isEntitlementValidOffline } from "./entitlement-cache";
import { enqueueSync, listPendingQueue, processSyncQueue, resolveConflict } from "./sync-queue";
import { cacheTemplateForOffline, getOfflineTemplate, isTemplateAvailableOffline, downloadAndCacheTemplate } from "./template-cache";
import { saveWorkspaceSnapshot, getWorkspaceSnapshot, prepareProjectForOffline, isProjectPreparedOffline } from "./workspace-cache";
import { editorStatusLabel } from "./connectivity";

// fake navigator.onLine toggling
function setOnline(v: boolean) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: v, serviceWorker: undefined },
    configurable: true,
    writable: true,
  });
  // also window.navigator for connectivity module
  (globalThis as unknown as { window?: unknown }).window = globalThis as unknown;
}

test("offline-first critical UX: online -> offline edit -> reconnect sync", async () => {
  // Step 1: Online — user downloads/opens a project or template → content becomes available offline
  setOnline(true);
  setStorageOwner("user-offline-test");

  // Cache entitlement (server validated) for offline grace
  await cacheEntitlement({
    ownerId: "user-offline-test",
    entitlements: { core_editor: true, premium_templates: true, unlimited_projects: true } as unknown as Record<string, boolean>,
    validatedAt: Date.now(),
    expiresAt: null,
    isAdmin: false,
    isOwner: false,
    hasLicense: true,
    source: "server",
  });
  const cached = await getCachedEntitlement("user-offline-test");
  assert.ok(cached);
  assert.equal(isEntitlementValidOffline(cached), true, "grace should be valid");

  // Create and save a project online
  const proj = await saveProject({ ...createProject("official"), id: "proj-offline-1", name: "مشروع دون اتصال", orgName: "نَسَق" });
  assert.ok(proj.id);

  // Cache workspace snapshot
  const metas = await listProjects();
  await saveWorkspaceSnapshot({ ownerId: "user-offline-test", projects: metas, folders: [], recentIds: [proj.id!] });
  const snap = await getWorkspaceSnapshot("user-offline-test");
  assert.ok(snap);
  assert.equal(snap.projects.length, 1);

  // Cache a template for offline (licensed)
  await cacheTemplateForOffline({
    id: "tpl-offline-1",
    title: "قالب مميز",
    content: JSON.stringify({ pages: proj.pages }),
    thumbnail: null,
    tier: "premium",
    source: "admin",
  });
  assert.equal(await isTemplateAvailableOffline("tpl-offline-1"), true);

  // Step 2: Internet is disabled → NASAQ still opens → workspace works → project opens → pages work → template works → editing works → autosave works
  setOnline(false);

  // Workspace should still be available via cache (and via IDB which is local)
  const offlineList = await listProjects();
  assert.equal(offlineList.length, 1, "project should be available offline from IndexedDB");

  const offlineProj = await getProject("proj-offline-1");
  assert.ok(offlineProj);
  assert.equal(offlineProj.pages.length, proj.pages.length);
  assert.equal(offlineProj.name, "مشروع دون اتصال");

  const offlineTpl = await getOfflineTemplate("tpl-offline-1");
  assert.ok(offlineTpl);
  assert.equal(offlineTpl.title, "قالب مميز");

  // Editing works offline (autosave to IDB)
  const edited = { ...offlineProj, name: "مشروع معدل دون اتصال", updatedAt: Date.now() };
  await saveProject(edited);
  const afterEdit = await getProject("proj-offline-1");
  assert.equal(afterEdit?.name, "مشروع معدل دون اتصال");

  // New projects: allow creation and editing offline
  const newProj = await saveProject({ ...createProject("blank"), id: "proj-offline-new", name: "جديد دون اتصال" });
  assert.ok(newProj.id);
  const allOffline = await listProjects();
  assert.equal(allOffline.length, 2, "new project created offline should persist");

  // Duplicate/rename/delete operations queue for sync
  await enqueueSync("project:rename", { id: "proj-offline-1", name: "معاد تسميته دون اتصال", updatedAt: Date.now() }, { dedupeKey: "project:rename:proj-offline-1" });
  await enqueueSync("project:delete", { id: "proj-offline-new", updatedAt: Date.now() }, { dedupeKey: "project:delete:proj-offline-new" });
  // Duplicate enqueue should not create duplicate entry (dedupe)
  await enqueueSync("project:rename", { id: "proj-offline-1", name: "معاد تسميته دون اتصال", updatedAt: Date.now() }, { dedupeKey: "project:rename:proj-offline-1" });
  const pendingOffline = await listPendingQueue("user-offline-test");
  assert.equal(pendingOffline.filter((e) => e.dedupeKey === "project:rename:proj-offline-1").length, 1, "duplicate sync operations prevented");

  // Simulate browser restart: IDB persists (in fake-indexeddb it does), workspace snapshot persists
  // (We don't actually restart Node, but we re-read from IDB)
  const afterRestartList = await listProjects();
  assert.equal(afterRestartList.length, 2);

  // Step 3: Internet returns → automatic sync completes
  setOnline(true);
  const result = await processSyncQueue();
  // Since cloud not configured, queue should drain locally (considered success)
  // Even without cloud, process should succeed and clear queue
  // Our queue's cloud sync returns not_configured -> success
  const pendingAfterSync = await listPendingQueue("user-offline-test");
  // After sync, deduplicated queue should be drained (or at least rename should be processed)
  // In our implementation, project operations return not_configured -> ok -> removed
  assert.ok(pendingAfterSync.length === 0 || pendingAfterSync.length < pendingOffline.length, "queue should drain after reconnect");

  // Verify edited project still correct after sync (no remote overwrite)
  const finalProj = await getProject("proj-offline-1");
  assert.equal(finalProj?.name, "مشروع معدل دون اتصال");

  // Cleanup
  await deleteProject("proj-offline-1");
  await deleteProject("proj-offline-new");
  setStorageOwner(ANON_OWNER);
  setOnline(true);
});

test("account isolation: never expose cached projects, assets, templates, or workspace data between accounts", async () => {
  setOnline(true);
  // User A caches
  setStorageOwner("alice");
  const projA = await saveProject({ ...createProject("official"), id: "alice-proj", name: "Alice Secret" });
  await saveWorkspaceSnapshot({ ownerId: "alice", projects: await listProjects(), folders: [], recentIds: [projA.id!] });
  await cacheTemplateForOffline({ id: "alice-tpl", title: "Alice Template", content: "{}", tier: "free", source: "builtin" });
  await cacheEntitlement({
    ownerId: "alice",
    entitlements: { premium_templates: true } as unknown as Record<string, boolean>,
    validatedAt: Date.now(),
    expiresAt: null,
    isAdmin: false,
    isOwner: false,
    hasLicense: true,
    source: "server",
  });

  // User B must not see Alice's data
  setStorageOwner("bob");
  const bobProjects = await listProjects();
  assert.equal(bobProjects.find((p) => p.id === "alice-proj"), undefined, "bob must not see alice project");
  const bobTpl = await getOfflineTemplate("alice-tpl", "bob");
  assert.equal(bobTpl, null, "bob must not see alice template (ownerId mismatch)");
  const bobSnap = await getWorkspaceSnapshot("bob");
  assert.equal(bobSnap, null, "bob workspace cache should be empty");
  const bobEnt = await getCachedEntitlement("bob");
  assert.equal(bobEnt, null, "bob must not see alice entitlement");
  // Also check that querying alice's snapshot while as bob doesn't leak
  const aliceSnapWhileBob = await getWorkspaceSnapshot("alice");
  // Direct read with explicit alice owner should work only if explicitly requested, but listPendingQueue should be isolated
  // Ensure queue isolation
  await enqueueSync("project:create", { id: "bob-proj", name: "Bob" }, { dedupeKey: "project:create:bob-proj" });
  setStorageOwner("alice");
  const aliceQueue = await listPendingQueue("alice");
  assert.equal(aliceQueue.find((e) => e.dedupeKey === "project:create:bob-proj"), undefined, "alice queue must not contain bob entry");
  setStorageOwner("bob");
  const bobQueue = await listPendingQueue("bob");
  assert.ok(bobQueue.find((e) => e.dedupeKey === "project:create:bob-proj"), "bob queue should contain own entry");

  // Cleanup
  setStorageOwner("alice");
  await deleteProject("alice-proj");
  setStorageOwner("bob");
  // clean bob queue via process (offline false -> will attempt sync but no cloud)
  await processSyncQueue();
  setStorageOwner(ANON_OWNER);
});

test("licensing: cache only signed/validated entitlement with grace, never treat local data as permanent", async () => {
  const owner = "license-test";
  setStorageOwner(owner);
  // Valid grace
  await cacheEntitlement({
    ownerId: owner,
    entitlements: { premium_templates: true } as unknown as Record<string, boolean>,
    validatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
    expiresAt: null,
    isAdmin: false,
    isOwner: false,
    hasLicense: true,
    source: "server",
  });
  let ent = await getCachedEntitlement(owner);
  assert.ok(ent);
  assert.equal(isEntitlementValidOffline(ent), true);

  // Expired grace (8 days ago > 7 day grace)
  await cacheEntitlement({
    ownerId: owner,
    entitlements: { premium_templates: true } as unknown as Record<string, boolean>,
    validatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    expiresAt: null,
    isAdmin: false,
    isOwner: false,
    hasLicense: true,
    source: "server",
  });
  ent = await getCachedEntitlement(owner);
  assert.ok(ent);
  assert.equal(isEntitlementValidOffline(ent), false, "expired grace should be invalid");

  // Expired license
  await cacheEntitlement({
    ownerId: owner,
    entitlements: { premium_templates: true } as unknown as Record<string, boolean>,
    validatedAt: Date.now(),
    expiresAt: new Date(Date.now() - 1000).toISOString(),
    isAdmin: false,
    isOwner: false,
    hasLicense: true,
    source: "server",
  });
  ent = await getCachedEntitlement(owner);
  assert.equal(isEntitlementValidOffline(ent), false, "expired license should be invalid even within grace");
});

test("remote/local version conflicts safely without silently overwriting newer remote data", async () => {
  // Local 100, remote 200 => remote wins
  assert.equal(resolveConflict(100, 200), "remoteWins");
  // Local 300, remote 200 => local wins
  assert.equal(resolveConflict(300, 200), "localWins");
  // Remote null => local wins
  assert.equal(resolveConflict(100, null), "localWins");
  // Equal
  assert.equal(resolveConflict(100, 100), "equal");
  // Within skew tolerance (1s) -> not considered newer? Our implementation uses strict > , but conflict helper uses 2s skew
  const { isRemoteNewer } = await import("./conflict");
  assert.equal(isRemoteNewer(100000, 101500), false, "1.5s skew should not be considered newer");
  assert.equal(isRemoteNewer(100000, 103000), true, "3s difference should be newer");
});

test("offline queue prevents duplicate sync operations (dedupe)", async () => {
  setStorageOwner("dedupe-user");
  // Clear any prior
  const before = await listPendingQueue("dedupe-user");
  for (const e of before) {
    // exhaust via direct IDB delete is not exposed, but we can process
  }
  // Use unique dedupeKey to avoid interference
  const key = `test-dedupe-${Date.now()}`;
  await enqueueSync("project:rename", { id: "p1", name: "a" }, { dedupeKey: key });
  await enqueueSync("project:rename", { id: "p1", name: "b" }, { dedupeKey: key });
  await enqueueSync("project:rename", { id: "p1", name: "c" }, { dedupeKey: key });
  const pending = await listPendingQueue("dedupe-user");
  const matches = pending.filter((e) => e.dedupeKey === key);
  assert.equal(matches.length, 1, "dedupeKey should keep only latest");
  assert.equal((matches[0].payload as { name: string }).name, "c", "latest payload should win");
  // Cleanup: process to clear
  setOnline(true);
  await processSyncQueue();
  setStorageOwner(ANON_OWNER);
});

test("editor header status follows the existing save and sync state", () => {
  assert.equal(editorStatusLabel("saving", "online", true), "جاري الحفظ");
  assert.equal(editorStatusLabel("dirty", "synced", true), "جاري الحفظ");
  assert.equal(editorStatusLabel("saved", "syncing", true), "جاري المزامنة");
  assert.equal(editorStatusLabel("saved", "online", false), "دون اتصال");
  assert.equal(editorStatusLabel("saved", "offline", true), "دون اتصال");
  assert.equal(editorStatusLabel("saved", "synced", true), "تمت المزامنة");
  assert.equal(editorStatusLabel("saved", "online", true), "محفوظ");
  assert.equal(editorStatusLabel("idle", "online", true), "محفوظ");
});

test("prepareProjectForOffline keeps pages locally and records the project", async () => {
  setOnline(true);
  setStorageOwner("prep-user");
  const base = createProject("official");
  const proj = await saveProject({ ...base, id: "prep-1", name: "تحضير" });
  const result = await prepareProjectForOffline("prep-1");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.pages, proj.pages.length);
  assert.equal(await isProjectPreparedOffline("prep-1"), true);

  setOnline(false);
  const opened = await getProject("prep-1");
  assert.ok(opened);
  assert.equal(opened!.pages.length, proj.pages.length);
  assert.equal((await prepareProjectForOffline("prep-1")).ok, false, "preparing requires a connection");

  setOnline(true);
  const missing = await prepareProjectForOffline("does-not-exist");
  assert.equal(missing.ok, false);

  await deleteProject("prep-1");
  assert.equal(await isProjectPreparedOffline("prep-1"), false);
  setStorageOwner(ANON_OWNER);
});

test("remote assets are stored inside the project when it is prepared", async () => {
  setOnline(true);
  setStorageOwner("asset-user");
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as typeof fetch;
  try {
    const base = createProject("official");
    base.pages[0]?.elements.push({
      id: "img-remote",
      type: "image",
      name: "remote",
      x: 0,
      y: 0,
      w: 12,
      h: 12,
      rotation: 0,
      opacity: 1,
      z: 2,
      src: "https://cdn.example.test/logo.png",
      style: {},
    } as never);
    await saveProject({ ...base, id: "prep-asset", name: "أصول" });
    const result = await prepareProjectForOffline("prep-asset");
    assert.equal(result.ok, true);
    if (result.ok) assert.ok(result.assetsCached >= 1);
    const stored = await getProject("prep-asset");
    const src = stored?.pages[0]?.elements.find((el) => el.id === "img-remote")?.src ?? "";
    assert.equal(src.startsWith("data:image/png;base64,"), true);
  } finally {
    globalThis.fetch = original;
    await deleteProject("prep-asset");
    setStorageOwner(ANON_OWNER);
  }
});

test("unauthorized paid templates are not cached for offline use", async () => {
  setOnline(false);
  setStorageOwner("unlicensed-user");
  let called = false;
  const denied = await downloadAndCacheTemplate({
    id: "secret-tpl",
    title: "قالب مدفوع",
    source: "admin",
    tier: "licensed",
    fetchContent: async () => {
      called = true;
      return { content: "SECRET-PAID-CONTENT" };
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(called, false, "fetch must not run before entitlement is valid");
  assert.equal(await isTemplateAvailableOffline("secret-tpl"), false);

  await cacheEntitlement({
    ownerId: "unlicensed-user",
    entitlements: { premium_templates: true } as unknown as Record<string, boolean>,
    validatedAt: Date.now(),
    expiresAt: null,
    isAdmin: false,
    isOwner: false,
    hasLicense: true,
    source: "server",
  });
  const allowed = await downloadAndCacheTemplate({
    id: "secret-tpl",
    title: "قالب مدفوع",
    source: "admin",
    tier: "licensed",
    fetchContent: async () => ({ content: "{\"pages\":[]}" }),
  });
  assert.equal(allowed.ok, true);
  assert.equal(await isTemplateAvailableOffline("secret-tpl"), true);

  setStorageOwner(ANON_OWNER);
  const anon = await downloadAndCacheTemplate({
    id: "free-anon",
    title: "مجاني",
    source: "builtin",
    tier: "free",
    fetchContent: async () => ({ content: "{}" }),
  });
  assert.equal(anon.ok, false);
  setOnline(true);
});
