/**
 * Gumroad Ping / Resource-subscription processing — the post-sale brain.
 *
 * Trust model (nothing here may be relaxed by a caller):
 *
 *  1. A ping is an NOTIFICATION, not proof. Every monetary claim inside it is
 *     re-verified server-side against Gumroad (API sale fetch, or the tokenless
 *     license-verify endpoint) before anything is fulfilled.
 *  2. `test=true` pings are connectivity checks only: recorded, answered 200,
 *     never fulfilled.
 *  3. Replays die on `gumroad_pings.dedupe_key` (unique) — Gumroad retries the
 *     same notification many times.
 *  4. Buyer → account binding happens by exact match between the VERIFIED
 *     buyer email and the Better Auth account email. A userId is never read
 *     from the request, and `bound_user_id` is written once — a second account
 *     can never take over a bound subscription.
 *  5. Keygen stays the licensing authority: this module only drives it (mint /
 *     extend / suspend) through `gumroad-fulfillment.server`.
 *
 * The verification and license operations are injected (`GumroadPipelineDeps`)
 * so tests can run the whole state machine on fixtures; production always gets
 * `productionGumroadPipelineDeps`, which talks to the real Gumroad API and the
 * real Keygen account. Fixtures are never wired into a deployed runtime.
 */

import type { Sql } from "../db.ts";
import { getCatalogPlan } from "../commercial/catalog.ts";
import type { KeygenPlan } from "@/lib/license/keygen.ts";
import {
  type GumroadSaleView,
  type GumroadVerificationResult,
  verifyGumroadSale,
} from "./api.server.ts";
import {
  gumroadPriceMatches,
  isGumroadPlanKey,
  normalizeGumroadRecurrence,
  resolveGumroadPlanKey,
  type GumroadPlanKey,
} from "./mapping.ts";
import {
  computeGumroadExpiry,
  endGumroadEntitlement,
  grantGumroadEntitlement,
  reinstateGumroadEntitlement,
  resolveUserIdForBuyerEmail,
  suspendGumroadEntitlement,
  newGumroadRowId,
} from "./entitlement.server.ts";
import {
  issueGumroadKeygenLicense,
  renewGumroadKeygenLicense,
  restoreGumroadKeygenLicense,
  revokeGumroadKeygenLicense,
} from "../license/gumroad-fulfillment.server.ts";

export type GumroadPingKind =
  | "sale"
  | "refund"
  | "dispute"
  | "dispute_won"
  | "cancellation"
  | "subscription_updated"
  | "subscription_ended"
  | "subscription_restarted"
  | "unknown";

export interface GumroadPingFields {
  raw: Record<string, string>;
  variants: Record<string, string>;
  resourceName: string | null;
  saleId: string | null;
  subscriptionId: string | null;
  productId: string | null;
  productPermalink: string | null;
  email: string | null;
  licenseKey: string | null;
  recurrence: string | null;
  isRecurringCharge: boolean;
  refunded: boolean;
  disputed: boolean;
  disputeWon: boolean;
  chargebacked: boolean;
  cancelledAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  restartedAt: string | null;
  effectiveAsOf: string | null;
  priceCents: number | null;
  currency: string | null;
  test: boolean;
}

/** Parse a Gumroad notification body (form-encoded, optionally with bracketed
 *  nested keys like variants[Tier], or JSON). Returns null when unusable. */
