/**
 * NASAQ License — Server functions (TanStack Start).
 *
 * These are the ONLY entry points the client uses for license operations.
 * Each function validates the caller, checks rate limits, and delegates
 * to the server-side database operations.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { hashLicenseKey, isGeneratedKeyFormat, isKeygenKeyFormat, isValidKeyFormat, normalizeLicenseKey } from "./key";
import {
  activateLicense as dbActivate,
  validateLicense as dbValidate,
  createLicense as dbCreate,
  listAllLicenses as dbListAll,
  revokeLicense as dbRevoke,
  reactivateLicense as dbReactivate,
  updateLicense as dbUpdate,
  extendLicense,
  assignLicense,
  unassignLicense,
  findLicenseByKeyHash,
  findLicenseById,
  findLicensesByUserId,
  LicenseOwnershipError,
} from "./server";
import {
  createKeygenLicense,
  ensureKeygenUser,
  isKeygenConfigured,
  KeygenOwnershipError,
  keygenPlanForLicenseType,
  reinstateKeygenLicense,
  suspendKeygenLicense,
  updateKeygenLicenseExpiry,
  validateKeygenLicense,
} from "./keygen";
import { activateKeygenForSession, persistKeygenLicense, revalidateKeygenForSession, revalidateLinkedKeygenLicense } from "./activation.server";
import { checkRateLimit } from "./rate-limit";
import { entitlementsForPlan, entitlementsFromKeygenCodes, LICENSE_ENTITLEMENTS } from "./types";
import type {
  License,
  LicenseActivateResult,
  LicenseValidateResult,
  LicenseStatusResult,
  AdminLicenseCreate,
  AdminLicenseUpdate,
  LicenseType,
  LicenseInfo,
} from "./types";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get client IP from request headers (best-effort). Server-side only.
 *
 * Uses TanStack Start's `getRequest()` — imported lazily via a cached promise
 * so the module works in both dev and Vercel's ESM serverless output (a CJS
 * `require` here throws ERR_REQUIRE_ESM, which silently collapsed every caller
 * into one "unknown" rate-limit bucket).
 */
