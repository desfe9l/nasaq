/**
 * NASAQ — page-size unit conversion and formatting tests.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LENGTH_UNIT,
  LENGTH_UNITS,
  describeSize,
  formatLength,
  fromMm,
  isLengthUnit,
  presetOf,
  roundUnit,
  toMm,
} from "./page-units.ts";

test("every offered unit round-trips through millimetres", () => {
  for (const unit of LENGTH_UNITS) {
    const mm = toMm(fromMm(210, unit), unit);
    assert.ok(Math.abs(mm - 210) < 1e-9, unit);
  }
});

test("conversions use the print definitions", () => {
  assert.equal(toMm(1, "cm"), 10);
  assert.equal(toMm(1, "in"), 25.4);
  assert.ok(Math.abs(toMm(96, "px") - 25.4) < 1e-9);
  assert.equal(fromMm(25.4, "in"), 1);
  assert.equal(fromMm(10, "cm"), 1);
});

test("formatting is one consistent shape per unit", () => {
  // A4 portrait, in each unit, always «w × h unit».
  assert.equal(describeSize(210, 297, "mm"), "210 × 297 mm");
  assert.equal(describeSize(210, 297, "cm"), "21 × 29.7 cm");
  assert.equal(describeSize(210, 297, "in"), "8.27 × 11.69 in");
  assert.equal(describeSize(210, 297, "px"), "794 × 1123 px");
  assert.equal(formatLength(210, "mm"), "210");
  assert.equal(formatLength(215.9, "mm"), "215.9");
});

test("px has no fractional part and rounds half up", () => {
  assert.equal(roundUnit(793.5, "px"), 794);
  assert.equal(roundUnit(793.4, "px"), 793);
  assert.equal(roundUnit(8.2677, "in"), 8.27);
});

test("unit guards accept only the offered units", () => {
  assert.equal(isLengthUnit("cm"), true);
  assert.equal(isLengthUnit("meter"), false);
  assert.equal(isLengthUnit(null), false);
  assert.equal(DEFAULT_LENGTH_UNIT, "mm");
});

test("standard presets are recognised within half a millimetre", () => {
  assert.equal(presetOf(210, 297)?.id, "a4");
  assert.equal(presetOf(297, 210)?.id, "a4"); // orientation does not matter
  assert.equal(presetOf(215.9, 279.4)?.id, "letter");
  assert.equal(presetOf(215.9, 355.6)?.id, "legal");
  assert.equal(presetOf(123, 456), null);
});
