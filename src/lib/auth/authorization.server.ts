import { getSql } from "@/lib/db";
import { findLicensesByUserId } from "@/lib/license/server";
import { revalidateLinkedKeygenLicense } from "@/lib/license/activation.server";
import { isKeygenConfigured } from "@/lib/license/keygen";
import { getSubscription } from "@/lib/commercial/entitlement.server";
import { getCatalogPlan } from "@/lib/commercial/catalog";
import {
  entitlementsForPlan,
  entitlementsFromKeygenCodes,
  LICENSE_ENTITLEMENTS,
  type BillingPeriod,
  type FeatureId,
  type License,
  type LicensePlan,
} from "@/lib/license/types";
import {
  isAdminIdentity,
  isConfiguredAdminIdentity,
  readAdminIdentityConfig,
} from "./admin-identity.server";
import { isOwnerIdentity, type OwnerIdentity } from "./owner.server";
import { getTrial } from "@/lib/license/trial.server";

export type AuthorizationContext = OwnerIdentity & {
  isOwner: boolean;
  isAdmin: boolean;
  /** An administrator's explicit account suspension also blocks licence gates. */
  isSuspended: boolean;
  license: License | null;
  trial: { startedAt: string; expiresAt: string } | null;
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
      (!license.expiresAt || new Date(license.expiresAt).getTime() > Date.now()) &&
      (license.metadata?.source !== "keygen" || license.metadata.userScopeVerified === license.userId),
  );
}

/** Manual approvals/admin activations are subscriptions, not Keygen keys. */
function manualSubscriptionLicense(
  subscription: NonNullable<Awaited<ReturnType<typeof getSubscription>>>,
  userId: string,
): License | null {
  if (subscription.source_transaction_id != null || subscription.status !== "ACTIVE" ||
      Date.parse(String(subscription.expires_at)) <= Date.now()) return null;
  // Historical manually approved subscriptions predate the central catalog.
  // Keep their already-recorded access/term readable without making those ids
  // purchasable or exposing them as current catalog / Keygen plans.
  const catalogPlan = getCatalogPlan(subscription.plan_id);
  const plan: LicensePlan = catalogPlan?.key ??
    (subscription.plan_id === "quarterly"
      ? "individual-quarterly"
      : subscription.plan_id === "team-annual"
        ? "team-monthly"
        : "individual-monthly");
  const billing: BillingPeriod = catalogPlan?.period ??
    (subscription.plan_id === "annual" || subscription.plan_id === "individual-annual" || subscription.plan_id === "team-annual"
      ? "annual"
      : subscription.plan_id === "quarterly"
        ? "quarterly"
        : "monthly");
  const createdAt = new Date(subscription.activated_at).toISOString();
  return {
    id: `subscription:${subscription.id}`, keyHash: "", keyPrefix: "", type: "PRO", status: "ACTIVE",
    userId, activatedAt: createdAt, expiresAt: new Date(subscription.expires_at).toISOString(),
    createdAt, updatedAt: createdAt, revokedAt: null, activationCount: 1, maxActivations: null,
    metadata: { source: "manual", plan, billing },
  };
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
      isSuspended: false,
      license: null,
      trial: null,
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
      isSuspended: false,
      license: null,
      trial: null,
      entitlements: { ...LICENSE_ENTITLEMENTS.LIFETIME },
    };
  }

  const subscription = await getSubscription(sql, identity.id);
  if (subscription?.status === "SUSPENDED") {
    // A deliberate account suspension overrides ALL activation methods,
    // including a still-active external licence. Do not delete either record.
    return { ...identity, isOwner: false, isAdmin: false, isSuspended: true,
      license: null, trial: null, entitlements: { ...LICENSE_ENTITLEMENTS.FREE } };
  }

  // An explicit manual approval/activation is authoritative for its selected
  // plan. Paid Gumroad subscriptions carry a transaction id and never fall
  // back to this path when provider verification is unavailable.
  let license: License | null = subscription ? manualSubscriptionLicense(subscription, identity.id) : null;
  const existingLicenses = await findLicensesByUserId(identity.id);
  if (!license) {
    for (const candidate of existingLicenses) {
      if (!isActiveLicense(candidate)) continue;
      if (candidate.metadata?.source !== "keygen") {
        license = candidate;
        break;
      }
      // The row is already scoped to this user. Re-check Keygen when we can.
      // A missing email or an unreachable provider must not deny a licence the
      // account already holds — that was a silent refusal inside the editor.
      if (!identity.email || !isKeygenConfigured()) {
        license = candidate;
        break;
      }
      try {
        const verified = await revalidateLinkedKeygenLicense(candidate, {
          userId: identity.id, userEmail: identity.email,
        });
        if (verified && isActiveLicense(verified)) {
          license = verified;
          break;
        }
      } catch {
        license = candidate;
        break;
      }
    }
  }
  const trial = !subscription && existingLicenses.length === 0
    ? await getTrial(sql, identity.id)
    : null;
  const activeTrial = trial && Date.parse(trial.expiresAt) > Date.now() ? trial : null;
  return {
    ...identity,
    isOwner: false,
    isAdmin: false,
    isSuspended: false,
    license,
    trial: activeTrial,
    entitlements: license
      ? license.metadata?.source === "keygen"
        ? entitlementsFromKeygenCodes((license.metadata.entitlements || "").split(",").filter(Boolean))
        : entitlementsForPlan(
            license.metadata?.plan as import("@/lib/license/types").LicensePlan | undefined,
            license.type,
          )
      : activeTrial
        ? { ...LICENSE_ENTITLEMENTS.TRIAL }
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
