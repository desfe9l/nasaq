/** Focused installed-app regression. No auth bypass, production writes or full suite.
 * BASE_URL and BROWSER_EXECUTABLE optionally target a built preview/browser. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const tabs = [
  "المكتبة",
  "العناصر",
  "الأدوات",
  "الأشكال",
  "القوالب",
  "الألوان",
  "الخطوط",
  "الإعدادات",
  "الصفحات",
  "الخصائص",
  "الطبقات",
  "التقرير",
];
mkdirSync("screenshots/editor-focused", { recursive: true });
try {
  for (const [device, width, height, touch] of [
    ["desktop", 1440, 960, false],
    ["ipad", 1024, 768, true],
    ["iphone", 390, 844, true],
    ["iphone-landscape", 844, 390, true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: touch,
      isMobile: device.startsWith("iphone"),
      locale: "ar",
    });
    await context.addInitScript(
      ({ touch }) => {
        localStorage.setItem("nasaq.onboarding.v1", "done");
        localStorage.setItem("nasaq.editor.mobile-guide.v1", "1");
        localStorage.setItem("nasaq.install-offer.v1", "1");
        // Also exercise a custom group whose host is NOT Elements.
        localStorage.setItem(
          "nasaq.panel.groups.v3",
          JSON.stringify({
            groups: {
              library: ["library", "elements", "tools"],
              properties: ["properties", "layers", "report"],
            },
            tabs: { library: "library", properties: "properties" },
          }),
        );
        if (touch)
          Object.defineProperty(navigator, "standalone", { value: true });
        else {
          const native = window.matchMedia.bind(window);
          window.matchMedia = (query) =>
            query === "(display-mode: standalone)"
              ? Object.defineProperty(native(query), "matches", { value: true })
              : native(query);
        }
      },
      { touch },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.goto(`${base}/create`, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "إنشاء وفتح المحرر", exact: true })
      .click();
    const shell = page.locator('.editor-ui[data-installed-app="true"]');
    await shell.waitFor({ timeout: 30000 }).catch(async (error) => {
      console.error(
        page.url(),
        (await page.locator("body").innerText()).slice(0, 1500),
      );
      throw error;
    });
    await page.locator(".editor-canvas-stage").waitFor();
    const tour = page.getByRole("button", { name: "تخطي الجولة", exact: true });
    if (await tour.isVisible()) await tour.click();
    const nav = page.getByRole("navigation", {
      name: "أدوات المحرر",
      exact: true,
    });
    assert.equal(await nav.getByRole("button").count(), tabs.length);
    const openPanels = page.locator(".editor-floating-panel.is-open");
    // The installed opening prioritises artwork, independent of saved groups.
    await page.waitForFunction(
      () => !document.querySelector(".editor-floating-panel.is-open"),
    );
    for (const label of tabs) {
      const button = nav.getByRole("button", { name: label, exact: true });
      await button.click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".editor-floating-panel.is-open").length ===
          1,
      );
      assert.equal(
        await button.getAttribute("aria-pressed"),
        "true",
        `${device}: ${label}`,
      );
      assert.equal(await nav.locator('[aria-pressed="true"]').count(), 1);
      await page.waitForFunction(() =>
        document
          .querySelector(
            ".editor-floating-panel.is-open .touch-properties-content",
          )
          ?.textContent.trim(),
      );
      const box = await openPanels.boundingBox();
      assert.ok(
        box &&
          box.x >= -1 &&
          box.y >= -1 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
        `${device}: panel bounds ${label}`,
      );
      const textBox = await button.locator(".product-nav-label").boundingBox();
      assert.ok(
        textBox.width > 10 && textBox.height > 5,
        "labels must be visible, not screen-reader-only",
      );
      if (device.startsWith("iphone")) {
        assert.ok(
          await openPanels.evaluate((el) => el.classList.contains("is-drawer")),
        );
        const navBox = await nav.boundingBox();
        assert.ok(
          box.y + box.height <= navBox.y + 1,
          "drawer must not cover tool navigation",
        );
      }
      await button.click();
      assert.equal(
        await openPanels.count(),
        0,
        "repeat press closes current panel",
      );
    }
    // Tool modes still use the existing canvas store; paint, text and shape
    // controls remain reachable alongside document/history controls.
    for (const label of ["فرشاة", "مسح", "إضافة نص", "رسم مستطيل"]) {
      const button = page
        .locator(".editor-tool-cluster")
        .getByRole("button", { name: label, exact: true });
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true", label);
      await button.click();
    }
    if (await openPanels.count())
      await openPanels.getByRole("button", { name: /^إغلاق / }).click();
    await nav.getByRole("button", { name: "الأشكال", exact: true }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector(".editor-floating-panel.is-open");
      return panel && getComputedStyle(panel).opacity === "1";
    });
    await page.screenshot({
      path: `screenshots/editor-focused/installed-${device}.png`,
    });
    const artwork = page.locator(".editor-canvas-stage [data-el-id]");
    // Real insertion, selection, history and persistence — never a second store.
    const insert = openPanels.locator("button.library-hit").first();
    if (touch) await insert.tap();
    else await insert.click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".editor-canvas-stage [data-el-id]").length >
        0,
    );
    await page.getByRole("button", { name: "تراجع", exact: true }).click();
    assert.equal(await artwork.count(), 0);
    await page.getByRole("button", { name: "إعادة", exact: true }).click();
    assert.ok((await artwork.count()) > 0);
    // Closing from the real window header also restores the artboard.
    await openPanels.getByRole("button", { name: /^إغلاق / }).click();
    assert.equal(await openPanels.count(), 0);
    await page
      .getByRole("button", { name: "تصدير المشروع", exact: true })
      .click();
    const exportDialog = page.getByRole("dialog", {
      name: "تصدير المستند",
      exact: true,
    });
    await exportDialog.waitFor();
    await exportDialog
      .getByRole("button", { name: "إغلاق", exact: true })
      .click();
    const documentName = `اختبار التطبيق ${device}`;
    await page
      .getByRole("textbox", { name: "اسم المشروع", exact: true })
      .fill(documentName);
    await page
      .locator('.editor-header-actions button[aria-keyshortcuts="⌘S"]')
      .click();
    /*
     * The save state is ONE chip in the document capsule (the old per-button
     * `.is-saved` tone was a second rendering of the same state). Wait for it
     * to leave «جارٍ الحفظ…» and report a settled document.
     */
    await page
      .locator(
        '.editor-doc-capsule [data-testid="editor-sync-status"][data-status="local"], ' +
          '.editor-doc-capsule [data-testid="editor-sync-status"][data-status="synced"], ' +
          '.editor-doc-capsule [data-testid="editor-sync-status"][data-status="ready"]',
      )
      .first()
      .waitFor();
    await page.getByRole("button", { name: "المظهر", exact: true }).click();
    await page
      .locator(".editor-menu-row")
      .filter({ hasText: "واجهة معتمة لليل" })
      .click();
    assert.ok(
      await shell.evaluate((el) => el.classList.contains("editor-dark")),
    );
    await nav.getByRole("button", { name: "الخصائص", exact: true }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector(".editor-floating-panel.is-open");
      return panel && getComputedStyle(panel).opacity === "1";
    });
    await page.screenshot({
      path: `screenshots/editor-focused/installed-${device}-dark.png`,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await shell.waitFor({ timeout: 30000 }).catch(async (error) => {
      console.error(
        page.url(),
        (await page.locator("body").innerText()).slice(0, 1500),
      );
      throw error;
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".editor-canvas-stage [data-el-id]").length >
        0,
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "اسم المشروع", exact: true })
        .inputValue(),
      documentName,
    );
    assert.ok(
      await shell.evaluate((el) => el.classList.contains("editor-dark")),
    );
    await nav.getByRole("button", { name: "الخطوط", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".editor-floating-panel.is-open").length ===
        1,
    );
    assert.equal(
      await nav
        .getByRole("button", { name: "الخطوط", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.deepEqual(errors, [], `${device}: runtime errors`);
    console.log(
      `PASS ${device}: installed detection, all ${tabs.length} tabs, custom groups, Arabic labels, drawer bounds, tool modes, touch insertion, undo/redo, export dialog, dark theme and document persistence`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
