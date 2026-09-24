/**
 * NASAQ License — Client-side state and entitlements.
 *
 * The client NEVER trusts local state for feature access. It fetches
 * entitlements from the server and caches them for UX responsiveness.
 * localStorage is used ONLY for caching the license key (so the user
 * doesn't re-enter it every visit) — NOT as a source of truth.
 */

import { useState, useEffect, useCallback } from "react";
import type { FeatureId, LicenseInfo, LicenseType } from "./types";
import { LICENSE_ENTITLEMENTS } from "./types";
import {
  activateLicenseFn,
  validateLicenseFn,
  getLicenseStatusFn,
  deactivateLicenseFn,
} from "./functions";
import { normalizeLicenseKey } from "./key.client";

// ── Local Storage Cache (UX only, not source of truth) ─────────────────────

const LICENSE_KEY_CACHE = "nasaq.license-key";

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
  /** Whether the user has a valid active license. */
  hasLicense: boolean;
  /** License info (null if no license or loading). */
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
export function useLicense(userId?: string, userEmail?: string | null) {
  const [state, setState] = useState<LicenseState>(INITIAL_STATE);

  // Validate on mount and periodically
  const validateCached = useCallback(async () => {
    const cachedKey = getCachedLicenseKey();
    if (!cachedKey) {
      setState((s) => ({ ...s, isLoading: false, hasLicense: false, license: null, entitlements: EMPTY_ENTITLEMENTS }));
      return;
    }

    try {
      const result = await validateLicenseFn({ data: { key: cachedKey } });
      if (result.valid && result.license && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
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
          license: null,
          entitlements: EMPTY_ENTITLEMENTS,
          error: null,
        });
      }
    } catch {
      // Server unreachable — use cached entitlements for UX
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  // Also check server status for user-linked licenses. The server resolves
  // the identity from the verified session — no client id is sent.
  const checkUserLicense = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await getLicenseStatusFn({ data: undefined });
      if (result.isOwner && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          license: null,
          entitlements: result.entitlements,
          error: null,
        });
      } else if (result.hasLicense && result.license && result.entitlements) {
        setState({
          isLoading: false,
          hasLicense: true,
          license: result.license,
          entitlements: result.entitlements,
          error: null,
        });
      }
    } catch {
      /* ignore — fallback to key-based validation */
    }
  }, [userId]);

  useEffect(() => {
    validateCached().then(() => checkUserLicense());
    // Re-validate every 5 minutes
    const interval = setInterval(() => {
      validateCached().then(() => checkUserLicense());
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [validateCached, checkUserLicense]);

  /** Activate a license key. */
  const activate = useCallback(
    async (key: string): Promise<{ success: boolean; message: string }> => {
      setState((s) => ({ ...s, error: null }));
      const normalizedKey = normalizeLicenseKey(key);
      try {
        const result = await activateLicenseFn({ data: { key: normalizedKey, email: userEmail || undefined } });
        if (result.success && result.license) {
          setCachedLicenseKey(normalizedKey);
          // Re-validate to get full entitlements
          const validated = await validateLicenseFn({ data: { key: normalizedKey } });
          setState({
            isLoading: false,
            hasLicense: true,
            license: validated.license ?? result.license,
            entitlements: validated.entitlements ?? LICENSE_ENTITLEMENTS[result.license.type],
            error: null,
          });
          return { success: true, message: result.message };
        }
        setState((s) => ({ ...s, error: result.message }));
        return { success: false, message: result.message };
      } catch {
        const msg = "حدث خطأ أثناء تفعيل الترخيص.";
        setState((s) => ({ ...s, error: msg }));
        return { success: false, message: msg };
      }
    },
    // `activate` no longer sends a client-side identity (server resolves the
    // session); only userEmail is read.
    [userEmail],
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
      license: null,
      entitlements: EMPTY_ENTITLEMENTS,
      error: null,
    });
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