export function parseGumroadPingBody(rawBody: string, contentType: string | null): GumroadPingFields | null {
  if (!rawBody || rawBody.length > 256_000) return null;
  let flat: Record<string, string>;
  if (contentType?.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      flat = flattenJson(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  } else {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(rawBody);
    } catch {
      return null;
    }
    flat = {};
    for (const [key, value] of params.entries()) flat[key] = value;
  }
  const variants: Record<string, string> = {};
  const raw: Record<string, string> = {};
  const bracket = /^([a-zA-Z0-9_]+)\[([^\]]+)\]$/;
  for (const [key, value] of Object.entries(flat)) {
    raw[key] = value;
    const match = bracket.exec(key);
    if (match?.[1] === "variants" || match?.[1] === "custom_fields") {
      if (match[1] === "variants") variants[match[2]] = value;
      continue;
    }
    if (key === "variants") {
      const parsedVariants = parseVariantsValue(value);
      if (parsedVariants) Object.assign(variants, parsedVariants);
    }
  }
  return {
    raw,
    variants,
    resourceName: pick(flat, "resource_name"),
    saleId: pick(flat, "sale_id"),
    subscriptionId: pick(flat, "subscription_id"),
    productId: pick(flat, "product_id"),
    productPermalink: pick(flat, "product_permalink"),
    email: pick(flat, "email"),
    licenseKey: pick(flat, "license_key"),
    recurrence: pick(flat, "recurrence"),
    isRecurringCharge: truthy(flat, "is_recurring_charge"),
    refunded: truthy(flat, "refunded"),
    disputed: truthy(flat, "disputed"),
    disputeWon: truthy(flat, "dispute_won"),
    chargebacked: truthy(flat, "chargebacked"),
    cancelledAt: pick(flat, "cancelled_at"),
    endedAt: pick(flat, "ended_at"),
    endedReason: pick(flat, "ended_reason"),
    restartedAt: pick(flat, "restarted_at"),
    effectiveAsOf: pick(flat, "effective_as_of"),
    priceCents: numeric(flat, "price"),
    currency: pick(flat, "currency"),
    test: truthy(flat, "test"),
  };
}

/** Which lifecycle event this notification describes. */
export function classifyGumroadPing(fields: GumroadPingFields): GumroadPingKind {
  const resource = fields.resourceName?.trim().toLowerCase();
  const known: GumroadPingKind[] = [
    "sale",
    "refund",
    "dispute",
    "dispute_won",
    "cancellation",
    "subscription_updated",
    "subscription_ended",
    "subscription_restarted",
  ];
  if (resource && (known as string[]).includes(resource)) {
    // A classic sale ping that ALSO carries money-back flags outranks the
    // resource name: Gumroad reuses the sale payload for refunds/disputes.
    if (resource === "sale" && (fields.refunded || fields.chargebacked)) return "refund";
    if (resource === "sale" && fields.disputed) return fields.disputeWon ? "dispute_won" : "dispute";
    return resource as GumroadPingKind;
  }
  if (fields.refunded || fields.chargebacked) return "refund";
  if (fields.disputed) return fields.disputeWon ? "dispute_won" : "dispute";
  if (fields.endedAt) return "subscription_ended";
  if (fields.restartedAt) return "subscription_restarted";
  if (fields.cancelledAt) return "cancellation";
  if (fields.saleId) return "sale";
  return "unknown";
}

/**
 * Replay boundary. Sale-shaped resources dedupe on sale_id; membership events
 * dedupe on subscription_id plus their own timestamp; tests never dedupe.
 */
export function gumroadDedupeKey(kind: GumroadPingKind, fields: GumroadPingFields): string | null {
  if (fields.test) return `test:${fields.saleId || fields.subscriptionId || "ping"}:${Date.now()}`;
  switch (kind) {
    case "sale":
    case "refund":
    case "dispute":
    case "dispute_won":
      return fields.saleId ? `${kind}:${fields.saleId}` : null;
    case "cancellation":
      return fields.subscriptionId ? `${kind}:${fields.subscriptionId}:${fields.cancelledAt || ""}` : null;
    case "subscription_updated":
      return fields.subscriptionId ? `${kind}:${fields.subscriptionId}:${fields.effectiveAsOf || ""}` : null;
    case "subscription_ended":
      return fields.subscriptionId ? `${kind}:${fields.subscriptionId}:${fields.endedAt || ""}` : null;
    case "subscription_restarted":
      return fields.subscriptionId ? `${kind}:${fields.subscriptionId}:${fields.restartedAt || ""}` : null;
    default:
      return null;
  }
}

/** Injectable side effects — production impl at the bottom of this file. */
export interface GumroadPipelineDeps {
  verify(input: { saleId: string | null; licenseKey: string | null }): Promise<GumroadVerificationResult>;
  issue(input: {
    saleId: string;
    subscriptionId: string;
    userId: string;
    userEmail: string;
    plan: KeygenPlan;
    planName: string;
    expiresAt: string;
    recurringCharge: boolean;
  }): Promise<{ id: string; expiresAt: string }>;
  renew(input: {
    subscriptionId: string;
    userId: string;
    userEmail: string;
    plan: KeygenPlan;
    expiresAt: string;
  }): Promise<{ id: string; expiresAt: string }>;
  revoke(input: { subscriptionId: string; userId: string | null }): Promise<boolean>;
  restore(input: { subscriptionId: string }): Promise<boolean>;
}

