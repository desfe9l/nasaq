/**
 * NASAQ License — Simple in-memory rate limiting.
 *
 * Prevents brute-force license key guessing and abuse.
 * Uses a sliding window counter per IP (server-side only).
 * Resets on process restart — acceptable for serverless/preview.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

/** Clean up expired entries periodically (max 1000 entries). */
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // once per minute
  lastCleanup = now;
  const cutoff = now - 60_000;
  for (const [key, entry] of store) {
    if (entry.windowStart < cutoff) store.delete(key);
  }
  // Safety cap
  if (store.size > 1000) {
    const keys = [...store.keys()];
    for (let i = 0; i < 500; i++) store.delete(keys[i]);
  }
}

/**
 * Check rate limit for a given action + IP.
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

  if (!entry || now - entry.windowStart > windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

/** Get remaining attempts for display (optional). */
export function getRemainingAttempts(
  action: string,
  ip: string,
  limit = 10,
  windowMs = 60_000,
): number {
  const key = `${action}:${ip}`;
  const entry = store.get(key);
  if (!entry || Date.now() - entry.windowStart > windowMs) return limit;
  return Math.max(0, limit - entry.count);
}
