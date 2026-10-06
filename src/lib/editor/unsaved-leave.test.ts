import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error jsdom has no bundled types in devDependencies
import { JSDOM } from "jsdom";
import {
  LEAVE_BODY,
  LEAVE_CANCEL,
  LEAVE_DISCARD,
  LEAVE_SAVE,
  LEAVE_TITLE,
  hasUnsavedChanges,
  leavePromptSuppressed,
} from "./unsaved-leave.ts";

const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', {
  url: "http://localhost/editor",
  pretendToBeVisual: true,
});
const { window } = dom;

const define = (key: string, value: unknown) =>
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });

for (const key of [
  "document",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLCanvasElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PopStateEvent",
  "BeforeUnloadEvent",
  "History",
  "MutationObserver",
  "getComputedStyle",
  "location",
  "history",
  "CSS",
] as const) {
  if ((window as unknown as Record<string, unknown>)[key] !== undefined) {
    define(key, (window as unknown as Record<string, unknown>)[key]);
  }
}
define("window", window);
define("navigator", {
  userAgent: "Mozilla/5.0 (unsaved-leave-test)",
  language: "ar-SA",
  clipboard: { writeText: async () => {} },
});
window.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});
define("matchMedia", window.matchMedia);
define("requestAnimationFrame", (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0),
);
define("cancelAnimationFrame", (id: number) => clearTimeout(id));
(window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext =
  () => ({
    measureText: () => ({
      width: 10,
      actualBoundingBoxAscent: 5,
      actualBoundingBoxDescent: 2,
    }),
    fillRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  });

const { ANON_OWNER, setStorageOwner } = await import("./storage-owner.ts");
const { getProject, saveProject, listProjects } = await import("./storage.ts");
const { createProject } = await import("./templates.ts");
const { LICENSE_ENTITLEMENTS } = await import("@/lib/license/types");
const { useEditor, clearDraftSnapshot } = await import("./store.ts");
const {
  blockRouterLeave,
  chooseLeave,
  hasLeaveGuard,
  leavePromptOpen,
  requestLeave,
  subscribeLeavePrompt,
  unloadShouldPrompt,
} = await import("./leave-controller.ts");

function waitForPromptOpen(): Promise<void> {
  if (leavePromptOpen()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = subscribeLeavePrompt(() => {
      if (leavePromptOpen()) {
        unsub();
        resolve();
      }
    });
  });
}

test("unsaved warning matches the editor copy and only dirty work", () => {
  assert.equal(LEAVE_TITLE, "لديك تغييرات غير محفوظة");
  assert.equal(LEAVE_BODY, "هل تريد حفظ المشروع قبل الخروج من المحرر؟");
  assert.equal(LEAVE_SAVE, "حفظ وخروج");
  assert.equal(LEAVE_DISCARD, "الخروج بدون حفظ");
  assert.equal(LEAVE_CANCEL, "إلغاء");
  assert.equal(hasUnsavedChanges("dirty"), true);
  assert.equal(hasUnsavedChanges("error"), true);
  assert.equal(hasUnsavedChanges("saving"), true);
  assert.equal(hasUnsavedChanges("saved"), false);
  assert.equal(hasUnsavedChanges("idle"), false);
  assert.equal(leavePromptSuppressed("saved"), true);
  assert.equal(leavePromptSuppressed("idle"), true);
  assert.equal(leavePromptSuppressed(undefined), true);
  assert.equal(leavePromptSuppressed("dirty"), false);
  assert.equal(leavePromptSuppressed("saving"), false);
  assert.equal(leavePromptSuppressed("error"), false);
});

