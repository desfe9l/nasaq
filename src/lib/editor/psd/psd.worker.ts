/// <reference lib="webworker" />

import { importPsdBytes } from "./pipeline";
import type { PsdLibraryRef } from "./types";

interface StartMessage {
  buffer: ArrayBuffer;
  fileName: string;
  library: PsdLibraryRef[];
}

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<StartMessage>) => {
  const { buffer, fileName, library } = event.data;
  void importPsdBytes(new Uint8Array(buffer), fileName, library, (stage, percent, detail) => {
    scope.postMessage({ type: "progress", stage, percent, detail });
  })
    .then((result) => {
      scope.postMessage({ type: "done", result });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "تعذر تحليل ملف PSD";
      scope.postMessage({ type: "error", message });
    });
};
