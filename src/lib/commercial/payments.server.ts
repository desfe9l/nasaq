/**
 * Payment requests — the customer's purchase attempt, and the admin's queue.
 *
 * A payment request records that a customer SAYS they paid. It is deliberately
 * not access: approving one writes an entitlement (see `entitlement.server.ts`).
 * Keeping the two apart is what makes "payment approved but account still not
 * active" impossible to reach by accident.
 *
 * Ownership is enforced in SQL, not by filtering afterwards: every customer-facing
 * read takes `userId` and matches it in the WHERE clause. A row belonging to
 * someone else is therefore indistinguishable from a row that does not exist —
 * which is the correct answer to hand an attacker probing another customer's id.
 *
 * Column lists are written as literals rather than interpolated: this app's SQL
 * shim parameterizes every interpolation, so an interpolated column list would
 * become `select $1` and fail.
 */
import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db";
import type {
  AdminPaymentRequest,
  CustomerPaymentRequest,
  PaymentRequestStatus,
} from "./types";

type PaymentRow = {
  id: string;
  user_id: string;
  plan_id: string;
  amount: string;
  currency: string;
  payment_method: string;
  payment_reference: string;
  customer_note: string | null;
  status: PaymentRequestStatus;
  created_at: string | Date;
  reviewed_at: string | Date | null;
  reviewed_by: string | null;
  admin_note: string | null;
};

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCustomerRequest(row: PaymentRow): CustomerPaymentRequest {
  return {
    id: row.id,
    planId: row.plan_id,
    amount: String(row.amount),
    currency: row.currency,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    customerNote: row.customer_note,
    status: row.status,
    createdAt: toIso(row.created_at) ?? "",
    reviewedAt: toIso(row.reviewed_at),
    adminNote: row.admin_note,
  };
}

/** A customer's own requests, newest first. Scoped by `user_id` in SQL. */
export async function listOwnPaymentRequests(
  sql: Sql,
  userId: string,
): Promise<CustomerPaymentRequest[]> {
  const rows = await sql<PaymentRow>`
    select id, user_id, plan_id, amount, currency, payment_method,
           payment_reference, customer_note, status, created_at, reviewed_at,
           reviewed_by, admin_note
    from payment_requests
    where user_id = ${userId}
    order by created_at desc
  `;
  return rows.map(toCustomerRequest);
}

/**
 * One request, but ONLY when it belongs to `userId`.
 *
 * Returns null for someone else's request, exactly as for a nonexistent id —
 * so this doubles as the IDOR defence for every per-request operation.
 */
export async function getOwnPaymentRequest(
  sql: Sql,
  userId: string,
  requestId: string,
): Promise<CustomerPaymentRequest | null> {
  const rows = await sql<PaymentRow>`
    select id, user_id, plan_id, amount, currency, payment_method,
           payment_reference, customer_note, status, created_at, reviewed_at,
           reviewed_by, admin_note
    from payment_requests
    where id = ${requestId} and user_id = ${userId}
    limit 1
  `;
  return rows[0] ? toCustomerRequest(rows[0]) : null;
}

/** True when the customer already has a request awaiting review. */
export async function hasPendingPaymentRequest(
  sql: Sql,
  userId: string,
): Promise<boolean> {
  const rows = await sql<{ count: number }>`
    select count(*)::int as count
    from payment_requests
    where user_id = ${userId} and status = 'PENDING'
  `;
  return (rows[0]?.count ?? 0) > 0;
}

/**
 * Record a new purchase attempt.
 *
 * `amount`/`currency` are COPIED from the plan at this moment: the customer was
 * quoted this price, and a later price change must not retroactively alter what
 * they are recorded as paying.
 */
export async function createPaymentRequest(
  sql: Sql,
  input: {
    userId: string;
    planId: string;
    amount: string;
    currency: string;
    paymentMethod: string;
    paymentReference: string;
    customerNote: string | null;
  },
): Promise<CustomerPaymentRequest> {
  const id = randomUUID();
  const rows = await sql<PaymentRow>`
    insert into payment_requests
      (id, user_id, plan_id, amount, currency, payment_method,
       payment_reference, customer_note, status)
    values
      (${id}, ${input.userId}, ${input.planId}, ${input.amount}, ${input.currency},
       ${input.paymentMethod}, ${input.paymentReference}, ${input.customerNote}, 'PENDING')
    returning id, user_id, plan_id, amount, currency, payment_method,
              payment_reference, customer_note, status, created_at, reviewed_at,
              reviewed_by, admin_note
  `;
  return toCustomerRequest(rows[0]);
}

