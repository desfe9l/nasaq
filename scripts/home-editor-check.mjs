/**
 * Homepage interactive editor — browser verification.
 *
 * Drives the hero editor on `/` the way a visitor does: select, drag, resize,
 * retype text, duplicate, delete, undo/redo and walk the pages. It also pins
 * the two things the old iframe build got wrong — the surface must not be a
 * frame (production answers `X-Frame-Options: DENY`), and it must never trap
 * the page scroll.
 *
 *   node scripts/home-editor-check.mjs            # desktop
 *   TOUCH=1 node scripts/home-editor-check.mjs    # iPad-sized touch layout
 *   OFFLINE=1 node scripts/home-editor-check.mjs  # catalog unreachable
 *   DEVICE="iPhone 13" node scripts/home-editor-check.mjs   # any Playwright device
 *
 * OFFLINE mode blocks the published-catalog server function: the hero must
 * still boot the bundled document (and that one is multi-page, so the page
 * controls get exercised there).
 */
import { chromium, devices } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const TOUCH = process.env.TOUCH === "1";
const OFFLINE = process.env.OFFLINE === "1";
const log = (...a) => console.log(...a);
const failures = [];
const check = (name, ok, detail = "") => {
  log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const DEVICE = process.env.DEVICE || (TOUCH ? "iPad (gen 7) landscape" : "");
if (DEVICE && !devices[DEVICE]) {
  console.error(`unknown DEVICE "${DEVICE}"`);
  process.exit(2);
}
const context = await browser.newContext(
  DEVICE
    ? { ...devices[DEVICE], locale: "ar" }
    : { viewport: { width: 1440, height: 950 }, locale: "ar" },
);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error")
    errors.push(`console: ${msg.text().slice(0, 240)}`);
});

if (OFFLINE) {
  // TanStack server-function ids are base64 JSON carrying the export name.
  await page.route("**/_serverFn/**", async (route) => {
    const id = route.request().url().split("/_serverFn/")[1] ?? "";
    let decoded = "";
    try {
      decoded = Buffer.from(
        decodeURIComponent(id.split("?")[0]),
        "base64",
      ).toString("utf8");
    } catch {
      decoded = "";
    }
    if (decoded.includes("listPublishedTemplatesFn")) await route.abort();
    else await route.continue();
  });
}

const TIMEOUT = Number(process.env.CHECK_TIMEOUT || 180000);
await page.goto(`${BASE}/`, {
  waitUntil: "domcontentloaded",
  timeout: TIMEOUT,
});

const surface = page.locator("[data-home-editor]");
await surface.first().waitFor({ timeout: TIMEOUT });
check(
  "the hero editor mounts exactly once",
  (await surface.count()) === 1,
  `count=${await surface.count()}`,
);

const paper = page.locator("[data-home-editor-paper]");
await paper.waitFor({ timeout: TIMEOUT });
const source = await surface.first().getAttribute("data-home-editor-source");
check(
  "a real NASAQ document booted",
  OFFLINE ? source === "bundled" : source === "catalog" || source === "bundled",
  `source=${source}`,
);
check(
  "the hero is NOT an iframe",
  (await page.locator("[data-home-editor] iframe").count()) === 0,
);

const paperBox = await paper.boundingBox();
check(
  "the page is fitted inside the stage",
  !!paperBox && paperBox.width > 80 && paperBox.height > 80,
  paperBox
    ? `${Math.round(paperBox.width)}×${Math.round(paperBox.height)}`
    : "none",
);

await page.locator("[data-home-editor-stage]").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);

const els = page.locator("[data-home-el]");
const elCount = await els.count();
check("real document elements render", elCount > 0, `elements=${elCount}`);

// Pick the smallest element: it is never the page-wide background, so a drag
// over it is unambiguous.
const index = await page.evaluate(() => {
  const list = [...document.querySelectorAll("[data-home-el]")];
  let best = 0;
  let area = Infinity;
  list.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.width > 12 && r.height > 12 && r.width * r.height < area) {
      area = r.width * r.height;
      best = i;
    }
  });
  return best;
});
const target = els.nth(index);
const id = await target.getAttribute("data-home-el");
const geom = async (elementId = id) =>
  page.evaluate((key) => {
    const node = document.querySelector(`[data-home-el="${key}"]`);
    if (!node) return null;
    return {
      x: Number(node.dataset.elX),
      y: Number(node.dataset.elY),
      w: Number(node.dataset.elW),
      h: Number(node.dataset.elH),
      selected: node.dataset.selected === "true",
    };
  }, elementId);

// ── selection ─────────────────────────────────────────────────────────────
let box = await target.boundingBox();
if (TOUCH)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(250);
check("tapping an element selects it", (await geom())?.selected === true);

