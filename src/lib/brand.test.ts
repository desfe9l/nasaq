import assert from "node:assert/strict";
import test from "node:test";
import { BRAND } from "./brand.ts";

test("public attribution preserves the requested NASAQ creator identity", () => {
  assert.equal(BRAND.developer, "المصمم والمطور فيصل المضياني");
  assert.equal(BRAND.developerEn, "Developed by فيصل المضياني");
});
