import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { renderFrame } from "./canvas-render.ts";
import { seek, type FrameOp } from "./render-frame.ts";
import { splitClusters } from "./arabic-type.ts";
import {
  arabicLaunchTemplate,
  periodOriginTemplate,
} from "./templates.ts";
import { compositionDuration } from "./types.ts";
import type { TextMeasure } from "./period-origin.ts";

/**
 * These tests rasterise real pixels with the same canvas the render script
 * uses. They are the check that the motion engine does not merely produce
 * plausible geometry — it produces an image with something in it.
 *
 * The canvas package is a devDependency, so if it is genuinely unavailable the
 * suite skips rather than reporting a false failure.
 */
type CanvasModule = {
  createCanvas: (w: number, h: number) => {
    getContext(type: "2d"): unknown;
    toBuffer(kind: string): Buffer;
  };
  GlobalFonts: { registerFromPath(path: string): unknown };
};

let canvasModule: CanvasModule | null = null;
try {
  canvasModule = (await import("@napi-rs/canvas")) as unknown as CanvasModule;
} catch {
  canvasModule = null;
}

/**
 * Repo root, resolved from this file's URL.
 *
 * `import.meta.dirname` is not dependable under Node's type-stripping for `.ts`
 * test files, so the URL form is used instead.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FONT_DIR = join(ROOT, "public", "fonts", "motion");

const loadFaces = (): number => {
  if (!canvasModule) return 0;
  const faces = [
    "Tajawal-Regular.ttf",
    "Tajawal-Bold.ttf",
    "NotoNaskhArabic-Regular.ttf",
    "NotoNaskhArabic-Bold.ttf",
  ];
  let n = 0;
  for (const face of faces) {
    const path = join(FONT_DIR, face);
    if (!existsSync(path)) continue;
    canvasModule.GlobalFonts.registerFromPath(path);
    n += 1;
  }
  return n;
};

const skip = canvasModule ? false : "canvas package unavailable";

/** Distinct colours present in a frame — a blank render has exactly one. */
const distinctColours = (data: Uint8ClampedArray): number => {
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += 4 * 37) {
    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return seen.size;
};

describe("motion/canvas-render", { skip }, () => {
  const faces = loadFaces();

  const measure: TextMeasure = (text, fontSize) => {
    const ctx = canvasModule!.createCanvas(8, 8).getContext("2d") as {
      font: string;
      measureText(t: string): { width: number };
    };
    ctx.font = `700 ${fontSize}px "Tajawal", sans-serif`;
    return ctx.measureText(text).width;
  };

  it("has the motion faces registered", () => {
    assert.ok(faces >= 4, `only ${faces} motion font faces available`);
  });

  it("paints a frame with more than the background colour", () => {
    const composition = arabicLaunchTemplate({ aspect: "square", width: 600 });
    const canvas = canvasModule!.createCanvas(600, 600);
    const ctx = canvas.getContext("2d") as never;
    // A mid-scene time where layers are fully in.
    const frame = seek(composition, 1600, { measure });
    assert.ok(frame.ops.length > 0, "expected drawable ops at this time");
    renderFrame(ctx, frame);
    const data = (ctx as unknown as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } })
      .getImageData(0, 0, 600, 600).data;
    assert.ok(
      distinctColours(data) > 3,
      "frame should contain background, type and accents",
    );
  });

  it("renders the period-origin iris as a visible disc", () => {
    const composition = periodOriginTemplate({ aspect: "square", width: 600 });
    assert.ok(composition);
    const frame = seek(composition, 2400, { measure });
    const iris = frame.ops.find((op) => op.kind === "period-origin");
    assert.ok(iris && iris.kind === "period-origin");
    assert.ok(iris.radius > 20, `iris should be open, radius was ${iris.radius}`);

    const canvas = canvasModule!.createCanvas(600, 600);
    const ctx = canvas.getContext("2d") as never;
    renderFrame(ctx, frame);

    // Sample inside the disc but clear of the wordmark glyphs.
    //
    // The period itself sits exactly at the iris centre by design — sampling
    // the precise centre returns the gold ink, which is correct and would
    // make this a test of nothing. Halfway between the centre and the disc
    // edge, above the baseline, is unambiguously inner world.
    const data = (ctx as unknown as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } })
      .getImageData(0, 0, 600, 600).data;
    const sampleX = Math.round(iris.centreX);
    const sampleY = Math.round(iris.centreY - iris.radius * 0.55);
    assert.ok(
      iris.radius * 0.55 > 4,
      "iris too small to sample away from the glyph band",
    );
    const px = sampleY * 600 + sampleX;
    const [r, g, b] = [data[px * 4], data[px * 4 + 1], data[px * 4 + 2]];
    // The inner world is NASAQ deep green (#0c3d2c) — green must dominate.
    assert.ok(
      g > r && g > b,
      `inside the iris should be the green inner world, got rgb(${r},${g},${b})`,
    );
  });

  it("keeps the period glyph itself at the iris centre", () => {
    // The inverse of the test above: the dot must land dead centre, which is
    // the whole premise of the effect.
    const composition = periodOriginTemplate({ aspect: "square", width: 600 });
    assert.ok(composition);
    const frame = seek(composition, 2400, { measure });
    const iris = frame.ops.find(
      (op): op is Extract<FrameOp, { kind: "period-origin" }> =>
        op.kind === "period-origin",
    );
    assert.ok(iris);
    const canvas = canvasModule!.createCanvas(600, 600);
    const ctx = canvas.getContext("2d") as never;
    renderFrame(ctx, frame);
    const data = (ctx as unknown as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } })
      .getImageData(0, 0, 600, 600).data;
    const px = Math.round(iris.centreY) * 600 + Math.round(iris.centreX);
    const [r, g, b] = [data[px * 4], data[px * 4 + 1], data[px * 4 + 2]];
    // Gold (#c6a05a) — the ink crossfade has reached the inner colour.
    assert.ok(r > 120 && g > 90 && b < 140, `expected gold ink at centre, got rgb(${r},${g},${b})`);
  });

  it("produces a non-trivial PNG for the whole timeline", () => {
    const composition = arabicLaunchTemplate({ aspect: "square", width: 320 });
    const duration = compositionDuration(composition);
    const sizes: number[] = [];
    for (const t of [0, duration * 0.25, duration * 0.5, duration * 0.75]) {
      const canvas = canvasModule!.createCanvas(320, 320);
      const ctx = canvas.getContext("2d") as never;
      renderFrame(ctx, seek(composition, t, { measure }));
      const png = canvas.toBuffer("image/png");
      // A solid-colour frame compresses to a tiny PNG; real content does not.
      assert.ok(png.length > 800, `frame at ${t}ms encoded to only ${png.length} bytes`);
      sizes.push(png.length);
    }
    assert.ok(
      new Set(sizes).size > 1,
      "frames across the timeline must differ from one another",
    );
  });

  it("counts Arabic clusters, not code units", () => {
    // Guards the assumption the canvas measure depends on.
    assert.equal(splitClusters("نَسَق.").length, 4);
  });

  it("keeps every op drawable without throwing", () => {
    const composition = arabicLaunchTemplate({ aspect: "portrait", width: 400 });
    const canvas = canvasModule!.createCanvas(400, 712);
    const ctx = canvas.getContext("2d") as never;
    const duration = compositionDuration(composition);
    for (let t = 0; t < duration; t += 211) {
      renderFrame(ctx, seek(composition, t, { measure }));
    }
    assert.ok(true, "completed a full sweep without a draw error");
  });
});