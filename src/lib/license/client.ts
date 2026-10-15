/**
 * NASAQ License — Client-side state and entitlements.
 *
 * The client NEVER trusts local state for feature access. Every answer below
 * comes from the server (`getLicenseStatusFn` / `validateLicenseFn`), and every
 * gated operation re-checks on the server when it runs. What this module owns is
 * HOW FAST that answer reaches the screen:
 *
 *   STALE       The last answer the server gave is persisted per account
 *               (`license-cache.ts`). The hook starts from it, so a licensed
 *               account is licensed on the FIRST render — no loading state, no
 *               disabled premium cards, no «جارٍ التحقق من الترخيص…» on every
 *               navigation.
 *   WHILE       One shared loader (`loadLicenseStatus`) serves every consumer on
 *               the page. Twenty components asking at once cost ONE request, and
 *               an answer younger than `LICENSE_REVALIDATE_AFTER_MS` is reused
 *               instead of asked for again — so moving between pages no longer
 *               re-runs the whole check.
 *   REVALIDATE  The background revalidation replaces the snapshot silently when
 *               the server disagrees, or ENDS the session when the licence was
 *               cancelled (`notifySessionEnded` → the root `SessionWatch` clears
 *               local state and routes to sign-in). It never blocks a render and
 *               a failed probe never downgrades a paid account: the cached answer
 *               stands until the server actually answers.
 *
 * `localStorage` holds two things, both account-scoped and both dropped at every
 * identity boundary: the cached licence KEY (so a key-based activation survives
 * a reload) and the cached licence ANSWER (see above).
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { notifySessionEnded } from "@/lib/auth/session-recovery";
import type { FeatureId, LicenseStatusResult, LicenseType } from "./types";
import { LICENSE_ENTITLEMENTS } from "./types";
import {
  INITIAL_LICENSE_STATE,
  UNLICENSED_STATE,
  licenseRevocationReason,
  licenseStateFromActivation,
  licenseStateFromStatus,
  sameLicenseAccess,
  type LicenseState,
} from "./state";
import {
  clearCachedLicenseStatus,
  readCachedLicenseState,
  readCachedLicenseStatus,
  writeCachedLicenseStatus,
} from "./license-cache";
import {
  DEFAULT_LICENSE_REVALIDATE_AFTER_MS,
  createLicenseStatusLoader,
} from "./status-loader";
import {
  activateLicenseFn,
  validateLicenseFn,
  getLicenseStatusFn,
  deactivateLicenseFn,
} from "./functions";

// The state type and its pure mappers live in one place (`./state`) so the hook,
// the cache and the editor store can never format the same server answer
// differently. Re-exported here because this is where consumers import from.
export type { LicenseState } from "./state";
export { EMPTY_ENTITLEMENTS, INITIAL_LICENSE_STATE, UNLICENSED_STATE } from "./state";

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
 * migration and reasonably concludes it failed. It invalidates the shared memo
 * (so the next read cannot answer from it) and asks every consumer to refresh;
 * their requests coalesce into one.
 */
