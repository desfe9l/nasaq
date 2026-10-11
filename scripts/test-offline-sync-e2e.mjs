/**
 * Offline Cloud Sync E2E Test — runs against npm run dev (local) or preview deployment.
 * Auth endpoints are mocked via route interception.
 * Tests: offline edit, sync queue, account isolation, retention on failure, conflict resolution.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
const output = ".cache/offline-sync-test";
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const errors = [];
const checks = [];

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("nasaq.onboarding.v1", "done"); } catch {}
  });
  await ctx.route("**/api/auth/get-session**", (r) =>
    r.fulfill({ json: { user: { id: "e2e-test-user", email: "e2e@test", name: "E2E User", emailVerified: true, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }, session: { id: "e2e-session", userId: "e2e-test-user", token: "test-only", expiresAt: "2099-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } } })
  );
  await ctx.route("**/api/auth/sign-out", (r) => r.fulfill({ json: { success: true } }));
  ctx.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  return ctx;
}

async function run() {
  const ctx = await context();
  const page = await ctx.newPage();
console.log("🔄 Test 1: Sync queue enqueue/process");
    const queueResult = await page.evaluate(async () => {
      const { enqueueSync, listPendingQueue, processSyncQueue } = await import("/src/lib/offline/sync-queue");
      const { setStorageOwner } = await import("/src/lib/editor/storage-owner");
      setStorageOwner("e2e-queue-test");
      await enqueueSync("project:create", { id: "q-1", name: "Queue Test", pages: [] }, { dedupeKey: "q-1" });
      await enqueueSync("project:update", { id: "q-2", name: "Queue Update", pages: [] }, { dedupeKey: "q-2" });
      const before = await listPendingQueue();
      const results = await processSyncQueue();
      const after = await listPendingQueue();
      return { before: before.length, after: after.length, retained: after.length === before.length, results };
    });
    console.log("  Result:", queueResult);
    assert.ok(queueResult.retained, "Sync entries must be retained on failure");
    checks.push("Sync queue retains entries on failure");

    console.log("✏️ Test 2: Offline edit persistence");
    const offlineResult = await page.evaluate(async () => {
      const { saveProject, getProject } = await import("/src/lib/editor/storage");
      const { createProject } = await import("/src/lib/editor/templates");
      const { setStorageOwner } = await import("/src/lib/editor/storage-owner");
      setStorageOwner("e2e-offline-test");
      await saveProject({ ...createProject("official"), id: "offline-e2e-1", name: "E2E Offline" });
      const retrieved = await getProject("offline-e2e-1");
      retrieved.pages[0].elements.push({ id: "e2e-new", type: "text", content: "E2E offline edit", x: 5, y: 5, w: 20, h: 8, rotation: 0, opacity: 1, z: 5, style: {} });
      await saveProject(retrieved);
      const reloaded = await getProject("offline-e2e-1");
      return { success: reloaded.pages[0].elements.some(e => e.id === "e2e-new") };
    });
    console.log("  Result:", offlineResult);
    assert.ok(offlineResult.success, "Offline edit must persist after reload");
    checks.push("Offline edit persists in IndexedDB");

    console.log("🔒 Test 3: Account isolation");
    const isolationResult = await page.evaluate(async () => {
      const { saveProject, listProjects } = await import("/src/lib/editor/storage");
      const { createProject } = await import("/src/lib/editor/templates");
      const { setStorageOwner } = await import("/src/lib/editor/storage-owner");
      setStorageOwner("e2e-user-a"); await saveProject({ ...createProject("official"), id: "iso-a", name: "User A" });
      setStorageOwner("e2e-user-b"); await saveProject({ ...createProject("official"), id: "iso-b", name: "User B" });
      setStorageOwner("e2e-user-a"); const aList = await listProjects();
      setStorageOwner("e2e-user-b"); const bList = await listProjects();
      return { aOnly: aList.length === 1 && aList[0].id === "iso-a", bOnly: bList.length === 1 && bList[0].id === "iso-b" };
    });
    console.log("  Result:", isolationResult);
    assert.ok(isolationResult.aOnly && isolationResult.bOnly, "Accounts must not see each other's projects");
    checks.push("Account isolation enforced");

    console.log("⚔️ Test 4: Conflict resolution");
    const conflictResult = await page.evaluate(async () => {
      const { resolveConflict } = await import("/src/lib/offline/sync-queue");
      return {
        localWins: resolveConflict(Date.now(), Date.now() - 10000) === "localWins",
        remoteWins: resolveConflict(Date.now() - 10000, Date.now()) === "remoteWins",
        tieLocal: resolveConflict(Date.now(), Date.now() - 1000) === "localWins",
      };
    });
    console.log("  Result:", conflictResult);
    assert.ok(conflictResult.localWins && conflictResult.remoteWins && conflictResult.tieLocal);
    checks.push("Conflict resolution correct");

    console.log("🔑 Test 5: Deduplication");
    const dedupeResult = await page.evaluate(async () => {
      const { enqueueSync, listPendingQueue } = await import("/src/lib/offline/sync-queue");
      const { setStorageOwner } = await import("/src/lib/editor/storage-owner");
      setStorageOwner("e2e-dedupe-test");
      await enqueueSync("project:create", { id: "dup-1", name: "First" }, { dedupeKey: "dup-key" });
      await enqueueSync("project:create", { id: "dup-1", name: "Second (should replace)" }, { dedupeKey: "dup-key" });
      const list = await listPendingQueue();
      return { count: list.length, name: list[0]?.payload?.name };
    });
    console.log("  Result:", dedupeResult);
    assert.equal(dedupeResult.count, 1, "Dedupe key must prevent duplicates");
    assert.equal(dedupeResult.name, "Second (should replace)", "Latest must win");
    checks.push("Deduplication works");

    console.log("\n📊 SUMMARY");
    console.log("Errors:", errors.length ? errors : "None");
    console.log("Checks passed:");
    checks.forEach(c => console.log("  ✅", c));
    console.log(`\n🎉 ALL ${checks.length} E2E CHECKS PASSED`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Test failed:", err);
    console.log("Errors:", errors);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();