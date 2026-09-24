import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import {
  getPaylinkInvoice,
  PAYLINK_WEBHOOK_API_VERSION,
  verifyPaylinkWebhookAuthorization,
} from "@/lib/paylink/server";
import {
  claimPaylinkTransaction,
  completePaylinkTransaction,
  failPaylinkTransaction,
  findPaylinkTransactionByNumber,
  recordPaylinkLicense,
  recordPaylinkWebhook,
  updatePaylinkStatus,
} from "@/lib/paylink/transactions.server";
import { audit, grantEntitlement } from "@/lib/commercial/admin.server";
import { createKeygenLicense, findKeygenLicenseByPaylinkTransaction, type KeygenPlan } from "@/lib/license/keygen";
import { findLicenseByPaylinkTransaction, upsertExternalLicense } from "@/lib/license/server";
import { hashLicenseKey, keyPrefix } from "@/lib/license/key";
import { computeExpiry, getSubscription } from "@/lib/commercial/entitlement.server";
import { getCatalogPlan, type PaylinkPlanKey } from "@/lib/commercial/catalog";

/**
 * Paylink Payment Webhook **V2** body.
 *
 * V2 adds the `apiVersion` marker, `paymentType` and the merchant identity
 * block on top of V1's five fields. `apiVersion` is the tripwire: a merchant
 * who left the webhook on V1 in My Paylink would otherwise send a payload that
 * silently satisfies every other check while carrying none of the fields this
 * handler reasons about.
 */