export function refreshLicenseState(): void {
  invalidateLicenseStatus();
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

/** Drop the browser-stored raw key AND the cached answer for this account. */
export function clearCachedLicense(userId?: string | null): void {
  setCachedLicenseKey("");
  if (userId) clearCachedLicenseStatus(userId);
}

// ── Shared server answers (one request per page, not one per consumer) ─────

/**
 * The coalescing loader behind every consumer of this module. The rules (memo,
 * freshness window, in-flight sharing, "a failure is never memoised") are in
 * `status-loader.ts`, unit-tested without React; what it is wired to HERE is
 * the real request and the persistence of every real answer — the per-account
 * licence snapshot read on the next page load, and the offline entitlement
 * mirror the editor's grace window uses.
 */
const statusLoader = createLicenseStatusLoader({
  fetcher: () => getLicenseStatusFn(),
  onStatus: (userId, status) => {
    writeCachedLicenseStatus(userId, status);
    void mirrorOfflineEntitlement(userId, status);
  },
});

/** How long a confirmed answer is reused before the server is asked again. */
export const LICENSE_REVALIDATE_AFTER_MS = DEFAULT_LICENSE_REVALIDATE_AFTER_MS;

/** Forget the memo (the next read goes to the server). */
export function invalidateLicenseStatus(): void {
  statusLoader.invalidate();
}

/**
 * Read the account-linked licence status — the authoritative answer — through
 * the shared loader. Resolves to `null` when the server could not answer
 * (offline, 503, signed out mid-flight); callers keep whatever they were
 * showing rather than downgrading on a failed probe.
 */
export async function loadLicenseStatus(
  userId: string,
  options: { force?: boolean } = {},
): Promise<LicenseStatusResult | null> {
  return statusLoader.load(userId, options);
}

/**
 * Mirror a server-validated answer into the offline entitlement cache, so the
 * editor's offline grace (`src/lib/offline/entitlement-cache.ts`) and this
 * snapshot describe the same moment. Best effort by design: no cache write may
 * ever fail a licence read.
 */
async function mirrorOfflineEntitlement(
  userId: string,
  status: LicenseStatusResult,
): Promise<void> {
  try {
    const { cacheEntitlement } = await import("@/lib/offline/entitlement-cache");
    await cacheEntitlement({
      ownerId: userId,
      entitlements: status.entitlements ?? { ...LICENSE_ENTITLEMENTS.FREE },
      validatedAt: Date.now(),
      expiresAt: status.license?.expiresAt ?? null,
      isAdmin: status.isAdmin === true,
      isOwner: status.isOwner === true,
      isSuspended: status.isSuspended === true,
      hasLicense: status.hasLicense === true,
      source: "server",
    });
  } catch {
    /* the offline cache is optional; the live answer above still applies */
  }
}

/**
 * The state a consumer starts from: the shared memo when it is this account's,
 * else the persisted snapshot, else "still loading".
 *
 * Reading this is synchronous on purpose — it is what removes the server round
 * trip from the first paint.
 */
function startingLicenseState(accountId: string | null | undefined): LicenseState {
  if (!accountId) return INITIAL_LICENSE_STATE;
  const memo = statusLoader.memo(accountId);
  if (memo) return licenseStateFromStatus(memo);
  return readCachedLicenseState(accountId) ?? INITIAL_LICENSE_STATE;
}

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
  const accountId = userId ?? user?.id ?? null;
  const accountRef = useRef(accountId);
  accountRef.current = accountId;
  const [state, setState] = useState<LicenseState>(() => startingLicenseState(accountId));

  /**
   * Adopt a server answer: map it, tell the app when it CANCELS access, and
   * re-render only when something the UI reads actually changed ("silent"
   * update — the point of the whole dance).
   */
  const adoptStatus = useCallback((accountIdNow: string, status: LicenseStatusResult) => {
    const revocation = licenseRevocationReason(status);
    if (revocation) {
      // A cancelled licence (revoked, or the account suspended) ends the
      // session: the root watcher clears this browser's identity state and
      // routes to sign-in. Expiry deliberately does NOT — see `./state`.
      notifySessionEnded(revocation, accountIdNow);
    }
    const next = licenseStateFromStatus(status);
    setState((prev) => (sameLicenseAccess(prev, next) && prev.error === next.error && !prev.fromCache ? prev : next));
  }, []);

  // Validate a browser-stored raw key (legacy activation path). The account-linked
  // status below is authoritative and repairs historic paid keys with no key stored.
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
        // Hoisted out of the updater so the narrowed values survive the closure.
        const license = result.license;
        const entitlements = result.entitlements;
        setState((prev) => {
          const next: LicenseState = {
            isLoading: false,
            hasLicense: true,
            isAdmin: false,
            license,
            trial: null,
            entitlements,
            error: null,
          };
          return sameLicenseAccess(prev, next) && !prev.fromCache ? prev : next;
        });
      } else {
        // Invalid or expired — clear cache
        setCachedLicenseKey("");
        setState((prev) => (sameLicenseAccess(prev, UNLICENSED_STATE) && !prev.fromCache ? prev : UNLICENSED_STATE));
      }
    } catch {
      /* Keep what we are showing: a failed probe is not a downgrade. */
    }
  }, [accountId]);

  /** The server's own answer for this account: authoritative, and cached. */
  const checkUserLicense = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!accountId) return;
      const status = await loadLicenseStatus(accountId, options);
      if (!status || accountRef.current !== accountId) return;
      adoptStatus(accountId, status);
    },
    [accountId, adoptStatus],
  );

  useEffect(() => {
    if (!accountId) {
      // Signed out, or the session is still resolving: nothing is licensed yet,
      // and the hook must not report a licence for an account it cannot name.
      setState({ ...INITIAL_LICENSE_STATE, isLoading: isPending });
      return;
    }
    // Identity boundary or first mount: start from the freshest local answer and
    // let the background probe correct it. This never blocks the render.
    setState(startingLicenseState(accountId));
    let alive = true;
    const refresh = (options: { force?: boolean } = {}) => {
      if (!alive) return;
      void validateCached().then(() => checkUserLicense(options));
    };
    refresh();
    const interval = setInterval(() => refresh({ force: true }), 5 * 60 * 1000);
    const onChanged = () => refresh({ force: true });
    window.addEventListener(LICENSE_CHANGED, onChanged);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener(LICENSE_CHANGED, onChanged);
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
        const activated = licenseStateFromActivation(result);
        if (activated) {
          setCachedLicenseKey(key);
          setState(activated);
          // The activation answer unlocks the features; the next status read
          // (asked here, in the background, without waiting for the interval)
          // persists the full server answer so the next page starts unlocked.
          refreshLicenseState();
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
    clearCachedLicense(accountId);
    invalidateLicenseStatus();
    setState(UNLICENSED_STATE);
    notifyLicenseChanged();
  }, [accountId]);

  const revalidate = useCallback(
    async (options: { force?: boolean } = { force: true }) => {
      await validateCached();
      // Also repairs historic paid keys with no browser-stored key.
      await checkUserLicense({ force: options.force !== false });
    },
    [validateCached, checkUserLicense],
  );

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

/** The persisted answer for an account, without waiting for the hook. */
export function cachedLicenseStatusFor(userId: string): LicenseStatusResult | null {
  return statusLoader.memo(userId) ?? readCachedLicenseStatus(userId);
}
