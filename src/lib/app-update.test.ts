import assert from "node:assert/strict";
import test from "node:test";
import {
  DEV_BUILD_ID,
  IDLE_RELOAD_MS,
  isStaleBuild,
  normalizeBuildId,
  withCacheBuster,
} from "./app-update.ts";

test("a build id is only trusted when it is a real token", () => {
  assert.equal(normalizeBuildId("ed505d8-abc"), "ed505d8-abc");
  assert.equal(normalizeBuildId("  ed505d8  "), "ed505d8");
  assert.equal(normalizeBuildId(""), null);
  assert.equal(normalizeBuildId("   "), null);
  assert.equal(normalizeBuildId(DEV_BUILD_ID), null);
  assert.equal(normalizeBuildId(undefined), null);
  assert.equal(normalizeBuildId(42), null);
});

test("stale means both sides known and different", () => {
  assert.equal(isStaleBuild("a", "a"), false);
  assert.equal(isStaleBuild("a", "b"), true);
  // Unknown/absent information must never trigger a reload (offline, 404 on an
  // older deployment, a page that has not finished booting).
  assert.equal(isStaleBuild("dev", "a"), false);
  assert.equal(isStaleBuild("a", "dev"), false);
  assert.equal(isStaleBuild(null, "a"), false);
  assert.equal(isStaleBuild("a", null), false);
  assert.equal(isStaleBuild(undefined, undefined), false);
});

test("the reload URL cannot be answered from the old document's cache entry", () => {
  const next = withCacheBuster("https://nasaq-sa.vercel.app/editor", "abc123");
  assert.equal(next, "/editor?__v=abc123");
  const withQuery = withCacheBuster("https://nasaq-sa.vercel.app/editor?project=p1#p2", "abc123");
  assert.equal(withQuery, "/editor?project=p1&__v=abc123#p2");
});

test("cache busting is idempotent and never invents a version", () => {
  assert.equal(withCacheBuster("/editor?__v=old", "new"), "/editor?__v=new");
  assert.equal(withCacheBuster("/editor", "dev"), `/editor?__v=${DEV_BUILD_ID}`);
  assert.equal(withCacheBuster("/editor", undefined), `/editor?__v=${DEV_BUILD_ID}`);
});

test("the idle period is long enough to survive a gesture", () => {
  // A reload must never interrupt someone mid-drag: the guard waits far longer
  // than human gesture pauses, and every input event restarts the timer.
  assert.ok(IDLE_RELOAD_MS >= 10_000);
});
