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
    await page.locator(".editor-canvas-stage [data-el-id]").first().click();
    const toolbar = page.locator(".floating-toolbar");
    await toolbar.waitFor({ state: "visible" });
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
