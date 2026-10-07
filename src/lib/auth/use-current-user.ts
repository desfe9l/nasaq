import { authEnabled, useSession } from "./client";

/** Normalized user shape used across the app, auth on or off. */
export type AppUser = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
  /** True when this is the sandbox/dev fallback (auth not configured). */
  isDevFallback: boolean;
  /**
   * Account creation time as reported by the auth session (ISO string), or
   * `null` for an identity that has none (the disabled-auth dev user).
   * Optional so every existing `AppUser` literal stays valid; a live session
   * always fills it. Read it through `@/lib/auth/account` for the normalized view.
   */
  createdAt?: string | null;
  /** Whether the account's email address is verified. */
  emailVerified?: boolean;
};

/**
 * Stable fallback user, used ONLY when auth is explicitly disabled
 * (`VITE_AUTH_ENABLED=false`) for local development. It is not a production
 * identity and must never substitute for a verified account. With auth on,
 * session state comes from this app's own auth API; embedded previews may use the bearer
 * token flow when cookie partitioning requires it.
 */
export const DEV_USER: AppUser = {
  id: "dev-user",
  displayName: "Dev User",
  primaryEmail: "dev@example.com",
  profileImageUrl: null,
  isDevFallback: true,
  createdAt: null,
  emailVerified: false,
};

/** `useCurrentUserState()` result: the user plus the session-loading flag. */
export type CurrentUserState = {
  /** The user — `null` BOTH while the session loads and when signed out. */
  user: AppUser | null;
  /** True while the session is still resolving — don't treat `user: null` as signed out yet. */
  isPending: boolean;
};

/**
 * Current user + loading state. Same behavior in live preview and when deployed:
 *   - Auth enabled -> the verified signed-in user; `user` is `null` while
 *                            the session resolves (`isPending: true`) and when
 *                            signed out (`isPending: false`). Session comes from
 *                            this app's `useSession()` → `/api/auth/get-session`
 *                            (cookie when deployed; bearer in a partitioned preview).
 *   - Auth disabled (`VITE_AUTH_ENABLED=false`) -> `DEV_USER`, never pending.
 *
 * Protect a route by waiting out `isPending` before acting on `user` —
 * redirecting on `user: null` alone bounces signed-in visitors to sign-in on
 * every hard reload:
 *
 *   import { RedirectToSignIn } from "@/lib/auth/gates";
 *   const { user, isPending } = useCurrentUserState();
 *   if (isPending) return null;              // still resolving — don't redirect yet
 *   if (!user) return <RedirectToSignIn />;  // definitely signed out
 *
 * `authEnabled` is a module-level constant fixed at load, so the guarded hook
 * call keeps a stable hook order across every render of a given component.
 */
export function useCurrentUserState(): CurrentUserState {
  // Unconditional hook call: `authEnabled` is a module constant fixed at load,
  // so the guard below can never change the hook order between renders.
  const { data, isPending } = useSession();
  if (!authEnabled) return { user: DEV_USER, isPending: false };
  const user = data?.user;
  return {
    user: user
      ? {
          id: user.id,
          displayName: user.name ?? null,
          primaryEmail: user.email ?? null,
          profileImageUrl: user.image ?? null,
          isDevFallback: false,
          // The session's own account fields — the same row the server verifies
          // against, so createdAt/emailVerified can never disagree with the DB.
          createdAt: (user as { createdAt?: unknown }).createdAt
            ? String((user as { createdAt?: unknown }).createdAt)
            : null,
          emailVerified: (user as { emailVerified?: unknown }).emailVerified === true,
        }
      : null,
    isPending,
  };
}

/**
 * Convenience view of `useCurrentUserState().user` for display (e.g.
 * `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
 * for redirects/guards use `useCurrentUserState()` and check `isPending`.
 */
export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
