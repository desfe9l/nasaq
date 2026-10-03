/**
 * Entitlement — the authoritative answer to "what may this user access?".
 *
 * This module is the ONLY place account status is decided. It never reads a
 * client-supplied flag: the status is derived from the `subscriptions` table on
 * every call, so editing `isPremium` / `plan` / `expiresAt` in the browser
 * changes nothing. The server asks these functions; the UI merely displays the
 * answer.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 * 1. **Expiry is a computation, not a cron job.** No sweeper marks rows EXPIRED,
 *    so an app that was asleep at the boundary still reports EXPIRED correctly
 *    the moment it is next asked — `now > expires_at` is evaluated on read.
 * 2. **Expiry never deletes anything.** Projects, uploads and history belong to
 *    the customer and must survive lapse. Only the derived status changes.
 *
 * Every function here takes an `sql` client so it stays testable without a live
 * server, and so callers control the transaction.
 */
import type { Sql } from "../db.ts";
import { isAdminUser } from "../auth/admin-identity.server.ts";
import type {
  AccountStatus,
  CustomerAccount,
  SubscriptionStatus,
} from "./types";

const DAY_MS = 86_400_000;

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  activated_at: string | Date;
  expires_at: string | Date;
  suspended_at: string | Date | null;
  source_transaction_id?: string | null;
};

type PlanRow = {
  id: string;
  name: string;
  arabic_name: string;
  duration_days: number;
};

/** Normalize a Postgres timestamp to an ISO string (Date on some drivers). */
function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** True when `now` is past the authoritative expiry. */
export function isExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return now.getTime() > expiry.getTime();
}

/**
 * Whole days left until `expiresAt`, floored at 0. Rounded UP so a subscription
 * with 20 hours left reads "1 day" rather than "0 days" — reporting 0 to a
 * paying customer with time remaining is worse than rounding in their favour.
 */
export function daysRemaining(expiresAt: string | Date, now: Date = new Date()): number {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const diff = expiry.getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / DAY_MS);
}

/**
 * Derive account status from an entitlement row plus its plan, or FREE when the
 * customer holds no entitlement at all.
 *
 * Precedence is deliberate: SUSPENDED outranks everything (an admin's decision to
 * cut access must not be undone by the clock), and an expired ACTIVE row reports
 * EXPIRED even though the stored status still says ACTIVE.
 */
export function deriveStatus(
  subscription: SubscriptionRow | null,
  now: Date = new Date(),
): AccountStatus {
  if (!subscription) return "FREE";
  if (subscription.status === "SUSPENDED") return "SUSPENDED";
  if (subscription.status === "EXPIRED") return "EXPIRED";
  return isExpired(subscription.expires_at, now) ? "EXPIRED" : "ACTIVE";
}

/**
 * The customer's live-or-most-recent entitlement.
 *
 * A user may hold many EXPIRED rows (renewals accumulate as history) plus at
 * most one ACTIVE/SUSPENDED row. SUSPENDED and ACTIVE win over any EXPIRED row,
 * so a lapsed renewal cycle can never mask a currently-suspended account.
 */
export async function getSubscription(
  sql: Sql,
  userId: string,
): Promise<SubscriptionRow | null> {
  const rows = await sql<SubscriptionRow>`
    select id, user_id, plan_id, status, activated_at, expires_at, suspended_at, source_transaction_id
    from subscriptions
    where user_id = ${userId}
    order by
      case status when 'SUSPENDED' then 0 when 'ACTIVE' then 1 else 2 end,
      expires_at desc
    limit 1
  `;
  return rows[0] ?? null;
}

/**
 * The customer's own account view — status plus display fields.
 *
 * Returns FREE with mostly-null fields for a brand-new account, which is what
 * the dashboard renders before any purchase.
 */
export async function getAccount(
  sql: Sql,
  userId: string,
  now: Date = new Date(),
): Promise<CustomerAccount> {
  const isAdmin = await isAdminUser(sql, userId);
  const subscription = await getSubscription(sql, userId);
  if (!subscription) {
    return {
      status: "FREE",
      planId: null,
      planName: null,
      planArabicName: null,
      activatedAt: null,
      expiresAt: null,
      daysRemaining: null,
      isAdmin,
    };
  }

  const planRows = await sql<PlanRow>`
    select id, name, arabic_name, duration_days from plans where id = ${subscription.plan_id}
  `;
  const plan = planRows[0] ?? null;
  const status = deriveStatus(subscription, now);

  return {
    status,
    planId: subscription.plan_id,
    planName: plan?.name ?? null,
    planArabicName: plan?.arabic_name ?? null,
    activatedAt: toIso(subscription.activated_at),
    expiresAt: toIso(subscription.expires_at),
    daysRemaining:
      status === "ACTIVE" ? daysRemaining(subscription.expires_at, now) : null,
    isAdmin,
  };
}

/**
 * Thrown by `requireActiveEntitlement` when the caller has no active
 * subscription. Carries `status: 402 Payment Required` so callers and the UI can
 * tell "you must pay" apart from "you must sign in" (401) and "not allowed"
 * (403).
 */
export class EntitlementRequiredError extends Error {
  readonly status = 402;
  readonly accountStatus: AccountStatus;
  constructor(accountStatus: AccountStatus) {
    super("Entitlement required");
    this.name = "EntitlementRequiredError";
    this.accountStatus = accountStatus;
  }
}

/**
 * Authoritative gate for paid functionality. Throws when the caller is not
 * ACTIVE.
 *
 * This THROWS rather than returning a flag, and that is deliberate. A function
 * named `require*` that returned `{ active: false }` would be a trap: the
 * natural call — `await requireActiveEntitlement(sql, userId)` followed by the
 * paid operation — reads as a guard and behaves as a no-op, so every caller
 * would silently grant access to FREE users. Failing closed is the only safe
 * shape for a name like this, matching `requireUserId` and `requireAdmin`.
 *
 * Read a customer's state without gating (the account dashboard, which a FREE
 * user must be able to see) via `getAccount` instead.
 */
export async function requireActiveEntitlement(
  sql: Sql,
  userId: string,
  now: Date = new Date(),
): Promise<CustomerAccount> {
  const account = await getAccount(sql, userId, now);
  if (account.isAdmin) return account;
  if (account.status !== "ACTIVE") {
    throw new EntitlementRequiredError(account.status);
  }
  return account;
}

/**
 * Compute the new expiry when granting or extending access.
 *
 * **Renewing before expiry extends from the EXISTING expiry**, so a customer who
 * renews early is never penalised for paying ahead of time. A first purchase, or
 * a renewal after lapse, starts from now.
 *
 * This is the single owner of that policy — do not re-derive it at call sites,
 * or an early renewal quietly loses the customer the days they already paid for.
 */
export function computeExpiry(
  durationDays: number,
  current: SubscriptionRow | null,
  now: Date = new Date(),
): Date {
  const extendsLiveAccess =
    current !== null &&
    current.status !== "EXPIRED" &&
    !isExpired(current.expires_at, now);
  const base = extendsLiveAccess
    ? new Date(current!.expires_at)
    : now;
  return new Date(base.getTime() + durationDays * DAY_MS);
}

export type { SubscriptionRow, PlanRow };