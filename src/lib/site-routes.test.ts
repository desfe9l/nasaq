import assert from "node:assert/strict";
import { test } from "node:test";
import { TEMPLATES_ROUTE } from "./site-routes.ts";

test("homepage Templates actions target the existing Templates route", () => {
  assert.equal(TEMPLATES_ROUTE, "/templates/");
});
