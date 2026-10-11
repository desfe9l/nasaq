/**
 * Regression tests for cloud-sync data-loss risks.
 *
 * Confirmed bugs (now fixed):
 * 1. pushCloudProject returned true for project:delete with no id.
 * 2. pushCloudProject returned true for project:create/update with missing id or pages.
 * Both caused queue entries to be removed without any server confirmation.
 *
 * Network failures, auth errors, 4xx/5xx server errors, timeouts, malformed
 * payloads, and conflicts must never be silently treated as successful sync.
 */
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { pushCloudProject } from "./cloud-sync";
import type { SyncQueueEntry } from "./sync-queue";
import { setStorageOwner } from "@/lib/editor/storage-owner";

const OWNER = "cloud-sync-regression-owner";

function makeEntry(overrides: Partial<SyncQueueEntry>): SyncQueueEntry {
  return {
    id: "entry-1",
    ownerId: OWNER,
    type: "project:create",
    dedupeKey: "project:create:test",
    payload: { id: "proj-1", pages: [{ id: "p1", elements: [] }] },
    createdAt: Date.now(),
    attempts: 0,
    generation: 1,
    ...overrides,
  };
}

test("project:delete with no id must not be silently acknowledged", async () => {
  setStorageOwner(OWNER);
  const entry = makeEntry({ type: "project:delete", payload: { updatedAt: Date.now() } });
  assert.equal(await pushCloudProject(entry), false, "malformed delete must return false");
});

test("project:create with no id must not be silently acknowledged", async () => {
  setStorageOwner(OWNER);
  const entry = makeEntry({ type: "project:create", payload: { pages: [], updatedAt: Date.now() } });
  assert.equal(await pushCloudProject(entry), false, "create with no id must return false");
});

test("project:update with no pages must not be silently acknowledged", async () => {
  setStorageOwner(OWNER);
  const entry = makeEntry({ type: "project:update", payload: { id: "proj-1", name: "test" } });
  assert.equal(await pushCloudProject(entry), false, "update without pages must return false");
});

test("network failure must not acknowledge queue entry", async () => {
  setStorageOwner(OWNER);
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
  try {
    const entry = makeEntry({ payload: { id: "proj-net", pages: [], updatedAt: Date.now() } });
    assert.equal(await pushCloudProject(entry), false, "network error must return false");
  } finally {
    globalThis.fetch = original;
  }
});

test("server 500 error must not acknowledge queue entry", async () => {
  setStorageOwner(OWNER);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("{}", { status: 500 }))) as typeof fetch;
  try {
    const entry = makeEntry({ payload: { id: "proj-500", pages: [], updatedAt: Date.now() } });
    assert.equal(await pushCloudProject(entry), false, "500 error must return false");
  } finally {
    globalThis.fetch = original;
  }
});

test("server 401 auth error must not acknowledge queue entry", async () => {
  setStorageOwner(OWNER);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("{}", { status: 401 }))) as typeof fetch;
  try {
    const entry = makeEntry({ type: "project:delete", payload: { id: "proj-401" } });
    assert.equal(await pushCloudProject(entry), false, "auth error must return false");
  } finally {
    globalThis.fetch = original;
  }
});

test("server ok:false must not acknowledge queue entry", async () => {
  setStorageOwner(OWNER);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 200 }))) as typeof fetch;
  try {
    const entry = makeEntry({ payload: { id: "proj-conflict", pages: [], updatedAt: Date.now() } });
    assert.equal(await pushCloudProject(entry), false, "ok:false must return false");
  } finally {
    globalThis.fetch = original;
  }
});

test("owner mismatch must not acknowledge queue entry", async () => {
  setStorageOwner("different-owner");
  const entry = makeEntry({ ownerId: OWNER });
  assert.equal(await pushCloudProject(entry), false, "owner mismatch must return false");
  setStorageOwner(OWNER);
});

test("AbortError (timeout) must not acknowledge queue entry", async () => {
  setStorageOwner(OWNER);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }))) as typeof fetch;
  try {
    const entry = makeEntry({ payload: { id: "proj-timeout", pages: [], updatedAt: Date.now() } });
    assert.equal(await pushCloudProject(entry), false, "AbortError must return false");
  } finally {
    globalThis.fetch = original;
  }
});

test("server ok:true is the ONLY condition that returns true", async () => {
  setStorageOwner(OWNER);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as typeof fetch;
  try {
    const entry = makeEntry({ payload: { id: "proj-ok", pages: [], updatedAt: Date.now() } });
    assert.equal(await pushCloudProject(entry), true, "only server ok:true should return true");
  } finally {
    globalThis.fetch = original;
  }
});
