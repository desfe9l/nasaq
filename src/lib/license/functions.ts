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
  findLicenseByKeyHash,
  findLicenseById,
  findLicensesByUserId,
  LicenseOwnershipError,
} from "./server";
import {
  createKeygenLicense,
  ensureKeygenUser,
  isKeygenConfigured,
  keygenPolicyId,
  keygenProductId,
  getKeygenLicenseForClaim,
  KeygenOwnershipError,
  keygenPlanForLicenseType,
  reinstateKeygenLicense,
  suspendKeygenLicense,
  updateKeygenLicenseExpiry,
} from "./keygen";
import { activateKeygenForSession, persistKeygenLicense, revalidateKeygenForSession } from "./activation.server";
import { checkRateLimit } from "./rate-limit";
import { licensingIntegrationReadiness } from "./integrations.server";
import { getCatalogPlan } from "@/lib/commercial/catalog";
import { entitlementsForPlan, entitlementsFromKeygenCodes, LICENSE_ENTITLEMENTS } from "./types";
import type {
  License,
  AdminLicenseRow,
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

async function accountSuspended(userId: string): Promise<boolean> {
  const { getSql } = await import("@/lib/db");
  const { getSubscription } = await import("@/lib/commercial/entitlement.server");
  return (await getSubscription(await getSql(), userId))?.status === "SUSPENDED";
}

async function isSuperAdministrator(context: { userId: string; userEmail: string | null }): Promise<boolean> {
  if (!(await isAdministrator(context))) return false;
  const { getSql } = await import("@/lib/db");
  const { isSuperAdminIdentity } = await import("@/lib/auth/super-admin.server");
  return isSuperAdminIdentity(await getSql(), { id: context.userId, email: context.userEmail });
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

    if (await accountSuspended(context.userId)) {
      return { success: false, message: "أوقفت الإدارة وصول هذا الحساب مؤقتًا. تواصل معها لاستعادة التفعيل." };
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

    if (await accountSuspended(context.userId)) return { valid: false };
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
    // This is a *device cache* operation. A customer must not be able to
    // suspend a purchased Keygen key (or revoke a manual key) by pressing
    // "remove saved key". Provider/admin revocation uses its own gated route.
    // The browser removes the plaintext key; the account binding survives.
    return { success: local.userId === context.userId };
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
    if (access.isSuspended) {
      return { hasLicense: false, isSuspended: true, entitlements: { ...LICENSE_ENTITLEMENTS.FREE },
        message: "أوقفت الإدارة وصول هذا الحساب مؤقتًا. تواصل مع الإدارة لاستعادة التفعيل." };
    }
    if (access.license) {
      // getAuthorizationContext already revalidated Keygen for this very
      // request; do not issue a second provider call from the status page.
      return { hasLicense: true, license: publicLicense(access.license), entitlements: access.entitlements };
    }
    const ownLicenses = await findLicensesByUserId(context.userId);
    const previous = ownLicenses[0];
    if (!previous) return { hasLicense: false, entitlements: access.entitlements };
    // Keep the type and inactive state visible without unlocking features.
    const info = publicLicense(previous);
    if (info.status === "ACTIVE" && info.expiresAt && Date.parse(info.expiresAt) <= Date.now()) {
      info.status = "EXPIRED";
    }
    const message = info.status === "ACTIVE" && previous.metadata?.source === "keygen"
      ? previous.metadata.userScopeVerified === context.userId
        ? "تعذر التحقق من Keygen حاليًا. أعد المحاولة؛ لن تُفعّل الميزات دون تحقق."
        : "الترخيص بانتظار الربط مع Keygen. أعد التحقق أو أدخل المفتاح إذا كان لديك."
      : undefined;
    return { hasLicense: false, license: info, entitlements: { ...LICENSE_ENTITLEMENTS.FREE }, message };
  });

// ── Admin: Provider setup & non-financial connectivity checks ───────────────

export const adminLicenseIntegrationsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!(await isAdministrator(context))) return { error: "غير مصرح.", readiness: null };
    return { error: null as string | null, readiness: licensingIntegrationReadiness() };
  });

export const adminCheckLicenseConnectionsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", keygen: false };
    }
    const { checkKeygenApiConnection } = await import("./keygen");
    const readiness = licensingIntegrationReadiness();
    // The check never creates licences or returns tokens/provider errors.
    const keygen = readiness.keygen.token
      ? await checkKeygenApiConnection().then(() => true, () => false)
      : false;
    return { error: null as string | null, keygen };
  });

// ── Admin: Create License ─────────────────────────────────────────────────

