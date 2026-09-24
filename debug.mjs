import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// Get page HTML
const html = await page.content();
console.log("=== PAGE TITLE ===");
const title = await page.title();
console.log(title);

// Check for left panel
const leftPanel = await page.$('aside.border-l');
console.log("Left panel:", leftPanel ? "FOUND" : "NOT FOUND");

if (leftPanel) {
  const tabs = await leftPanel.$$('button[role="tab"], .flex.gap-0\\.5 button');
  console.log("Tabs count:", tabs.length);
  for (let i = 0; i < tabs.length; i++) {
    const text = await tabs[i].textContent();
    console.log(`Tab ${i}: "${text}"`);
  }
}

// Check right panel
const rightPanel = await page.$('aside.border-r');
console.log("Right panel:", rightPanel ? "FOUND" : "NOT FOUND");

if (rightPanel) {
  const body = await rightPanel.$('.editor-panel-body, [class*="editor-pane-scroll"]');
  if (body) {
    const text = await body.textContent();
    console.log("Right panel body (first 200):", text?.slice(0, 200));
  }
}

await browser.close();