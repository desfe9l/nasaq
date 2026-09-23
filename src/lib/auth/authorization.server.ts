import { findLicensesByUserId } from "@/lib/license/server";
import {
  entitlementsForPlan,
  LICENSE_ENTITLEMENTS,
  type FeatureId,
  type License,
} from "@/lib/license/types";
import { isOwnerIdentity, type OwnerIdentity } from "./owner.server";

export type AuthorizationContext = OwnerIdentity & {
  isOwner: boolean;
  license: License | null;
  entitlements: Record<FeatureId, boolean>;
};

export class ForbiddenError extends Error {
  readonly status = 403;

  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export function isActiveLicense(license: License): boolean {
  return Boolean(
    license.status === "ACTIVE" &&
      (!license.expiresAt || new Date(license.expiresAt).getTime() > Date.now()),
  );
}

export async function getAuthorizationContext(
  identity: OwnerIdentity,
): Promise<AuthorizationContext> {
  if (isOwnerIdentity(identity)) {
    return {
      ...identity,
      isOwner: true,
      license: null,
      entitlements: { ...LICENSE_ENTITLEMENTS.LIFETIME },
    };
  }

  const license = (await findLicensesByUserId(identity.id)).find(isActiveLicense) ?? null;
  return {
    ...identity,
    isOwner: false,
    license,
    entitlements: license
      ? entitlementsForPlan(
          license.metadata?.plan as import("@/lib/license/types").LicensePlan | undefined,
          license.type,
        )
      : { ...LICENSE_ENTITLEMENTS.FREE },
  };
}

export function requireFeature(
  context: AuthorizationContext,
  feature: FeatureId,
): void {
  if (context.isOwner || context.entitlements[feature]) return;
  throw new ForbiddenError();
}

export { isOwnerIdentity } from "./owner.server";
