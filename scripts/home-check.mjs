import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium2",
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "ar" });
const log = (...a) => console.log(...a);
await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(6000);
const state = await page.evaluate(() => {
  const frame = document.querySelector('iframe[title^="معاينة حية"]');
  return {
    iframe: !!frame,
    src: frame ? frame.getAttribute("src") : null,
    h: frame ? Math.round(frame.getBoundingClientRect().height) : 0,
    w: frame ? Math.round(frame.getBoundingClientRect().width) : 0,
  };
});
log("IFRAME:", JSON.stringify(state));
// wait for the editor to boot inside the frame
try {
  const frame = page.frameLocator('iframe[title^="معاينة حية"]');
  await frame.locator(".editor-canvas-stage").first().waitFor({ timeout: 30000 });
  const els = await frame.locator(".canvas-el").count();
  log("EDITOR inside iframe: booted, elements =", els);
} catch {
  log("EDITOR inside iframe: FAILED to boot");
}
await page.screenshot({ path: "/tmp/circ/40-home-hero.png" });
// switch to the slides tab
await page.getByRole("tab", { name: "عرض تقديمي" }).click();
await page.waitForTimeout(9000);
try {
  const frame = page.frameLocator('iframe[title^="معاينة حية"]');
  await frame.locator(".report-page").first().waitFor({ timeout: 30000 });
  const r = await frame.locator(".report-page").first().boundingBox();
  log("SLIDES frame ratio:", r ? (r.width / r.height).toFixed(3) : "?");
} catch { log("slides frame failed"); }
await page.screenshot({ path: "/tmp/circ/41-home-hero-slides.png" });
// full page scroll screenshot for the section order
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);
const sections = await page.evaluate(() =>
  [...document.querySelectorAll("main section, main > div")].map((s) => {
    const h = s.querySelector("h1, h2, figcaption");
    return h ? h.textContent.trim().slice(0, 40) : s.className.slice(0, 30);
  })
);
log("SECTIONS:", JSON.stringify(sections, null, 0));
await browser.close();
