/**
 * NASAQ — application resource budgets.
 *
 * The numbers live in the owner control plane (`@/lib/control-plane`). This
 * module is the synchronous enforcement edge: per-user budget, per-IP safety
 * ceiling, and the per-account storage quota. It does not decide plans, and
 * it does not speak for Gemini, R2, or Postgres.
 *
 *   user_limit — this verified account's own budget.
 *   app_limit  — the deployment safety ceiling, keyed by client IP. It still
 *                applies to the owner. Privilege skips the user bucket only.
 *
 * Env `NASAQ_LIMITS_JSON` / `NASAQ_STORAGE_QUOTA_BYTES` /
 * `NASAQ_PUBLIC_CACHE_TTL_MS` bootstrap a deployment that has not saved an
 * owner document yet. Once the owner saves (revision >= 1), the saved
 * document is what enforcement reads.
 */

import { checkRateLimit } from "@/lib/license/rate-limit";
import { rateLimitKey } from "@/lib/auth/request-ip";
import { enforcementPlane } from "@/lib/control-plane/snapshot";
import {
  SHIPPED_OPERATION_POLICY,
  SHIPPED_PUBLIC_CACHE_TTL_MS,
  SHIPPED_STORAGE_QUOTA_BYTES,
  type OperationId,
  type OperationPolicy,
} from "@/lib/control-plane/schema";

export type { OperationId, OperationPolicy };

export const DEFAULT_OPERATION_POLICY = SHIPPED_OPERATION_POLICY;
export const DEFAULT_STORAGE_QUOTA_BYTES = SHIPPED_STORAGE_QUOTA_BYTES;
export const DEFAULT_PUBLIC_CACHE_TTL_MS = SHIPPED_PUBLIC_CACHE_TTL_MS;

/** Hard ceiling on entries in the public-read cache (memory bound). */
export const PUBLIC_CACHE_MAX_ENTRIES = 500;

/** Effective per-operation policy. */
export function operationPolicy(op: OperationId): OperationPolicy {
  return enforcementPlane().operations[op];
}

/** Effective per-account storage ceiling in bytes. */
export function storageQuotaBytes(): number {
  return enforcementPlane().storageQuotaBytes;
}

/** Effective TTL for the public-read cache, in milliseconds. */
export function publicCacheTtlMs(): number {
  return enforcementPlane().publicCacheTtlMs;
}

export type LimitKind = "user_limit" | "app_limit";

export type LimitVerdict =
  | { allowed: true }
  | { allowed: false; kind: LimitKind; retryAfterMs: number };

const WINDOW_MS = 60_000;

/**
 * Budget ONE operation for ONE caller.
 *
 * `privileged` is the owner or a platform administrator, resolved server-side.
 * Their own per-user bucket is not applied. The IP safety ceiling still is.
 */
export function checkOperationLimit(
  op: OperationId,
  userId: string | null | undefined,
  ip: string,
  options?: { privileged?: boolean },
): LimitVerdict {
  const policy = operationPolicy(op);
  if (!options?.privileged) {
    if (!checkRateLimit(`${op}:user`, rateLimitKey(userId, ip), policy.userPerMinute, WINDOW_MS)) {
      return { allowed: false, kind: "user_limit", retryAfterMs: WINDOW_MS };
    }
  }
  if (!checkRateLimit(`${op}:ip`, ip || "unknown", policy.ipPerMinute, WINDOW_MS)) {
    return { allowed: false, kind: "app_limit", retryAfterMs: WINDOW_MS };
  }
  return { allowed: true };
}

/**
 * Budget ONE operation against the application safety ceiling ONLY.
 * Used for privileged surfaces where the caller's own budget is not the point.
 */
export function checkAppSafetyLimit(op: OperationId, ip: string): LimitVerdict {
  return checkOperationLimit(op, null, ip, { privileged: true });
}

/**
 * Whether an account may store `incomingBytes` more. The quota is an
 * APPLICATION limit on total bytes per account — distinct from the per-object
 * ceiling in `@/lib/storage/provider` and from the per-minute upload rate.
 */
export function withinStorageQuota(usedBytes: number, incomingBytes: number): boolean {
  const quota = storageQuotaBytes();
  return usedBytes + Math.max(0, incomingBytes) <= quota;
}