export type GumroadPingOutcome = {
  status: number;
  body: {
    received: true;
    applied: boolean;
    duplicate?: boolean;
    verified?: boolean;
    test?: boolean;
    reason?: string;
  };
  kind: GumroadPingKind;
  note?: string;
};

/**
 * Process one parsed notification against the DB. All failures that mean
 * "Gumroad should retry" throw; every accepted notification resolves to a 2xx
 * outcome. This is the function tests drive with fixtures.
 */
export async function handleGumroadNotification(
  sql: Sql,
  fields: GumroadPingFields,
  deps: GumroadPipelineDeps,
): Promise<GumroadPingOutcome> {
  const kind = classifyGumroadPing(fields);
  const dedupeKey = gumroadDedupeKey(kind, fields);

  // ── Idempotency: claim the notification before any other write.
  let duplicate = false;
  if (dedupeKey) {
    const inserted = await sql<{ id: string }>`
      insert into gumroad_pings (id, resource_name, dedupe_key, sale_id, subscription_id, product_id, email, is_test, status, payload)
      values (${newGumroadRowId("ping")}, ${kind}, ${dedupeKey}, ${fields.saleId}, ${fields.subscriptionId},
              ${fields.productId}, ${fields.email}, ${fields.test}, 'RECEIVED', ${JSON.stringify(redactForStorage(fields))}::jsonb)
      on conflict (dedupe_key) do nothing
      returning id
    `;
    if (!inserted[0]) duplicate = true;
  }

  if (duplicate) {
    return { status: 200, kind, body: { received: true, applied: false, duplicate: true } };
  }

  // ── Test ping: acknowledge connectivity, never touch money or licenses.
  if (fields.test) {
    await notePing(sql, dedupeKey, "IGNORED", "test ping acknowledged (no fulfillment)");
    return {
      status: 200,
      kind,
      body: { received: true, applied: false, test: true },
      note: "test ping acknowledged",
    };
  }

  if (kind === "unknown" || (!fields.saleId && !fields.subscriptionId)) {
    await notePing(sql, dedupeKey, "IGNORED", "unrecognized notification shape");
    return { status: 200, kind, body: { received: true, applied: false, reason: "unrecognized" } };
  }

  const outcome = await applyNotification(sql, fields, kind, deps);
  await notePing(sql, dedupeKey, outcome.pingStatus, outcome.note ?? null);
  return { status: 200, kind, body: { received: true, applied: outcome.applied, verified: outcome.verified, reason: outcome.reason }, note: outcome.note };
}

type Applied = {
  applied: boolean;
  verified: boolean;
  pingStatus: "APPLIED" | "IGNORED" | "UNVERIFIED" | "REJECTED" | "FAILED";
  reason?: string;
  note?: string;
};

