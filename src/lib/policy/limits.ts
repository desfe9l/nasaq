/**
 * NASAQ — the application's OWN resource policy.
 *
 * Vercel is the hosting layer; it is NOT the application's resource manager.
 * Every limit that protects an application resource (AI calls, uploads,
 * storage bytes, expensive reads) is declared HERE, owned by the application,
 * and configurable by deployment policy — never hardcoded at a call site and
 * never delegated to the hosting plan.
 *
 * THREE DISTINCT LIMIT KINDS — a caller must always be able to tell them apart:
 *
 *   1. `user_limit`  — the verified identity's own per-minute budget. Keyed by
 *     the session user id (unforgeable from a header). Exhaustion means "this
 *     account did too much", and the message says so.
 *   2. `app_limit`   — the application safety ceiling, keyed by client IP. It
 *     bounds a caller whose session is shared, rotated or absent, and it is
 *     applied even to privileged roles where the operation costs real money
 *     (e.g. admin AI notes). Exhaustion means "this deployment is protecting
 *     itself", not "you personally are banned".
 *   3. provider limits (rate/quota/billing) are classified separately by the
 *     AI provider layer (`@/lib/ai/provider.server`) and are never reported as
 *     either of the above.
 *
 * Plan entitlements are a FOURTH, orthogonal question ("is this feature in the
 * caller's plan?") answered by `@/lib/auth/authorization.server` BEFORE any
 * limit here is consulted — a licence gate failure is never a rate limit and
 * vice versa.
 *
 * CONFIGURATION
 *
 * Defaults below are the shipped policy. A deployment can override any number
 * with `NASAQ_LIMITS_JSON` (deep-merged over the defaults), or the two most
 * commonly tuned scalars directly:
 *
 *   NASAQ_STORAGE_QUOTA_BYTES   per-account total storage ceiling (default 512 MiB)
 *   NASAQ_PUBLIC_CACHE_TTL_MS   TTL of the public-read cache (default 30 s)
 *
 * Every override is optional; an absent or malformed value falls back to the
 * default, never to "unlimited".
 */

import { checkRateLimit } from "@/lib/license/rate-limit";
import { rateLimitKey } from "@/lib/auth/request-ip";

/** Operations the application budgets. One entry per protected surface. */
export type OperationId =
  | "ai:report"
  | "ai:design"
  | "ai:selection"
  | "ai:image"
  | "ai:admin-note"
  | "storage:upload"
  | "storage:mutation"
  | "storage:read";

export interface OperationPolicy {
  /** Requests per minute per verified user id. */
  userPerMinute: number;
  /** Requests per minute per client IP — the application safety ceiling. */
  ipPerMinute: number;
}

/**
 * The shipped policy. Numbers were chosen so a normal working session never
 * touches them (a report draft every ~8 s, an image OCR every ~15 s, an asset
 * upload every ~2 s) while a script hammering an endpoint is cut off inside the
 * first minute.
 */
export const DEFAULT_OPERATION_POLICY: Record<OperationId, OperationPolicy> = {
  "ai:report": { userPerMinute: 8, ipPerMinute: 16 },
  "ai:design": { userPerMinute: 6, ipPerMinute: 12 },
  "ai:selection": { userPerMinute: 20, ipPerMinute: 40 },
  "ai:image": { userPerMinute: 4, ipPerMinute: 8 },
  // Admin-only surface, but it spends real provider money: the safety ceiling
  // applies to admins too, so a compromised admin session cannot drain the
  // provider budget. 30/min is far above any human pace.
  "ai:admin-note": { userPerMinute: 30, ipPerMinute: 60 },
  // Uploads write bytes to object storage AND a database row: the most
  // expensive per-request operation in the app after AI.
  "storage:upload": { userPerMinute: 30, ipPerMinute: 60 },
  // Cheap metadata writes, but still per-request work: bounded so a stuck
  // client loop cannot spin them.
  "storage:mutation": { userPerMinute: 60, ipPerMinute: 120 },
  // Reads mint signed URLs / stream bytes out of the bucket: generous, but not
  // unbounded — a polling client must not become a bandwidth bill.
  "storage:read": { userPerMinute: 120, ipPerMinute: 240 },
};

/** Per-account total storage ceiling. 512 MiB of objects per account. */
export const DEFAULT_STORAGE_QUOTA_BYTES = 512 * 1024 * 1024;

/** TTL of the application-level cache for PUBLIC reads (catalog, settings). */
export const DEFAULT_PUBLIC_CACHE_TTL_MS = 30_000;

