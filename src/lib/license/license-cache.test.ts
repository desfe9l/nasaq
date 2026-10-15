/**
 * The locally cached licence answer.
 *
 * The instant paint this cache buys must never outlive the server's decision, so
 * the bounds are pinned here: only a server answer; only for the account it was
 * issued to; never a suspended or revoked state (not even for a frame); never a
 * licence or trial the answer itself says has ended; and nothing at all after the
 * grace window — after which the caller waits for the server, exactly as it did
 * before the cache existed.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  LICENSE_CACHE_MAX_AGE_MS,
  LICENSE_CACHE_PREFIX,
  cachedAdminHint,
  clearAllLicenseCaches,
  clearCachedLicenseStatus,
  isCachedLicenseStatusUsable,
  normalizeCachedLicenseStatus,
  readCachedLicenseEntry,
  readCachedLicenseState,
  readCachedLicenseStatus,
  writeCachedLicenseStatus,
  type CachedLicenseStatus,
} from "./license-cache.ts";
import { LICENSE_ENTITLEMENTS, type LicenseStatusResult } from "./types.ts";
import type { EnumerableStorageLike } from "@/lib/auth/session-cache";

function fakeStorage(): EnumerableStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as EnumerableStorageLike;
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

function proStatus(overrides: Partial<LicenseStatusResult> = {}): LicenseStatusResult {
  return {
    hasLicense: true,
    license: {
      id: "lic-1",
      type: "PRO",
      status: "ACTIVE",
      keyPrefix: "NASAQ-1",
      activatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-12-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    entitlements: LICENSE_ENTITLEMENTS.PRO,
    ...overrides,
  };
}

describe("normalizeCachedLicenseStatus", () => {
  it("accepts a well-formed entry, from a string or an object", () => {
    const entry: CachedLicenseStatus = { v: 1, userId: "user-1", savedAt: NOW, status: proStatus() };
    assert.deepEqual(normalizeCachedLicenseStatus(JSON.stringify(entry)), entry);
    assert.deepEqual(normalizeCachedLicenseStatus(entry), entry);
  });

  it("rejects anything that is not a licence answer of this schema", () => {
    assert.equal(normalizeCachedLicenseStatus(null), null);
    assert.equal(normalizeCachedLicenseStatus(""), null);
    assert.equal(normalizeCachedLicenseStatus("{oops"), null);
    assert.equal(normalizeCachedLicenseStatus({ v: 2, userId: "u", savedAt: NOW, status: proStatus() }), null);
    assert.equal(normalizeCachedLicenseStatus({ v: 1, userId: "", savedAt: NOW, status: proStatus() }), null);
    assert.equal(normalizeCachedLicenseStatus({ v: 1, userId: "u", savedAt: 0, status: proStatus() }), null);
    assert.equal(normalizeCachedLicenseStatus({ v: 1, userId: "u", savedAt: NOW, status: { isAdmin: true } }), null);
    assert.equal(normalizeCachedLicenseStatus({ v: 1, userId: "u", savedAt: NOW }), null);
  });
});

describe("isCachedLicenseStatusUsable", () => {
  const entry = (overrides: Partial<CachedLicenseStatus> = {}): CachedLicenseStatus => ({
    v: 1,
    userId: "user-1",
    savedAt: NOW,
    status: proStatus(),
    ...overrides,
  });

  it("trusts a fresh answer for the right account", () => {
    assert.equal(isCachedLicenseStatusUsable(entry(), NOW, "user-1"), true);
  });

  it("never trusts another account's entry", () => {
    assert.equal(isCachedLicenseStatusUsable(entry(), NOW, "user-2"), false);
  });

  it("never trusts a suspension or a revoked licence", () => {
    assert.equal(isCachedLicenseStatusUsable(entry({ status: proStatus({ isSuspended: true }) }), NOW, "user-1"), false);
    assert.equal(
      isCachedLicenseStatusUsable(
        entry({ status: proStatus({ license: { ...proStatus().license!, status: "REVOKED" } }) }),
        NOW,
        "user-1",
      ),
      false,
    );
  });

  it("never trusts access the answer itself says has ended", () => {
    const expired = entry({
      status: proStatus({ license: { ...proStatus().license!, expiresAt: "2026-01-01T00:00:00.000Z" } }),
    });
    assert.equal(isCachedLicenseStatusUsable(expired, NOW, "user-1"), false);
    const endedTrial = entry({
      status: { hasLicense: true, trial: { startedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z" }, entitlements: LICENSE_ENTITLEMENTS.TRIAL },
    });
    assert.equal(isCachedLicenseStatusUsable(endedTrial, NOW, "user-1"), false);
    // ...but an open-ended licence has no such end.
    const openEnded = entry({ status: proStatus({ license: { ...proStatus().license!, expiresAt: null } }) });
    assert.equal(isCachedLicenseStatusUsable(openEnded, NOW, "user-1"), true);
  });

  it("ages out after the grace window, in both clock directions", () => {
    assert.equal(isCachedLicenseStatusUsable(entry({ savedAt: NOW - LICENSE_CACHE_MAX_AGE_MS - 1 }), NOW, "user-1"), false);
    assert.equal(isCachedLicenseStatusUsable(entry({ savedAt: NOW + LICENSE_CACHE_MAX_AGE_MS + 1 }), NOW, "user-1"), false);
  });

  it("allows a free-tier answer to be cached too (no licence is an answer)", () => {
    const free = entry({ status: { hasLicense: false, entitlements: LICENSE_ENTITLEMENTS.FREE } });
    assert.equal(isCachedLicenseStatusUsable(free, NOW, "user-1"), true);
  });
});

describe("licence cache storage", () => {
  it("round-trips a server answer and maps it to the UI state", () => {
    const storage = fakeStorage();
    writeCachedLicenseStatus("user-1", proStatus(), NOW, storage);
    assert.equal(readCachedLicenseStatus("user-1", NOW, storage)?.hasLicense, true);
    const state = readCachedLicenseState("user-1", NOW, storage);
    assert.equal(state?.hasLicense, true);
    assert.equal(state?.isLoading, false);
    assert.equal(state?.fromCache, true);
    assert.equal(state?.entitlements.advanced_export, true);
  });

  it("keeps one entry per account", () => {
    const storage = fakeStorage();
    writeCachedLicenseStatus("user-1", proStatus(), NOW, storage);
    writeCachedLicenseStatus("user-2", { hasLicense: false, entitlements: LICENSE_ENTITLEMENTS.FREE }, NOW, storage);
    assert.equal(readCachedLicenseStatus("user-1", NOW, storage)?.hasLicense, true);
    assert.equal(readCachedLicenseStatus("user-2", NOW, storage)?.hasLicense, false);
  });

  it("clears instead of caching a suspension or a revocation", () => {
    const storage = fakeStorage();
    writeCachedLicenseStatus("user-1", proStatus(), NOW, storage);
    writeCachedLicenseStatus("user-1", proStatus({ isSuspended: true }), NOW, storage);
    assert.equal(readCachedLicenseStatus("user-1", NOW, storage), null);
    writeCachedLicenseStatus("user-1", proStatus(), NOW, storage);
    writeCachedLicenseStatus("user-1", proStatus({ license: { ...proStatus().license!, status: "REVOKED" } }), NOW, storage);
    assert.equal(readCachedLicenseStatus("user-1", NOW, storage), null);
  });

  it("sweeps EVERY account's snapshot at an identity boundary", () => {
    const storage = fakeStorage();
    writeCachedLicenseStatus("user-1", proStatus(), NOW, storage);
    writeCachedLicenseStatus("user-2", proStatus(), NOW, storage);
    storage.setItem("nasaq.license-key", "SOME-KEY");
    storage.setItem("nasaq-last-owner", "user-1");
    clearAllLicenseCaches(storage);
    assert.equal(readCachedLicenseStatus("user-1", NOW, storage), null);
    assert.equal(readCachedLicenseStatus("user-2", NOW, storage), null);
    // Only the licence snapshots are touched — the caller clears the rest.
    assert.equal(storage.getItem("nasaq.license-key"), "SOME-KEY");
    assert.equal(storage.getItem("nasaq-last-owner"), "user-1");
    assert.equal([...Array(storage.length).keys()].some((i) => storage.key(i)?.startsWith(LICENSE_CACHE_PREFIX)), false);
  });

  it("drops one account's snapshot on request", () => {
    const storage = fakeStorage();
    writeCachedLicenseStatus("user-1", proStatus(), NOW, storage);
    clearCachedLicenseStatus("user-1", storage);
    assert.equal(readCachedLicenseEntry("user-1", NOW, storage), null);
  });

  it("survives a storage that throws, and no storage at all", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      length: 0,
    } as unknown as EnumerableStorageLike;
    assert.equal(readCachedLicenseStatus("user-1", NOW, hostile), null);
    assert.doesNotThrow(() => writeCachedLicenseStatus("user-1", proStatus(), NOW, hostile));
    assert.doesNotThrow(() => clearAllLicenseCaches(hostile));
    assert.equal(readCachedLicenseStatus("user-1", NOW, null), null);
    assert.doesNotThrow(() => writeCachedLicenseStatus("user-1", proStatus(), NOW, null));
  });
});

/**
 * The DEFAULT storage path — the app never passes a storage object, so the
 * identity-boundary sweep (`clearAllLicenseCaches()`, called on every sign-out
 * and account switch) has to reach the browser's own `localStorage`. If it did
 * not, the next visitor on that browser would be shown the previous account's
 * plan.
 */
