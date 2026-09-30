import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/tmp/chromium2",
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "ar" });
const log = (...a) => console.log(...a);
const shot = (n) => page.screenshot({ path: `/tmp/circ/${n}.png` });

await page.goto("http://127.0.0.1:8080/editor", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4000);
for (const label of ["تخطي", "المتابعة", "فهمت", "ابدأ", "إغلاق"]) {
  const btn = page.getByRole("button", { name: label, exact: false }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** Model geometry + TRUE screen corner (from the model, via the page rect). */
const model = async () =>
  page.evaluate(() => {
    const stage = document.querySelector(".editor-canvas-stage");
    const els = [...stage.querySelectorAll(".canvas-el[data-el-type='shape']")];
    const c = els.filter((e) => e.innerHTML.includes("<circle")).pop();
    if (!c) return null;
    const st = c.getAttribute("style") || "";
    const get = (k) => {
      const m = st.match(new RegExp(k + ":\\s*([^;]+)"));
      return m ? parseFloat(m[1]) : NaN;
    };
    const rot = (st.match(/rotate\((-?[\d.]+)deg\)/) || [])[1];
    const rotation = rot !== undefined ? parseFloat(rot) : 0;
    const x = get("left"), y = get("top"), w = get("width"), h = get("height");
    const pg = c.closest(".report-page").getBoundingClientRect();
    const size = { w: 210 };
    const pxPerMm = pg.width / size.w;
    // True SE corner in page mm, then screen px.
    const cx = x + w / 2, cy = y + h / 2;
    const rad = (rotation * Math.PI) / 180;
    const dx = w / 2, dy = h / 2;
    const seMm = {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
    return {
      x, y, w, h, rotation,
      cx, cy,
      se: { x: pg.left + seMm.x * pxPerMm, y: pg.top + seMm.y * pxPerMm },
      pageRect: { left: pg.left, top: pg.top, pxPerMm },
    };
  });

// Open shapes tab, add circle
await page.locator(".studio-tool-dock [data-tour='library']").click();
await page.waitForTimeout(500);
await page.locator(".editor-panel-tab[aria-label='أشكال']").click();
await page.waitForTimeout(500);
await page.locator("button.library-hit[title^='دائرة']").first().click();
await page.waitForTimeout(700);
await page.locator(".editor-panel-tab[aria-label='المكتبة']").click();
await page.waitForTimeout(400);

// Wait for the element to be on-screen (stage scroll settles)
for (let i = 0; i < 20; i++) {
  const m = await model();
  if (m && m.se.x > 100 && m.se.x < 1500 && m.se.y > 50 && m.se.y < 950) break;
  await page.waitForTimeout(300);
}
let m = await model();
log("ADDED (on screen):", JSON.stringify(m));
await shot("20-ready");

const drag = async (x0, y0, x1, y1, steps = 10) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
};

const rotateBy = async (deg) => {
  const m0 = await model();
  const rh = page.locator(".selection-frame .rotate-handle");
  const r = await rh.boundingBox();
  const rcx = r.x + r.width / 2;
  const rcy = r.y + r.height / 2;
  const steps = 10;
  const a0 = Math.atan2(rcy - (m0.pageRect.top + m0.cy * m0.pageRect.pxPerMm), rcx - (m0.pageRect.left + m0.cx * m0.pageRect.pxPerMm));
  const rad = Math.hypot(rcx - (m0.pageRect.left + m0.cx * m0.pageRect.pxPerMm), rcy - (m0.pageRect.top + m0.cy * m0.pageRect.pxPerMm));
  const stepRad = ((Math.PI / 180) * deg) / steps;
  const mcx = m0.pageRect.left + m0.cx * m0.pageRect.pxPerMm;
  const mcy = m0.pageRect.top + m0.cy * m0.pageRect.pxPerMm;
  await page.mouse.move(rcx, rcy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const a = a0 + stepRad * i;
    await page.mouse.move(mcx + rad * Math.cos(a), mcy + rad * Math.sin(a));
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
};

// Select the circle (click its centre)
const mc = { x: m.pageRect.left + m.cx * m.pageRect.pxPerMm, y: m.pageRect.top + m.cy * m.pageRect.pxPerMm };
await page.mouse.click(mc.x, mc.y);
await page.waitForTimeout(400);

// ROTATE ~30°
await rotateBy(30);
m = await model();
log("AFTER ROTATE:", JSON.stringify({ x: m.x, y: m.y, w: m.w, h: m.h, rotation: m.rotation }));
await shot("21-rotated");

/**
 * Resize invariant: the grabbed visual corner lands EXACTLY on the pointer's
 * final position (the drag starts from the handle's hit-area centre, which is
 * offset from the visual corner by a constant, so we compare END positions).
 */
const resizeCheck = async (handle, ddx, ddy, label) => {
  const hb = await page.locator(`.selection-frame .handle.${handle}`).boundingBox();
  const px = hb.x + hb.width / 2 + ddx; // pointer end
  const py = hb.y + hb.height / 2 + ddy;
  const before = await model();
  await drag(hb.x + hb.width / 2, hb.y + hb.height / 2, px, py);
  const after = await model();
  const d = { x: after.se.x - px, y: after.se.y - py };
  log(`${label}: SE corner vs pointer end: ${Math.hypot(d.x, d.y).toFixed(2)}px off (dx ${d.x.toFixed(2)}, dy ${d.y.toFixed(2)})`);
  log(`  model: ${before.w} x ${before.h} -> ${after.w} x ${after.h}  rot ${after.rotation}`);
};

// RESIZE H+50 from SE
await resizeCheck("se", 50, 0, "RESIZE H+50");
await shot("22-rotated-resize-h");
// RESIZE V+40 from SE
await resizeCheck("se", 0, 40, "RESIZE V+40");
await shot("23-rotated-resize-v");

// NW handle, diagonal drag +30/-30 (opposite edge anchored)
{
  const before = await model();
  const hb = await page.locator(".selection-frame .handle.nw").boundingBox();
  await drag(hb.x + hb.width / 2, hb.y + hb.height / 2, hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 - 30);
  const after = await model();
  const dCorner = { x: after.se.x - before.se.x, y: after.se.y - before.se.y };
  log("RESIZE NW(+30,-30): SE corner delta", dCorner.x.toFixed(2), dCorner.y.toFixed(2), "(anchored edge: SE should not move)");
  await shot("24-rotated-resize-nw");
}

// MOVE: disable snapping via the Settings tab, then the model delta must
// equal the pointer delta in page mm EXACTLY.
{
  await page.locator(".editor-panel-tab[aria-label='إعدادات']").click();
  await page.waitForTimeout(400);
  const snapGridBtn = page.getByRole("button", { name: "التقاط للشبكة" });
  const snapElBtn = page.getByRole("button", { name: "محاذاة العناصر" });
  if (await snapGridBtn.getAttribute("aria-pressed").then((v) => v === "true")) {
    await snapGridBtn.click();
  }
  if (await snapElBtn.getAttribute("aria-pressed").then((v) => v === "true")) {
    await snapElBtn.click();
  }
  await page.waitForTimeout(300);

  const m0 = await model();
  const targetX = m0.x + 22.7;
  const targetY = m0.y - 15.3;
  const dxPx = (targetX - m0.x) * m0.pageRect.pxPerMm;
  const dyPx = (targetY - m0.y) * m0.pageRect.pxPerMm;
  const cx0 = m0.pageRect.left + m0.cx * m0.pageRect.pxPerMm;
  const cy0 = m0.pageRect.top + m0.cy * m0.pageRect.pxPerMm;
  await page.mouse.click(cx0, cy0);
  await page.waitForTimeout(300);
  await drag(cx0, cy0, cx0 + dxPx, cy0 + dyPx);
  const m1 = await model();
  const dmm = { x: (m1.x - m0.x).toFixed(3), y: (m1.y - m0.y).toFixed(3) };
  log("MOVE(no snap): model delta", dmm, "mm expected (22.7, -15.3)  rot:", m1.rotation, " w/h:", m1.w, m1.h);
  await shot("25-rotated-move");
}

// Unrotated regression: circle move/resize/rotate still exact
{
  // Reset rotation to 0 via the right panel? Simpler: add a NEW circle on a blank area
  await page.locator(".editor-panel-tab[aria-label='أشكال']").click();
  await page.waitForTimeout(400);
  // (leave as is — test unrotated resize on the current circle after zeroing rotation)
}
await browser.close();
