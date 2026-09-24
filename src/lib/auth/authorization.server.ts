import { getSql } from "@/lib/db";
import { findLicensesByUserId } from "@/lib/license/server";
import {
  entitlementsForPlan,
  entitlementsFromKeygenCodes,
  LICENSE_ENTITLEMENTS,
  type FeatureId,
  type License,
} from "@/lib/license/types";
import {
  isAdminIdentity,
  isConfiguredAdminIdentity,
  readAdminIdentityConfig,
} from "./admin-identity.server";
import { isOwnerIdentity, type OwnerIdentity } from "./owner.server";

export type AuthorizationContext = OwnerIdentity & {
  isOwner: boolean;
  isAdmin: boolean;
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
  const config = readAdminIdentityConfig();
  const isOwner = isOwnerIdentity(identity);
  if (isConfiguredAdminIdentity(identity, config)) {
    return {
      ...identity,
      isOwner,
      isAdmin: true,
      license: null,
      entitlements: { ...LICENSE_ENTITLEMENTS.LIFETIME },
    };
  }

  const sql = await getSql();
  if (await isAdminIdentity(sql, identity, config)) {
    return {
      ...identity,
      // `isOwner` is carried through here, not reset to false. An owner known
      // only by an `admin_users` row (no `NASAQ_OWNER_*` env pair) used to land
      // in this branch and lose the flag — and with it every owner-only
      // surface, licences included.
      isOwner,
      isAdmin: true,
      license: null,
      entitlements: { ...LICENSE_ENTITLEMENTS.LIFETIME },
    };
  }

  const license = (await findLicensesByUserId(identity.id)).find(isActiveLicense) ?? null;
  return {
    ...identity,
    isOwner: false,
    isAdmin: false,
    license,
    entitlements: license
      ? license.metadata?.source === "keygen"
        ? entitlementsFromKeygenCodes((license.metadata.entitlements || "").split(",").filter(Boolean))
        : entitlementsForPlan(
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
  if (context.isOwner || context.isAdmin || context.entitlements[feature]) return;
  throw new ForbiddenError();
}

export { isOwnerIdentity } from "./owner.server";