/** Hard ceiling on entries in the public-read cache (memory bound). */
export const PUBLIC_CACHE_MAX_ENTRIES = 500;

type PolicyOverrides = {
  operations?: Partial<Record<OperationId, Partial<OperationPolicy>>>;
  storageQuotaBytes?: number;
  publicCacheTtlMs?: number;
};

function readEnv(name: string): string | undefined {
  return (typeof process !== "undefined" ? process.env[name] : undefined)?.trim() || undefined;
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function parseOverrides(raw: string | undefined): PolicyOverrides {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PolicyOverrides) : {};
  } catch {
    // A malformed policy override must never widen a limit: ignore it and keep
    // the shipped defaults.
    return {};
  }
}

const overrides = parseOverrides(readEnv("NASAQ_LIMITS_JSON"));

/** Effective per-operation policy (defaults + deployment overrides). */
export function operationPolicy(op: OperationId): OperationPolicy {
  const base = DEFAULT_OPERATION_POLICY[op];
  const override = overrides.operations?.[op];
  return {
    userPerMinute: positiveInt(override?.userPerMinute) ?? base.userPerMinute,
    ipPerMinute: positiveInt(override?.ipPerMinute) ?? base.ipPerMinute,
  };
}

/** Effective per-account storage ceiling in bytes. */
export function storageQuotaBytes(): number {
  return (
    positiveInt(overrides.storageQuotaBytes) ??
    positiveInt(readEnv("NASAQ_STORAGE_QUOTA_BYTES")) ??
    DEFAULT_STORAGE_QUOTA_BYTES
  );
}

/** Effective TTL for the public-read cache, in milliseconds. */
export function publicCacheTtlMs(): number {
  return (
    positiveInt(overrides.publicCacheTtlMs) ??
    positiveInt(readEnv("NASAQ_PUBLIC_CACHE_TTL_MS")) ??
    DEFAULT_PUBLIC_CACHE_TTL_MS
  );
}

export type LimitKind = "user_limit" | "app_limit";

export type LimitVerdict =
  | { allowed: true }
  | { allowed: false; kind: LimitKind; retryAfterMs: number };

const WINDOW_MS = 60_000;

/**
 * Budget ONE operation for ONE caller.
 *
 * `userId` is the VERIFIED session user id (null when signed out) and `ip` the
 * rightmost-forwarded client address. Two independent buckets, either of which
 * can refuse; the verdict says WHICH limit fired so the caller can be told the
 * truth instead of a generic "slow down".
 */
export function checkOperationLimit(
  op: OperationId,
  userId: string | null | undefined,
  ip: string,
): LimitVerdict {
  const policy = operationPolicy(op);
  // The user bucket is keyed by the unforgeable identity; signed-out callers
  // fall back to the IP so they are still bounded by the user budget too.
  if (!checkRateLimit(`${op}:user`, rateLimitKey(userId, ip), policy.userPerMinute, WINDOW_MS)) {
    return { allowed: false, kind: "user_limit", retryAfterMs: WINDOW_MS };
  }
  if (!checkRateLimit(`${op}:ip`, ip || "unknown", policy.ipPerMinute, WINDOW_MS)) {
    return { allowed: false, kind: "app_limit", retryAfterMs: WINDOW_MS };
  }
  return { allowed: true };
}

/**
 * Budget ONE operation against the application safety ceiling ONLY (the per-IP
 * bucket). Used for privileged surfaces — admin AI notes — where the caller's
 * own budget is not the point: the ceiling protects the deployment's provider
 * spend no matter who is calling.
 */
export function checkAppSafetyLimit(
  op: OperationId,
  ip: string,
): LimitVerdict {
  const policy = operationPolicy(op);
  if (!checkRateLimit(`${op}:ip`, ip || "unknown", policy.ipPerMinute, WINDOW_MS)) {
    return { allowed: false, kind: "app_limit", retryAfterMs: WINDOW_MS };
  }
  return { allowed: true };
}

/**
 * Whether an account may store `incomingBytes` more. The quota is an
 * APPLICATION limit on total bytes per account — distinct from the per-object
 * ceiling in `@/lib/storage/provider` (which bounds one file) and from the
 * per-minute upload rate above (which bounds frequency).
 */
export function withinStorageQuota(usedBytes: number, incomingBytes: number): boolean {
  const quota = storageQuotaBytes();
  return usedBytes + Math.max(0, incomingBytes) <= quota;
}