let getRequestRef: typeof import("@tanstack/react-start/server").getRequest | null = null;
async function loadGetRequest() {
  getRequestRef ??= (await import("@tanstack/react-start/server")).getRequest;
  return getRequestRef;
}
function ipFromRequest(req: Request | null | undefined): string {
  const h = req?.headers;
  if (!h) return "unknown";
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
async function getClientIp(): Promise<string> {
  try {
    const getRequest = await loadGetRequest();
    return ipFromRequest(getRequest());
  } catch {
    return "unknown";
  }
}

/**
 * Administrator gate — now with the owner bypass.
 *
 * Three independent signals, any one of which is enough:
 *   1. an administrator identity (config allowlist or `admin_users` row),
 *   2. the platform owner record (`NASAQ_OWNER_*`),
 *   3. a `SUPER_ADMIN` row or the super-admin allowlist.
 *
 * The owner used to fall through every licence call: the panel asked a single
 * "are you an admin" question, and an owner whose deployment never wrote an
 * `admin_users` row answered "no" to their own product. The bypass is checked
 * server-side from the verified session only — a client cannot claim it.
 */
async function isAdministrator(
  context: { userId: string; userEmail: string | null },
): Promise<boolean> {
  const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
  const access = await getAuthorizationContext({
    id: context.userId,
    email: context.userEmail,
  });
  if (access.isAdmin || access.isOwner) return true;
  const { getSql } = await import("@/lib/db");
  const { isSuperAdminIdentity } = await import("@/lib/auth/super-admin.server");
  try {
    return await isSuperAdminIdentity(await getSql(), {
      id: context.userId,
      email: context.userEmail,
    });
  } catch {
    return false;
  }
}

function publicLicense(license: License): LicenseInfo {
  return {
    id: license.id,
    type: license.type,
    status: license.status,
    keyPrefix: license.keyPrefix,
    activatedAt: license.activatedAt,
    expiresAt: license.expiresAt,
    createdAt: license.createdAt,
  source: license.metadata?.source === "keygen" ? "keygen" : "manual",
    plan: license.metadata?.plan as LicenseInfo["plan"],
    billing: license.metadata?.billing as LicenseInfo["billing"],
  };
}

function entitlementsFor(license: License): Record<import("./types").FeatureId, boolean> {
  if (license.metadata?.source === "keygen") {
    return entitlementsFromKeygenCodes((license.metadata?.entitlements || "").split(",").filter(Boolean));
  }
  return entitlementsForPlan(license.metadata?.plan as import("./types").LicensePlan | undefined, license.type);
}

// ── Public: Activate License ───────────────────────────────────────────────

export const activateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { key: string }) => data)
  .handler(async ({ data, context }): Promise<LicenseActivateResult> => {
    const ip = await getClientIp();

    // Rate limit: 5 attempts per minute per IP
    if (!checkRateLimit("license:activate", ip, 5, 60_000)) {
      return {
        success: false,
        message: "تم تجاوز الحد المسموح من المحاولات. يرجى المحاولة لاحقًا.",
      };
    }

    // Unified normalization: stray spaces or lowercase from a paste never
    // change what the key is (generator keys are uppercase HEX / NASAQ-…).
    const key = normalizeLicenseKey(data.key);
    if (!key) {
      return { success: false, message: "أدخل مفتاح الترخيص أولًا." };
    }
    const manualKey = isValidKeyFormat(key);
    const generatedKey = isGeneratedKeyFormat(key);
    const keygenKey = generatedKey || (!manualKey && isKeygenKeyFormat(key));
    if (!manualKey && !keygenKey) {
      return {
        success: false,
        message: "صيغة مفتاح الترخيص غير صالحة.",
      };
    }

    const keyHash = hashLicenseKey(key);
    const local = await findLicenseByKeyHash(keyHash);
    if (keygenKey || local?.metadata?.source === "keygen") {
      if (!isKeygenConfigured()) {
        return { success: false, message: "تحقق Keygen غير مهيأ على الخادم." };
      }
      try {
        // Session id/email come from authMiddleware, never from the form body.
        const result = await activateKeygenForSession(key, context);
        if (!result.success) return result;
        return { success: true, message: "تم تفعيل الترخيص بنجاح.",
          license: publicLicense(result.license), entitlements: entitlementsFor(result.license) };
      } catch (error) {
        if (error instanceof KeygenOwnershipError || error instanceof LicenseOwnershipError) {
          return { success: false, message: "مفتاح الترخيص لا يخص هذا المستخدم." };
        }
        console.error("[license] Keygen activation failed", error);
        return { success: false, message: "تعذر التحقق من حالة ترخيص Keygen." };
      }
    }
    const result = local ? await dbActivate(keyHash, context.userId) : null;

    if (!result || !result.success) {
      const messages: Record<string, string> = {
        NOT_FOUND: "مفتاح الترخيص غير صالح أو غير متاح للتفعيل.",
        REVOKED: "تم إلغاء هذا الترخيص.",
        EXPIRED: "انتهت صلاحية هذا الترخيص.",
        ACTIVATION_LIMIT: "تم الوصول إلى الحد الأقصى لتفعيل هذا الترخيص.",
        USER_SCOPE_MISMATCH: "مفتاح الترخيص لا يخص هذا المستخدم.",
        USER_SCOPE_REQUIRED: "يتطلب تفعيل الترخيص حسابًا مسجّل الدخول.",
      };
      return {
        success: false,
        message: messages[result?.error ?? ""] ?? "فشل تفعيل الترخيص.",
      };
    }

    const license = result.license!;
    return {
      success: true,
      message: "تم تفعيل الترخيص بنجاح.",
      license: publicLicense(license),
      entitlements: entitlementsFor(license),
    };
  });

// ── Public: Validate License ───────────────────────────────────────────────