// ── touch policy (iPad): the page keeps scrolling until you engage ────────
const touchPolicy = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll("[data-home-el]")];
  const selected = nodes.find((n) => n.dataset.selected === "true");
  const idle = nodes.find((n) => n.dataset.selected !== "true");
  const stage = document.querySelector("[data-home-editor-stage]");
  return {
    stage: stage ? getComputedStyle(stage).touchAction : null,
    selected: selected ? getComputedStyle(selected).touchAction : null,
    idle: idle ? getComputedStyle(idle).touchAction : null,
  };
});
check(
  "touch scrolling stays with the page until an element is engaged",
  touchPolicy.stage === "pan-y" &&
    touchPolicy.idle === "pan-y" &&
    touchPolicy.selected === "none",
  JSON.stringify(touchPolicy),
);

// ── real finger gestures (iPad) ───────────────────────────────────────────
if (TOUCH) {
  const cdp = await context.newCDPSession(page);
  const touchDrag = async (x, y, dx, dy) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 5; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5 }],
      });
      await page.waitForTimeout(25);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(250);
  };

  // The selected element follows the finger.
  const pre = await geom();
  const tb = await target.boundingBox();
  await touchDrag(tb.x + tb.width / 2, tb.y + tb.height / 2, -34, 26);
  const post = await geom();
  check(
    "a finger drags the selected element",
    !!post &&
      (Math.abs(post.x - pre.x) > 0.5 || Math.abs(post.y - pre.y) > 0.5),
    `${pre?.x},${pre?.y} → ${post?.x},${post?.y}`,
  );

  // A finger landing on an element that is NOT selected must not move it:
  // that swipe belongs to the page, so the homepage keeps scrolling.
  await page.touchscreen.tap(
    4,
    (await page.locator("[data-home-editor-stage]").boundingBox()).y + 4,
  );
  await page.waitForTimeout(200);
  const snapshot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-home-el]")]
        .map((n) => `${n.dataset.homeEl}:${n.dataset.elX},${n.dataset.elY}`)
        .join("|"),
    );
  const beforeTouch = await snapshot();
  const pb = await page.locator("[data-home-editor-paper]").boundingBox();
  await touchDrag(pb.x + pb.width / 2, pb.y + pb.height / 2, 0, -46);
  const afterTouch = await snapshot();
  const selectedAfter = await page
    .locator('[data-home-el][data-selected="true"]')
    .count();
  check(
    "the first finger touch selects without dragging",
    beforeTouch === afterTouch && selectedAfter === 1,
    `moved=${beforeTouch !== afterTouch} selected=${selectedAfter}`,
  );
  // hand the selection back to the element the rest of the run uses
  await target.click();
  await page.waitForTimeout(150);
}

// ── move ──────────────────────────────────────────────────────────────────
const before = await geom();
box = await target.boundingBox();
const dragBy = async (dx, dy) => {
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(sx + (dx * i) / 6, sy + (dy * i) / 6);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
};
await dragBy(-46, 34);
const moved = await geom();
check(
  "dragging moves the element in the document model",
  !!moved &&
    (Math.abs(moved.x - before.x) > 0.5 || Math.abs(moved.y - before.y) > 0.5),
  `${before.x},${before.y} → ${moved?.x},${moved?.y}`,
);

// ── resize ────────────────────────────────────────────────────────────────
const handle = page.locator('[data-handle="se"]');
check("the selection exposes resize handles", (await handle.count()) === 1);
const hb = await handle.boundingBox();
if (hb) {
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      hb.x + hb.width / 2 + i * 5,
      hb.y + hb.height / 2 + i * 4,
    );
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}
const resized = await geom();
check(
  "the resize handle changes the element size",
  !!resized &&
    (Math.abs(resized.w - moved.w) > 0.5 ||
      Math.abs(resized.h - moved.h) > 0.5),
  `${moved.w}×${moved.h} → ${resized?.w}×${resized?.h}`,
);

// ── undo / redo ───────────────────────────────────────────────────────────
await page.locator('[data-home-editor-action="undo"]').click();
await page.waitForTimeout(250);
const undone = await geom();
check(
  "undo reverts the last edit",
  !!undone &&
    Math.abs(undone.w - moved.w) < 0.6 &&
    Math.abs(undone.h - moved.h) < 0.6,
  `${resized?.w}×${resized?.h} → ${undone?.w}×${undone?.h}`,
);
await page.locator('[data-home-editor-action="redo"]').click();
await page.waitForTimeout(250);
const redone = await geom();
check(
  "redo re-applies it",
  !!redone && Math.abs(redone.w - resized.w) < 0.6,
  `${undone?.w} → ${redone?.w}`,
);

// ── duplicate / delete ────────────────────────────────────────────────────
await page.locator(`[data-home-el="${id}"]`).click();
await page.waitForTimeout(150);
const countBefore = await els.count();
await page.locator('[data-home-editor-action="duplicate"]').click();
await page.waitForTimeout(250);
check(
  "duplicate adds a copy",
  (await els.count()) === countBefore + 1,
  `${countBefore} → ${await els.count()}`,
);
await page.locator('[data-home-editor-action="delete"]').click();
await page.waitForTimeout(250);
check(
  "delete removes the selection",
  (await els.count()) === countBefore,
  `→ ${await els.count()}`,
);

