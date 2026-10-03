import assert from "node:assert/strict";
import test from "node:test";
import { denoiseImage, estimateSigma, searchRadiusFor } from "./denoise-nlm.ts";

/** Deterministic LCG so the suite is reproducible. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Box-Muller gaussian from the LCG. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface Flat {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  clean: Uint8ClampedArray;
}

function flatNoisyImage(
  width: number,
  height: number,
  gray: number,
  sigma: number,
  seed = 7,
): Flat {
  const rng = makeRng(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  const clean = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const v = Math.min(255, Math.max(0, Math.round(gray + gaussian(rng) * sigma)));
    const p = i * 4;
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 200; // non-trivial alpha to verify passthrough
    clean[p] = gray;
    clean[p + 1] = gray;
    clean[p + 2] = gray;
    clean[p + 3] = 200;
  }
  return { data, width, height, clean };
}

function stats(img: Uint8ClampedArray): { mean: number; std: number } {
  let sum = 0;
  const n = img.length / 4;
  for (let i = 0; i < img.length; i += 4) sum += img[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < img.length; i += 4) sq += (img[i] - mean) ** 2;
  return { mean, std: Math.sqrt(sq / n) };
}

test("denoise strongly reduces noise on a flat region while keeping its level", () => {
  const { data, width, height } = flatNoisyImage(160, 120, 128, 12);
  const before = stats(data);
  const { data: out, skipped } = denoiseImage({ data, width, height });
  const after = stats(out);
  assert.equal(skipped, false);
  assert.ok(
    after.std < before.std * 0.5,
    `noise std should drop ≥50% (before=${before.std.toFixed(2)}, after=${after.std.toFixed(2)})`,
  );
  assert.ok(Math.abs(after.mean - before.mean) < 3, "mean level must be preserved");
});

test("denoise preserves a hard edge instead of blurring it", () => {
  const width = 200;
  const height = 120;
  const rng = makeRng(42);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = x < width / 2 ? 40 : 215;
      const v = Math.min(255, Math.max(0, Math.round(base + gaussian(rng) * 6)));
      const p = (y * width + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  const { data: out } = denoiseImage({ data, width, height });

  // Region means must stay near the true plateaus (no bleed across the edge).
  const mid = Math.floor(height / 2);
  let leftSum = 0;
  let rightSum = 0;
  for (let x = 10; x < 60; x += 1) leftSum += out[(mid * width + x) * 4];
  for (let x = width - 60; x < width - 10; x += 1) rightSum += out[(mid * width + x) * 4];
  const leftMean = leftSum / 50;
  const rightMean = rightSum / 50;
  assert.ok(Math.abs(leftMean - 40) < 8, `left plateau preserved (got ${leftMean})`);
  assert.ok(Math.abs(rightMean - 215) < 8, `right plateau preserved (got ${rightMean})`);

  // The transition band must stay narrow — a blur would spread it wide.
  let transition = 0;
  for (let x = 0; x < width; x += 1) {
    const v = out[(mid * width + x) * 4];
    if (v > 60 && v < 195) transition += 1;
  }
  assert.ok(transition <= 10, `edge must stay sharp (transition px=${transition})`);
});

test("noise sigma estimator recovers the injected noise level", () => {
  const width = 200;
  const height = 200;
  const rng = makeRng(99);
  const sigmaTrue = 8;
  const y = new Float32Array(width * height);
  for (let i = 0; i < y.length; i += 1) y[i] = 128 + gaussian(rng) * sigmaTrue;
  const est = estimateSigma(y, width, height);
  assert.ok(
    est > sigmaTrue * 0.6 && est < sigmaTrue * 1.5,
    `estimate ${est.toFixed(2)} should approximate true sigma ${sigmaTrue}`,
  );
});

test("already-clean images are detected and returned untouched", () => {
  const { data, width, height } = flatNoisyImage(64, 64, 100, 0);
  const { data: out, skipped } = denoiseImage({ data, width, height });
  assert.equal(skipped, true);
  assert.deepEqual(Array.from(out), Array.from(data));
});

test("alpha channel passes through byte-identical", () => {
  const { data, width, height } = flatNoisyImage(80, 60, 128, 10);
  const { data: out } = denoiseImage({ data, width, height });
  for (let i = 3; i < data.length; i += 4) {
    assert.equal(out[i], data[i], `alpha byte at ${i}`);
  }
});

test("denoise is deterministic for identical input", () => {
  const { data, width, height } = flatNoisyImage(90, 70, 150, 9);
  const a = denoiseImage({ data, width, height });
  const b = denoiseImage({ data, width, height });
  assert.deepEqual(Array.from(a.data), Array.from(b.data));
});

test("degenerate tiny images are returned without crashing", () => {
  const data = new Uint8ClampedArray(2 * 2 * 4).fill(120);
  const { data: out, skipped } = denoiseImage({ data, width: 2, height: 2 });
  assert.equal(skipped, true);
  assert.equal(out.length, data.length);
});

test("search radius shrinks for very large images to bound runtime", () => {
  assert.equal(searchRadiusFor(4_000_000), 3);
  assert.equal(searchRadiusFor(20_000_000), 2);
});

test("tile progress reports completion of every tile", () => {
  const { data, width, height } = flatNoisyImage(120, 100, 128, 10);
  let lastDone = 0;
  let total = 0;
  denoiseImage(
    { data, width, height },
    {
      onTileProgress: (done, tiles) => {
        lastDone = done;
        total = tiles;
      },
    },
  );
  assert.ok(total >= 1);
  assert.equal(lastDone, total);
});
