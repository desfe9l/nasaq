import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GENERIC_ERROR,
  AI_NOT_PERMITTED,
  AI_SIGN_IN_REQUIRED,
  aiCallErrorMessage,
} from "./client-errors.ts";

/**
 * The panels used to collapse every failure into "تعذر الاتصال بخدمة الذكاء
 * الاصطناعي", which told a signed-out author that the AI provider was down —
 * the wrong problem, and unfixable from where they were standing. These cases
 * pin the distinction: a missing session is named as a missing session.
 */
test("an unauthenticated call is reported as a sign-in problem", () => {
  const error = Object.assign(new Error("Unauthorized"), { name: "UnauthorizedError" });
  assert.equal(aiCallErrorMessage(error), AI_SIGN_IN_REQUIRED);
  // TanStack may serialize the status into the message instead.
  assert.equal(aiCallErrorMessage(new Error("Request failed with status 401")), AI_SIGN_IN_REQUIRED);
});

test("a forbidden or cross-site call is reported as a permission problem", () => {
  assert.equal(aiCallErrorMessage(new Error("Forbidden")), AI_NOT_PERMITTED);
  assert.equal(aiCallErrorMessage(new Error("Forbidden: cross-site request blocked")), AI_NOT_PERMITTED);
  assert.equal(aiCallErrorMessage(new Error("Request failed with status 403")), AI_NOT_PERMITTED);
});

test("network, timeout and rate-limit failures keep their own message", () => {
  assert.match(aiCallErrorMessage(new Error("Failed to fetch")), /الخادم/);
  assert.match(aiCallErrorMessage(new Error("The operation was aborted")), /مهلة/);
  assert.match(aiCallErrorMessage(new Error("rate limit exceeded")), /محاولات كثيرة/);
});

test("an unknown failure keeps the caller's Arabic fallback, never the raw text", () => {
  const fallback = "تعذّر توليد المسودة. لم يتغير المستند.";
  const message = aiCallErrorMessage(new Error("TypeError: x is not a function"), fallback);
  assert.equal(message, fallback);
  assert.ok(!message.includes("TypeError"));
  assert.equal(aiCallErrorMessage(undefined), AI_GENERIC_ERROR);
  assert.equal(aiCallErrorMessage(""), AI_GENERIC_ERROR);
});
