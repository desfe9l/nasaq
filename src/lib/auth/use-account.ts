/**
 * Account hooks — the React surface of the account access layer.
 *
 *   · `useAccount()`        → profile + the live session + loading state
 *   · `useAccountAccess()`  → the above + server-resolved entitlements
 *
 * Use `useAccountAccess()` on any surface that gates a capability (AI, advanced
 * export, brand kit, premium templates). It never grants anything locally: the
 * entitlements are exactly what the server returned for THIS account id, and
 * server-side checks stay authoritative — this only decides what to show.
 *
 * The pure normalization lives in `./account` so it can be tested without React.
 */

import { useCurrentUserState } from "./use-current-user";
import { authEnabled, useSession } from "./client";
import { accountProfile, type AccountProfile, type AccountSession } from "./account";
import { useLicense } from "@/lib/license/client";
import type { FeatureId } from "@/lib/license/types";

export type { AccountProfile, AccountSession } from "./account";

export type AccountState = {
  profile: AccountProfile | null;
  session: AccountSession | null;
  /** True while the session is still resolving (don't treat null as signed out). */
  isPending: boolean;
};

/**
 * The signed-in account: profile + session + loading state.
 *
 * `profile` is null BOTH while the session loads and when signed out — read
 * `isPending` before treating null as "signed out" (see `use-current-user`).
 * With auth explicitly disabled (`VITE_AUTH_ENABLED=false`) the dev fallback is
 * reported with `isPending: false` and never a session.
 */
export function useAccount(): AccountState {
  const { user, isPending } = useCurrentUserState();
  // Both hooks are called unconditionally. `authEnabled` is a module constant
  // fixed at load, so the branch below cannot change the hook order — and with
  // auth disabled `useSession()` reports `{ data: null, isPending: false }`.
  const { data } = useSession();
  if (!authEnabled) {
    return { profile: accountProfile(user), session: null, isPending: false };
  }
  const session = data?.session;
  return {
    profile: accountProfile(user),
    session: session
      ? {
          id: String(session.id),
          expiresAt: (session as { expiresAt?: unknown }).expiresAt
            ? String((session as { expiresAt?: unknown }).expiresAt)
            : null,
        }
      : null,
    isPending,
  };
}

export type AccountAccess = AccountState & {
  /** Server-resolved entitlements for this account (empty when none). */
  entitlements: Record<FeatureId, boolean>;
  /** True while the licence lookup is still in flight. */
  entitlementsPending: boolean;
  /** Active licence or administrator access (never a local guess). */
  hasLicense: boolean;
  isAdmin: boolean;
  isSuspended: boolean;
};

/** Account + server-resolved entitlements, in one hook. */
export function useAccountAccess(): AccountAccess {
  const account = useAccount();
  const license = useLicense(account.profile?.id, account.profile?.email ?? null);
  return {
    ...account,
    entitlements: license.entitlements,
    entitlementsPending: license.isLoading,
    hasLicense: license.hasLicense,
    isAdmin: license.isAdmin,
    isSuspended: license.isSuspended === true,
  };
}
