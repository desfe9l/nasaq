// Browser check for the homepage pricing section: the billing switch, the two
// purchase actions, and the Pro ribbon. No payment is ever completed — the
// checkout tab is read for its URL and closed.
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
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto(base, { waitUntil: "networkidle" });
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: "اختر الخطة المناسبة" }),
    });
    assert.equal(await section.count(), 1, "قسم الخطط موجود مرة واحدة");

    const card = (name) =>
      section.locator("article").filter({ hasText: name });

    const free = card("مجاني");
    const pro = card("فردي — Pro");
    const team = card("فريق — Team");

    // 1. Monthly by default: catalog prices + monthly durations.
    assert.match(await pro.innerText(), /79/);
    assert.match(await pro.innerText(), /شهرياً/);
    assert.match(await pro.innerText(), /30 يومًا/);
    assert.match(await team.innerText(), /199/);
    assert.match(await team.innerText(), /30 يومًا/);
    assert.match(await free.innerText(), /0/);
    assert.match(await free.innerText(), /دائمًا/);

    // 3. The Pro card wears the ribbon.
    assert.equal(await section.getByText("الأكثر شعبية").count(), 1);
    assert.ok((await pro.innerText()).includes("الأكثر شعبية"));
    assert.equal((await team.innerText()).includes("الأكثر شعبية"), false);

    // 2. The switcher moves every amount and duration at once.
    await section.getByRole("button", { name: /3 أشهر/ }).click();
    assert.match(await pro.innerText(), /199/);
    assert.match(await pro.innerText(), /90 يومًا/);
    assert.match(await pro.innerText(), /وفّر 38/);
    assert.match(await team.innerText(), /499/);
    assert.match(await team.innerText(), /90 يومًا/);
    assert.match(await team.innerText(), /وفّر 98/);
    assert.match(await free.innerText(), /0/);
    assert.equal(
      await section
        .getByRole("button", { name: /3 أشهر/ })
        .getAttribute("aria-pressed"),
      "true",
    );

    // Back to monthly — the prices return, no stale 90-day term survives.
    await section.getByRole("button", { name: "شهري", exact: true }).click();
    assert.match(await pro.innerText(), /79/);
    assert.match(await pro.innerText(), /30 يومًا/);

    // 2. A paid card's action opens the tier's checkout (read, never paid).
    const [checkout] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15000 }),
      pro.getByRole("button", { name: "اشترك الآن" }).click(),
    ]);
    const url = new URL(checkout.url());
    assert.equal(url.hostname, "nasaqar.gumroad.com");
    assert.match(url.search, /variant=/);
    await checkout.close();

    // 2. The whole card is a target, not just its button.
    const [fromCard] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15000 }),
      team.locator("h3").click(),
    ]);
    assert.match(new URL(fromCard.url()).search, /variant=/);
    await fromCard.close();

    // 2. «ابدأ مجانًا» enters the product instead of the payment page.
    await free.getByRole("button", { name: "ابدأ مجانًا" }).click();
    await page.waitForURL(/\/(demo|editor)$/, { timeout: 15000 });

    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.deepEqual(errors, []);

    await page.goto(base, { waitUntil: "networkidle" });
    await page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "اختر الخطة المناسبة" }) })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `screenshots/home-pricing-${width}.png`,
      fullPage: false,
    });
    console.log(`PASS home pricing ${width}px: switcher, ribbon, actions, no errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
