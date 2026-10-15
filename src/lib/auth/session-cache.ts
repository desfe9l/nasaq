/**
 * The locally cached session — the "stale" half of Stale-While-Revalidate.
 *
 * WHY THIS EXISTS
 *   The session used to be known only after `/api/auth/get-session` answered, so
 *   every page load (and every hard reload) opened on a loader: the request held
 *   the UI hostage for as long as the identity store needed. The fix is not a
 *   shorter request — it is to stop gating the FIRST PAINT on a network answer
 *   at all. The session the server already confirmed is written here, and the
 *   next page load reads it back synchronously and renders as signed in, while
 *   `client.ts` revalidates against the server in the background.
 *
 * WHAT IS STORED, AND WHY THAT IS SAFE
 *   Exactly the JSON `/api/auth/get-session` returns (`{ user, session }`) plus a
 *   timestamp and a version. That payload is not a credential: the session rides
 *   an HttpOnly `__Host-` cookie (or, in the embedded preview, the bearer token
 *   in `sessionStorage`), and it is the SERVER that decides whether a request is
 *   authorised — never this file. A user who edits this entry in devtools
 *   changes what their own browser renders and nothing else: every server
 *   function still authenticates the session on its own, and the first
 *   background revalidation replaces the edit with the server's answer (or ends
 *   the session outright).
 *
 * THE BOUNDS (all enforced in `isCachedSessionUsable`)
 *   · the cached session's own `expiresAt` must still be in the future (with a
 *     minute of clock skew), so a session the server would already refuse is
 *     never shown as live;
 *   · the entry ages out after `SESSION_CACHE_MAX_AGE_MS`, so a months-old
 *     snapshot cannot outlive every server-side decision that revoked it;
 *   · a malformed, truncated or older-versioned entry is treated as MISSING
 *     rather than "signed out" — the caller then waits for the server exactly as
 *     it did before.
 *
 * Storage access never throws out of this module: private mode, a disabled
 * localStorage or a quota error all degrade to "no cache", which is the
 * behaviour the app had before this file existed.
 */

import type { SessionPayload } from "./client";

/** Key holding the cached session. Versioned in the name so a shape change cannot bite. */
export const SESSION_CACHE_KEY = "nasaq.auth.session.v1";
/** Shape version stored inside the entry (a second guard on top of the key name). */
export const SESSION_CACHE_VERSION = 1;
/**
 * How long a cached session may be trusted for the INSTANT paint.
 *
 * The session itself slides for 30 days; this is deliberately shorter so a
 * browser that has not talked to the server in a month still opens the session
 * screen rather than an account it can no longer prove. Background
 * revalidation normally replaces the entry long before this matters.
 */
export const SESSION_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerance for a browser clock a little behind the server's. */
export const SESSION_EXPIRY_SKEW_MS = 60_000;

/** The minimal storage surface this module needs (browser `Storage` or a fake). */
export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A storage object that can also be enumerated. Used by the "drop every
 * account's cached entitlement" sweep (see `license-cache.ts`), where the keys
 * are discovered rather than known up front.
 */
export type EnumerableStorageLike = SessionStorageLike & Pick<Storage, "key" | "length">;

/** One cached session, as persisted. */
export type CachedSession = {
  /** Shape version — see `SESSION_CACHE_VERSION`. */
  v: number;
  /** `Date.now()` at the moment the server answer was written. */
  savedAt: number;
  /** The account id, hoisted out of the payload for cheap identity checks. */
  userId: string;
  /** The exact `/api/auth/get-session` body the server returned. */
  payload: SessionPayload;
};