async function applyNotification(
  sql: Sql,
  fields: GumroadPingFields,
  kind: GumroadPingKind,
  deps: GumroadPipelineDeps,
): Promise<Applied> {
  // Membership lifecycle events without a charge attached (cancel/ended/
  // restart/update) are keyed by subscription, not by a sale to verify.
  if (kind === "cancellation") return applyCancellation(sql, fields);
  if (kind === "subscription_ended") return applySubscriptionEnded(sql, fields);
  if (kind === "subscription_restarted") return applySubscriptionRestarted(sql, fields);
  if (kind === "subscription_updated") return applySubscriptionUpdated(sql, fields);

  // Everything else carries (or references) money → verify the sale first.
  const verification = await deps.verify({ saleId: fields.saleId, licenseKey: fields.licenseKey });
  if (verification.via === "none") {
    if (fields.saleId) {
      await recordSaleRow(sql, fields, { verified: false, via: "none" });
    }
    return {
      applied: false,
      verified: false,
      pingStatus: "UNVERIFIED",
      reason: verification.reason,
      note: `sale could not be verified server-side (${verification.reason})`,
    };
  }
  const sale = verification.sale;

  // The verified sale must belong to THIS product. When the ping and the
  // verified record disagree about the product, treat the ping as tampering.
  const verifiedProductId = sale.productId;
  if (fields.productId && verifiedProductId && fields.productId !== verifiedProductId) {
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "product_mismatch", note: "ping product does not match verified sale product" };
  }

  if (fields.saleId && fields.saleId !== sale.saleId) {
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "sale_mismatch", note: "verified sale id differs from the ping" };
  }

  const moneyBack = kind === "refund" || sale.refunded || sale.chargedback;
  const disputeLost = kind === "dispute" || (sale.disputed && !sale.disputeWon);
  const disputeWon = kind === "dispute_won" || (sale.disputed && sale.disputeWon);

  await recordSaleRow(sql, fields, {
    verified: true,
    via: verification.via,
    sale,
  });

  const subscriptionId = sale.subscriptionId ?? fields.subscriptionId ?? `sale-${sale.saleId}`;
  await upsertGumroadSubscription(sql, {
    subscriptionId,
    productId: sale.productId,
    tierName: tierFrom(sale, fields),
    planKey: null,
    recurrence: normalizeGumroadRecurrence(sale.recurrence ?? fields.recurrence),
    email: sale.email,
    lastSaleId: sale.saleId,
  });

  if (moneyBack) return applyRefund(sql, subscriptionId, sale.email, deps);
  if (disputeLost) return applyDisputeLost(sql, subscriptionId, sale.email, deps);
  if (disputeWon) return applyDisputeWon(sql, subscriptionId, sale.email, deps);

  // A plain paid charge: map the tier, check the price, then mint or extend.
  const planKey = resolveGumroadPlanKey({
    variants: sale.variants ?? fields.variants,
    recurrence: sale.recurrence ?? fields.recurrence,
  });
  if (!planKey || !isGumroadPlanKey(planKey)) {
    await sql`update gumroad_subscriptions set last_error = 'tier_unmapped', updated_at = now() where subscription_id = ${subscriptionId}`;
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "tier_unmapped", note: "Gumroad tier does not map to a NASAQ plan" };
  }
  await sql`
    update gumroad_subscriptions
    set plan_key = ${planKey}, tier_name = ${tierFrom(sale, fields)}, recurrence = ${normalizeGumroadRecurrence(sale.recurrence ?? fields.recurrence)},
        last_verified_at = now(), last_error = null, updated_at = now()
    where subscription_id = ${subscriptionId}
  `;
  if (!gumroadPriceMatches(planKey, sale.priceCents, sale.currency ?? fields.currency)) {
    await sql`update gumroad_subscriptions set last_error = 'amount_mismatch', updated_at = now() where subscription_id = ${subscriptionId}`;
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "amount_mismatch", note: `verified amount does not match the NASAQ catalog price for ${planKey}` };
  }

  const binding = await bindSubscription(sql, subscriptionId, sale.email);
  if (binding.conflict) {
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "binding_conflict", note: "subscription is already bound to another NASAQ account" };
  }
  const userId = binding.userId;
  if (!userId) {
    // Buyer has no NASAQ account yet: the membership stays PENDING-claim and is
    // fulfilled the moment they sign in with this exact email.
    await sql`
      update gumroad_subscriptions
      set status = 'ACTIVE', last_sale_id = ${sale.saleId}, last_verified_at = now(), updated_at = now()
      where subscription_id = ${subscriptionId}
    `;
    await markSaleApplied(sql, sale.saleId);
    return {
      applied: true,
      verified: true,
      pingStatus: "APPLIED",
      note: "payment verified; membership recorded — awaiting first NASAQ sign-in with the buyer email",
    };
  }
  return fulfillCharge(sql, {
    subscriptionId,
    saleId: sale.saleId,
    userId,
    userEmail: sale.email,
    planKey,
    recurringCharge: sale.recurringCharge || fields.isRecurringCharge,
    deps,
  });
}

