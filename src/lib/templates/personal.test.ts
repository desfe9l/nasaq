import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canUsePersonalTemplates,
  personalShareAbsoluteUrl,
  personalSharePath,
  personalTemplateIsPublic,
} from "./personal.ts";

test("personal templates stay private until sharing is explicit", () => {
  assert.equal(personalTemplateIsPublic(null), false);
  assert.equal(personalTemplateIsPublic({ visibility: "private", shareToken: "abcdefghijklmnop" }), false);
  assert.equal(personalTemplateIsPublic({ visibility: "shared", shareToken: null }), false);
  assert.equal(personalTemplateIsPublic({ visibility: "shared", shareToken: "short" }), false);
  const token = "abcdefghijklmnopqrstuv";
  assert.equal(personalTemplateIsPublic({ visibility: "shared", shareToken: token }), true);
  assert.equal(personalSharePath(token), `/templates/share/${token}`);
  assert.equal(
    personalShareAbsoluteUrl(token),
    `https://www.nasaq.team/templates/share/${token}`,
  );
  assert.equal(personalSharePath("../admin"), null);
});

test("قوالبي is closed to suspended and unlicensed accounts", () => {
  assert.equal(canUsePersonalTemplates({ premiumTemplates: false }), false);
  assert.equal(canUsePersonalTemplates({ isSuspended: true, premiumTemplates: true }), false);
  assert.equal(canUsePersonalTemplates({ premiumTemplates: true }), true);
  assert.equal(canUsePersonalTemplates({ isOwner: true }), true);
  assert.equal(canUsePersonalTemplates({ isAdmin: true }), true);
});
