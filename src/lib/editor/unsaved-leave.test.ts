import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAVE_BODY,
  LEAVE_CANCEL,
  LEAVE_DISCARD,
  LEAVE_SAVE,
  LEAVE_TITLE,
  hasUnsavedChanges,
  leavePromptSuppressed,
} from "./unsaved-leave.ts";

test("unsaved warning matches the editor copy and only dirty work", () => {
  assert.equal(LEAVE_TITLE, "لديك تغييرات غير محفوظة");
  assert.equal(LEAVE_BODY, "هل تريد حفظ المشروع قبل المغادرة؟");
  assert.equal(LEAVE_SAVE, "حفظ والمغادرة");
  assert.equal(LEAVE_DISCARD, "المغادرة دون حفظ");
  assert.equal(LEAVE_CANCEL, "إلغاء");
  assert.equal(hasUnsavedChanges("dirty"), true);
  assert.equal(hasUnsavedChanges("error"), true);
  assert.equal(hasUnsavedChanges("saving"), true);
  assert.equal(hasUnsavedChanges("saved"), false);
  assert.equal(hasUnsavedChanges("idle"), false);
  assert.equal(leavePromptSuppressed("saved"), true);
  assert.equal(leavePromptSuppressed("dirty"), false);
});
