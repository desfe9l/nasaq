import {
  DEMO_LICENSE,
  applicationPageLimit,
  canCreateDemoProject,
  canUseDemoPack,
} from "@/lib/product/product";
import type { FeatureId } from "@/lib/license/types";

export type EditorAccessEntitlements = Pick<
  Record<FeatureId, boolean>,
  "premium_templates" | "unlimited_projects" | "unlimited_pages"
>;

/** One source of truth for the starter allowance used by every editor path. */
export const DEMO_MAX_PAGES =
  DEMO_LICENSE.entitlements.maxPagesPerProject ?? Infinity;

export function exceedsProjectPageLimit(
  pageCount: number,
  entitlements: EditorAccessEntitlements,
): boolean {
  return !entitlements.unlimited_pages && pageCount > applicationPageLimit();
}

export function exceedsSavedProjectLimit(
  projectCount: number,
  entitlements: EditorAccessEntitlements,
): boolean {
  return (
    !entitlements.unlimited_projects && !canCreateDemoProject(projectCount)
  );
}

export function requiresPremiumPack(
  pack: string | null | undefined,
  entitlements: EditorAccessEntitlements,
): boolean {
  return Boolean(
    pack && !entitlements.premium_templates && !canUseDemoPack(pack),
  );
}

/** A licensed Admin-catalog template remains gated in every derived project/file. */
export function requiresLicensedTemplate(
  templateId: string | null | undefined,
  entitlements: EditorAccessEntitlements,
): boolean {
  return Boolean(templateId && !entitlements.premium_templates);
}

export type ProjectAccessBlock = "premium-template" | "page-limit";

/** A common action-layer check for opening, editing, and exporting documents. */
export function projectAccessBlock(
  project: {
    pack?: string | null;
    licensedTemplateId?: string | null;
    pages?: readonly unknown[];
  },
  entitlements: EditorAccessEntitlements,
): ProjectAccessBlock | null {
  if (
    requiresPremiumPack(project.pack, entitlements) ||
    requiresLicensedTemplate(project.licensedTemplateId, entitlements)
  )
    return "premium-template";
  if (exceedsProjectPageLimit(project.pages?.length ?? 0, entitlements))
    return "page-limit";
  return null;
}
