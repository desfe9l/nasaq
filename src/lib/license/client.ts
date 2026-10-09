/**
 * NASAQ License — Client-side state and entitlements.
 *
 * The client NEVER trusts local state for feature access. It fetches
 * entitlements from the server and caches them for UX responsiveness.
 * localStorage is used ONLY for caching the license key (so the user
 * doesn't re-enter it every visit) — NOT as a source of truth.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { FeatureId, LicenseInfo, LicenseType } from "./types";
import { LICENSE_ENTITLEMENTS } from "./types";
import {
  activateLicenseFn,
  validateLicenseFn,
  getLicenseStatusFn,
  deactivateLicenseFn,
} from "./functions";

// ── Local Storage Cache (UX only, not source of truth) ─────────────────────

const LICENSE_KEY_CACHE = "nasaq.license-key";
const LICENSE_CHANGED = "nasaq:license-changed";

function notifyLicenseChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LICENSE_CHANGED));
}

/**
 * Force every licence consumer on the page to re-read from the server.
 *
 * Exported for the owner recovery: when ownership moves, the entitlement the
 * browser is holding was computed for the PREVIOUS owner id and nothing else
 * would make it stale — the hook refreshes on an interval, so without this the
 * owner stares at "no licence" for up to five minutes after a successful
 * migration and reasonably concludes it failed. It invalidates nothing else.
 */
export function refreshLicenseState(): void {
  notifyLicenseChanged();
}

export function getCachedLicenseKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(LICENSE_KEY_CACHE) ?? "";
  } catch {
    return "";
  }
}

export function setCachedLicenseKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    if (key) localStorage.setItem(LICENSE_KEY_CACHE, key);
    else localStorage.removeItem(LICENSE_KEY_CACHE);
  } catch {
    /* storage unavailable */
  }
}

// ── License State ──────────────────────────────────────────────────────────

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
}

const EMPTY_ENTITLEMENTS = LICENSE_ENTITLEMENTS.FREE;

const INITIAL_STATE: LicenseState = {
  isLoading: true,
  hasLicense: false,
  isAdmin: false,
  isOwner: false,
  license: null,
  trial: null,
  entitlements: EMPTY_ENTITLEMENTS,
  error: null,
};

// ── Hook: useLicense ───────────────────────────────────────────────────────

/**
 * Primary hook for accessing license state and performing license operations.
 *
 * Usage:
 *   const { hasLicense, license, entitlements, activate, isLoading } = useLicense();
 *   if (entitlements.advanced_export) { ... }
 */
