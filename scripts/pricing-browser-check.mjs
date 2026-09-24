// Browser regression for all three billing choices; no checkout requests are made.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const base = process.env.PRICING_TEST_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--no-sandbox"],
});
mkdirSync("screenshots", { recursive: true });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/purchase`, { waitUntil: "networkidle" });
    const pro = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Pro — فردي", exact: true }),
      });
    const team = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Team — فريق", exact: true }),
      });
    const free = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "Free — مجاني", exact: true }),
      });
    for (const [label, a, b] of [
      ["شهري", "79", "199"],
      ["3 أشهر — أفضل قيمة", "199", "499"],
      ["سنوي", "699", "1,799"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      assert.match(await pro.innerText(), new RegExp(a));
      assert.match(await team.innerText(), new RegExp(b));
      assert.match(await free.innerText(), /0 ر.س/);
      assert.equal(await free.getByRole("button").count(), 0);
      assert.equal(
        await free
          .getByRole("link", { name: "ابدأ مجانًا" })
          .getAttribute("href"),
        "/editor",
      );
    }
    await page
      .getByRole("button", { name: "3 أشهر — أفضل قيمة", exact: true })
      .click();
    assert.match(await pro.innerText(), /وفّر 38/);
    assert.match(await team.innerText(), /وفّر 98/);
    assert.equal(
      await page
        .getByRole("button", { name: "الدفع قريبًا", exact: true })
        .count(),
      2,
    );
    assert.ok(await pro.getByRole("button").isDisabled());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `screenshots/pricing-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      `PASS pricing ${width}px: all prices, savings, permanent Free, unavailable checkout, no page errors`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