export const adminCreateLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: AdminLicenseCreate) => data)
  .handler(async ({ data, context }) => {
    const fail = (error: string) => ({ error, licenseId: null as string | null,
      plainKey: null as string | null, type: null as LicenseType | null, keyPrefix: null as string | null });
    if (!(await isSuperAdministrator(context))) return fail("إنشاء التراخيص لصلاحية المالك فقط.");
    if (!["FREE", "TRIAL", "PRO", "LIFETIME"].includes(data.type) ||
        (data.plan && data.type !== "PRO")) return fail("نوع الترخيص غير صالح.");
    const plan = data.type === "PRO" ? getCatalogPlan(data.plan || "individual-monthly") : null;
    if (data.type === "PRO" && !plan) return fail("باقة Keygen غير معروفة.");
    if (data.maxActivations !== undefined && (!Number.isInteger(data.maxActivations) ||
        data.maxActivations < 1 || data.maxActivations > 100)) return fail("عدد التفعيلات غير صالح.");
    const userInput = data.user?.trim() || data.userId?.trim() || "";
    const target = userInput ? await resolveUser(userInput) : null;
    if (userInput && !target) return fail("المستخدم غير موجود. أدخل بريد حساب مسجّل أو معرّفه.");
    const duration = plan?.durationDays ?? (data.type === "TRIAL" ? 30 : null);
    const expiresAt = data.expiresAt || (duration ? new Date(Date.now() + duration * 86400000).toISOString() : undefined);
    if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
      return fail("تاريخ الانتهاء يجب أن يكون مستقبلًا.");
    }

    const providerPlan = plan?.keygenPolicyKey || keygenPlanForLicenseType(data.type);
    if (providerPlan) {
      if (!isKeygenConfigured()) return fail("KEYGEN_API_TOKEN غير مهيأ على الخادم.");
      if (!keygenPolicyId(providerPlan)) return fail(`سياسة Keygen للباقة ${providerPlan} غير مهيأة.`);
      try {
        const ownerId = target ? await ensureKeygenUser({ userId: target.id, userEmail: target.email }) : undefined;
        const issued = await createKeygenLicense({
          plan: providerPlan,
          name: `NASAQ ${providerPlan} license`,
          expiresAt,
          maxUsers: data.maxActivations,
          ownerId,
          metadata: {
            source: "keygen",
            createdBy: context.userId,
            ...(target ? { nasaqUserId: target.id } : {}),
          },
        });
        // The assigned user's Keygen identity must validate BEFORE this
        // licence becomes available to their account. For policies requiring
        // license.users.attach, the common activation path handles that too.
        const activation = target
          ? await activateKeygenForSession(issued.key, { userId: target.id, userEmail: target.email })
          : null;
        if (activation && !activation.success) throw new Error(activation.message);
        const license = activation ? activation.license : await persistKeygenLicense(issued, null);
        return { error: null as string | null, licenseId: license.id,
          plainKey: issued.key, type: license.type, keyPrefix: license.keyPrefix };
      } catch (error) {
        console.error("[license] admin issuance failed", error);
        return fail("تعذر إصدار أو ربط الترخيص لدى Keygen. تحقق من الصلاحيات والاتصال.");
      }
    }

    const result = await dbCreate({ type: data.type, expiresAt,
      userId: target?.id, maxActivations: data.maxActivations });
    return { error: null as string | null, licenseId: result.license.id,
      plainKey: result.plainKey, type: result.license.type, keyPrefix: result.license.keyPrefix };
  });

// ── Admin: List All Licenses ───────────────────────────────────────────────

export const adminListLicensesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { offset?: number; limit?: number; search?: string; status?: "ALL" | "ACTIVE" | "EXPIRED" | "REVOKED" }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isAdministrator(context))) {
      return { error: "غير مصرح.", licenses: [] as AdminLicenseRow[], total: 0 };
    }

    const result = await dbListAll(data.offset ?? 0, data.limit ?? 50,
      typeof data.search === "string" ? data.search : "", data.status ?? "ALL");
    return { error: null as string | null, licenses: result.licenses, total: result.total };
  });

// ── Admin: Revoke License ─────────────────────────────────────────────────