export const validateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { key: string }) => data)
  .handler(async ({ data, context }): Promise<LicenseValidateResult> => {
    const ip = await getClientIp();

    if (!checkRateLimit("license:validate", ip, 20, 60_000)) {
      return { valid: false };
    }

    const key = normalizeLicenseKey(data.key);
    if (!key) return { valid: false };
    const manualKey = isValidKeyFormat(key);
    const generatedKey = isGeneratedKeyFormat(key);
    const keygenKey = generatedKey || (!manualKey && isKeygenKeyFormat(key));
    if (!manualKey && !keygenKey) {
      return { valid: false };
    }

    const keyHash = hashLicenseKey(key);
    const local = await findLicenseByKeyHash(keyHash);
    // Validation cannot be used as a second, unauthenticated activation path.
    if (!local || local.userId !== context.userId) return { valid: false };
    if (keygenKey || local.metadata?.source === "keygen") {
      if (!isKeygenConfigured()) return { valid: false };
      try {
        const result = await revalidateKeygenForSession(key, context);
        if (!result.valid || !result.license) return { valid: false };
        return { valid: true, license: publicLicense(result.license), entitlements: entitlementsFor(result.license) };
      } catch {
        return { valid: false };
      }
    }

    const result = await dbValidate(keyHash);

    if (!result.valid || !result.license) {
      return { valid: false };
    }

    const entitlements = entitlementsFor(result.license);
    return {
      valid: true,
      license: publicLicense(result.license),
      entitlements,
    };
  });

export const deactivateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { key: string }) => data)
  .handler(async ({ data, context }) => {
    const ip = await getClientIp();
    if (!checkRateLimit("license:deactivate", ip, 5, 60_000)) return { success: false };
    const key = normalizeLicenseKey(data.key);
    const local = await findLicenseByKeyHash(hashLicenseKey(key));
    if (!local) return { success: false };
    if (local.userId !== context.userId && !(await isAdministrator(context))) {
      return { success: false };
    }
    try {
      if (local.metadata?.source === "keygen") {
        if (local.userId === context.userId) await unassignLicense(local.id, context.userId);
      } else {
        await dbRevoke(local.id);
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  });

// ── Auth: Get My License Status ────────────────────────────────────────────

export const getLicenseStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<LicenseStatusResult> => {
    const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
    const access = await getAuthorizationContext({
      id: context.userId,
      email: context.userEmail,
    });
    if (access.isAdmin) {
      return {
        hasLicense: true,
        isOwner: access.isOwner,
        isAdmin: true,
        entitlements: access.entitlements,
      };
    }
    const active = access.license;
    if (active?.metadata?.source === "keygen" && active.metadata.userScopeVerified) {
      // After a successful activation, check the provider again on reload even
      // if this browser no longer has the plaintext key. Paid pre-issued rows
      // without a Keygen user keep their existing fulfillment behavior.
      if (active.metadata.userScopeVerified !== context.userId) {
        return { hasLicense: false, entitlements: { ...LICENSE_ENTITLEMENTS.FREE } };
      }
      try {
        if (!isKeygenConfigured()) throw new Error("Keygen verification unavailable");
        const current = await revalidateLinkedKeygenLicense(active, context);
        if (current) {
          return { hasLicense: true, license: publicLicense(current), entitlements: entitlementsFor(current) };
        }
      } catch {
        // Upstream unavailable: fail closed, but don't incorrectly revoke it.
        return { hasLicense: false, entitlements: { ...LICENSE_ENTITLEMENTS.FREE } };
      }
    } else if (active) {
      return { hasLicense: true, license: publicLicense(active), entitlements: access.entitlements };
    }
    const previous = (await findLicensesByUserId(context.userId))[0];
    if (!previous) return { hasLicense: false, entitlements: access.entitlements };
    // Keep the type and inactive state visible without unlocking features.
    const info = publicLicense(previous);
    if (info.status === "ACTIVE" && info.expiresAt && Date.parse(info.expiresAt) <= Date.now()) {
      info.status = "EXPIRED";
    }
    return { hasLicense: false, license: info, entitlements: { ...LICENSE_ENTITLEMENTS.FREE } };
  });

// ── Admin: Create License ─────────────────────────────────────────────────

export const adminCreateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: AdminLicenseCreate) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", licenseId: null as string | null, plainKey: null as string | null, type: null as LicenseType | null, keyPrefix: null as string | null };
    }

    const providerPlan = keygenPlanForLicenseType(data.type);
    if (providerPlan) {
      if (!isKeygenConfigured()) {
        return { error: "Keygen غير مهيأ على الخادم.", licenseId: null as string | null, plainKey: null as string | null, type: null as LicenseType | null, keyPrefix: null as string | null };
      }
      try {
        let targetEmail: string | undefined;
        let ownerId: string | undefined;
        if (data.userId) {
          const { getSql } = await import("@/lib/db");
          const users = await (await getSql()).query<{ email: string }>(
            `SELECT email FROM "user" WHERE id = $1 LIMIT 1`, [data.userId],
          );
          targetEmail = users[0]?.email;
          if (!targetEmail) {
            return { error: "المستخدم غير موجود.", licenseId: null as string | null, plainKey: null as string | null, type: null as LicenseType | null, keyPrefix: null as string | null };
          }
          ownerId = await ensureKeygenUser({ userId: data.userId, userEmail: targetEmail });
        }
        const issued = await createKeygenLicense({
          plan: providerPlan,
          name: `NASAQ ${data.type} license`,
          expiresAt: data.expiresAt,
          maxUsers: data.maxActivations,
          ownerId,
          metadata: {
            source: "keygen",
            createdBy: context.userId,
            ...(data.userId ? { nasaqUserId: data.userId } : {}),
          },
        });
        // A pre-assigned license must really validate for the assigned user
        // before it is exposed by getLicenseStatusFn. Unassigned keys will be
        // user-locked at their first activation instead.
        const verification = targetEmail ? await validateKeygenLicense(issued.key, targetEmail) : issued;
        if (!verification.valid) throw new Error(`Keygen issued invalid license: ${verification.code}`);
        const license = await persistKeygenLicense(verification, data.userId ?? null);
        return {
          error: null as string | null,
          licenseId: license.id,
          plainKey: verification.key,
          type: license.type,
          keyPrefix: license.keyPrefix,
        };
      } catch {
        return { error: "تعذر إنشاء الترخيص لدى Keygen.", licenseId: null as string | null, plainKey: null as string | null, type: null as LicenseType | null, keyPrefix: null as string | null };
      }
    }

    const result = await dbCreate({
      type: data.type,
      expiresAt: data.expiresAt,
      userId: data.userId,
      maxActivations: data.maxActivations,
    });

    return {
      error: null as string | null,
      licenseId: result.license.id,
      plainKey: result.plainKey,
      type: result.license.type,
      keyPrefix: result.license.keyPrefix,
    };
  });

