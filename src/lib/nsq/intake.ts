/**
 * Receiving project files — the single entry point for every way a project
 * file reaches NASAQ (file picker, drag & drop, `/open`, OS file handler,
 * the projects page).
 *
 *   recognise → validate → preserve (inbox) → [sign in] → import → editor
 *
 * A file is fully validated before anything is kept, and it is preserved
 * before any account is asked for, so the sign-in round trip can never lose
 * it. Imports always create a NEW project; nothing existing is overwritten.
 */

import { toast } from "sonner";
import { useEditor } from "@/lib/editor/store";
import { hasLeaveGuard, requestLeave } from "@/lib/editor/leave-controller";
import { hasUnsavedChanges } from "@/lib/editor/unsaved-leave";
import { isNsqFileName, nsqErrorMessage } from "./format";
import type { NsqReadResult } from "./package";
import {
  clearPending,
  getPending,
  putPending,
  type PendingSummary,
} from "./inbox";
import { getStorageOwner, ANON_OWNER } from "../editor/storage-owner";
import { loadEmbeddedFonts, missingFonts } from "./fonts";

/** Fired on `window` when a received file is waiting in the inbox. */
export const NSQ_PENDING_EVENT = "nasaq:nsq-pending";
/** `/editor?nsq=resume` — where sign-in returns to finish opening a file. */
export const NSQ_RESUME_URL = "/editor?nsq=resume";

const loadPackage = () => import("./package");

export type ReceiveOutcome = "imported" | "pending" | "failed";

export async function validateProjectFile(
  file: Blob,
  verifyOnly = false,
): Promise<NsqReadResult> {
  const { readNsq } = await loadPackage();
  return readNsq(file, {
    verifyOnly,
    includeThumbnail: true,
    allowLegacy: !("name" in file && isNsqFileName(String(file.name))),
  });
}

export function summaryOf(
  result: NsqReadResult,
  fallbackName: string,
): PendingSummary {
  return {
    title: result.project.name || fallbackName.replace(/\.nsq$/i, ""),
    pageCount: result.project.pages?.length || 0,
    thumbnail: result.thumbnail,
    createdWith: result.origin?.createdWith,
  };
}

/** Recognise, validate and preserve an `.nsq` in the inbox. */
export async function preserveNsq(
  file: File,
  materialize = false,
): Promise<{
  id: string;
  summary: PendingSummary;
  result: NsqReadResult;
} | null> {
  const toastId = toast.loading("جارٍ التحقق من ملف نَسَق…");
  try {
    const result = await validateProjectFile(file, !materialize);
    const summary = summaryOf(result, file.name);
    const entry = await putPending({
      fileName: file.name,
      size: file.size,
      receivedAt: Date.now(),
      summary,
      blob: file,
    });
    toast.dismiss(toastId);
    return { id: entry.id, summary, result };
  } catch (err) {
    toast.error(nsqErrorMessage(err), { id: toastId, description: file.name });
    return null;
  }
}

/**
 * Handle a project file picked or dropped inside the editor.
 *
 * Both native containers and legacy backups go through the durable inbox: opened at once for a signed-in account,
 * or held behind the account gate for a visitor (`NSQ_PENDING_EVENT`).
 */
export async function receiveProjectFile(
  file: File,
  signedIn: boolean,
): Promise<ReceiveOutcome> {
  if (hasLeaveGuard() && hasUnsavedChanges(useEditor.getState().saveState)) {
    const allowed = await requestLeave();
    if (!allowed) return "failed";
  }
  const preserved = await preserveNsq(file, signedIn);
  if (!preserved) return "failed";
  if (signedIn) {
    // Already validated — import the parsed result, then empty the inbox.
    const ok = await importReadResult(preserved.result, {
      importId: preserved.id,
    });
    if (ok) await clearPending(preserved.id).catch(() => undefined);
    else window.dispatchEvent(new CustomEvent(NSQ_PENDING_EVENT));
    return ok ? "imported" : "failed";
  }
  window.dispatchEvent(new CustomEvent(NSQ_PENDING_EVENT));
  return "pending";
}

