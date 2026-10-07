import { useSyncExternalStore } from "react";
import { runPreSignInSignOut, runSignOut } from "../../../scripts/sign-out-plan.mjs";
import { GOOGLE_PROVIDER_ID, SOCIAL_PROVIDERS } from "./providers";
import { isLivePreviewHost } from "./preview-host";
import { authErrorMessage, type AuthErrorLike } from "./error-messages";
import {
  validateSignInInput,
  validateSignUpInput,
  type CredentialInput,
} from "./credentials";

/**
 * First-party auth client for this React SPA (browser-side).
 *
 * Talks to this app's OWN auth at same-origin `/api/auth/*` — no provider SDK,
 * no third-party identity hop. In the live preview the app is an embedded iframe
 * with PARTITIONED cookies, so after a popup sign-in it can't read the session
 * cookie — it authenticates with a bearer token instead (captured from the popup,
 * see `signIn`). Every request below attaches that token when present; when
 * deployed (cookie auth) no token is stored, so nothing changes.
 *
 * The session store is intentionally tiny: `/api/auth/get-session` is the single
 * source of truth, and `useSession()` (a `useSyncExternalStore` subscription)
 * exposes it to React. There is no client-side session state that could disagree
 * with the server — which is the bug class that used to render a signed-in
 * visitor as signed out (or vice versa).
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/** The upstream providers to render sign-in buttons for. */
export { SOCIAL_PROVIDERS };
export { GOOGLE_PROVIDER_ID };

// ── Session types (the JSON `/api/auth/get-session` returns) ──────────────────

export type AuthClientUser = {
  id: string;
  name: string | null;
  email: string;
  emailVerified?: boolean;
  image: string | null;
  createdAt?: string;
};

export type AuthClientSession = {
  id: string;
  userId?: string;
  expiresAt?: string;
};

export type SessionPayload = { user: AuthClientUser; session: AuthClientSession };

type AuthClientError = AuthErrorLike & { message?: string | null };

type ClientResult<T> = { data: T; error: null } | { data: null; error: AuthClientError };

/** Live-preview bearer token — the session, for a partitioned-cookie iframe. */
const BEARER_KEY = "grok-auth.bearer-token";

/** The stored preview bearer token, or null. */
export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

function setBearerToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Live previews run inside an iframe on Arena's `*.e2b.app` hosts (and older
 * `*.grok-sandbox.com` hosts). A full-page redirect to Google cannot complete
 * safely from that embedded context, so preview sign-in uses the popup flow.
 */
function inLivePreview(): boolean {
  return typeof window !== "undefined" && isLivePreviewHost(window.location.hostname);
}

// ── Transport ────────────────────────────────────────────────────────────────

type HttpResult = { ok: boolean; status: number; data: unknown };

