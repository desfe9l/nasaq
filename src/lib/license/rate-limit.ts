/**
 * NASAQ — simple in-memory rate limiting.
 *
 * Prevents brute-force license key guessing, AI abuse and webhook flooding.
 * Uses a fixed-window counter per bucket (server-side only). Resets on process
 * restart — acceptable for serverless/preview, and every caller pairs it with a
 * check that does not depend on it (server-side licence verification, provider
 * sale verification, entitlement lookups).
 *
 * HARDENING NOTES
 *  • Buckets are keyed by whatever the caller passes; sensitive endpoints pass
 *    the VERIFIED user id (`rateLimitKey` in `@/lib/auth/request-ip`) rather
 *    than an IP alone, because a header-derived IP can be rotated.
 *  • Each entry remembers its own window, so expiry is per-bucket instead of
 *    assuming everyone used the default 60 s.
 *  • The size cap evicts the OLDEST buckets, never an arbitrary slice of the
 *    map: flooding distinct keys must not be able to evict a live counter and
 *    hand an attacker a fresh budget.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
  windowMs: number;
}

const store = new Map<string, RateLimitEntry>();

/** Hard ceiling on tracked buckets — an attacker must not grow this without bound. */
const MAX_ENTRIES = 5_000;
/** Buckets dropped per cleanup pass once the ceiling is hit. */
const EVICT_BATCH = 1_000;

let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000 && store.size <= MAX_ENTRIES) return; // once per minute
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now - entry.windowStart > entry.windowMs) store.delete(key);
  }
  if (store.size <= MAX_ENTRIES) return;
  // Oldest window first: a bucket that started longest ago is the closest to
  // expiring anyway, so evicting it costs the least and cannot be aimed at a
  // specific live counter.
  const oldest = [...store.entries()]
    .sort((a, b) => a[1].windowStart - b[1].windowStart)
    .slice(0, EVICT_BATCH);
  for (const [key] of oldest) store.delete(key);
}

/**
 * Check rate limit for a given action + bucket.
 * Returns true if allowed, false if rate-limited.
 *
 * @param action  - e.g. "license:activate", "license:validate"
 * @param ip      - client IP or identifier
 * @param limit   - max requests per window (default: 10)
 * @param windowMs - window duration in ms (default: 60000 = 1 min)
 */
export function checkRateLimit(
  action: string,
  ip: string,
  limit = 10,
  windowMs = 60_000,
): boolean {
  cleanup();
  const key = `${action}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > entry.windowMs) {
    store.set(key, { count: 1, windowStart: now, windowMs });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

/**
 * Get remaining attempts for display (optional).
 *
 * `_windowMs` is accepted for signature compatibility with `checkRateLimit` but
 * is not read: since each entry now stores the window it was created with, a
 * bucket's expiry is decided by its own window rather than by whatever window
 * the caller happens to pass here.
 */
export function getRemainingAttempts(
  action: string,
  ip: string,
  limit = 10,
  _windowMs = 60_000,
): number {
  const key = `${action}:${ip}`;
  const entry = store.get(key);
  if (!entry || Date.now() - entry.windowStart > entry.windowMs) return limit;
  return Math.max(0, limit - entry.count);
}

/** Test/maintenance hook: forget every bucket. */
export function resetRateLimits(): void {
  store.clear();
  lastCleanup = Date.now();
}
