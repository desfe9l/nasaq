/** Visual/component-state test using the actual AccountBadge on the dev server.
 * Tier fixtures test rendering only, never grant a license or modify auth. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("screenshots/editor-focused", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 650 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    `${process.env.TOOLS_TEST_URL || "http://127.0.0.1:8080"}/editor`,
  );
  await page.getByRole("button", { name: /^(فتح|إغلاق) المكتبة$/ }).waitFor();
  await page.evaluate(async () => {
    const {
      default: { createElement: h },
    } = await import("/node_modules/.vite/deps/react.js");
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { AccountBadge } =
      await import("/src/components/site/AccountBadge.tsx");
    const { NasaqPremiumMark } =
      await import("/src/components/site/NasaqPremiumMark.tsx");
    const host = document.createElement("div");
    host.id = "premium-qa";
    host.style.cssText =
      "position:fixed;inset:0;z-index:99999;padding:48px;background:white;color:#172033;font-family:Arial";
    host.dir = "rtl";
    document.body.append(host);
    createRoot(host).render(
      h(
        "div",
        null,
        h(
          "h1",
          { style: { fontSize: 22, marginBottom: 28 } },
          "NASAQ · علامة الترخيص — فحص المكوّن الفعلي",
        ),
        ...["LICENSED", "ADMIN", "FREE", "SUSPENDED", "LOADING"].map((tier) =>
          h(
            "div",
            {
              key: tier,
              "data-tier": tier,
              style: {
                display: "flex",
                gap: 16,
                alignItems: "center",
                marginBottom: 20,
              },
            },
            h("span", null, `اسم المستخدم · ${tier}`),
            h(AccountBadge, { tier }),
            h(AccountBadge, { tier, compact: true }),
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              gap: 28,
              alignItems: "center",
              marginTop: 40,
              color: "#00874a",
            },
          },
          ...[12, 16, 20, 24, 32, 48].map((size) =>
            h(
              "div",
              { key: size },
              h(NasaqPremiumMark, {
                width: size,
                height: size,
                "data-size": size,
              }),
              h(
                "span",
                { style: { display: "block", marginTop: 12 } },
                `${size}px`,
              ),
            ),
          ),
        ),
      ),
    );
  });
  await page
    .locator('[data-tier="LICENSED"] svg[data-nasaq-premium]')
    .first()
    .waitFor();
  for (const tier of ["LICENSED", "ADMIN"])
    assert.equal(
      await page
        .locator(`[data-tier="${tier}"] svg[data-nasaq-premium]`)
        .count(),
      2,
    );
  for (const tier of ["FREE", "SUSPENDED", "LOADING"])
    assert.equal(
      await page
        .locator(`[data-tier="${tier}"] svg[data-nasaq-premium]`)
        .count(),
      0,
    );
  for (const size of [12, 16, 20, 24, 32, 48]) {
    const rect = await page.locator(`[data-size="${size}"]`).boundingBox();
    assert.equal(rect.width, size);
    assert.equal(rect.height, size);
  }
  await page.screenshot({
    path: "screenshots/editor-focused/premium-light.png",
  });
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    Object.assign(document.querySelector("#premium-qa").style, {
      background: "#161c26",
      color: "#f1f5f9",
    });
  });
  await page.screenshot({
    path: "screenshots/editor-focused/premium-dark.png",
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual AccountBadge LICENSED/ADMIN vs FREE/SUSPENDED/LOADING, compact/full, 12–48px, light/dark. Fixtures only; not real account verification.",
  );
} finally {
  await browser.close();
}