async function authFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<HttpResult> {
  const headers = new Headers({ accept: "application/json" });
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const token = getBearerToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`/api/auth/${path}`, {
    method: init.method ?? "GET",
    // Same-origin in every real deployment; `include` keeps the cookie path
    // explicit for the embedded preview and for SPA-side fetches.
    credentials: "include",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

/** Turn a failed response body into the error shape the UI already understands. */
function toClientError(data: unknown, status: number): AuthClientError {
  const body = (data ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: body.code ? String(body.code) : null,
    message: body.message ? String(body.message) : null,
    status,
    statusText: null,
  };
}

// ── Session store ────────────────────────────────────────────────────────────

type SessionSnapshot = { data: SessionPayload | null; isPending: boolean };

const SERVER_SNAPSHOT: SessionSnapshot = { data: null, isPending: true };

let snapshot: SessionSnapshot = { data: null, isPending: authEnabled };
let fetchInFlight: Promise<void> | null = null;
let lastFetchedAt = 0;
const listeners = new Set<() => void>();

/** Refetch when a mount finds the store older than this (cheap freshness bound). */
const REFRESH_AFTER_MS = 30_000;

function publish(next: SessionSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function storeSession(data: SessionPayload | null): void {
  lastFetchedAt = Date.now();
  const changed =
    (data?.user?.id ?? null) !== (snapshot.data?.user?.id ?? null) ||
    (data?.session?.expiresAt ?? null) !== (snapshot.data?.session?.expiresAt ?? null) ||
    snapshot.isPending;
  if (changed) publish({ data, isPending: false });
}

/** Read the session from the server into the store. Coalesces concurrent calls. */
function refreshSession(force = false): Promise<void> {
  if (!authEnabled) return Promise.resolve();
  if (typeof window === "undefined") return Promise.resolve();
  if (fetchInFlight) return fetchInFlight;
  if (!force && lastFetchedAt && Date.now() - lastFetchedAt < REFRESH_AFTER_MS) {
    return Promise.resolve();
  }
  fetchInFlight = authFetch("get-session")
    .then(({ ok, data }) => {
      // A non-OK answer (e.g. 503 while identity storage is unreachable) must
      // NOT read as "signed out" — keep the last known session and let the next
      // probe decide. Rendering a signed-in visitor as signed out is the exact
      // failure this store exists to avoid.
      if (!ok) return;
      const payload = data as SessionPayload | null;
      storeSession(payload && payload.user ? payload : null);
    })
    .catch(() => {
      /* offline or aborted — keep the previous answer, `isPending` resolves below */
      if (snapshot.isPending) publish({ data: snapshot.data, isPending: false });
    })
    .finally(() => {
      fetchInFlight = null;
    });
  return fetchInFlight;
}

function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  void refreshSession();
  return () => {
    listeners.delete(listener);
  };
}

function sessionSnapshot(): SessionSnapshot {
  return snapshot;
}

function serverSessionSnapshot(): SessionSnapshot {
  return SERVER_SNAPSHOT;
}

// ── Session API ──────────────────────────────────────────────────────────────
//
// Three named exports, no client object: `useSession()` for React, `getSession()`
// for one-shot reads, `revokeSession()` for the server-side revoke. They all
// read the SAME store above, so a component and an imperative caller can never
// disagree about who is signed in.

/**
 * Current session + loading flag for React. `data === null` means loading OR
 * signed out — check `isPending` before treating it as signed out.
 */
export function useSession(): SessionSnapshot {
  // Unconditional on purpose: `authEnabled` is a module constant fixed at load,
  // so this call's position never changes between renders. With auth disabled
  // the store's own snapshot is `{ data: null, isPending: false }` and every
  // subscribe/refresh below is a no-op.
  return useSyncExternalStore(subscribeSession, sessionSnapshot, serverSessionSnapshot);
}

/** One-shot session read (used by the storage-owner bridge and sign-out). */
export async function getSession(): Promise<ClientResult<SessionPayload | null>> {
  if (!authEnabled) return { data: null, error: null };
  const { ok, status, data } = await authFetch("get-session");
  if (!ok) return { data: null, error: toClientError(data, status) };
  const payload = data as SessionPayload | null;
  const session = payload && payload.user ? payload : null;
  storeSession(session);
  return { data: session, error: null };
}

/**
 * Revoke the session server-side.
 *
 * Use `signOut()` below, NOT this — the raw call leaves the preview bearer token
 * in place and the visitor stays signed in.
 */
export async function revokeSession(): Promise<{ data: null; error: AuthClientError | null }> {
  try {
    const { ok, status, data } = await authFetch("sign-out", { method: "POST" });
    storeSession(null);
    if (!ok) return { data: null, error: toClientError(data, status) };
    return { data: null, error: null };
  } catch (error) {
    return {
      data: null,
      error: toClientError({ message: error instanceof Error ? error.message : null }, 0),
    };
  }
}

// ── Social (Google) sign-in ──────────────────────────────────────────────────

/** Message the popup posts back to the opener once sign-in completes. */
type PopupMessage = { source: "grok-auth-popup"; token: string | null; error?: string };

/**
 * Start direct Google sign-in.
 *
 * - **Live preview** (`*.e2b.app` / legacy `*.grok-sandbox.com` iframe): opens
 *   a popup to the preview handler and returns the session bearer token.
 * - **Deployed** (and local non-iframe): a normal full-page redirect to Google.
 *
 * Either way it clears any existing local session FIRST so switching providers
 * actually switches identity.
 */
export async function signIn(
  providerId: typeof GOOGLE_PROVIDER_ID,
  opts: { callbackURL?: string; errorCallbackURL?: string } = {},
): Promise<void> {
  const callbackURL = opts.callbackURL ?? "/";
  const errorCallbackURL = opts.errorCallbackURL ?? "/";

  // Open the popup SYNCHRONOUSLY on the user gesture — before any await
  // (including signOut). Awaiting first drops user-gesture privilege in some
  // browsers when the opener is a cross-origin live-preview iframe.
  const popup = inLivePreview() ? openSignInPopup(providerId) : null;

  // Clear any prior session so switching providers actually switches identity.
  // Bounded because the popup is already open — a request that never settles
  // would leave it hanging — but bounded PER ENVIRONMENT: only the server can
  // end a deployed session, so cutting it short at the preview's 1.5s would
  // start OAuth with the old session still live. The outgoing identity's local
  // state (library store, storage owner, licence cache) goes with it, so an
  // account switch can never carry the previous account's data over.
  await runPreSignInSignOut({
    livePreview: inLivePreview(),
    hasBearer: Boolean(getBearerToken()),
    requestSignOut: () => revokeSession(),
    clearToken: () => setBearerToken(null),
    clearLocalState: clearLocalIdentityState,
  });

  if (inLivePreview()) {
    if (!popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in");
    const token = await waitForPopupToken(popup);
    if (!token) throw new Error("Sign-in was cancelled or failed");
    setBearerToken(token);
    // Refresh the client session store with the bearer attached.
    // Avoid a full iframe reload when we're already on the destination — that
    // reload was the slow "still loading after the popup closed" feeling.
    try {
      await getSession();
    } catch {
      /* session store will recover on next useSession fetch */
    }
    // No reload below when we're already on the destination, so hand the new
    // identity to the client state explicitly: re-pin the storage owner and
    // reload whatever user-scoped data is on screen.
    await applyNewSessionToClientState();
    if (typeof window !== "undefined") {
      const dest = new URL(callbackURL, window.location.origin);
      const here = window.location;
      if (
        dest.origin !== here.origin ||
        dest.pathname !== here.pathname ||
        dest.search !== here.search
      ) {
        window.location.href = callbackURL;
      }
    }
    return;
  }

  const { ok, status, data } = await authFetch("sign-in/social", {
    method: "POST",
    body: { provider: providerId, callbackURL, errorCallbackURL },
  });
  if (!ok) {
    const message = toClientError(data, status).message ?? "تعذّر بدء تسجيل الدخول عبر Google.";
    throw new Error(message);
  }
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url === "string" && url) window.location.href = url;
  else throw new Error("تعذّر بدء تسجيل الدخول عبر Google.");
}

/**
 * Open `/auth/popup` in a new window. Must run synchronously inside the click
 * handler (no await before this). The path is served by the template Vite
 * plugin (`authPopupPlugin` in vite.config.ts) — NOT by a React route.
 *
 * Opens the real URL directly (not about:blank → assign). From a cross-origin
 * iframe the about:blank dance often fails on the first click and the window
 * ends up showing the app shell.
 */
function openSignInPopup(providerId: string): Window | null {
  const origin = window.location.origin;
  const url = `${origin}/auth/popup?providerId=${encodeURIComponent(providerId)}`;
  // Unique name per attempt so a prior attempt stuck on the SPA is not reused.
  const name = `grok-signin-${Date.now()}`;
  return window.open(url, name, "popup,width=500,height=650");
}

/**
 * Wait for the popup's completion page to postMessage the session bearer (or
 * for the user to dismiss the popup).
 */
function waitForPopupToken(popup: Window): Promise<string | null> {
  return new Promise((resolve) => {
    const origin = window.location.origin;
    let settled = false;
    let closeTimer: number | undefined;
    const settle = (token: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(token);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as PopupMessage | undefined;
      if (!data || data.source !== "grok-auth-popup") return;
      settle(data.token ?? null);
    };
    // Fallback when the user dismisses the popup. Grace period lets the
    // completion page's postMessage win over a racing `popup.closed`.
    const pollTimer = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(pollTimer);
      closeTimer = window.setTimeout(() => settle(null), 400);
    }, 300);
    function cleanup() {
      window.clearInterval(pollTimer);
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
      window.removeEventListener("message", onMessage);
    }
    window.addEventListener("message", onMessage);
  });
}

