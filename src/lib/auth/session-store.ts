/**
 * The session store — Stale-While-Revalidate, as a plain module with no React
 * and no browser globals of its own.
 *
 * `client.ts` builds ONE of these with the real transport, the real
 * `localStorage` and the app's revocation announcer, and exposes it to React
 * through `useSyncExternalStore`. Everything that decides what the visitor sees
 * lives here instead, because these are the rules that silently break a product
 * when they are wrong:
 *
 *   · a cached session makes `isPending` false on the FIRST snapshot, so a
 *     guarded page paints the account instead of a loader;
 *   · a revalidation that agrees with what is on screen changes NOTHING (no
 *     re-render, no flash) while still refreshing the stored copy;
 *   · only a COMPLETED answer with no user signs anyone out — a 500, a 503, a
 *     dropped connection or a thrown fetch keeps the last known session, because
 *     "the identity service hiccuped" must never mean "you are signed out";
 *   · a session that the server disowns after this browser was showing an
 *     account is announced ONCE (`onSessionEnded`), which is what routes the
 *     visitor to sign-in — a visitor who was simply signed out announces
 *     nothing;
 *   · concurrent probes coalesce into one request, and a probe inside the
 *     freshness window is skipped unless forced, so navigating between pages
 *     never re-asks for the session.
 *
 * The clock, the storage and the transport are all injected, so the rules above
 * are unit-tested directly (`session-store.test.ts`) rather than inferred.
 */

import type { SessionPayload } from "./client";
import {
  clearCachedSession,
  readCachedSession,
  writeCachedSession,
  type SessionStorageLike,
} from "./session-cache";
import type { SessionEndReason } from "./session-recovery";

/** The subset of `/api/auth/get-session`'s transport result the store needs. */
export type SessionFetchResult = { ok: boolean; data: unknown };
export type SessionFetcher = () => Promise<SessionFetchResult>;

export type SessionSnapshot = { data: SessionPayload | null; isPending: boolean };

export type SessionStoreOptions = {
  /** Auth off (`VITE_AUTH_ENABLED=false`): always signed out, never pending. */
  enabled: boolean;
  /** Reads `/api/auth/get-session`. Never called more than the rules allow. */
  fetchSession: SessionFetcher;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Storage for the cached session (browser `localStorage`, or a fake). */
  storage?: SessionStorageLike | null;
  /** Freshness window; a probe inside it is skipped unless forced. */
  revalidateAfterMs?: number;
  /** Called once when a session this browser was showing is disowned by the server. */
  onSessionEnded?: (reason: SessionEndReason, userId: string | null) => void;
};

export type SessionStore = {
  /** React's `getSnapshot`: stable between publishes. */
  snapshot(): SessionSnapshot;
  /** React's `subscribe`: registers, and fires a background revalidation. */
  subscribe(listener: () => void): () => void;
  /** Background probe. Resolves when it settles; callers must not await it in a render. */
  revalidate(force?: boolean): Promise<void>;
  /** Adopt an answer (server, or a deliberate local clear). */
  set(data: SessionPayload | null, options?: { fromServer?: boolean }): void;
  /** Re-read the shared cache — another tab wrote it (sign-in/sign-out there). */
  adoptCached(): void;
  /** True while a probe is in flight (diagnostics/tests). */
  isFetching(): boolean;
};

/** The default freshness window: a confirmed session is reused for a minute. */
export const DEFAULT_REVALIDATE_AFTER_MS = 60_000;

function isSessionPayload(value: unknown): value is SessionPayload {
  const payload = value as SessionPayload | null;
  return Boolean(payload && typeof payload === "object" && payload.user && payload.user.id);
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const now = options.now ?? (() => Date.now());
  const revalidateAfterMs = options.revalidateAfterMs ?? DEFAULT_REVALIDATE_AFTER_MS;
  const listeners = new Set<() => void>();

  /*
   * `options.storage` is the injected store: `undefined` means "the module's own
   * default" (the browser's localStorage), `null` means "this environment has no
   * storage at all" — private mode, SSR, or a test that wants none.
   */
  const readStorage = (): SessionPayload | null =>
    options.storage === null ? null : readCachedSession(now(), options.storage);
  const writeStorage = (payload: SessionPayload | null): void => {
    if (options.storage === null) return;
    // `undefined` is passed straight through: it means "the module's own default
    // storage" (the browser's localStorage) — turning it into `null` here would
    // make the CLEAR a silent no-op while the WRITE went to localStorage, which
    // is exactly the bug this line exists to prevent.
    if (payload) writeCachedSession(payload, now(), options.storage);
    else clearCachedSession(options.storage);
  };

  /** The opening snapshot: the cached session when one is usable. */
  function openingSnapshot(): SessionSnapshot {
    if (!options.enabled) return { data: null, isPending: false };
    const cached = readStorage();
    return cached ? { data: cached, isPending: false } : { data: null, isPending: true };
  }

  let snapshot: SessionSnapshot = openingSnapshot();
  let fetchInFlight: Promise<void> | null = null;
  /** 0 while running on cached data, so the first subscriber probes immediately. */
  let lastAnsweredAt = 0;

  function publish(next: SessionSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  /** Everything a revalidation must compare before deciding anything changed. */
  function signature(data: SessionPayload | null): string {
    if (!data) return "";
    const { user, session } = data;
    return [
      user.id,
      user.email,
      user.name ?? "",
      user.image ?? "",
      user.emailVerified === true ? "1" : "0",
      session?.expiresAt ?? "",
    ].join("\u0000");
  }

  function set(data: SessionPayload | null, setOptions: { fromServer?: boolean } = {}): void {
    lastAnsweredAt = now();
    const previousUserId = snapshot.data?.user?.id ?? null;
    const changed = signature(data) !== signature(snapshot.data) || snapshot.isPending;
    writeStorage(data);
    if (changed) publish({ data, isPending: false });
    if (!data && previousUserId && setOptions.fromServer) {
      // The server disowned a session this browser was showing: revoked,
      // expired, or signed out elsewhere. Only a SERVER answer may say this.
      options.onSessionEnded?.("expired", previousUserId);
    }
  }

  async function revalidate(force = false): Promise<void> {
    if (!options.enabled) return;
    if (fetchInFlight) return fetchInFlight;
    if (!force && lastAnsweredAt && now() - lastAnsweredAt < revalidateAfterMs) return;
    const probe = (async () => {
      try {
        const { ok, data } = await options.fetchSession();
        // A non-OK answer is never "signed out": keep the last known session and
        // let the next probe decide.
        if (!ok) return;
        set(isSessionPayload(data) ? data : null, { fromServer: true });
      } catch {
        // Offline, aborted or a wedged request: keep what we have, but let a
        // pending first load resolve rather than hanging on the loader.
        if (snapshot.isPending) publish({ data: snapshot.data, isPending: false });
      } finally {
        fetchInFlight = null;
      }
    })();
    fetchInFlight = probe;
    return probe;
  }

  function adoptCached(): void {
    const cached = readStorage();
    const changed = signature(cached) !== signature(snapshot.data) || snapshot.isPending;
    if (changed) publish({ data: cached, isPending: false });
  }

  return {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      // Fired, never awaited: the subscriber's first render has already happened,
      // and with a cached session it already showed the signed-in account.
      void revalidate();
      return () => {
        listeners.delete(listener);
      };
    },
    revalidate,
    set,
    adoptCached,
    isFetching: () => fetchInFlight !== null,
  };
}