export function useLicense(userId?: string, _userEmail?: string | null) {
  const { user, isPending } = useCurrentUserState();
  // Callers without an explicit id (templates / activation modal) still get
  // the current account's persisted license after reload. No id or email is
  // ever sent in a license request; the server verifies the session itself.
  const accountId = userId ?? user?.id;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const [state, setState] = useState<LicenseState>(INITIAL_STATE);

  // Validate on mount and periodically
  const validateCached = useCallback(async () => {
    if (!accountId) return;
    const cachedKey = getCachedLicenseKey();
    if (!cachedKey) {
      // No browser-cached key: the account-linked status (`checkUserLicense`,
      // always chained after this) is the only answer. Reporting "unlicensed"
      // here would flash FREE — and send a licensed account through the
      // unlicensed door — until the server replies a moment later.
      return;
    }

    try {
      const result = await validateLicenseFn({ data: { key: cachedKey } });
      if (accountRef.current !== accountId) return;
      if (result.valid && result.license && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          isAdmin: false,
          license: result.license,
          trial: null,
          entitlements: result.entitlements,
          error: null,
        });
      } else {
        // Invalid or expired — clear cache
        setCachedLicenseKey("");
        setState({
          isLoading: false,
          hasLicense: false,
          isAdmin: false,
          license: null,
          trial: null,
          entitlements: EMPTY_ENTITLEMENTS,
          error: null,
        });
      }
    } catch {
      if (accountRef.current === accountId) setState((s) => ({ ...s, isLoading: false }));
    }
  }, [accountId]);

  // Also check server status for user-linked licenses. The server resolves
  // the identity from the verified session — no client id is sent.
  const checkUserLicense = useCallback(async () => {
    if (!accountId) return;
    try {
      const result = await getLicenseStatusFn({ data: undefined });
      if (accountRef.current !== accountId) return;
      if ((result.isOwner || result.isAdmin) && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          isAdmin: Boolean(result.isAdmin),
          isOwner: Boolean(result.isOwner),
          license: null,
          trial: null,
          entitlements: result.entitlements,
          error: null,
        });
      } else if (result.trial && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          isAdmin: false,
          license: null,
          trial: result.trial,
          entitlements: result.entitlements,
          error: null,
        });
      } else if (result.hasLicense && result.license && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          isAdmin: false,
          license: result.license,
          trial: null,
          entitlements: result.entitlements,
          error: null,
        });
      } else {
        setState({ isLoading: false, hasLicense: false, isAdmin: false, isOwner: Boolean(result.isOwner),
          isSuspended: result.isSuspended === true,
          license: result.license ?? null, trial: null,
          entitlements: EMPTY_ENTITLEMENTS, error: result.message ?? null });
      }
    } catch {
      // Status unavailable: keep whatever the key-based validation resolved,
      // but never leave the caller waiting on a request that failed.
      if (accountRef.current === accountId) setState((s) => ({ ...s, isLoading: false }));
    }
  }, [accountId]);

  useEffect(() => {
    if (isPending || !accountId) {
      setState({ ...INITIAL_STATE, isLoading: isPending });
      return;
    }
    setState(INITIAL_STATE);
    void validateCached().then(checkUserLicense);
    const refresh = () => { void validateCached().then(checkUserLicense); };
    const interval = setInterval(refresh, 5 * 60 * 1000);
    window.addEventListener(LICENSE_CHANGED, refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener(LICENSE_CHANGED, refresh);
    };
  }, [isPending, accountId, validateCached, checkUserLicense]);

  /** Activate a license key. */
  const activate = useCallback(
    async (key: string): Promise<{ success: boolean; message: string }> => {
      if (!accountId) return { success: false, message: "سجّل الدخول لتفعيل الترخيص." };
      setState((s) => ({ ...s, error: null }));
      try {
        const result = await activateLicenseFn({ data: { key } });
        if (accountRef.current !== accountId) return { success: false, message: "تغيّر الحساب؛ أعد المحاولة." };
        if (result.success && result.license && result.entitlements) {
          setCachedLicenseKey(key);
          setState({ isLoading: false, hasLicense: true, isAdmin: false,
            license: result.license, trial: null, entitlements: result.entitlements, error: null });
          notifyLicenseChanged();
          return { success: true, message: result.message };
        }
        const message = result.success ? "تعذر التحقق من ميزات الترخيص." : result.message;
        setState((s) => ({ ...s, error: message }));
        return { success: false, message };
      } catch {
        const msg = "حدث خطأ أثناء تفعيل الترخيص.";
        if (accountRef.current === accountId) setState((s) => ({ ...s, error: msg }));
        return { success: false, message: msg };
      }
    },
    [accountId],
  );

  /** Deactivate (clear local license). */
  const deactivate = useCallback(async () => {
    const cachedKey = getCachedLicenseKey();
    if (cachedKey) {
      try {
        await deactivateLicenseFn({ data: { key: cachedKey } });
      } catch {
        /* Local clearing still lets the user remove this browser's cached key. */
      }
    }
    setCachedLicenseKey("");
    setState({
      isLoading: false,
      hasLicense: false,
      isAdmin: false,
      license: null,
      trial: null,
      entitlements: EMPTY_ENTITLEMENTS,
      error: null,
    });
    notifyLicenseChanged();
  }, []);

  const revalidate = useCallback(async () => {
    await validateCached();
    await checkUserLicense(); // also repairs historic paid keys with no browser-stored key
  }, [validateCached, checkUserLicense]);

  return { ...state, activate, deactivate, revalidate };
}

// ── Standalone Entitlement Check ───────────────────────────────────────────

/**
 * Check if a feature is available for a given license type.
 * Useful outside of the hook (e.g., in server-side logic or utility functions).
 */
export function hasEntitlement(
  licenseType: LicenseType,
  feature: FeatureId,
): boolean {
  return LICENSE_ENTITLEMENTS[licenseType][feature] ?? false;
}

/**
 * Get all entitlements for a license type.
 */
export function getEntitlements(licenseType: LicenseType): Record<FeatureId, boolean> {
  return LICENSE_ENTITLEMENTS[licenseType];
}
