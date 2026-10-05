import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REQUEST_SETTINGS,
  normalizeRequestSettings,
  requestKindOptions,
} from "./types.ts";
import {
  digitsOf,
  isReachableContact,
  normalizeResponseNote,
  validateClientRequest,
  REQUEST_LIMITS,
} from "./validation.ts";

test("a complete request is accepted and normalized", () => {
  const result = validateClientRequest({
    kind: "template",
    name: "  سارة العتيبي  ",
    contact: "966 55 201 7111",
    email: "SARA@Example.sa",
    organization: "وزارة — إدارة التقارير",
    details: "أحتاج قالبًا سنويًا بست صفحات مع جداول مؤشرات وألوان الجهة.",
    source: "template",
    templateId: "builtin_pack_annual",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "سارة العتيبي");
  assert.equal(result.value.contact, "966 55 201 7111");
  assert.equal(result.value.kind, "template");
  assert.equal(result.value.templateId, "builtin_pack_annual");
});

test("the required fields are actually required", () => {
  const missing = validateClientRequest({ name: "ن", contact: "", details: "قصير" });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.errors.length, 3, missing.errors.join(" · "));
});

test("an unreachable contact is refused, in every shape the platform accepts", () => {
  assert.equal(isReachableContact(""), false);
  assert.equal(isReachableContact("12345"), false);
  assert.equal(isReachableContact("اتصل بي"), false);
  assert.equal(isReachableContact("not-an-email@"), false);
  // The shapes a real Saudi customer types.
  assert.equal(isReachableContact("0552017111"), true);
  assert.equal(isReachableContact("+966 55 201 7111"), true);
  assert.equal(isReachableContact("055-201-7111"), true);
  assert.equal(isReachableContact("person@entity.sa"), true);
});

test("an unknown kind or source falls back instead of reaching the database", () => {
  const result = validateClientRequest({
    kind: "'; drop table client_requests; --",
    source: "elsewhere",
    name: "محمد",
    contact: "0552017111",
    details: "أرغب بالاستفسار عن ترخيص الفريق لمدة ثلاثة أشهر.",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kind, "design");
  assert.equal(result.value.source, "site");
});

test("oversized text is bounded, never stored whole", () => {
  const result = validateClientRequest({
    name: "ا".repeat(500),
    contact: "0552017111",
    details: "ب".repeat(REQUEST_LIMITS.details.max + 2000),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name.length, REQUEST_LIMITS.name.max);
  assert.equal(result.value.details.length, REQUEST_LIMITS.details.max);
});

test("settings merge over the defaults field by field", () => {
  const merged = normalizeRequestSettings({
    contactNumbers: ["  +966 11 000 0000  ", ""],
    responseWindow: "  خلال ٣ أيام عمل  ",
  });
  assert.deepEqual(merged.contactNumbers, ["+966 11 000 0000"]);
  assert.equal(merged.responseWindow, "خلال ٣ أيام عمل");
  // Untouched fields keep the shipped defaults.
  assert.equal(merged.services.length, DEFAULT_REQUEST_SETTINGS.services.length);
  assert.equal(merged.fields.deadline, DEFAULT_REQUEST_SETTINGS.fields.deadline);
});

test("an empty or hostile settings document still produces a working form", () => {
  const merged = normalizeRequestSettings({ services: [], contactNumbers: [] });
  assert.ok(merged.services.length > 0);
  assert.ok(merged.contactNumbers.length > 0);
  assert.equal(normalizeRequestSettings(null).confirmationNote, DEFAULT_REQUEST_SETTINGS.confirmationNote);
});

test("disabled services leave the kind filter with real options", () => {
  const options = requestKindOptions({
    ...DEFAULT_REQUEST_SETTINGS,
    services: DEFAULT_REQUEST_SETTINGS.services.map((service) => ({
      ...service,
      enabled: service.id === "license",
    })),
  });
  assert.deepEqual(
    options.map((option) => option.id),
    ["license"],
  );
  const none = requestKindOptions({
    ...DEFAULT_REQUEST_SETTINGS,
    services: [],
  });
  assert.equal(none.length, 4, "an empty list must not empty the filter");
});

test("a written answer is trimmed and keeps its paragraph breaks", () => {
  assert.equal(normalizeResponseNote("  تم   الرد  "), "تم   الرد");
  assert.equal(normalizeResponseNote("سطر\n\n\n\nسطر"), "سطر\n\nسطر");
  assert.equal(normalizeResponseNote(undefined), "");
});

test("phone digits are extracted for tel: and wa.me links", () => {
  assert.equal(digitsOf("+966 55 201 7111"), "966552017111");
  assert.equal(digitsOf("0552017111"), "0552017111");
});
