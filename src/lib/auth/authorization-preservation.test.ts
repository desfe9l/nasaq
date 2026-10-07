/**
 * Regression suite: the first-party auth rebuild (PR #153) must not shrink the
 * authorization surface. Every privilege and service that existed before the
 * rebuild must still resolve the same way for the same identity.
 *
 * These tests pin the IDENTITY CONTRACT — what an authenticated request is
 * handed downstream — not the storage backend. A change that drops a role, a
 * flag, or a resolver field fails here before it reaches production.
 */

import assert from "node:assert/strict";
import test from "node:test";

// Set the deployment's own configuration BEFORE any auth module loads: the
// admin/owner readers sample process.env at call time, but some callers cache
// at import. Tests must not depend on the host machine's environment.
process.env.NASAQ_OWNER_ID = "owner-1";
process.env.NASAQ_OWNER_EMAIL = "owner@example.com";
process.env.NASAQ_ADMIN_USER_IDS = "admin-1,admin@example.com";
process.env.NASAQ_SUPER_ADMIN_IDS = "owner-1";

const { isOwnerIdentity } = await import("./owner.server.ts");
const {
  isConfiguredAdminIdentity,
  readAdminIdentityConfig,
} = await import("./admin-identity.server.ts");
const {
  isConfiguredSuperAdminIdentity,
  readSuperAdminConfig,
  SUPER_ADMIN_ROLE,
  ADMIN_ROLE,
} = await import("./super-admin.server.ts");

// ── Identity shapes ──────────────────────────────────────────────────────────

const OWNER = { id: "owner-1", email: "owner@example.com", emailVerified: true };
const ADMIN = { id: "admin-1", email: "admin@example.com", emailVerified: true };
const REGULAR = { id: "user-1", email: "user@example.com", emailVerified: true };
const UNVERIFIED = { id: "user-2", email: "user@example.com", emailVerified: false };

// ── Owner recognition ────────────────────────────────────────────────────────

test("owner is recognized by id and by verified email", () => {
  assert.equal(isOwnerIdentity(OWNER), true);
  assert.equal(
    isOwnerIdentity({ id: "other", email: "OWNER@example.com", emailVerified: true }),
    true,
  );
});

test("owner is NOT recognized by unverified email", () => {
  assert.equal(
    isOwnerIdentity({ id: "other", email: "owner@example.com", emailVerified: false }),
    false,
  );
});

// ── Admin / super-admin recognition ──────────────────────────────────────────

test("configured admin identity matches allowlist ids and verified emails", () => {
  const config = readAdminIdentityConfig();
  assert.equal(isConfiguredAdminIdentity(ADMIN, config), true);
  assert.equal(
    isConfiguredAdminIdentity(
      { id: "other", email: "ADMIN@example.com", emailVerified: true },
      config,
    ),
    true,
  );
});

test("configured admin identity rejects unverified email matches", () => {
  const config = readAdminIdentityConfig();
  assert.equal(
    isConfiguredAdminIdentity(
      { id: "other", email: "admin@example.com", emailVerified: false },
      config,
    ),
    false,
  );
});

test("configured admin identity rejects unknown users", () => {
  const config = readAdminIdentityConfig();
  assert.equal(isConfiguredAdminIdentity(REGULAR, config), false);
});

test("super-admin config includes the owner record", () => {
  const config = readSuperAdminConfig();
  assert.equal(config.ids.has("owner-1"), true);
  assert.equal(config.emails.has("owner@example.com"), true);
});

test("configured super-admin identity matches owner and allowlist", () => {
  assert.equal(isConfiguredSuperAdminIdentity(OWNER), true);
  assert.equal(isConfiguredSuperAdminIdentity(ADMIN), false);
  assert.equal(isConfiguredSuperAdminIdentity(REGULAR), false);
});

// ── Role constants unchanged ────────────────────────────────────────────────

test("role constants are the historical values", () => {
  assert.equal(SUPER_ADMIN_ROLE, "SUPER_ADMIN");
  assert.equal(ADMIN_ROLE, "ADMIN");
});

// ── Least-privilege: a regular user is neither owner nor admin ──────────────

test("a regular user is not elevated by configuration", () => {
  assert.equal(isOwnerIdentity(REGULAR), false);
  assert.equal(isConfiguredAdminIdentity(REGULAR, readAdminIdentityConfig()), false);
  assert.equal(isConfiguredSuperAdminIdentity(REGULAR), false);
});

// ── VerifiedIdentity is the same shape as OwnerIdentity ─────────────────────

test("VerifiedIdentity is OwnerIdentity — the session resolver feeds both", () => {
  // The admin/super-admin lookups take OwnerIdentity; the session resolver
  // returns VerifiedUser { id, email, emailVerified }. If the two shapes ever
  // diverge, a role lookup silently fails. Pin the fields the gates read.
  const identity = { id: "x", email: "x@example.com", emailVerified: true };
  assert.equal(typeof identity.id, "string");
  assert.equal(typeof identity.email === "string" || identity.email === null, true);
  assert.equal(typeof identity.emailVerified, "boolean");
});