import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SHADOW, buildShadow, parseShadow } from "./shadow.ts";

/**
 * The custom drop-shadow codec. `style.shadow` is ONE box-shadow string that
 * the canvas renders and html2canvas rasterises on export; the properties
 * panel edits it through numeric controls. These tests pin the round trip and
 * the clamps so a hand-typed or legacy value can never produce a broken CSS
 * declaration.
 */

test("shadow: the default parts serialise to a valid box-shadow string", () => {
  assert.equal(buildShadow(DEFAULT_SHADOW), "0mm 2mm 5mm rgba(15,23,42,0.16)");
});

test("shadow: build → parse is lossless for in-range values", () => {
  const parts = { x: 1.5, y: -2, blur: 3.25, color: "#aabbcc", alpha: 0.4 };
  const css = buildShadow(parts);
  assert.equal(css, "1.5mm -2mm 3.3mm rgba(170,187,204,0.4)");
  const back = parseShadow(css);
  assert.deepEqual(back, { x: 1.5, y: -2, blur: 3.3, color: "#aabbcc", alpha: 0.4 });
});

test("shadow: offsets and blur are clamped to the panel's range", () => {
  const css = buildShadow({ x: 999, y: -999, blur: -5, color: "#000000", alpha: 1 });
  assert.equal(css, "50mm -50mm 0mm rgba(0,0,0,1)");
});

test("shadow: zero opacity means no shadow at all", () => {
  assert.equal(buildShadow({ ...DEFAULT_SHADOW, alpha: 0 }), "");
  assert.equal(buildShadow({ ...DEFAULT_SHADOW, alpha: -1 }), "");
  // An empty stored value reads back as the defaults so the controls are usable.
  assert.deepEqual(parseShadow(""), DEFAULT_SHADOW);
  assert.deepEqual(parseShadow(undefined), DEFAULT_SHADOW);
});

test("shadow: non-finite numbers and malformed colours fall back safely", () => {
  const css = buildShadow({
    x: Number.NaN,
    y: Number.POSITIVE_INFINITY,
    blur: 2,
    color: "not-a-colour",
    alpha: 0.5,
  });
  // Any non-finite number → 0 (never "Infinitymm"), bad colour → the ink
  // fallback (#0f172a).
  assert.equal(css, "0mm 0mm 2mm rgba(15,23,42,0.5)");
});

test("shadow: legacy preset strings parse (unitless, rgb(), no alpha)", () => {
  assert.deepEqual(parseShadow("0 1mm 3mm rgba(15,23,42,.10)"), {
    x: 0,
    y: 1,
    blur: 3,
    color: "#0f172a",
    alpha: 0.1,
  });
  assert.deepEqual(parseShadow("2 2 4 rgb(255, 0, 0)"), {
    x: 2,
    y: 2,
    blur: 4,
    color: "#ff0000",
    alpha: 1,
  });
});

test("shadow: unknown syntax (hex colour, multiple shadows, keywords) reads as defaults", () => {
  for (const raw of [
    "0 2mm 5mm #000",
    "0 2mm 5mm rgba(0,0,0,.2), 0 0 1mm red",
    "inset 0 2mm 5mm rgba(0,0,0,.2)",
    "none",
  ]) {
    assert.deepEqual(parseShadow(raw), DEFAULT_SHADOW, raw);
    // …and never the same object, so a panel edit cannot mutate the defaults.
    assert.notEqual(parseShadow(raw), DEFAULT_SHADOW);
  }
});

test("shadow: alpha is rounded to two decimals and parsed alpha is clamped", () => {
  assert.equal(buildShadow({ ...DEFAULT_SHADOW, alpha: 0.12345 }), "0mm 2mm 5mm rgba(15,23,42,0.12)");
  assert.equal(parseShadow("0 0 0 rgba(0,0,0,7)").alpha, 1);
});
