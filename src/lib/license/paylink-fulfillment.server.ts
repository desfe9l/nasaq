import { activateKeygenForSession } from "./activation.server.ts";
import { hashLicenseKey } from "./key.ts";
import {
  createKeygenLicense,
  ensureKeygenUser,
  findKeygenLicenseByPaylinkTransaction,
  getKeygenLicenseForClaim,
  keygenPolicyId,
  keygenProductId,
  type KeygenPlan,
} from "./keygen.ts";
import { findLicenseByPaylinkTransaction } from "./server.ts";
import type { License } from "./types.ts";

/**
 * Paylink's verified, claimed payment is the ONLY caller. The provider licence
 * is searched by the transaction number before minting (webhook retries can
 * outlive the SQL processing lease). A successful response means the purchaser
 * was bound at Keygen AND user-scoped validation returned their entitlements;
 * merely inserting a local licence is never a completed payment.
 */
export async function issuePaidKeygenLicense(input: {
  transactionNo: string;
  orderNumber: string;
  userId: string;
  userEmail: string;
  plan: KeygenPlan;
  planName: string;
  expiresAt: string;
}): Promise<License> {
  const session = { userId: input.userId, userEmail: input.userEmail };
  const existing = await findLicenseByPaylinkTransaction(input.transactionNo);
  if (existing && (existing.userId !== input.userId || existing.metadata?.keygenLicenseId == null)) {
    throw new Error("Paylink licence belongs to another account or provider");
  }

  let providerId = existing?.metadata?.keygenLicenseId;
  if (!providerId) {
    let found = await findKeygenLicenseByPaylinkTransaction(input.transactionNo);
    if (!found) {
      const ownerId = await ensureKeygenUser(session);
      found = await createKeygenLicense({
        plan: input.plan,
        name: `NASAQ ${input.planName} License`,
        expiresAt: input.expiresAt,
        ownerId,
        metadata: {
          source: "keygen",
          paylinkTransactionNo: input.transactionNo,
          paylinkOrderNumber: input.orderNumber,
          nasaqUserId: input.userId,
          plan: input.plan,
        },
      });
    }
    providerId = found.licenseId;
  }

  // Check the authoritative resource BEFORE attaching the user or persisting
  // any access. A Keygen search match is not itself proof of ownership.
  const remote = await getKeygenLicenseForClaim(providerId);
  if (remote.productId !== keygenProductId() || remote.policyId !== keygenPolicyId(input.plan) ||
      remote.paylinkTransactionNo !== input.transactionNo || remote.nasaqUserId !== input.userId ||
      (existing && hashLicenseKey(remote.key) !== existing.keyHash)) {
    throw new Error("Paylink licence and Keygen purchaser/plan do not match");
  }
  const activated = await activateKeygenForSession(remote.key, session);
  if (!activated.success) throw new Error(`Keygen activation failed: ${activated.message}`);
  const { license, verification } = activated;
  if (verification.productId !== keygenProductId() ||
      verification.policyId !== keygenPolicyId(input.plan) ||
      verification.metadata.paylinkTransactionNo !== input.transactionNo ||
      verification.metadata.nasaqUserId !== input.userId ||
      license.userId !== input.userId ||
      license.metadata?.userScopeVerified !== input.userId ||
      !license.expiresAt || Date.parse(license.expiresAt) <= Date.now()) {
    throw new Error("Paylink licence did not validate for the purchaser and plan");
  }
  return license;
}
