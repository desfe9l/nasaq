/**
 * Raster export output contract for PNG, JPG and PDF.
 *
 * The author is only ever told "تم التصدير بنجاح" when a file was really
 * written and downloadable — these tests read the produced bytes, not just the
 * function's return value. An encoder that produces nothing is a FAILED export
 * and must surface as one; never a silent success with no file.
 *
 * The last test pins the AI-artwork chain as far as Node can take it: the page
 * snapshot (AI plates included) is what the rasteriser is handed, and exactly
 * that canvas is what PNG/JPG/PDF encode. Pixel-level presence through a real
 * browser is covered by `scripts/test-ai-image-export.mjs`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { toast } from "sonner";
import { useEditor } from "./store.ts";
import {
  runExport,
  exportImages,
  exportPdf,
  type CapturedPage,
} from "./export.ts";
import {
  paintSnapshot,
  svgDataUrl,
  type RenderSnapshot,
} from "./render-snapshot.ts";

/** Known-good one-pixel fixtures; every assertion is on real file bytes. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ADoDFU3/2Q==",
  "base64",
);

const jpegDataUrl = () => `data:image/jpeg;base64,${JPEG.toString("base64")}`;

interface SpyToast {
  kind: "success" | "error";
  msg: string;
}

/**
 * Minimal DOM/URL/canvas stand-ins plus the store state an export needs.
 * `canvasFactory` decides what every `document.createElement("canvas")`
 * produces so a test can script encoder behaviour page by page.
 */
function installHarness(canvasFactory: () => HTMLCanvasElement) {
  const before = useEditor.getState();
  const downloads: string[] = [];
  const blobs: Blob[] = [];
  const toasts: SpyToast[] = [];
  const initialDirectory = process.cwd();
  const outputDirectory = mkdtempSync(join(tmpdir(), "nasaq-export-output-"));
  const previousDocument = globalThis.document;
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  const toastRef = toast as unknown as {
    error: (msg: string) => void;
    success: (msg: string) => void;
  };
  const previousError = toastRef.error;
  const previousSuccess = toastRef.success;
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() {
      downloads.push(this.download);
    },
    remove() {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) =>
        tag === "canvas" ? canvasFactory() : anchor,
      body: { appendChild: () => {} },
    },
  });
  URL.createObjectURL = (blob) => {
    assert.ok(blob instanceof Blob);
    blobs.push(blob);
    return "blob:export-output";
  };
  URL.revokeObjectURL = () => {};
  toastRef.error = (msg: string) => {
    toasts.push({ kind: "error", msg });
  };
  toastRef.success = (msg: string) => {
    toasts.push({ kind: "success", msg });
  };
  // Resolved access + full licence: denials are asserted in their own tests.
  useEditor.setState({
    showcase: true,
    hydrated: true,
    entitlements: {
      ...before.entitlements,
      basic_export: true,
      advanced_export: true,
    },
  });
  return {
    before,
    downloads,
    blobs,
    toasts,
    initialDirectory,
    outputDirectory,
    project(name: string) {
      return {
        ...before,
        pack: "blank" as const,
        pages: before.pages.slice(0, 1),
        name,
      };
    },
    restore() {
      process.chdir(initialDirectory);
      rmSync(outputDirectory, { recursive: true, force: true });
      useEditor.setState(before);
      if (previousDocument === undefined)
        Reflect.deleteProperty(globalThis, "document");
      else
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
      URL.createObjectURL = previousCreate;
      URL.revokeObjectURL = previousRevoke;
      toastRef.error = previousError;
      toastRef.success = previousSuccess;
    },
  };
}

function fixedCanvas(
  png: Buffer,
  jpeg: Buffer,
  hooks: {
    toBlob?: (
      callback: (blob: Blob | null) => void,
      type: string,
    ) => void;
    toDataURL?: () => string;
  } = {},
) {
  return {
    width: 20,
    height: 20,
    toBlob:
      hooks.toBlob ??
      ((callback: (blob: Blob | null) => void, type: string) =>
        callback(
          new Blob(
            [new Uint8Array(type === "image/png" ? png : jpeg)],
            { type },
          ),
        )),
    toDataURL: hooks.toDataURL ?? jpegDataUrl,
  } as unknown as HTMLCanvasElement;
}

