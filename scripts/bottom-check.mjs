import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium2",
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "ar" });
await page.goto("http://127.0.0.1:8080/editor?template=official&showcase=1", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(5000);
// 1. default state: actions hidden
await page.screenshot({ path: "/tmp/circ/60-bottom-after.png", clip: { x: 0, y: 680, width: 1600, height: 320 } });
// 2. hover a thumbnail: actions revealed
const item = page.locator(".page-rail-item").nth(2);
const b = await item.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.waitForTimeout(400);
const vis = await page.evaluate(() => {
  const items = [...document.querySelectorAll(".page-rail-item")];
  return items.map((it) => getComputedStyle(it.querySelector(".page-rail-actions")).opacity);
});
console.log("actions opacity (expect mostly 0, hovered 1):", JSON.stringify(vis));
await page.screenshot({ path: "/tmp/circ/61-bottom-hover.png", clip: { x: 0, y: 680, width: 1600, height: 320 } });
// 3. dock close-up with separator
const dock = await page.locator(".studio-tool-dock").boundingBox();
await page.screenshot({ path: "/tmp/circ/62-dock-after.png", clip: { x: Math.max(0, dock.x - 20), y: Math.max(0, dock.y - 90), width: Math.min(1600, dock.width + 60), height: dock.height + 110 } });
await browser.close();
console.log("done");