/**
 * Drop every piece of CLIENT state tied to the outgoing identity.
 *
 * The session clear alone is not enough: the editor library (projects, assets,
 * custom vectors) lives in Zustand + IndexedDB and the licence key cache in
 * localStorage, all of which outlive the session. This resets the storage
 * owner to signed-out — so persisted reads fail closed against the previous
 * account's rows — wipes the in-memory user-scoped store slices, and clears
 * the cached licence key. Best effort: a module that never loaded has no
 * state to clear, and the sign-out itself must not fail on a cache hiccup.
 */
async function clearLocalIdentityState(): Promise<void> {
  try {
    localStorage.removeItem("nasaq-last-owner");
  } catch {
    /* Storage can be unavailable in privacy-restricted browser contexts. */
  }
  try {
    const { ANON_OWNER, getStorageOwner, setStorageOwner } = await import(
      "@/lib/editor/storage-owner"
    );
    // Only an account session has user-scoped data in memory. For a
    // signed-out visitor (e.g. the pre-sign-in clear before a popup OAuth
    // they then CANCEL) the in-memory editor state is their own anonymous
    // work — resetting it would blank their canvas for nothing.
    const hadAccountData = getStorageOwner() !== ANON_OWNER;
    setStorageOwner(null);
    if (hadAccountData) {
      try {
        const { useEditor } = await import("@/lib/editor/store");
        useEditor.getState().resetUserScopedState();
      } catch {
        /* editor store never loaded on this page — nothing in memory to drop */
      }
    }
  } catch {
    /* owner registry unavailable — nothing to unpin */
  }
  try {
    // The cached licence key is account data (activation requires a session),
    // so it goes on every identity boundary — an account switch must never
    // offer the previous account's key.
    const { setCachedLicenseKey } = await import("@/lib/license/client");
    setCachedLicenseKey("");
  } catch {
    /* licence cache unavailable — nothing to clear */
  }
}

