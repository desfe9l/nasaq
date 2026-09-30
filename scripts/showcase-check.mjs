import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium2",
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "ar" });
const log = (...a) => console.log(...a);

// 1. official template in showcase mode
await page.goto("http://127.0.0.1:8080/editor?template=official&showcase=1", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4500);
const state1 = await page.evaluate(() => {
  const stage = document.querySelector(".editor-canvas-stage");
  const els = stage ? stage.querySelectorAll(".canvas-el").length : -1;
  const tour = !!document.querySelector(".onboarding-tour, [data-tour-root]");
  const docName = document.querySelector(".editor-doc-title, [data-tour='doc-title']")?.textContent || "";
  // count buttons in the header actions zone
  const headerBtns = [...document.querySelectorAll(".editor-header-actions button")].map((b) => b.getAttribute("aria-label") || b.title || b.textContent?.trim().slice(0, 12));
  return { els, tour, docName, headerBtns };
});
log("OFFICIAL SHOWCASE:", JSON.stringify(state1));
await page.screenshot({ path: "/tmp/circ/30-showcase-official.png" });

// 2. edit: drag a text element, then reload and confirm it's pristine
const before = await page.evaluate(() => {
  const stage = document.querySelector(".editor-canvas-stage");
  const el = stage.querySelector(".canvas-el[data-el-type='text']");
  const st = el.getAttribute("style") || "";
  const m = st.match(/left:\s*([^;]+)/);
  return m ? m[1] : "?";
});
// select & nudge the first text element
const t = await page.locator(".canvas-el[data-el-type='text']").first().boundingBox();
if (t) {
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  await page.waitForTimeout(300);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) { await page.mouse.move(t.x + t.width / 2 + i * 6, t.y + t.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up();
  await page.waitForTimeout(1500);
}
const after = await page.evaluate(() => {
  const stage = document.querySelector(".editor-canvas-stage");
  const el = stage.querySelector(".canvas-el[data-el-type='text']");
  const st = el.getAttribute("style") || "";
  const m = st.match(/left:\s*([^;]+)/);
  return m ? m[1] : "?";
});
log("EDIT: text left before =", before, " after drag =", after, " moved =", before !== after);

// storage writes? list localStorage keys (the app's UI/settings slots)
const storage1 = await page.evaluate(() => Object.keys(localStorage));
log("STORAGE after edit:", JSON.stringify(storage1));

// 3. reload → must be pristine (same as before)
await page.reload({ waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4500);
const after2 = await page.evaluate(() => {
  const stage = document.querySelector(".editor-canvas-stage");
  const el = stage.querySelector(".canvas-el[data-el-type='text']");
  const st = el.getAttribute("style") || "";
  const m = st.match(/left:\s*([^;]+)/);
  return m ? m[1] : "?";
});
log("AFTER RELOAD: text left =", after2, " pristine =", before === after2);

// 4. slides template
await page.goto("http://127.0.0.1:8080/editor?template=slides&showcase=1", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4500);
const slides = await page.evaluate(() => {
  const pg = document.querySelector(".report-page");
  const r = pg ? pg.getBoundingClientRect() : null;
  return r ? { w: +r.width.toFixed(0), h: +r.height.toFixed(0), ratio: +(r.width / r.height).toFixed(3) } : null;
});
log("SLIDES SHOWCASE page ratio (expect ~1.778):", JSON.stringify(slides));
await page.screenshot({ path: "/tmp/circ/31-showcase-slides.png" });
await browser.close();
