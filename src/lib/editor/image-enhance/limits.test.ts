import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_MAX_EDGE,
  DENOISE_MAX_EDGE,
  checkEnhanceInput,
  isEnhanceMime,
  outputMimeFor,
} from "./limits.ts";

test("valid inputs pass every op's limits", () => {
  for (const op of ["background", "denoise"] as const) {
    assert.equal(checkEnhanceInput(op, 800, 600), null, op);
  }
});

test("background removal rejects oversized edges", () => {
  const err = checkEnhanceInput("background", BACKGROUND_MAX_EDGE + 1, 100);
  assert.ok(err);
  assert.equal(err.code, "too_large");
});

test("background removal rejects oversized pixel counts", () => {
  // 4096 x 4096 = 16.7MP > 16MP cap even though the edge fits.
  const err = checkEnhanceInput("background", BACKGROUND_MAX_EDGE, BACKGROUND_MAX_EDGE);
  assert.ok(err);
  assert.equal(err.code, "too_large");
});

test("denoise rejects oversized images", () => {
  const err = checkEnhanceInput("denoise", DENOISE_MAX_EDGE + 1, 100);
  assert.ok(err);
  assert.equal(err.code, "too_large");
});

test("denoise accepts large-but-within-budget photos", () => {
  assert.equal(checkEnhanceInput("denoise", 5000, 3000), null);
});

test("background removal always outputs PNG for real transparency", () => {
  assert.equal(outputMimeFor("background", "image/jpeg"), "image/png");
  assert.equal(outputMimeFor("background", "image/webp"), "image/png");
});

test("denoise keeps the source format", () => {
  assert.equal(outputMimeFor("denoise", "image/jpeg"), "image/jpeg");
  assert.equal(outputMimeFor("denoise", "image/webp"), "image/webp");
});

test("mime guard only admits the supported raster formats", () => {
  assert.ok(isEnhanceMime("image/png"));
  assert.ok(isEnhanceMime("image/jpeg"));
  assert.ok(isEnhanceMime("image/webp"));
  assert.ok(!isEnhanceMime("image/gif"));
  assert.ok(!isEnhanceMime("image/svg+xml"));
});