export async function fulfillCharge(
  sql: Sql,
  input: {
    subscriptionId: string;
    saleId: string;
    userId: string;
    userEmail: string;
    planKey: GumroadPlanKey;
    recurringCharge: boolean;
    deps: GumroadPipelineDeps;
  },
): Promise<Applied> {
  const plan = getCatalogPlan(input.planKey);
  if (!plan) throw new Error(`catalog plan missing for ${input.planKey}`);
  // Check the CURRENT entitlement state before minting or extending Keygen.
  const expiresAt = await computeGumroadExpiry(sql, { userId: input.userId, planKey: input.planKey });

  const { findLicenseByGumroadSubscription } = await import("../license/server.ts");
  const existing = await findLicenseByGumroadSubscription(input.subscriptionId);
  const license = existing
    ? await input.deps.renew({
        subscriptionId: input.subscriptionId,
        userId: input.userId,
        userEmail: input.userEmail,
        plan: plan.keygenPolicyKey,
        expiresAt: expiresAt.toISOString(),
      })
    : await input.deps.issue({
        saleId: input.saleId,
        subscriptionId: input.subscriptionId,
        userId: input.userId,
        userEmail: input.userEmail,
        plan: plan.keygenPolicyKey,
        planName: plan.name,
        expiresAt: expiresAt.toISOString(),
        recurringCharge: input.recurringCharge,
      });

  // Keygen's expiry is the authority; the entitlement row copies it.
  const granted = await grantGumroadEntitlement(sql, {
    userId: input.userId,
    planKey: input.planKey,
    saleId: input.saleId,
    expiresAt: new Date(license.expiresAt || expiresAt.toISOString()),
  });

  await sql`
    update gumroad_subscriptions
    set status = 'ACTIVE', bound_user_id = ${input.userId}, claimed_at = coalesce(claimed_at, now()),
        keygen_license_id = ${license.id}, last_sale_id = ${input.saleId},
        last_verified_at = now(), last_error = null, updated_at = now()
    where subscription_id = ${input.subscriptionId}
  `;
  await markSaleApplied(sql, input.saleId);
  return {
    applied: true,
    verified: true,
    pingStatus: "APPLIED",
    note: `Keygen license ${license.id} active until ${granted.expiresAt.toISOString()}`,
  };
}

async function applyRefund(sql: Sql, subscriptionId: string, email: string, deps: GumroadPipelineDeps): Promise<Applied> {
  const binding = await bindSubscription(sql, subscriptionId, email);
  if (binding.conflict) {
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "binding_conflict" };
  }
  const revoked = await deps.revoke({ subscriptionId, userId: binding.userId });
  if (binding.userId) await endGumroadEntitlement(sql, binding.userId);
  await sql`
    update gumroad_subscriptions
    set status = 'REFUNDED', last_verified_at = now(), updated_at = now()
    where subscription_id = ${subscriptionId}
  `;
  return { applied: true, verified: true, pingStatus: "APPLIED", note: revoked ? "access revoked (refund)" : "membership marked refunded" };
}

async function applyDisputeLost(sql: Sql, subscriptionId: string, email: string, deps: GumroadPipelineDeps): Promise<Applied> {
  const binding = await bindSubscription(sql, subscriptionId, email);
  if (binding.conflict) {
    return { applied: false, verified: true, pingStatus: "REJECTED", reason: "binding_conflict" };
  }
  const revoked = await deps.revoke({ subscriptionId, userId: binding.userId });
  if (binding.userId) await suspendGumroadEntitlement(sql, binding.userId);
  await sql`
    update gumroad_subscriptions
    set status = 'DISPUTED', last_verified_at = now(), updated_at = now()
    where subscription_id = ${subscriptionId}
  `;
  return { applied: true, verified: true, pingStatus: "APPLIED", note: revoked ? "access suspended (dispute)" : "membership marked disputed" };
}

async function applyDisputeWon(sql: Sql, subscriptionId: string, email: string, deps: GumroadPipelineDeps): Promise<Applied> {
  const restored = await deps.restore({ subscriptionId });
  if (restored) {
    const rows = await sql<{ bound_user_id: string | null }>`
      select bound_user_id from gumroad_subscriptions where subscription_id = ${subscriptionId} limit 1
    `;
    const userId = rows[0]?.bound_user_id ?? null;
    if (userId) await reinstateGumroadEntitlement(sql, userId);
    await sql`
      update gumroad_subscriptions
      set status = case when status = 'DISPUTED' then 'ACTIVE' else status end,
          last_verified_at = now(), updated_at = now()
      where subscription_id = ${subscriptionId}
    `;
  }
  return { applied: true, verified: true, pingStatus: "APPLIED", note: restored ? "access restored (dispute won)" : "dispute won recorded" };
}

