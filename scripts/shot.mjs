import { chromium } from "playwright";

const url = process.argv[2];
const out = process.argv[3] || "/tmp/shot";
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 900);
const waitMs = Number(process.argv[6] || 2500);
const fullPage = process.argv[7] === "full";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium2",
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});
const page = await browser.newPage({ viewport: { width, height }, locale: "ar" });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: `${out}.png`, fullPage });
console.log("saved", `${out}.png`, fullPage ? "(full page)" : "(viewport)");
await browser.close();
