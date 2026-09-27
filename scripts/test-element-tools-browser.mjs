/** Real mouse/touch DnD QA. Run against dev, built output or a Vercel URL.
 * No authentication bypass or application-state stubs. iPad = browser emulation,
 * not a claim of physical Safari/Apple Pencil hardware coverage. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "playwright";
const base = process.env.TOOLS_TEST_URL || "http://127.0.0.1:8080";
const output = "screenshots/editor-focused";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const checks = [],
  errors = [];
const ids = [
  "shapes",
  "icons",
  "dividers",
  "indicators",
  "tables",
  "templates",
];
try {
  for (const mode of ["desktop", "ipad-portrait", "ipad-landscape"]) {
    const ctx = await browser.newContext(
      mode === "desktop"
        ? { viewport: { width: 1440, height: 1000 } }
        : {
            ...devices["iPad Pro 11"],
            viewport:
              mode === "ipad-portrait"
                ? { width: 834, height: 1194 }
                : { width: 1194, height: 834 },
          },
    );
    await ctx.addInitScript(() =>
      localStorage.setItem("nasaq.onboarding.v1", "done"),
    );
    const page = await ctx.newPage();
    page.on("pageerror", (error) => errors.push(`${mode}: ${error.message}`));
    await page.goto(`${base}/editor`);
    const tab = page.getByRole("tab", { name: "أدوات العناصر", exact: true });
    const libraryToggle = page.getByRole("button", {
      name: /^(فتح|إغلاق) المكتبة$/,
    });
    await libraryToggle.waitFor({ state: "visible" });
    if (!(await tab.isVisible())) await libraryToggle.click();
    await tab.click();
    const sections = page.locator("[data-sortable-section]");
    await sections.first().waitFor();
    assert.equal(await sections.count(), 6);
    const order = () =>
      sections.evaluateAll((els) =>
        els.map((el) => el.dataset.sortableSection),
      );
    for (const id of ids) {
      const toggle = page.locator(
        `[data-sortable-section="${id}"] .editor-accordion-header`,
      );
      if ((await toggle.getAttribute("aria-expanded")) === "true")
        await toggle.click();
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.ok(
        await page
          .locator(`[data-sortable-section="${id}"] .editor-accordion-body`)
          .isVisible(),
      );
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    }
    checks.push(`${mode}: six sections open/close`);
    const handle = (id) => page.locator(`[data-section-handle="${id}"]`);
    const scrollTop = () =>
      page
        .locator(".element-tools-panel")
        .evaluate((el) => (el.closest(".editor-pane-scroll").scrollTop = 0));
    const drag = async (id, destination, cancel = false) => {
      await handle(id).scrollIntoViewIfNeeded();
      const source = await handle(id).boundingBox();
      const target = await handle(destination).boundingBox();
      const x = source.x + source.width / 2,
        y = source.y + source.height / 2;
      const targetY = target.y + target.height - 3;
      const cdp = mode === "desktop" ? null : await ctx.newCDPSession(page);
      if (cdp) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        for (let step = 1; step <= 12; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y: y + ((targetY - y) * step) / 12 }],
          });
          await page.waitForTimeout(20);
        }
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, targetY, { steps: 12 });
      }
      await page.locator(".section-drag-ghost").waitFor();
      assert.equal(await page.locator(".section-drop-placeholder").count(), 1);
      const ghost = await page.locator(".section-drag-ghost").boundingBox();
      const panel = await page
        .locator(".element-tools-panel")
        .evaluate((el) => {
          const r = el.closest(".editor-pane-scroll").getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        });
      assert.ok(
        ghost.x >= panel.left - 1 &&
          ghost.x + ghost.width <= panel.right + 1 &&
          ghost.y >= panel.top &&
          ghost.y + ghost.height <= panel.bottom,
      );
      await page.screenshot({ path: `${output}/${mode}-drag.png` });
      if (cancel) await page.keyboard.press("Escape");
      if (cdp) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      } else await page.mouse.up();
      await page.locator(".section-drag-ghost").waitFor({ state: "detached" });
    };
    await scrollTop();
    await drag("shapes", "indicators");
    assert.notEqual((await order())[0], "shapes");
    checks.push(
      `${mode}: collapsed ${mode === "desktop" ? "mouse" : "touch"} drag + ghost + placeholder + containment`,
    );
    // Keyboard order is real DOM order and is persisted as well.
    await handle("shapes").focus();
    await page.keyboard.press("Home");
    assert.equal((await order())[0], "shapes");
    await page
      .locator('[data-sortable-section="shapes"] .editor-accordion-header')
      .click();
    await scrollTop();
    await drag("shapes", "dividers");
    assert.notEqual((await order())[0], "shapes");
    checks.push(`${mode}: expanded section drag`);
    const beforeCancel = await order();
    await scrollTop();
    await drag(beforeCancel[0], "shapes", true);
    assert.deepEqual(await order(), beforeCancel);
    assert.equal(
      await page
        .locator('[data-sortable-section="shapes"] .editor-accordion-header')
        .getAttribute("aria-expanded"),
      "true",
    );
    await page.reload();
    await libraryToggle.waitFor({ state: "visible" });
    if (!(await tab.isVisible())) await libraryToggle.click();
    await tab.click();
    assert.deepEqual(await order(), beforeCancel);
    assert.equal(
      await page
        .locator('[data-sortable-section="shapes"] .editor-accordion-header')
        .getAttribute("aria-expanded"),
      "true",
    );
    checks.push(
      `${mode}: Escape rollback; order and expansion restored after reload`,
    );
    await page.screenshot({ path: `${output}/${mode}-light.png` });
    await page.evaluate(() => {
      localStorage.setItem("nasaq-theme", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "nasaq-theme" }));
    });
    await page.locator(".editor-dark").waitFor();
    await page.screenshot({ path: `${output}/${mode}-dark.png` });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.getByRole("tab", { name: "المكتبة", exact: true }).click();
    assert.equal(await sections.count(), 0);
    assert.ok(await page.getByPlaceholder("بحث في المكتبة…").isVisible());
    assert.ok(await page.getByText("إضافة مجلد", { exact: true }).isVisible());
    checks.push(
      `${mode}: library remains files/folders only; light/dark; no horizontal overflow`,
    );
    if (mode === "desktop") {
      await tab.click();
      await handle("shapes").focus();
      await page.keyboard.press("Home");
      for (const id of ids) {
        const toggle = page.locator(
          `[data-sortable-section="${id}"] .editor-accordion-header`,
        );
        if ((await toggle.getAttribute("aria-expanded")) !== "true")
          await toggle.click();
      }
      await handle("shapes").scrollIntoViewIfNeeded();
      const source = await handle("shapes").boundingBox();
      const bounds = await page
        .locator(".element-tools-panel")
        .evaluate((el) => {
          const rect = el
            .closest(".editor-pane-scroll")
            .getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom };
        });
      const before = await order();
      const readScroll = () =>
        page
          .locator(".element-tools-panel")
          .evaluate((el) => el.closest(".editor-pane-scroll").scrollTop);
      const startScroll = await readScroll();
      await page.mouse.move(source.x + 22, source.y + 22);
      await page.mouse.down();
      await page.mouse.move(source.x + 22, bounds.bottom - 8, { steps: 20 });
      await page.waitForTimeout(1400);
      assert.ok(
        (await readScroll()) > startScroll + 200,
        "edge scrolling must not stall against the panel's smooth-scroll CSS",
      );
      await page.mouse.move(-100, -100);
      await page.waitForTimeout(100);
      const ghost = await page.locator(".section-drag-ghost").boundingBox();
      assert.ok(
        ghost.x >= bounds.left && ghost.x + ghost.width <= bounds.right,
      );
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.deepEqual(await order(), before);
      await page.evaluate(() => {
        Storage.prototype.setItem = () => {
          throw new DOMException("Test quota", "QuotaExceededError");
        };
      });
      await handle("shapes").focus();
      await page.keyboard.press("End");
      assert.equal((await order()).at(-1), "shapes");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.keyboard.press("Home");
      assert.equal((await order())[0], "shapes");
      checks.push(
        "desktop: edge auto-scroll with all sections open, offscreen-pointer containment, blocked storage and reduced motion",
      );
    }
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ base, checks, errors }, null, 2));
} finally {
  await browser.close();
}
