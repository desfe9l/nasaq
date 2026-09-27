/**
 * Editor ⇄ `.nsq` bridge (browser-only).
 *
 * Builds a package from the live editor state (first-page preview included)
 * and writes it either through the File System Access API — whose writable
 * stream only replaces the target file when it is closed, so an interrupted
 * save leaves the previous file intact — or as a regular download.
 */

import { toast } from "sonner";
import { downloadBlob } from "@/lib/utils";
import { useEditor } from "@/lib/editor/store";
import {
  NSQ_EXTENSION,
  NSQ_MIME,
  nsqErrorMessage,
  nsqFileName,
} from "./format";
import { writeNsq, type NsqWriteResult } from "./package";
import { uploadedFontSources } from "./fonts";

/** Longest edge of the embedded preview, in px. */
const THUMB_EDGE = 512;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(async (blob) => {
        resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null);
      }, "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Render the first page to a PNG preview. Uses the same offscreen export DOM
 * the PDF exporter captures; falls back to the stored card thumbnail. Returns
 * null when neither is available — the package is valid without a preview.
 */
export async function captureFirstPagePreview(): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
} | null> {
  try {
    const page = document.querySelector<HTMLElement>(
      "#export-root [data-export-page]",
    );
    if (page && page.offsetWidth && page.offsetHeight) {
      const html2canvas = (await import("html2canvas")).default;
      const scale = THUMB_EDGE / Math.max(page.offsetWidth, page.offsetHeight);
      const canvas = await html2canvas(page, {
        scale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
        width: page.offsetWidth,
        height: page.offsetHeight,
        windowWidth: page.offsetWidth,
        windowHeight: page.offsetHeight,
      });
      const bytes = await canvasToPng(canvas);
      if (bytes) return { bytes, width: canvas.width, height: canvas.height };
    }
  } catch (err) {
    console.warn("[nsq] preview capture failed", err);
  }
  // Fallback: the card thumbnail auto-save keeps (a JPEG data URL) → PNG.
  const stored = useEditor.getState().thumbnail;
  if (stored && /^data:image\//.test(stored)) {
    try {
      const img = new Image();
      img.src = stored;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      const bytes = await canvasToPng(canvas);
      if (bytes) return { bytes, width: canvas.width, height: canvas.height };
    } catch {
      /* no preview — still a complete project */
    }
  }
  return null;
}

async function fetchImage(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.type.startsWith("image/") || /^blob:/i.test(url) ? blob : null;
  } catch {
    return null;
  }
}

/** Package the project that is open in the editor right now. */
export async function buildCurrentNsq(): Promise<NsqWriteResult> {
  const s = useEditor.getState();
  const meta = s.projects.find((p) => p.id === s.id);
  const activePageIndex = Math.max(
    0,
    s.pages.findIndex((p) => p.id === s.activePageId),
  );
  return writeNsq({
    project: {
      version: s.version,
      name: s.name,
      theme: s.theme,
      orgName: s.orgName,
      transactionNo: s.transactionNo,
      pages: s.pages,
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: Date.now(),
      defaultSize: s.defaultSize,
      pack: s.pack ?? meta?.pack,
      nsqOrigin: s.nsqOrigin,
    },
    activePageIndex,
    settings: { printGuides: s.printGuides },
    thumbnail: await captureFirstPagePreview(),
    fontSources: uploadedFontSources(),
    resolveExternal: fetchImage,
    site: typeof window !== "undefined" ? window.location.origin : undefined,
  });
}

/** Adopt the provenance record the first save created, so re-saves keep it. */
function adoptOrigin(result: NsqWriteResult) {
  const s = useEditor.getState();
  if (!s.nsqOrigin)
    useEditor.setState({ nsqOrigin: result.manifest.attribution });
}

function reportWarnings(warnings: string[]) {
  for (const w of warnings.slice(0, 3)) toast.message(w);
}

// ── File System Access (Chromium) with download fallback ────────────────────

