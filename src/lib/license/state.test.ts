/**
 * The licence state machine: one server answer, one UI state.
 *
 * The hook, the local snapshot and the editor store all format the SAME
 * `LicenseStatusResult` through these functions, so a disagreement here shows up
 * as "the workspace says licensed, the editor says free". The other decision
 * pinned below is which answers CANCEL access (and therefore end the session)
 * versus which merely lapse it (and only downgrade the features).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_ENTITLEMENTS,
  INITIAL_LICENSE_STATE,
  UNLICENSED_STATE,
  isLicensedState,
  licenseRevocationReason,
  licenseStateFromActivation,
  licenseStateFromStatus,
  sameLicenseAccess,
} from "./state.ts";
import { LICENSE_ENTITLEMENTS, type LicenseInfo, type LicenseStatusResult } from "./types.ts";

const proLicense: LicenseInfo = {
  id: "lic-1",
  type: "PRO",
  status: "ACTIVE",
  keyPrefix: "NASAQ-1",
  activatedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("licenseStateFromStatus", () => {
  it("starts loading — nothing is assumed before the server speaks", () => {
    assert.equal(INITIAL_LICENSE_STATE.isLoading, true);
    assert.equal(INITIAL_LICENSE_STATE.hasLicense, false);
    assert.equal(INITIAL_LICENSE_STATE.entitlements, LICENSE_ENTITLEMENTS.FREE);
  });

  it("maps an active licence with the server's own entitlements", () => {
    const state = licenseStateFromStatus({
      hasLicense: true,
      license: proLicense,
      entitlements: LICENSE_ENTITLEMENTS.PRO,
    });
    assert.equal(state.isLoading, false);
    assert.equal(state.hasLicense, true);
    assert.equal(state.license?.id, "lic-1");
    assert.equal(state.entitlements.advanced_export, true);
    // A live server answer is never marked as cached.
    assert.equal(state.fromCache, false);
  });

  it("marks a cached answer as such", () => {
    const state = licenseStateFromStatus({ hasLicense: true, license: proLicense, entitlements: LICENSE_ENTITLEMENTS.PRO }, { fromCache: true });
    assert.equal(state.fromCache, true);
  });

  it("gives an administrator full access without a licence record", () => {
    const state = licenseStateFromStatus({ hasLicense: true, isAdmin: true, entitlements: LICENSE_ENTITLEMENTS.PRO });
    assert.equal(state.isAdmin, true);
    assert.equal(state.license, null);
    assert.equal(state.hasLicense, true);
  });

  it("shows the trial, with the trial's entitlements", () => {
    const trial = { startedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z" };
    const state = licenseStateFromStatus({ hasLicense: true, trial, entitlements: LICENSE_ENTITLEMENTS.TRIAL });
    assert.equal(state.trial?.expiresAt, trial.expiresAt);
    assert.equal(state.entitlements.ai_report, true);
    assert.equal(state.entitlements.team_features, false);
  });

  it("keeps a lapsed licence visible without unlocking a single feature", () => {
    const state = licenseStateFromStatus({
      hasLicense: false,
      license: { ...proLicense, status: "EXPIRED" },
      entitlements: LICENSE_ENTITLEMENTS.FREE,
      message: "انتهى الترخيص.",
    });
    assert.equal(state.hasLicense, false);
    assert.equal(state.license?.status, "EXPIRED");
    assert.equal(state.entitlements, EMPTY_ENTITLEMENTS);
    assert.equal(state.error, "انتهى الترخيص.");
  });

  it("reports a suspension without granting anything", () => {
    const state = licenseStateFromStatus({ hasLicense: false, isSuspended: true, entitlements: LICENSE_ENTITLEMENTS.FREE });
    assert.equal(state.isSuspended, true);
    assert.equal(state.hasLicense, false);
  });

  it("ignores entitlements that arrive without a licence, a trial or an admin flag", () => {
    const state = licenseStateFromStatus({ hasLicense: false, entitlements: LICENSE_ENTITLEMENTS.PRO });
    assert.equal(state.entitlements, EMPTY_ENTITLEMENTS);
  });
});

describe("licenseRevocationReason", () => {
  it("ends the session for a suspension and for a revoked licence", () => {
    assert.equal(licenseRevocationReason({ hasLicense: false, isSuspended: true }), "suspended");
    assert.equal(
      licenseRevocationReason({ hasLicense: false, license: { ...proLicense, status: "REVOKED" } }),
      "revoked",
    );
  });

  it("does NOT end the session for a licence that merely lapsed", () => {
    const expired: LicenseStatusResult = {
      hasLicense: false,
      license: { ...proLicense, status: "EXPIRED" },
    };
    assert.equal(licenseRevocationReason(expired), null);
    assert.equal(licenseRevocationReason({ hasLicense: true, license: proLicense }), null);
    assert.equal(licenseRevocationReason(null), null);
    assert.equal(licenseRevocationReason(undefined), null);
  });
});

describe("licenseStateFromActivation", () => {
  it("maps a successful activation, and refuses a half-answer", () => {
    const state = licenseStateFromActivation({
      success: true,
      message: "تم التفعيل",
      license: proLicense,
      entitlements: LICENSE_ENTITLEMENTS.PRO,
    });
    assert.equal(state?.hasLicense, true);
    assert.equal(state?.fromCache, undefined);
    assert.equal(
      licenseStateFromActivation({ success: true, message: "ok" }),
      null,
    );
    assert.equal(
      licenseStateFromActivation({ success: false, message: "bad key" }),
      null,
    );
  });
});

describe("sameLicenseAccess", () => {
  const base = licenseStateFromStatus({
    hasLicense: true,
    license: proLicense,
    entitlements: LICENSE_ENTITLEMENTS.PRO,
  });

  it("is true for the same access described twice (silent revalidation)", () => {
    const again = licenseStateFromStatus({
      hasLicense: true,
      license: proLicense,
      entitlements: { ...LICENSE_ENTITLEMENTS.PRO },
    });
    assert.equal(sameLicenseAccess(base, again), true);
  });

  it("is false when a single entitlement differs", () => {
    const downgraded = licenseStateFromStatus({
      hasLicense: true,
      license: proLicense,
      entitlements: { ...LICENSE_ENTITLEMENTS.PRO, team_features: false },
    });
    assert.equal(sameLicenseAccess(base, downgraded), false);
  });

  it("is false when the licence state itself differs", () => {
    assert.equal(sameLicenseAccess(base, UNLICENSED_STATE), false);
    assert.equal(
      sameLicenseAccess(base, { ...base, license: { ...proLicense, status: "REVOKED" } }),
      false,
    );
    assert.equal(sameLicenseAccess(base, { ...base, isSuspended: true }), false);
    assert.equal(sameLicenseAccess(null, null), true);
    assert.equal(sameLicenseAccess(base, null), false);
  });
});

describe("isLicensedState", () => {
  it("counts a live licence, a trial and an administrator — never a suspension", () => {
    assert.equal(isLicensedState(licenseStateFromStatus({ hasLicense: true, license: proLicense, entitlements: LICENSE_ENTITLEMENTS.PRO })), true);
    assert.equal(isLicensedState(UNLICENSED_STATE), false);
    assert.equal(isLicensedState({ ...UNLICENSED_STATE, hasLicense: true, isSuspended: true }), false);
    assert.equal(isLicensedState(null), false);
  });
});
