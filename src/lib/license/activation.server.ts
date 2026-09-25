import { hashLicenseKey, keyPrefix, normalizeLicenseKey } from "./key.ts";
import {
  attachKeygenUser,
  ensureKeygenUser,
  getKeygenLicenseForClaim,
  keygenMessage,
  keygenProductId,
  validateKeygenLicense,
  validateKeygenLicenseById,
  type KeygenVerification,
} from "./keygen.ts";
import {
  findLicenseByKeyHash,
  reserveKeygenClaim,
  setLicenseStatusForUser,
  upsertExternalLicense,
} from "./server.ts";
import type { License } from "./types.ts";
import { getSql } from "@/lib/db";

/** Supplied ONLY by authMiddleware's verified Better Auth session. */
export type LicenseSession = { userId: string; userEmail: string | null };

const NOT_OWNER = "مفتاح الترخيص لا يخص هذا المستخدم.";
const NO_EMAIL = "يتطلب تفعيل الترخيص بريد حساب مسجّل الدخول.";
const INVALID = "مفتاح الترخيص غير صالح أو غير متاح للتفعيل.";

type KeygenActivation =
  | { success: true; license: License; verification: KeygenVerification }
  | { success: false; message: string };

function boundToOther(license: License | null, session: LicenseSession): boolean {
  return Boolean(license?.userId && license.userId !== session.userId) ||
    Boolean(license?.metadata?.nasaqUserId && license.metadata.nasaqUserId !== session.userId) ||
    Boolean(license?.metadata?.userScopeVerified && license.metadata.userScopeVerified !== session.userId);
}

export async function persistKeygenLicense(verification: KeygenVerification, userId: string | null): Promise<License> {
  return upsertExternalLicense({
    keyHash: hashLicenseKey(verification.key),
    keyPrefix: keyPrefix(verification.key),
    type: verification.type,
    userId,
    expiresAt: verification.expiresAt,
    activationCount: verification.activationCount,
    maxActivations: verification.maxActivations,
    status: verification.status,
    metadata: {
      ...verification.metadata,
      // Only a successful user-scoped Keygen validation sets this local marker.
      // Previously issued Paylink rows without a Keygen user remain claimable.
      ...(userId && verification.userScopeVerified ? { userScopeVerified: userId } : {}),
    },
  });
}

/**
 * Key possession is NOT enough to bypass Keygen's user-locked policy. On a
 * genuinely unassigned key, reserve a single NASAQ account, attach its real
 * Keygen user, then *revalidate* with meta.scope.user before storing access.
 * Never attach a new user to an already assigned license (including team keys).
 */
export async function activateKeygenForSession(key: string, session: LicenseSession): Promise<KeygenActivation> {
  if (!session.userEmail?.trim()) return { success: false, message: NO_EMAIL };
  const normalized = normalizeLicenseKey(key);
  const hash = hashLicenseKey(normalized);
  const local = await findLicenseByKeyHash(hash);
  if (boundToOther(local, session) || local?.status === "REVOKED") return { success: false, message: NOT_OWNER };

  let verified = await validateKeygenLicense(normalized, session.userEmail);
  if (!verified.valid && verified.code !== "USER_SCOPE_MISMATCH") {
    return { success: false, message: keygenMessage(verified) };
  }
  if (!verified.licenseId || verified.productId !== keygenProductId() ||
      (verified.metadata.nasaqUserId && verified.metadata.nasaqUserId !== session.userId) ||
      (local?.metadata?.keygenLicenseId && local.metadata.keygenLicenseId !== verified.licenseId)) {
    return { success: false, message: INVALID };
  }

  // A first activation always checks the authoritative Keygen resource, even
  // when a policy happens not to require a user scope. The API must affirm that
  // this exact key exists for our product and whether it was already assigned.
  {
    const remote = await getKeygenLicenseForClaim(verified.licenseId);
    if (normalizeLicenseKey(remote.key) !== normalized || remote.productId !== keygenProductId() ||
        (remote.nasaqUserId && remote.nasaqUserId !== session.userId)) {
      return { success: false, message: INVALID };
    }
    if (remote.ownerId === undefined || remote.usersCount === null) {
      return { success: false, message: "تعذر تحديد صاحب الترخيص لدى Keygen." };
    }
    const unassigned = remote.ownerId === null && remote.usersCount === 0;
    // Some Keygen policies require an attached user even when the licence has
    // an owner. Only attach the *verified account's own* Keygen user when that
    // account is already the authoritative owner and no users are attached.
    const ownedButUnlinked = !verified.valid && remote.ownerId !== null && remote.usersCount === 0 &&
      remote.ownerId === await ensureKeygenUser({ userId: session.userId, userEmail: session.userEmail }, false);
    if (!verified.valid && !unassigned && !ownedButUnlinked) return { success: false, message: NOT_OWNER };
    if ((unassigned || ownedButUnlinked) && (remote.suspended || !["ACTIVE", "INACTIVE", "EXPIRING"].includes(remote.status) ||
        (remote.expiresAt && (!Number.isFinite(Date.parse(remote.expiresAt)) || Date.parse(remote.expiresAt) <= Date.now())))) {
      return { success: false, message: "هذا الترخيص غير نشط أو انتهت صلاحيته." };
    }
    if (!(await reserveKeygenClaim(hash, session.userId))) return { success: false, message: NOT_OWNER };

    if (unassigned || ownedButUnlinked) {
      const keygenUserId = ownedButUnlinked ? remote.ownerId! :
        await ensureKeygenUser({ userId: session.userId, userEmail: session.userEmail });
      try {
        await attachKeygenUser(remote.id, keygenUserId);
      } catch (error) {
        // Two attempts from the SAME account can race. Never assume that an
        // attach conflict succeeded; Keygen must validate it for this user.
        const retried = await validateKeygenLicense(normalized, session.userEmail);
        if (!retried.valid || retried.licenseId !== remote.id) throw error;
      }
      verified = await validateKeygenLicense(normalized, session.userEmail);
    }
  }

  if (!verified.valid || verified.productId !== keygenProductId() ||
      (verified.metadata.nasaqUserId && verified.metadata.nasaqUserId !== session.userId)) {
    return { success: false, message: keygenMessage(verified) };
  }
  const license = await persistKeygenLicense(verified, session.userId);
  return { success: true, license, verification: verified };
}

