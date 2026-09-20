/**
 * NASAQ License — Server functions (TanStack Start).
 *
 * These are the ONLY entry points the client uses for license operations.
 * Each function validates the caller, checks rate limits, and delegates
 * to the server-side database operations.
 */

import { createServerFn } from "@tanstack/react-start";
import { hashLicenseKey, isLemonSqueezyKeyFormat, isValidKeyFormat, keyPrefix } from "./key";
import {
  activateLicense as dbActivate,
  validateLicense as dbValidate,
  createLicense as dbCreate,
  listAllLicenses as dbListAll,
  findLicenseById,
  revokeLicense as dbRevoke,
  reactivateLicense as dbReactivate,
  updateLicense as dbUpdate,
  findLicensesByUserId,
  extendLicense,
  assignLicense,
  findLicenseByKeyHash,
  upsertExternalLicense,
} from "./server";
import { activateLemonLicense, deactivateLemonLicense, isLemonSqueezyConfigured, validateLemonLicense } from "./lemonsqueezy.server";
import { checkRateLimit } from "./rate-limit";
import { LICENSE_ENTITLEMENTS } from "./types";
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

/** Check if the caller is an admin (via ADMIN_SECRET header). */
function isAdmin(headers: Headers): boolean {
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!secret) return false;
  return headers.get("x-admin-secret") === secret;
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
    source: license.metadata?.source === "lemonsqueezy" ? "lemonsqueezy" : "manual",
    plan: license.metadata?.plan as LicenseInfo["plan"],
    variantId: license.metadata?.variantId,
  };
}

function entitlementsFor(license: License): Record<import("./types").FeatureId, boolean> {
  const plan = license.metadata?.plan;
  if (plan?.startsWith("individual-")) {
    return { ...LICENSE_ENTITLEMENTS.PRO, collaboration: false, team_features: false, multi_user_activation: false };
  }
  return LICENSE_ENTITLEMENTS[license.type];
}

// ── Public: Activate License ───────────────────────────────────────────────

