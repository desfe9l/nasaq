import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  normalizeName,
  validateSignInInput,
  validateSignUpInput,
} from "./credentials.ts";

describe("normalizeEmail", () => {
  it("trims and lower-cases so one address is one account", () => {
    assert.equal(normalizeEmail("  Faisal@Example.COM "), "faisal@example.com");
  });

  it("handles missing values without throwing", () => {
    assert.equal(normalizeEmail(undefined), "");
    assert.equal(normalizeEmail(null), "");
  });
});

describe("normalizeName", () => {
  it("collapses whitespace and trims", () => {
    assert.equal(normalizeName("  فيصل   العنزي "), "فيصل العنزي");
  });
});

describe("email shape", () => {
  it("accepts ordinary and institutional addresses", () => {
    assert.ok(isValidEmail("user@example.com"));
    assert.ok(isValidEmail("first.last+tag@sub.example.gov.sa"));
  });

  it("rejects the obvious non-addresses", () => {
    for (const value of ["", "user", "user@", "@example.com", "user@example", "a b@example.com"]) {
      assert.equal(isValidEmail(value), false, `${value} must be rejected`);
    }
  });
});

describe("password policy", () => {
  it("matches the server's configured length window", () => {
    assert.equal(isValidPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)), false);
    assert.equal(isValidPassword("a".repeat(MIN_PASSWORD_LENGTH)), true);
    assert.equal(isValidPassword("a".repeat(MAX_PASSWORD_LENGTH)), true);
    assert.equal(isValidPassword("a".repeat(MAX_PASSWORD_LENGTH + 1)), false);
  });
});

describe("validateSignUpInput", () => {
  it("accepts a complete submission and normalizes the value it returns", () => {
    const result = validateSignUpInput({
      name: "  فيصل العنزي ",
      email: " Faisal@Example.com ",
      password: "Sup3rSecret!23",
      confirm: "Sup3rSecret!23",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      name: "فيصل العنزي",
      email: "faisal@example.com",
      password: "Sup3rSecret!23",
    });
  });

  it("reports every missing field at once", () => {
    const result = validateSignUpInput({});
    assert.equal(result.ok, false);
    assert.ok(result.errors.name);
    assert.ok(result.errors.email);
    assert.ok(result.errors.password);
  });

  it("requires the confirmation to match", () => {
    const result = validateSignUpInput({
      name: "Faisal",
      email: "f@example.com",
      password: "Sup3rSecret!23",
      confirm: "sup3rsecret!23",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.confirm);
  });

  it("states the minimum length when the password is short", () => {
    const result = validateSignUpInput({
      name: "Faisal",
      email: "f@example.com",
      password: "short",
      confirm: "short",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.password ?? "", /8/);
  });
});

describe("validateSignInInput", () => {
  it("accepts any non-empty password — the server owns the real check", () => {
    const result = validateSignInInput({ email: "f@example.com", password: "x" });
    assert.equal(result.ok, true);
  });

  it("does not leak the password policy to a probe", () => {
    const result = validateSignInInput({ email: "f@example.com", password: "" });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.errors.password ?? "", /8/);
  });

  it("requires a usable email", () => {
    assert.equal(validateSignInInput({ email: "nope", password: "x" }).ok, false);
  });
});