test("PNG, JPG and PDF downloads carry the encoder's exact bytes", async () => {
  const harness = installHarness(() => fixedCanvas(PNG, JPEG));
  try {
    const captured = [
      { canvas: fixedCanvas(PNG, JPEG), w: 10, h: 10 },
    ] as CapturedPage[];
    const project = harness.project("byte-report");
    await runExport("png", captured, project, project.pages);
    await runExport("jpg", captured, project, project.pages);
    // jsPDF's Node save writes to cwd; isolate the real PDF on disk.
    process.chdir(harness.outputDirectory);
    await runExport("pdf", captured, project, project.pages);
    process.chdir(harness.initialDirectory);

    assert.deepEqual(harness.downloads, ["byte-report.png", "byte-report.jpg"]);
    assert.equal(harness.blobs.length, 2);
    const [pngBlob, jpgBlob] = harness.blobs;
    assert.equal(
      Buffer.compare(
        Buffer.from(await pngBlob.arrayBuffer()),
        PNG,
      ),
      0,
      "PNG bytes must be exactly what the encoder produced",
    );
    assert.equal(
      Buffer.compare(
        Buffer.from(await jpgBlob.arrayBuffer()),
        JPEG,
      ),
      0,
      "JPG bytes must be exactly what the encoder produced",
    );
    const pdf = readFileSync(join(harness.outputDirectory, "byte-report.pdf"));
    assert.match(pdf.subarray(0, 8).toString(), /^%PDF-/);
    // The JPEG page art is embedded as a raw DCTDecode stream — the real
    // fixture bytes, not a placeholder.
    assert.ok(pdf.includes(Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
    assert.ok(pdf.includes(JPEG.subarray(0, 20)));
    // One success toast per format — and only because a file exists.
    assert.deepEqual(
      harness.toasts.filter((t) => t.kind === "success").map((t) => t.msg),
      ["تم التصدير بنجاح", "تم التصدير بنجاح", "تم التصدير بنجاح"],
    );
  } finally {
    harness.restore();
  }
});

test("a multi-page export archives every page's bytes, in order", async () => {
  const pageOne = PNG;
  const pageTwo = Buffer.concat([PNG, Buffer.from("page-two-marker")]);
  const harness = installHarness(() => fixedCanvas(pageOne, JPEG));
  try {
    const captured = [
      { canvas: fixedCanvas(pageOne, JPEG), w: 10, h: 10 },
      { canvas: fixedCanvas(pageTwo, JPEG), w: 10, h: 10 },
    ] as CapturedPage[];
    const project = harness.project("zip-report");
    await runExport("png", captured, project, project.pages);
    assert.deepEqual(harness.downloads, ["zip-report-pages.zip"]);
    const archive = harness.blobs[0];
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    assert.deepEqual(Object.keys(zip.files).sort(), [
      "zip-report-p01.png",
      "zip-report-p02.png",
    ]);
    assert.equal(
      Buffer.compare(
        await zip.files["zip-report-p01.png"].async("nodebuffer"),
        pageOne,
      ),
      0,
    );
    assert.equal(
      Buffer.compare(
        await zip.files["zip-report-p02.png"].async("nodebuffer"),
        pageTwo,
      ),
      0,
      "page 2's bytes must land in page 2's entry, not page 1's",
    );
    assert.equal(
      harness.toasts.filter((t) => t.kind === "success").length,
      1,
    );
  } finally {
    harness.restore();
  }
});

test("a licence revoked mid-flight blocks the download and stays silent", async () => {
  const harness = installHarness(() => fixedCanvas(PNG, JPEG));
  try {
    // Encoder resolves AFTER the entitlement flip: the writer must re-check
    // the licence immediately before creating the download.
    const slowCanvas = fixedCanvas(PNG, JPEG, {
      toBlob: (callback, type) => {
        setTimeout(
          () => callback(new Blob([PNG], { type })),
          25,
        );
      },
    });
    const captured = [
      { canvas: slowCanvas, w: 10, h: 10 },
    ] as CapturedPage[];
    const project = harness.project("revoked-report");
    const exportRun = runExport("png", captured, project, project.pages);
    setTimeout(() => {
      useEditor.setState({
        entitlements: {
          ...harness.before.entitlements,
          basic_export: false,
          advanced_export: false,
        },
      });
    }, 5);
    await exportRun;
    assert.deepEqual(harness.downloads, []);
    assert.equal(harness.blobs.length, 0);
    assert.equal(
      harness.toasts.filter((t) => t.kind === "success").length,
      0,
      "no file was written, so the author must not be told it succeeded",
    );
    assert.ok(
      harness.toasts.some(
        (t) => t.kind === "error" && t.msg.includes("قبل شراء الترخيص"),
      ),
    );
  } finally {
    harness.restore();
  }
});

test("a single-page encoder that yields no bytes fails loudly", async () => {
  const harness = installHarness(() => fixedCanvas(PNG, JPEG));
  try {
    const brokenCanvas = fixedCanvas(PNG, JPEG, {
      toBlob: (callback) => callback(null),
    });
    const captured = [
      { canvas: brokenCanvas, w: 10, h: 10 },
    ] as CapturedPage[];
    const project = harness.project("broken-report");
    await assert.rejects(
      runExport("png", captured, project, project.pages),
      /تعذر ترميز/,
    );
    assert.deepEqual(harness.downloads, []);
    assert.equal(
      harness.toasts.filter((t) => t.kind === "success").length,
      0,
    );
    assert.ok(harness.toasts.some((t) => t.kind === "error"));
  } finally {
    harness.restore();
  }
});

test("a page dropped from a multi-page encode fails loudly", async () => {
  const harness = installHarness(() => fixedCanvas(PNG, JPEG));
  try {
    const goodCanvas = fixedCanvas(PNG, JPEG);
    const badCanvas = fixedCanvas(PNG, JPEG, {
      toBlob: (callback) => callback(null),
    });
    const captured = [
      { canvas: goodCanvas, w: 10, h: 10 },
      { canvas: badCanvas, w: 10, h: 10 },
    ] as CapturedPage[];
    const project = harness.project("partial-report");
    await assert.rejects(
      runExport("jpg", captured, project, project.pages),
      /تعذر ترميز/,
    );
    assert.deepEqual(harness.downloads, [], "a partial archive is no archive");
    assert.equal(
      harness.toasts.filter((t) => t.kind === "success").length,
      0,
    );
  } finally {
    harness.restore();
  }
});

test("a PDF encoder that throws fails loudly and writes nothing", async () => {
  const harness = installHarness(() => fixedCanvas(PNG, JPEG));
  try {
    const brokenCanvas = fixedCanvas(PNG, JPEG, {
      toDataURL: () => {
        throw new Error("encoder exploded");
      },
    });
    const captured = [
      { canvas: brokenCanvas, w: 10, h: 10 },
    ] as CapturedPage[];
    const project = harness.project("exploded-report");
    process.chdir(harness.outputDirectory);
    await assert.rejects(
      runExport("pdf", captured, project, project.pages),
      /encoder exploded/,
    );
    process.chdir(harness.initialDirectory);
    assert.deepEqual(harness.downloads, []);
    assert.equal(readdirSync(harness.outputDirectory).length, 0);
    assert.equal(
      harness.toasts.filter((t) => t.kind === "success").length,
      0,
    );
  } finally {
    harness.restore();
  }
});

test("AI-generated plate artwork is painted from the snapshot and encoded as-is", async () => {
  const PLATE_MARKER = "AI-PLATE-77";
  // What the AI design generator leaves in the page snapshot: the picture is a
  // themed SVG plate carried in an <image> data URL.
  const plateSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
    `<rect width="10" height="10" fill="#0c3d2c"/>` +
    `<text x="1" y="5">${PLATE_MARKER}</text></svg>`;
  const snapshot: RenderSnapshot = {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">` +
      `<image href="${svgDataUrl(plateSvg)}" width="10" height="10"/>` +
      `</svg>`,
    w: 10,
    h: 10,
  };

  const drawnSources: string[] = [];
  const encodedCanvases: HTMLCanvasElement[] = [];
  let painted: HTMLCanvasElement | null = null;
  const previousImage = (
    globalThis as unknown as { Image?: unknown }
  ).Image;
  class FakeImage {
    src = "";
    decode(): Promise<void> {
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: FakeImage,
  });

  const harness = installHarness(() => {
    const mock = {
      width: 20,
      height: 20,
      toBlob: (callback: (blob: Blob | null) => void, type: string) => {
        encodedCanvases.push(mock as unknown as HTMLCanvasElement);
        callback(
          new Blob(
            [new Uint8Array(type === "image/png" ? PNG : JPEG)],
            { type },
          ),
        );
      },
      toDataURL: () => {
        encodedCanvases.push(mock as unknown as HTMLCanvasElement);
        return jpegDataUrl();
      },
      getContext: () => ({
        drawImage: (image: { src: string }) => {
          drawnSources.push(image.src);
        },
      }),
    };
    return mock as unknown as HTMLCanvasElement;
  });

  try {
    const canvas = await paintSnapshot(snapshot, 1);
    painted = canvas;
    assert.equal(drawnSources.length, 1);
    assert.ok(
      decodeURIComponent(drawnSources[0]).includes(PLATE_MARKER),
      "the rasteriser must be handed the snapshot carrying the AI plate",
    );

    const captured = [{ canvas, w: 10, h: 10 }] as CapturedPage[];
    await exportImages(captured, "ai-report", "png");
    process.chdir(harness.outputDirectory);
    await exportPdf(captured, "ai-report");
    process.chdir(harness.initialDirectory);

    assert.equal(encodedCanvases.length, 2);
    assert.ok(
      encodedCanvases.every((c) => c === painted),
      "PNG and PDF must encode exactly the canvas the snapshot painted",
    );
    assert.equal(
      Buffer.compare(Buffer.from(await harness.blobs[0].arrayBuffer()), PNG),
      0,
    );
    const pdf = readFileSync(join(harness.outputDirectory, "ai-report.pdf"));
    assert.match(pdf.subarray(0, 8).toString(), /^%PDF-/);
  } finally {
    harness.restore();
    if (previousImage === undefined)
      Reflect.deleteProperty(globalThis, "Image");
    else
      Object.defineProperty(globalThis, "Image", {
        configurable: true,
        value: previousImage,
      });
  }
});
