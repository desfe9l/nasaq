/**
 * NASAQ License — Server functions (TanStack Start).
 *
 * These are the ONLY entry points the client uses for license operations.
 * Each function validates the caller, checks rate limits, and delegates
 * to the server-side database operations.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { hashLicenseKey, isKeygenKeyFormat, isValidKeyFormat, keyPrefix } from "./key";
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
  upsertExternalLicense,
} from "./server";
import {
  createKeygenLicense,
  isKeygenConfigured,
  keygenPlanForLicenseType,
  reinstateKeygenLicense,
  suspendKeygenLicense,
  updateKeygenLicenseExpiry,
  validateKeygenLicense,
  type KeygenVerification,
} from "./keygen";
import { checkRateLimit } from "./rate-limit";
import { entitlementsForPlan, entitlementsFromKeygenCodes } from "./types";
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

async function isAdministrator(
  context: { userId: string; userEmail: string | null },
): Promise<boolean> {
  const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
  const access = await getAuthorizationContext({
    id: context.userId,
    email: context.userEmail,
  });
  return access.isAdmin;
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

function keygenMessage(verification: KeygenVerification): string {
  const messages: Record<string, string> = {
    NOT_FOUND: "مفتاح الترخيص غير صالح أو غير متاح.",
    EXPIRED: "انتهت صلاحية هذا الترخيص.",
    SUSPENDED: "تم تعليق هذا الترخيص.",
    BANNED: "تم إيقاف هذا الترخيص.",
    PRODUCT_SCOPE_MISMATCH: "مفتاح الترخيص لا يخص منتج NASAQ.",
    TOO_MANY_USERS: "تم الوصول إلى الحد الأقصى لمستخدمي هذا الترخيص.",
  };
  return messages[verification.code] || "تعذر التحقق من حالة الترخيص.";
}

async function persistKeygenLicense(verification: KeygenVerification, userId: string | null, existing?: License): Promise<License> {
  return upsertExternalLicense({
    keyHash: hashLicenseKey(verification.key),
    keyPrefix: keyPrefix(verification.key),
    type: verification.type,
    userId: userId ?? existing?.userId ?? null,
    expiresAt: verification.expiresAt,
    activationCount: verification.activationCount,
    maxActivations: verification.maxActivations,
    status: verification.status,
    metadata: verification.metadata,
  });
}

// ── Public: Activate License ───────────────────────────────────────────────

export const activateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { key: string; email?: string }) => data)
  .handler(async ({ data, context }): Promise<LicenseActivateResult> => {
    const ip = await getClientIp();

    // Rate limit: 5 attempts per minute per IP
    if (!checkRateLimit("license:activate", ip, 5, 60_000)) {
      return {
        success: false,
        message: "تم تجاوز الحد المسموح من المحاولات. يرجى المحاولة لاحقًا.",
      };
    }

    const key = data.key.trim();
    const manualKey = isValidKeyFormat(key);
    const keygenKey = !manualKey && isKeygenKeyFormat(key);
    if (!manualKey && !keygenKey) {
      return {
        success: false,
        message: "مفتاح الترخيص غير صالح.",
      };
    }

    const keyHash = hashLicenseKey(key);
    // Bind activation to the verified session identity. A client cannot choose
    // which account receives the license.
    const sessionUserId = context.userId;
    const local = await findLicenseByKeyHash(keyHash);
    if (keygenKey || local?.metadata?.source === "keygen") {
      if (!isKeygenConfigured()) {
        return { success: false, message: "تحقق Keygen غير مهيأ على الخادم." };
      }
      try {
        const verified = await validateKeygenLicense(key);
        if (!verified.valid) return { success: false, message: keygenMessage(verified) };
        const license = await persistKeygenLicense(verified, sessionUserId, local ?? undefined);
        return { success: true, message: "تم تفعيل الترخيص بنجاح.", license: publicLicense(license) };
      } catch {
        return { success: false, message: "تعذر التحقق من حالة ترخيص Keygen." };
      }
    }
    const result = local ? await dbActivate(keyHash, sessionUserId) : null;

    if (!result || !result.success) {
      const messages: Record<string, string> = {
        NOT_FOUND: "مفتاح الترخيص غير صالح أو غير متاح للتفعيل.",
        REVOKED: "تم إلغاء هذا الترخيص.",
        EXPIRED: "انتهت صلاحية هذا الترخيص.",
        ACTIVATION_LIMIT: "تم الوصول إلى الحد الأقصى لتفعيل هذا الترخيص.",
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
    };
  });

// ── Public: Validate License ───────────────────────────────────────────────

export const validateLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { key: string }) => data)
  .handler(async ({ data }): Promise<LicenseValidateResult> => {
    const ip = await getClientIp();

    if (!checkRateLimit("license:validate", ip, 20, 60_000)) {
      return { valid: false };
    }

    const key = data.key.trim();
    const manualKey = isValidKeyFormat(key);
    const keygenKey = !manualKey && isKeygenKeyFormat(key);
    if (!manualKey && !keygenKey) {
      return { valid: false };
    }

    const keyHash = hashLicenseKey(key);
    const local = await findLicenseByKeyHash(keyHash);
    if (keygenKey || local?.metadata?.source === "keygen") {
      if (!isKeygenConfigured()) return { valid: false };
      try {
        const verified = await validateKeygenLicense(key);
        if (!verified.valid) return { valid: false };
        const license = await persistKeygenLicense(verified, local?.userId ?? null, local ?? undefined);
        return { valid: true, license: publicLicense(license), entitlements: entitlementsFor(license) };
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
    const key = data.key.trim();
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
    if (!active) return { hasLicense: false, entitlements: access.entitlements };

    const entitlements = access.entitlements;
    return {
      hasLicense: true,
      license: {
        id: active.id,
        type: active.type,
        status: active.status,
        keyPrefix: active.keyPrefix,
        activatedAt: active.activatedAt,
        expiresAt: active.expiresAt,
        createdAt: active.createdAt,
      },
      entitlements,
    };
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
        const verification = await createKeygenLicense({
          plan: providerPlan,
          name: `NASAQ ${data.type} license`,
          expiresAt: data.expiresAt,
          maxUsers: data.maxActivations,
          metadata: {
            source: "keygen",
            createdBy: context.userId,
            ...(data.userId ? { nasaqUserId: data.userId } : {}),
          },
        });
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
    const license = await assignLicense(data.licenseId, data.userId, data.activate ?? true);
    return { error: null as string | null, license };
  });
