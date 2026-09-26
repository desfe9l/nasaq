/**
 * Gumroad gateway — server-side diagnostics and owner actions.
 * Imported only from `functions.ts` wrappers and the webhook route; never from
 * client code (import-protection keeps it that way).
 */

import { getSql } from "@/lib/db";
import { keygenPolicyId } from "@/lib/license/keygen";
import {
  gumroadApiConfigured,
  gumroadPingUrl,
  gumroadProductPermalink,
  gumroadProductId,
  gumroadPublicConfig,
  missingGumroadVariables,
  nasaqPublicOrigin,
  recommendedGumroadVariables,
  resolveGumroadProductId,
} from "./config.server";
import {
  DEFAULT_GUMROAD_PUBLIC_CONFIG,
  GUMROAD_PLAN_PRICE_CENTS,
  GUMROAD_PING_PATH,
  gumroadCheckoutUrl,
  listGumroadPlanKeys,
} from "./mapping";
import type { GumroadGatewayStatus, GumroadPingTestResult, GumroadReadyState, GumroadTierMappingStatus } from "./types";

/** Display origin for links (never throws when unset). */
function displayOrigin(): string {
  return nasaqPublicOrigin() || DEFAULT_GUMROAD_PUBLIC_CONFIG.storeBaseUrl;
}

const PLAN_LABEL_RECURRENCE: Record<string, string> = {
  "individual-monthly": "monthly",
  "individual-quarterly": "quarterly",
  "team-monthly": "monthly",
  "team-quarterly": "quarterly",
};

