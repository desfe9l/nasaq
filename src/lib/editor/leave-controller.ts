/**
 * One leave prompt for the editor.
 *
 * In-app navigation (links, back, opening another file) waits on this promise.
 * Browser refresh/close uses the native beforeunload prompt instead.
 */

import { toast } from "sonner";
import {
  clearDraftSnapshot,
  useEditor,
  writeDraftSnapshot,
} from "@/lib/editor/store";
import { hasUnsavedChanges } from "@/lib/editor/unsaved-leave";

type Choice = "save" | "discard" | "cancel";

let bypassUntil = 0;
let promptOpen = false;
let waiters: Array<(choice: Choice) => void> = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeLeavePrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function leavePromptOpen(): boolean {
  return promptOpen;
}

function armUnloadBypass() {
  bypassUntil = Date.now() + 2500;
}

function unloadBypassed(): boolean {
  return Date.now() < bypassUntil;
}

export function unloadShouldPrompt(): boolean {
  if (unloadBypassed()) return false;
  const state = useEditor.getState();
  if (state.showcase) return false;
  const unsaved = hasUnsavedChanges(state.saveState);
  /*
   * beforeunload is synchronous: IndexedDB cannot be awaited here. Keep a
   * bounded recovery envelope instead of deleting the only durable copy. The
   * hydrate path compares its timestamp with the saved row, so a confirmed
   * refresh can recover the latest edits while a successful save still wins.
   */
  if (unsaved) writeDraftSnapshot();
  return unsaved;
}

export async function blockRouterLeave(): Promise<boolean> {
  if (unloadBypassed()) return false;
  const allowed = await requestLeave();
  return !allowed;
}

/** Resolves true when navigation or replacement may continue. */
export async function requestLeave(): Promise<boolean> {
  if (unloadBypassed()) return true;
  const state = useEditor.getState();
  if (state.showcase) return true;
  if (state.saveState === "saving") await state.saveNow();
  if (!hasUnsavedChanges(useEditor.getState().saveState)) return true;
  useEditor.getState().pauseScheduledSave();
  const choice = await ask();
  if (choice === "cancel") {
    useEditor.getState().resumeScheduledSave();
    return false;
  }
  if (choice === "discard") {
    clearDraftSnapshot();
    const id = useEditor.getState().id;
    if (id) await useEditor.getState().openProject(id);
    armUnloadBypass();
    return true;
  }
  await useEditor.getState().saveNow();
  const after = useEditor.getState().saveState;
  if (after !== "saved" && after !== "idle") {
    toast.error("تعذر الحفظ — لم تتم المغادرة");
    useEditor.getState().resumeScheduledSave();
    return false;
  }
  clearDraftSnapshot();
  armUnloadBypass();
  return true;
}

export function chooseLeave(choice: Choice): void {
  const current = waiters;
  waiters = [];
  promptOpen = false;
  notify();
  for (const resolve of current) resolve(choice);
}

function ask(): Promise<Choice> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    if (!promptOpen) {
      promptOpen = true;
      notify();
    }
  });
}
