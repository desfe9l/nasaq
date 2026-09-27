import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ELEMENT_SECTION_IDS,
  moveSection,
  normalizeSectionOrder,
} from "./section-order.ts";

test("section preferences recover from absent, malformed and obsolete storage", () => {
  for (const value of [null, false, {}, "icons", 42])
    assert.deepEqual(normalizeSectionOrder(value), [...ELEMENT_SECTION_IDS]);
  assert.deepEqual(
    normalizeSectionOrder(["templates", "icons", "templates", "gone", null]),
    ["templates", "icons", "shapes", "dividers", "indicators", "tables"],
  );
});
test("move works in both directions and at boundaries without losing content", () => {
  const original = [...ELEMENT_SECTION_IDS];
  const last = moveSection(original, "shapes", 5);
  assert.equal(last[5], "shapes");
  assert.deepEqual(moveSection(last, "shapes", 0), original);
  assert.equal(moveSection(original, "templates", -100)[0], "templates");
  assert.equal(moveSection(original, "shapes", 100).at(-1), "shapes");
  assert.deepEqual(moveSection(original, "missing", 1), original);
  assert.deepEqual(moveSection(original, "icons", NaN), original);
  assert.deepEqual(original, [...ELEMENT_SECTION_IDS]);
});
test("a serialized reorder is restored exactly on reload", () => {
  const next = moveSection(ELEMENT_SECTION_IDS, "tables", 1);
  assert.deepEqual(
    normalizeSectionOrder(JSON.parse(JSON.stringify(next))),
    next,
  );
});