export async function buildGumroadGatewayStatus(): Promise<GumroadGatewayStatus> {
  const sql = await getSql();
  const config = gumroadPublicConfig();
  const missing = missingGumroadVariables();
  const recommended = recommendedGumroadVariables();

  // ── Product identity: the real id the runtime verifies with, and where it
  // came from. Never a secret — a product id is public information.
  const resolved = await resolveGumroadProductId();

  // ── Product status: verify against the live API when the token allows it.
  let remoteName: string | null = null;
  let remotePublished: boolean | null = null;
  let remoteChecked = false;
  let remoteProductCount: number | null = null;
  if (gumroadApiConfigured()) {
    try {
      const { listGumroadProducts } = await import("./api.server");
      const products = await listGumroadProducts();
      remoteChecked = true;
      remoteProductCount = products.length;
      const match =
        products.find((product) => product.permalink === gumroadProductPermalink()) ?? null;
      remoteName = match?.name ?? null;
      remotePublished = match?.published ?? null;
    } catch {
      remoteChecked = true;
    }
  }

  // ── Ping status: what has actually arrived on the live endpoint?
  const pingRows = await sql<{ status: string | null; note: string | null; received_at: string | Date }>`
    select status, note, received_at from gumroad_pings order by received_at desc limit 1
  `;
  const totals = await sql<{ status: string; count: number }>`
    select status, count(*)::int as count from gumroad_pings group by status
  `;
  const totalFor = (status: string) => totals.find((row) => row.status === status)?.count ?? 0;
  const last = pingRows[0];

  // ── Tier ↔ Keygen mapping status.
  const tierMapping: GumroadTierMappingStatus[] = listGumroadPlanKeys().map((planKey) => {
    const family = planKey.startsWith("team-") ? "team" : "individual";
    const recurrence = PLAN_LABEL_RECURRENCE[planKey];
    const policy = keygenPolicyId(planKey) || null;
    const state: GumroadReadyState = policy ? "Ready" : "Missing";
    return {
      planKey,
      tierName: config.tierNames[family],
      recurrence,
      checkoutUrl: gumroadCheckoutUrl(planKey, config),
      priceCents: GUMROAD_PLAN_PRICE_CENTS[planKey],
      keygenPolicyId: policy,
      state,
    };
  });

  const keygenMapping = listGumroadPlanKeys().map((planKey) => ({
    planKey,
    policyId: keygenPolicyId(planKey) || null,
    configured: Boolean(keygenPolicyId(planKey)),
  }));

  const subTotals = await sql<{ status: string; count: number }>`
    select status, count(*)::int as count from gumroad_subscriptions group by status
  `;
  const subTotal = subTotals.reduce((sum, row) => sum + row.count, 0);
  const pendingClaimRows = await sql<{ count: number }>`
    select count(*)::int as count from gumroad_subscriptions
    where bound_user_id is null and status in ('PENDING', 'ACTIVE', 'PAYMENT_FAILED')
  `;
  const unboundEmails = await sql<{ count: number }>`
    select count(distinct bound_email)::int as count from gumroad_subscriptions
    where bound_user_id is null and bound_email is not null
  `;

  const pingState: GumroadReadyState = last
    ? (last.status === "APPLIED" || last.status === "IGNORED"
        ? "Ready"
        : last.status === "UNVERIFIED"
          ? "Needs Setup"
          : last.status === "REJECTED"
            ? "Failed"
            : "Ready")
    : "Needs Setup";

  const boundCount = subTotals
    .filter((row) => row.status !== "PENDING")
    .reduce((sum, row) => sum + row.count, 0);

  return {
    mode: "Production",
    product: {
      permalink: gumroadProductPermalink(),
      storeBaseUrl: config.storeBaseUrl,
      productIdConfigured: Boolean(gumroadProductId()),
      productId: resolved.id,
      productIdSource: resolved.source,
      remoteProductCount,
      publicPageUrl: `${config.storeBaseUrl.replace(/\/+$/, "")}/l/${gumroadProductPermalink()}`,
      remoteName,
      remotePublished,
      remoteChecked,
      state: remoteChecked
        ? (remoteName ? (remotePublished === false ? "Failed" : "Ready") : "Failed")
        : resolved.id
          ? "Needs Setup"
          : "Missing",
    },
    api: {
      configured: gumroadApiConfigured(),
      reachable: remoteChecked ? remoteName != null : null,
      detail: gumroadApiConfigured()
        ? remoteChecked
          ? "تم التحقق من المفتاح عبر استدعاء حقيقي لـGumroad API."
          : "المفتاح مضبوط؛ لم يتم التحقق من الاتصال بعد."
        : "أضف GUMROAD_ACCESS_TOKEN في Vercel لتفعيل التحقق الآلي من البيع والاشتراكات.",
      state: gumroadApiConfigured() ? (remoteChecked ? (remoteName ? "Ready" : "Failed") : "Needs Setup") : "Missing",
    },
    ping: {
      endpointUrl: `${displayOrigin()}${GUMROAD_PING_PATH}`,
      state: pingState,
      lastPingAt: last ? new Date(last.received_at).toISOString() : null,
      lastPingStatus: last?.status ?? null,
      lastPingNote: last?.note ?? null,
      totals: {
        received: totals.reduce((sum, row) => sum + row.count, 0),
        applied: totalFor("APPLIED"),
        unverified: totalFor("UNVERIFIED"),
        rejected: totalFor("REJECTED"),
      },
    },
    binding: {
      total: subTotal,
      bound: boundCount,
      pendingClaim: pendingClaimRows[0]?.count ?? 0,
      unboundEmails: unboundEmails[0]?.count ?? 0,
      state: subTotal === 0
        ? "Needs Setup"
        : pendingClaimRows[0]?.count
          ? "Needs Setup"
          : boundCount === subTotal
            ? "Ready"
            : "Needs Setup",
    },
    tierMapping,
    keygenMapping,
    subscriptions: {
      total: subTotal,
      active: subTotals.find((row) => row.status === "ACTIVE")?.count ?? 0,
      pendingClaim: pendingClaimRows[0]?.count ?? 0,
      unboundEmails: unboundEmails[0]?.count ?? 0,
    },
    missingVariables: missing,
    recommendedVariables: recommended,
    generatedAt: new Date().toISOString(),
  };
}

