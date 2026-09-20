export type ProductEdition = "demo" | "commercial" | "enterprise";
export type LicenseStatus = "DEMO" | "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED";
export type LicenseScope = "individual" | "team" | "organization" | "enterprise";
export type MemberRole = "owner" | "administrator" | "designer" | "editor" | "reviewer" | "viewer";
export type LicenseSource = "manual" | "lemonsqueezy" | "demo-local" | "server";
export type CommercialPlan = "individual-monthly" | "individual-quarterly" | "team-monthly" | "team-quarterly";

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
  source: LicenseSource;
  plan?: CommercialPlan;
  variantId?: string;
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

export function canUseDemoExport(format: string): boolean {
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
