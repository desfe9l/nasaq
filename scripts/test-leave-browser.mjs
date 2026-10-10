import assert from "node:assert/strict";
import { chromium } from "playwright";

async function runJsdomFallback() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(
    '<!doctype html><html dir="rtl"><body><a id="nav-link" href="/home">الرئيسية</a><div id="root"></div></body></html>',
    {
      url: "http://localhost/editor",
      pretendToBeVisual: true,
    },
  );
  const { window } = dom;
  const define = (key, value) =>
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
    "HTMLAnchorElement",
    "HTMLButtonElement",
    "HTMLCanvasElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "PointerEvent",
    "KeyboardEvent",
    "PopStateEvent",
    "MutationObserver",
    "getComputedStyle",
    "location",
    "history",
    "CSS",
  ]) {
    if (window[key] !== undefined) define(key, window[key]);
  }
  define("navigator", {
    userAgent: "Mozilla/5.0 (leave-test)",
    language: "ar-SA",
    clipboard: { writeText: async () => {} },
    mediaDevices: undefined,
  });
  define("window", window);
  define("requestAnimationFrame", window.requestAnimationFrame.bind(window));
  define("cancelAnimationFrame", window.cancelAnimationFrame.bind(window));
  await import("fake-indexeddb/auto");

  const { createServer } = await import("vite");
  const { resolve } = await import("node:path");
  const vite = await createServer({
    configFile: false,
    root: resolve("."),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
    resolve: { alias: { "@": resolve("./src") } },
  });
  try {
    const { default: React } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { LeaveGuard } = await vite.ssrLoadModule(
      "/src/components/editor/LeaveGuard.tsx",
    );
    const { useEditor, clearDraftSnapshot } = await vite.ssrLoadModule(
      "/src/lib/editor/store.ts",
    );
    const { ANON_OWNER, setStorageOwner } = await vite.ssrLoadModule(
      "/src/lib/editor/storage-owner.ts",
    );
    const { getProject, saveProject, listProjects } = await vite.ssrLoadModule(
      "/src/lib/editor/storage.ts",
    );
    const { createProject } = await vite.ssrLoadModule(
      "/src/lib/editor/templates.ts",
    );
    const { LICENSE_ENTITLEMENTS } = await vite.ssrLoadModule(
      "/src/lib/license/types.ts",
    );
    const {
      leavePromptOpen,
      requestLeave,
      chooseLeave,
      blockRouterLeave,
    } = await vite.ssrLoadModule("/src/lib/editor/leave-controller.ts");

    setStorageOwner(ANON_OWNER);
    clearDraftSnapshot();
    const initial = await saveProject(
      createProject("blank", "official", "مشروع البداية المحفوظ"),
    );
    const existingAll = await listProjects();
    useEditor.setState({
      hydrated: true,
      sessionOwner: ANON_OWNER,
      entitlements: { ...LICENSE_ENTITLEMENTS.PRO },
      entitlementsResolved: true,
      entitlementsOwner: ANON_OWNER,
      id: initial.id,
      name: initial.name,
      orgName: initial.orgName,
      pack: initial.pack ?? "blank",
      theme: initial.theme,
      pages: initial.pages,
      activePageId: initial.pages[0]?.id ?? "",
      projects: existingAll,
      saveState: "saved",
      saveError: null,
      selectedId: null,
      selectedIds: [],
      past: [],
      future: [],
    });

    const host = window.document.getElementById("root");
    const root = createRoot(host);
    root.render(React.createElement(LeaveGuard));
    const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
    await settle();

    // 1. Clean project -> no dialog on anchor click or router leave
    assert.equal(await blockRouterLeave(), false);
    assert.equal(host.querySelector('[role="dialog"]'), null);

    // 2. Dirty -> Cancel via rendered DOM button
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل عبر واجهة الحماية");
    const cancelReq = requestLeave();
    await settle();
    const dlg1 = host.querySelector('[role="dialog"]');
    assert.ok(dlg1, "LeaveGuard dialog must render when dirty");
    const cancelBtn = Array.from(dlg1.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "إلغاء",
    );
    assert.ok(cancelBtn, "Cancel button must render");
    cancelBtn.click();
    assert.equal(await cancelReq, false);
    await settle();
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.equal(useEditor.getState().name, "تعديل عبر واجهة الحماية");

    // 3. Dirty -> Save and Continue via rendered DOM button
    const saveReq = requestLeave();
    await settle();
    const dlg2 = host.querySelector('[role="dialog"]');
    assert.ok(dlg2);
    const saveBtn = Array.from(dlg2.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "حفظ وخروج",
    );
    assert.ok(saveBtn, "Save and Continue button must render");
    saveBtn.click();
    assert.equal(await saveReq, true);
    await settle();
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal(
      (await getProject(initial.id))?.name,
      "تعديل عبر واجهة الحماية",
    );

    // 4. Dirty -> Continue Without Saving via rendered DOM button
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل سيُهمل من الحوار");
    const discardReq = requestLeave();
    await settle();
    const dlg3 = host.querySelector('[role="dialog"]');
    assert.ok(dlg3);
    const discardBtn = Array.from(dlg3.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "الخروج بدون حفظ",
    );
    assert.ok(discardBtn, "Continue Without Saving button must render");
    discardBtn.click();
    assert.equal(await discardReq, true);
    await settle();
    assert.equal(host.querySelector('[role="dialog"]'), null);
    assert.equal(useEditor.getState().saveState, "saved");
    assert.equal(useEditor.getState().name, "تعديل عبر واجهة الحماية");

    // 5. Browser Back popstate intercepted by LeaveGuard -> Cancel keeps user in editor
    useEditor.getState().pauseScheduledSave();
    useEditor.getState().setName("تعديل محمي ضد زر الرجوع");
    await settle();
    window.dispatchEvent(new window.PopStateEvent("popstate", { state: {} }));
    await settle();
    assert.equal(leavePromptOpen(), true, "popstate must open leave dialog");
    chooseLeave("cancel");
    await settle();
    assert.equal(leavePromptOpen(), false);
    assert.equal(useEditor.getState().name, "تعديل محمي ضد زر الرجوع");

    // 6. Native beforeunload and pagehide events on window
    const beforeUnloadEvent = new window.Event("beforeunload", {
      cancelable: true,
    });
    window.dispatchEvent(beforeUnloadEvent);
    assert.equal(
      beforeUnloadEvent.defaultPrevented,
      true,
      "beforeunload must call preventDefault when dirty",
    );
    window.dispatchEvent(new window.Event("pagehide"));
    assert.ok(
      window.localStorage.getItem("nasaq-draft-v1"),
      "pagehide must persist synchronous recovery draft",
    );

    root.unmount();
    console.log("leave-browser (jsdom fallback) ok", {
      savedName: initial.name,
    });
  } finally {
    await vite.close();
  }
}