/**
 * Cancel a PENDING request. Scoped by `user_id` AND `status = 'PENDING'`, so a
 * customer can neither cancel someone else's request nor cancel one an admin has
 * already decided.
 */
export async function cancelOwnPaymentRequest(
  sql: Sql,
  userId: string,
  requestId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    update payment_requests
    set status = 'CANCELLED', reviewed_at = now()
    where id = ${requestId} and user_id = ${userId} and status = 'PENDING'
    returning id
  `;
  return rows.length > 0;
}

// ── Admin reads ──────────────────────────────────────────────────────────────
// These carry customer identity and are reached only after an admin
// authorization check at the server-function boundary. They perform no
// authorization themselves — see `admin.server.ts`.

type AdminPaymentRow = PaymentRow & {
  user_email: string | null;
  user_name: string | null;
  has_live_subscription: boolean;
};

function toAdminRequest(row: AdminPaymentRow): AdminPaymentRequest {
  return {
    ...toCustomerRequest(row),
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    // A renewal is "this customer already has access", which tells the admin
    // whether approval extends an existing period or starts a fresh one.
    isRenewal: Boolean(row.has_live_subscription),
  };
}

/**
 * The admin review queue. `status` filters it; omit for every request.
 * PENDING rows sort first because that is the work an admin actually has to do.
 */
export async function listPaymentRequestsForAdmin(
  sql: Sql,
  status?: PaymentRequestStatus,
): Promise<AdminPaymentRequest[]> {
  const rows = status
    ? await sql<AdminPaymentRow>`
        select p.id, p.user_id, p.plan_id, p.amount, p.currency, p.payment_method,
               p.payment_reference, p.customer_note, p.status, p.created_at,
               p.reviewed_at, p.reviewed_by, p.admin_note,
               u.email as user_email, u.name as user_name,
               exists (
                 select 1 from subscriptions s
                 where s.user_id = p.user_id and s.status in ('ACTIVE', 'SUSPENDED')
               ) as has_live_subscription
        from payment_requests p
        left join "user" u on u.id = p.user_id
        where p.status = ${status}
        order by p.created_at asc
      `
    : await sql<AdminPaymentRow>`
        select p.id, p.user_id, p.plan_id, p.amount, p.currency, p.payment_method,
               p.payment_reference, p.customer_note, p.status, p.created_at,
               p.reviewed_at, p.reviewed_by, p.admin_note,
               u.email as user_email, u.name as user_name,
               exists (
                 select 1 from subscriptions s
                 where s.user_id = p.user_id and s.status in ('ACTIVE', 'SUSPENDED')
               ) as has_live_subscription
        from payment_requests p
        left join "user" u on u.id = p.user_id
        order by
          case p.status when 'PENDING' then 0 else 1 end,
          p.created_at desc
      `;
  return rows.map(toAdminRequest);
}

/** One request by id for an admin. No ownership filter — admin scope is wider. */
export async function getPaymentRequestForAdmin(
  sql: Sql,
  requestId: string,
): Promise<AdminPaymentRequest | null> {
  const rows = await sql<AdminPaymentRow>`
    select p.id, p.user_id, p.plan_id, p.amount, p.currency, p.payment_method,
           p.payment_reference, p.customer_note, p.status, p.created_at,
           p.reviewed_at, p.reviewed_by, p.admin_note,
           u.email as user_email, u.name as user_name,
           exists (
             select 1 from subscriptions s
             where s.user_id = p.user_id and s.status in ('ACTIVE', 'SUSPENDED')
           ) as has_live_subscription
    from payment_requests p
    left join "user" u on u.id = p.user_id
    where p.id = ${requestId}
    limit 1
  `;
  return rows[0] ? toAdminRequest(rows[0]) : null;
}

/**
 * Apply an admin decision.
 *
 * The `status = 'PENDING'` guard makes the transition safe against a double
 * click or two admins acting at once: the first decision wins and the second
 * returns false rather than silently overwriting it. Returns false when the
 * request was already decided.
 *
 * `reviewed_by` records the acting admin for accountability.
 */
export async function decidePaymentRequest(
  sql: Sql,
  input: {
    requestId: string;
    status: Exclude<PaymentRequestStatus, "PENDING" | "CANCELLED">;
    adminUserId: string;
    adminNote: string | null;
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    update payment_requests
    set status = ${input.status},
        reviewed_at = now(),
        reviewed_by = ${input.adminUserId},
        admin_note = ${input.adminNote}
    where id = ${input.requestId} and status = 'PENDING'
    returning id
  `;
  return rows.length > 0;
}