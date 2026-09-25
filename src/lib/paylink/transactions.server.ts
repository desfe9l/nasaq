import type { Sql } from "@/lib/db";
import type { AdminPaylinkTransaction, PaylinkPlanKey, PaylinkTransaction, PaylinkTransactionStatus } from "./types.ts";

type PaylinkRow = {
  id: string; user_id: string; order_number: string; transaction_no: string | null;
  plan_key: PaylinkPlanKey; plan_id: string; amount: string; currency: string;
  client_email: string | null; client_mobile: string | null; status: PaylinkTransactionStatus;
  paylink_order_status: string | null; license_id: string | null; keygen_license_id: string | null;
  license_key_prefix: string | null; entitlement_expires_at: string | Date | null;
  last_error: string | null; created_at: string | Date; processed_at: string | Date | null;
  api_version?: string | null; payment_type?: string | null;
  merchant_order_number?: string | null; merchant_mobile?: string | null;
  paid_at?: string | Date | null;
};
type AdminRow = PaylinkRow & { user_email: string | null; user_name: string | null; license_status: "ACTIVE" | "EXPIRED" | "REVOKED" | null; license_bound: boolean };
function iso(value: string | Date | null | undefined): string | null { return value == null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function mapRow(row: PaylinkRow): PaylinkTransaction {
  return {
    id: row.id, userId: row.user_id, orderNumber: row.order_number, transactionNo: row.transaction_no,
    planKey: row.plan_key, planId: row.plan_id, amount: String(row.amount), currency: row.currency,
    clientEmail: row.client_email, clientMobile: row.client_mobile, status: row.status,
    paylinkOrderStatus: row.paylink_order_status, licenseId: row.license_id, keygenLicenseId: row.keygen_license_id,
    licenseKey: row.license_key_prefix, licenseStatus: null, entitlementExpiresAt: iso(row.entitlement_expires_at),
    lastError: row.last_error, createdAt: iso(row.created_at) || "", processedAt: iso(row.processed_at),
    apiVersion: row.api_version ?? null,
    paymentType: row.payment_type ?? null,
    merchantOrderNumber: row.merchant_order_number ?? null,
    merchantMobile: row.merchant_mobile ?? null,
    paidAt: iso(row.paid_at),
  };
}

export async function findPaylinkTransactionByNumber(sql: Sql, transactionNo: string): Promise<PaylinkTransaction | null> {
  const rows = await sql<PaylinkRow>`select * from paylink_transactions where transaction_no = ${transactionNo} limit 1`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function claimPaylinkTransaction(sql: Sql, transactionNo: string): Promise<PaylinkTransaction | null> {
  const rows = await sql<PaylinkRow>`
    update paylink_transactions
    set status = 'PROCESSING', processing_started_at = now(), updated_at = now()
    where transaction_no = ${transactionNo}
      and (status in ('PENDING', 'FAILED') or (status = 'PROCESSING' and processing_started_at < now() - interval '15 minutes'))
    returning *
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function updatePaylinkStatus(sql: Sql, transactionNo: string, status: PaylinkTransactionStatus, orderStatus: string): Promise<void> {
  await sql`update paylink_transactions set status = ${status}, paylink_order_status = ${orderStatus}, updated_at = now() where transaction_no = ${transactionNo} and status <> 'PAID'`;
}

export async function recordPaylinkLicense(sql: Sql, input: { transactionNo: string; licenseId: string; keygenLicenseId: string; licenseKeyPrefix: string; entitlementExpiresAt: string }): Promise<void> {
  await sql`update paylink_transactions set license_id = ${input.licenseId}, keygen_license_id = ${input.keygenLicenseId}, license_key_prefix = ${input.licenseKeyPrefix}, entitlement_expires_at = ${input.entitlementExpiresAt}, last_error = null, updated_at = now() where transaction_no = ${input.transactionNo}`;
}

export async function completePaylinkTransaction(sql: Sql, transactionNo: string): Promise<void> {
  await sql`update paylink_transactions set status = 'PAID', processed_at = now(), processing_started_at = null, updated_at = now() where transaction_no = ${transactionNo}`;
}

export async function failPaylinkTransaction(sql: Sql, transactionNo: string, message: string): Promise<void> {
  await sql`update paylink_transactions set status = 'FAILED', last_error = ${message.slice(0, 500)}, processing_started_at = null, updated_at = now() where transaction_no = ${transactionNo} and status <> 'PAID'`;
}

export async function getPaylinkTransactionForUser(sql: Sql, userId: string, transactionNo: string): Promise<PaylinkTransaction | null> {
  const rows = await sql<PaylinkRow>`select * from paylink_transactions where user_id = ${userId} and transaction_no = ${transactionNo} limit 1`;
  return rows[0] ? mapRow(rows[0]) : null;
}

/**
 * Record the V2 callback envelope on the transaction.
 *
 * Written BEFORE any licence or entitlement work and never gated on status !=
 * 'PAID', so a redelivered webhook still refreshes the audit columns without
 * disturbing the row that fulfilment already completed.
 */
export async function recordPaylinkWebhook(sql: Sql, input: {
  transactionNo: string;
  apiVersion: string;
  paymentType: string | null;
  merchantOrderNumber: string | null;
  merchantMobile: string | null;
  paid: boolean;
}): Promise<void> {
  await sql`
    update paylink_transactions
    set api_version = ${input.apiVersion},
        payment_type = ${input.paymentType},
        merchant_order_number = ${input.merchantOrderNumber},
        merchant_mobile = ${input.merchantMobile},
        webhook_received_at = now(),
        paid_at = case when ${input.paid} then coalesce(paid_at, now()) else paid_at end,
        updated_at = now()
    where transaction_no = ${input.transactionNo}
  `;
}

export async function getLatestPaylinkTransactionForUser(sql: Sql, userId: string): Promise<PaylinkTransaction | null> {
  const rows = await sql<PaylinkRow>`select * from paylink_transactions where user_id = ${userId} order by created_at desc limit 1`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listPaylinkTransactionsForAdmin(sql: Sql, limit = 100): Promise<AdminPaylinkTransaction[]> {
  const rows = await sql<AdminRow>`
    select p.*, u.email as user_email, u.name as user_name, l.status as license_status,
      (l.metadata->>'userScopeVerified' = p.user_id) as license_bound
    from paylink_transactions p
    left join "user" u on u.id = p.user_id
    left join licenses l on l.id = p.license_id
    order by p.created_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({ ...mapRow(row), userEmail: row.user_email, userName: row.user_name,
    licenseStatus: row.license_status, licenseBound: row.license_bound === true }));
}