// ── text editing ──────────────────────────────────────────────────────────
const textEl = page.locator('[data-home-el][data-el-type="text"]').first();
let textOk = false;
if (await textEl.count()) {
  const tb = await textEl.boundingBox();
  await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.waitForTimeout(150);
  await page.locator('[data-home-editor-action="edit-text"]').click();
  await page.waitForTimeout(250);
  const editor = page.locator("[data-home-editor-text]");
  const opened = (await editor.count()) === 1;
  if (opened) {
    await editor.fill("نَسَق — تحرير مباشر");
    await page
      .locator("[data-home-editor-stage]")
      .click({ position: { x: 4, y: 4 } });
    await page.waitForTimeout(300);
    const painted = await page.locator("[data-home-editor-paper]").innerText();
    textOk = painted.includes("تحرير مباشر");
  }
  check("double-clicking text opens the inline editor", opened);
}
check("typed text is written into the document", textOk);

// ── keyboard nudge ────────────────────────────────────────────────────────
const nudgeTarget = page.locator("[data-home-el]").nth(index);
const nudgeId = await nudgeTarget.getAttribute("data-home-el");
await nudgeTarget.click();
await page.waitForTimeout(150);
const preNudge = await geom(nudgeId);
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(200);
const postNudge = await geom(nudgeId);
check(
  "arrow keys nudge the selection",
  !!preNudge && !!postNudge && Math.abs(postNudge.x - (preNudge.x - 1)) < 0.01,
  `${preNudge?.x} → ${postNudge?.x}`,
);

// ── page navigation ───────────────────────────────────────────────────────
const pageCount = Number(
  await page
    .locator("[data-home-editor-page-count]")
    .getAttribute("data-home-editor-page-count"),
);
check("the document exposes its pages", pageCount >= 1, `pages=${pageCount}`);
if (pageCount > 1) {
  const firstSignature = await page
    .locator("[data-home-editor-paper]")
    .innerText();
  await page.locator("[data-home-editor-next]").click();
  await page.waitForTimeout(400);
  const active = await page
    .locator('[data-home-editor-page][aria-current="true"]')
    .getAttribute("data-home-editor-page");
  const secondSignature = await page
    .locator("[data-home-editor-paper]")
    .innerText();
  check(
    "the next-page control moves to page 2",
    active === "1",
    `active=${active}`,
  );
  check("page 2 paints different content", firstSignature !== secondSignature);
  await page.locator("[data-home-editor-prev]").click();
  await page.waitForTimeout(400);
  const back = await page
    .locator('[data-home-editor-page][aria-current="true"]')
    .getAttribute("data-home-editor-page");
  check(
    "the previous-page control returns to page 1",
    back === "0",
    `active=${back}`,
  );
}

// ── reset ─────────────────────────────────────────────────────────────────
await page.locator('[data-home-editor-action="reset"]').click();
await page.waitForTimeout(400);
check(
  "reset restores the document",
  (await els.count()) === countBefore,
  `elements=${await els.count()}`,
);

// ── the hero must never trap the homepage scroll ──────────────────────────
// (a finger-only device has no wheel; `touch-action` is asserted above)
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const stageBox = await page.locator("[data-home-editor-stage]").boundingBox();
await page.mouse.move(
  stageBox.x + stageBox.width / 2,
  stageBox.y + stageBox.height / 2,
);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(80);
}
const scrolled = await page.evaluate(() => window.scrollY);
check(
  "wheeling over the editor scrolls the homepage",
  scrolled > 150,
  `scrollY=${Math.round(scrolled)}`,
);

// Navigation still works from the hero section.
const navCount = await page.locator('a[href="/templates"]').count();
check("homepage navigation is intact", navCount > 0, `links=${navCount}`);

// ── no runtime noise ──────────────────────────────────────────────────────
const realErrors = errors.filter(
  (e) =>
    // `_vercel/insights` only exists on Vercel; a local preview always 404s it.
    !/favicon|manifest|net::ERR|Failed to load resource|ResizeObserver loop|React DevTools|_vercel\/insights/i.test(
      e,
    ),
);
check(
  "no console or runtime errors",
  realErrors.length === 0,
  realErrors.slice(0, 3).join(" | "),
);

const label = `${DEVICE || "desktop"}${OFFLINE ? ", catalog offline" : ""}`;
await page.screenshot({
  path: `/tmp/home-editor-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`,
});
await browser.close();

log("");
if (failures.length) {
  log(`FAILED (${failures.length}): ${failures.join(", ")}`);
  process.exit(1);
}
log(`ALL CHECKS PASSED (${label})`);