/** localStorage, or null when it is unavailable (SSR, private mode, blocked). */
export function sessionStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseTimestamp(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse one stored entry into a `CachedSession`, or `null` when the value is
 * missing, unreadable, of another version, or not shaped like a session.
 *
 * Kept pure (string in, object out) so the rules can be tested without a DOM.
 */
export function normalizeCachedSession(value: unknown): CachedSession | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Partial<CachedSession>;
  if (Number(entry.v) !== SESSION_CACHE_VERSION) return null;
  const savedAt = parseTimestamp(entry.savedAt);
  if (savedAt === null) return null;
  const payload = entry.payload as SessionPayload | undefined;
  const userId = trimmed(entry.userId) || trimmed(payload?.user?.id);
  if (!userId) return null;
  if (!payload || typeof payload !== "object" || !payload.user) return null;
  const email = trimmed(payload.user.email);
  // An account without an address cannot be rendered or matched to a licence;
  // treat the entry as corrupt rather than inventing an identity.
  if (!payload.user.id || !email) return null;
  return {
    v: SESSION_CACHE_VERSION,
    savedAt,
    userId,
    payload: {
      user: { ...payload.user, id: String(payload.user.id), email },
      session: payload.session && typeof payload.session === "object" ? payload.session : { id: "" },
    },
  };
}

/** True when the cached session has not passed its own server-issued expiry. */
export function isCachedSessionWithinExpiry(
  cached: CachedSession,
  now: number = Date.now(),
): boolean {
  const expiresAt = cached.payload.session?.expiresAt;
  if (!expiresAt) {
    // No expiry on record: the age bound below is the only ceiling.
    return true;
  }
  const expires = Date.parse(String(expiresAt));
  if (!Number.isFinite(expires)) return false;
  return expires - SESSION_EXPIRY_SKEW_MS > now;
}

/**
 * The one rule that decides whether a stored session may be painted before the
 * server has been heard from. Exported (and pure) so it is unit-tested rather
 * than assumed: everything the app trusts a cache for passes through here.
 */
export function isCachedSessionUsable(
  cached: CachedSession | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!cached) return false;
  if (now - cached.savedAt > SESSION_CACHE_MAX_AGE_MS) return false;
  // A clock jumped backwards (or an entry written in the future) must not make
  // the bound unbounded.
  if (cached.savedAt - now > SESSION_CACHE_MAX_AGE_MS) return false;
  return isCachedSessionWithinExpiry(cached, now);
}

/**
 * Read the cached entry. Returns `null` for a missing, unusable or corrupt
 * entry — callers must treat that as "no local answer", never as "signed out".
 */
export function readCachedSessionEntry(
  now: number = Date.now(),
  storage: SessionStorageLike | null = sessionStorage(),
): CachedSession | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_CACHE_KEY);
  } catch {
    return null;
  }
  const cached = normalizeCachedSession(raw);
  return isCachedSessionUsable(cached, now) ? cached : null;
}

/** The cached session payload, ready to hand to the store, or `null`. */
export function readCachedSession(
  now: number = Date.now(),
  storage: SessionStorageLike | null = sessionStorage(),
): SessionPayload | null {
  return readCachedSessionEntry(now, storage)?.payload ?? null;
}

/** Persist the session the server just confirmed. Best effort; never throws. */
export function writeCachedSession(
  payload: SessionPayload | null | undefined,
  now: number = Date.now(),
  storage: SessionStorageLike | null = sessionStorage(),
): void {
  if (!storage) return;
  const userId = trimmed(payload?.user?.id);
  if (!payload?.user || !userId) {
    clearCachedSession(storage);
    return;
  }
  const entry: CachedSession = {
    v: SESSION_CACHE_VERSION,
    savedAt: now,
    userId,
    payload,
  };
  try {
    storage.setItem(SESSION_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* A full or blocked store costs the next page its instant paint, nothing more. */
  }
}

/** Drop the cached session (sign-out, identity switch, server said "no session"). */
export function clearCachedSession(storage: SessionStorageLike | null = sessionStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* Nothing to do: an unreadable store has no entry to drop. */
  }
}

/** The account id in the cached session, or null. Cheap identity probe. */
export function cachedSessionUserId(
  now: number = Date.now(),
  storage: SessionStorageLike | null = sessionStorage(),
): string | null {
  return readCachedSessionEntry(now, storage)?.userId ?? null;
}

/** True when a usable cached session is on hand (i.e. the UI can paint immediately). */
export function hasCachedSession(
  now: number = Date.now(),
  storage: SessionStorageLike | null = sessionStorage(),
): boolean {
  return readCachedSessionEntry(now, storage) !== null;
}