test("the newest deep-link opens before the project library is enumerated", async () => {
  setStorageOwner(ANON_OWNER);
  clearDraftSnapshot();
  const superseded = await saveProject({
    ...createProject("blank", "official"),
    name: "مستند سابق",
  });
  const target = await saveProject({
    ...createProject("blank", "official"),
    name: "المستند المرتبط مباشرة",
  });
  let projectScans = 0;
  const originalGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = new Proxy(originalGetAll, {
    apply(method, store, args) {
      if ((store as IDBObjectStore).name === "projects") projectScans += 1;
      return Reflect.apply(method, store, args);
    },
  });

  try {
    useEditor.setState({ hydrated: false, sessionOwner: null });
    await Promise.all([
      useEditor.getState().hydrate(superseded.id),
      useEditor.getState().hydrate(target.id),
    ]);
    assert.equal(useEditor.getState().hydrated, true);
    assert.equal(useEditor.getState().id, target.id);
    assert.equal(projectScans, 0, "route hydration must not wait for a full project scan");
  } finally {
    IDBObjectStore.prototype.getAll = originalGetAll;
  }
});

test("all 12 unsaved-changes protection scenarios work end-to-end", async () => {
  const owner = ANON_OWNER;
  setStorageOwner(owner);
  clearDraftSnapshot();

  // Mount a leave guard subscriber so the controller knows the editor guard is active.
  const unsubscribeGuard = subscribeLeavePrompt(() => {});
  try {
    assert.equal(hasLeaveGuard(), true);

    useEditor.setState({
      hydrated: true,
      showcase: false,
      sessionOwner: owner,
      entitlements: { ...LICENSE_ENTITLEMENTS.PRO },
      entitlementsResolved: true,
      entitlementsOwner: owner,
    });

    // Create initial saved project
    const createdInit = await useEditor.getState().createProject("official", "official");
    assert.equal(createdInit, true);
    const firstId = useEditor.getState().id!;
    assert.ok(firstId);
    assert.equal(useEditor.getState().saveState, "saved");

    // 1. Open saved project -> UI focus / no-op commits -> leave -> no dialog.
    const initialName = useEditor.getState().name;
    useEditor.getState().commit();
    useEditor.getState().setName(initialName);
    useEditor.getState().setOrg(useEditor.getState().orgName);
    useEditor.getState().setTheme(useEditor.getState().theme);
    useEditor.getState().setTransactionNo(
      useEditor.getState().transactionNo ?? "",
    );
    useEditor.getState().renamePage(
      useEditor.getState().activePageId,
      useEditor.getState().pages[0].name,
    );
    useEditor.getState().setClipExport(useEditor.getState().clipExport);
    assert.equal(
      useEditor.getState().saveState,
      "saved",
      "no-op focus/commit/setters must not mark project dirty",
    );
    assert.equal(unloadShouldPrompt(), false);
    assert.equal(await requestLeave(), true);
    assert.equal(leavePromptOpen(), false);
    assert.equal(await blockRouterLeave(), false);

    // 2. Edit project -> refresh (beforeunload) -> native confirmation appears.
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل قبل التحديث");
    assert.equal(useEditor.getState().saveState, "dirty");
    assert.equal(unloadShouldPrompt(), true);
    assert.equal(
      leavePromptOpen(),
      false,
      "beforeunload must not open custom modal",
    );

    // 3 & 9. Edit project -> Back / router leave -> confirmation appears -> Cancel (إلغاء) keeps edits intact.
    const backBlockedPromise = blockRouterLeave();
    await waitForPromptOpen();
    assert.equal(leavePromptOpen(), true);
    // Concurrent requestLeave must deduplicate and not open a second dialog
    const duplicateRequest = requestLeave();
    chooseLeave("cancel");
    assert.equal(await backBlockedPromise, true, "Cancel must block router Back navigation");
    assert.equal(await duplicateRequest, false);
    assert.equal(leavePromptOpen(), false);
    assert.equal(useEditor.getState().saveState, "dirty");
    assert.equal(useEditor.getState().name, "تعديل قبل التحديث");

    // 7. Choose حفظ ومتابعة (Save and Continue) -> save completes -> navigation occurs.
    const saveAndLeavePromise = blockRouterLeave();
    await waitForPromptOpen();
    chooseLeave("save");
    assert.equal(
      await saveAndLeavePromise,
      false,
      "Save and Continue must allow navigation after saving",
    );
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal((await getProject(firstId))?.name, "تعديل قبل التحديث");

    // 8. Choose متابعة بدون حفظ (Continue Without Saving) -> navigation occurs and unsaved changes are discarded.
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل مؤقت يجب إهماله");
    assert.equal(useEditor.getState().saveState, "dirty");
    const discardLeavePromise = requestLeave();
    await waitForPromptOpen();
    chooseLeave("discard");
    assert.equal(await discardLeavePromise, true);
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal(
      useEditor.getState().name,
      "تعديل قبل التحديث",
      "Continue Without Saving must revert in-memory unsaved edits",
    );
    assert.equal(
      (await getProject(firstId))?.name,
      "تعديل قبل التحديث",
      "Continue Without Saving must keep last persisted project in storage",
    );
    assert.equal(window.localStorage.getItem("nasaq-draft-v1"), null);

    // 4. Edit project -> open another project -> confirmation appears (Cancel, Discard, Save & Continue).
    const secondSaved = await saveProject({
      ...createProject("blank", "official"),
      name: "المشروع الثاني",
    });
    await useEditor.getState().refreshProjects();

    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل قبل فتح مشروع آخر");
    assert.equal(useEditor.getState().saveState, "dirty");

    // 4a. Cancel opening another project
    const openCancelPromise = useEditor.getState().openProject(secondSaved.id!);
    await waitForPromptOpen();
    chooseLeave("cancel");
    assert.equal(await openCancelPromise, false);
    assert.equal(useEditor.getState().id, firstId);
    assert.equal(useEditor.getState().name, "تعديل قبل فتح مشروع آخر");
    assert.equal(useEditor.getState().saveState, "dirty");

    // 4b. Discard when opening another project
    const openDiscardPromise = useEditor.getState().openProject(secondSaved.id!);
    await waitForPromptOpen();
    chooseLeave("discard");
    assert.equal(await openDiscardPromise, true);
    assert.equal(useEditor.getState().id, secondSaved.id);
    assert.equal(useEditor.getState().name, "المشروع الثاني");
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal((await getProject(firstId))?.name, "تعديل قبل التحديث");

    // 4c. Save and Continue when opening another project
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("المشروع الثاني بعد الحفظ");
    const openSavePromise = useEditor.getState().openProject(firstId);
    await waitForPromptOpen();
    chooseLeave("save");
    assert.equal(await openSavePromise, true);
    assert.equal(useEditor.getState().id, firstId);
    assert.equal((await getProject(secondSaved.id!))?.name, "المشروع الثاني بعد الحفظ");

    // 5. Edit project -> create new document -> confirmation appears.
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل قبل إنشاء مستند جديد");
    const newDocPayload = {
      ...createProject("blank", "official"),
      name: "مستند جديد مستقل",
    };

    // 5a. Cancel creating new document
    const createCancelPromise = useEditor.getState().createDocument(newDocPayload);
    await waitForPromptOpen();
    chooseLeave("cancel");
    assert.equal(await createCancelPromise, false);
    assert.equal(useEditor.getState().id, firstId);
    assert.equal(useEditor.getState().name, "تعديل قبل إنشاء مستند جديد");

    // 5b. Save and Continue creating new document
    const createSavePromise = useEditor.getState().createDocument(newDocPayload);
    await waitForPromptOpen();
    chooseLeave("save");
    assert.equal(await createSavePromise, true);
    assert.notEqual(useEditor.getState().id, firstId);
    assert.equal(useEditor.getState().name, "مستند جديد مستقل");
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal((await getProject(firstId))?.name, "تعديل قبل إنشاء مستند جديد");

    // 6. Edit project -> open another file/template -> confirmation appears.
    const createdDocId = useEditor.getState().id!;
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل قبل استيراد قالب");
    const templateSeed = {
      ...createProject("briefing", "official"),
      name: "قالب موجز مستورد",
    };

    // 6a. Cancel importing template/file
    const importCancelPromise = useEditor.getState().importProject(templateSeed);
    await waitForPromptOpen();
    chooseLeave("cancel");
    assert.equal(await importCancelPromise, false);
    assert.equal(useEditor.getState().id, createdDocId);
    assert.equal(useEditor.getState().name, "تعديل قبل استيراد قالب");

    // 6b. Discard and Continue importing template/file
    const importDiscardPromise = useEditor.getState().importProject(templateSeed);
    await waitForPromptOpen();
    chooseLeave("discard");
    assert.equal(await importDiscardPromise, true);
    assert.equal(useEditor.getState().name, "قالب موجز مستورد");
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal((await getProject(createdDocId))?.name, "مستند جديد مستقل");

    // 10. Edit during an active save -> newer edits are preserved and subsequently persisted.
    useEditor.getState().setName("النسخة الأولى للحفظ");
    const save1 = useEditor.getState().saveNow();
    const save2 = useEditor.getState().saveNow();
    // Mutate while save1 is in flight
    useEditor.getState().setName("النسخة الأحدث أثناء الحفظ النشط");
    await Promise.all([save1, save2]);
    const activeIdAfterConcurrent = useEditor.getState().id!;
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal(useEditor.getState().name, "النسخة الأحدث أثناء الحفظ النشط");
    assert.equal(
      (await getProject(activeIdAfterConcurrent))?.name,
      "النسخة الأحدث أثناء الحفظ النشط",
    );

    // 11. Save failure -> user remains in the current project with edits intact.
    useEditor.setState({
      pack: "eid",
      entitlements: { ...LICENSE_ENTITLEMENTS.FREE },
    });
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل مع فشل الحفظ");
    const failLeavePromise = requestLeave();
    await waitForPromptOpen();
    chooseLeave("save");
    assert.equal(
      await failLeavePromise,
      false,
      "failed save must keep user in current project",
    );
    assert.equal(useEditor.getState().saveState, "error");
    assert.equal(useEditor.getState().name, "تعديل مع فشل الحفظ");

    // Restore clean 1-page blank project and save before mobile lifecycle check
    useEditor.setState({
      pack: "blank",
      pages: [useEditor.getState().pages[0]],
      entitlements: { ...LICENSE_ENTITLEMENTS.PRO },
    });
    await useEditor.getState().saveNow();
    assert.equal(useEditor.getState().saveState, "saved");

    // 12. Mobile/iPad page lifecycle -> recoverable state is preserved.
    useEditor.getState().pauseScheduledSave();
    clearDraftSnapshot();
    for (const key of ["showGrid", "snapGrid", "snapElements"] as const) {
      const initial = useEditor.getState()[key];
      useEditor.getState().toggle(key);
      assert.equal(useEditor.getState()[key], !initial, `${key} toggles immediately`);
      assert.equal(
        window.localStorage.getItem("nasaq-draft-v1"),
        null,
        "workspace toggles must not synchronously serialize the full project",
      );
      useEditor.getState().toggle(key);
      assert.equal(useEditor.getState()[key], initial, `${key} toggles back immediately`);
    }
    useEditor.getState().setName("تعديل مستعاد بعد إغلاق تبويب الآيباد");
    assert.equal(
      window.localStorage.getItem("nasaq-draft-v1"),
      null,
      "typing must stay off the synchronous localStorage draft path",
    );
    // Simulate pagehide calling unloadShouldPrompt()
    assert.equal(unloadShouldPrompt(), true);
    const rawDraft = window.localStorage.getItem("nasaq-draft-v1");
    assert.ok(rawDraft, "pagehide must write synchronous recovery draft");
    assert.match(rawDraft!, /تعديل مستعاد بعد إغلاق تبويب الآيباد/);

    // Simulate reload + hydrate() recovering the draft
    useEditor.setState({ hydrated: false, name: "قديم" });
    await useEditor.getState().hydrate();
    useEditor.setState({
      entitlements: { ...LICENSE_ENTITLEMENTS.PRO },
      entitlementsResolved: true,
      entitlementsOwner: owner,
    });
    assert.equal(
      useEditor.getState().name,
      "تعديل مستعاد بعد إغلاق تبويب الآيباد",
      "hydrate must restore mobile/iPad recovery draft",
    );
    await useEditor.getState().saveNow();
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal(
      (await getProject(useEditor.getState().id!))?.name,
      "تعديل مستعاد بعد إغلاق تبويب الآيباد",
    );
    assert.ok((await listProjects()).length >= 3);
  } finally {
    unsubscribeGuard();
    useEditor.getState().cancelPendingSaveTimer();
  }
});