export const activateLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { key: string; userId?: string }) => data)
  .handler(async ({ data }): Promise<LicenseActivateResult> => {
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
    const lemonKey = isLemonSqueezyKeyFormat(key);
    if (!manualKey && !lemonKey) {
      return {
        success: false,
        message: "مفتاح الترخيص غير صالح.",
      };
    }

    const keyHash = hashLicenseKey(key);
    const local = await findLicenseByKeyHash(keyHash);
    if (local?.metadata?.source === "lemonsqueezy") {
      try {
        const verified = await validateLemonLicense(key, local.metadata.instanceId);
        const license = await upsertExternalLicense({
          keyHash,
          keyPrefix: keyPrefix(key),
          type: "PRO",
          userId: data.userId ?? null,
          expiresAt: verified.expiresAt,
          activationCount: verified.activationCount,
          maxActivations: verified.maxActivations,
          metadata: verified.metadata,
        });
        return { success: true, message: "تم تفعيل الترخيص بنجاح.", license: publicLicense(license) };
      } catch {
        return { success: false, message: "تعذر التحقق من حالة ترخيص Lemon Squeezy." };
      }
    }
    const result = local ? await dbActivate(keyHash, data.userId ?? null) : null;

    if (lemonKey && (!local || local.metadata?.source !== "lemonsqueezy")) {
      if (!isLemonSqueezyConfigured()) {
        return { success: false, message: "تحقق Lemon Squeezy غير مهيأ على الخادم." };
      }
      try {
        const verified = await activateLemonLicense(key);
        const license = await upsertExternalLicense({
          keyHash,
          keyPrefix: keyPrefix(key),
          type: "PRO",
          userId: data.userId ?? null,
          expiresAt: verified.expiresAt,
          activationCount: verified.activationCount,
          maxActivations: verified.maxActivations,
          metadata: verified.metadata,
        });
        return { success: true, message: "تم تفعيل الترخيص بنجاح.", license: publicLicense(license) };
      } catch {
        return { success: false, message: "تعذر التحقق من مفتاح Lemon Squeezy." };
      }
    }

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
    if (!isValidKeyFormat(key) && !isLemonSqueezyKeyFormat(key)) {
      return { valid: false };
    }

    const keyHash = hashLicenseKey(key);
    const local = await findLicenseByKeyHash(keyHash);
    if (isLemonSqueezyKeyFormat(key) && (!local || local.metadata?.source !== "lemonsqueezy")) {
      if (!isLemonSqueezyConfigured()) return { valid: false };
      try {
        const verified = await validateLemonLicense(key);
        await upsertExternalLicense({
          keyHash,
          keyPrefix: keyPrefix(key),
          type: "PRO",
          userId: null,
          expiresAt: verified.expiresAt,
          activationCount: verified.activationCount,
          maxActivations: verified.maxActivations,
          metadata: verified.metadata,
        });
      } catch {
        return { valid: false };
      }
    }

    if (local?.metadata?.source === "lemonsqueezy") {
      try {
        const verified = await validateLemonLicense(key, local.metadata.instanceId);
        await upsertExternalLicense({
          keyHash,
          keyPrefix: keyPrefix(key),
          type: "PRO",
          userId: local.userId,
          expiresAt: verified.expiresAt,
          activationCount: verified.activationCount,
          maxActivations: verified.maxActivations,
          metadata: verified.metadata,
        });
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
  .validator((data: { key: string }) => data)
  .handler(async ({ data }) => {
    const key = data.key.trim();
    if (!isLemonSqueezyKeyFormat(key) || !isLemonSqueezyConfigured()) return { success: false };
    const local = await findLicenseByKeyHash(hashLicenseKey(key));
    const instanceId = local?.metadata?.instanceId;
    if (!local || !instanceId) return { success: false };
    try {
      await deactivateLemonLicense(key, instanceId);
      await dbRevoke(local.id);
      return { success: true };
    } catch {
      return { success: false };
    }
  });

// ── Auth: Get My License Status ────────────────────────────────────────────

export const getLicenseStatusFn = createServerFn({ method: "POST" })
  .validator((data: { userId: string }) => data)
  .handler(async ({ data }): Promise<LicenseStatusResult> => {
    const licenses = await findLicensesByUserId(data.userId);

    // Find the most relevant active license
    const active = licenses.find(
      (l) => l.status === "ACTIVE" && (!l.expiresAt || new Date(l.expiresAt) > new Date()),
    );

    if (!active) {
      return { hasLicense: false };
    }

    const entitlements = entitlementsFor(active);
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
  .validator((data: AdminLicenseCreate & { adminSecret: string }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", licenseId: null as string | null, plainKey: null as string | null, type: null as LicenseType | null, keyPrefix: null as string | null };
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
  .validator((data: { adminSecret: string; offset?: number; limit?: number }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", licenses: [] as License[], total: 0 };
    }

    const result = await dbListAll(data.offset ?? 0, data.limit ?? 50);
    return { error: null as string | null, licenses: result.licenses, total: result.total };
  });

// ── Admin: Revoke License ─────────────────────────────────────────────────

export const adminRevokeLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { adminSecret: string; licenseId: string }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const license = await dbRevoke(data.licenseId);
    return { error: null as string | null, license };
  });

// ── Admin: Reactivate License ─────────────────────────────────────────────

export const adminReactivateLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { adminSecret: string; licenseId: string }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const license = await dbReactivate(data.licenseId);
    return { error: null as string | null, license };
  });// ── Admin: Update License ─────────────────────────────────────────────────
export const adminUpdateLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { adminSecret: string; licenseId: string; updates: AdminLicenseUpdate }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", license: null as License | null };
    }

    const license = await dbUpdate(data.licenseId, data.updates);
    return { error: null as string | null, license };
  });

// ── Admin: Extend License ─────────────────────────────────────────────────
export const extendLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { adminSecret: string; licenseId: string; daysToAdd?: number; newExpiresAt?: string }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    const license = await extendLicense(data.licenseId, data.daysToAdd, data.newExpiresAt);
    return { error: null as string | null, license };
  });

// ── Admin: Assign License to User ────────────────────────────────────────
export const assignLicenseFn = createServerFn({ method: "POST" })
  .validator((data: { adminSecret: string; licenseId: string; userId: string; activate?: boolean }) => data)
  .handler(async ({ data }) => {
    if (!data.adminSecret || !isAdmin(new Headers({ "x-admin-secret": data.adminSecret }))) {
      return { error: "غير مصرح.", license: null as License | null };
    }
    const license = await assignLicense(data.licenseId, data.userId, data.activate ?? true);
    return { error: null as string | null, license };
  });
