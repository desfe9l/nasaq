/**
 * فتح ملف في المحرر — the ONE open path for a picked or dropped file.
 *
 * Every in-editor entry point that can receive an arbitrary file (the
 * «استيراد ملف» picker, a drop anywhere on the editor, a drop on the canvas)
 * comes through `openDesignFile`, and every foreign format goes through the
 * canonical import service (`importTemplateBytes`) that PSD, PDF, Office,
 * raster, SVG and native `.nsq`/JSON already share. A drop and a pick are
 * therefore the same operation with the same size policy, the same conversion
 * report and the same editable result — never a second, weaker interpreter.
 *
 * The function only orchestrates; classification and conversion live in
 * `detect.ts` / `run.ts`, the account decision in `nsq/intake.ts`.
 */

import { toast } from "sonner";

import { ANON_OWNER } from "../storage-owner";
import { useEditor } from "../store";
import { requestLeave } from "../leave-controller";
import { classifyImport } from "./detect";

export type OpenDesignOutcome = "opened" | "deferred" | "failed";

/**
 * Name-based hint for drag affordances and drop hints.
 *
 * A hint only: the bytes are still classified by `classifyImport` before any
 * converter runs, so a renamed file can never reach the wrong reader.
 */
const IMPORTABLE_EXTENSIONS = new Set([
  "psd",
  "psb",
  "docx",
  "pptx",
  "xlsx",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "nsq",
  "json",
]);

export function importableByName(name: string): boolean {
  const ext = String(name || "")
    .toLowerCase()
    .split(/[/\\]/)
    .pop()
    ?.split(".")
    .pop();
  return !!ext && IMPORTABLE_EXTENSIONS.has(ext);
}

/** Same owner test `useNsqSignedIn` makes, for callers outside React. */
function signedInNow(): boolean {
  const state = useEditor.getState();
  return Boolean(state.sessionOwner) && state.sessionOwner !== ANON_OWNER && state.hydrated;
}

/**
 * Turn a picked or dropped file into an open, fully editable NASAQ document.
 *
 * Native containers and legacy backups still take the durable inbox path
 * (account gate, preservation, resume) exactly as before; every other format
 * is converted by the canonical service and opened as ordinary pages and
 * objects. The unsaved-work guard runs first, so opening never discards a
 * document the author has not saved.
 */
export async function openDesignFile(file: File): Promise<OpenDesignOutcome> {
  if (!(await requestLeave())) return "deferred";
  const loadingId = toast.loading("جارٍ استيراد الملف إلى المحرر…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const classified = classifyImport(file.name, bytes);
    if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");

    if (classified.format === "nsq" || classified.format === "json") {
      toast.dismiss(loadingId);
      // The durable inbox (validation, preservation, account gate) is loaded
      // only when a native container is actually opened.
      const { receiveProjectFile } = await import("../../nsq/intake");
      const imported = await receiveProjectFile(file, signedInNow());
      return imported ? "opened" : "deferred";
    }

    // One canonical import service for every non-native format; PSD/PSB and
    // Office/PDF/raster share the same call, result shape and size policy.
    const [{ listAssets }, { importTemplateBytes }] = await Promise.all([
      import("../storage"),
      import("./run"),
    ]);
    const result = await importTemplateBytes(bytes, file.name, {
      assets: await listAssets(),
    });

    const opened = await useEditor
      .getState()
      .importProject(result.project, { successMessage: null });
    if (!opened) {
      toast.dismiss(loadingId);
      return "failed";
    }

    const approximate = result.notes.filter((note) => note.mode !== "editable");
    const notePreview = approximate
      .slice(0, 2)
      .map((note) => `${note.name}: ${note.reason}`)
      .join(" · ");
    toast.success("تم الاستيراد — افتُتح المستند في محرر نَسَق", {
      id: loadingId,
      description: approximate.length
        ? `${approximate.length} ملاحظة تحويل. ${notePreview}`
        : undefined,
    });
    return "opened";
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "تعذر استيراد الملف", {
      id: loadingId,
    });
    return "failed";
  }
}