/**
 * Re-pin the storage owner to the NEW session and refresh any user-scoped
 * client state that is already on screen. Needed for the popup sign-in that
 * deliberately skips a page reload: without it the store would keep serving
 * the previous identity's (or the signed-out) library until the next reload.
 */
async function applyNewSessionToClientState(): Promise<void> {
  try {
    const { syncStorageOwner } = await import("./storage-owner-sync");
    await syncStorageOwner();
  } catch {
    /* owner sync unavailable — hydrate() re-attempts it on next mount */
  }
  try {
    const { useEditor } = await import("@/lib/editor/store");
    // hydrate() is identity-aware: it no-ops when the owner is unchanged and
    // resets + reloads the user-scoped slices when it is not.
    await useEditor.getState().hydrate();
  } catch {
    /* store unavailable on this page — nothing to refresh */
  }
}

/**
 * Sign out of THIS app's local session, clear the preview token, then redirect.
 *
 * Use this, never `revokeSession()` — the raw revoke leaves the preview bearer
 * token in place.
 * Sequencing lives in `scripts/sign-out-plan.mjs` so it can be unit-tested.
 *
 * The local identity clear (library store, storage owner, licence cache) runs
 * between the token clear and the redirect, so the signed-out page never
 * renders — even for a frame — with the previous account's data still live.
 *
 * **Rejects when deployed if the server never confirms.** There the session is
 * an HttpOnly cookie only the server can clear, so redirecting anyway would
 * report a sign-out that did not happen. `<UserButton />` handles that for you;
 * a hand-rolled control must catch it and let the visitor retry. In the live
 * preview the local clear is sufficient, so it always resolves.
 */
