/**
 * Hard limits for the enhancement pipeline.
 *
 * Pure, engine-independent guards: every op validates its input here before
 * any model loads, so an oversized image fails fast with a clear Arabic
 * message instead of exhausting worker memory mid-inference.
 */
import { EnhanceError, type EnhanceMime, type EnhanceOp } from "./types.ts";

/** Background removal: mask inference is resolution-independent, but the
 * full-resolution matte composition holds the image in RGBA memory twice. */
export const BACKGROUND_MAX_EDGE = 4096;
export const BACKGROUND_MAX_PIXELS = 16_000_000;

/** Denoise: tiled non-local-means keeps memory flat; the cap bounds runtime. */
export const DENOISE_MAX_EDGE = 6144;
export const DENOISE_MAX_PIXELS = 24_000_000;

export const SUPPORTED_ENHANCE_MIMES: readonly EnhanceMime[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export function isEnhanceMime(value: string): value is EnhanceMime {
  return (SUPPORTED_ENHANCE_MIMES as readonly string[]).includes(value);
}

function dimsOk(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 1 &&
    height >= 1 &&
    Number.isInteger(width) &&
    Number.isInteger(height)
  );
}

/**
 * Validate a decoded image for an op. Returns null when acceptable, otherwise
 * an EnhanceError carrying the user-facing reason.
 */
export function checkEnhanceInput(
  op: EnhanceOp,
  width: number,
  height: number,
): EnhanceError | null {
  if (!dimsOk(width, height)) {
    return new EnhanceError("decode_failed", "تعذر قراءة أبعاد الصورة");
  }
  const pixels = width * height;
  const edge = Math.max(width, height);
  switch (op) {
    case "background":
      if (edge > BACKGROUND_MAX_EDGE || pixels > BACKGROUND_MAX_PIXELS)
        return new EnhanceError(
          "too_large",
          `الصورة أكبر من حد إزالة الخلفية (${BACKGROUND_MAX_EDGE} بكسل للضلع الأطول)`,
        );
      return null;
    case "denoise":
      if (edge > DENOISE_MAX_EDGE || pixels > DENOISE_MAX_PIXELS)
        return new EnhanceError(
          "too_large",
          `الصورة أكبر من حد إزالة الضجيج (${DENOISE_MAX_EDGE} بكسل للضلع الأطول)`,
        );
      return null;
  }
}

/**
 * Which output format an op should emit for a given source mime.
 * Background removal always emits PNG (real transparency); the rest keep the
 * source format so JPEGs stay JPEGs and WebPs stay WebPs.
 */
export function outputMimeFor(op: EnhanceOp, source: EnhanceMime): EnhanceMime {
  if (op === "background") return "image/png";
  return source;
}

/** Quality used when re-encoding lossy formats. */
export const LOSSY_ENCODE_QUALITY = 0.92;
