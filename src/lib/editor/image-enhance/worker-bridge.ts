/**
 * Main-thread bridge to the image-processing Web Worker.
 *
 * Background removal (ONNX inference) and denoising (non-local means) both
 * run in a dedicated worker so the editor canvas never freezes, even on large
 * photos. The worker is created lazily on first use and kept alive: model
 * sessions cached inside it make the second run dramatically faster.
 */
import type {
  EnhanceErrorCode,
  EnhanceProgressFn,
  EnhanceMime,
} from "./types.ts";
import { EnhanceError } from "./types.ts";

export type WorkerOp = "background" | "denoise";

interface RunRequest {
  type: "run";
  id: number;
  op: WorkerOp;
  blob: Blob;
  width: number;
  height: number;
  mime: EnhanceMime;
}

type WorkerReply =
  | {
      type: "progress";
      id: number;
      stage: "download" | "model" | "process" | "encode";
      value: number;
    }
  | { type: "done"; id: number; blob: Blob; width: number; height: number; mime: EnhanceMime }
  | { type: "error"; id: number; code: EnhanceErrorCode; message: string };

interface PendingJob {
  resolve: (value: { blob: Blob; width: number; height: number; mime: EnhanceMime }) => void;
  reject: (err: Error) => void;
  onProgress: EnhanceProgressFn;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingJob>();

function onMessage(ev: MessageEvent<WorkerReply>): void {
  const msg = ev.data;
  const job = pending.get(msg.id);
  if (!job) return;
  if (msg.type === "progress") {
    try {
      job.onProgress({ stage: msg.stage, value: msg.value });
    } catch {
      // Progress reporting must never break the pipeline.
    }
    return;
  }
  pending.delete(msg.id);
  if (msg.type === "done") {
    job.resolve({ blob: msg.blob, width: msg.width, height: msg.height, mime: msg.mime });
  } else {
    job.reject(new EnhanceError(msg.code, msg.message));
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./enhance-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = onMessage;
    worker.onerror = (ev) => {
      // Fatal worker failure (bundle/network problem): fail every pending job
      // with a retryable error instead of hanging the UI forever.
      const err = new EnhanceError(
        "engine_failed",
        ev.message || "توقفت خدمة المعالجة في الخلفية",
      );
      for (const job of pending.values()) job.reject(err);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

export interface WorkerRunResult {
  blob: Blob;
  width: number;
  height: number;
  mime: EnhanceMime;
}

/** Run an op inside the processing worker. Never throws synchronously. */
export function runInWorker(
  op: WorkerOp,
  input: { blob: Blob; width: number; height: number; mime: EnhanceMime },
  onProgress: EnhanceProgressFn,
): Promise<WorkerRunResult> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = getWorker();
    } catch (err) {
      reject(
        new EnhanceError(
          "engine_failed",
          err instanceof Error ? err.message : "تعذر بدء خدمة المعالجة",
        ),
      );
      return;
    }
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject, onProgress });
    const request: RunRequest = {
      type: "run",
      id,
      op,
      blob: input.blob,
      width: input.width,
      height: input.height,
      mime: input.mime,
    };
    // A Blob is NOT a transferable object: listing it in the transfer array
    // makes `postMessage` throw a DataCloneError before the job ever reaches
    // the worker. Blobs are immutable and structured-clone by reference, so
    // posting it plainly costs no copy.
    try {
      w.postMessage(request);
    } catch (err) {
      pending.delete(id);
      reject(
        new EnhanceError(
          "engine_failed",
          err instanceof Error ? err.message : "تعذر إرسال الصورة إلى خدمة المعالجة",
        ),
      );
    }
  });
}