export async function signOut(redirectTo = "/"): Promise<void> {
  await runSignOut({
    livePreview: inLivePreview(),
    hasBearer: Boolean(getBearerToken()),
    requestSignOut: async () => {
      const { error } = await revokeSession();
      if (error) throw new Error(error.message ?? "Sign-out failed");
    },
    clearToken: () => setBearerToken(null),
    clearLocalState: clearLocalIdentityState,
    redirect: () => {
      window.location.href = redirectTo;
    },
  });
}

// ── Email + password ────────────────────────────────────────────────────────
// The primary account path: it needs no third-party provider, and the session it
// creates is the SAME session (cookie, or preview bearer token) the Google path
// issues — one session model, two doors.

/** Result of an email/password attempt. Failures always carry readable Arabic. */
export type EmailAuthResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export type EmailAuthInput = CredentialInput & {
  /** Where to continue after success. Site-internal path. */
  callbackURL?: string;
};

/** Field errors gathered before any request leaves the browser. */
function fieldErrorResult(errors: Record<string, string>, fallback: string): EmailAuthResult {
  const first = Object.values(errors).find(Boolean) ?? fallback;
  return { ok: false, message: first, fieldErrors: errors };
}

async function submitCredentials(
  path: "sign-up/email" | "sign-in/email",
  context: "sign-up" | "sign-in",
  body: Record<string, unknown>,
): Promise<EmailAuthResult> {
  try {
    const { ok, status, data } = await authFetch(path, { method: "POST", body });
    if (!ok) {
      return {
        ok: false,
        message: authErrorMessage(toClientError(data, status), context),
        fieldErrors: {},
      };
    }
    adoptSessionToken(data);
    await applyNewSessionToClientState();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: authErrorMessage(
        { message: err instanceof Error ? err.message : null },
        context,
      ),
      fieldErrors: {},
    };
  }
}

/**
 * Create an account with email + password.
 *
 * Order of operations, none of which may be skipped:
 *   validate in the browser → the server creates the account and a session →
 *   the storage owner is re-pinned to the NEW account → the caller navigates.
 *
 * Without the storage-owner step the visitor would land in the app with the
 * previous identity's (or the anonymous) library still pinned, which is exactly
 * the "my documents belong to someone else" class of bug.
 */
export async function signUpWithEmail(input: EmailAuthInput): Promise<EmailAuthResult> {
  if (!authEnabled) {
    return { ok: false, message: "تسجيل الدخول غير مُفعّل في هذه النسخة.", fieldErrors: {} };
  }
  const valid = validateSignUpInput(input);
  if (!valid.ok) {
    return fieldErrorResult(valid.errors, "تحقق من بيانات الحساب ثم أعد المحاولة.");
  }
  return submitCredentials("sign-up/email", "sign-up", {
    email: valid.value.email,
    password: valid.value.password,
    name: valid.value.name,
    callbackURL: input.callbackURL ?? "/",
  });
}

/** Sign in to an existing account with email + password. */
export async function signInWithEmail(input: EmailAuthInput): Promise<EmailAuthResult> {
  if (!authEnabled) {
    return { ok: false, message: "تسجيل الدخول غير مُفعّل في هذه النسخة.", fieldErrors: {} };
  }
  const valid = validateSignInInput(input);
  if (!valid.ok) {
    return fieldErrorResult(valid.errors, "أدخل البريد الإلكتروني وكلمة المرور.");
  }
  return submitCredentials("sign-in/email", "sign-in", {
    email: valid.value.email,
    password: valid.value.password,
    callbackURL: input.callbackURL ?? "/",
  });
}

/**
 * In the live preview the app is an embedded iframe with PARTITIONED cookies, so
 * the session cookie the auth response sets cannot be re-read on the next
 * request. The same response carries the session token; storing it keeps
 * email/password sign-in working there exactly like the popup OAuth path does.
 * Deployed (cookie auth) stores nothing.
 */
function adoptSessionToken(data: unknown): void {
  if (!inLivePreview()) return;
  const token = (data as { token?: unknown } | null)?.token;
  if (token) setBearerToken(String(token));
}
