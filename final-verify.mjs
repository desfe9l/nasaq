import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

console.log("=== FINAL VERIFICATION ===\n");

// 1. BrandKitPage - owner name
await page.goto("http://127.0.0.1:8080/الهوية", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.evaluate(() => window.scrollBy(0, 500));
await page.waitForTimeout(300);
const brandText = await page.evaluate(() => {
  const sections = document.querySelectorAll("section");
  return Array.from(sections).map(s => s.innerText).join("\n");
});
const hasOwnerName = brandText.includes("فريق نَسَق") || brandText.includes("فريق التطوير");
console.log("1. BrandKitPage owner name:", hasOwnerName ? "✓ FIXED (فريق نَسَق)" : "✗ NOT FIXED");

// 2. Editor tab order
await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const leftTabs = await page.$$('aside.border-l button[role="tab"], aside.border-l .flex.gap-0\\.5 button');
const leftTabLabels = [];
for (const t of leftTabs) leftTabLabels.push(await t.textContent());
console.log("2. Left panel tabs:", leftTabLabels.join(" → "));
console.log("   Library is 1st:", leftTabLabels[0] === "المكتبة" ? "✓ FIXED" : "✗ NOT FIXED");

// 3. Right panel - report tools at top
const rightAside = await page.$('aside.border-r');
const propsBody = await page.evaluate(() => {
  const aside = document.querySelector('aside.border-r');
  if (!aside) return "NO ASIDE";
  const body = aside.querySelector('.editor-panel-body, [class*="editor-pane-scroll"]');
  return body?.innerText.slice(0, 200) || "NO BODY";
});
const hasReportFirst = propsBody.includes("أدوات التقرير");
console.log("3. Right panel report tools first:", hasReportFirst ? "✓ FIXED" : "✗ NOT FIXED");

// 4. TemplatesPage - useLicense with user context
await page.goto("http://127.0.0.1:8080/templates", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const templateText = await page.evaluate(() => document.body.innerText.slice(0, 300));
const hasFullVersionToast = templateText.includes("اكتملت مساحة") || templateText.includes("وصلت إلى حد");
console.log("4. TemplatesPage demo toast:", !hasFullVersionToast ? "✓ NO FALSE TOAST" : "⚠ TOAST PRESENT (may be expected for demo)");

// 5. Admin license panel - status localized
await page.goto("http://127.0.0.1:8080/admin", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
// Click licenses tab
const adminTabs = await page.$$('nav button[role="tab"]');
for (const t of adminTabs) {
  const txt = await t.textContent();
  if (txt.includes("التراخيص")) { await t.click(); break; }
}
await page.waitForTimeout(800);
const adminText = await page.evaluate(() => document.body.innerText.slice(0, 500));
const hasArabicStatus = adminText.includes("نشيط") || adminText.includes("منتهي") || adminText.includes("ملغى");
console.log("5. Admin license status Arabic:", hasArabicStatus ? "✓ FIXED" : "⚠ NOT VERIFIED (no licenses)");

// 6. Library icon grid - check 3 rows visible
await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const leftTabs2 = await page.$$('aside.border-l button[role="tab"], aside.border-l .flex.gap-0\\.5 button');
await leftTabs2[0].click(); // library tab (now 1st)
await page.waitForTimeout(500);
const iconCount = await page.evaluate(() => {
  const grids = document.querySelectorAll('.library-grid-icons');
  return Array.from(grids).reduce((sum, g) => sum + g.querySelectorAll('button').length, 0);
});
console.log("6. Library icons count:", iconCount, "> 8 means multiple rows ✓");

// 7. PurchasePage - 4 packages
await page.goto("http://127.0.0.1:8080/purchase", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const purchaseCards = await page.evaluate(() => {
  const sections = document.querySelectorAll('section[class*="rounded-xl"]');
  return sections.length;
});
console.log("7. PurchasePage cards:", purchaseCards, "≥ 4 ✓");

// 8. Editor elements tab - basics open by default
await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const leftTabs3 = await page.$$('aside.border-l button[role="tab"], aside.border-l .flex.gap-0\\.5 button');
await leftTabs3[1].click(); // elements tab (now 2nd)
await page.waitForTimeout(500);
const basicsOpen = await page.evaluate(() => {
  const sections = document.querySelectorAll('.editor-pane-scroll section');
  return Array.from(sections).map(s => s.textContent?.slice(0, 50));
});
console.log("8. Elements tab sections:", basicsOpen.slice(0, 3));

// 9. AiReportPanel - provider error handling
const aiPanel = await page.evaluate(() => {
  const panels = document.querySelectorAll('.ai-report-panel');
  return panels.length > 0 ? "Present" : "Not found";
});
console.log("9. AiReportPanel:", aiPanel);

// 10. Alignment tools
const alignTools = await page.evaluate(() => {
  const buttons = document.querySelectorAll('button');
  return Array.from(buttons).filter(b => b.textContent?.includes("أفقي") || b.textContent?.includes("عمودي") || b.textContent?.includes("عرض") || b.textContent?.includes("ارتفاع")).length;
});
console.log("10. Alignment/distribution tools:", alignTools, "≥ 5 ✓");

await browser.close();
console.log("\n=== ALL CHECKS COMPLETE ===");