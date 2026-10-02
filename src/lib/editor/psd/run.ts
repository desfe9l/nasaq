/**
 * Run the PSD pipeline off the owner panel's thread when the browser allows
 * a module worker, and on the same thread otherwise. Both paths share
 * `importPsdBytes`, so a worker failure is not a different importer.
 */

import { importPsdBytes, type PsdImportResult } from "./pipeline";
import type { PsdLibraryRef, PsdProgress } from "./types";

export async function runPsdImport(
  bytes: Uint8Array,
  fileName: string,
  library: PsdLibraryRef[],
  onProgress?: PsdProgress,
): Promise<PsdImportResult> {
  if (typeof Worker === "undefined") {
    return importPsdBytes(bytes, fileName, library, onProgress);
  }
  try {
    return await runInWorker(bytes, fileName, library, onProgress);
  } catch {
    onProgress?.("التحويل على الخيط الرئيسي", 6, "تعذر تشغيل عامل الخلفية");
    return importPsdBytes(bytes, fileName, library, onProgress);
  }
}

function runInWorker(
  bytes: Uint8Array,
  fileName: string,
  library: PsdLibraryRef[],
  onProgress?: PsdProgress,
): Promise<PsdImportResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./psd.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error);
      return;
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("انتهت مهلة تحليل PSD"));
    }, 180_000);
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: "progress"; stage: string; percent: number; detail?: string }
        | { type: "done"; result: PsdImportResult }
        | { type: "error"; message: string };
      if (data.type === "progress") onProgress?.(data.stage, data.percent, data.detail);
      if (data.type === "done") {
        clearTimeout(timer);
        worker.terminate();
        resolve(data.result);
      }
      if (data.type === "error") {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("تعذر تشغيل تحليل PSD في الخلفية"));
    };
    worker.postMessage({ buffer, fileName, library }, [buffer]);
  });
}