/** Projects page / `/open`: preserve the file, then continue in the editor. */
export async function receiveAndContinueInEditor(file: File): Promise<boolean> {
  if (hasLeaveGuard() && hasUnsavedChanges(useEditor.getState().saveState)) {
    const allowed = await requestLeave();
    if (!allowed) return false;
  }
  if (!(await preserveNsq(file))) return false;
  window.location.assign(NSQ_RESUME_URL);
  return true;
}

/** Turn a validated read result into an open, editable library project. */
export async function importReadResult(
  result: NsqReadResult,
  opts: { successMessage?: string; importId?: string } = {},
): Promise<boolean> {
  const store = useEditor.getState();
  const expectedOwner = getStorageOwner();
  if (
    expectedOwner === ANON_OWNER ||
    !store.hydrated ||
    store.sessionOwner !== expectedOwner
  )
    return false;
  const loaded = await loadEmbeddedFonts(
    result.embeddedFonts,
    (family) => useEditor.getState().registerFont(family, "خط من ملف نَسَق"),
    () => getStorageOwner() === expectedOwner,
  );
  if (
    getStorageOwner() !== expectedOwner ||
    useEditor.getState().sessionOwner !== expectedOwner
  )
    return false;
  const ok = await store.importProject(
    {
      ...result.project,
      thumbnail: result.thumbnail,
      nsqOrigin: result.origin,
      embeddedFonts: result.embeddedFonts,
    },
    {
      activePageIndex: result.activePageIndex,
      successMessage: null,
      expectedOwner,
      importId: opts.importId,
    },
  );
  if (!ok) return false;
  toast.success(
    opts.successMessage ||
      `تم فتح «${result.project.name || "المشروع"}» — جاهز للتعديل`,
    {
      description: result.legacy
        ? undefined
        : "كل النصوص والصور والطبقات قابلة للتعديل.",
    },
  );
  const missing = missingFonts(result.fontEntries, loaded);
  if (missing.length) {
    toast.warning(
      `خطوط غير متوفرة على هذا الجهاز: ${missing.slice(0, 4).join("، ")}`,
      {
        description:
          "عُرضت النصوص بخط بديل مؤقتًا مع الحفاظ على اسم الخط وتنسيقه الأصلي.",
        duration: 8000,
      },
    );
  }
  for (const w of result.warnings.slice(0, 3)) toast.message(w);
  return true;
}

function dropResumeParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("nsq")) return;
    url.searchParams.delete("nsq");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  } catch {
    /* cosmetic only */
  }
}

let resuming: Promise<boolean> | null = null;

/**
 * Open the preserved file (caller has verified the session). Coalesced, so
 * overlapping triggers (mount + auth change + StrictMode) import it once.
 */
export function resumePending(): Promise<boolean> {
  if (resuming) return resuming;
  const resume = async () => {
    const entry = await getPending();
    if (!entry) return false;
    let result: NsqReadResult;
    try {
      const { readNsq } = await loadPackage();
      result = await readNsq(entry.blob, {
        allowLegacy: !isNsqFileName(entry.fileName),
      });
      const ok = await importReadResult(result, { importId: entry.id });
      if (ok) {
        await clearPending(entry.id);
        dropResumeParam();
      }
      return ok;
    } catch (err) {
      // Preserve even on failure. The user can retry or explicitly discard;
      // an unavailable account/storage service is not a reason to lose a file.
      toast.error(nsqErrorMessage(err), { description: entry.fileName });
      return false;
    }
  };
  // Serializes two tabs finishing the same OAuth handoff. The deterministic
  // import ID is also a crash-safe fallback where Web Locks is unavailable.
  resuming = Promise.resolve(
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("nasaq-native-import", resume)
      : resume(),
  ).finally(() => {
    resuming = null;
  });
  return resuming;
}