describe("the default storage (window.localStorage)", () => {
  const nodeRequire = createRequire(import.meta.url);
  let restore: (() => void) | null = null;

  before(async () => {
    const { JSDOM } = nodeRequire("jsdom") as {
      JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis };
    };
    const { window } = new JSDOM("<!doctype html><html></html>", { url: "https://nasaq.team/" });
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = window;
    restore = () => {
      (globalThis as { window?: unknown }).window = previous;
    };
  });

  after(() => {
    restore?.();
  });

  it("writes, reads and sweeps accounts through window.localStorage", () => {
    writeCachedLicenseStatus("user-1", proStatus());
    writeCachedLicenseStatus("user-2", proStatus());
    assert.ok(window.localStorage.getItem(`${LICENSE_CACHE_PREFIX}user-1`));
    assert.equal(readCachedLicenseStatus("user-1")?.hasLicense, true);
    assert.equal(cachedAdminHint("user-1"), false);
    clearAllLicenseCaches();
    assert.equal(window.localStorage.getItem(`${LICENSE_CACHE_PREFIX}user-1`), null);
    assert.equal(readCachedLicenseStatus("user-2"), null);
  });
});

describe("cachedAdminHint", () => {
  it("answers true only for a cached administrator or owner", () => {
    const storage = fakeStorage();
    writeCachedLicenseStatus("owner", { hasLicense: true, isOwner: true, entitlements: LICENSE_ENTITLEMENTS.PRO }, NOW, storage);
    writeCachedLicenseStatus("admin", { hasLicense: true, isAdmin: true, entitlements: LICENSE_ENTITLEMENTS.PRO }, NOW, storage);
    writeCachedLicenseStatus("user", proStatus(), NOW, storage);
    assert.equal(cachedAdminHint("owner", NOW, storage), true);
    assert.equal(cachedAdminHint("admin", NOW, storage), true);
    assert.equal(cachedAdminHint("user", NOW, storage), false);
  });

  it("answers null when nothing is known — the caller must wait, not assume", () => {
    const storage = fakeStorage();
    assert.equal(cachedAdminHint("nobody", NOW, storage), null);
    assert.equal(cachedAdminHint(null, NOW, storage), null);
    assert.equal(cachedAdminHint("", NOW, storage), null);
  });
});
