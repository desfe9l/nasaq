import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

// UI-only smoke: no Vite source imports or test-only application globals.
const base = process.env.BASE_URL || "http://localhost:8081";
const output = ".cache/editor-quality/production";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox"],
});
const errors = [];
try {
  for (const [width, height] of [
    [1920, 1080],
    [768, 1024],
    [375, 812],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 1100,
    });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("nasaq.onboarding.v1", "done");
      } catch {
        // The script also runs in the initial opaque about:blank document.
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await page.goto(`${base}/editor`, { waitUntil: "networkidle" });
    await page.locator(".editor-canvas-stage").waitFor();
    const dock = page.locator(".studio-tool-dock");
    await dock.waitFor();
    const dragDock = async (type) => {
      const before = await dock.boundingBox();
      const bounds = await dock.evaluate((node) => node.parentElement.getBoundingClientRect().toJSON());
      assert.ok(before.height <= 68, `main dock height is ${before.height}px at ${width}px`);
      const leftRoom = before.x - bounds.left;
      const rightRoom = bounds.right - before.x - before.width;
      const topRoom = before.y - bounds.top;
      const bottomRoom = bounds.bottom - before.y - before.height;
      const dx = rightRoom >= leftRoom ? Math.min(16, rightRoom) : -Math.min(16, leftRoom);
      const dy = bottomRoom >= topRoom ? Math.min(16, bottomRoom) : -Math.min(16, topRoom);
      assert.ok(dx !== 0 || dy !== 0, "main dock has no available drag lane");
      const grip = dock.locator(".editor-dock-grip");
      const gripBox = await grip.boundingBox();
      const start = { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 };
      const samples = [];

      if (type === "mouse") {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let step = 1; step <= 4; step++) {
          await page.mouse.move(start.x + dx * step / 4, start.y + dy * step / 4);
          await page.waitForTimeout(16);
          samples.push(await dock.boundingBox());
        }
        await page.mouse.up();
      } else {
        const cdp = await context.newCDPSession(page);
        await page.evaluate(() => {
          window.__dockPointerTypes = [];
          document.querySelector(".editor-dock-grip").addEventListener(
            "pointerdown",
            (event) => window.__dockPointerTypes.push(event.pointerType),
            { once: true },
          );
        });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ id: 1, x: start.x, y: start.y, radiusX: 3, radiusY: 3, force: 1 }],
        });
        for (let step = 1; step <= 4; step++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ id: 1, x: start.x + dx * step / 4, y: start.y + dy * step / 4, radiusX: 3, radiusY: 3, force: 1 }],
          });
          await page.waitForTimeout(16);
          samples.push(await dock.boundingBox());
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        assert.deepEqual(await page.evaluate(() => window.__dockPointerTypes), ["touch"]);
        await cdp.detach();
      }

      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(samples.every((rect) =>
        Math.abs(rect.width - before.width) < 0.5 && Math.abs(rect.height - before.height) < 0.5,
      ), `main dock changed size during ${type} drag: ${JSON.stringify(samples)}`);
      const after = await dock.boundingBox();
      assert.ok(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) > 2);
      assert.ok(
        Math.abs(after.x - before.x - dx) < 2 && Math.abs(after.y - before.y - dy) < 2,
        `dock drag mismatch: ${JSON.stringify({ before, bounds, dx, dy, after })}`,
      );
      assert.ok(Math.abs(after.width - before.width) < 0.5 && Math.abs(after.height - before.height) < 0.5);
      const position = await dock.evaluate((node) => ({
        left: Number.parseFloat(node.style.left),
        top: Number.parseFloat(node.style.top),
        bottom: node.style.bottom,
        inlineStart: node.style.insetInlineStart,
        slot: node.parentElement.getBoundingClientRect().toJSON(),
      }));
      assert.ok(Math.abs(position.left - (after.x - position.slot.left)) < 0.5);
      assert.ok(Math.abs(position.top - (after.y - position.slot.top)) < 0.5);
      assert.equal(position.bottom, "auto");
      assert.equal(position.inlineStart, "auto");
    };

    await dragDock("mouse");
    if (width < 1100) await dragDock("touch");
    const expandedDock = await dock.boundingBox();
    await dock.getByRole("button", { name: "تصغير شريط الأدوات", exact: true }).click();
    const collapsedDock = await dock.boundingBox();
    assert.ok(collapsedDock.width < expandedDock.width);
    assert.ok(collapsedDock.height <= 68, `collapsed main dock is ${collapsedDock.height}px high`);
    await dock.getByRole("button", { name: "توسيع شريط الأدوات", exact: true }).click();
    const reopenedDock = await dock.boundingBox();
    assert.ok(Math.abs(reopenedDock.width - expandedDock.width) < 0.5);
    assert.ok(Math.abs(reopenedDock.height - expandedDock.height) < 0.5);
    if (width >= 1100) {
      const beforeZoom = await dock.boundingBox();
      await page.locator(".editor-canvas-stage").hover();
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -120);
      await page.keyboard.up("Control");
      await page.waitForTimeout(120);
      const afterZoom = await dock.boundingBox();
      assert.ok(Math.abs(afterZoom.width - beforeZoom.width) < 0.5);
      assert.ok(Math.abs(afterZoom.height - beforeZoom.height) < 0.5);
    }
    await page.locator(".editor-canvas-stage [data-el-id]").first().click();
    const toolbar = page.locator(".floating-toolbar");
    await toolbar.waitFor({ state: "visible" });
    await toolbar.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const grip = toolbar.locator(".floating-toolbar-grip");
    const initialToolbar = await toolbar.boundingBox();
    const initialGrip = await grip.boundingBox();
    const viewport = page.viewportSize();
    const leftRoom = initialToolbar.x - 8;
    const rightRoom = viewport.width - initialToolbar.x - initialToolbar.width - 8;
    const topRoom = initialToolbar.y - 8;
    const bottomRoom = viewport.height - initialToolbar.y - initialToolbar.height - 8;
    const dx = rightRoom >= leftRoom ? Math.min(12, rightRoom) : -Math.min(12, leftRoom);
    const dy = bottomRoom >= topRoom ? Math.min(10, bottomRoom) : -Math.min(10, topRoom);
    assert.ok(Math.abs(dx) + Math.abs(dy) > 1, "toolbar has a drag lane");
    const gripStart = {
      x: initialGrip.x + initialGrip.width / 2,
      y: initialGrip.y + initialGrip.height / 2,
    };
    const dragSamples = [];
    await page.mouse.move(gripStart.x, gripStart.y);
    await page.mouse.down();
    for (let step = 1; step <= 4; step++) {
      await page.mouse.move(
        gripStart.x + dx * step / 4,
        gripStart.y + dy * step / 4,
      );
      await page.waitForTimeout(16);
      dragSamples.push(await toolbar.evaluate((node) => ({
        rect: node.getBoundingClientRect().toJSON(),
        animation: getComputedStyle(node).animationName,
      })));
    }
    await page.mouse.up();
    assert.ok(dragSamples.every(({ rect, animation }) =>
      Math.abs(rect.width - initialToolbar.width) < 0.5 &&
      Math.abs(rect.height - initialToolbar.height) < 0.5 &&
      animation === "none",
    ), `toolbar changed geometry or animated while dragging: ${JSON.stringify(dragSamples)}`);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const movedToolbar = await toolbar.boundingBox();
    const movedGrip = await grip.boundingBox();
    const settledToolbar = await toolbar.evaluate((node) => ({
      rect: node.getBoundingClientRect().toJSON(),
      animation: getComputedStyle(node).animationName,
    }));
    assert.equal(settledToolbar.animation, "none");
    assert.ok(Math.abs(settledToolbar.rect.width - initialToolbar.width) < 0.5);
    assert.ok(Math.abs(settledToolbar.rect.height - initialToolbar.height) < 0.5);
    assert.ok(Math.abs(movedToolbar.x - initialToolbar.x) + Math.abs(movedToolbar.y - initialToolbar.y) > 1);
    assert.ok(movedToolbar.x >= 8 && movedToolbar.y >= 8);
    assert.ok(movedToolbar.x + movedToolbar.width <= viewport.width - 7);
    assert.ok(movedToolbar.y + movedToolbar.height <= viewport.height - 7);
    assert.ok(Math.abs(
      (movedGrip.x - movedToolbar.x) - (initialGrip.x - initialToolbar.x),
    ) < 0.5);
    const stroke = toolbar.getByRole("textbox", {
      name: "سماكة الحد بالبكسل",
      exact: true,
    });
    await stroke.fill("5");
    await stroke.press("Enter");
    assert.equal(Number(await stroke.inputValue()), 5);
    assert.ok((await toolbar.boundingBox()).height <= 44);
    await page.screenshot({ path: `${output}/editor-${width}.png` });
    await page.goto(`${base}/الهوية`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "شهادة تقدير", exact: true }).click();
    await page.getByLabel("اتجاه المستند").selectOption("a4-landscape");
    const paper = await page
      .locator("[data-brand-a4-preview] .tpl-paper")
      .boundingBox();
    assert.ok(Math.abs(paper.width / paper.height - 297 / 210) < 0.01);
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const premium = page.locator('section[aria-label="قوالب Premium"]');
    await premium.locator("summary").click();
    assert.equal(await premium.locator("details").getAttribute("open"), null);
    assert.equal(
      await page.locator('footer a[href*="pinterest.com"]').count(),
      1,
    );
    await page.screenshot({ path: `${output}/home-${width}.png` });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.goto(`${base}/templates/ats-resume-en`, {
      waitUntil: "networkidle",
    });
    await page.locator('img[alt="ATS Resume — English"]').waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `template detail overflows at ${width}px`,
    );
    assert.ok(
      await page.locator('img[alt="ATS Resume — English"]').evaluate(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    console.log(
      `PASS UI smoke ${width}×${height}: editor, stroke, template preview, identity, Premium and footer`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
