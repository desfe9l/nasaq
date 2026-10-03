/**
 * `/purchase` subscription states — the page must never show a paying buyer a
 * "Free" badge, and must never invite a suspended or revoked buyer to pay.
 *
 * These tests pin the mapping for the six states the platform promises:
 * Free / Trial / Pro / Lifetime × Active / Expired / Revoked.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { purchaseStateView } from "./plan-state.ts";
import type { CustomerAccount } from "./types.ts";
import type { LicenseInfo } from "../license/types.ts";

function account(overrides: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    status: "FREE",
    planId: null,
    planName: null,
    planArabicName: null,
    activatedAt: null,
    expiresAt: null,
    daysRemaining: null,
    isAdmin: false,
    ...overrides,
  };
}

function license(overrides: Partial<LicenseInfo> = {}): LicenseInfo {
  return {
    id: "lic_1",
    type: "PRO",
    status: "ACTIVE",
    keyPrefix: "NQ-AB12",
    activatedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    source: "keygen",
    plan: "individual-monthly",
    billing: "monthly",
    ...overrides,
  };
}

const anonymous = { signedIn: false, account: null, license: null, isSuspended: false };
const signedIn = { ...anonymous, signedIn: true };

describe("purchase page — subscription state", () => {
  it("shows Free to a signed-in user with no purchase", () => {
    const view = purchaseStateView(signedIn);
    assert.equal(view.label, "Free — مجاني");
    assert.equal(view.tone, "muted");
    assert.match(view.detail, /اشترِ باقة/);
  });

  it("shows Free (without pushing a signed-out visitor to sign in twice)", () => {
    const view = purchaseStateView(anonymous);
    assert.equal(view.label, "Free — مجاني");
    assert.match(view.detail, /سجّل الدخول/);
  });

  it("shows TRIAL · Active while a trial is running", () => {
    const view = purchaseStateView({
      ...signedIn,
      license: license({ type: "TRIAL", status: "ACTIVE", expiresAt: "2026-09-30T00:00:00.000Z" }),
    });
    assert.equal(view.label, "تجريبي (TRIAL) · نشط");
    assert.equal(view.tone, "ok");
    assert.match(view.detail, /سارية حتى/);
  });

  it("shows PRO · Active with the plan and the expiry date", () => {
    const view = purchaseStateView({
      ...signedIn,
      account: account({ status: "ACTIVE", planArabicName: "نَسَق | فريق", expiresAt: "2026-12-24T00:00:00.000Z" }),
      license: license({ expiresAt: "2026-12-24T00:00:00.000Z" }),
    });
    assert.equal(view.label, "احترافي (PRO) · نشط");
    assert.equal(view.tone, "ok");
    assert.match(view.detail, /نَسَق \| فريق/);
    assert.match(view.detail, /سارية حتى/);
  });

  it("shows LIFETIME · Active with no expiry line", () => {
    const view = purchaseStateView({
      ...signedIn,
      license: license({ type: "LIFETIME", status: "ACTIVE", expiresAt: null }),
    });
    assert.equal(view.label, "مدى الحياة (LIFETIME) · نشط");
    assert.equal(view.tone, "ok");
    assert.doesNotMatch(view.detail, /سارية حتى/);
  });

  it("shows PRO · Expired as a warning, not a block", () => {
    const view = purchaseStateView({
      ...signedIn,
      license: license({ status: "EXPIRED", expiresAt: "2026-09-01T00:00:00.000Z" }),
    });
    assert.equal(view.label, "احترافي (PRO) · منتهي");
    assert.equal(view.tone, "warn");
  });

  it("shows REVOKED as a block even without a license row", () => {
    const view = purchaseStateView({
      ...signedIn,
      license: license({ status: "REVOKED" }),
    });
    assert.equal(view.label, "احترافي (PRO) · ملغى / موقوف");
    assert.equal(view.tone, "danger");
    assert.match(view.detail, /موقوف/);
  });

  it("shows a suspended account as a block", () => {
    const view = purchaseStateView({ ...signedIn, account: account({ status: "SUSPENDED" }), isSuspended: true });
    assert.equal(view.label, "موقوف");
    assert.equal(view.tone, "danger");
  });

  it("falls back to the account row while a paid license is still being issued", () => {
    const view = purchaseStateView({
      ...signedIn,
      account: account({
        status: "ACTIVE",
        planArabicName: "نَسَق | فردي",
        expiresAt: "2026-10-26T00:00:00.000Z",
        daysRemaining: 30,
      }),
    });
    assert.equal(view.label, "مُفعّل");
    assert.equal(view.tone, "ok");
    assert.match(view.detail, /المتبقي 30 يومًا/);
  });

  it("shows EXPIRED for a lapsed account without a license row", () => {
    const view = purchaseStateView({ ...signedIn, account: account({ status: "EXPIRED" }) });
    assert.equal(view.label, "منتهي");
    assert.equal(view.tone, "danger");
  });

  it("gives an administrator full access instead of a plan state", () => {
    const view = purchaseStateView({ ...signedIn, account: account({ isAdmin: true }) });
    assert.equal(view.label, "إداري — وصول كامل");
    assert.equal(view.tone, "ok");
  });
});
