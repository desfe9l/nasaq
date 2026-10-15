/**
 * The local session snapshot: what may be trusted, and for how long.
 *
 * These are the bounds that keep an instant first paint from becoming a lie —
 * a session the server would refuse (past its expiry), an entry that outlived
 * every decision about it (older than the cache ceiling), a corrupt chunk of
 * localStorage, or another account's shape.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  SESSION_CACHE_KEY,
  SESSION_CACHE_MAX_AGE_MS,
  SESSION_CACHE_VERSION,
  clearCachedSession,
  hasCachedSession,
  isCachedSessionUsable,
  normalizeCachedSession,
  readCachedSession,
  readCachedSessionEntry,
  writeCachedSession,
  type CachedSession,
  type SessionStorageLike,
} from "./session-cache.ts";
import type { SessionPayload } from "./client";

function fakeStorage(): SessionStorageLike & { key(i: number): string | null; length: number } {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as SessionStorageLike & { key(i: number): string | null; length: number };
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function payload(overrides: { expiresAt?: string; id?: string; email?: string } = {}): SessionPayload {
  const id = overrides.id ?? "user-1";
  return {
    user: {
      id,
      name: "فيصل",
      email: overrides.email ?? `${id}@example.com`,
      image: null,
      emailVerified: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    session: { id: "s1", userId: id, expiresAt: overrides.expiresAt ?? FAR_FUTURE },
  };
}

function entry(overrides: Partial<CachedSession> = {}): CachedSession {
  return {
    v: SESSION_CACHE_VERSION,
    savedAt: NOW,
    userId: "user-1",
    payload: payload(),
    ...overrides,
  };
}

describe("normalizeCachedSession", () => {
  it("accepts a well-formed entry, from a string or an object", () => {
    const fromObject = normalizeCachedSession(entry());
    const fromString = normalizeCachedSession(JSON.stringify(entry()));
    assert.equal(fromObject?.userId, "user-1");
    assert.deepEqual(fromString, fromObject);
  });

  it("rejects anything that is not a session of this schema version", () => {
    assert.equal(normalizeCachedSession(null), null);
    assert.equal(normalizeCachedSession(""), null);
    assert.equal(normalizeCachedSession("{ not json"), null);
    assert.equal(normalizeCachedSession(entry({ v: 99 })), null);
    assert.equal(normalizeCachedSession(entry({ savedAt: 0 })), null);
    // A blank `userId` falls back to the payload's own id rather than failing.
    assert.equal(normalizeCachedSession(entry({ userId: "  " }))?.userId, "user-1");
    // The payload must carry a user with an id and an address.
    assert.equal(
      normalizeCachedSession({ ...entry(), payload: { user: { id: "u", email: "" } } }),
      null,
    );
    assert.equal(normalizeCachedSession({ ...entry(), payload: undefined }), null);
  });
});

describe("isCachedSessionUsable", () => {
  it("trusts a fresh entry whose session has not expired", () => {
    assert.equal(isCachedSessionUsable(normalizeCachedSession(entry()), NOW), true);
  });

  it("refuses a session the server would already reject", () => {
    const expired = normalizeCachedSession(entry({ payload: payload({ expiresAt: "2026-01-01T00:00:00.000Z" }) }));
    assert.equal(isCachedSessionUsable(expired, NOW), false);
  });

  it("keeps a safety margin before the expiry, so a session about to end waits for the server", () => {
    const usable = (expiresAt: string) =>
      isCachedSessionUsable(
        normalizeCachedSession(entry({ payload: payload({ expiresAt }) })),
        NOW,
      );
    assert.equal(usable(new Date(NOW + 30_000).toISOString()), false);
    assert.equal(usable(new Date(NOW - 30_000).toISOString()), false);
    assert.equal(usable(new Date(NOW + 5 * 60_000).toISOString()), true);
  });

  it("ages out — a months-old snapshot cannot outlive its revocation", () => {
    const old = normalizeCachedSession(entry({ savedAt: NOW - SESSION_CACHE_MAX_AGE_MS - 1 }));
    assert.equal(isCachedSessionUsable(old, NOW), false);
    // An entry written by a clock that ran ahead is bounded too.
    const ahead = normalizeCachedSession(entry({ savedAt: NOW + SESSION_CACHE_MAX_AGE_MS + 1 }));
    assert.equal(isCachedSessionUsable(ahead, NOW), false);
  });

  it("an entry without an expiry is bounded by age alone", () => {
    const noExpiry = normalizeCachedSession({
      ...entry(),
      payload: { ...payload(), session: { id: "s1" } },
    });
    assert.equal(isCachedSessionUsable(noExpiry, NOW), true);
    assert.equal(isCachedSessionUsable(noExpiry, NOW + SESSION_CACHE_MAX_AGE_MS + 1), false);
  });
});

describe("cache storage", () => {
  it("round-trips through storage and drops the entry on clear", () => {
    const storage = fakeStorage();
    writeCachedSession(payload(), NOW, storage);
    assert.equal(readCachedSession(NOW, storage)?.user.id, "user-1");
    assert.equal(hasCachedSession(NOW, storage), true);
    clearCachedSession(storage);
    assert.equal(readCachedSession(NOW, storage), null);
    assert.equal(hasCachedSession(NOW, storage), false);
  });

  it("writing null clears — an identity boundary can never leave a stale account behind", () => {
    const storage = fakeStorage();
    writeCachedSession(payload(), NOW, storage);
    writeCachedSession(null, NOW, storage);
    assert.equal(storage.getItem(SESSION_CACHE_KEY), null);
  });

  it("does not store a payload without an account id", () => {
    const storage = fakeStorage();
    writeCachedSession({ user: { id: "", name: null, email: "x@y.z", image: null }, session: { id: "s" } }, NOW, storage);
    assert.equal(storage.getItem(SESSION_CACHE_KEY), null);
  });

  it("treats an unusable stored entry as MISSING, not as signed out", () => {
    const storage = fakeStorage();
    writeCachedSession(payload({ expiresAt: "2020-01-01T00:00:00.000Z" }), NOW, storage);
    assert.equal(readCachedSession(NOW, storage), null);
    assert.equal(readCachedSessionEntry(NOW, storage), null);
  });

  it("survives a storage that throws (private mode, quota, blocked cookies)", () => {
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
    } as unknown as SessionStorageLike;
    assert.equal(readCachedSession(NOW, hostile), null);
    assert.equal(hasCachedSession(NOW, hostile), false);
    assert.doesNotThrow(() => writeCachedSession(payload(), NOW, hostile));
    assert.doesNotThrow(() => clearCachedSession(hostile));
  });

  it("with no storage at all (SSR), every read is empty and every write is a no-op", () => {
    assert.equal(readCachedSession(NOW, null), null);
    assert.doesNotThrow(() => writeCachedSession(payload(), NOW, null));
    assert.doesNotThrow(() => clearCachedSession(null));
  });
});

/**
 * The DEFAULT storage path — a real `window.localStorage`, with no argument
 * passed.
 *
 * This is how the app actually calls the cache, and it is where a subtle bug
 * lived: the store passed an explicit `null` when clearing, so every write
 * landed in `localStorage` while the counterpart clear silently did nothing —
 * a session the server had disowned (or the visitor had signed out of) came
 * back on the next page load. Pinned here, against a browser-shaped global.
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

  it("writes, reads and CLEARS through window.localStorage when no store is passed", () => {
    writeCachedSession(payload(), NOW);
    assert.ok(window.localStorage.getItem(SESSION_CACHE_KEY), "the write must land in localStorage");
    assert.equal(readCachedSession(NOW)?.user.id, "user-1");
    assert.equal(hasCachedSession(NOW), true);
    clearCachedSession();
    assert.equal(window.localStorage.getItem(SESSION_CACHE_KEY), null, "the clear must reach it too");
    assert.equal(readCachedSession(NOW), null);
  });

  it("writing null with no store also clears", () => {
    writeCachedSession(payload(), NOW);
    writeCachedSession(null, NOW);
    assert.equal(window.localStorage.getItem(SESSION_CACHE_KEY), null);
  });
});
