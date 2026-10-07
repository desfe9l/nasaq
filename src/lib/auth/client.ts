import { createAuthClient } from "better-auth/react";
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
 * Better Auth client for this React SPA (browser-side).
 *
 * Talks to this app's OWN Better Auth at same-origin `/api/auth/*`. In the live
 * preview the app is an embedded iframe with PARTITIONED cookies, so after a
 * popup sign-in it can't read the session cookie — it authenticates with a
 * bearer token instead (captured from the popup, see `signIn`). The `onRequest`
 * hook attaches that token when present; when deployed (cookie auth) no token
 * is stored, so nothing changes.
 *
 * To sign out call `signOut()` below, NOT `authClient.signOut()`: the raw call
 * leaves the bearer token in place, and `onRequest` keeps re-attaching it, so
 * the visitor stays signed in.
 */
export const authClient = createAuthClient({
  fetchOptions: {
    onRequest(ctx) {
      const token = getBearerToken();
      if (token) ctx.headers.set("Authorization", `Bearer ${token}`);
      return ctx;
    },
  },
});

/**
 * True when sign-in UI should be shown — i.e. whenever `VITE_AUTH_ENABLED` is
 * not explicitly `"false"`. NASAQ's production configuration enables the real
 * Better Auth flow; local-only fallback behavior must never be treated as a
 * production account or persistence check.
 */
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

/** The upstream providers to render sign-in buttons for. */
export { SOCIAL_PROVIDERS };
export { GOOGLE_PROVIDER_ID };

// ── Live-preview bearer token ────────────────────────────────────────────────
// The embedded preview iframe has partitioned cookies, so we keep the session's
// bearer token in sessionStorage and attach it to every Better Auth request (and
// to server functions, via `@/lib/auth/middleware`). Empty everywhere except the
// preview after a popup sign-in, so the cookie path is untouched elsewhere.
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
  return (
    typeof window !== "undefined" &&
    isLivePreviewHost(window.location.hostname)
  );
}

/** Message the popup posts back to the opener once sign-in completes. */
type PopupMessage = { source: "grok-auth-popup"; token: string | null; error?: string };

/**
 * Start direct Google sign-in with Better Auth.
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
  // start OAuth with the old session still live. The outgoing identity's
  // local state (library store, storage owner, licence cache) goes with it,
  // so an account switch can never carry the previous account's data over.
  await runPreSignInSignOut({
    livePreview: inLivePreview(),
    hasBearer: Boolean(getBearerToken()),
    requestSignOut: () => authClient.signOut(),
    clearToken: () => setBearerToken(null),
    clearLocalState: clearLocalIdentityState,
  });

  if (inLivePreview()) {
    if (!popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in");
    const token = await waitForPopupToken(popup);
    if (!token) throw new Error("Sign-in was cancelled or failed");
    setBearerToken(token);
    // Refresh the client session store with the bearer attached (onRequest).
    // Avoid a full iframe reload when we're already on the destination — that
    // reload was the slow "still loading after the popup closed" feeling.
    try {
      await authClient.getSession();
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
      if (dest.origin !== here.origin || dest.pathname !== here.pathname || dest.search !== here.search) {
        window.location.href = callbackURL;
      }
    }
    return;
  }

  const { data, error } = await authClient.signIn.social({
    provider: providerId,
    callbackURL,
    errorCallbackURL,
  });
  if (error) throw new Error(error.message ?? "Sign-in failed");
  if (data?.url) window.location.href = data.url;
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
  try { localStorage.removeItem("nasaq-last-owner"); } catch {
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
 * Use this, never `authClient.signOut()` — see the note on `authClient`.
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
    // Better Auth resolves with `{ error }` instead of rejecting, so surface a
    // failed response as a rejection for the sequence to act on.
    requestSignOut: async () => {
      const { error } = await authClient.signOut();
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
// creates is the SAME signed cookie (or preview bearer token) the Google path
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
function fieldErrorResult(
  errors: Record<string, string>,
  fallback: string,
): EmailAuthResult {
  const first = Object.values(errors).find(Boolean) ?? fallback;
  return { ok: false, message: first, fieldErrors: errors };
}

/**
 * Create an account with email + password.
 *
 * Order of operations, none of which may be skipped:
 *   validate in the browser → Better Auth creates the `user` + `account` rows →
 *   a session is issued (autoSignIn) → the storage owner is re-pinned to the NEW
 *   account → the caller navigates.
 *
 * Without the storage-owner step the visitor would land in the app with the
 * previous identity's (or the anonymous) library still pinned, which is exactly
 * the "my documents belong to someone else" class of bug.
 */
export async function signUpWithEmail(input: EmailAuthInput): Promise<EmailAuthResult> {
  if (!authEnabled) {
    return {
      ok: false,
      message: "تسجيل الدخول غير مُفعّل في هذه النسخة.",
      fieldErrors: {},
    };
  }
  const valid = validateSignUpInput(input);
  if (!valid.ok) {
    return fieldErrorResult(valid.errors, "تحقق من بيانات الحساب ثم أعد المحاولة.");
  }
  try {
    const { data, error } = await authClient.signUp.email({
      email: valid.value.email,
      password: valid.value.password,
      name: valid.value.name,
      callbackURL: input.callbackURL ?? "/",
    });
    if (error) {
      return {
        ok: false,
        message: authErrorMessage(error as AuthErrorLike, "sign-up"),
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
        "sign-up",
      ),
      fieldErrors: {},
    };
  }
}

/** Sign in to an existing account with email + password. */
export async function signInWithEmail(input: EmailAuthInput): Promise<EmailAuthResult> {
  if (!authEnabled) {
    return {
      ok: false,
      message: "تسجيل الدخول غير مُفعّل في هذه النسخة.",
      fieldErrors: {},
    };
  }
  const valid = validateSignInInput(input);
  if (!valid.ok) {
    return fieldErrorResult(valid.errors, "أدخل البريد الإلكتروني وكلمة المرور.");
  }
  try {
    const { data, error } = await authClient.signIn.email({
      email: valid.value.email,
      password: valid.value.password,
      callbackURL: input.callbackURL ?? "/",
    });
    if (error) {
      return {
        ok: false,
        message: authErrorMessage(error as AuthErrorLike, "sign-in"),
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
        "sign-in",
      ),
      fieldErrors: {},
    };
  }
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
