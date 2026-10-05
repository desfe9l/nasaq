import assert from "node:assert/strict";
import test from "node:test";
import { canUseCloudStorage, shouldKeepCloudCopy } from "./cloud-policy.ts";

test("Owner/Admin always retain cloud copies and can use R2", () => {
  const owner = { isOwner: true, isAdmin: true, hasLicense: false };
  assert.equal(canUseCloudStorage(owner), true);
  assert.equal(shouldKeepCloudCopy(owner, "local"), true);
});

test("Subscriber is local-first until explicitly choosing cloud retention", () => {
  const subscriber = { isOwner: false, isAdmin: false, hasLicense: true };
  assert.equal(canUseCloudStorage(subscriber), true);
  assert.equal(shouldKeepCloudCopy(subscriber, "local"), false);
  assert.equal(shouldKeepCloudCopy(subscriber, "cloud"), true);
});

test("Free user has no R2 access or cloud copy", () => {
  const free = { isOwner: false, isAdmin: false, hasLicense: false };
  assert.equal(canUseCloudStorage(free), false);
  assert.equal(shouldKeepCloudCopy(free, "cloud"), false);
});
