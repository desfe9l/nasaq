/**
 * Server-only license utilities for admin functions.
 * This module is only imported by server functions and contains Node.js-specific code.
 */

import { hashLicenseKey } from "./key.client";
import { validateLicense } from "./server";
import { entitlementsForPlan } from "./types";

/** Validate a license key and return entitlements if valid. */
export async function validateLicenseKey(key: string): Promise<{
  valid: boolean;
  entitlements?: Record<string, boolean>;
  license?: { type: string; metadata?: { plan?: string } | null };
}> {
  const keyHash = await hashLicenseKey(key);
  const result = await validateLicense(keyHash);
  if (result.valid && result.license) {
    const ent = entitlementsForPlan(
      result.license.metadata?.plan as import("./types").LicensePlan | undefined,
      result.license.type,
    );
    return { valid: true, entitlements: ent, license: result.license };
  }
  return { valid: false };
}