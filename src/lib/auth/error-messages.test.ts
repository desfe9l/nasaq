import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GENERIC_AUTH_ERROR,
  authConfigurationDetail,
  authConfigurationNotice,
  authErrorMessage,
} from "./error-messages.ts";

describe("authErrorMessage", () => {
  it("explains wrong credentials without saying which half was wrong", () => {
    const message = authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, "sign-in");
    assert.match(message, /غير صحيحة/);
    assert.doesNotMatch(message, /غير موجود|not found/i);
  });

  it("tells an existing account to sign in instead", () => {
    assert.match(
      authErrorMessage({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }, "sign-up"),
      / مسجّل|مسجّل بالفعل/,
    );
  });

  it("names the password length rule on sign-up", () => {
    assert.match(authErrorMessage({ code: "PASSWORD_TOO_SHORT" }, "sign-up"), /8/);
  });

  it("explains a rejected origin as a security decision with a next step", () => {
    assert.match(authErrorMessage({ code: "INVALID_ORIGIN" }), /أمنية/);
  });

  it("explains an expired session", () => {
    assert.match(authErrorMessage({ code: "SESSION_EXPIRED" }), /انتهت الجلسة/);
  });

  it("explains a disabled provider", () => {
    assert.match(
      authErrorMessage({ code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" }, "sign-up"),
      /غير مفعّل/,
    );
  });

  it("maps server failures without exposing internals", () => {
    const message = authErrorMessage({ code: "FAILED_TO_CREATE_SESSION" });
    assert.doesNotMatch(message, /FAILED_TO_CREATE_SESSION|stack|at Object/i);
    assert.match(message, /الخادم/);
  });

  it("falls back to existing responses that carry no code", () => {
    assert.match(
      authErrorMessage({ message: "Invalid email or password" }, "sign-in"),
      /غير صحيحة/,
    );
    assert.match(authErrorMessage({ message: "User already exists." }), /مسجّل/);
  });

  it("never echoes an unknown provider message", () => {
    const message = authErrorMessage({
      message: "ECONNREFUSED 10.0.0.5:5432 at Socket.<anonymous>",
    });
    assert.equal(message, GENERIC_AUTH_ERROR);
    assert.doesNotMatch(message, /ECONNREFUSED|5432/);
  });

  it("turns a 5xx status into a retry message", () => {
    assert.match(authErrorMessage({ status: 500 }), /الخادم/);
  });

  it("explains Neon database quota and connection limit errors clearly", () => {
    assert.match(
      authErrorMessage({ code: "DATABASE_QUOTA_EXCEEDED" }),
      /الحصة|Neon Quota/,
    );
    assert.match(
      authErrorMessage({ message: "error: 53000: project has exceeded the quota" }),
      /الحصة|Neon Quota/,
    );
    assert.match(
      authErrorMessage({ code: "DATABASE_TOO_MANY_CONNECTIONS" }),
      /اتصالات|ضغط/,
    );
    assert.match(
      authErrorMessage({ message: "FATAL: remaining connection slots are reserved" }),
      /اتصالات|ضغط/,
    );
  });

  it("always produces a non-empty sentence", () => {
    for (const input of [null, undefined, {}, { code: "SOMETHING_NEW" }]) {
      assert.ok(authErrorMessage(input).length > 0);
    }
  });
});

describe("configuration notices", () => {
  it("says nothing when the environment is complete", () => {
    assert.equal(
      authConfigurationNotice({ ok: true, errors: [], providers: { google: true, emailPassword: true } }),
      null,
    );
  });

  it("states plainly when there is no provider at all", () => {
    const notice = authConfigurationNotice({
      ok: false,
      errors: ["No sign-in provider is configured"],
      providers: { google: false, emailPassword: false },
    });
    assert.match(notice ?? "", /لا توجد طريقة دخول/);
  });

  it("warns about an incomplete configuration without leaking details", () => {
    const notice = authConfigurationNotice({
      ok: false,
      errors: ["BETTER_AUTH_SECRET is not set on this deployment."],
      providers: { google: false, emailPassword: true },
    });
    assert.match(notice ?? "", /ناقصة/);
  });

  it("hands the operator the variable names, never a value", () => {
    const detail = authConfigurationDetail({
      errors: ["BETTER_AUTH_SECRET is not set on this deployment.\nSet it and redeploy."],
    });
    assert.equal(detail.length, 1);
    assert.match(detail[0], /BETTER_AUTH_SECRET/);
    assert.doesNotMatch(detail[0], /\n/);
  });
});
