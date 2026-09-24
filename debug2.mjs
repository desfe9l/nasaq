import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);

// Get all aside elements
const asides = await page.$$('aside');
console.log("Aside count:", asides.length);
for (let i = 0; i < asides.length; i++) {
  const classes = await asides[i].getAttribute('class');
  console.log(`Aside ${i}: class="${classes}"`);
}

// Get all buttons with role="tab"
const tabs = await page.$$('button[role="tab"]');
console.log("Tab buttons:", tabs.length);
for (let i = 0; i < tabs.length; i++) {
  const text = await tabs[i].textContent();
  console.log(`Tab ${i}: "${text}"`);
}

// Check for .editor-pane-scroll
const panes = await page.$$('[class*="editor-pane-scroll"]');
console.log("Editor panes:", panes.length);

// Check for .library-grid-icons
const grids = await page.$$('.library-grid-icons');
console.log("Library grids:", grids.length);

await browser.close();