/**
 * Stale-While-Revalidate for the session, end to end at the module level.
 *
 * `client.ts` is the wiring (transport, storage, React); the DECISIONS are in
 * `session-store.ts`, and these are the ones a subtle regression would turn into
 * a product bug — a loader where the account should be, a visitor signed out by
 * a 503, or a revoked session that keeps rendering the workspace:
 *
 *   · a cached session makes the FIRST snapshot signed-in and not pending;
 *   · subscribing fires the probe and returns without waiting for it;
 *   · an agreeing answer changes nothing on screen while refreshing the store;
 *   · ONLY a completed answer without a user signs anyone out, and that is the
 *     one case that announces a session end (which routes to sign-in);
 *   · failures keep the last known session; concurrent probes coalesce; probes
 *     inside the freshness window are skipped unless forced.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSessionStore, type SessionFetchResult } from "./session-store.ts";
import {
  SESSION_CACHE_KEY,
  readCachedSession,
  writeCachedSession,
  type SessionStorageLike,
} from "./session-cache.ts";
import type { SessionPayload } from "./client";

/** A `localStorage` stand-in, including the enumeration `clearAll*` sweeps need. */
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

const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function sessionPayload(overrides: {
  id?: string;
  name?: string;
  expiresAt?: string;
  emailVerified?: boolean;
} = {}): SessionPayload {
  const id = overrides.id ?? "user-1";
  return {
    user: {
      id,
      name: overrides.name ?? "فيصل العنزي",
      email: `${id}@example.com`,
      image: null,
      emailVerified: overrides.emailVerified ?? true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    session: { id: `session-${id}`, userId: id, expiresAt: overrides.expiresAt ?? FAR_FUTURE },
  };
}

type Harness = {
  store: ReturnType<typeof createSessionStore>;
  storage: ReturnType<typeof fakeStorage>;
  calls: () => number;
  ended: Array<{ reason: string; userId: string | null }>;
  clock: { now: number; advance: (ms: number) => void };
  answer: (result: SessionFetchResult | Error) => void;
};

/** A store wired to a fake transport, a fake storage and a fake clock. */
function harness(options: { seedCache?: SessionPayload | null; answer?: SessionFetchResult } = {}): Harness {
  const storage = fakeStorage();
  const clock = { now: 1_700_000_000_000, advance(ms: number) { this.now += ms; } };
  const ended: Array<{ reason: string; userId: string | null }> = [];
  let calls = 0;
  let queued: SessionFetchResult | Error = options.answer ?? { ok: true, data: sessionPayload() };
  if (options.seedCache) writeCachedSession(options.seedCache, clock.now, storage);
  const store = createSessionStore({
    enabled: true,
    storage,
    now: () => clock.now,
    fetchSession: async () => {
      calls += 1;
      if (queued instanceof Error) throw queued;
      return queued;
    },
    onSessionEnded: (reason, userId) => ended.push({ reason, userId }),
  });
  return {
    store,
    storage,
    calls: () => calls,
    ended,
    clock,
    answer: (result) => {
      queued = result;
    },
  };
}

describe("session store — the stale half", () => {
  it("paints the signed-in account on the FIRST snapshot when a cached session is usable", () => {
    const h = harness({ seedCache: sessionPayload() });
    const snapshot = h.store.snapshot();
    assert.equal(snapshot.isPending, false);
    assert.equal(snapshot.data?.user.id, "user-1");
    // The whole point: no request was needed to render the account.
    assert.equal(h.calls(), 0);
  });

  it("stays pending with no cached session — the guards wait, as before", () => {
    const h = harness();
    assert.deepEqual(h.store.snapshot(), { data: null, isPending: true });
  });

  it("ignores a cached session the server would already refuse (expired)", () => {
    const h = harness({ seedCache: sessionPayload({ expiresAt: "2020-01-01T00:00:00.000Z" }) });
    assert.deepEqual(h.store.snapshot(), { data: null, isPending: true });
  });

  it("never fetches anything with auth disabled", async () => {
    const h = harness({ seedCache: sessionPayload() });
    const store = createSessionStore({
      enabled: false,
      storage: h.storage,
      now: () => h.clock.now,
      fetchSession: async () => {
        throw new Error("must not be called");
      },
    });
    assert.deepEqual(store.snapshot(), { data: null, isPending: false });
    await store.revalidate(true);
    assert.equal(h.calls(), 0);
  });
});

describe("session store — the revalidation", () => {
  it("fires the probe on subscribe and returns without waiting for it", async () => {
    const h = harness({ seedCache: sessionPayload() });
    let notified = 0;
    h.store.subscribe(() => {
      notified += 1;
    });
    // Fired synchronously; the caller (React) is not blocked by the request.
    assert.equal(h.calls(), 1);
    assert.equal(notified, 0);
    await h.store.revalidate();
    assert.equal(h.store.snapshot().data?.user.id, "user-1");
  });

  it("resolves a pending first load when the probe throws, instead of hanging", async () => {
    const h = harness();
    h.answer(new Error("network down"));
    await h.store.revalidate(true);
    assert.deepEqual(h.store.snapshot(), { data: null, isPending: false });
  });

  it("coalesces concurrent probes into one request", async () => {
    const h = harness({ seedCache: sessionPayload() });
    const first = h.store.revalidate(true);
    const second = h.store.revalidate(true);
    assert.equal(h.calls(), 1);
    await Promise.all([first, second]);
    assert.equal(h.calls(), 1);
  });

  it("skips a probe inside the freshness window unless it is forced", async () => {
    const h = harness({ seedCache: sessionPayload() });
    await h.store.revalidate(true);
    assert.equal(h.calls(), 1);
    await h.store.revalidate();
    assert.equal(h.calls(), 1);
    h.clock.advance(61_000);
    await h.store.revalidate();
    assert.equal(h.calls(), 2);
    await h.store.revalidate(true);
    assert.equal(h.calls(), 3);
  });

  it("keeps the rendered session untouched when the answer agrees (silent refresh)", async () => {
    const seed = sessionPayload();
    const h = harness({ seedCache: seed });
    h.answer({ ok: true, data: sessionPayload() });
    const before = h.store.snapshot();
    const notifications: number[] = [];
    h.store.subscribe(() => notifications.push(h.clock.now));
    await h.store.revalidate();
    // Same identity, same expiry, same profile: the snapshot is the SAME object,
    // so React does not re-render and nothing on screen flickers.
    assert.equal(h.store.snapshot(), before);
    assert.equal(notifications.length, 0);
    // ...while the stored copy is refreshed with the server's own answer.
    assert.equal(readCachedSession(h.clock.now, h.storage)?.user.id, "user-1");
  });

  it("publishes a genuinely different answer (profile edit, new expiry) and rewrites the cache", async () => {
    const h = harness({ seedCache: sessionPayload() });
    const rotated = { ...sessionPayload(), session: { id: "session-user-1", userId: "user-1", expiresAt: "2099-06-01T00:00:00.000Z" } };
    h.answer({ ok: true, data: rotated });
    let notified = 0;
    h.store.subscribe(() => {
      notified += 1;
    });
    await h.store.revalidate();
    assert.equal(notified, 1);
    assert.equal(h.store.snapshot().data?.session.expiresAt, "2099-06-01T00:00:00.000Z");
    const cached = readCachedSession(h.clock.now, h.storage) as SessionPayload;
    assert.equal(cached.session.expiresAt, "2099-06-01T00:00:00.000Z");
  });
});

describe("session store — revocation", () => {
  it("signs the visitor out and announces it when the server disowns the session", async () => {
    const h = harness({ seedCache: sessionPayload() });
    h.answer({ ok: true, data: null });
    await h.store.revalidate(true);
    assert.deepEqual(h.store.snapshot(), { data: null, isPending: false });
    assert.deepEqual(h.ended, [{ reason: "expired", userId: "user-1" }]);
    // The next page load must not resurrect the dead session from the cache.
    assert.equal(readCachedSession(h.clock.now, h.storage), null);
  });

  it("announces nothing for a visitor who was simply signed out", async () => {
    const h = harness();
    h.answer({ ok: true, data: null });
    await h.store.revalidate(true);
    assert.deepEqual(h.ended, []);
    assert.deepEqual(h.store.snapshot(), { data: null, isPending: false });
  });

  it("never reads a failed request as signed out", async () => {
    const h = harness({ seedCache: sessionPayload() });
    h.answer({ ok: false, data: null });
    await h.store.revalidate(true);
    assert.equal(h.store.snapshot().data?.user.id, "user-1");
    assert.equal(h.store.snapshot().isPending, false);
    assert.deepEqual(h.ended, []);
    // The cache still holds the session, so the next page load is instant too.
    assert.equal(readCachedSession(h.clock.now, h.storage)?.user.id, "user-1");
  });

  it("does not announce a local clear (sign-out is not a revocation)", () => {
    const h = harness({ seedCache: sessionPayload() });
    h.store.set(null);
    assert.deepEqual(h.ended, []);
    assert.equal(h.storage.getItem(SESSION_CACHE_KEY), null);
  });

  it("announces once, even when the revocation answer is seen twice", async () => {
    const h = harness({ seedCache: sessionPayload() });
    h.answer({ ok: true, data: null });
    await h.store.revalidate(true);
    await h.store.revalidate(true);
    assert.equal(h.ended.length, 1);
  });
});

describe("session store — cross-document sharing", () => {
  it("adopts a session another tab wrote, with no request of its own", () => {
    const h = harness();
    assert.equal(h.store.snapshot().isPending, true);
    // Another document signed in and wrote the shared cache.
    writeCachedSession(sessionPayload({ id: "tab-2" }), h.clock.now, h.storage);
    h.store.adoptCached();
    assert.equal(h.store.snapshot().data?.user.id, "tab-2");
    assert.equal(h.store.snapshot().isPending, false);
    assert.equal(h.calls(), 0);
  });

  it("adopts another tab's sign-out silently (no revocation announcement)", () => {
    const h = harness({ seedCache: sessionPayload() });
    h.storage.removeItem(SESSION_CACHE_KEY);
    h.store.adoptCached();
    assert.deepEqual(h.store.snapshot(), { data: null, isPending: false });
    assert.deepEqual(h.ended, []);
  });
});
