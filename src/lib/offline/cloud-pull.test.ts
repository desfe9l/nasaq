/**
 * Regression tests for the cloud → local pull (the half of sync that makes an
 * edit made in one session appear in another).
 *
 * Pinned behaviour:
 *   · anonymous owners never merge an account mirror;
 *   · a remote document lands locally when it is newer (or the only copy);
 *   · a local document that is as fresh or fresher is NEVER overwritten;
 *   · documents with a pending local push are skipped (they are mid-flight up);
 *   · a failed/absent endpoint degrades to "nothing changed", never an error.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { pullCloudProjects } from "./cloud-pull";
import { setStorageOwner, ANON_OWNER } from "@/lib/editor/storage-owner";
import { getProject } from "@/lib/editor/storage";

const OWNER = "pull-test-owner";

function remoteProject(id: string, updatedAt: number, name: string) {
  return {
    id,
    version: 3,
    updatedAt: new Date(updatedAt).toISOString(),
    payload: { id, name, pages: [{ id: "p1", elements: [] }], updatedAt },
  };
}

function mockMirror(projects: unknown[] | null, ok = true) {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    if (!projects) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(
      new Response(JSON.stringify({ ok, projects }), { status: ok ? 200 : 500 }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("anonymous owners never pull an account mirror", async () => {
  setStorageOwner(ANON_OWNER);
  const restore = mockMirror([remoteProject("anon-1", Date.now(), "x")]);
  try {
    const result = await pullCloudProjects();
    assert.equal(result.synced, false);
    assert.equal(result.changed, 0);
  } finally {
    restore();
  }
});

test("a newer remote document is merged into the local library", async () => {
  setStorageOwner(OWNER);
  const restore = mockMirror([remoteProject("pull-new", Date.now(), "remote doc")]);
  try {
    const result = await pullCloudProjects();
    assert.equal(result.synced, true);
    assert.equal(result.changed, 1);
    const local = await getProject("pull-new");
    assert.ok(local, "pulled document exists locally");
    assert.equal((local as { name?: string }).name, "remote doc");
  } finally {
    restore();
  }
});

test("an older remote copy never overwrites a fresher local document", async () => {
  setStorageOwner(OWNER);
  const now = Date.now();
  // Seed a local document that is NEWER than the remote copy. `putLocalProject`
  // seeds without enqueueing a push, so the skip-below is decided by the
  // timestamp comparison, not by the pending-queue guard.
  const { putLocalProject } = await import("@/lib/editor/storage");
  await putLocalProject({
    id: "pull-fresh",
    name: "local newer",
    pages: [{ id: "p1", elements: [] }],
    createdAt: now - 120_000,
    updatedAt: now,
  } as never);
  const restore = mockMirror([remoteProject("pull-fresh", now - 60_000, "stale remote")]);
  try {
    const result = await pullCloudProjects();
    assert.equal(result.changed, 0, "no overwrite of a fresher local document");
    const local = await getProject("pull-fresh");
    assert.equal((local as { name?: string }).name, "local newer");
  } finally {
    restore();
  }
});

test("a pending local push protects its document from the pull", async () => {
  setStorageOwner(OWNER);
  const { enqueueSync } = await import("./sync-queue");
  await enqueueSync("project:update", { id: "pull-busy", pages: [], updatedAt: Date.now() }, {
    dedupeKey: "project:update:pull-busy",
  });
  const restore = mockMirror([remoteProject("pull-busy", Date.now() + 5_000, "should skip")]);
  try {
    const result = await pullCloudProjects();
    assert.equal(result.changed, 0, "document mid-push is skipped");
  } finally {
    restore();
    const { clearQueueForOwner } = await import("./sync-queue");
    await clearQueueForOwner(OWNER);
  }
});

test("endpoint failure or non-ok answer changes nothing and does not throw", async () => {
  setStorageOwner(OWNER);
  let restore = mockMirror(null); // network error
  try {
    const result = await pullCloudProjects();
    assert.equal(result.synced, false);
    assert.equal(result.changed, 0);
  } finally {
    restore();
  }
  restore = mockMirror([], false); // HTTP 500
  try {
    const result = await pullCloudProjects();
    assert.equal(result.synced, false);
    assert.equal(result.changed, 0);
  } finally {
    restore();
  }
});
