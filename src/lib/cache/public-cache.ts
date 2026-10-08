/**
 * NASAQ — application-level cache for PUBLIC, non-personal reads.
 *
 * The public template catalog, builtin template states, published template
 * metadata and public site settings are read on every page view of /templates,
 * the homepage and every share render. Without a cache each view costs several
 * database queries (the catalog read also runs the idempotent seed checks), and
 * on a serverless runtime every query can pay a connection cost. This module is
 * the application's own answer — it does not rely on Vercel/edge caching.
 *
 * SAFETY RULES
 *
 *   · Only PUBLIC data may be cached here. Never put a per-user,
 *     authorization-sensitive or private payload through this cache: cache keys
 *     must encode the full scope of the data. (The licensed-template PAYLOAD
 *     fetch is deliberately NOT cached — it embeds a per-caller authorization
 *     decision.)
 *   · Concurrent identical loads are DEDUPLICATED: N simultaneous callers of
 *     the same key share one in-flight promise, so a page that mounts several
 *     components reading the same catalog pays for one query, not N.
 *   · Failures are never cached: a database blip must not blank the catalog
 *     for a whole TTL window.
 *   · The store is bounded (oldest entries evicted first) so a caller varying
 *     cache keys (e.g. `meta:<id>` per template) cannot grow it without limit.
 *   · The TTL is per entry, and the cache lives in process memory: on a
 *     serverless runtime each instance keeps its own copy, which is correct —
 *     a stale-for-TTL-seconds public catalog is an acceptable trade, and
 *     mutations invalidate immediately on the instance that performed them.
 */

import { PUBLIC_CACHE_MAX_ENTRIES } from "@/lib/policy/limits";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
/** In-flight loads, keyed the same way: deduplicates concurrent callers. */
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  if (store.size <= PUBLIC_CACHE_MAX_ENTRIES) return;
  // Oldest expiry first: the entry closest to expiring anyway costs the least
  // to drop, and a key-varying caller cannot aim the eviction at a live entry.
  const oldest = [...store.entries()]
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    .slice(0, store.size - PUBLIC_CACHE_MAX_ENTRIES);
  for (const [key] of oldest) store.delete(key);
}

/**
 * Read `key` from the cache, or compute it with `loader` and cache the result
 * for `ttlMs`. Concurrent callers share one load; a rejected load propagates
 * to every waiter and is NOT cached.
 */
export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const load = (async () => {
    try {
      const value = await loader();
      const entry: CacheEntry<T> = { value, expiresAt: Date.now() + Math.max(1, ttlMs) };
      store.set(key, entry);
      evictIfNeeded();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, load);
  return load;
}

/** Drop one cached key (called by the mutation that changed the data). */
export function invalidateCache(key: string): void {
  store.delete(key);
}

/** Drop every cached key with this prefix (e.g. `templates:` after an upsert). */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Test/maintenance hook: forget everything, including in-flight dedup state. */
export function resetPublicCache(): void {
  store.clear();
  inflight.clear();
}

/** Current entry count (diagnostics/tests). */
export function publicCacheSize(): number {
  return store.size;
}
