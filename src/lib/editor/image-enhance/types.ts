/**
 * Image enhancement contract — the stable boundary between the editor and the
 * replaceable processing providers (background removal, denoise, upscaling).
 *
 * The editor never depends on a specific engine or vendor: it talks to a
 * provider through these types only, so the implementation can move between
 * in-browser engines and server-side services without touching editor code.
 * All shipping engines run fully in the user's browser — the image itself is
 * never uploaded anywhere.
 */

export type EnhanceOp = "background" | "denoise" | "upscale";

export const ENHANCE_OPS: readonly EnhanceOp[] = [
  "background",
  "denoise",
  "upscale",
];

/** Coarse pipeline stage, surfaced in the UI progress row. */
export type EnhanceStage =
  | "prepare"
  | "download"
  | "model"
  | "process"
  | "encode";

export interface EnhanceProgress {
  stage: EnhanceStage;
  /** 0..1 within the whole operation. */
  value: number;
}

export type EnhanceErrorCode =
  | "busy"
  | "unsupported_source"
  | "too_large"
  | "decode_failed"
  | "engine_failed"
  | "provider_unavailable";

/**
 * Normalised enhancement failure. The UI maps `code` to an Arabic message and
 * a retry affordance; nothing here ever throws a vendor-specific shape.
 */
export class EnhanceError extends Error {
  readonly code: EnhanceErrorCode;

  constructor(code: EnhanceErrorCode, message: string) {
    super(message);
    this.name = "EnhanceError";
    this.code = code;
  }
}

export function isEnhanceError(err: unknown): err is EnhanceError {
  return err instanceof EnhanceError;
}

/** Raster mimes the enhancement pipeline accepts (matches editor intake). */
export type EnhanceMime = "image/png" | "image/jpeg" | "image/webp";

export interface EnhanceInput {
  /** Decoded source image bytes. */
  blob: Blob;
  width: number;
  height: number;
  mime: EnhanceMime;
}

export interface EnhanceOutput {
  blob: Blob;
  width: number;
  height: number;
  /** Output mime; transparency-preserving ops return image/png. */
  mime: EnhanceMime;
}

export type EnhanceProgressFn = (progress: EnhanceProgress) => void;

/**
 * A processing provider. The local in-browser provider is registered by
 * default; a server-side provider can be registered later (it wins when it
 * supports the op) without editing the editor.
 */
export interface EnhanceProvider {
  readonly id: string;
  supports(op: EnhanceOp): boolean;
  run(
    op: EnhanceOp,
    input: EnhanceInput,
    onProgress: EnhanceProgressFn,
  ): Promise<EnhanceOutput>;
}
