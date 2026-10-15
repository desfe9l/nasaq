/**
 * The locally cached LICENCE answer — the "stale" half of Stale-While-Revalidate
 * for entitlements (see `session-cache.ts` for the session's own snapshot).
 *
 * WHY THIS EXISTS
 *   `useLicense` used to begin every page in `isLoading: true` and wait for
 *   `getLicenseStatusFn`. That is a server round trip (and, for a Keygen-backed
 *   licence, a provider call behind it) standing between the visitor and the
 *   page they clicked — the workspace, the editor, the licence panel. The last
 *   answer the SERVER gave is written here, read back synchronously, and shown
 *   immediately; the background revalidation from `client.ts` replaces it (or
 *   ends the session) a moment later.
 *
 * WHAT IS TRUSTED, AND FOR HOW LONG
 *   Only an answer the server itself produced, and only within bounds:
 *   · `LICENSE_CACHE_MAX_AGE_MS` since the answer was received;
 *   · not suspended, not REVOKED — those are the two states that must never be
 *     painted as valid, not even for a frame;
 *   · a licence/trial whose recorded `expiresAt` has passed is not usable: the
 *     cached answer says "licensed" only until that moment.
 *   Anything else — corrupt JSON, another account's entry, a future schema
 *   version — is treated as MISSING, so the caller waits for the server exactly
 *   as it did before.
 *
 *   This file is NOT an authorisation layer. Every gated operation still runs
 *   through a server function that authenticates the session and resolves the
 *   entitlements again; the cache only decides what the UI can show without
 *   waiting.
 */

import type { LicenseStatusResult } from "./types";
import { licenseStateFromStatus, type LicenseState } from "./state";
import type { EnumerableStorageLike } from "@/lib/auth/session-cache";

/** One entry per account: the key carries the account id. */
export const LICENSE_CACHE_PREFIX = "nasaq.license-state.v1::";
/** Shape version stored inside the entry. */
export const LICENSE_CACHE_VERSION = 1;
/**
 * How long the snapshot may be painted. Matches the offline entitlement grace
 * (`src/lib/offline/entitlement-cache.ts`) so the two caches cannot disagree
 * about how long "recently verified" lasts.
 */
export const LICENSE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerance for a browser clock slightly ahead of the server's. */
export const LICENSE_EXPIRY_SKEW_MS = 60_000;

/** One cached licence answer, as persisted. */
export type CachedLicenseStatus = {
  v: number;
  userId: string;
  savedAt: number;
  status: LicenseStatusResult;
};

/** localStorage, or null when unavailable (SSR, private mode, blocked). */
export function licenseStorage(): EnumerableStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The localStorage key holding one account's cached licence answer. */
export function licenseCacheKey(userId: string): string {
  return `${LICENSE_CACHE_PREFIX}${String(userId ?? "").trim()}`;
}

function parseTimestamp(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse a stored entry. Pure (string or object in, object out) and the single
 * place the shape rules exist, so they can be unit-tested without a DOM.
 */
export function normalizeCachedLicenseStatus(value: unknown): CachedLicenseStatus | null {
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
  const entry = raw as Partial<CachedLicenseStatus>;
  if (Number(entry.v) !== LICENSE_CACHE_VERSION) return null;
  const savedAt = parseTimestamp(entry.savedAt);
  const userId = typeof entry.userId === "string" ? entry.userId.trim() : "";
  if (savedAt === null || !userId) return null;
  const status = entry.status as LicenseStatusResult | undefined;
  if (!status || typeof status !== "object") return null;
  if (typeof status.hasLicense !== "boolean") return null;
  return { v: LICENSE_CACHE_VERSION, userId, savedAt, status };
}

/** True when a stored timestamped expiry is still in the future. */
function expiryInFuture(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return true;
  const parsed = Date.parse(String(expiresAt));
  if (!Number.isFinite(parsed)) return false;
  return parsed - LICENSE_EXPIRY_SKEW_MS > now;
}

/**
 * The one rule deciding whether a stored licence answer may be painted before
 * the server has been heard from. Pure, and unit-tested rather than assumed.
 */
export function isCachedLicenseStatusUsable(
  cached: CachedLicenseStatus | null | undefined,
  now: number = Date.now(),
  expectedUserId?: string | null,
): boolean {
  if (!cached) return false;
  if (expectedUserId && cached.userId !== expectedUserId) return false;
  const age = now - cached.savedAt;
  if (age > LICENSE_CACHE_MAX_AGE_MS) return false;
  if (-age > LICENSE_CACHE_MAX_AGE_MS) return false;
  const status = cached.status;
  // The two states that must never be painted as valid.
  if (status.isSuspended === true) return false;
  if (status.license?.status === "REVOKED") return false;
  // Access that the cached answer itself says has ended.
  if (status.hasLicense && !status.isAdmin && !status.isOwner) {
    if (status.license && !expiryInFuture(status.license.expiresAt, now)) return false;
    if (!status.license && status.trial && !expiryInFuture(status.trial.expiresAt, now)) {
      return false;
    }
  }
  return true;
}

/**
 * Read one account's cached answer. `null` means "no local answer" — callers
 * must NOT read that as "unlicensed" unless they are willing to flash the free
 * tier (they are not; they wait for the server instead).
 */
export function readCachedLicenseStatus(
  userId: string,
  now: number = Date.now(),
  storage: EnumerableStorageLike | null = licenseStorage(),
): LicenseStatusResult | null {
  const cached = readCachedLicenseEntry(userId, now, storage);
  return cached?.status ?? null;
}

/** The cached entry (with its `savedAt`), or null. */
export function readCachedLicenseEntry(
  userId: string,
  now: number = Date.now(),
  storage: EnumerableStorageLike | null = licenseStorage(),
): CachedLicenseStatus | null {
  if (!storage || !userId) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(licenseCacheKey(userId));
  } catch {
    return null;
  }
  const cached = normalizeCachedLicenseStatus(raw);
  return isCachedLicenseStatusUsable(cached, now, userId) ? cached : null;
}