async function applyCancellation(sql: Sql, fields: GumroadPingFields): Promise<Applied> {
  const subscriptionId = fields.subscriptionId;
  if (!subscriptionId) return { applied: false, verified: false, pingStatus: "IGNORED", reason: "missing_subscription" };
  const updated = await sql<{ subscription_id: string }>`
    update gumroad_subscriptions
    set status = case when status in ('PENDING', 'ACTIVE', 'PAYMENT_FAILED') then 'CANCELLED' else status end,
        last_verified_at = now(), updated_at = now()
    where subscription_id = ${subscriptionId}
    returning subscription_id
  `;
  // Unknown membership: record the row so a later sale for it still binds safely.
  if (!updated[0]) {
    await upsertGumroadSubscription(sql, {
      subscriptionId,
      productId: fields.productId || "unknown",
      tierName: null,
      planKey: null,
      recurrence: normalizeGumroadRecurrence(fields.recurrence),
      email: fields.email,
      lastSaleId: null,
    });
    await sql`update gumroad_subscriptions set status = 'CANCELLED', updated_at = now() where subscription_id = ${subscriptionId}`;
  }
  // Cancellation stops FUTURE charges; paid time continues to its end.
  return { applied: true, verified: false, pingStatus: "APPLIED", note: "membership cancelled — paid period continues to its end" };
}

async function applySubscriptionEnded(sql: Sql, fields: GumroadPingFields): Promise<Applied> {
  const subscriptionId = fields.subscriptionId;
  if (!subscriptionId) return { applied: false, verified: false, pingStatus: "IGNORED", reason: "missing_subscription" };
  const rows = await sql<{ bound_user_id: string | null; status: string }>`
    select bound_user_id, status from gumroad_subscriptions where subscription_id = ${subscriptionId} limit 1
  `;
  if (!rows[0]) {
    await upsertGumroadSubscription(sql, {
      subscriptionId,
      productId: fields.productId || "unknown",
      tierName: null,
      planKey: null,
      recurrence: normalizeGumroadRecurrence(fields.recurrence),
      email: fields.email,
      lastSaleId: null,
    });
  }
  await sql`
    update gumroad_subscriptions
    set status = 'ENDED', last_verified_at = now(),
        last_error = ${fields.endedReason ?? null}, updated_at = now()
    where subscription_id = ${subscriptionId}
  `;
  const userId = rows[0]?.bound_user_id ?? (fields.email ? (await bindSubscription(sql, subscriptionId, fields.email)).userId : null);
  // Gumroad sends this only once the subscription has OFFICIALLY ended — the
  // paid period is over, so access ends now.
  if (userId) await endGumroadEntitlement(sql, userId);
  return { applied: true, verified: false, pingStatus: "APPLIED", note: `membership ended (${fields.endedReason || "unknown reason"})` };
}

async function applySubscriptionRestarted(sql: Sql, fields: GumroadPingFields): Promise<Applied> {
  const subscriptionId = fields.subscriptionId;
  if (!subscriptionId) return { applied: false, verified: false, pingStatus: "IGNORED", reason: "missing_subscription" };
  await sql`
    update gumroad_subscriptions
    set status = case when status in ('CANCELLED', 'ENDED') then 'PENDING' else status end,
        last_verified_at = now(), updated_at = now()
    where subscription_id = ${subscriptionId}
  `;
  return { applied: true, verified: false, pingStatus: "APPLIED", note: "membership restarted — awaits the next verified charge" };
}

async function applySubscriptionUpdated(sql: Sql, fields: GumroadPingFields): Promise<Applied> {
  const subscriptionId = fields.subscriptionId;
  if (!subscriptionId) return { applied: false, verified: false, pingStatus: "IGNORED", reason: "missing_subscription" };
  // Up/downgrades carry old_plan/new_plan; only the tier name is resolvable
  // without money changing hands — remap the plan for the NEXT renewal.
  const raw = fields.raw["new_plan"] ?? "";
  const tier = extractTierFromPlanPayload(raw) ?? (fields.variants ? tierFromVariants(fields.variants) : null);
  if (tier) {
    await sql`
      update gumroad_subscriptions
      set tier_name = ${tier}, last_verified_at = now(), updated_at = now()
      where subscription_id = ${subscriptionId}
    `;
  }
  return { applied: true, verified: false, pingStatus: "APPLIED", note: "subscription tier change recorded" };
}

