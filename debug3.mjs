import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// Get page body
const body = await page.$('body');
const bodyHtml = await body?.innerHTML();
console.log("Body HTML length:", bodyHtml?.length);
console.log("Body HTML (first 5000):", bodyHtml?.slice(0, 5000));

await browser.close();