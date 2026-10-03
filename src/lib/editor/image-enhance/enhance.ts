/**
 * Facade used by the editor UI to enhance a selected image element.
 *
 * Pipeline: decode the element's raster source → validate limits → run the
 * resolved provider (worker engines) → re-encode as a data URL the editor can
 * store. The original element is never mutated until the very last store
 * write, which is ONE undo step — so Undo restores the untouched original.
 */
import {
  EnhanceError,
  isEnhanceError,
  type EnhanceInput,
  type EnhanceMime,
  type EnhanceOp,
  type EnhanceProgress,
} from "./types.ts";
import { checkEnhanceInput } from "./limits.ts";
import { enhanceJobGuard } from "./job-guard.ts";
import { runEnhance } from "./provider.ts";

export interface EnhanceElementResult {
  dataUrl: string;
  width: number;
  height: number;
  mime: EnhanceMime;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new EnhanceError("decode_failed", "تعذر قراءة ملف الصورة"));
    img.src = src;
  });
}

/**
 * Decode an element's image source to bytes at full native resolution.
 * Throws EnhanceError with a user-facing Arabic message on failure.
 */
export async function decodeElementImage(src: string): Promise<EnhanceInput> {
  const value = (src || "").trim();
  if (!value) throw new EnhanceError("unsupported_source", "لا توجد صورة لمعالجتها");
  if (/^data:image\/(svg|gif)/i.test(value)) {
    throw new EnhanceError(
      "unsupported_source",
      "المعالجة متاحة لصور PNG وJPEG وWebP فقط",
    );
  }

  const img = await loadImageElement(value);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) {
    throw new EnhanceError("decode_failed", "تعذر قراءة أبعاد الصورة");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new EnhanceError("engine_failed", "تعذر إنشاء سياق الرسم");
  ctx.drawImage(img, 0, 0);

  // Keep PNG/WebP transparent-capable; JPEG sources stay JPEG.
  let mime: EnhanceMime =
    value.startsWith("data:image/jpeg") || value.startsWith("data:image/jpg")
      ? "image/jpeg"
      : value.startsWith("data:image/webp")
        ? "image/webp"
        : "image/png";

  let blob: Blob | null = null;
  try {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mime, 0.95),
    );
  } catch {
    blob = null; // tainted canvas (CORS) or encoder failure — fall through
  }
  if (!blob) {
    // Retry as PNG; if that also fails the source isn't processable here.
    try {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (blob) mime = "image/png";
    } catch {
      blob = null;
    }
  }
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) {
    throw new EnhanceError(
      "decode_failed",
      "تعذر تجهيز الصورة للمعالجة (قد تكون من مصدر خارجي محمي)",
    );
  }
  return { blob, width, height, mime };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new EnhanceError("engine_failed", "تعذر حفظ نتيجة المعالجة"));
    reader.readAsDataURL(blob);
  });
}

/** Throttle progress so React re-renders stay cheap (~10/s). */
function throttleProgress(
  fn: (p: EnhanceProgress) => void,
): (p: EnhanceProgress) => void {
  let last = 0;
  let lastValue = -1;
  return (p) => {
    const now = Date.now();
    if (p.value >= 1 || p.value - lastValue > 0.04 || now - last > 120) {
      last = now;
      lastValue = p.value;
      fn(p);
    }
  };
}

/**
 * Enhance one element image end-to-end. Rejects with EnhanceError. The caller
 * owns the final store write (one undo step).
 */
export async function enhanceElementImage(
  op: EnhanceOp,
  elId: string,
  src: string,
  onProgress: (p: EnhanceProgress) => void,
): Promise<EnhanceElementResult> {
  if (!enhanceJobGuard.begin(elId, op)) {
    throw new EnhanceError("busy", "توجد معالجة جارية لهذه الصورة بالفعل");
  }
  try {
    const input = await decodeElementImage(src);
    const limitError = checkEnhanceInput(op, input.width, input.height);
    if (limitError) throw limitError;

    const output = await runEnhance(op, input, throttleProgress(onProgress));
    const dataUrl = await blobToDataUrl(output.blob);
    return { dataUrl, width: output.width, height: output.height, mime: output.mime };
  } finally {
    enhanceJobGuard.end(elId);
  }
}

/** Map any failure to a user-facing Arabic message. */
export function describeEnhanceError(err: unknown): string {
  if (isEnhanceError(err)) return err.message;
  if (err instanceof Error && err.message) return `فشلت المعالجة: ${err.message}`;
  return "فشلت المعالجة لأسباب غير متوقعة";
}

export function isBusy(elId: string): boolean {
  return enhanceJobGuard.activeOp(elId) !== undefined;
}
