import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKGROUND_MAX_EDGE,
  DENOISE_MAX_EDGE,
  UPSCALE_FACTOR,
  UPSCALE_MAX_INPUT_EDGE,
  checkEnhanceInput,
  isEnhanceMime,
  outputMimeFor,
  planUpscale,
} from "./limits.ts";

test("valid inputs pass every op's limits", () => {
  for (const op of ["background", "denoise", "upscale"] as const) {
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

test("upscale accepts inputs whose 4x output fits", () => {
  assert.equal(checkEnhanceInput("upscale", 1600, 1200), null);
});

test("upscale rejects inputs whose 4x output would exceed the edge cap", () => {
  const err = checkEnhanceInput("upscale", UPSCALE_MAX_INPUT_EDGE + 1, 512);
  assert.ok(err);
  assert.equal(err.code, "too_large");
});

test("upscale rejects inputs that would exceed the output pixel cap", () => {
  // 2048 x 2048 -> 8192 x 8192 = 67MP > 40MP cap.
  const err = checkEnhanceInput("upscale", 2048, 2048);
  assert.ok(err);
  assert.equal(err.code, "too_large");
});

test("planUpscale multiplies by the upscale factor", () => {
  const plan = planUpscale(512, 384);
  assert.ok(plan);
  assert.equal(plan.width, 512 * UPSCALE_FACTOR);
  assert.equal(plan.height, 384 * UPSCALE_FACTOR);
});

test("planUpscale returns null when caps are breached", () => {
  assert.equal(planUpscale(4000, 4000), null);
});

test("planUpscale rejects non-finite dimensions", () => {
  assert.equal(planUpscale(Number.NaN, 100), null);
  assert.equal(planUpscale(0, 100), null);
});

test("background removal always outputs PNG for real transparency", () => {
  assert.equal(outputMimeFor("background", "image/jpeg"), "image/png");
  assert.equal(outputMimeFor("background", "image/webp"), "image/png");
});

test("denoise and upscale keep the source format", () => {
  assert.equal(outputMimeFor("denoise", "image/jpeg"), "image/jpeg");
  assert.equal(outputMimeFor("upscale", "image/webp"), "image/webp");
});

test("mime guard only admits the supported raster formats", () => {
  assert.ok(isEnhanceMime("image/png"));
  assert.ok(isEnhanceMime("image/jpeg"));
  assert.ok(isEnhanceMime("image/webp"));
  assert.ok(!isEnhanceMime("image/gif"));
  assert.ok(!isEnhanceMime("image/svg+xml"));
});
