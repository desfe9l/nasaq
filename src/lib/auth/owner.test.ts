import assert from "node:assert/strict";
import test from "node:test";
import {
  adminIdentityConfigPresent,
  isConfiguredAdminIdentity,
  type AdminIdentityConfig,
} from "./admin-identity.server.ts";
import { isOwnerIdentity, ownerConfigPresent } from "./owner.server.ts";

test("owner matching accepts the configured id or email", () => {
  const config = { id: "owner-123", email: "owner@example.com" };
  assert.equal(isOwnerIdentity({ id: "owner-123", email: "other@example.com" }, config), true);
  assert.equal(isOwnerIdentity({ id: "other", email: "OWNER@example.com" }, config), true);
  assert.equal(isOwnerIdentity({ id: "other", email: "other@example.com" }, config), false);
});

test("owner configuration presence never depends on exposing its values", () => {
  assert.equal(ownerConfigPresent({}), false);
  assert.equal(ownerConfigPresent({ id: "owner-123" }), true);
  assert.equal(ownerConfigPresent({ email: "owner@example.com" }), true);
});

const ADMIN_CONFIG: AdminIdentityConfig = {
  ids: new Set(["admin-id"]),
  emails: new Set(["admin@example.com"]),
};

test("administrator matching accepts only configured ids and emails", () => {
  assert.equal(
    isConfiguredAdminIdentity({ id: "admin-id", email: null }, ADMIN_CONFIG),
    true,
  );
  assert.equal(
    isConfiguredAdminIdentity(
      { id: "different-id", email: "ADMIN@example.com" },
      ADMIN_CONFIG,
    ),
    true,
  );
  assert.equal(
    isConfiguredAdminIdentity(
      { id: "customer-id", email: "customer@example.com" },
      ADMIN_CONFIG,
    ),
    false,
  );
  assert.equal(adminIdentityConfigPresent(ADMIN_CONFIG), true);
  assert.equal(adminIdentityConfigPresent({ ids: new Set(), emails: new Set() }), false);
});
