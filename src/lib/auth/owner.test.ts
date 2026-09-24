import assert from "node:assert/strict";
import test from "node:test";
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