const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
let browser;
try {
  browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
} catch (err) {
  if (String(err).includes("Executable doesn't exist")) {
    await runJsdomFallback();
    process.exit(0);
  }
  throw err;
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem("nasaq.onboarding.v1", "done");
});
await ctx.route("**/api/auth/get-session**", (r) =>
  r.fulfill({
    json: {
      user: {
        id: "leave-test-user",
        email: "reader@example.test",
        name: "Reader",
        emailVerified: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      session: {
        id: "test-session",
        userId: "leave-test-user",
        token: "test-only",
        expiresAt: "2099-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    },
  }),
);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function waitForEditorReady() {
  await page.getByRole("button", { name: "ملف المشروع", exact: true }).waitFor({ timeout: 30000 });
  await page.evaluate(async () => {
    const mod = await import("/src/lib/editor/store.ts");
    window.__store = mod.useEditor;
  });
  await page.waitForFunction(() => window.__store && window.__store.getState().hydrated, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__store.getState().sessionOwner === "leave-test-user");
}

// 1. Open saved project -> UI focus without edit -> leave -> no dialog.
// `/editor` without parameters routes to the creation screen since the
// durable-URL overhaul (#124); `?template=official` is the direct editor
// boot that restores the author's last document — the behavior this
// suite exercises.
await page.goto(`${base}/editor?template=official`);
await waitForEditorReady();

const savedName = await page.evaluate(() => {
  const store = window.__store.getState();
  // No-op commits or setting identical values must not mark the project dirty.
  store.commit();
  store.setName(store.name);
  store.setOrg(store.orgName);
  store.setTheme(store.theme);
  return store.name;
});
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "saved");

const textEl = page.locator('[data-el-type="text"]').first();
if ((await textEl.count()) > 0) {
  await textEl.dblclick();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => window.__store.getState().saveState),
    "saved",
    "focusing and blurring text element without editing must not mark project dirty",
  );
}