// ── Binding ──────────────────────────────────────────────────────────────────

async function bindSubscription(
  sql: Sql,
  subscriptionId: string,
  email: string,
): Promise<{ userId: string | null; conflict: boolean }> {
  const rows = await sql<{ bound_user_id: string | null; bound_email: string | null }>`
    select bound_user_id, bound_email from gumroad_subscriptions where subscription_id = ${subscriptionId} limit 1
  `;
  if (!rows[0]) return { userId: null, conflict: false };
  const bound = rows[0].bound_user_id;
  if (bound) return { userId: bound, conflict: false };
  const resolved = email ? await resolveUserIdForBuyerEmail(sql, email) : null;
  if (!resolved) {
    if (email) {
      await sql`
        update gumroad_subscriptions set bound_email = ${email.trim().toLowerCase()}, updated_at = now()
        where subscription_id = ${subscriptionId} and bound_email is null
      `;
    }
    return { userId: null, conflict: false };
  }
  // Claim atomically; a concurrent writer may have bound another account —
  // only an UPDATE that actually moved a row counts as ours.
  const claimed = await sql<{ subscription_id: string }>`
    update gumroad_subscriptions
    set bound_user_id = ${resolved.userId}, claimed_at = now(), updated_at = now()
    where subscription_id = ${subscriptionId} and bound_user_id is null
    returning subscription_id
  `;
  if (!claimed[0]) {
    const reread = await sql<{ bound_user_id: string | null }>`
      select bound_user_id from gumroad_subscriptions where subscription_id = ${subscriptionId} limit 1
    `;
    return { userId: reread[0]?.bound_user_id ?? null, conflict: reread[0]?.bound_user_id !== resolved.userId };
  }
  return { userId: resolved.userId, conflict: false };
}

// ── Row helpers ──────────────────────────────────────────────────────────────

async function upsertGumroadSubscription(
  sql: Sql,
  input: {
    subscriptionId: string;
    productId: string;
    tierName: string | null;
    planKey: string | null;
    recurrence: string | null;
    email: string | null;
    lastSaleId: string | null;
  },
): Promise<{ subscriptionId: string }> {
  await sql`
    insert into gumroad_subscriptions
      (subscription_id, product_id, tier_name, plan_key, recurrence, bound_email, last_sale_id)
    values
      (${input.subscriptionId}, ${input.productId}, ${input.tierName}, ${input.planKey}, ${input.recurrence},
      ${input.email ? input.email.trim().toLowerCase() : null}, ${input.lastSaleId})
    on conflict (subscription_id) do update set
      last_sale_id = coalesce(excluded.last_sale_id, gumroad_subscriptions.last_sale_id),
      last_verified_at = now(),
      updated_at = now()
  `;
  return { subscriptionId: input.subscriptionId };
}

async function recordSaleRow(
  sql: Sql,
  fields: GumroadPingFields,
  meta: { verified: boolean; via: "api" | "license" | "none"; sale?: GumroadSaleView },
): Promise<void> {
  const sale = meta.sale;
  await sql`
    insert into gumroad_sales
      (sale_id, subscription_id, product_id, email, tier_name, recurrence, amount_cents, currency,
       is_recurring_charge, is_test, verified_via, verified)
    values
      (${sale?.saleId ?? fields.saleId ?? "unknown"}, ${sale?.subscriptionId ?? fields.subscriptionId},
       ${sale?.productId ?? fields.productId ?? "unknown"}, ${sale?.email ?? fields.email ?? "unknown"},
       ${tierFrom(sale, fields)}, ${normalizeGumroadRecurrence(sale?.recurrence ?? fields.recurrence)},
       ${sale?.priceCents ?? fields.priceCents}, ${sale?.currency ?? fields.currency},
       ${sale ? sale.recurringCharge : fields.isRecurringCharge}, ${fields.test},
       ${meta.via}, ${meta.verified})
    on conflict (sale_id) do update set
      verified = ${meta.verified}, verified_via = ${meta.via},
      subscription_id = coalesce(excluded.subscription_id, gumroad_sales.subscription_id),
      processed_at = now()
  `;
}

