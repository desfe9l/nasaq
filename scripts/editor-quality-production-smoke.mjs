import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

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
        // The first document is opaque; the editor route has local storage.
      }
    });

    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    await page.goto(`${base}/editor`, { waitUntil: "networkidle" });

    const toolbar = page.locator(".editor-toolbar");
    const canvas = page.locator(".editor-canvas-stage");
    await toolbar.waitFor({ state: "visible" });
    await canvas.waitFor({ state: "visible" });
    await page.locator(".editor-canvas-stage [data-page-id]").first().waitFor();
    await page.locator(".editor-canvas-stage [data-el-id]").first().waitFor();

    assert.ok((await toolbar.boundingBox()).height > 0);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `editor overflows horizontally at ${width}px`,
    );
    await page.screenshot({ path: `${output}/editor-${width}.png` });
    console.log(
      `PASS production editor ${width}x${height}: toolbar, artboard, editable content, no horizontal overflow`,
    );
    await context.close();
  }

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
