/**
 * Temporary session scaffolding: render the LIVE production editor in Chromium
 * and record what the user actually sees (screenshots + DOM facts).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://nasaq-sa.vercel.app";
const DEPLOY = process.env.DEPLOY_URL || "";
const OUT = "render-results";
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, deploy: DEPLOY, startedAt: new Date().toISOString() };

async function grabHtml(url, tag) {
  try {
    const res = await fetch(`${url}?__probe=${Date.now()}`, {
      redirect: "follow",
      headers: { "cache-control": "no-cache", pragma: "no-cache" },
    });
    const html = await res.text();
    writeFileSync(`${OUT}/${tag}.html`, html);
    const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const headerSnippet = (html.match(/<header[^>]*>[\s\S]{0,1200}/) || [""])[0];
    return {
      url,
      status: res.status,
      bytes: html.length,
      sha256: createHash("sha256").update(html).digest("hex").slice(0, 16),
      cacheControl: res.headers.get("cache-control"),
      age: res.headers.get("age"),
      xVercelId: res.headers.get("x-vercel-id"),
      xVercelCache: res.headers.get("x-vercel-cache"),
      assets: [...new Set(scripts)].slice(0, 40),
      headerSnippet: headerSnippet.slice(0, 600),
      hasOldToolbarMarkers: /تحرير رسم|تقرير رسم|تبويب أدوات/.test(html),
      hasNewMarkers: /editor-toolbar|editor-header-zone/.test(html),
    };
  } catch (err) {
    return { url, error: String(err?.message || err) };
  }
}

report.http = {};
report.http.alias = await grabHtml(`${BASE}/editor`, "alias-editor");
if (DEPLOY) report.http.deployment = await grabHtml(`${DEPLOY}/editor`, "deploy-editor");

const DOM_FACTS = () => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const header = document.querySelector("header.editor-toolbar") || document.querySelector("header");
  const headerButtons = header ? [...header.querySelectorAll("button")] : [];
  const texts = [...document.querySelectorAll("body *")]
    .filter((el) => el.children.length === 0 && el.textContent.trim() && vis(el))
    .map((el) => el.textContent.trim());
  return {
    url: location.href,
    title: document.title,
    editorUi: !!document.querySelector(".editor-ui"),
    headerFound: !!header,
    headerClass: header ? header.className : null,
    headerBox: box(header),
    headerBg: header ? getComputedStyle(header).backgroundColor : null,
    headerZoneCount: document.querySelectorAll(".editor-header-zone").length,
    headerButtonCount: headerButtons.length,
    headerButtons: headerButtons.map((b) => ({
      label: (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 40),
      icon: !!b.querySelector("svg"),
      box: box(b),
    })),
    headerHtml: header ? header.outerHTML.replace(/\s+/g, " ").slice(0, 2500) : null,
    dock: box(document.querySelector('[aria-label="أدوات مساحة العمل"]')),
    dockCount: document.querySelectorAll('[aria-label="أدوات مساحة العمل"]').length,
    floatingPanels: [...document.querySelectorAll(".floating-panel")].map((p) => ({
      title: (p.querySelector("h2,h3,[class*=title]")?.textContent || "").trim().slice(0, 40),
      box: box(p),
    })),
    legacyMarkers: {
      studioToolDock: document.querySelectorAll(".studio-tool-dock").length,
      editorSidebar: document.querySelectorAll(".editor-sidebar").length,
      editorTopTabs: document.querySelectorAll(".editor-top-tabs").length,
    },
    pageRail: box(document.querySelector(".editor-page-rail")),
    statusBar: (document.querySelector(".editor-status-bar") || {}).textContent?.slice(0, 120) || null,
    canvasStage: box(document.querySelector(".editor-canvas-stage")),
    visibleTextSample: texts.slice(0, 80),
    tourVisible: /شريط علوي واحد|أدوات مساحة العمل/.test(
      [...document.querySelectorAll("body *")].filter(vis).map((e) => e.textContent).join(" ") || "",
    ),
  };
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

async function shoot(viewport, tag) {
  const context = await browser.newContext({
    viewport,
    locale: "ar",
    hasTouch: viewport.width < 1100,
    deviceScaleFactor: 1,
  });
  // Skip the first-run tour so the shell itself is what gets measured.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("nasaq.onboarding.v1", "done");
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  const res = await page.goto(`${BASE}/editor`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".editor-canvas-stage", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/${tag}-initial.png` });

  const facts = await page.evaluate(DOM_FACTS);

  // Interaction: open a tool drawer from the header, move it, close it.
  const interaction = { steps: [] };
  const clickLabel = async (name) => {
    const target = page.getByRole("button", { name, exact: true }).first();
    if (await target.count()) {
      await target.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(700);
      return true;
    }
    return false;
  };
  interaction.openedElements = await clickLabel("العناصر");
  interaction.panelsAfterOpen = await page.evaluate(() =>
    [...document.querySelectorAll(".floating-panel")].map((p) => {
      const r = p.getBoundingClientRect();
      return {
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        text: p.textContent.trim().slice(0, 60),
        grip: !!p.querySelector('[data-drag-handle], .fp-grip, [class*=grip]'),
      };
    }),
  );
  await page.screenshot({ path: `${OUT}/${tag}-drawer-open.png` });

  const grip = page.locator('[data-drag-handle], .fp-grip').first();
  if (await grip.count()) {
    const b = await grip.boundingBox();
    if (b) {
      const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 140, start.y + 160, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      interaction.dragged = true;
      interaction.panelsAfterDrag = await page.evaluate(() =>
        [...document.querySelectorAll(".floating-panel")].map((p) => {
          const r = p.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        }),
      );
      await page.screenshot({ path: `${OUT}/${tag}-drawer-moved.png` });
    }
  }
  interaction.closed = await clickLabel("إغلاق لوحة العناصر").catch(() => false);
  interaction.panelsAfterClose = await page.evaluate(
    () => document.querySelectorAll(".floating-panel").length,
  );
  await page.screenshot({ path: `${OUT}/${tag}-drawer-closed.png` });

  await context.close();
  return { viewport, status: res?.status(), errors: errors.slice(0, 10), facts, interaction };
}

report.desktop = await shoot({ width: 1440, height: 900 }, "desktop");
report.tablet = await shoot({ width: 834, height: 1112 }, "tablet");

await browser.close();
report.finishedAt = new Date().toISOString();
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));

// Compact console verdict so the run log alone answers the question.
const d = report.desktop;
console.log("=== VERDICT ===");
console.log(
  JSON.stringify(
    {
      aliasStatus: report.http.alias?.status,
      aliasSha: report.http.alias?.sha256,
      aliasAssets: report.http.alias?.assets?.length,
      deployStatus: report.http.deployment?.status,
      deploySha: report.http.deployment?.sha256,
      aliasOldMarkers: report.http.alias?.hasOldToolbarMarkers,
      headerClass: d.facts.headerClass,
      headerZones: d.facts.headerZoneCount,
      headerButtons: d.facts.headerButtons.map((b) => b.label),
      dock: d.facts.dock,
      legacy: d.facts.legacyMarkers,
      panelsOpen: d.interaction.panelsAfterOpen,
      movedPanels: d.interaction.panelsAfterDrag,
      panelsAfterClose: d.interaction.panelsAfterClose,
      errors: d.errors,
    },
    null,
    2,
  ),
);
