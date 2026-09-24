import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { GOOGLE_PROVIDER_ID, authEnabled, signIn, signOut } from "./client";
import { hasGateSessionMarker } from "./gate-session-marker";
import { resolveSignInGateState } from "./sign-in-gate";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";

const subscribeToNothing = () => () => {};
const noGateSessionOnServer = () => false;

/**
 * Auth state components — plain wrappers around `useCurrentUserState()`.
 *
 * With auth on, visitors are signed out until they authenticate — in the sandbox
 * live preview too, which does real sign-in. The shared dev user appears only
 * when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
 * While the session is still resolving, gates that care about signed-out state
 * render nothing so there's no signed-out flash on hard reload.
 */

/** Where `RedirectToSignIn` sends signed-out visitors. Create this route. */
export const SIGN_IN_PATH = "/login";

/** Render children only when a user is present (real session, or the disabled-auth dev user). */
export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

/**
 * Render children only once we KNOW the visitor is signed out (`isPending` has
 * cleared and there is no user). Hidden while the session is still loading.
 */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

/**
 * Client-side redirect to the sign-in route (TanStack `<Navigate>` — NOT a full
 * `window.location` reload). A hard navigation re-bootstraps the SPA and re-runs
 * session loading, which feels like a second "Loading…" on /login.
 *
 * Guard routes by waiting out `isPending` first (see `use-current-user`), then
 * render this.
 */
export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function RequireSignedIn({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted">جارٍ التحقق…</div>;
  }
  if (!user) return <RedirectToSignIn />;
  return <>{children}</>;
}

export function SignInGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const state = resolveSignInGateState({ isPending, hasUser: user !== null });
  if (state === "pending") return null;
  if (state === "signed_in") return <>{children}</>;
  return <>{fallback ?? <SignInButtons />}</>;
}

export function SignInButtons({ callbackURL = "/" }: { callbackURL?: string } = {}) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(() => {
    if (typeof window === "undefined") return "idle";
    return new URLSearchParams(window.location.search).get("oauth") === "error"
      ? "error"
      : "idle";
  });

  const startGoogleSignIn = async () => {
    setState("loading");
    try {
      await signIn(GOOGLE_PROVIDER_ID, { callbackURL, errorCallbackURL: "/login?oauth=error" });
      setState("success");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <button
        type="button"
        onClick={() => void startGoogleSignIn()}
        disabled={state === "loading" || state === "success"}
        className="flex h-11 w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-800 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-70 dark:border-neutral-700 dark:bg-neutral-950 dark:text-white dark:hover:bg-neutral-900"
        aria-label="متابعة باستخدام Google"
      >
        <GoogleMark />
        <span>
          {state === "loading"
            ? "جارٍ فتح Google…"
            : state === "success"
              ? "تم تسجيل الدخول"
              : "متابعة باستخدام Google"}
        </span>
      </button>
      {state === "error" && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          أُلغي تسجيل الدخول أو تعذر إكماله. حاول مرة أخرى.
        </p>
      )}
      {state === "success" && (
        <p role="status" className="text-center text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          جارٍ إعادتك إلى NASAQ…
        </p>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" role="img">
      <path fill="#4285F4" d="M21.35 12.27c0-.7-.06-1.37-.18-2.02H12v3.83h5.23a4.47 4.47 0 0 1-1.94 2.93v2.44h3.14c1.84-1.7 2.92-4.2 2.92-7.18Z" />
      <path fill="#34A853" d="M12 21.6c2.63 0 4.84-.87 6.45-2.35l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.04H3.28v2.52A9.74 9.74 0 0 0 12 21.6Z" />
      <path fill="#FBBC05" d="M6.53 13.69a5.86 5.86 0 0 1 0-3.38V7.79H3.28a9.74 9.74 0 0 0 0 8.42l3.25-2.52Z" />
      <path fill="#EA4335" d="M12 6.27c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.39 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.72 5.39l3.25 2.52C7.3 7.99 9.46 6.27 12 6.27Z" />
    </svg>
  );
}

/**
 * Minimal signed-in identity chip + sign-out. Restyle freely (see the
 * `design-ui` skill). Sign-out is only shown when auth is enabled (the
 * disabled-auth dev user has nothing to sign out of) and the session is not
 * gate-materialized — behind the gate the next request signs the viewer
 * straight back in, so a sign-out control there is a broken loop.
 */
export function UserButton() {
  const user = useCurrentUser();
  // Sign-out can take a moment (and can fail when deployed), so the control
  // shows it is working and cannot be fired twice.
  const [signingOut, setSigningOut] = useState(false);
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    noGateSessionOnServer,
  );
  if (!user) return null;
  const label = user.displayName ?? user.primaryEmail ?? "Account";
  return (
    <div className="flex items-center gap-2">
      {user.profileImageUrl ? (
        <img
          src={user.profileImageUrl}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black/10 text-sm font-medium dark:bg-white/20">
          {label.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="text-sm font-medium">{label}</span>
      {authEnabled && !gateSession && (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            // Success navigates away; on failure re-enable so it can be retried.
            void signOut().catch(() => setSigningOut(false));
          }}
          className="cursor-pointer text-sm underline-offset-4 opacity-70 hover:underline disabled:cursor-wait disabled:no-underline"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      )}
    </div>
  );
}
