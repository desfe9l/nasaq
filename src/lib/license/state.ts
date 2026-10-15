/**
 * The licence state machine, in one pure place.
 *
 * THREE callers derive UI state from the same server answer:
 *   · `useLicense()` — the live hook every screen reads;
 *   · `license-cache.ts` — the local snapshot painted before the server is heard
 *     from (Stale-While-Revalidate);
 *   · the editor store's background entitlement refresh.
 *
 * They must never disagree about what `{ hasLicense: true, entitlements }` means,
 * so the mapping lives here — dependency-free and unit-tested — instead of being
 * re-implemented per caller. The server's `LicenseStatusResult` is the only
 * input: this module never decides who is entitled to what, it only formats the
 * server's decision for the UI.
 */

import type {
  FeatureId,
  LicenseActivateResult,
  LicenseInfo,
  LicenseStatusResult,
} from "./types";
import { LICENSE_ENTITLEMENTS } from "./types";
import type { SessionEndReason } from "@/lib/auth/session-recovery";

/** What a licence consumer renders. Operations (`activate`, …) are the hook's. */
export interface LicenseState {
  /** Whether we're still loading the license from the server. */
  isLoading: boolean;
  /** Whether the user has a valid active license or administrator full access. */
  hasLicense: boolean;
  /** The administrator suspended this account, regardless of other licenses. */
  isSuspended?: boolean;
  /** True when access is granted by a verified administrator identity. */
  isAdmin: boolean;
  /** True when this account is the configured platform owner. */
  isOwner?: boolean;
  /** License info (null if no license, administrator, or loading). */
  license: LicenseInfo | null;
  /** Server-owned introductory trial, when the account is currently eligible. */
  trial: { startedAt: string; expiresAt: string } | null;
  /** Feature entitlements (empty object if no license). */
  entitlements: Record<FeatureId, boolean>;
  /** Error message from last operation. */
  error: string | null;
  /**
   * True when this state was painted from the local snapshot and the server has
   * not confirmed it yet. Purely informational: entitlements are the last ones
   * the SERVER resolved, never a local guess, and the background revalidation
   * replaces them (or ends the session) a moment later.
   */
  fromCache?: boolean;
}

/** What an account with no licence (and no trial) may do. */
export const EMPTY_ENTITLEMENTS: Record<FeatureId, boolean> = LICENSE_ENTITLEMENTS.FREE;

/** The loading state: nothing known yet. */
export const INITIAL_LICENSE_STATE: LicenseState = {
  isLoading: true,
  hasLicense: false,
  isAdmin: false,
  isOwner: false,
  license: null,
  trial: null,
  entitlements: EMPTY_ENTITLEMENTS,
  error: null,
};

/** The signed-out / no-licence state: known, and free-tier. */
export const UNLICENSED_STATE: LicenseState = {
  isLoading: false,
  hasLicense: false,
  isAdmin: false,
  isOwner: false,
  license: null,
  trial: null,
  entitlements: EMPTY_ENTITLEMENTS,
  error: null,
};

/**
 * Map a `GET /license-status` answer onto the UI state.
 *
 * Order matters and mirrors the server's precedence: owner/administrator full
 * access, then an active licence, then the introductory trial, then the
 * unlicensed view that keeps a lapsed licence visible (type + status) without
 * unlocking a single feature.
 */
export function licenseStateFromStatus(
  result: LicenseStatusResult,
  options: { fromCache?: boolean } = {},
): LicenseState {
  const fromCache = options.fromCache === true;
  if ((result.isOwner || result.isAdmin) && result.entitlements) {
    return {
      isLoading: false,
      hasLicense: true,
      isAdmin: Boolean(result.isAdmin),
      isOwner: Boolean(result.isOwner),
      license: null,
      trial: null,
      entitlements: result.entitlements,
      error: null,
      fromCache,
    };
  }
  if (result.trial && result.entitlements) {
    return {
      isLoading: false,
      hasLicense: true,
      isAdmin: false,
      isOwner: Boolean(result.isOwner),
      license: null,
      trial: result.trial,
      entitlements: result.entitlements,
      error: null,
      fromCache,
    };
  }
  if (result.hasLicense && result.license && result.entitlements) {
    return {
      isLoading: false,
      hasLicense: true,
      isAdmin: false,
      isOwner: Boolean(result.isOwner),
      license: result.license,
      trial: null,
      entitlements: result.entitlements,
      error: null,
      fromCache,
    };
  }
  return {
    isLoading: false,
    hasLicense: false,
    isAdmin: false,
    isOwner: Boolean(result.isOwner),
    isSuspended: result.isSuspended === true,
    license: result.license ?? null,
    trial: null,
    entitlements: EMPTY_ENTITLEMENTS,
    error: result.message ?? null,
    fromCache,
  };
}

/** Map a successful `activate` answer onto the UI state (null when it grants nothing). */
export function licenseStateFromActivation(
  result: LicenseActivateResult,
): LicenseState | null {
  if (!result.success || !result.license || !result.entitlements) return null;
  return {
    isLoading: false,
    hasLicense: true,
    isAdmin: false,
    isOwner: false,
    license: result.license,
    trial: null,
    entitlements: result.entitlements,
    error: null,
  };
}

/**
 * Whether this server answer CANCELS access — as opposed to merely lapsing it —
 * and therefore ends the session instead of downgrading it in place.
 *
 *   · a suspended account: an administrator cut the access off;
 *   · a revoked licence: the licence itself was cancelled.
 *
 * An EXPIRED licence (or a paid entitlement that ran out) deliberately does NOT
 * end the session: the person still has an account, they simply lose the paid
 * features — dropping them at a sign-in screen would be a worse experience than
 * the lapse, and no less secure, because the entitlements already fail closed.
 */
export function licenseRevocationReason(
  result: LicenseStatusResult | null | undefined,
): SessionEndReason | null {
  if (!result) return null;
  if (result.isSuspended === true) return "suspended";
  if (result.license?.status === "REVOKED") return "revoked";
  return null;
}

/** True when the state grants anything beyond the free tier. */
export function isLicensedState(state: LicenseState | null | undefined): boolean {
  if (!state) return false;
  return state.hasLicense === true && state.isSuspended !== true;
}

/**
 * Whether two licence states describe the same access. Used to skip a re-render
 * when a background revalidation confirms what was already on screen ("silent"
 * refresh), and to decide when a cached snapshot is worth persisting.
 */
export function sameLicenseAccess(a: LicenseState | null, b: LicenseState | null): boolean {
  if (!a || !b) return a === b;
  if (a.hasLicense !== b.hasLicense) return false;
  if (a.isAdmin !== b.isAdmin) return false;
  if (Boolean(a.isOwner) !== Boolean(b.isOwner)) return false;
  if (Boolean(a.isSuspended) !== Boolean(b.isSuspended)) return false;
  if ((a.license?.status ?? null) !== (b.license?.status ?? null)) return false;
  if ((a.license?.expiresAt ?? null) !== (b.license?.expiresAt ?? null)) return false;
  if ((a.trial?.expiresAt ?? null) !== (b.trial?.expiresAt ?? null)) return false;
  const keys = new Set([...Object.keys(a.entitlements), ...Object.keys(b.entitlements)]);
  for (const key of keys) {
    const feature = key as FeatureId;
    if (Boolean(a.entitlements[feature]) !== Boolean(b.entitlements[feature])) return false;
  }
  return true;
}
