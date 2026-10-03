/**
 * Image processing Web Worker entry.
 *
 * Runs the two heavy engines off the main UI thread:
 *  - background removal → @imgly/background-removal (real IS-Net ONNX model,
 *    executed by onnxruntime-web inside this worker; the image bytes never
 *    leave the browser — only model weights stream from the model CDN once
 *    and are then browser-cached)
 *  - denoise → the local non-local-means engine (pure math, no network)
 *
 * Protocol (matched by worker-bridge.ts):
 *   in : { type: "run", id, op, blob, width, height, mime }
 *   out: { type: "progress", id, stage, value }
 *        { type: "done", id, blob, width, height, mime }
 *        { type: "error", id, code, message }
 *
 * The file types against the DOM lib on purpose (single tsconfig project):
 * every API used here — Blob, ImageBitmap, OffscreenCanvas, ImageData —
 * exists identically in the worker scope.
 */
import { denoiseImage } from "./denoise-nlm.ts";
import { LOSSY_ENCODE_QUALITY, outputMimeFor } from "./limits.ts";
import type { EnhanceMime } from "./types.ts";

interface RunMessage {
  type: "run";
  id: number;
  op: "background" | "denoise";
  blob: Blob;
  width: number;
  height: number;
  mime: EnhanceMime;
}

type ProgressMsg = {
  type: "progress";
  id: number;
  stage: "download" | "model" | "process" | "encode";
  value: number;
};
type DoneMsg = {
  type: "done";
  id: number;
  blob: Blob;
  width: number;
  height: number;
  mime: EnhanceMime;
};
type ErrorMsg = {
  type: "error";
  id: number;
  code: "decode_failed" | "engine_failed" | "provider_unavailable";
  message: string;
};

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage: (msg: ProgressMsg | DoneMsg | ErrorMsg, transfer?: Transferable[]) => void;
};

/* ------------------------------------------------------------------ */
/* Background removal                                                  */
/* ------------------------------------------------------------------ */

type RemoveBackgroundFn = (
  image: Blob,
  config: Record<string, unknown>,
) => Promise<Blob>;

let removeBackgroundPromise: Promise<RemoveBackgroundFn> | null = null;

function loadRemoveBackground(): Promise<RemoveBackgroundFn> {
  if (!removeBackgroundPromise) {
    removeBackgroundPromise = import("@imgly/background-removal").then(
      (mod) => mod.removeBackground as RemoveBackgroundFn,
    );
  }
  return removeBackgroundPromise;
}

async function runBackground(msg: RunMessage): Promise<DoneMsg> {
  const removeBackground = await loadRemoveBackground();

  // Monotone-mapped progress: model/asset downloads fill 0.05–0.6, inference
  // and mask composition 0.6–0.9, encoding the rest.
  let lastSent = 0;
  const send = (stage: ProgressMsg["stage"], value: number): void => {
    const v = Math.min(1, Math.max(lastSent, value));
    lastSent = v;
    scope.postMessage({ type: "progress", id: msg.id, stage, value: v });
  };

  const publicPath =
    (import.meta.env?.VITE_NASAQ_BG_MODEL_PUBLIC_PATH as string | undefined)?.trim() ||
    undefined;

  const outBlob = await removeBackground(msg.blob, {
    // "medium" = isnet_fp16: the quality/size sweet spot for hair and edges.
    model: "medium",
    device: "cpu",
    proxyToWorker: false, // we are already the processing worker
    ...(publicPath ? { publicPath } : {}),
    output: { format: "image/png", quality: 1 },
    progress: (key: string, current: number, total: number) => {
      if (key.startsWith("fetch:")) {
        const frac = total > 0 ? current / total : 0;
        send("download", 0.05 + 0.5 * Math.min(1, frac));
      } else if (key === "compute:decode") {
        send("process", 0.62);
      } else if (key === "compute:inference") {
        send("process", 0.68);
      } else if (key === "compute:mask") {
        send("process", 0.88);
      } else if (key.startsWith("compute:encode")) {
        send("encode", 0.94);
      }
    },
  });

  send("encode", 1);
  const image = await bitmapFromBlob(outBlob);
  return {
    type: "done",
    id: msg.id,
    blob: outBlob,
    width: image.width,
    height: image.height,
    mime: "image/png",
  };
}

/* ------------------------------------------------------------------ */
/* Denoise                                                             */
/* ------------------------------------------------------------------ */

async function bitmapFromBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new DecodeError("تعذر فك ترميز الصورة للمعالجة");
  }
}

class DecodeError extends Error {}

async function runDenoise(msg: RunMessage): Promise<DoneMsg> {
  const bitmap = await bitmapFromBlob(msg.blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new DecodeError("تعذر إنشاء سياق الرسم للمعالجة");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);

  let lastSent = 0;
  const { data } = denoiseImage(
    { data: imageData.data, width, height },
    {
      onTileProgress: (done, total) => {
        const v = Math.min(1, Math.max(lastSent, 0.05 + 0.85 * (done / total)));
        lastSent = v;
        scope.postMessage({ type: "progress", id: msg.id, stage: "process", value: v });
      },
    },
  );

  scope.postMessage({ type: "progress", id: msg.id, stage: "encode", value: 0.92 });
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  const mime = outputMimeFor("denoise", msg.mime);
  const blob = await canvas.convertToBlob({
    type: mime,
    quality: LOSSY_ENCODE_QUALITY,
  });
  return { type: "done", id: msg.id, blob, width, height, mime };
}

/* ------------------------------------------------------------------ */
/* Message loop                                                        */
/* ------------------------------------------------------------------ */

scope.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as RunMessage;
  if (!msg || msg.type !== "run") return;
  void (async () => {
    try {
      const done =
        msg.op === "background" ? await runBackground(msg) : await runDenoise(msg);
      scope.postMessage(done, [done.blob]);
    } catch (err) {
      let code: ErrorMsg["code"] = "engine_failed";
      let message = "فشلت المعالجة، حاول مرة أخرى";
      if (err instanceof DecodeError) {
        code = "decode_failed";
        message = err.message;
      } else if (err instanceof Error) {
        // Network failures surface as TypeError("fetch failed"/Failed to
        // fetch) inside the worker — report them as provider unavailability
        // so the UI can offer a retry with the right wording.
        if (/fetch|network|load failed|cdn/i.test(err.message)) {
          code = "provider_unavailable";
          message = "تعذر تحميل نموذج المعالجة — تحقق من الاتصال ثم أعد المحاولة";
        } else {
          message = `فشلت المعالجة: ${err.message}`;
        }
      }
      scope.postMessage({ type: "error", id: msg.id, code, message });
    }
  })();
};