/** Owner "Test Ping": synthetic test=true notification against the LIVE endpoint. */
export async function runGumroadPingTest(): Promise<GumroadPingTestResult> {
  const endpointUrl = gumroadPingUrl();
  const origin = displayOrigin();
  if (!origin || origin.includes("gumroad.com")) {
    return { ok: false, error: "public_origin_unconfigured", endpointUrl };
  }
  const body = new URLSearchParams({
    resource_name: "sale",
    test: "true",
    seller_id: "nasaq-selftest",
    product_id: gumroadProductId() || "nasaq-selftest",
    product_permalink: `https://${new URL(DEFAULT_GUMROAD_PUBLIC_CONFIG.storeBaseUrl).host}/l/${gumroadProductPermalink()}`,
    product_name: "NASAQ self test",
    sale_id: `nasaq-selftest-${Date.now()}`,
    email: "selftest@nasaq.invalid",
    price: "0",
    currency: "sar",
    recurrence: "monthly",
    variants: JSON.stringify({ Tier: gumroadPublicConfig().tierNames.individual }),
    sale_timestamp: new Date().toISOString(),
  });
  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const safePayload: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (["string", "number", "boolean"].includes(typeof value) || value === null) {
        safePayload[key] = value as string | number | boolean | null;
      }
    }
    if (!response.ok) {
      return { ok: false, error: `http_${response.status}`, endpointUrl };
    }
    return { ok: true, httpStatus: response.status, response: safePayload, endpointUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : "request_failed", endpointUrl };
  }
}

/** Owner "Test purchase verification": the verifier must REJECT unknown data. */
export async function runGumroadVerificationTest(): Promise<{ ok: boolean; detail: string; apiConfigured: boolean }> {
  const { verifyGumroadSale } = await import("./api.server");
  try {
    const result = await verifyGumroadSale({ saleId: `nasaq-negative-test-${Date.now()}`, licenseKey: null });
    if (result.via === "none") {
      return { ok: true, apiConfigured: gumroadApiConfigured(), detail: "المُحقق يرفض معرّف بيع غير معروف — سلوك آمن صحيح." };
    }
    return { ok: false, apiConfigured: gumroadApiConfigured(), detail: "تحذير: مُحقق قَبِل بيانات غير موجودة!" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (!gumroadApiConfigured()) {
      return { ok: true, apiConfigured: false, detail: `بدون مفتاح API يعمل المُحقق بوضع Fail-closed (${message}).` };
    }
    return { ok: false, apiConfigured: true, detail: `فشل استدعاء Gumroad API: ${message}` };
  }
}

/** Owner "Sync subscription": re-read membership state from the Gumroad API. */
export async function syncGumroadSubscription(email: string): Promise<{ ok: true; detail: string; subscriberStatus: string | null } | { ok: false; error: string }> {
  const sql = await getSql();
  const { findGumroadSubscriberByEmail } = await import("./api.server");
  let subscriber;
  try {
    subscriber = await findGumroadSubscriberByEmail(email);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "gumroad_api_failed" };
  }
  if (!subscriber) {
    return { ok: false, error: "subscriber_not_found" };
  }
  const status = subscriber.status;
  const mapped =
    status === "cancelled" || status === "pending_cancellation"
      ? "CANCELLED"
      : status === "failed_payment" || status === "pending_failure" || status === "payment_method_update_required"
        ? "PAYMENT_FAILED"
        : status === "fixed_subscription_period_ended"
          ? "ENDED"
          : "ACTIVE";
  // Scoped strictly by the buyer email; subscriptions bound to another account
  // are never modified, and refund/dispute states are preserved.
  await sql`
    update gumroad_subscriptions
    set status = case when status in ('REFUNDED', 'DISPUTED') then status else ${mapped} end,
        recurrence = coalesce(${subscriber.recurrence}, recurrence),
        last_verified_at = now(), updated_at = now()
    where lower(bound_email) = ${email}
  `;
  return { ok: true, detail: `حالة المشترك من Gumroad: ${status} → ${mapped}`, subscriberStatus: status };
}