// ── Admin: List All Licenses ───────────────────────────────────────────────

export const adminListLicensesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { offset?: number; limit?: number }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", licenses: [] as License[], total: 0 };
    }

    const result = await dbListAll(data.offset ?? 0, data.limit ?? 50);
    return { error: null as string | null, licenses: result.licenses, total: result.total };
  });

// ── Admin: Revoke License ─────────────────────────────────────────────────

export const adminRevokeLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    try {
      const providerId = current.metadata?.source === "keygen" ? current.metadata.keygenLicenseId : null;
      if (providerId) await suspendKeygenLicense(providerId);
      const license = await dbRevoke(data.licenseId);
      return { error: null as string | null, license };
    } catch {
      return { error: "تعذر تعليق الترخيص لدى Keygen.", license: current };
    }
  });

// ── Admin: Reactivate License ─────────────────────────────────────────────

export const adminReactivateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    try {
      const providerId = current.metadata?.source === "keygen" ? current.metadata.keygenLicenseId : null;
      if (providerId) await reinstateKeygenLicense(providerId);
      const license = await dbReactivate(data.licenseId);
      return { error: null as string | null, license };
    } catch {
      return { error: "تعذر إعادة تفعيل الترخيص لدى Keygen.", license: current };
    }
  });

// ── Admin: Update License ─────────────────────────────────────────────────
export const adminUpdateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; updates: AdminLicenseUpdate }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const license = await dbUpdate(data.licenseId, data.updates);
    return { error: null as string | null, license };
  });

