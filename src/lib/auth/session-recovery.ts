/**
 * What happens when the server disowns a session this browser was showing.
 *
 * The background revalidation (`client.ts` → `refreshSession`) can come back with
 * a definitive "no session" while the page has already painted a signed-in
 * account from the local cache. That transition — NEVER the first load of a
 * visitor who was simply signed out — is a session that ended underneath the
 * user (revoked, expired, or suspended), and it must be acted on rather than
 * silently re-rendered as a signed-out view: the account's screens, its cached
 * project library and its licence panel are all still on screen.
 *
 * This module owns the decision and the announcement:
 *   · `notifySessionEnded` / `onSessionEnded` — a DOM event any surface can
 *     listen to (the root watcher ends the session and routes to sign-in);
 *   · `signInRedirectFor` — where the visitor goes, with the address they were
 *     on carried as `?redirect=`, and the two addresses that must NOT be
 *     redirected away (the sign-in and sign-up screens themselves).
 *
 * Every rule here is pure and import-free on purpose: it is unit-tested, and it
 * can be reasoned about without a browser.
 */

/** Where a signed-out visitor is sent — the same constant `gates.tsx` re-exports. */
export const SIGN_IN_PATH = "/login";

/** The account-creation screen. A session ending never yanks a visitor off it. */
export const SIGN_UP_PATH = "/signup";

/** Query parameter the sign-in screen reads to explain WHY it was reached. */
export const SESSION_ENDED_PARAM = "ended";

/** Why a session ended, for the sign-in screen's message and for diagnostics. */
export type SessionEndReason =
  /** The session was already past its expiry when the server was asked. */
  | "expired"
  /** The server no longer recognises the session (revoked, or a copied cookie). */
  | "revoked"
  /** An administrator suspended the account's access. */
  | "suspended";

/** Fired on the window whenever a locally trusted session is dropped or replaced. */
export const SESSION_CHANGED_EVENT = "nasaq:auth-changed";
/** Fired on the window when the server disowns a session this browser was showing. */
export const SESSION_ENDED_EVENT = "nasaq:session-ended";

export type SessionEndedDetail = {
  reason: SessionEndReason;
  /** The account the browser was showing, or `null` when it is not known. */
  userId: string | null;
};

/** Announce that the session the browser was showing is no longer valid. */
export function notifySessionEnded(
  reason: SessionEndReason,
  userId: string | null = null,
): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<SessionEndedDetail>(SESSION_ENDED_EVENT, {
        detail: { reason, userId },
      }),
    );
  } catch {
    /* A DOM without CustomEvent (tests, exotic embedders): nothing to announce to. */
  }
}

/** Subscribe to session-ended announcements. Returns the unsubscribe function. */
export function onSessionEnded(listener: (detail: SessionEndedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<SessionEndedDetail>).detail;
    listener({ reason: detail?.reason ?? "revoked", userId: detail?.userId ?? null });
  };
  window.addEventListener(SESSION_ENDED_EVENT, handler);
  return () => window.removeEventListener(SESSION_ENDED_EVENT, handler);
}

/** Normalize a pathname to its bare first segment (no query, no trailing slash). */
function normalizePath(pathname: string): string {
  const bare = String(pathname ?? "").split(/[?#]/, 1)[0] ?? "";
  if (!bare.startsWith("/")) return `/${bare}`.replace(/\/+$/, "") || "/";
  return bare.replace(/\/+$/, "") || "/";
}

/** True when an address IS the sign-in (or sign-up) screen — never redirected away. */
export function isAuthScreen(
  pathname: string,
  options: { signInPath?: string; skipPaths?: readonly string[] } = {},
): boolean {
  const bare = normalizePath(pathname);
  const signIn = normalizePath(options.signInPath ?? SIGN_IN_PATH);
  if (bare === signIn) return true;
  const skip = options.skipPaths ?? [SIGN_UP_PATH];
  return skip.some((path) => normalizePath(path) === bare);
}

/**
 * The sign-in address a disowned session is sent to, or `null` when the visitor
 * is already on an auth screen and only the local state needs clearing.
 *
 * The address they were on travels with them (`?redirect=…`), so signing back in
 * returns them to the page they were reading instead of the site's front door —
 * the same contract `RedirectToSignIn` uses for guarded routes.
 */
export function signInRedirectFor(
  current: string,
  options: {
    signInPath?: string;
    skipPaths?: readonly string[];
    /** Appended as `?ended=<reason>` so the sign-in screen can explain itself. */
    reason?: SessionEndReason | null;
  } = {},
): string | null {
  const signIn = normalizePath(options.signInPath ?? SIGN_IN_PATH);
  const raw = String(current ?? "");
  const search = raw.split("?", 2)[1] ?? "";
  // The address is normalized (absolute, no trailing slash) before it travels:
  // a caller passing `""` or a bare path must not produce an unusable redirect.
  const pathname = normalizePath(raw.split("?", 1)[0] ?? "");
  if (isAuthScreen(pathname, { ...options, signInPath: signIn })) return null;
  const params = new URLSearchParams();
  if (options.reason) params.set(SESSION_ENDED_PARAM, options.reason);
  params.set("redirect", `${pathname}${search ? `?${search}` : ""}`);
  return `${signIn}?${params.toString()}`;
}

/** Read the reason back out of a sign-in address (unknown values read as null). */
export function sessionEndedReasonFrom(
  search: string | URLSearchParams,
): SessionEndReason | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
  const reason = params.get(SESSION_ENDED_PARAM);
  return reason === "expired" || reason === "revoked" || reason === "suspended" ? reason : null;
}

/**
 * The plain-Arabic explanation the sign-in screen shows for an ended session —
 * or `null` when the visitor simply came here on their own.
 */
export function sessionEndedNotice(reason: SessionEndReason | null | undefined): string | null {
  if (reason === "expired") return "انتهت صلاحية جلستك. سجّل الدخول من جديد لمتابعة عملك.";
  if (reason === "revoked") return "أُنهيت جلستك بعد إلغاء الترخيص أو إبطال الجلسة. سجّل الدخول من جديد.";
  if (reason === "suspended") return "أوقفت الإدارة وصول هذا الحساب. تواصل مع الإدارة أو سجّل الدخول بحساب آخر.";
  return null;
}

/**
 * Read the destination back out of a sign-in address (`?redirect=`), accepting
 * only site-internal paths — the inverse of `signInRedirectFor`, and the rule
 * the sign-in page's own `validateSearch` applies.
 */
export function signInDestination(
  search: string | URLSearchParams,
  signInPath: string = SIGN_IN_PATH,
): string {
  const params =
    typeof search === "string" ? new URLSearchParams(search.replace(/^\?/, "")) : search;
  const redirect = params.get("redirect") ?? "";
  if (redirect.startsWith("/") && !redirect.startsWith("//")) return redirect;
  return signInPath;
}