const account = page.getByRole("button", { name: /حساب / });
await account.click();
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/editor"), { timeout: 10000 });
assert.equal(await page.locator("#unsaved-leave-title").count(), 0);

// 8 & 9. Edit project -> Leave -> Cancel (إلغاء) & Continue Without Saving (الخروج بدون حفظ).
await page.goto(`${base}/editor?template=official`);
await waitForEditorReady();
await page.evaluate(async () => {
  const store = window.__store.getState();
  store.pauseScheduledSave();
  store.setName("مسودة غير محفوظة");
});
await page.waitForFunction(() => window.__store.getState().saveState === "dirty");
await page.getByRole("button", { name: /حساب / }).click();
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
assert.equal(await page.locator("#unsaved-leave-title").innerText(), "لديك تغييرات غير محفوظة");
assert.match(await page.locator('[role="dialog"]').innerText(), /هل تريد حفظ المشروع قبل الخروج من المحرر؟/);
await page.getByRole("button", { name: "حفظ وخروج", exact: true }).waitFor();
await page.getByRole("button", { name: "الخروج بدون حفظ", exact: true }).waitFor();
await page.getByRole("button", { name: "إلغاء", exact: true }).click();
await page.waitForFunction(() => !document.getElementById("unsaved-leave-title"));
assert.equal(new URL(page.url()).pathname, "/editor");
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "dirty");
assert.equal(await page.evaluate(() => window.__store.getState().name), "مسودة غير محفوظة");

if (!(await page.getByRole("menuitem", { name: "مساحة العمل" }).isVisible())) {
  await page.getByRole("button", { name: /حساب / }).click();
}
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.getByRole("button", { name: "الخروج بدون حفظ", exact: true }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/editor"));
await page.goto(`${base}/editor?template=official`);
await waitForEditorReady();
await page.waitForFunction(() => window.__store.getState().name !== "مسودة غير محفوظة");
assert.notEqual(await page.evaluate(() => window.__store.getState().name), "مسودة غير محفوظة");

// 2. Edit project -> refresh -> native beforeunload confirmation appears.
await page.evaluate(() => {
  const store = window.__store.getState();
  store.pauseScheduledSave();
  store.setName("قبل الإغلاق");
});
await page.waitForFunction(() => window.__store.getState().saveState === "dirty");
let beforeUnload = false;
page.once("dialog", async (dialog) => {
  beforeUnload = dialog.type() === "beforeunload";
  await dialog.dismiss();
});
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
assert.equal(beforeUnload, true);
assert.equal(new URL(page.url()).pathname, "/editor");

// Save cleanly and verify reload does not trigger beforeunload.
const saved = await page.evaluate(async () => {
  const { useEditor } = await import("/src/lib/editor/store.ts");
  const { LICENSE_ENTITLEMENTS } = await import("/src/lib/license/types.ts");
  window.__store = useEditor;
  const store = useEditor.getState();
  store.setEntitlements(LICENSE_ENTITLEMENTS.PRO, store.sessionOwner ?? undefined);
  store.setName("محفوظ للخروج");
  await store.saveNow();
  return useEditor.getState().saveState;
});
if (saved !== "saved" && saved !== "idle") throw new Error(`save left state ${saved}`);
let unexpected = false;
page.once("dialog", async (dialog) => {
  unexpected = true;
  await dialog.dismiss();
});
await page.reload({ waitUntil: "domcontentloaded" });
assert.equal(unexpected, false);
await waitForEditorReady();

// 3 & 7. Edit project -> Browser Back -> confirmation appears -> Cancel -> Back -> Save and Continue (حفظ وخروج).
await page.evaluate(async () => {
  const { LICENSE_ENTITLEMENTS } = await import("/src/lib/license/types.ts");
  const { buildNewDocument, defaultNewDocument } = await import("/src/lib/editor/new-document.ts");
  const store = window.__store.getState();
  store.setEntitlements(LICENSE_ENTITLEMENTS.PRO, store.sessionOwner ?? undefined);
  // The in-page PRO entitlements do not survive the reload below (the mocked
  // session cannot cache a server entitlement), and hydrate() fail-closes the
  // boot restore of any premium-pack or over-limit document under FREE. The
  // persistence round trip therefore uses a real 1-page blank document — the
  // only shape a FREE boot restore is permitted to reopen.
  const created = await store.createDocument(
    buildNewDocument(
      defaultNewDocument({ name: "مستند الرجوع", pages: 1, pack: "blank" }),
    ),
  );
  if (!created) throw new Error("createDocument refused the blank document");
  const live = window.__store.getState();
  live.pauseScheduledSave();
  live.setName("محفوظ عبر الرجوع");
});
await page.waitForFunction(() => window.__store.getState().saveState === "dirty");
await page.evaluate(() => window.history.back());
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "إلغاء", exact: true }).click();
await page.waitForFunction(() => !document.getElementById("unsaved-leave-title"));
assert.equal(new URL(page.url()).pathname, "/editor");
assert.equal(await page.evaluate(() => window.__store.getState().name), "محفوظ عبر الرجوع");

