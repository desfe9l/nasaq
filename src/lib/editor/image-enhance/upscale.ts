/**
 * AI super-resolution engine — real ESRGAN (RDN, DIV2K-trained) executed
 * in-browser via TensorFlow.js. No image bytes ever leave the device.
 *
 * Runs on the main thread by design: UpscalerJS' browser build decodes and
 * encodes through DOM canvas, and inference is chunked into small patches
 * (awaited between GPU dispatches), so the UI stays responsive and reports
 * real per-patch progress. Model weights are vendored into `public/models`
 * by scripts/emit-upscale-model.mjs and loaded same-origin — no runtime CDN.
 */
import { EnhanceError, type EnhanceProgressFn } from "./types.ts";
import { UPSCALE_FACTOR } from "./limits.ts";

export interface UpscaleInput {
  /** Decoded source pixels. */
  imageData: ImageData;
  /** Source bitmap used to resample alpha when the image carries any. */
  sourceBitmap: ImageBitmap;
}

export interface UpscaleResult {
  imageData: ImageData;
  scale: number;
}

interface UpscalerLike {
  ready: Promise<void>;
  upscale: (
    input: unknown,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  dispose?: () => Promise<void>;
}

interface TfLike {
  setBackend: (name: string) => Promise<boolean>;
  ready: () => Promise<boolean>;
  tensor: (values: Float32Array, shape: number[]) => TfTensor;
  backend: () => string;
}

interface TfTensor {
  shape: number[];
  data: () => Promise<Float32Array>;
  dispose: () => void;
}

interface ModelDefinition {
  scale?: number;
  path?: string;
  meta?: { outputRange?: [number, number] };
  [key: string]: unknown;
}

interface Engine {
  tf: TfLike;
  upscaler: UpscalerLike;
  definition: ModelDefinition;
}

let enginePromise: Promise<Engine> | null = null;

/** Same-origin location of the vendored ESRGAN weights. */
export function upscaleModelUrl(): string {
  const base =
    typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
  return `${base}models/esrgan-medium-x4/model.json`.replace(/\/{2,}/g, "/");
}

function createEngine(): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [upscalerMod, tfMod, modelMod] = await Promise.all([
        import("upscaler"),
        import("@tensorflow/tfjs"),
        import("@upscalerjs/esrgan-medium"),
      ]);
      const tf = tfMod as unknown as TfLike;
      // WebGL is dramatically faster; fall back to CPU where unavailable.
      try {
        if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu");
      } catch {
        await tf.setBackend("cpu");
      }
      await tf.ready();
      const definition: ModelDefinition = {
        ...(modelMod.x4 as ModelDefinition),
        // Serve the weights from our own origin (vendored at build time).
        path: upscaleModelUrl(),
      };
      const Upscaler = (upscalerMod as { default: new (opts: { model: ModelDefinition }) => UpscalerLike }).default;
      const upscaler = new Upscaler({ model: definition });
      try {
        await upscaler.ready;
      } catch (err) {
        enginePromise = null; // allow retry on transient load failure
        throw new EnhanceError(
          "provider_unavailable",
          `تعذر تحميل نموذج الترقية: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
      return { tf, upscaler, definition };
    })();
  }
  return enginePromise;
}

function hasMeaningfulAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * Upscale ×4. Returns a real ImageData at 4× dimensions; alpha (when the
 * source has any) is preserved with a high-quality resample of the source.
 */
export async function upscaleImage(
  input: UpscaleInput,
  onProgress: EnhanceProgressFn,
): Promise<UpscaleResult> {
  const { imageData, sourceBitmap } = input;
  const { width, height } = imageData;
  const engine = await createEngine();
  onProgress({ stage: "model", value: 0.06 });

  // Input tensor: RGB float32 in the model's [0,255] range.
  const src = imageData.data;
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    rgb[i] = src[p];
    rgb[i + 1] = src[p + 1];
    rgb[i + 2] = src[p + 2];
  }
  const inputTensor = engine.tf.tensor(rgb, [height, width, 3]);

  let outTensor: TfTensor;
  try {
    onProgress({ stage: "process", value: 0.08 });
    const result = await engine.upscaler.upscale(inputTensor, {
      output: "tensor",
      patchSize: 128,
      padding: 16,
      progress: (percent: number) => {
        const v = Math.min(1, Math.max(0, percent));
        onProgress({ stage: "process", value: 0.08 + 0.88 * v });
      },
    });
    outTensor = result as TfTensor;
  } finally {
    inputTensor.dispose();
  }

  onProgress({ stage: "encode", value: 0.97 });
  const outW = width * UPSCALE_FACTOR;
  const outH = height * UPSCALE_FACTOR;
  const values = await outTensor.data();
  outTensor.dispose();

  const out = new Uint8ClampedArray(outW * outH * 4);
  const range = engine.definition.meta?.outputRange ?? [0, 255];
  // Values already scaled to outputRange by the library; normalise to bytes.
  const lo = range[0];
  const hi = range[1];
  const toByte = (v: number): number => {
    const x = ((v - lo) / (hi - lo)) * 255;
    return x < 0 ? 0 : x > 255 ? 255 : x;
  };
  for (let i = 0, o = 0; o < out.length; i += 3, o += 4) {
    out[o] = toByte(values[i]);
    out[o + 1] = toByte(values[i + 1]);
    out[o + 2] = toByte(values[i + 2]);
    out[o + 3] = 255;
  }

  // Preserve real transparency: resample the source alpha at ×4.
  if (hasMeaningfulAlpha(src)) {
    const alphaCanvas = new OffscreenCanvas(outW, outH);
    const actx = alphaCanvas.getContext("2d");
    if (actx) {
      actx.imageSmoothingEnabled = true;
      actx.imageSmoothingQuality = "high";
      actx.drawImage(sourceBitmap, 0, 0, outW, outH);
      const alphaData = actx.getImageData(0, 0, outW, outH).data;
      for (let i = 3; i < out.length; i += 4) out[i] = alphaData[i];
    }
  }

  return {
    imageData: new ImageData(out, outW, outH),
    scale: UPSCALE_FACTOR,
  };
}