// ── Admin: Extend License ─────────────────────────────────────────────────
export const extendLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; daysToAdd?: number; newExpiresAt?: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null };

    let targetExpiresAt = data.newExpiresAt;
    if (!targetExpiresAt && data.daysToAdd != null && data.daysToAdd > 0) {
      const base = current.expiresAt ? new Date(current.expiresAt) : new Date();
      targetExpiresAt = new Date(base.getTime() + data.daysToAdd * 86400000).toISOString();
    }
    if (current.metadata?.source === "keygen" && targetExpiresAt) {
      const providerId = current.metadata.keygenLicenseId;
      if (!providerId) return { error: "معرّف ترخيص Keygen غير موجود.", license: current };
      try {
        await updateKeygenLicenseExpiry(providerId, targetExpiresAt);
      } catch {
        return { error: "تعذر تمديد الترخيص لدى Keygen.", license: current };
      }
    }

    const license = await extendLicense(data.licenseId, data.daysToAdd, data.newExpiresAt);
    return { error: null as string | null, license };
  });

// ── Admin: Assign License to User ────────────────────────────────────────
export const assignLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; userId: string; activate?: boolean }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    try {
      const license = await assignLicense(data.licenseId, data.userId, data.activate ?? true);
      return { error: null as string | null, license };
    } catch (error) {
      if (error instanceof LicenseOwnershipError) {
        return { error: "لا يمكن تعيين ترخيص Keygen دون ربطه بالمستخدم لدى Keygen.", license: null as License | null };
      }
      throw error;
    }
  });

// ── Super Admin: hand-held licence administration ───────────────────────────
//
// The owner's escape hatch. Everything below resolves the target user by EMAIL
// as well as by id, because "activate licence for the person who paid" is the
// actual job — an operator should never have to go hunting for a user id in
// another table to do it.

/** Resolve an email (or an id) to a verified user id. */
async function resolveUserId(value: string): Promise<string | null> {
  const needle = value.trim();
  if (!needle) return null;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  if (needle.includes("@")) {
    const rows = await sql<{ id: string }>`
      select id from "user" where lower(email) = ${needle.toLowerCase()} limit 1
    `;
    return rows[0]?.id ?? null;
  }
  const rows = await sql<{ id: string }>`
    select id from "user" where id = ${needle} limit 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * Activate (or re-assign) a licence for a specific account.
 *
 * Super-administrator only, and deliberately explicit: it takes the licence and
 * the target user in one call, so a half-applied manual activation cannot leave
 * a licence floating with no owner.
 */
export const superAdminAssignLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; user: string; activate?: boolean }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    const userId = await resolveUserId(data.user);
    if (!userId) return { error: "المستخدم غير موجود.", license: null as License | null };
    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    try {
      const license = await assignLicense(data.licenseId, userId, data.activate ?? true);
      return { error: null as string | null, license };
    } catch (error) {
      return {
        error: error instanceof LicenseOwnershipError
          ? "لا يمكن تعيين ترخيص Keygen دون ربطه بالمستخدم لدى Keygen."
          : error instanceof Error ? error.message : "تعذّر تعيين الترخيص.",
        license: null as License | null,
      };
    }
  });

/**
 * Set an exact expiry — the "precise" half of manual licence control.
 *
 * Extending by a number of days compounds rounding drift across renewals; an
 * absolute date does not. Both remain available, but the operator who needs
 * "valid until 31 December" now has a way to say exactly that.
 */
export const superAdminSetLicenseExpiryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; expiresAt: string | null }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };

    let expiresAt = data.expiresAt;
    if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return { error: "تاريخ انتهاء غير صالح.", license: current };
      }
      expiresAt = parsed.toISOString();
    }

    if (current.metadata?.source === "keygen" && expiresAt) {
      const providerId = current.metadata.keygenLicenseId;
      if (!providerId) {
        return { error: "معرّف ترخيص Keygen غير موجود.", license: current };
      }
      try {
        await updateKeygenLicenseExpiry(providerId, expiresAt);
      } catch {
        return { error: "تعذر تحديث الترخيص لدى Keygen.", license: current };
      }
    }

    try {
      // `extendLicense` only ever moves a date forwards, so clearing an expiry
      // (an owner converting a term licence to an open one) goes through the
      // generic update instead.
      const license = expiresAt
        ? await extendLicense(data.licenseId, undefined, expiresAt)
        : await dbUpdate(data.licenseId, { expiresAt: null });
      return { error: null as string | null, license };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "تعذّر تحديث الترخيص.",
        license: null as License | null,
      };
    }
  });
