import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
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
await page.goto(`${base}/editor`);
await page.getByRole("button", { name: "ملف المشروع", exact: true }).waitFor({ timeout: 30000 });
await page.evaluate(async () => {
  const mod = await import("/src/lib/editor/store.ts");
  window.__store = mod.useEditor;
});
await page.waitForFunction(() => window.__store && window.__store.getState().hydrated, null, { timeout: 30000 });
await page.waitForFunction(() => window.__store.getState().sessionOwner === "leave-test-user");

const savedName = await page.evaluate(() => window.__store.getState().name);
const account = page.getByRole("button", { name: /حساب / });
await account.click();
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/editor"), { timeout: 10000 });
assert.equal(await page.locator("#unsaved-leave-title").count(), 0);

await page.goto(`${base}/editor`);
await page.getByRole("button", { name: "ملف المشروع", exact: true }).waitFor({ timeout: 30000 });
await page.evaluate(async () => {
  window.__store = (await import("/src/lib/editor/store.ts")).useEditor;
});
await page.waitForFunction(() => window.__store && window.__store.getState().hydrated);
await page.evaluate(async () => {
  window.__store = (await import("/src/lib/editor/store.ts")).useEditor;
  const store = window.__store.getState();
  store.setName("مسودة غير محفوظة");
  store.pauseScheduledSave();
});
await page.waitForFunction(() => window.__store.getState().saveState === "dirty");
await page.getByRole("button", { name: /حساب / }).click();
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.getByRole("dialog", { name: "لديك تغييرات غير محفوظة" }).waitFor();
assert.equal(await page.locator("#unsaved-leave-title").innerText(), "لديك تغييرات غير محفوظة");
assert.match(await page.locator('[role="dialog"]').innerText(), /هل تريد حفظ المشروع قبل المغادرة؟/);
await page.getByRole("button", { name: "إلغاء" }).click();
await page.waitForFunction(() => !document.getElementById("unsaved-leave-title"));
assert.equal(new URL(page.url()).pathname, "/editor");
assert.equal(await page.evaluate(() => window.__store.getState().saveState), "dirty");

if (!(await page.getByRole("menuitem", { name: "مساحة العمل" }).isVisible())) {
  await page.getByRole("button", { name: /حساب / }).click();
}
await page.getByRole("menuitem", { name: "مساحة العمل" }).click();
await page.getByRole("button", { name: "المغادرة دون حفظ" }).click();
await page.waitForURL((url) => !url.pathname.startsWith("/editor"));
await page.goto(`${base}/editor`);
await page.getByRole("button", { name: "ملف المشروع", exact: true }).waitFor({ timeout: 30000 });
await page.evaluate(async () => {
  window.__store = (await import("/src/lib/editor/store.ts")).useEditor;
});
await page.waitForFunction(async () => {
  if (!window.__store) window.__store = (await import("/src/lib/editor/store.ts")).useEditor;
  const state = window.__store.getState();
  return state.hydrated && state.name !== "مسودة غير محفوظة";
});
assert.notEqual(await page.evaluate(() => window.__store.getState().name), "مسودة غير محفوظة");

await page.evaluate(() => {
  const store = window.__store.getState();
  store.setName("قبل الإغلاق");
  store.pauseScheduledSave();
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

await page.evaluate(async () => {
  window.__store = (await import("/src/lib/editor/store.ts")).useEditor;
});
await page.waitForFunction(() => window.__store.getState().hydrated);
await page.getByRole("button", { name: "ملف المشروع", exact: true }).click();
const menu = page.getByRole("menu", { name: "ملف المشروع" });
await menu.getByRole("menuitem", { name: /فتح ملف نَسَق/ }).waitFor();
assert.equal(await menu.getByRole("menuitem", { name: "حفظ كقالب" }).count(), 0);
assert.equal(await menu.getByRole("menuitem", { name: "حفظ في قوالبي" }).count(), 0);
assert.deepEqual(errors, []);
console.log("leave-browser ok", { savedName });
await browser.close();
