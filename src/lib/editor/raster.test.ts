import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brushRadiusPx,
  dabAlpha,
  stampDab,
  strokeBounds,
  strokeSpacing,
  StrokeSmoother,
  walkSegment,
  type RasterBuffer,
} from "./raster.ts";

const buffer = (width: number, height: number): RasterBuffer => ({
  data: new Uint8ClampedArray(width * height * 4),
  width,
  height,
});

const pixel = (buffer: RasterBuffer, x: number, y: number) => {
  const index = (y * buffer.width + x) * 4;
  return [...buffer.data.slice(index, index + 4)];
};

const ink = { r: 255, g: 0, b: 0 };

test("dab coverage is 1 in the core and 0 beyond the radius", () => {
  assert.equal(dabAlpha(0, 10, 0.5), 1);
  assert.equal(dabAlpha(4.9, 10, 0.5), 1);
  assert.equal(dabAlpha(10, 10, 0.5), 0);
  const edge = dabAlpha(9.99, 10, 0.5);
  assert.ok(edge > 0 && edge < 1);
});

test("a hard brush keeps a wider core than a soft one", () => {
  const hard = dabAlpha(7, 10, 0.9);
  const soft = dabAlpha(7, 10, 0.1);
  assert.ok(hard > soft);
  assert.equal(hard, 1);
});

test("stamping paints opaque pixels in the middle and reports the dirty rect", () => {
  const target = buffer(24, 24);
  const dirty = stampDab(target, {
    x: 12,
    y: 12,
    radius: 5,
    hardness: 1,
    opacity: 1,
    erase: false,
    color: ink,
  });
  assert.ok(dirty);
  assert.deepEqual(pixel(target, 12, 12), [255, 0, 0, 255]);
  // The dirty rect is tight: it never exceeds the dab's own bounding box.
  assert.ok(dirty!.x >= 7 && dirty!.x + dirty!.w <= 18);
  // Outside the radius nothing at all was written.
  assert.deepEqual(pixel(target, 0, 0), [0, 0, 0, 0]);
});

test("opacity composites instead of replacing, so overlapping dabs build up", () => {
  const target = buffer(8, 8);
  const dab = {
    x: 4,
    y: 4,
    radius: 3,
    hardness: 1,
    opacity: 0.5,
    erase: false,
    color: ink,
  };
  stampDab(target, dab);
  const once = pixel(target, 4, 4)[3]!;
  stampDab(target, dab);
  const twice = pixel(target, 4, 4)[3]!;
  assert.ok(once > 0 && once < 255);
  assert.ok(twice > once);
});

test("erasing removes alpha and keeps the source untouched elsewhere", () => {
  const target = buffer(12, 12);
  // Pre-fill with opaque blue, as a loaded PNG would be.
  for (let i = 0; i < target.data.length; i += 4) {
    target.data[i] = 0;
    target.data[i + 1] = 0;
    target.data[i + 2] = 255;
    target.data[i + 3] = 255;
  }
  stampDab(target, {
    x: 6,
    y: 6,
    radius: 4,
    hardness: 1,
    opacity: 1,
    erase: true,
    color: ink,
  });
  assert.deepEqual(pixel(target, 6, 6), [0, 0, 255, 0]);
  assert.deepEqual(pixel(target, 0, 0), [0, 0, 255, 255]);
});

test("erasing at partial opacity leaves semi-transparent pixels, not a hole", () => {
  const target = buffer(8, 8);
  for (let i = 0; i < target.data.length; i += 4) target.data[i + 3] = 255;
  stampDab(target, {
    x: 4,
    y: 4,
    radius: 3,
    hardness: 1,
    opacity: 0.5,
    erase: true,
    color: ink,
  });
  const alpha = pixel(target, 4, 4)[3]!;
  assert.ok(alpha > 0 && alpha < 255);
});

test("dabs are clipped to the given rect — the artwork's own visible window", () => {
  const target = buffer(20, 20);
  const dirty = stampDab(
    target,
    { x: 10, y: 10, radius: 8, hardness: 1, opacity: 1, erase: false, color: ink },
    { x: 6, y: 6, w: 4, h: 4 },
  );
  assert.ok(dirty);
  // The reported rect never reaches outside the clip.
  assert.ok(dirty!.x >= 6 && dirty!.y >= 6);
  assert.ok(dirty!.x + dirty!.w <= 10 && dirty!.y + dirty!.h <= 10);
  // A pixel the brush covered but the clip excludes stays untouched...
  assert.deepEqual(pixel(target, 5, 5), [0, 0, 0, 0]);
  // ...and the pixel inside both is painted.
  assert.deepEqual(pixel(target, 9, 9), [255, 0, 0, 255]);
});

test("segment spacing keeps a fast stroke continuous", () => {
  const spacing = strokeSpacing(10);
  const points = walkSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, spacing);
  assert.ok(points.length > 40);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i]!.x - points[i - 1]!.x <= spacing + 1e-9);
  }
  // A zero-length move still stamps once, so a tap paints.
  assert.equal(walkSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, spacing).length, 1);
});

test("smoothing lags the pointer and pressure ramps instead of switching", () => {
  const smooth = new StrokeSmoother(1);
  smooth.push({ x: 0, y: 0 });
  const step = smooth.push({ x: 100, y: 0 });
  assert.ok(step.to.x > 0 && step.to.x < 100);
  const raw = new StrokeSmoother(0);
  raw.push({ x: 0, y: 0 });
  assert.equal(raw.push({ x: 100, y: 0 }).to.x, 100);

  const pressure = new StrokeSmoother(0.3);
  pressure.push({ x: 0, y: 0 }, 0.1);
  const first = pressure.push({ x: 1, y: 0 }, 1).pressure;
  const second = pressure.push({ x: 2, y: 0 }, 1).pressure;
  assert.ok(first > 0.1 && first < 1);
  assert.ok(second > first && second < 1);
});

test("stroke bounds pad the path by the brush radius", () => {
  const bounds = strokeBounds(
    [
      { x: 10, y: 10 },
      { x: 30, y: 40 },
    ],
    5,
  );
  assert.deepEqual(bounds, { x: 5, y: 5, w: 30, h: 40 });
});

test("brush radius converts millimetres to source pixels", () => {
  assert.equal(brushRadiusPx(10, 10), 50);
  assert.equal(brushRadiusPx(0.5, 8), 2);
});
