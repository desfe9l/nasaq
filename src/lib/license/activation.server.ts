import { hashLicenseKey, keyPrefix, normalizeLicenseKey } from "./key.ts";
import { boundToAnotherOwner, reboundFromIds } from "./scope.ts";
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

/** Supplied ONLY by authMiddleware's verified session. */
export type LicenseSession = { userId: string; userEmail: string | null };

const NOT_OWNER = "مفتاح الترخيص لا يخص هذا المستخدم.";
const NO_EMAIL = "يتطلب تفعيل الترخيص بريد حساب مسجّل الدخول.";
const INVALID = "مفتاح الترخيص غير صالح أو غير متاح للتفعيل.";

type KeygenActivation =
  | { success: true; license: License; verification: KeygenVerification }
  | { success: false; message: string };

/**
 * Is this row scoped to a DIFFERENT account than the caller's?
 *
 * Every marker the row carries must name the caller — directly, or as one of
 * the orphaned ids the durable owner binding reconciled onto them, so a
 * recovered owner's own key does not answer "this key is not yours". A row
 * whose scope names a third party still refuses, so a customer can never
 * inherit another account's licence.
 */
function boundToOther(license: License | null, session: LicenseSession): boolean {
  if (!license) return false;
  return boundToAnotherOwner(license.metadata, license.userId, session.userId);
}

/**
 * May a provider-side scope marker that names `candidateId` be accepted for
 * this caller?
 *
 * Yes when it names them directly, when the row records it as a reconciled
 * pre-migration id, or when the durable owner binding proves it is this
 * caller's own orphaned id. Anything else refuses.
 */
async function scopeAccepted(
  candidate: string | null | undefined,
  session: LicenseSession,
  local?: License | null,
): Promise<boolean> {
  if (!candidate) return true;
  const value = String(candidate).trim();
  if (!value || value === session.userId) return true;
  if (local && reboundFromIds(local.metadata).includes(value)) return true;
  try {
    const { getSql } = await import("@/lib/db");
    const { provenLegacyUserIds } = await import("@/lib/auth/owner-binding.server");
    return (await provenLegacyUserIds(await getSql(), session.userId)).includes(value);
  } catch {
    return false;
  }
}

/** `local`'s own scope markers, as the comparison list the Keygen checks use. */
function localScopeOk(local: License, session: LicenseSession): boolean {
  const marker = local.metadata?.userScopeVerified;
  if (!marker) return true;
  return marker === session.userId || reboundFromIds(local.metadata).includes(marker);
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
      !(await scopeAccepted(verified.metadata.nasaqUserId, session, local)) ||
      (local?.metadata?.keygenLicenseId && local.metadata.keygenLicenseId !== verified.licenseId)) {
    return { success: false, message: INVALID };
  }

  // A first activation always checks the authoritative Keygen resource, even
  // when a policy happens not to require a user scope. The API must affirm that
  // this exact key exists for our product and whether it was already assigned.
  {
    const remote = await getKeygenLicenseForClaim(verified.licenseId);
    if (normalizeLicenseKey(remote.key) !== normalized || remote.productId !== keygenProductId() ||
        !(await scopeAccepted(remote.nasaqUserId, session, local))) {
      return { success: false, message: INVALID };
    }
    if (remote.ownerId === undefined || remote.usersCount === null) {
      return { success: false, message: "تعذر التحقق من صاحب الترخيص. تأكد من استخدام حساب الشراء." };
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
      !(await scopeAccepted(verified.metadata.nasaqUserId, session, local))) {
    return { success: false, message: keygenMessage(verified) };
  }
  const license = await persistKeygenLicense(verified, session.userId);
  return { success: true, license, verification: verified };
}

/** Reload a verified license using its provider ID, without browser key storage. */
export async function revalidateLinkedKeygenLicense(local: License, session: LicenseSession): Promise<License | null> {
  const providerId = local.metadata?.keygenLicenseId;
  if (!session.userEmail || !providerId || local.userId !== session.userId ||
      !localScopeOk(local, session) || boundToOther(local, session)) return null;
  const verified = await validateKeygenLicenseById(providerId, session.userEmail);
  if (verified.valid && verified.licenseId === providerId &&
      hashLicenseKey(verified.key) === local.keyHash &&
      (await scopeAccepted(verified.metadata.nasaqUserId, session, local))) {
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
      !(await scopeAccepted(verified.metadata.nasaqUserId, session, local))) {
    await setLicenseStatusForUser(local.id, session.userId,
      verified.code === "EXPIRED" || verified.code === "OVERDUE" ? "EXPIRED" : "REVOKED");
    return { valid: false };
  }
  return { valid: true, license: await persistKeygenLicense(verified, session.userId) };
}
