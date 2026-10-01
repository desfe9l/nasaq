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
import { getStorageOwner } from "../editor/storage-owner";
import { editorAccessResolved, useEditor } from "@/lib/editor/store";
import {
  NSQ_EXTENSION,
  NSQ_MIME,
  nsqErrorMessage,
  nsqFileName,
} from "./format";
import { writeNsq, type NsqWriteResult } from "./package";
import { NsqError } from "./format";
import { projectAccessBlock } from "@/lib/editor/access-limits";
import { uploadedFontSources } from "./fonts";
import { pageSize, clone, type Page } from "../editor/model";
import { writeAtomically, type NsqSaveHandle } from "./atomic-file";

/** Longest edge of the embedded preview, in px. */
const THUMB_EDGE = 512;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(async (blob) => {
        try {
          resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null);
        } catch {
          resolve(null);
        }
      }, "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Render the first page to a PNG preview. Uses the same offscreen export DOM
 * the export engine captures. No stale/generic fallback: if unavailable the
 * editable package remains complete without a preview.
 */
export async function captureFirstPagePreview(
  expectedPageId?: string,
): Promise<{
  bytes: Uint8Array;
  width: number;
  height: number;
} | null> {
  try {
    const first = useEditor.getState().pages[0];
    if (!first || (expectedPageId && expectedPageId !== first.id)) return null;
    /*
     * The capture DOM is mounted on demand (see ExportCaptureLayer): when the
     * export dialog is closed nothing renders into `#export-root`, so arm it,
     * wait two frames for React to paint it, and disarm after the capture.
     */
    let armed = false;
    if (!document.querySelector("#export-root")) {
      useEditor.setState({ captureArmed: true });
      armed = true;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    }
    try {
      return await capturePreviewFromDom(first);
    } finally {
      if (armed) useEditor.setState({ captureArmed: false });
    }
  } catch (error) {
    console.warn(
      "[nsq] thumbnail unavailable; editable document is unaffected",
      error,
    );
    return null;
  }
}

/** The DOM capture half of `captureFirstPagePreview`. */
async function capturePreviewFromDom(first: Page) {
  try {
    const node = document.querySelector<HTMLElement>(
      `#export-root [data-export-page="${CSS.escape(first.id)}"]`,
    );
    if (!node) return null;
    const { snapshotPage, paintSnapshot } =
      await import("../editor/render-snapshot");
    const { mmToPx } = await import("../editor/render-units");
    const size = pageSize(first);
    const snapshot = await snapshotPage({ node, ...size });
    const canvas = await paintSnapshot(
      snapshot,
      THUMB_EDGE / Math.max(mmToPx(size.w), mmToPx(size.h)),
    );
    const bytes = await canvasToPng(canvas);
    return bytes ? { bytes, width: canvas.width, height: canvas.height } : null;
  } catch (error) {
    console.warn(
      "[nsq] thumbnail unavailable; editable document is unaffected",
      error,
    );
    return null;
  }
}

async function fetchImage(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok || Number(res.headers.get("content-length")) > 64 * 1024 * 1024)
      return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024 * 1024) {
          await reader.cancel();
          return null;
        }
        chunks.push(new Uint8Array(value));
      }
    } finally {
      reader.releaseLock();
    }
    const blob = new Blob(chunks, {
      type:
        res.headers.get("content-type")?.split(";")[0] ||
        "application/octet-stream",
    });
    return blob.type.startsWith("image/") || /^blob:/i.test(url) ? blob : null;
  } catch {
    return null;
  }
}

/** Freeze the whole editable document at the user gesture, before any await. */
function saveSnapshot() {
  const s = useEditor.getState();
  return {
    id: s.id,
    owner: getStorageOwner(),
    pages: s.pages,
    input: {
      project: clone({
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
        pack: s.pack,
        licensedTemplateId: s.licensedTemplateId,
        nsqOrigin: s.nsqOrigin,
        embeddedFonts: s.embeddedFonts,
        nativeSourceProjectId: s.nativeSourceProjectId,
      }),
      activePageIndex: Math.max(
        0,
        s.pages.findIndex((p) => p.id === s.activePageId),
      ),
      settings: {
        printGuides: { ...s.printGuides },
        showGrid: s.showGrid,
        snapGrid: s.snapGrid,
        snapElements: s.snapElements,
      },
      fontSources: uploadedFontSources(),
      resolveExternal: fetchImage,
      site: typeof window !== "undefined" ? window.location.origin : undefined,
    },
  };
}

