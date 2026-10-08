import assert from "node:assert/strict";
import test from "node:test";
import {
  cached,
  invalidateCache,
  invalidateCachePrefix,
  publicCacheSize,
  resetPublicCache,
} from "./public-cache.ts";

test("a cached value is served until the TTL expires", async () => {
  resetPublicCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return loads;
  };
  assert.equal(await cached("k", 60_000, loader), 1);
  assert.equal(await cached("k", 60_000, loader), 1, "second read is served from cache");
  assert.equal(loads, 1);
});

test("the entry expires after the TTL", async () => {
  resetPublicCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return loads;
  };
  assert.equal(await cached("k", 1, loader), 1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await cached("k", 1, loader), 2, "an expired entry is recomputed");
  assert.equal(loads, 2);
});

test("concurrent callers share one in-flight load (request deduplication)", async () => {
  resetPublicCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return loads;
  };
  const [a, b, c] = await Promise.all([
    cached("dedup", 60_000, loader),
    cached("dedup", 60_000, loader),
    cached("dedup", 60_000, loader),
  ]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(c, 1);
  assert.equal(loads, 1, "three simultaneous callers cost one load");
});

test("a rejected load is not cached and the next call retries", async () => {
  resetPublicCache();
  let attempts = 0;
  const loader = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("db down");
    return "ok";
  };
  await assert.rejects(cached("fail", 60_000, loader), /db down/);
  assert.equal(await cached("fail", 60_000, loader), "ok", "the failure was not memoized");
  assert.equal(attempts, 2);
});

test("invalidation drops exactly the named key", async () => {
  resetPublicCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return loads;
  };
  await cached("a", 60_000, loader);
  await cached("b", 60_000, loader);
  invalidateCache("a");
  await cached("a", 60_000, loader);
  assert.equal(loads, 3, "the invalidated key recomputed");
  invalidateCache("a");
  await cached("b", 60_000, loader);
  assert.equal(loads, 3, "the untouched key stayed cached");
});

test("prefix invalidation drops a whole family (template mutations)", async () => {
  resetPublicCache();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return loads;
  };
  await cached("templates:list", 60_000, loader);
  await cached("templates:meta:1", 60_000, loader);
  await cached("templates:meta:2", 60_000, loader);
  await cached("settings:site", 60_000, loader);
  invalidateCachePrefix("templates:");
  await cached("templates:list", 60_000, loader);
  await cached("templates:meta:1", 60_000, loader);
  await cached("settings:site", 60_000, loader);
  assert.equal(loads, 6, "the whole templates: family recomputed, settings stayed cached");
});

test("the store is bounded: key-varying callers cannot grow it without limit", async () => {
  resetPublicCache();
  const loader = async () => 1;
  // PUBLIC_CACHE_MAX_ENTRIES is 500; push well past it.
  for (let i = 0; i < 700; i += 1) {
    await cached(`spam:${i}`, 60_000, loader);
  }
  assert.ok(publicCacheSize() <= 500, `size ${publicCacheSize()} exceeds the cap`);
});