await page.evaluate(() => window.history.back());
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "حفظ وخروج", exact: true }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/editor"), { timeout: 15000 });

await page.goto(`${base}/editor?template=official`);
await waitForEditorReady();
assert.equal(await page.evaluate(() => window.__store.getState().name), "محفوظ عبر الرجوع");
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "saved");

// 4. Edit project -> open another project -> confirmation appears (Cancel, Discard, Save & Continue).
const { firstId, secondId } = await page.evaluate(async () => {
  const { LICENSE_ENTITLEMENTS } = await import("/src/lib/license/types.ts");
  const { saveProject } = await import("/src/lib/editor/storage.ts");
  const { createProject } = await import("/src/lib/editor/templates.ts");
  const store = window.__store.getState();
  store.setEntitlements(LICENSE_ENTITLEMENTS.PRO, store.sessionOwner ?? undefined);
  const firstId = store.id;
  const second = await saveProject({
    ...createProject("blank", "official"),
    name: "المشروع الثاني المستهدف",
  });
  await store.refreshProjects();
  store.pauseScheduledSave();
  store.setName("تعديل قبل تبديل المشروع");
  return { firstId, secondId: second.id };
});
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "dirty");

// Trigger openProject(secondId) -> Cancel
await page.evaluate((id) => {
  window.__openPromise = window.__store.getState().openProject(id);
}, secondId);
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "إلغاء", exact: true }).click();
assert.equal(await page.evaluate(() => window.__openPromise), false);
assert.equal(await page.evaluate(() => window.__store.getState().id), firstId);
assert.equal(await page.evaluate(() => window.__store.getState().name), "تعديل قبل تبديل المشروع");

// Trigger openProject(secondId) -> Discard (الخروج بدون حفظ)
await page.evaluate((id) => {
  window.__openPromise = window.__store.getState().openProject(id);
}, secondId);
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "الخروج بدون حفظ", exact: true }).click();
assert.equal(await page.evaluate(() => window.__openPromise), true);
assert.equal(await page.evaluate(() => window.__store.getState().id), secondId);
assert.equal(await page.evaluate(() => window.__store.getState().name), "المشروع الثاني المستهدف");
assert.equal(
  await page.evaluate(async (id) => (await (await import("/src/lib/editor/storage.ts")).getProject(id))?.name, firstId),
  "محفوظ عبر الرجوع",
  "discarding when switching projects must not save discarded edits to the first project",
);