function assertSnapshotAccess(snapshot: ReturnType<typeof saveSnapshot>) {
  const current = useEditor.getState();
  if (
    !editorAccessResolved() ||
    getStorageOwner() !== snapshot.owner ||
    current.id !== snapshot.id ||
    projectAccessBlock(snapshot.input.project, current.entitlements)
  )
    throw new NsqError("access-denied");
}

/** Only a thumbnail of this snapshot may be attached; never a stale card image. */
export async function buildCurrentNsq(
  snapshot = saveSnapshot(),
): Promise<NsqWriteResult> {
  assertSnapshotAccess(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const thumbnail = await Promise.race([
    captureFirstPagePreview(snapshot.input.project.pages[0]?.id),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
  const now = useEditor.getState();
  const unchanged =
    now.id === snapshot.id &&
    now.pages === snapshot.pages &&
    now.theme === snapshot.input.project.theme &&
    now.orgName === snapshot.input.project.orgName &&
    now.transactionNo === snapshot.input.project.transactionNo;
  assertSnapshotAccess(snapshot);
  return writeNsq({
    ...snapshot.input,
    thumbnail: unchanged ? thumbnail : null,
  });
}

function adoptOrigin(
  result: NsqWriteResult,
  snapshot: ReturnType<typeof saveSnapshot>,
) {
  const s = useEditor.getState();
  if (
    getStorageOwner() === snapshot.owner &&
    s.id === snapshot.id &&
    !s.nsqOrigin
  )
    useEditor.setState({ nsqOrigin: result.manifest.attribution });
}

function reportWarnings(warnings: string[]) {
  for (const w of warnings.slice(0, 3)) toast.message(w);
}

// ── File System Access (Chromium) with download fallback ────────────────────

type SaveHandle = NsqSaveHandle;
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
  return (
    (projectId && handles.get(`${getStorageOwner()}:${projectId}`)?.name) ||
    null
  );
}

/** «حفظ باسم…» — choose a location, then write the package there. */
async function saveAs(): Promise<boolean> {
  const s = useEditor.getState();
  const snapshot = saveSnapshot();
  const suggestedName = nsqFileName(snapshot.input.project.name);
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) return download(snapshot);
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
    return download(snapshot);
  }
  const toastId = toast.loading("جارٍ حفظ ملف نَسَق…");
  try {
    const result = await writeAtomically(handle, () =>
      buildCurrentNsq(snapshot),
    );
    if (s.id) handles.set(`${snapshot.owner}:${s.id}`, handle);
    adoptOrigin(result, snapshot);
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
async function save(): Promise<boolean> {
  const s = useEditor.getState();
  const snapshot = saveSnapshot();
  const handle = s.id ? handles.get(`${snapshot.owner}:${s.id}`) : undefined;
  if (!handle) return saveAs();
  const toastId = toast.loading("جارٍ حفظ ملف نَسَق…");
  try {
    const result = await writeAtomically(handle, () =>
      buildCurrentNsq(snapshot),
    );
    adoptOrigin(result, snapshot);
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
async function download(snapshot = saveSnapshot()): Promise<boolean> {
  const toastId = toast.loading("جارٍ تجهيز ملف نَسَق…");
  try {
    const result = await buildCurrentNsq(snapshot);
    downloadBlob(result.blob, nsqFileName(result.manifest.title));
    adoptOrigin(result, snapshot);
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

let saving = false;
function exclusiveSave(action: () => Promise<boolean>): Promise<boolean> {
  if (saving) {
    toast.message("انتظر اكتمال حفظ الملف الحالي.");
    return Promise.resolve(false);
  }
  saving = true;
  return action().finally(() => {
    saving = false;
  });
}
export const saveCurrentNsqAs = () => exclusiveSave(saveAs);
export const saveCurrentNsq = () => exclusiveSave(save);
export const downloadCurrentNsq = () => exclusiveSave(() => download());
