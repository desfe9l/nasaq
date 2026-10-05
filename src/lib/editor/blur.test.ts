import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_BLUR_MM,
  blurFilterCss,
  normalizeBlurMm,
  withLayerBlur,
} from "./blur.ts";

test("normalizeBlurMm clamps to a finite, in-range millimetre radius", () => {
  assert.equal(normalizeBlurMm(undefined), 0);
  assert.equal(normalizeBlurMm(null), 0);
  assert.equal(normalizeBlurMm(""), 0);
  assert.equal(normalizeBlurMm("abc"), 0);
  assert.equal(normalizeBlurMm(-4), 0, "a negative radius is no blur, never a broken filter");
  assert.equal(normalizeBlurMm(0), 0);
  assert.equal(normalizeBlurMm(1.234), 1.23, "two decimals, like every other mm control");
  assert.equal(normalizeBlurMm("2.5"), 2.5);
  assert.equal(normalizeBlurMm(999), MAX_BLUR_MM);
  assert.equal(normalizeBlurMm(Infinity), 0);
});

test("blurFilterCss paints one filter — and nothing at all when there is no blur", () => {
  assert.equal(blurFilterCss(0), undefined);
  assert.equal(blurFilterCss(undefined), undefined);
  assert.equal(blurFilterCss(3), "blur(3mm)");
  // A document authored before blur existed stores nothing, so its DOM is
  // byte-identical: no filter layer appears.
  assert.equal(blurFilterCss(NaN), undefined);
});

test("withLayerBlur composes after an element's own paint filters", () => {
  assert.equal(withLayerBlur(undefined, 2), "blur(2mm)");
  assert.equal(withLayerBlur("brightness(1.2)", 0), "brightness(1.2)");
  assert.equal(withLayerBlur("brightness(1.2)", 2), "brightness(1.2) blur(2mm)");
  assert.equal(withLayerBlur(undefined, 0), undefined);
});
