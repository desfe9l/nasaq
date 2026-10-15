/**
 * The licence-status loader — one server answer per page, shared by every
 * consumer, with the freshness/coalescing rules in a module that has no React
 * and no server functions of its own.
 *
 * WHY IT EXISTS
 *   `useLicense()` is mounted by the workspace, the editor, the template
 *   galleries, the account badge… all of them ask for the same account's
 *   entitlements. Left to themselves they each paid for a request — and every
 *   internal navigation started the whole check over. This loader makes the
 *   answer a shared, briefly-cached resource instead:
 *
 *   · a fresh memo answers without any network at all;
 *   · consumers that ask while a request is in flight JOIN it (one request, N
 *     readers) — including forced refreshes, so a burst of "revalidate now"
 *     cannot stampede the server;
 *   · a failed or malformed answer is NEVER memoised, so the next caller asks
 *     again instead of inheriting a hole for the whole freshness window;
 *   · `invalidate()` is the explicit poke used at identity boundaries and after
 *     an activation.
 *
 * The clock is injected and the fetcher is injected, so the rules above are
 * unit-tested directly (`status-loader.test.ts`).
 */

import type { LicenseStatusResult } from "./types";

export type LicenseStatusFetcher = () => Promise<LicenseStatusResult>;

export type LicenseStatusLoaderOptions = {
  /** Performs the actual request (the server function, in production). */
  fetcher: LicenseStatusFetcher;
  /** Clock, injectable for tests. */
  now?: () => number;
  /** How long a successful answer is reused before the server is asked again. */
  revalidateAfterMs?: number;
  /**
   * Called with every fresh server answer — the hook that persists it (licence
   * snapshot, offline entitlement mirror). Never called for a memo hit, so the
   * caches only ever record real answers.
   */
  onStatus?: (userId: string, status: LicenseStatusResult) => void;
};

export type LicenseStatusLoader = {
  /**
   * The account's licence status, or `null` when the server could not answer.
   * `force` skips the freshness window but never opens a second concurrent
   * request.
   */
  load(userId: string, options?: { force?: boolean }): Promise<LicenseStatusResult | null>;
  /** The memoised answer for this account, when it is fresh. */
  memo(userId: string): LicenseStatusResult | null;
  /** Forget the memo: the next read goes to the server. */
  invalidate(): void;
  /** True while a request is in flight (diagnostics/tests). */
  isFetching(): boolean;
};

export const DEFAULT_LICENSE_REVALIDATE_AFTER_MS = 60_000;

export function createLicenseStatusLoader(
  options: LicenseStatusLoaderOptions,
): LicenseStatusLoader {
  const now = options.now ?? (() => Date.now());
  const revalidateAfterMs = options.revalidateAfterMs ?? DEFAULT_LICENSE_REVALIDATE_AFTER_MS;

  let memo: { userId: string; status: LicenseStatusResult; at: number } | null = null;
  let inFlight: { userId: string; promise: Promise<LicenseStatusResult | null> } | null = null;

  function load(
    userId: string,
    loadOptions: { force?: boolean } = {},
  ): Promise<LicenseStatusResult | null> {
    if (!userId) return Promise.resolve(null);
    if (
      !loadOptions.force &&
      memo &&
      memo.userId === userId &&
      now() - memo.at < revalidateAfterMs
    ) {
      return Promise.resolve(memo.status);
    }
    if (inFlight && inFlight.userId === userId) return inFlight.promise;

    let settle: (value: LicenseStatusResult | null) => void = () => {};
    const promise = new Promise<LicenseStatusResult | null>((resolve) => {
      settle = resolve;
    });
    inFlight = { userId, promise };
    void (async () => {
      let result: LicenseStatusResult | null = null;
      try {
        const status = await options.fetcher();
        if (status && typeof status === "object") {
          result = status;
          memo = { userId, status, at: now() };
          options.onStatus?.(userId, status);
        }
      } catch {
        // Offline / 503 / signed out mid-flight: no memo, no downgrade. Callers
        // keep whatever they were showing and the next read asks again.
        result = null;
      } finally {
        if (inFlight?.promise === promise) inFlight = null;
        settle(result);
      }
    })();
    return promise;
  }

  return {
    load,
    memo(userId) {
      if (!memo || memo.userId !== userId) return null;
      return now() - memo.at < revalidateAfterMs ? memo.status : null;
    },
    invalidate() {
      memo = null;
    },
    isFetching: () => inFlight !== null,
  };
}
