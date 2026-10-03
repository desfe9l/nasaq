import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESTRICTED_NOTE,
  licenseSummary,
} from "./summary.ts";
import type { LicenseInfo } from "./types.ts";

function license(patch: Partial<LicenseInfo>): LicenseInfo {
  return {
    id: "lic-1",
    type: "PRO",
    status: "ACTIVE",
    keyPrefix: "NASAQ-1234",
    activatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

const BASE = { isLoading: false, isAdmin: false, hasLicense: false, license: null };

describe("licenseSummary", () => {
  it("names a licensed account by its plan, with the expiry when there is one", () => {
    const summary = licenseSummary({
      ...BASE,
      hasLicense: true,
      license: license({ type: "PRO", expiresAt: "2027-03-05T00:00:00.000Z" }),
    });
    assert.equal(summary.tone, "licensed");
    assert.equal(summary.label, "احترافي (PRO)");
    assert.equal(summary.detail, "صالح حتى 5 مارس 2027");
  });

  it("treats an administrator as fully licensed", () => {
    const summary = licenseSummary({ ...BASE, isAdmin: true });
    assert.equal(summary.tone, "licensed");
    assert.equal(summary.label, "ADMIN — وصول كامل");
  });

  it("keeps a suspended account named and locked", () => {
    const summary = licenseSummary({ ...BASE, isSuspended: true });
    assert.equal(summary.tone, "suspended");
    assert.equal(summary.label, "موقوف بقرار الإدارة");
  });

  it("keeps an unlicensed account free, with the restriction stated", () => {
    const summary = licenseSummary(BASE);
    assert.equal(summary.tone, "free");
    assert.equal(summary.label, "مجاني");
    assert.equal(summary.detail, RESTRICTED_NOTE);
  });

  it("still shows an expired or revoked licence without unlocking anything", () => {
    const expired = licenseSummary({
      ...BASE,
      license: license({ status: "EXPIRED", expiresAt: "2026-01-01T00:00:00.000Z" }),
    });
    assert.equal(expired.tone, "free");
    assert.equal(expired.label, "انتهى احترافي (PRO)");
    assert.equal(expired.detail, RESTRICTED_NOTE);

    const revoked = licenseSummary({ ...BASE, license: license({ status: "REVOKED" }) });
    assert.equal(revoked.tone, "suspended");
    assert.equal(revoked.label, "ترخيص ملغى");
    assert.equal(revoked.detail, RESTRICTED_NOTE);
  });

  it("names a trial account as a trial while it lasts", () => {
    const summary = licenseSummary({
      ...BASE,
      hasLicense: true,
      license: license({ type: "TRIAL", expiresAt: "2026-10-01T00:00:00.000Z" }),
    });
    assert.equal(summary.tone, "licensed");
    assert.equal(summary.label, "تجريبي (TRIAL)");
    assert.equal(summary.detail, "صالح حتى 1 أكتوبر 2026");
  });

  it("says it is still checking rather than reporting the wrong state", () => {
    const summary = licenseSummary({ ...BASE, isLoading: true });
    assert.equal(summary.tone, "loading");
    assert.equal(summary.label, "جارٍ التحقق");
  });
});
