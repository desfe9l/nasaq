/**
 * Admin authorization, entitlement mutations, and the audit log (server-only).
 *
 * ## Why authorization lives here and nowhere else
 *
 * Every sensitive operation in this app calls `requireAdmin` at its start. Admin
 * identity is resolved from the **verified session** plus a lookup in
 * `admin_users` — never from a request body, never from an `isAdmin` flag, never
 * from an email comparison in the browser. A customer calling an admin server
 * function directly is just a caller with a normal session, so they fail the
 * lookup and get 403.
 *
 * Nothing here trusts the client. The browser can only *ask*; this module decides.
 *
 * ## Bootstrapping
 *
 * `admin_users` needs a first row before anyone can be promoted through the UI.
 * `NASAQ_ADMIN_USER_IDS` (a comma-separated list of user ids and/or email
 * addresses) is read **server-side only** and treated as an allowlist. It is a
 * deliberate bootstrap escape hatch, not the primary mechanism — the table is the
 * source of truth, and removing the env var never revokes a table-granted admin.
 */
import { randomUUID } from "node:crypto";
import { isAdminUser } from "../auth/admin-identity.server.ts";
import type { Sql } from "../db.ts";
import {
  computeExpiry,
  deriveStatus,
  getSubscription,
  isExpired,
} from "./entitlement.server.ts";
import { getPlan } from "./plans.server.ts";
import type { AdminCustomer, AdminAction, AdminAuditEntry } from "./types";

/**
 * Thrown when a caller lacks administrative privileges. Carries `status: 403`,
 * matching `CrossSiteRequestError` / `UnauthorizedError` so the error surface can
 * map it to a response without special-casing.
 */
export class AdminRequiredError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden");
    this.name = "AdminRequiredError";
  }
}

/** Thrown when an admin targets a row or customer that does not exist. */
export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Is this user an administrator? Authoritative, server-side.
 *
 * The shared identity helper checks the explicit deployment allowlist and the
 * `admin_users` table. The customer email used for an allowlist match is read
 * from the database only after the caller id is known, never from a UI flag.
 */
export async function isAdmin(sql: Sql, userId: string): Promise<boolean> {
  return isAdminUser(sql, userId);
}

/**
 * Gate for every admin server function. Throws `AdminRequiredError` (403) when
 * the caller is not an administrator.
 */
export async function requireAdmin(sql: Sql, userId: string): Promise<void> {
  if (!(await isAdmin(sql, userId))) throw new AdminRequiredError();
}

type AdminActor = { adminUserId: string };

/**
 * Append an audit entry. Best-effort by design: an audit write failing must not
 * abort the action it describes, but it is logged loudly so the gap is visible.
 */
export async function audit(
  sql: Sql,
  entry: {
    adminUserId: string;
    action: AdminAction;
    targetType: string;
    targetId: string | null;
    detail?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  try {
    await sql`
      insert into admin_audit_log
        (id, admin_user_id, action, target_type, target_id, detail)
      values
        (${randomUUID()}, ${entry.adminUserId}, ${entry.action}, ${entry.targetType},
         ${entry.targetId}, ${JSON.stringify(entry.detail ?? {})}::jsonb)
    `;
  } catch (err) {
    console.error("[admin] audit write failed", {
      action: entry.action,
      targetId: entry.targetId,
      err,
    });
  }
}

/**
 * Coerce a stored jsonb `detail` into the flat, JSON-safe shape the client type
 * promises. Nested objects/arrays are stringified rather than dropped, so no
 * information silently disappears from the log.
 */
function normalizeDetail(
  value: unknown,
): Record<string, string | number | boolean | null> {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    out[key] =
      raw === null ||
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
        ? raw
        : JSON.stringify(raw);
  }
  return out;
}

