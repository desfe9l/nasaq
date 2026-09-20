export type ProductEdition = "demo" | "commercial" | "enterprise";
export type LicenseStatus = "DEMO" | "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
export type LicenseScope = "individual" | "team" | "organization" | "enterprise";
export type MemberRole = "owner" | "administrator" | "designer" | "editor" | "reviewer" | "viewer";

export interface FeatureEntitlements {
  maxProjects: number | null;
  maxPagesPerProject: number | null;
  premiumTemplates: boolean;
  advancedExports: boolean;
  brandKit: boolean;
  organizationWorkspace: boolean;
  collaboration: boolean;
  dataImport: boolean;
}

export interface LicenseRecord {
  id: string;
  edition: ProductEdition;
  scope: LicenseScope;
  status: LicenseStatus;
  customerName?: string;
  organizationName?: string;
  expiresAt?: string;
  maxUsers?: number;
  entitlements: FeatureEntitlements;
  /** Server-issued records should replace this local demo record in production. */
  source: "demo-local" | "server";
}

export interface OrganizationProfile {
  id: string;
  name: string;
  roles: MemberRole[];
  createdAt: string;
}

export interface BrandKit {
  organizationName: string;
  logoSrc?: string;
  secondaryLogoSrc?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  arabicFont: string;
  englishFont: string;
  headerStyle: "minimal" | "official" | "band";
  footerStyle: "simple" | "official" | "none";
  tableStyle: "clean" | "striped" | "formal";
  chartStyle: "flat" | "accent" | "formal";
  pageSize: "a4-portrait" | "a4-landscape" | "custom";
}

export const DEMO_LICENSE: LicenseRecord = {
  id: "demo-local",
  edition: "demo",
  scope: "individual",
  status: "DEMO",
  entitlements: {
    maxProjects: 1,
    maxPagesPerProject: 3,
    premiumTemplates: false,
    advancedExports: false,
    brandKit: false,
    organizationWorkspace: false,
    collaboration: false,
    dataImport: false,
  },
  source: "demo-local",
};

/** The public experience deliberately opens only a blank, three-page sample. */
export const DEMO_ALLOWED_PACKS = ["blank"] as const;
export const DEMO_ALLOWED_EXPORTS = ["pdf", "png", "jpg"] as const;

export function canUseDemoPack(pack: string): boolean {
  return (DEMO_ALLOWED_PACKS as readonly string[]).includes(pack);
}

export function canAddDemoPage(pageCount: number): boolean {
  return pageCount < (DEMO_LICENSE.entitlements.maxPagesPerProject ?? Infinity);
}

export function canCreateDemoProject(projectCount: number): boolean {
  return projectCount < (DEMO_LICENSE.entitlements.maxProjects ?? Infinity);
}

export function canUseDemoExport(format: string, hasAdvancedExport = false): boolean {
  if (hasAdvancedExport) return true;
  return (DEMO_ALLOWED_EXPORTS as readonly string[]).includes(format);
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  organizationName: "",
  primaryColor: "#0c3d2c",
  secondaryColor: "#145c42",
  accentColor: "#c6a05a",
  arabicFont: "Tajawal",
  englishFont: "IBM Plex Sans",
  headerStyle: "official",
  footerStyle: "official",
  tableStyle: "formal",
  chartStyle: "formal",
  pageSize: "a4-portrait",
};

export function hasFeature(license: LicenseRecord, feature: keyof FeatureEntitlements): boolean {
  const value = license.entitlements[feature];
  return typeof value === "boolean" ? value : value === null || value > 0;
}

export function demoModeFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "1";
}

// ── License System Bridge ──────────────────────────────────────────────────
// Bridges the existing demo license model with the new server-validated
// license system. The new system is the source of truth; the old model
// is kept for backward compatibility.

import type { FeatureId } from "@/lib/license/types";
import { LICENSE_ENTITLEMENTS } from "@/lib/license/types";

/** Map old FeatureEntitlements keys to new FeatureId keys. */
const FEATURE_MAP: Record<string, FeatureId> = {
  premiumTemplates: "premium_templates",
  advancedExports: "advanced_export",
  brandKit: "brand_kit",
  dataImport: "data_import",
  collaboration: "collaboration",
};

/** Convert a LicenseType from the new system to the old LicenseRecord shape. */
export function licenseRecordFromEntitlements(
  type: import("@/lib/license/types").LicenseType,
  id?: string,
): LicenseRecord {
  const e = LICENSE_ENTITLEMENTS[type];
  return {
    id: id ?? `server-${type}`,
    edition: type === "FREE" ? "demo" : type === "TRIAL" ? "demo" : "commercial",
    scope: "individual",
    status: type === "FREE" ? "DEMO" : type === "TRIAL" ? "TRIAL" : "ACTIVE",
    entitlements: {
      maxProjects: e.unlimited_projects ? null : 1,
      maxPagesPerProject: e.unlimited_pages ? null : 3,
      premiumTemplates: e.premium_templates,
      advancedExports: e.advanced_export,
      brandKit: e.brand_kit,
      organizationWorkspace: e.collaboration,
      collaboration: e.collaboration,
      dataImport: e.data_import,
    },
    source: "server",
  };
}
