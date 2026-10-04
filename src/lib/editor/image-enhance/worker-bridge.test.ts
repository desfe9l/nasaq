import assert from "node:assert/strict";
import test from "node:test";
import { EnhanceError } from "./types.ts";

/**
 * A stand-in for the processing worker that applies the real structured-clone
 * rules to every message (`structuredClone` with the same transfer list), so a
 * non-transferable object in the transfer array fails here exactly as it does
 * in the browser — that is the regression that broke background removal and
 * denoise: `postMessage(request, [blob])` threw a DataCloneError.
 */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  received: unknown[] = [];

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const cloned = structuredClone(message, transfer ? { transfer } : undefined);
    this.received.push(cloned);
    const req = cloned as { id: number; blob: Blob; width: number; height: number; mime: string };
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: "progress", id: req.id, stage: "process", value: 0.5 } });
      this.onmessage?.({
        data: { type: "done", id: req.id, blob: req.blob, width: req.width, height: req.height, mime: req.mime },
      });
    });
  }

  terminate(): void {}
}

(globalThis as unknown as { Worker: typeof FakeWorker }).Worker = FakeWorker;

const { runInWorker } = await import("./worker-bridge.ts");

test("runInWorker posts the image Blob without a transfer list and resolves with the worker result", async () => {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const progress: number[] = [];
  const result = await runInWorker(
    "denoise",
    { blob, width: 4, height: 2, mime: "image/png" },
    (p) => progress.push(p.value),
  );
  assert.equal(result.width, 4);
  assert.equal(result.height, 2);
  assert.equal(result.mime, "image/png");
  assert.ok(result.blob instanceof Blob);
  assert.equal(result.blob.size, blob.size);
  assert.deepEqual(progress, [0.5]);
  const sent = FakeWorker.last?.received[0] as { op: string; blob: Blob };
  assert.equal(sent.op, "denoise");
  assert.ok(sent.blob instanceof Blob);
});

test("a postMessage failure rejects with an EnhanceError instead of hanging the job", async () => {
  const worker = FakeWorker.last!;
  const original = worker.postMessage;
  worker.postMessage = () => {
    throw new Error("DataCloneError");
  };
  try {
    await assert.rejects(
      runInWorker(
        "background",
        { blob: new Blob([new Uint8Array([1])], { type: "image/png" }), width: 1, height: 1, mime: "image/png" },
        () => {},
      ),
      (err: unknown) => err instanceof EnhanceError && err.code === "engine_failed",
    );
  } finally {
    worker.postMessage = original;
  }
});