// Edit second project -> openProject(firstId) -> Save and Continue (حفظ وخروج)
await page.evaluate(() => {
  const store = window.__store.getState();
  store.pauseScheduledSave();
  store.setName("المشروع الثاني المحفوظ");
});
await page.evaluate((id) => {
  window.__openPromise = window.__store.getState().openProject(id);
}, firstId);
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "حفظ وخروج", exact: true }).click();
assert.equal(await page.evaluate(() => window.__openPromise), true);
assert.equal(await page.evaluate(() => window.__store.getState().id), firstId);
assert.equal(
  await page.evaluate(async (id) => (await (await import("/src/lib/editor/storage.ts")).getProject(id))?.name, secondId),
  "المشروع الثاني المحفوظ",
  "Save and Continue when switching projects must persist edits on the outgoing project",
);

// 5. Edit project -> create new document -> confirmation appears once (never duplicated).
await page.evaluate(() => {
  const store = window.__store.getState();
  store.pauseScheduledSave();
  store.setName("تعديل قبل إنشاء مستند جديد");
});
await page.getByRole("button", { name: "ملف المشروع", exact: true }).click();
await page.getByRole("menuitem", { name: "مشروع جديد" }).click();
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "إلغاء", exact: true }).click();
await page.waitForFunction(() => !document.getElementById("unsaved-leave-title"));
assert.equal(await page.evaluate(() => window.__store.getState().name), "تعديل قبل إنشاء مستند جديد");

await page.getByRole("button", { name: "ملف المشروع", exact: true }).click();
await page.getByRole("menuitem", { name: "مشروع جديد" }).click();
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "حفظ وخروج", exact: true }).click();
await page.waitForFunction(() => !document.getElementById("unsaved-leave-title"));
await page.getByRole("button", { name: "إنشاء المستند" }).click();
await page.waitForFunction((prevId) => window.__store.getState().id !== prevId, firstId);
assert.equal(await page.locator("#unsaved-leave-title").count(), 0);
assert.equal(
  await page.evaluate(async (id) => (await (await import("/src/lib/editor/storage.ts")).getProject(id))?.name, firstId),
  "تعديل قبل إنشاء مستند جديد",
);

// 6. Edit project -> open another file/template -> confirmation appears.
const currentDocId = await page.evaluate(() => {
  const store = window.__store.getState();
  store.pauseScheduledSave();
  store.setName("تعديل قبل فتح قالب");
  return store.id;
});
await page.evaluate(async () => {
  const { createProject } = await import("/src/lib/editor/templates.ts");
  window.__templatePromise = window.__store.getState().importProject({
    ...createProject("briefing", "official"),
    name: "قالب موجز تنفيذي",
  });
});
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "إلغاء", exact: true }).click();
assert.equal(await page.evaluate(() => window.__templatePromise), false);
assert.equal(await page.evaluate(() => window.__store.getState().id), currentDocId);
assert.equal(await page.evaluate(() => window.__store.getState().name), "تعديل قبل فتح قالب");

await page.evaluate(async () => {
  const { createProject } = await import("/src/lib/editor/templates.ts");
  window.__templatePromise = window.__store.getState().importProject({
    ...createProject("briefing", "official"),
    name: "قالب موجز تنفيذي",
  });
});
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "الخروج بدون حفظ", exact: true }).click();
assert.equal(await page.evaluate(() => window.__templatePromise), true);
assert.equal(await page.evaluate(() => window.__store.getState().name), "قالب موجز تنفيذي");
assert.notEqual(
  await page.evaluate(async (id) => (await (await import("/src/lib/editor/storage.ts")).getProject(id))?.name, currentDocId),
  "تعديل قبل فتح قالب",
);

