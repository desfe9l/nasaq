/**
 * Live Production forensics: what exactly does the deployed app serve and
 * render? Cache behaviour, bundle contents (old vs new toolbar markers),
 * rendered chrome, and drawer interaction — all in a real browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://nasaq-sa.vercel.app";
const OUT = "render-results";
mkdirSync(OUT, { recursive: true });
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const report = { base: BASE, at: new Date().toISOString() };

// ── 1. Cache / document consistency ────────────────────────────────────────
async function fetchDoc(note, headers = {}) {
  const url = `${BASE}/editor`;
  const res = await fetch(url, { redirect: "follow", headers });
  const html = await res.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];
  return {
    note,
    status: res.status,
    htmlSha: sha(html),
    bytes: html.length,
    cacheControl: res.headers.get("cache-control"),
    age: res.headers.get("age"),
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    xVercelCache: res.headers.get("x-vercel-cache"),
    xVercelId: res.headers.get("x-vercel-id"),
    assetCount: assets.length,
    editorChunk: assets.find((a) => /\/editor-[\w-]+\.js$/.test(a)) || null,
    assets,
  };
}

report.docs = [];
report.docs.push(await fetchDoc("plain-1"));
report.docs.push(await fetchDoc("plain-2"));
report.docs.push(await fetchDoc("no-cache-request", { "cache-control": "no-cache", pragma: "no-cache" }));
report.docs.push(await fetchDoc("flagged-query-1", { "cache-control": "no-cache" }));

const first = report.docs[0];
const etag = first.etag;
if (etag) report.docs.push(await fetchDoc("conditional", { "if-none-match": etag }));

report.docVerdict = {
  allSameHtml: new Set(report.docs.map((d) => d.htmlSha)).size === 1,
  shas: [...new Set(report.docs.map((d) => d.htmlSha))],
  editorChunks: [...new Set(report.docs.map((d) => d.editorChunk))],
  cacheControls: [...new Set(report.docs.map((d) => d.cacheControl))],
};

// ── 2. Bundle contents: new-toolbar markers vs removed legacy components ────
const NEW_MARKERS = [
  ["data-density (narrow-lane folding)", /data-density/],
  ["editor-dock-grip", /editor-dock-grip/],
  ["editor-dock-color-btn", /editor-dock-color-btn/],
  ["bubbleLayout", /bubbleLayout/],
  ["dockLayout", /dockLayout/],
  ["AnchorMenu drawer title «أدوات الرسم»", /أدوات الرسم/],
  ["format drawer «تنسيق»", /تنسيق/],
  ["panel dock toggle «إرساء»", /إرساء/],
  ["editor-header-zone", /editor-header-zone/],
  ["studio-tool-dock", /studio-tool-dock/],
];
const LEGACY_MARKERS = [
  ["StudioToolDock class", /studio-tool-dock*(wide|rail)/],
  ["TouchPropertiesSheet", /touch-properties-sheet/],
  ["editor-top-tabs", /editor-top-tabs/],
  ["ArrangeBar", /arrange-bar|ArrangeBar/],
  ["ToolbarMenus", /toolbar-menus|ToolbarMenus/],
  ["studio-tool-dock-wide", /studio-tool-dock-wide/],
];

report.bundles = {};
const bundleUrls = [...new Set([first.editorChunk, "/assets/index-DVsgPtIa.js"].filter(Boolean))];
for (const u of [...new Set([...bundleUrls, ...first.assets.slice(0, 12)])]) {
  if (!u.endsWith(".js")) continue;
  try {
    const res = await fetch(`https://nasaq-sa.vercel.app${u}`);
    const text = await res.text();
    report.bundles[u] = {
      status: res.status,
      bytes: text.length,
      sha: sha(text),
      newMarkers: Object.fromEntries(NEW_MARKERS.map(([n, rx]) => [n, rx.test(text)])),
      legacyMarkers: Object.fromEntries(LEGACY_MARKERS.map(([n, rx]) => [n, rx.test(text)])),
    };
    if (u === first.editorChunk) writeFileSync(`${OUT}/live-editor-chunk.js`, text);
  } catch (err) {
    report.bundles[u] = { error: String(err?.message || err) };
  }
}
// Stylesheet: which toolbar CSS ships?
try {
  const cssUrl = first.assets.find((a) => a.endsWith(".css"));
  if (cssUrl) {
    const res = await fetch(`https://nasaq-sa.vercel.app${cssUrl}`);
    const css = await res.text();
    writeFileSync(`${OUT}/live-styles.css`, css);
    report.stylesheet = {
      url: cssUrl,
      bytes: css.length,
      sha: sha(css),
      hasStudioToolDock: /studio-tool-dock/.test(css),
      hasEditorTopTabs: /editor-top-tabs/.test(css),
      hasTouchProperties: /touch-properties/.test(css),
      hasEditorToolbar: /editor-toolbar/.test(css),
    };
  }
} catch (err) {
  report.stylesheet = { error: String(err?.message || err) };
}

// ── 3. Rendered chrome + drawer interaction ────────────────────────────────
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

async function render(viewport, tag) {
  const context = await browser.newContext({ viewport, locale: "ar", hasTouch: viewport.width < 1100 });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("nasaq.onboarding.v1", "done");
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/ERR_CONNECTION|net::|Failed to load resource/.test(m.text()))
      errors.push(m.text().slice(0, 160));
  });
  await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".editor-canvas-stage", { timeout: 45000 });
  await page.waitForTimeout(3000);

  const facts = await page.evaluate(() => {
    const dock = document.querySelector(".studio-tool-dock");
    const header = document.querySelector("header.editor-toolbar");
    return {
      headerPresent: !!header,
      headerButtons: [...(header?.querySelectorAll("button") || [])].map((b) =>
        (b.getAttribute("aria-label") || "").trim(),
      ),
      dockOuterHtml: dock ? dock.outerHTML.replace(/\s+/g, " ").slice(0, 1800) : null,
      dockDensity: dock?.getAttribute("data-density") ?? null,
      dockButtons: [...(dock?.querySelectorAll("button") || [])].map((b) =>
        (b.getAttribute("aria-label") || "").trim(),
      ),
      drawerNodes: document.querySelectorAll(".editor-anchor-menu.is-drawer").length,
      legacyClasses: {
        studioToolDockWide: document.querySelectorAll(".studio-tool-dock-wide").length,
        touchPropertiesSheet: document.querySelectorAll(".touch-properties-sheet").length,
        editorTopTabs: document.querySelectorAll(".editor-top-tabs").length,
      },
    };
  });
  await page.screenshot({ path: `${OUT}/${tag}-default.png` });

  // Open every dock control that can open a drawer, then move + close it.
  const interactions = [];
  const labels = facts.dockButtons.filter((l) => l && !/نقل|تصغير|تحديد/.test(l));
  for (const label of labels.slice(0, 8)) {
    const btn = page.locator(`.studio-tool-dock button[aria-label="${label}"]`).first();
    if (!(await btn.count())) continue;
    await btn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    const drawerSel = ".editor-anchor-menu.is-drawer";
    const opened = await page.evaluate((sel) => {
      const p = document.querySelector(sel);
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return {
        cls: p.className.slice(0, 70),
        role: p.getAttribute("role"),
        label: p.getAttribute("aria-label"),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        grip: !!p.querySelector('[aria-label^="نقل"]'),
        close: !!p.querySelector('[aria-label^="إغلاق"]'),
        controls: p.querySelectorAll("button").length,
      };
    }, drawerSel);
    if (opened) {
      const safe = label.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 20);
      await page.screenshot({ path: `${OUT}/${tag}-drawer-${safe}-open.png` });
      // Drag the drawer by its grip; then close it from its own control.
      const grip = page.locator(`${drawerSel} [aria-label^="نقل"]`).first();
      let moved = null;
      if (await grip.count()) {
        const gb = await grip.boundingBox();
        if (gb) {
          const before = await page.evaluate((sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y) };
          }, drawerSel);
          await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
          await page.mouse.down();
          await page.mouse.move(gb.x + gb.width / 2 - 180, gb.y + gb.height / 2 + 140, { steps: 12 });
          await page.mouse.up();
          await page.waitForTimeout(500);
          const after = await page.evaluate((sel) => {
            const p = document.querySelector(sel);
            if (!p) return null;
            const r = p.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y) };
          }, drawerSel);
          moved = { before, after };
          await page.screenshot({ path: `${OUT}/${tag}-drawer-${safe}-moved.png` });
        }
      }
      const closeBtn = page.locator(`${drawerSel} [aria-label^="إغلاق"]`).first();
      const closed = (await closeBtn.count()) ? (await closeBtn.click({ timeout: 4000 }).then(() => true).catch(() => false)) : false;
      await page.waitForTimeout(500);
      const stillOpen = await page.evaluate((sel) => !!document.querySelector(sel), drawerSel);
      interactions.push({ label, opened, moved, closedFromOwnControl: closed, stillOpenAfterClose: stillOpen });
      if (stillOpen) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
    }
  }

  // Selection bubble (the other toolbar of this task).
  let bubble = null;
  const el = page.locator("[data-el-id]").first();
  if (await el.count()) {
    await el.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    bubble = await page.evaluate(() => {
      const b = document.querySelector(".floating-toolbar");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        controls: [...b.querySelectorAll("button,input,select")].map((c) =>
          (c.getAttribute("aria-label") || c.tagName).trim().slice(0, 30),
        ),
      };
    });
    await page.screenshot({ path: `${OUT}/${tag}-selection-bubble.png` });
  }

  await context.close();
  return { viewport, facts, interactions, bubble, errors };
}

report.renders = {};
report.renders.desktop = await render({ width: 1440, height: 900 }, "desktop");
report.renders.tablet = await render({ width: 1024, height: 768 }, "tablet");
report.renders.mobile = await render({ width: 390, height: 844 }, "mobile");

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

const d = report.renders.desktop;
console.log("=== VERDICT ===");
console.log(
  JSON.stringify(
    {
      docVerdict: report.docVerdict,
      cacheControl: first.cacheControl,
      xVercelCache: first.xVercelCache,
      editorChunkMarkers: d ? report.bundles[first.editorChunk]?.newMarkers : null,
      editorChunkLegacy: report.bundles[first.editorChunk]?.legacyMarkers,
      stylesheet: report.stylesheet,
      desktopHeaderButtons: d.facts.headerButtons,
      desktopDockDensity: d.facts.dockDensity,
      desktopLegacyClasses: d.facts.legacyClasses,
      desktopInteractions: d.interactions.map((i) => ({
        label: i.label,
        opened: i.opened && { title: i.opened.title, grip: i.opened.hasGrip, close: i.opened.hasClose, w: i.opened.rect.w, h: i.opened.rect.h },
        moved: i.moved,
        closedFromOwnControl: i.closedFromOwnControl,
        stillOpenAfterClose: i.stillOpenAfterClose,
      })),
      desktopBubble: d.bubble,
      mobileDockButtons: report.renders.mobile.facts.dockButtons,
      mobileDockDensity: report.renders.mobile.facts.dockDensity,
      errors: { desktop: d.errors, tablet: report.renders.tablet.errors, mobile: report.renders.mobile.errors },
    },
    null,
    2,
  ),
);
