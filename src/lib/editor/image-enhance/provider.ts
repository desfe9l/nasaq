/**
 * Provider registry for image enhancement.
 *
 * The editor asks `resolveProvider(op)` and never touches an engine directly,
 * so swapping or adding providers (e.g. a future server-side service reached
 * through an authenticated API route) is a registration, not a rebuild.
 * Providers registered later win when they support the op — that is the
 * intended override path for a hosted implementation.
 */
import type {
  EnhanceOp,
  EnhanceOutput,
  EnhanceProgressFn,
  EnhanceProvider,
  EnhanceInput,
} from "./types.ts";
import { EnhanceError } from "./types.ts";
import { runInWorker } from "./worker-bridge.ts";
import { upscaleImage } from "./upscale.ts";
import { checkEnhanceInput, outputMimeFor } from "./limits.ts";

/**
 * The in-browser provider: background removal and denoise run in the
 * processing worker; upscaling runs through the TF.js engine. Everything
 * stays on the user's device.
 */
export const localEnhanceProvider: EnhanceProvider = {
  id: "local",
  supports(op: EnhanceOp): boolean {
    return op === "background" || op === "denoise" || op === "upscale";
  },
  async run(
    op: EnhanceOp,
    input: EnhanceInput,
    onProgress: EnhanceProgressFn,
  ): Promise<EnhanceOutput> {
    const limitError = checkEnhanceInput(op, input.width, input.height);
    if (limitError) throw limitError;

    if (op === "background" || op === "denoise") {
      const result = await runInWorker(op, input, onProgress);
      return {
        blob: result.blob,
        width: result.width,
        height: result.height,
        mime: outputMimeFor(op, input.mime),
      };
    }

    // op === "upscale"
    onProgress({ stage: "prepare", value: 0.02 });
    const bitmap = await createImageBitmap(input.blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new EnhanceError("decode_failed", "تعذر إنشاء سياق الرسم");
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const result = await upscaleImage({ imageData, sourceBitmap: bitmap }, onProgress);
      const outCanvas = new OffscreenCanvas(
        result.imageData.width,
        result.imageData.height,
      );
      const outCtx = outCanvas.getContext("2d");
      if (!outCtx) throw new EnhanceError("engine_failed", "تعذر إنشاء سياق الرسم");
      outCtx.putImageData(result.imageData, 0, 0);
      const mime = outputMimeFor(op, input.mime);
      const blob = await outCanvas.convertToBlob({
        type: mime,
        quality: mime === "image/png" ? undefined : 0.92,
      });
      return {
        blob,
        width: result.imageData.width,
        height: result.imageData.height,
        mime,
      };
    } finally {
      bitmap.close();
    }
  },
};

const providers: EnhanceProvider[] = [localEnhanceProvider];

/** Pure selection: first provider (by priority) that supports the op. */
export function pickProvider(
  list: readonly EnhanceProvider[],
  op: EnhanceOp,
): EnhanceProvider | undefined {
  return list.find((p) => p.supports(op));
}

/** Register an additional provider; later registrations take priority. */
export function registerEnhanceProvider(provider: EnhanceProvider): void {
  providers.unshift(provider);
}

/** Test/override hook: drop every non-local provider. */
export function resetEnhanceProviders(): void {
  providers.length = 0;
  providers.push(localEnhanceProvider);
}

export function listEnhanceProviders(): readonly EnhanceProvider[] {
  return providers;
}

/** Pick the provider that will actually run an op, if any. */
export function resolveProvider(op: EnhanceOp): EnhanceProvider | undefined {
  return pickProvider(providers, op);
}

/** Run an op through the resolved provider. */
export async function runEnhance(
  op: EnhanceOp,
  input: EnhanceInput,
  onProgress: EnhanceProgressFn,
): Promise<EnhanceOutput> {
  const provider = resolveProvider(op);
  if (!provider) {
    throw new EnhanceError(
      "provider_unavailable",
      "لا تتوفر خدمة معالجة لهذه العملية حاليًا",
    );
  }
  return provider.run(op, input, onProgress);
}