type PaylinkWebhookV2 = {
  amount?: unknown;
  transactionNo?: unknown;
  merchantOrderNumber?: unknown;
  orderStatus?: unknown;
  paymentType?: unknown;
  merchantMobile?: unknown;
  apiVersion?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function amount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveKeygenPlan(planKey: string): KeygenPlan {
  const catalog = getCatalogPlan(planKey);
  if (catalog) return catalog.keygenPolicyKey;
  if (planKey === "individual-monthly" || planKey === "individual-quarterly") return planKey;
  if (planKey === "team-monthly" || planKey === "team-quarterly") return planKey;
  if (planKey === "individual-annual" || planKey === "team-annual") return planKey;
  throw new Error(`Unsupported Paylink plan: ${planKey}`);
}

async function fulfillClaimedPaylink(
  sql: Awaited<ReturnType<typeof getSql>>,
  claimed: NonNullable<Awaited<ReturnType<typeof findPaylinkTransactionByNumber>>>,
): Promise<Response> {
  const transactionNo = claimed.transactionNo as string;
  try {
    const catalogPlan = getCatalogPlan(claimed.planKey as PaylinkPlanKey);
    const durationDays = catalogPlan?.durationDays ?? (claimed.planKey.includes("quarterly") ? 90 : claimed.planKey.includes("annual") ? 365 : 30);
    const existingLicense = await findLicenseByPaylinkTransaction(transactionNo);
    const currentSubscription = await getSubscription(sql, claimed.userId);
    const live = currentSubscription && currentSubscription.status !== "EXPIRED" ? currentSubscription : null;
    const expiresAt = computeExpiry(durationDays, live);

    let license = existingLicense;
    let verification = null as Awaited<ReturnType<typeof createKeygenLicense>> | null;
    if (!license) {
      verification = await findKeygenLicenseByPaylinkTransaction(transactionNo);
      if (!verification) {
        verification = await createKeygenLicense({
          plan: resolveKeygenPlan(claimed.planKey),
          name: `NASAQ ${catalogPlan?.name || claimed.planKey} License`,
          expiresAt: expiresAt.toISOString(),
          metadata: {
            source: "keygen",
            paylinkTransactionNo: transactionNo,
            paylinkOrderNumber: claimed.orderNumber,
            nasaqUserId: claimed.userId,
            plan: claimed.planKey,
          },
        });
      }
      license = await upsertExternalLicense({
        keyHash: hashLicenseKey(verification.key),
        keyPrefix: keyPrefix(verification.key),
        type: verification.type,
        userId: claimed.userId,
        expiresAt: verification.expiresAt,
        activationCount: verification.activationCount,
        maxActivations: verification.maxActivations,
        status: verification.status,
        metadata: {
          ...verification.metadata,
          paylinkTransactionNo: transactionNo,
          paylinkOrderNumber: claimed.orderNumber,
        },
      });
    }

    await grantEntitlement(sql, {
      userId: claimed.userId,
      plan: { id: claimed.planId, durationDays },
      sourceTransactionId: transactionNo,
      expiresAt,
    });

    await recordPaylinkLicense(sql, {
      transactionNo,
      licenseId: license.id,
      keygenLicenseId: license.metadata?.keygenLicenseId || "",
      licenseKeyPrefix: license.keyPrefix,
      entitlementExpiresAt: expiresAt.toISOString(),
    });

    await completePaylinkTransaction(sql, transactionNo);

    await audit(sql, {
      adminUserId: "system:paylink",
      action: "payment.approved",
      targetType: "paylink_transaction",
      targetId: transactionNo,
      detail: {
        orderNumber: claimed.orderNumber,
        planKey: claimed.planKey,
        amount: claimed.amount,
        userId: claimed.userId,
      },
    });

    return Response.json({ received: true, applied: true }, { status: 200 });
  } catch (error) {
    await failPaylinkTransaction(
      sql,
      transactionNo,
      error instanceof Error ? error.message : "Paylink fulfillment failed",
    );
    return Response.json({ error: "fulfillment_failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/webhooks/paylink")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyPaylinkWebhookAuthorization(request)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        let payload: PaylinkWebhookV2;
        try {
          payload = (await request.json()) as PaylinkWebhookV2;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        if (text(payload.apiVersion).toLowerCase() !== PAYLINK_WEBHOOK_API_VERSION) {
          return Response.json(
            {
              error: "webhook_v2_required",
              expected: PAYLINK_WEBHOOK_API_VERSION,
            },
            { status: 400 },
          );
        }

        const transactionNo = text(payload.transactionNo);
        const orderNumber = text(payload.merchantOrderNumber);
        const orderStatus = text(payload.orderStatus);
        const paidAmount = amount(payload.amount);

        if (!transactionNo || !orderNumber || !orderStatus || paidAmount === null) {
          return Response.json({ error: "invalid_payload" }, { status: 400 });
        }

        // ── Idempotency layer 1: record the envelope before deciding anything.
        //    A redelivery refreshes the audit columns without touching state.
        const sql = await getSql();
        await recordPaylinkWebhook(sql, {
          transactionNo,
          apiVersion: PAYLINK_WEBHOOK_API_VERSION,
          paymentType: text(payload.paymentType) || null,
          merchantOrderNumber: orderNumber,
          merchantMobile: text(payload.merchantMobile) || null,
          paid: orderStatus === "Paid",
        });

        // Only a settled order fulfils anything. "Pending", "Canceled",
        // "Failed" and every other status are recorded and acknowledged — never
        // treated as money.
        if (orderStatus !== "Paid") {
          await updatePaylinkStatus(
            sql,
            transactionNo,
            orderStatus === "Canceled" ? "CANCELED" : "PENDING",
            orderStatus,
          );
          return Response.json({ received: true, applied: false, orderStatus });
        }

        const transaction = await findPaylinkTransactionByNumber(sql, transactionNo);
        if (!transaction || transaction.orderNumber !== orderNumber) {
          return Response.json({ error: "unknown_transaction" }, { status: 404 });
        }

        // ── Idempotency layer 2: a transaction already fulfilled is a no-op.
        //    Paylink retries up to ten times; re-running fulfilment would mint a
        //    second Keygen licence for the same money.
        if (transaction.status === "PAID") {
          return Response.json(
            { received: true, applied: true, duplicate: true },
            { status: 200 },
          );
        }

        // Validate amount against the central catalog
        const catalogPlan = getCatalogPlan(transaction.planKey as PaylinkPlanKey);
        const expectedPrice = catalogPlan ? catalogPlan.amount : Number(transaction.amount);
        if (
          Math.abs(expectedPrice - paidAmount) > 0.01 ||
          Math.abs(Number(transaction.amount) - paidAmount) > 0.01
        ) {
          await failPaylinkTransaction(
            sql,
            transactionNo,
            "Paylink webhook amount does not match central catalog price",
          );
          return Response.json({ error: "amount_mismatch" }, { status: 400 });
        }

        // Remote verification via Get Invoice API
        const remote = await getPaylinkInvoice(transactionNo);
        const remoteOrderNumber = String(
          remote.gatewayOrderRequest?.orderNumber || remote.orderNumber || "",
        ).trim();
        const remoteTransactionNo = String(remote.transactionNo || "").trim();
        if (
          !remoteOrderNumber ||
          !remoteTransactionNo ||
          remoteTransactionNo !== transactionNo ||
          remoteOrderNumber !== orderNumber ||
          String(remote.orderStatus || "") !== "Paid"
        ) {
          return Response.json({ received: true, applied: false });
        }

        const remoteAmount = amount(remote.amount ?? remote.gatewayOrderRequest?.amount);
        if (remoteAmount === null || Math.abs(expectedPrice - remoteAmount) > 0.01) {
          await failPaylinkTransaction(
            sql,
            transactionNo,
            "Paylink Get Invoice amount does not match central catalog price",
          );
          return Response.json({ error: "remote_amount_mismatch" }, { status: 400 });
        }

        // Idempotency: claim transaction before writing any licenses
        const claimed = await claimPaylinkTransaction(sql, transactionNo);
        if (!claimed) {
          const current = await findPaylinkTransactionByNumber(sql, transactionNo);
          return Response.json(
            { received: true, applied: current?.status === "PAID", duplicate: true },
            { status: 200 },
          );
        }

        return fulfillClaimedPaylink(sql, claimed);
      },
    },
  },
});