// 10. Edit during an active save -> newer edits are preserved and subsequently persisted.
const activeSaveResult = await page.evaluate(async () => {
  const { getProject } = await import("/src/lib/editor/storage.ts");
  const store = window.__store.getState();
  store.setName("الدفعة الأولى أثناء الحفظ");
  const p1 = store.saveNow();
  const p2 = store.saveNow(); // concurrent duplicate call
  // Mutate while saveNow is in flight
  store.setName("الدفعة الأحدث أثناء الحفظ");
  await Promise.all([p1, p2]);
  const persisted = await getProject(window.__store.getState().id);
  return {
    saveState: window.__store.getState().saveState,
    liveName: window.__store.getState().name,
    persistedName: persisted?.name,
  };
});
assert.equal(activeSaveResult.saveState, "saved");
assert.equal(activeSaveResult.liveName, "الدفعة الأحدث أثناء الحفظ");
assert.equal(activeSaveResult.persistedName, "الدفعة الأحدث أثناء الحفظ");

// 11. Save failure -> user remains in the current project with edits intact.
await page.evaluate(async () => {
  const { LICENSE_ENTITLEMENTS } = await import("/src/lib/license/types.ts");
  const store = window.__store.getState();
  // Set pack to a premium pack ("eid") while downgrading entitlements to FREE so saveNow fails
  window.__store.setState({
    pack: "eid",
    entitlements: { ...LICENSE_ENTITLEMENTS.FREE },
  });
  store.pauseScheduledSave();
  store.setName("تعديل يفشل حفظه");
});
await page.getByRole("button", { name: /حساب / }).click();
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
await page.getByRole("button", { name: "حفظ وخروج", exact: true }).click();
await page.waitForFunction(() => !document.getElementById("unsaved-leave-title"));
assert.equal(new URL(page.url()).pathname, "/editor", "save failure must keep user in editor");
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "error");
assert.equal(await page.evaluate(() => window.__store.getState().name), "تعديل يفشل حفظه");

// Restore a clean, FREE-restorable document before testing mobile lifecycle.
// The in-page PRO entitlements do NOT survive a reload (the mocked session
// cannot cache a server entitlement), and hydrate() fail-closes the boot
// restore of any premium-pack document under FREE — so the recovery document
// must be the free "blank" pack for the draft restore to be permitted.
await page.evaluate(async () => {
  const { LICENSE_ENTITLEMENTS } = await import("/src/lib/license/types.ts");
  const store = window.__store.getState();
  window.__store.setState({ pack: "blank" });
  store.setEntitlements(LICENSE_ENTITLEMENTS.PRO, store.sessionOwner ?? undefined);
  await store.saveNow();
});
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "saved");

// 12. Mobile/iPad page lifecycle (pagehide) -> recoverable state is preserved.
await page.evaluate(() => {
  const store = window.__store.getState();
  store.pauseScheduledSave();
  store.setName("نسخة مستعادة بعد إخفاء الصفحة");
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
});
const hasDraft = await page.evaluate(() => Boolean(localStorage.getItem("nasaq-draft-v1")));
assert.equal(hasDraft, true, "pagehide must persist synchronous recovery draft");

page.once("dialog", async (dialog) => {
  await dialog.accept();
});
await page.reload({ waitUntil: "domcontentloaded" });
await waitForEditorReady();
await page.waitForFunction(
  () =>
    window.__store.getState().name === "نسخة مستعادة بعد إخفاء الصفحة" &&
    window.__store.getState().saveState === "saved",
  null,
  { timeout: 15000 },
);
assert.equal(
  await page.evaluate(async () => {
    const { getProject } = await import("/src/lib/editor/storage.ts");
    const id = window.__store.getState().id;
    return (await getProject(id))?.name;
  }),
  "نسخة مستعادة بعد إخفاء الصفحة",
);

await page.getByRole("button", { name: "ملف المشروع", exact: true }).click();
const menu = page.getByRole("menu", { name: "ملف المشروع" });
await menu.getByRole("menuitem", { name: /فتح مشروع أو استيراد ملف/ }).waitFor();
assert.equal(await menu.getByRole("menuitem", { name: "حفظ كقالب" }).count(), 0);
assert.equal(await menu.getByRole("menuitem", { name: "حفظ في قوالبي" }).count(), 0);
assert.deepEqual(errors, []);
console.log("leave-browser ok", { savedName });
await browser.close();