/** Recent audit entries, newest first — admin-only. */
export async function listAuditLog(
  sql: Sql,
  limit = 100,
): Promise<AdminAuditEntry[]> {
  const rows = await sql<{
    id: string;
    admin_user_id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    detail: unknown;
    created_at: string | Date;
  }>`
    select id, admin_user_id, action, target_type, target_id, detail, created_at
    from admin_audit_log
    order by created_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    adminUserId: row.admin_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: normalizeDetail(row.detail),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  }));
}

/**
 * Grant or extend access — the single write path for entitlements.
 *
 * Used by payment approval, renewal, and manual activation alike so the
 * early-renewal policy (`computeExpiry`, which extends from an existing expiry)
 * is applied identically everywhere.
 *
 * Respects the one-live-row-per-user unique index: an existing
 * ACTIVE/SUSPENDED row is UPDATED, never duplicated. A SUSPENDED row stays
 * suspended — approving a payment must not quietly undo an admin's suspension;
 * restoring is a separate, explicit action.
 */
async function grantEntitlement(
  sql: Sql,
  input: { userId: string; plan: { id: string; durationDays: number } },
): Promise<{ expiresAt: Date }> {
  const current = await getSubscription(sql, input.userId);
  const live = current && current.status !== "EXPIRED" ? current : null;
  const expiresAt = computeExpiry(input.plan.durationDays, live);

  if (live) {
    // Keep the existing status (ACTIVE stays ACTIVE, SUSPENDED stays SUSPENDED).
    await sql`
      update subscriptions
      set plan_id = ${input.plan.id}, expires_at = ${expiresAt.toISOString()},
          updated_at = now()
      where id = ${live.id}
    `;
  } else {
    await sql`
      insert into subscriptions
        (id, user_id, plan_id, status, activated_at, expires_at)
      values
        (${randomUUID()}, ${input.userId}, ${input.plan.id}, 'ACTIVE',
         now(), ${expiresAt.toISOString()})
    `;
  }
  return { expiresAt };
}

/**
 * Approve a payment request and activate access.
 *
 * Order matters: the request is claimed as APPROVED first, under a
 * `status = 'PENDING'` guard, and only then is the entitlement written. If two
 * admins race, exactly one claim succeeds, so the customer cannot be granted two
 * overlapping periods from a single payment.
 */
export async function approvePayment(
  sql: Sql,
  actor: AdminActor,
  requestId: string,
  adminNote: string | null,
): Promise<{ expiresAt: string }> {
  const request = await sql<{ id: string; user_id: string; plan_id: string; status: string }>`
    select id, user_id, plan_id, status from payment_requests
    where id = ${requestId} limit 1
  `;
  if (!request[0]) throw new NotFoundError("Payment request not found");

  const plan = await getPlan(sql, request[0].plan_id);
  if (!plan) {
    // The plan was deleted after the customer submitted. Refuse rather than
    // invent a duration — an unguessable expiry is worse than a clear error.
    throw new NotFoundError(
      `Plan "${request[0].plan_id}" no longer exists — cannot determine the access period.`,
    );
  }

  const { decidePaymentRequest } = await import("./payments.server.ts");
  const claimed = await decidePaymentRequest(sql, {
    requestId,
    status: "APPROVED",
    adminUserId: actor.adminUserId,
    adminNote,
  });
  if (!claimed) {
    throw new ConflictError("This request was already reviewed.");
  }

  const { expiresAt } = await grantEntitlement(sql, {
    userId: request[0].user_id,
    plan: { id: plan.id, durationDays: plan.durationDays },
  });

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "payment.approved",
    targetType: "payment_request",
    targetId: requestId,
    detail: { userId: request[0].user_id, planId: plan.id, expiresAt: expiresAt.toISOString() },
  });

  return { expiresAt: expiresAt.toISOString() };
}

/** Reject a payment request. Does not touch any entitlement. */
export async function rejectPayment(
  sql: Sql,
  actor: AdminActor,
  requestId: string,
  adminNote: string | null,
): Promise<void> {
  const { decidePaymentRequest } = await import("./payments.server.ts");
  const claimed = await decidePaymentRequest(sql, {
    requestId,
    status: "REJECTED",
    adminUserId: actor.adminUserId,
    adminNote,
  });
  if (!claimed) throw new ConflictError("This request was already reviewed.");

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "payment.rejected",
    targetType: "payment_request",
    targetId: requestId,
    detail: { adminNote },
  });
}

/** Thrown when an action conflicts with the row's current state. */
export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Manually activate or re-activate a customer on a plan (no payment request). */
export async function activateCustomer(
  sql: Sql,
  actor: AdminActor,
  userId: string,
  planId: string,
): Promise<{ expiresAt: string }> {
  const plan = await getPlan(sql, planId);
  if (!plan) throw new NotFoundError("Plan not found");

  const { expiresAt } = await grantEntitlement(sql, {
    userId,
    plan: { id: plan.id, durationDays: plan.durationDays },
  });

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "customer.activated",
    targetType: "user",
    targetId: userId,
    detail: { planId, expiresAt: expiresAt.toISOString() },
  });

  return { expiresAt: expiresAt.toISOString() };
}

/** Set an explicit expiry. Used when an admin needs a date the plans can't express. */
export async function setExpiration(
  sql: Sql,
  actor: AdminActor,
  userId: string,
  expiresAt: Date,
): Promise<void> {
  const current = await getSubscription(sql, userId);
  if (!current) throw new NotFoundError("This customer has no subscription to change.");

  await sql`
    update subscriptions
    set expires_at = ${expiresAt.toISOString()}, updated_at = now()
    where id = ${current.id}
  `;

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "subscription.expiration_changed",
    targetType: "user",
    targetId: userId,
    detail: { expiresAt: expiresAt.toISOString() },
  });
}

/**
 * Add days to a customer's current period.
 *
 * Extends from the existing expiry when access is still live, so granting
 * goodwill days never costs the customer time they already have.
 *
 * Bounded on purpose. An unbounded `days` is how a typo becomes an effectively
 * permanent grant — 99999 days is 273 years, and it would be written silently.
 * Ten years is the ceiling; anything longer is a deliberate act that should go
 * through `setExpiration` with a real date instead.
 */
export async function extendSubscription(
  sql: Sql,
  actor: AdminActor,
  userId: string,
  days: number,
  maxDays = 3650,
): Promise<{ expiresAt: string }> {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("Extension must be a positive whole number of days.");
  }
  if (days > maxDays) {
    throw new Error(
      `Extension must be a positive whole number of days no greater than ${maxDays}.`,
    );
  }
  const current = await getSubscription(sql, userId);
  if (!current) throw new NotFoundError("This customer has no subscription to extend.");

  // Extend from the existing expiry when the period is still live, so early
  // renewals add to the remaining time instead of replacing it. A lapsed or
  // explicitly EXPIRED period restarts from now.
  const base =
    current.status !== "EXPIRED" && !isExpired(current.expires_at)
      ? new Date(current.expires_at)
      : new Date();
  const expiresAt = new Date(base.getTime() + days * 86_400_000);

  await sql`
    update subscriptions
    set expires_at = ${expiresAt.toISOString()}, updated_at = now()
    where id = ${current.id}
  `;

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "subscription.extended",
    targetType: "user",
    targetId: userId,
    detail: { days, expiresAt: expiresAt.toISOString() },
  });

  return { expiresAt: expiresAt.toISOString() };
}

/** Move a customer onto a different plan, keeping their current expiry. */
export async function changePlan(
  sql: Sql,
  actor: AdminActor,
  userId: string,
  planId: string,
): Promise<void> {
  const plan = await getPlan(sql, planId);
  if (!plan) throw new NotFoundError("Plan not found");
  const current = await getSubscription(sql, userId);
  if (!current) throw new NotFoundError("This customer has no subscription to change.");

  await sql`
    update subscriptions set plan_id = ${planId}, updated_at = now() where id = ${current.id}
  `;

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "plan.changed",
    targetType: "user",
    targetId: userId,
    detail: { planId },
  });
}

/** Suspend access. The entitlement row is preserved — nothing is deleted. */
export async function suspendCustomer(
  sql: Sql,
  actor: AdminActor,
  userId: string,
): Promise<void> {
  const current = await getSubscription(sql, userId);
  if (!current) throw new NotFoundError("This customer has no subscription to suspend.");

  await sql`
    update subscriptions
    set status = 'SUSPENDED', suspended_at = now(), updated_at = now()
    where id = ${current.id}
  `;

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "customer.suspended",
    targetType: "user",
    targetId: userId,
  });
}

/**
 * Lift a suspension. The stored expiry is untouched, so a customer restored
 * after their period lapsed correctly reports EXPIRED rather than being handed
 * back access the clock had already ended.
 */
export async function restoreCustomer(
  sql: Sql,
  actor: AdminActor,
  userId: string,
): Promise<void> {
  const current = await getSubscription(sql, userId);
  if (!current) throw new NotFoundError("This customer has no subscription to restore.");

  await sql`
    update subscriptions
    set status = 'ACTIVE', suspended_at = null, updated_at = now()
    where id = ${current.id}
  `;

  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "customer.restored",
    targetType: "user",
    targetId: userId,
  });
}

/**
 * All customers with their derived status, for the admin list.
 *
 * Derivation happens in JS via the shared `deriveStatus` rather than in SQL, so
 * there is exactly one definition of what ACTIVE/EXPIRED/SUSPENDED mean — a
 * second implementation in SQL is how the list and the dashboard end up
 * disagreeing.
 */
export async function listCustomersForAdmin(
  sql: Sql,
  now: Date = new Date(),
): Promise<AdminCustomer[]> {
  const users = await sql<{ id: string; email: string | null; name: string | null; createdAt: string | Date }>`
    select id, email, name, "createdAt" as "createdAt" from "user" order by "createdAt" desc
  `;

  const subs = await sql<{
    user_id: string;
    plan_id: string;
    status: string;
    expires_at: string | Date;
  }>`
    select user_id, plan_id, status, expires_at
    from subscriptions
    order by
      case status when 'SUSPENDED' then 0 when 'ACTIVE' then 1 else 2 end,
      expires_at desc
  `;

  const pending = await sql<{ user_id: string; count: number }>`
    select user_id, count(*)::int as count
    from payment_requests
    where status = 'PENDING'
    group by user_id
  `;

  // First row per user is the same "best" row `getSubscription` picks — the
  // queries share an ORDER BY, so list and per-user views cannot disagree.
  const best = new Map<string, (typeof subs)[number]>();
  for (const row of subs) if (!best.has(row.user_id)) best.set(row.user_id, row);
  const pendingByUser = new Map(pending.map((p) => [p.user_id, p.count]));

  return users.map((user) => {
    const sub = best.get(user.id) ?? null;
    const status = deriveStatus(
      sub
        ? {
            id: "",
            user_id: sub.user_id,
            plan_id: sub.plan_id,
            status: sub.status as "ACTIVE" | "EXPIRED" | "SUSPENDED",
            activated_at: "",
            expires_at: sub.expires_at,
            suspended_at: null,
          }
        : null,
      now,
    );
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      status,
      planId: sub?.plan_id ?? null,
      expiresAt:
        sub && status !== "FREE"
          ? sub.expires_at instanceof Date
            ? sub.expires_at.toISOString()
            : new Date(sub.expires_at).toISOString()
          : null,
      createdAt:
        user.createdAt instanceof Date
          ? user.createdAt.toISOString()
          : new Date(user.createdAt).toISOString(),
      pendingPayments: pendingByUser.get(user.id) ?? 0,
    };
  });
}

/** Promote a user to administrator. */
export async function grantAdmin(
  sql: Sql,
  actor: AdminActor,
  userId: string,
  note: string | null,
): Promise<void> {
  await sql`
    insert into admin_users (user_id, created_by, note)
    values (${userId}, ${actor.adminUserId}, ${note})
    on conflict (user_id) do nothing
  `;
  await audit(sql, {
    adminUserId: actor.adminUserId,
    action: "admin.granted",
    targetType: "admin_user",
    targetId: userId,
    detail: { granted: true },
  });
}