/** The cached answer already mapped to the UI state the hook renders. */
export function readCachedLicenseState(
  userId: string,
  now: number = Date.now(),
  storage: EnumerableStorageLike | null = licenseStorage(),
): LicenseState | null {
  const status = readCachedLicenseStatus(userId, now, storage);
  return status ? licenseStateFromStatus(status, { fromCache: true }) : null;
}

/**
 * Persist a server answer for this account. Best effort; never throws.
 *
 * A suspended or revoked answer is NOT cached as an entry: writing it would
 * only be re-read as "unusable" later, and leaving the previous (valid) entry
 * in place would be worse — so it is cleared instead.
 */
export function writeCachedLicenseStatus(
  userId: string,
  status: LicenseStatusResult | null | undefined,
  now: number = Date.now(),
  storage: EnumerableStorageLike | null = licenseStorage(),
): void {
  if (!storage) return;
  if (!userId || !status) {
    clearCachedLicenseStatus(userId, storage);
    return;
  }
  if (status.isSuspended === true || status.license?.status === "REVOKED") {
    clearCachedLicenseStatus(userId, storage);
    return;
  }
  const entry: CachedLicenseStatus = {
    v: LICENSE_CACHE_VERSION,
    userId,
    savedAt: now,
    status,
  };
  try {
    storage.setItem(licenseCacheKey(userId), JSON.stringify(entry));
  } catch {
    /* A full or blocked store costs the next page its instant paint, nothing more. */
  }
}

/** Drop one account's cached answer. */
export function clearCachedLicenseStatus(
  userId: string,
  storage: EnumerableStorageLike | null = licenseStorage(),
): void {
  if (!storage || !userId) return;
  try {
    storage.removeItem(licenseCacheKey(userId));
  } catch {
    /* Nothing to do: an unreadable store has no entry to drop. */
  }
}

/**
 * Drop EVERY account's cached answer — the identity boundary (sign-out, account
 * switch). Entitlement snapshots are account data: leaving them behind would let
 * the next visitor on this browser read the previous account's plan, and (worse)
 * paint it.
 */
export function clearAllLicenseCaches(
  storage: EnumerableStorageLike | null = licenseStorage(),
): void {
  if (!storage) return;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(LICENSE_CACHE_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      /* Best effort: one unremovable key must not stop the rest. */
    }
  }
}

/**
 * `true` when the cached answer says this account is an administrator or the
 * platform owner, `false` when it says an account exists but is neither, and
 * `null` when nothing is cached for it.
 *
 * Used ONLY to paint an admin surface before `amIAdmin()` answers; the server
 * check remains the authority and decides the final render, and every admin
 * server function re-checks the caller on its own.
 */
export function cachedAdminHint(
  userId: string | null | undefined,
  now: number = Date.now(),
  storage: EnumerableStorageLike | null = licenseStorage(),
): boolean | null {
  if (!userId) return null;
  const status = readCachedLicenseStatus(userId, now, storage);
  if (!status) return null;
  return status.isAdmin === true || status.isOwner === true;
}