async function markSaleApplied(sql: Sql, saleId: string | null): Promise<void> {
  if (!saleId) return;
  await sql`
    update gumroad_sales set applied = true, processed_at = now(), last_error = null
    where sale_id = ${saleId}
  `;
}

async function notePing(sql: Sql, dedupeKey: string | null, status: string, note: string | null): Promise<void> {
  if (!dedupeKey) return;
  await sql`
    update gumroad_pings
    set status = ${status}, note = ${note}, processed_at = now()
    where dedupe_key = ${dedupeKey}
  `;
}

// ── Field helpers ────────────────────────────────────────────────────────────

function tierFrom(
  sale: { variants?: Record<string, string> | null } | undefined,
  fields: GumroadPingFields,
): string | null {
  const variants = sale?.variants && Object.keys(sale.variants).length ? sale.variants : fields.variants;
  const value = Object.values(variants ?? {}).find((entry) => typeof entry === "string" && entry.trim());
  return value ? value.trim() : null;
}

function tierFromVariants(variants: Record<string, string>): string | null {
  const value = Object.values(variants).find((entry) => typeof entry === "string" && entry.trim());
  return value ? value.trim() : null;
}

function extractTierFromPlanPayload(payload: string): string | null {
  if (!payload) return null;
  const match = /"tier"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/.exec(payload) ?? /"name"\s*:\s*"([^"]+)"/.exec(payload);
  return match?.[1] ?? null;
}

function parseVariantsValue(value: string): Record<string, string> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const entries = Object.entries(parsed as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string");
        return entries.length ? Object.fromEntries(entries) : null;
      }
    } catch {
      /* fall through to "Tier: name" handling */
    }
  }
  if (trimmed.includes(":")) {
    const [, rest] = trimmed.split(":", 2);
    return rest?.trim() ? { Tier: rest.trim() } : null;
  }
  return { Tier: trimmed };
}

function flattenJson(input: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}[${key}]` : key;
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenJson(value as Record<string, unknown>, path));
    } else if (Array.isArray(value)) {
      // Gumroad's purchase_ids arrays etc. — stored raw, not used for decisions.
      out[path] = JSON.stringify(value);
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

function pick(flat: Record<string, string>, key: string): string | null {
  const value = flat[key]?.trim();
  return value ? value : null;
}

function truthy(flat: Record<string, string>, key: string): boolean {
  const value = flat[key]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function numeric(flat: Record<string, string>, key: string): number | null {
  const value = flat[key]?.trim();
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Strip fields we never want persisted (defense in depth; no card data arrives). */
function redactForStorage(fields: GumroadPingFields): Record<string, string> {
  const allowed = new Set([
    "resource_name", "sale_id", "subscription_id", "product_id", "product_permalink",
    "email", "recurrence", "is_recurring_charge", "refunded", "disputed", "dispute_won",
    "chargebacked", "cancelled", "cancelled_at", "ended_at", "ended_reason", "restarted_at",
    "effective_as_of", "test", "order_number", "seller_id", "product_name", "created_at",
  ]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields.raw)) {
    if (allowed.has(key) || key.startsWith("variants[") || key === "variants") out[key] = value;
  }
  return out;
}

// ── Production deps ──────────────────────────────────────────────────────────

/** Real verifier + real Keygen operations. Never replaced by fixtures in prod. */
export const productionGumroadPipelineDeps: GumroadPipelineDeps = {
  verify: (input) => verifyGumroadSale(input),
  issue: async (input) => {
    const license = await issueGumroadKeygenLicense(input);
    return { id: license.id, expiresAt: license.expiresAt ?? "" };
  },
  renew: async (input) => {
    const license = await renewGumroadKeygenLicense(input);
    return { id: license.id, expiresAt: license.expiresAt ?? "" };
  },
  revoke: (input) => revokeGumroadKeygenLicense(input),
  restore: (input) => restoreGumroadKeygenLicense(input),
};
