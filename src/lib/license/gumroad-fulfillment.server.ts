/**
 * Gumroad → Keygen fulfillment.
 *
 * This is the verified, audited fulfillment pattern (search-before-mint,
 * authoritative claim check, user-scoped revalidation) keyed on Gumroad's ids
 * (sale/subscription). Keygen remains the sole licensing authority; Gumroad
 * only ever says "money happened" — this module turns that into a bound,
 * user-scoped license.
 *
 * One license per Gumroad subscription: the first charge mints it (metadata
 * gumroadSubscriptionId), renewals EXTEND its expiry instead of minting a
 * second license for the same money.
 */

import { activateKeygenForSession } from "./activation.server.ts";
import { hashLicenseKey } from "./key.ts";
import {
  createKeygenLicense,
  ensureKeygenUser,
  findKeygenLicenseByMetadataField,
  getKeygenLicenseForClaim,
  keygenPolicyId,
  keygenProductId,
  reinstateKeygenLicense,
  suspendKeygenLicense,
  updateKeygenLicenseExpiry,
  type KeygenPlan,
} from "./keygen.ts";
import { findLicenseByGumroadSubscription, setLicenseStatusForUser } from "./server.ts";
import type { License } from "./types.ts";

export type GumroadLicenseSession = { userId: string; userEmail: string };

/** The single money-source marker used in `subscriptions.source_transaction_id`. */
export function gumroadSourceTransactionId(saleId: string): string {
  return `gumroad:${saleId}`;
}

async function locateLicense(subscriptionId: string): Promise<{ providerId: string | null; local: License | null }> {
  const local = await findLicenseByGumroadSubscription(subscriptionId);
  let providerId = local?.metadata?.keygenLicenseId ?? null;
  if (!providerId) {
    const remote = await findKeygenLicenseByMetadataField("gumroadSubscriptionId", subscriptionId);
    providerId = remote?.licenseId || null;
  }
  return { providerId, local };
}

/**
 * Mint the subscription's Keygen license on the first verified charge — or
 * return the existing one when a retry arrives after the SQL lease expired.
 * A successful response means the purchaser was bound at Keygen AND a
 * user-scoped validation returned their entitlement.
 */
export async function issueGumroadKeygenLicense(input: {
  saleId: string;
  subscriptionId: string;
  userId: string;
  userEmail: string;
  plan: KeygenPlan;
  planName: string;
  expiresAt: string;
  recurringCharge: boolean;
}): Promise<License> {
  const session = { userId: input.userId, userEmail: input.userEmail };
  const { providerId, local } = await locateLicense(input.subscriptionId);
  if (local && (local.userId !== input.userId || local.metadata?.keygenLicenseId == null)) {
    throw new Error("Gumroad license belongs to another account or provider");
  }

  let id = providerId;
  if (!id) {
    const ownerId = await ensureKeygenUser(session);
    const created = await createKeygenLicense({
      plan: input.plan,
      name: `NASAQ ${input.planName} License`,
      expiresAt: input.expiresAt,
      ownerId,
      metadata: {
        source: "gumroad",
        gumroadSaleId: input.saleId,
        gumroadSubscriptionId: input.subscriptionId,
        nasaqUserId: input.userId,
        plan: input.plan,
      },
    });
    id = created.licenseId;
  }

  // Check the authoritative resource BEFORE attaching the user or persisting
  // any access (fail-closed order).
  const remote = await getKeygenLicenseForClaim(id);
  if (
    remote.productId !== keygenProductId() ||
    remote.policyId !== keygenPolicyId(input.plan) ||
    (remote.nasaqUserId && remote.nasaqUserId !== input.userId) ||
    (local && hashLicenseKey(remote.key) !== local.keyHash)
  ) {
    throw new Error("Gumroad license and Keygen purchaser/plan do not match");
  }
  const activated = await activateKeygenForSession(remote.key, session);
  if (!activated.success) throw new Error(`Keygen activation failed: ${activated.message}`);
  const { license, verification } = activated;
  if (
    verification.productId !== keygenProductId() ||
    verification.policyId !== keygenPolicyId(input.plan) ||
    verification.metadata.nasaqUserId !== input.userId ||
    license.userId !== input.userId ||
    license.metadata?.userScopeVerified !== input.userId ||
    !license.expiresAt ||
    Date.parse(license.expiresAt) <= Date.now()
  ) {
    throw new Error("Gumroad license did not validate for the purchaser and plan");
  }
  return license;
}

/**
 * Renewal: push the extended expiry to the subscription's EXISTING Keygen
 * license, then revalidate user-scoped so the local mirror only ever records
 * access Keygen itself confirmed.
 */
export async function renewGumroadKeygenLicense(input: {
  subscriptionId: string;
  userId: string;
  userEmail: string;
  plan: KeygenPlan;
  expiresAt: string;
}): Promise<License> {
  const session = { userId: input.userId, userEmail: input.userEmail };
  const { providerId, local } = await locateLicense(input.subscriptionId);
  if (!providerId || !local) throw new Error("No Keygen license exists for this Gumroad subscription");
  if (local.userId !== input.userId) throw new Error("Gumroad license belongs to another account");

  const remote = await getKeygenLicenseForClaim(providerId);
  if (remote.productId !== keygenProductId() || remote.policyId !== keygenPolicyId(input.plan)) {
    throw new Error("Gumroad license and Keygen plan do not match");
  }
  // A lapsed license that renewed again comes back to life first.
  if (remote.suspended) await reinstateKeygenLicense(providerId);
  await updateKeygenLicenseExpiry(providerId, input.expiresAt);

  const activated = await activateKeygenForSession(remote.key, session);
  if (!activated.success) throw new Error(`Keygen activation failed: ${activated.message}`);
  const { license, verification } = activated;
  if (
    !verification.valid ||
    !license.expiresAt ||
    Date.parse(license.expiresAt) < Date.parse(input.expiresAt) - 1000
  ) {
    throw new Error("Gumroad renewal did not validate at Keygen");
  }
  return license;
}

/** Refund / lost dispute: cut access at the licensing authority immediately. */
export async function revokeGumroadKeygenLicense(input: {
  subscriptionId: string;
  userId: string | null;
}): Promise<boolean> {
  const { providerId, local } = await locateLicense(input.subscriptionId);
  if (!providerId) return false;
  await suspendKeygenLicense(providerId);
  if (local && input.userId && local.userId === input.userId) {
    await setLicenseStatusForUser(local.id, input.userId, "REVOKED");
  }
  return true;
}

/** Seller won a dispute / refund reversed: restore suspended access. */
export async function restoreGumroadKeygenLicense(input: { subscriptionId: string }): Promise<boolean> {
  const { providerId } = await locateLicense(input.subscriptionId);
  if (!providerId) return false;
  await reinstateKeygenLicense(providerId);
  return true;
}
