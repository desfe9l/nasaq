/**
 * NASAQ License Management — Type definitions.
 *
 * These types are shared between server and client code.
 * The actual license validation always happens server-side.
 */

// ── License Types ──────────────────────────────────────────────────────────

export type LicenseType = "FREE" | "TRIAL" | "PRO" | "LIFETIME";
export type LicenseSource = "manual" | "keygen";
export type LicensePlan = "individual-monthly" | "individual-quarterly" | "team-monthly" | "team-quarterly";
export type BillingPeriod = "monthly" | "quarterly";
export type LicenseStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

/**
 * User-facing license type labels — the single source the website and the
 * License Control Panel both render, so a type never appears under two names.
 * The raw type id stays visible in parentheses for support/debugging.
 */
export const LICENSE_TYPE_LABELS: Record<LicenseType, string> = {
  FREE: "مجاني (FREE)",
  TRIAL: "تجريبي (TRIAL)",
  PRO: "احترافي (PRO)",
  LIFETIME: "مدى الحياة (LIFETIME)",
};

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
  source?: LicenseSource;
  plan?: LicensePlan;
  billing?: BillingPeriod;
  variantId?: string;
  customerEmail?: string;
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
  | "ai_report"
  | "collaboration"
  | "team_features"
  | "multi_user_activation";

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
    ai_report: false,
    collaboration: false,
    team_features: false,
    multi_user_activation: false,
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
    ai_report: true,
    collaboration: false,
    team_features: false,
    multi_user_activation: false,
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
    ai_report: true,
    collaboration: true,
    team_features: true,
    multi_user_activation: true,
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
    ai_report: true,
    collaboration: true,
    team_features: true,
    multi_user_activation: true,
  },
};

export function entitlementsForPlan(plan: LicensePlan | undefined, type: LicenseType): Record<FeatureId, boolean> {
  if (plan?.startsWith("individual-")) {
    return { ...LICENSE_ENTITLEMENTS.PRO, collaboration: false, team_features: false, multi_user_activation: false };
  }
  return LICENSE_ENTITLEMENTS[type];
}

/** User-facing feature display names (Arabic). */
export const FEATURE_LABELS: Record<FeatureId, { name: string; description: string }> = {
  core_editor: { name: "المحرر الأساسي", description: "تحرير النصوص والصور والأشكال والجداول" },
  basic_export: { name: "التصدير الأساسي", description: "تصدير PDF وPNG وJPG" },
  premium_templates: { name: "القوالب المتميزة", description: "الوصول إلى جميع القوالب الجاهزة" },
  advanced_export: { name: "التصدير المتقدم", description: "تصدير Word وPowerPoint وHTML" },
  brand_kit: { name: "الهوية المؤسسية", description: "إدارة وتطبيق الهوية المؤسسية" },
  unlimited_projects: { name: "مشاريع غير محدودة", description: "إنشاء عدد غير محدود من المشاريع" },
  unlimited_pages: { name: "صفحات غير محدودة", description: "إضافة عدد غير محدود من الصفحات" },
  data_import: { name: "استيراد البيانات", description: "استيراد البيانات والقوالب من ملفات" },
  ai_report: { name: "مسودات التقارير بالذكاء الاصطناعي", description: "توليد مسودة قابلة للمراجعة من موجزك" },
  collaboration: { name: "التعاون", description: "مشاركة المشاريع والعمل الجماعي" },
  team_features: { name: "ميزات الفريق", description: "إدارة ميزات ومساحة عمل الفريق" },
  multi_user_activation: { name: "تفعيل متعدد المستخدمين", description: "تفعيل الترخيص لأكثر من مستخدم" },
};

/** Keygen entitlement codes mapped to NASAQ feature gates. */
export const KEYGEN_ENTITLEMENT_FEATURES: Record<string, FeatureId[]> = {
  "nasaq.editor": ["core_editor"],
  "nasaq.templates": ["premium_templates"],
  "nasaq.projects": ["unlimited_projects"],
  "nasaq.library": ["data_import"],
  "nasaq.export": ["basic_export"],
  "nasaq.advanced-export": ["advanced_export"],
  "nasaq.brand-kit": ["brand_kit"],
  "nasaq.advanced-tools": ["unlimited_pages", "ai_report"],
  "nasaq.team": ["collaboration", "team_features", "multi_user_activation"],
  "nasaq.priority-support": [],
};

export function entitlementsFromKeygenCodes(codes: string[]): Record<FeatureId, boolean> {
  const entitlements = Object.fromEntries(
    (Object.keys(FEATURE_LABELS) as FeatureId[]).map((feature) => [feature, false]),
  ) as Record<FeatureId, boolean>;
  for (const code of codes) {
    for (const feature of KEYGEN_ENTITLEMENT_FEATURES[code] ?? []) {
      entitlements[feature] = true;
    }
  }
  return entitlements;
}

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
  isOwner?: boolean;
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