type WritableLike = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};
type SaveHandle = { name: string; createWritable: () => Promise<WritableLike> };
type SavePickerWindow = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<SaveHandle>;
};

/** File handles chosen via «حفظ باسم», per project id, for this session. */
const handles = new Map<string, SaveHandle>();

export function supportsSavePicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as SavePickerWindow).showSaveFilePicker === "function"
  );
}

/** Name of the linked `.nsq` file for the open project, if one was chosen. */
export function linkedFileName(projectId: string | undefined): string | null {
  return (projectId && handles.get(projectId)?.name) || null;
}

async function writeToHandle(
  handle: SaveHandle,
  build: () => Promise<NsqWriteResult>,
) {
  // The package is built and verified BEFORE the writable opens, and the
  // writable only swaps in on close() — the existing file is never truncated
  // by a failed or interrupted save.
  const result = await build();
  const writable = await handle.createWritable();
  try {
    await writable.write(result.blob);
    await writable.close();
  } catch (err) {
    await writable.abort?.().catch(() => undefined);
    throw err;
  }
  return result;
}

/** «حفظ باسم…» — choose a location, then write the package there. */
export async function saveCurrentNsqAs(): Promise<boolean> {
  const s = useEditor.getState();
  const suggestedName = nsqFileName(s.name);
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) return downloadCurrentNsq();
  let handle: SaveHandle;
  try {
    // Must run first, while the click's user activation is still valid.
    handle = await picker.call(window, {
      suggestedName,
      types: [
        { description: "مشروع نَسَق", accept: { [NSQ_MIME]: [NSQ_EXTENSION] } },
      ],
      excludeAcceptAllOption: false,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return false;
    return downloadCurrentNsq();
  }
  const toastId = toast.loading("جارٍ حفظ ملف نَسَق…");
  try {
    const result = await writeToHandle(handle, buildCurrentNsq);
    if (s.id) handles.set(s.id, handle);
    adoptOrigin(result);
    toast.success(`تم الحفظ في «${handle.name}»`, { id: toastId });
    reportWarnings(result.warnings);
    return true;
  } catch (err) {
    console.error("[nsq] save failed", err);
    toast.error(
      `تعذّر حفظ الملف — ${nsqErrorMessage(err)} لم يتغير الملف السابق.`,
      { id: toastId },
    );
    return false;
  }
}

/** «حفظ» — write back to the linked file; falls back to «حفظ باسم». */
export async function saveCurrentNsq(): Promise<boolean> {
  const s = useEditor.getState();
  const handle = s.id ? handles.get(s.id) : undefined;
  if (!handle) return saveCurrentNsqAs();
  const toastId = toast.loading("جارٍ حفظ ملف نَسَق…");
  try {
    const result = await writeToHandle(handle, buildCurrentNsq);
    adoptOrigin(result);
    toast.success(`تم الحفظ في «${handle.name}»`, { id: toastId });
    reportWarnings(result.warnings);
    return true;
  } catch (err) {
    console.error("[nsq] save failed", err);
    toast.error(
      `تعذّر حفظ الملف — ${nsqErrorMessage(err)} لم يتغير الملف السابق.`,
      { id: toastId },
    );
    return false;
  }
}

/** «تنزيل ‎.nsq» — a regular browser download of the verified package. */
export async function downloadCurrentNsq(): Promise<boolean> {
  const toastId = toast.loading("جارٍ تجهيز ملف نَسَق…");
  try {
    const result = await buildCurrentNsq();
    downloadBlob(result.blob, nsqFileName(useEditor.getState().name));
    adoptOrigin(result);
    toast.success("تم تنزيل ملف المشروع (.nsq)", { id: toastId });
    reportWarnings(result.warnings);
    return true;
  } catch (err) {
    console.error("[nsq] download failed", err);
    toast.error(`تعذّر تجهيز ملف نَسَق — ${nsqErrorMessage(err)}`, {
      id: toastId,
    });
    return false;
  }
}
