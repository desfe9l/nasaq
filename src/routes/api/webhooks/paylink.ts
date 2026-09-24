import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { getPaylinkInvoice, verifyPaylinkWebhookAuthorization } from "@/lib/paylink/server";
import {
  claimPaylinkTransaction,
  completePaylinkTransaction,
  failPaylinkTransaction,
  findPaylinkTransactionByNumber,
  recordPaylinkLicense,
  updatePaylinkStatus,
} from "@/lib/paylink/transactions.server";
import { grantEntitlement } from "@/lib/commercial/admin.server";
import { createKeygenLicense, findKeygenLicenseByPaylinkTransaction, type KeygenPlan } from "@/lib/license/keygen";
import { findLicenseByPaylinkTransaction, upsertExternalLicense } from "@/lib/license/server";
import { hashLicenseKey, keyPrefix } from "@/lib/license/key";
import { computeExpiry, getSubscription } from "@/lib/commercial/entitlement.server";

type PaylinkWebhookV2 = {
  amount?: unknown;
  transactionNo?: unknown;
  merchantOrderNumber?: unknown;
  orderStatus?: unknown;
  apiVersion?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function amount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function keygenPlan(planKey: string): KeygenPlan {
  if (planKey === "individual-monthly" || planKey === "individual-annual") return planKey;
  if (planKey === "team-monthly" || planKey === "team-annual") return planKey;
  throw new Error("Unsupported Paylink plan");
}

async function fulfillClaimedPaylink(sql: Awaited<ReturnType<typeof getSql>>, claimed: NonNullable<Awaited<ReturnType<typeof findPaylinkTransactionByNumber>>>): Promise<Response> {
  const transactionNo = claimed.transactionNo as string;
  try {
    const existingLicense = await findLicenseByPaylinkTransaction(transactionNo);
    const currentSubscription = await getSubscription(sql, claimed.userId);
    const live = currentSubscription && currentSubscription.status !== "EXPIRED" ? currentSubscription : null;
    const expiresAt = computeExpiry(claimed.planKey.endsWith("annual") ? 365 : 30, live);
    let license = existingLicense;
    let verification = null as Awaited<ReturnType<typeof createKeygenLicense>> | null;
    if (!license) {
      verification = await findKeygenLicenseByPaylinkTransaction(transactionNo);
      if (!verification) {
        verification = await createKeygenLicense({
          plan: keygenPlan(claimed.planKey), name: `NASAQ ${claimed.planKey} license`, expiresAt: expiresAt.toISOString(),
          metadata: { source: "keygen", paylinkTransactionNo: transactionNo, paylinkOrderNumber: claimed.orderNumber, nasaqUserId: claimed.userId, plan: claimed.planKey },
        });
      }
      license = await upsertExternalLicense({
        keyHash: hashLicenseKey(verification.key), keyPrefix: keyPrefix(verification.key), type: verification.type, userId: claimed.userId,
        expiresAt: verification.expiresAt, activationCount: verification.activationCount, maxActivations: verification.maxActivations, status: verification.status,
        metadata: { ...verification.metadata, paylinkTransactionNo: transactionNo, paylinkOrderNumber: claimed.orderNumber },
      });
    }
    await grantEntitlement(sql, { userId: claimed.userId, plan: { id: claimed.planId, durationDays: claimed.planKey.endsWith("annual") ? 365 : 30 }, sourceTransactionId: transactionNo, expiresAt });
    await recordPaylinkLicense(sql, { transactionNo, licenseId: license.id, keygenLicenseId: license.metadata?.keygenLicenseId || "", licenseKeyPrefix: license.keyPrefix, entitlementExpiresAt: expiresAt.toISOString() });
    await completePaylinkTransaction(sql, transactionNo);
    return Response.json({ received: true, applied: true }, { status: 200 });
  } catch (error) {
    await failPaylinkTransaction(sql, transactionNo, error instanceof Error ? error.message : "Paylink fulfillment failed");
    return Response.json({ error: "fulfillment_failed" }, { status: 500 });
  }
}


export const Route = createFileRoute("/api/webhooks/paylink")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyPaylinkWebhookAuthorization(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
        let payload: PaylinkWebhookV2;
        try { payload = (await request.json()) as PaylinkWebhookV2; } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
        if (text(payload.apiVersion) !== "v2") return Response.json({ error: "webhook_v2_required" }, { status: 400 });
        const transactionNo = text(payload.transactionNo);
        const orderNumber = text(payload.merchantOrderNumber);
        const orderStatus = text(payload.orderStatus);
        const paidAmount = amount(payload.amount);
        if (!transactionNo || !orderNumber || !orderStatus || paidAmount === null) return Response.json({ error: "invalid_payload" }, { status: 400 });
        if (orderStatus !== "Paid") {
          const sql = await getSql();
          await updatePaylinkStatus(sql, transactionNo, orderStatus === "Canceled" ? "CANCELED" : "PENDING", orderStatus);
          return Response.json({ received: true, applied: false });
        }
        const sql = await getSql();
        const transaction = await findPaylinkTransactionByNumber(sql, transactionNo);
        if (!transaction || transaction.orderNumber !== orderNumber) return Response.json({ error: "unknown_transaction" }, { status: 404 });
        if (Math.abs(Number(transaction.amount) - paidAmount) > 0.01) {
          await failPaylinkTransaction(sql, transactionNo, "Paylink amount does not match invoice");
          return Response.json({ error: "amount_mismatch" }, { status: 400 });
        }
        const remote = await getPaylinkInvoice(transactionNo);
        const remoteOrderNumber = String(remote.gatewayOrderRequest?.orderNumber || remote.orderNumber || "").trim();
        const remoteTransactionNo = String(remote.transactionNo || "").trim();
        if (!remoteOrderNumber || !remoteTransactionNo || remoteTransactionNo !== transactionNo || remoteOrderNumber !== orderNumber || String(remote.orderStatus || "") !== "Paid") {
          return Response.json({ received: true, applied: false });
        }
        const remoteAmount = amount(remote.amount ?? remote.gatewayOrderRequest?.amount);
        if (remoteAmount === null || Math.abs(Number(transaction.amount) - remoteAmount) > 0.01) {
          await failPaylinkTransaction(sql, transactionNo, "Paylink Get Invoice amount does not match invoice");
          return Response.json({ error: "remote_amount_mismatch" }, { status: 400 });
        }
        const claimed = await claimPaylinkTransaction(sql, transactionNo);
        if (!claimed) {
          const current = await findPaylinkTransactionByNumber(sql, transactionNo);
          return Response.json({ received: true, applied: current?.status === "PAID", duplicate: true }, { status: 200 });
        }
        return fulfillClaimedPaylink(sql, claimed);
      },
    },
  },
});
