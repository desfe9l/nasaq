/**
 * Unsaved-leave decisions. Pure so the dialog copy and the save-state rule
 * can be tested without the editor store or a browser.
 */

export type TrackedSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export const LEAVE_TITLE = "لديك تغييرات غير محفوظة";
export const LEAVE_BODY = "هل تريد حفظ المشروع قبل المغادرة؟";
export const LEAVE_SAVE = "حفظ ومتابعة";
export const LEAVE_DISCARD = "متابعة بدون حفظ";
export const LEAVE_CANCEL = "إلغاء";

/** Dirty work, a failed save, and an in-flight save all still need a warning. */
export function hasUnsavedChanges(state: TrackedSaveState | undefined): boolean {
  return state === "dirty" || state === "error" || state === "saving";
}

/** A successful save is the only state that must stay silent. */
export function leavePromptSuppressed(state: TrackedSaveState | undefined): boolean {
  return state === "saved" || state === "idle" || state == null;
}
