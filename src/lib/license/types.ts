/**
 * NASAQ License Management — Type definitions.
 *
 * These types are shared between server and client code.
 * The actual license validation always happens server-side.
 */

// ── License Types ──────────────────────────────────────────────────────────

export type LicenseType = "FREE" | "TRIAL" | "PRO" | "LIFETIME";
export type LicenseStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

/** Full license record as stored in the database. */
export interface License {
  id: string;
  keyHash: string;
  keyPrefix: string;
  type: LicenseType;
  status: LicenseStatus;
  userId: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  activationCount: number;
  maxActivations: number | null;
  metadata: Record<string, string> | null;  // serializable for server functions
}

/** Minimal license info sent to the client (never the key hash). */
export interface LicenseInfo {
  id: string;
  type: LicenseType;
  status: LicenseStatus;
  keyPrefix: string;
  activatedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ── Feature Entitlements ───────────────────────────────────────────────────

export type FeatureId =
  | "core_editor"
  | "basic_export"
  | "premium_templates"
  | "advanced_export"
  | "brand_kit"
  | "unlimited_projects"
  | "unlimited_pages"
  | "data_import"
  | "collaboration";

/** Feature entitlements per license type. */
export const LICENSE_ENTITLEMENTS: Record<LicenseType, Record<FeatureId, boolean>> = {
  FREE: {
    core_editor: true,
    basic_export: true,
    premium_templates: false,
    advanced_export: false,
    brand_kit: false,
    unlimited_projects: false,
    unlimited_pages: false,
    data_import: false,
    collaboration: false,
  },
  TRIAL: {
    core_editor: true,
    basic_export: true,
    premium_templates: true,
    advanced_export: true,
    brand_kit: true,
    unlimited_projects: true,
    unlimited_pages: true,
    data_import: true,
    collaboration: false,
  },
  PRO: {
    core_editor: true,
    basic_export: true,
    premium_templates: true,
    advanced_export: true,
    brand_kit: true,
    unlimited_projects: true,
    unlimited_pages: true,
    data_import: true,
    collaboration: true,
  },
  LIFETIME: {
    core_editor: true,
    basic_export: true,
    premium_templates: true,
    advanced_export: true,
    brand_kit: true,
    unlimited_projects: true,
    unlimited_pages: true,
    data_import: true,
    collaboration: true,
  },
};

/** User-facing feature display names (Arabic). */
export const FEATURE_LABELS: Record<FeatureId, { name: string; description: string }> = {
  core_editor: { name: "المحرر الأساسي", description: "تحرير النصوص والصور والأشكال والجداول" },
  basic_export: { name: "التصدير الأساسي", description: "تصدير PDF وPNG وJPG" },
  premium_templates: { name: "القوالب المتميزة", description: "الوصول إلى جميع القوالب الجاهزة" },
  advanced_export: { name: "التصدير المتقدم", description: "تصدير Word وPowerPoint وHTML" },
  brand_kit: { name: "هوية البراند", description: "管理和 تطبيق الهوية المؤسسية" },
  unlimited_projects: { name: "مشاريع غير محدودة", description: "إنشاء عدد غير محدود من المشاريع" },
  unlimited_pages: { name: "صفحات غير محدودة", description: "إضافة عدد غير محدود من الصفحات" },
  data_import: { name: "استيراد البيانات", description: "استيراد البيانات والقوالب من ملفات" },
  collaboration: { name: "التعاون", description: "مشاركة المشاريع والعمل الجماعي" },
};

// ── API Response Types ─────────────────────────────────────────────────────

export interface LicenseActivateResult {
  success: boolean;
  message: string;
  license?: LicenseInfo;
}

export interface LicenseValidateResult {
  valid: boolean;
  license?: LicenseInfo;
  entitlements?: Record<FeatureId, boolean>;
}

export interface LicenseStatusResult {
  hasLicense: boolean;
  license?: LicenseInfo;
  entitlements?: Record<FeatureId, boolean>;
}

// ── Admin Types ────────────────────────────────────────────────────────────

export interface AdminLicenseCreate {
  type: LicenseType;
  expiresAt?: string;
  userId?: string;
  maxActivations?: number;
}

export interface AdminLicenseList {
  licenses: License[];
  total: number;
}

export interface AdminLicenseUpdate {
  status?: LicenseStatus;
  expiresAt?: string;
  maxActivations?: number;
}