/**
 * Repair an older Paylink purchase that was stored before checkout attached its
 * Keygen user. A browser cannot recover the plaintext key from its prefix.
 * Only the purchaser named on a PAID transaction can initiate this repair; a
 * local assignment or a subscription alone is never proof of purchase. The
 * normal activation path still requires a user-scoped Keygen validation.
 */
export async function claimPaidKeygenForSession(local: License, session: LicenseSession): Promise<License | null> {
  const providerId = local.metadata?.keygenLicenseId;
  const transactionNo = local.metadata?.paylinkTransactionNo;
  if (!session.userEmail || local.userId !== session.userId || local.status !== "ACTIVE" ||
      (local.expiresAt && Date.parse(local.expiresAt) <= Date.now()) ||
      local.metadata?.source !== "keygen" || !providerId || !transactionNo ||
      local.metadata.nasaqUserId !== session.userId || boundToOther(local, session)) return null;

  const sql = await getSql();
  const paid = await sql.query(
    `SELECT 1 FROM paylink_transactions WHERE transaction_no = $1 AND user_id = $2
       AND license_id = $3 AND keygen_license_id = $4 AND status = 'PAID'
       AND (entitlement_expires_at IS NULL OR entitlement_expires_at > now()) LIMIT 1`,
    [transactionNo, session.userId, local.id, providerId],
  );
  if (!paid.length) return null;

  const remote = await getKeygenLicenseForClaim(providerId);
  if (remote.productId !== keygenProductId() || remote.nasaqUserId !== session.userId ||
      hashLicenseKey(remote.key) !== local.keyHash) return null;
  const result = await activateKeygenForSession(remote.key, session);
  return result.success ? result.license : null;
}

/** Reload a verified license using its provider ID, without browser key storage. */
export async function revalidateLinkedKeygenLicense(local: License, session: LicenseSession): Promise<License | null> {
  const providerId = local.metadata?.keygenLicenseId;
  if (!session.userEmail || !providerId || local.userId !== session.userId ||
      local.metadata?.userScopeVerified !== session.userId || boundToOther(local, session)) return null;
  const verified = await validateKeygenLicenseById(providerId, session.userEmail);
  if (verified.valid && verified.licenseId === providerId &&
      hashLicenseKey(verified.key) === local.keyHash &&
      (!verified.metadata.nasaqUserId || verified.metadata.nasaqUserId === session.userId)) {
    return persistKeygenLicense(verified, session.userId);
  }
  await setLicenseStatusForUser(local.id, session.userId,
    verified.code === "EXPIRED" || verified.code === "OVERDUE" ? "EXPIRED" : "REVOKED");
  return null;
}

/** Revalidation only: never attaches users or gives an unactivated account a key. */
export async function revalidateKeygenForSession(key: string, session: LicenseSession): Promise<{
  valid: boolean; license?: License;
}> {
  if (!session.userEmail?.trim()) return { valid: false };
  const local = await findLicenseByKeyHash(hashLicenseKey(key));
  if (!local || local.userId !== session.userId || local.status === "REVOKED" || boundToOther(local, session)) {
    return { valid: false };
  }
  const verified = await validateKeygenLicense(key, session.userEmail);
  if (!verified.valid || verified.productId !== keygenProductId() ||
      verified.licenseId !== local.metadata?.keygenLicenseId ||
      (verified.metadata.nasaqUserId && verified.metadata.nasaqUserId !== session.userId)) {
    await setLicenseStatusForUser(local.id, session.userId,
      verified.code === "EXPIRED" || verified.code === "OVERDUE" ? "EXPIRED" : "REVOKED");
    return { valid: false };
  }
  return { valid: true, license: await persistKeygenLicense(verified, session.userId) };
}
