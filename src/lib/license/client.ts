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
  /** True when access is granted by a verified administrator identity. */
  isAdmin: boolean;
  /** License info (null if no license, administrator, or loading). */
  license: LicenseInfo | null;
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
  license: null,
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
      if (accountRef.current !== accountId) return;
      setState((s) => ({
        ...s,
        isLoading: false,
        hasLicense: false,
        isAdmin: false,
        license: null,
        entitlements: EMPTY_ENTITLEMENTS,
      }));
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
          license: null,
          entitlements: result.entitlements,
          error: null,
        });
      } else if (result.hasLicense && result.license && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          isAdmin: false,
          license: result.license,
          entitlements: result.entitlements,
          error: null,
        });
      } else {
        setState({ isLoading: false, hasLicense: false, isAdmin: false,
          license: result.license ?? null, entitlements: EMPTY_ENTITLEMENTS, error: null });
      }
    } catch {
      /* ignore — fallback to key-based validation */
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
            license: result.license, entitlements: result.entitlements, error: null });
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
      entitlements: EMPTY_ENTITLEMENTS,
      error: null,
    });
    notifyLicenseChanged();
  }, []);

  return { ...state, activate, deactivate, revalidate: validateCached };
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