export const adminRevokeLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isSuperAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    try {
      const providerId = current.metadata?.source === "keygen" ? current.metadata.keygenLicenseId : null;
      if (current.metadata?.source === "keygen" && !providerId) return { error: "معرّف ترخيص Keygen غير موجود.", license: current };
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
    if (!(await isSuperAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    if (current.expiresAt && Date.parse(current.expiresAt) <= Date.now()) {
      return { error: "مدّد تاريخ انتهاء الترخيص أولًا، ثم أعد التفعيل.", license: current };
    }
    try {
      const providerId = current.metadata?.source === "keygen" ? current.metadata.keygenLicenseId : null;
      if (current.metadata?.source === "keygen" && !providerId) return { error: "معرّف ترخيص Keygen غير موجود.", license: current };
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
    if (!(await isSuperAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    if (current.metadata?.source === "keygen") {
      return { error: "عدّل ترخيص Keygen عبر إجراء الإيقاف أو التمديد المخصص لمزامنة المزوّد.", license: current };
    }
    const license = await dbUpdate(data.licenseId, data.updates);
    return { error: null as string | null, license };
  });

// ── Admin: Extend License ─────────────────────────────────────────────────
export const extendLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; daysToAdd?: number; newExpiresAt?: string }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isSuperAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null };

    const days = data.daysToAdd;
    if (days != null && (!Number.isInteger(days) || days <= 0 || days > 3650)) {
      return { error: "مدة التمديد يجب أن تكون بين يوم و3650 يومًا.", license: current };
    }
    let targetExpiresAt = data.newExpiresAt;
    if (targetExpiresAt && (!Number.isFinite(Date.parse(targetExpiresAt)) || Date.parse(targetExpiresAt) <= Date.now())) {
      return { error: "تاريخ التمديد يجب أن يكون مستقبلًا.", license: current };
    }
    if (!targetExpiresAt && days) {
      const base = Math.max(Date.now(), current.expiresAt ? Date.parse(current.expiresAt) : 0);
      targetExpiresAt = new Date(base + days * 86400000).toISOString();
    }
    if (!targetExpiresAt) return { error: "أدخل مدة أو تاريخ انتهاء جديدًا.", license: current };
    if (current.metadata?.source === "keygen") {
      const providerId = current.metadata.keygenLicenseId;
      if (!providerId) return { error: "معرّف ترخيص Keygen غير موجود.", license: current };
      try {
        await updateKeygenLicenseExpiry(providerId, targetExpiresAt);
      } catch {
        return { error: "تعذر تمديد الترخيص لدى Keygen.", license: current };
      }
    }

    const license = await extendLicense(data.licenseId, undefined, targetExpiresAt);
    return { error: null as string | null, license };
  });

// ── Admin: Assign License to User ────────────────────────────────────────
export const assignLicenseFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { licenseId: string; userId: string; activate?: boolean }) => data)
  .handler(async ({ data, context }) => {
    if (!(await isSuperAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    const target = await resolveUser(data.userId);
    if (!target) return { error: "المستخدم غير موجود.", license: null as License | null };
    try {
      const license = await assignLicense(data.licenseId, target.id, data.activate ?? true);
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

/** Resolve an email (or an id) to an actual Better Auth user. */
async function resolveUser(value: string): Promise<{ id: string; email: string } | null> {
  const needle = value.trim();
  if (!needle) return null;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  if (needle.includes("@")) {
    const rows = await sql<{ id: string; email: string }>`
      select id, email from "user" where lower(email) = ${needle.toLowerCase()} limit 1
    `;
    return rows[0] ?? null;
  }
  const rows = await sql<{ id: string; email: string }>`
    select id, email from "user" where id = ${needle} limit 1
  `;
  return rows[0] ?? null;
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
    if (!(await isSuperAdministrator(context))) {
      return { error: "تعيين التراخيص لصلاحية المالك فقط.", license: null as License | null };
    }
    const target = await resolveUser(data.user);
    if (!target) return { error: "المستخدم غير موجود.", license: null as License | null };
    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };
    try {
      if (current.metadata?.source === "keygen") {
        if (!current.metadata.keygenLicenseId ||
            (current.userId && current.userId !== target.id) ||
            (current.metadata.nasaqUserId && current.metadata.nasaqUserId !== target.id)) {
          return { error: "هذا الترخيص مربوط بحساب آخر لدى Keygen.", license: null as License | null };
        }
        const remote = await getKeygenLicenseForClaim(current.metadata.keygenLicenseId);
        if (remote.productId !== keygenProductId() ||
            hashLicenseKey(remote.key) !== current.keyHash) {
          return { error: "بيانات ترخيص Keygen لا تطابق السجل المحلي.", license: null as License | null };
        }
        const result = await activateKeygenForSession(remote.key, { userId: target.id, userEmail: target.email });
        return result.success
          ? { error: null as string | null, license: result.license }
          : { error: result.message, license: null as License | null };
      }
      const license = await assignLicense(data.licenseId, target.id, data.activate ?? true);
      return { error: null as string | null, license };
    } catch (error) {
      return { error: error instanceof LicenseOwnershipError || error instanceof KeygenOwnershipError
        ? "مفتاح الترخيص لا يخص هذا المستخدم."
        : "تعذّر ربط الترخيص. تحقق من اتصال Keygen وبيانات المستخدم.", license: null as License | null };
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
    if (!(await isSuperAdministrator(context))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    const current = await findLicenseById(data.licenseId);
    if (!current) return { error: "الترخيص غير موجود.", license: null as License | null };

    let expiresAt = data.expiresAt;
    if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        return { error: "تاريخ الانتهاء يجب أن يكون مستقبلًا.", license: current };
      }
      expiresAt = parsed.toISOString();
    }

    if (current.metadata?.source === "keygen") {
      const providerId = current.metadata.keygenLicenseId;
      if (!providerId) {
        return { error: "معرّف ترخيص Keygen غير موجود.", license: current };
      }
      try {
        // Clearing an expiry must clear it at Keygen too; otherwise a local
        // "مدى الحياة" row would be rejected by the provider on next check.
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
