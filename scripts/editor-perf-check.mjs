/**
 * Editor performance comparison — runs identical interaction scripts against
 * two editor deployments (baseline and candidate) and prints a measured diff.
 *
 *   node scripts/editor-perf-check.mjs http://127.0.0.1:8081 http://127.0.0.1:8080
 *
 * Scenario selection (comma list in PERF_SCENARIOS, default all):
 *   drag        40-frame element drag (the core interaction cost)
 *   nudge       20 arrow-key presses
 *   pageSwitch  switch across pages ×4
 *   libraryOpen open the media library tab (needs seeded assets)
 *   geometry    panel/rail/input heights + pages-rail collapse (candidate)
 *   draft       unsaved edit survives an immediate reload
 *
 * BROWSER_EXECUTABLE optionally supplies Chromium where Playwright's download
 * is unavailable. The CPU is throttled 4× via CDP for the interaction
 * scenarios to approximate the low-end Windows machines the editor targets
 * (4 GB RAM, integrated graphics).
 *
 * Metrics per scenario (collected in-page, so they are implementation-agnostic):
 *  - storeWrites   zustand set() calls observed while the gesture ran
 *  - lsWrites      localStorage.setItem calls during the same window
 *  - mutations     DOM MutationObserver records, attributed per editor region
 *  - longTasks     tasks ≥ 50 ms observed during the gesture
 *  - duration      wall-clock until the interaction settled
 */
import { chromium } from "playwright";

const [baselineBase, candidateBase] = process.argv.slice(2);
if (!baselineBase || !candidateBase) {
  console.error(
    "usage: node scripts/editor-perf-check.mjs <baseline-url> <candidate-url>",
  );
  process.exit(2);
}

const SCENARIOS = (
  process.env.PERF_SCENARIOS ||
  "drag,nudge,pageSwitch,libraryOpen,geometry,draft"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const has = (s) => SCENARIOS.includes(s);

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** Region attribution shared by both deployments. */
const REGION_JS = `
  const regionOf = (node) => {
    if (!(node instanceof Element)) {
      return node.parentElement ? regionOf(node.parentElement) : "other";
    }
    if (node.closest(".editor-canvas-stage")) return "canvas";
    if (node.closest(".editor-properties")) return "rightPanel";
    const tabs = node.closest('[role="tablist"]');
    if (tabs && tabs.getAttribute("aria-label")?.includes("لوحة العناصر")) return "leftPanel";
    if (node.closest(".editor-page-rail")) return "pageRail";
    if (node.closest(".editor-toolbar")) return "toolbar";
    return "other";
  };
`;

async function prepare(base) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("nasaq.onboarding.v1", "done");
    performance.setResourceTimingBufferSize(5000);
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/editor`, { waitUntil: "networkidle" });
  await page.locator(".editor-canvas-stage").waitFor();
  await page.evaluate(async () => {
    window.store = (
      await import(
        performance
          .getEntriesByType("resource")
          .find((e) => /\/editor\/store\.ts(?:\?|$)/.test(e.name)).name
      )
    ).useEditor;
  });
  await page.waitForFunction(() => window.store.getState().hydrated);

  // Throttle the CPU to a low-end machine profile — only needed for the
  // interaction scenarios (geometry/draft are about correctness, not speed).
  if (has("drag") || has("nudge")) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  // Build an identical 3-page document with a busy first page.
  await page.evaluate(async (seedAssets) => {
    const { buildNewDocument, defaultNewDocument } = await import(
      "/src/lib/editor/new-document.ts"
    );
    const { createElement } = await import("/src/lib/editor/model.ts");
    const project = buildNewDocument(defaultNewDocument({ pages: 3 }));
    const els = [];
    for (let i = 0; i < 6; i++) {
      els.push(
        createElement("box", {
          id: `perf-box-${i}`,
          x: 8 + (i % 3) * 60,
          y: 20 + Math.floor(i / 3) * 45,
          z: i,
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      els.push(
        createElement("text", {
          id: `perf-text-${i}`,
          x: 10,
          y: 120 + i * 22,
          z: 10 + i,
        }),
      );
    }
    els.push(createElement("shape", { id: "perf-shape", x: 100, y: 40, z: 20 }));
    els.push(createElement("line", { id: "perf-line", x: 10, y: 210, z: 21 }));
    els.push(createElement("divider", { id: "perf-div", x: 10, y: 216, z: 22 }));
    els.push(
      createElement("group", {
        id: "perf-group",
        x: 8,
        y: 230,
        w: 120,
        h: 40,
        z: 30,
        children: [],
      }),
    );
    const child = (i) =>
      createElement("box", {
        id: `perf-group-child-${i}`,
        x: 10 + (i % 3) * 38,
        y: 232 + Math.floor(i / 3) * 18,
        w: 34,
        h: 14,
        z: 31 + i,
      });
    const group = els[els.length - 1];
    group.children = [child(0), child(1), child(2)];
    for (let i = 1; i < project.pages.length; i++) {
      project.pages[i].elements = [
        createElement("box", { id: `perf-p${i}-box`, x: 10, y: 20, z: 0 }),
        createElement("text", { id: `perf-p${i}-text`, x: 10, y: 80, z: 1 }),
      ];
    }
    project.pages[0].elements = els;
    if (!(await window.store.getState().createDocument(project)))
      throw new Error("createDocument failed");
    // Seed a busy media library (160 tiny SVG assets) so the library tab has
    // real content to render on both deployments.
    if (seedAssets) {
      const { saveAsset } = await import("/src/lib/editor/storage.ts");
      const svg = (n) =>
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="8" fill="#1e3a5f"/><text x="24" y="30" font-size="16" fill="#fff" text-anchor="middle">' +
            n +
            "</text></svg>",
        );
      for (let i = 0; i < 160; i++) {
        await saveAsset({
          name: "perf-asset-" + i,
          src: svg(i),
          w: 48,
          h: 48,
          folderId: null,
        });
      }
      await window.store.getState().refreshAssets();
    }
  }, has("libraryOpen"));
  await page.waitForTimeout(400);
  return { context, page, errors };
}

/** Install the counters; idempotent — tears down previous counters first. */
async function installCounters(page) {
  await page.evaluate(`
    (() => {
      if (window.perf?.teardown) window.perf.teardown();
      window.perf = { storeWrites: 0, lsWrites: 0, mutations: {}, longTasks: 0 };
      const bump = (k) => { window.perf.mutations[k] = (window.perf.mutations[k] || 0) + 1; };
      ${REGION_JS}
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          bump(regionOf(r.target));
          if (r.type === "childList") {
            r.addedNodes.forEach((n) => bump(regionOf(n) + ":mount"));
          }
        }
      });
      mo.observe(document.documentElement, {
        childList: true, attributes: true, characterData: true, subtree: true,
      });
      const unsub = window.store.subscribe(() => { window.perf.storeWrites++; });
      const ls = Storage.prototype.setItem;
      const patch = function (...a) { window.perf.lsWrites++; return this === localStorage ? ls.apply(this, a) : undefined; };
      Storage.prototype.setItem = patch;
      const lt = new PerformanceObserver((list) => { window.perf.longTasks += list.getEntries().length; });
      lt.observe({ entryTypes: ["longtask"] });
      window.perf.teardown = () => {
        mo.disconnect();
        unsub();
        Storage.prototype.setItem = ls;
        lt.disconnect();
      };
    })()
  `);
}

async function readCounters(page) {
  return page.evaluate(() => ({
    storeWrites: window.perf.storeWrites,
    lsWrites: window.perf.lsWrites,
    longTasks: window.perf.longTasks,
    mutations: { ...window.perf.mutations },
  }));
}

/** Drag `perf-box-1` by `frames` steps; resolves after `settle` ms. */
async function dragElement(page, frames, settle) {
  // Baseline mounts every element twice (live canvas + #export-root copy),
  // so scope to the interactive canvas.
  const el = page
    .locator('.editor-canvas-stage [data-el-id="perf-box-1"]')
    .first();
  // A previously selected element is covered by its selection frame; clear
  // the selection first so the click reaches the element itself.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await el.click();
  await page.waitForTimeout(250);
  const box = await el.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const t0 = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(cx + i * 2, cy + Math.sin(i / 5) * 3);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  if (settle) await page.waitForTimeout(settle);
  return Date.now() - t0;
}

async function runScenarios(page) {
  const results = {};

  if (has("drag")) {
    await installCounters(page);
    const duration = await dragElement(page, 40, 350);
    results.drag = { ...(await readCounters(page)), duration };
  }

  if (has("nudge")) {
    await installCounters(page);
    const t1 = Date.now();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(350);
    results.nudge = { ...(await readCounters(page)), duration: Date.now() - t1 };
  }

  if (has("pageSwitch")) {
    const t2 = Date.now();
    await installCounters(page);
    for (const p of [2, 3, 1, 2]) {
      await page.evaluate((n) => {
        const s = window.store.getState();
        s.setActivePage(s.pages[n - 1].id);
      }, p);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(300);
    results.pageSwitch = {
      ...(await readCounters(page)),
      duration: Date.now() - t2,
    };
  }

  if (has("libraryOpen")) {
    const t3 = Date.now();
    await installCounters(page);
    await page.evaluate(() => {
      window.store.getState().openLibrary();
    });
    await page
      .locator(".asset-media-grid > *")
      .first()
      .waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    results.libraryOpen = {
      ...(await readCounters(page)),
      duration: Date.now() - t3,
      cards: await page.locator(".asset-media-grid > *").count(),
    };
    await page.evaluate(() => {
      window.store.setState({ leftOpen: false });
    });
  }

  if (has("geometry")) {
    // Back to page 1 with a live selection, so the inspector actually shows
    // accordions and fields on both deployments.
    await page.evaluate(() => {
      const s = window.store.getState();
      s.setActivePage(s.pages[0].id);
      s.updateElement("perf-box-1", { x: 68, y: 20 }, true);
      s.select("perf-box-1");
      s.setRightTab("properties");
    });
    await page.waitForTimeout(250);
    results.geometry = await page.evaluate(() => {
      const rail = document.querySelector(".editor-page-rail");
      const header = document.querySelector(".editor-toolbar");
      const accordion = document.querySelector(".editor-accordion-header");
      const fieldInput = document.querySelector(
        ".editor-property-field .field-control input, .editor-property-field .field-control select",
      );
      return {
        railHeight: rail?.getBoundingClientRect().height ?? 0,
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        accordionHeaderHeight: accordion?.getBoundingClientRect().height ?? 0,
        fieldInputHeight: fieldInput?.getBoundingClientRect().height ?? 0,
      };
    });
    await page.evaluate(() => {
      window.store.setState({ rightOpen: false });
    });
    // Candidate only: collapse the pages rail and re-measure.
    if (
      await page.evaluate(
        () =>
          typeof window.store.getState().togglePagesRail === "function",
      )
    ) {
      await page.evaluate(() => window.store.getState().togglePagesRail());
      await page.waitForTimeout(250);
      results.geometry.railHeightCollapsed = await page.evaluate(
        () =>
          document
            .querySelector(".editor-page-rail")
            ?.getBoundingClientRect().height ?? 0,
      );
      await page.evaluate(() => window.store.getState().togglePagesRail());
      await page.waitForTimeout(250);
    }
  }

  if (has("draft")) {
    await page.evaluate(() => {
      const s = window.store.getState();
      s.setActivePage(s.pages[0].id);
      s.updateElement("perf-box-1", { x: 68, y: 20 });
      s.commit();
    });
    await page.waitForTimeout(100);
    // Self-contained: drag the element, then reload IMMEDIATELY — before the
    // debounced autosave can fire. The draft envelope must bridge the reload.
    await dragElement(page, 15, 0);
    const before = await page.evaluate(() => {
      const s = window.store.getState();
      return {
        x: s.pages[0].elements.find((e) => e.id === "perf-box-1").x,
        saveState: s.saveState,
      };
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".editor-canvas-stage").waitFor();
    await page.evaluate(async () => {
      window.store = (
        await import(
          performance
            .getEntriesByType("resource")
            .find((e) => /\/editor\/store\.ts(?:\?|$)/.test(e.name)).name
        )
      ).useEditor;
    });
    await page.waitForFunction(() => window.store.getState().hydrated);
    await page.waitForTimeout(500);
    results.draftRecovery = await page.evaluate((before) => {
      const s = window.store.getState();
      const el = s.pages[0]?.elements.find((e) => e.id === "perf-box-1");
      return {
        elementFound: Boolean(el),
        recoveredDraggedX: el ? el.x === before.x : false,
        stillOnPage1: s.pages[s.activePageId === s.pages[0].id ? 0 : -1] != null,
        activePageIsFirst: s.activePageId === s.pages[0]?.id,
        saveStateBeforeReload: before.saveState,
      };
    }, before);
  }

  return results;
}

async function measure(base) {
  const { context, page, errors } = await prepare(base);
  const results = await runScenarios(page);
  // Structural check: idle export DOM (baseline duplicates every page).
  results.idleExportDomChildren = await page.evaluate(
    () => document.querySelector("#export-root")?.childElementCount ?? 0,
  );
  results.pageErrors = errors;
  await context.close();
  return results;
}

const baseline = await measure(baselineBase);
const candidate = await measure(candidateBase);

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));
console.log(`\nEditor performance comparison (scenarios: ${SCENARIOS.join(", ")})`);
console.log(`  baseline : ${baselineBase}`);
console.log(`  candidate: ${candidateBase}\n`);

const rows = [];
for (const scen of ["drag", "nudge", "pageSwitch", "libraryOpen"]) {
  if (!baseline[scen] && !candidate[scen]) continue;
  for (const m of ["storeWrites", "lsWrites", "longTasks", "duration"]) {
    rows.push({
      metric: `${scen}.${m}`,
      baseline: baseline[scen]?.[m],
      candidate: candidate[scen]?.[m],
    });
  }
  const totalMut = (o) =>
    o[scen] ? Object.values(o[scen].mutations).reduce((a, b) => a + b, 0) : 0;
  rows.push({
    metric: `${scen}.mutations.total`,
    baseline: totalMut(baseline),
    candidate: totalMut(candidate),
  });
  if (scen === "drag" && baseline.drag && candidate.drag) {
    for (const region of ["canvas", "rightPanel", "leftPanel", "pageRail", "toolbar"]) {
      rows.push({
        metric: `  drag mutations in ${region}`,
        baseline: baseline.drag.mutations[region] || 0,
        candidate: candidate.drag.mutations[region] || 0,
      });
    }
  }
  if (scen === "libraryOpen" && baseline.libraryOpen && candidate.libraryOpen) {
    rows.push({
      metric: "libraryOpen.cards rendered in grid",
      baseline: baseline.libraryOpen.cards,
      candidate: candidate.libraryOpen.cards,
    });
  }
}
if (baseline.geometry || candidate.geometry) {
  for (const k of ["railHeight", "headerHeight", "accordionHeaderHeight", "fieldInputHeight"]) {
    rows.push({
      metric: `geometry.${k} (px)`,
      baseline: baseline.geometry?.[k],
      candidate: candidate.geometry?.[k],
    });
  }
  rows.push({
    metric: "geometry.railHeightCollapsed (px, candidate only)",
    baseline: "n/a",
    candidate: candidate.geometry?.railHeightCollapsed ?? "n/a",
  });
}
if (baseline.draftRecovery || candidate.draftRecovery) {
  rows.push({
    metric: "draft.elementFound",
    baseline: baseline.draftRecovery?.elementFound,
    candidate: candidate.draftRecovery?.elementFound,
  });
  rows.push({
    metric: "draft.recoveredDraggedX (unsaved edit survives reload)",
    baseline: baseline.draftRecovery?.recoveredDraggedX,
    candidate: candidate.draftRecovery?.recoveredDraggedX,
  });
  rows.push({
    metric: "draft.activePageIsFirst",
    baseline: baseline.draftRecovery?.activePageIsFirst,
    candidate: candidate.draftRecovery?.activePageIsFirst,
  });
}
rows.push({
  metric: "idle #export-root children (pages duplicated offscreen)",
  baseline: baseline.idleExportDomChildren,
  candidate: candidate.idleExportDomChildren,
});

for (const r of rows) {
  const b = r.baseline ?? "—";
  const c = r.candidate ?? "—";
  const better =
    typeof b === "number" && typeof c === "number" && c < b ? " ✓" : "";
  console.log(
    `${r.metric.padEnd(52)} ${fmt(b).padStart(9)} → ${fmt(c).padStart(9)}${better}`,
  );
}
console.log(
  `\npage errors — baseline: ${baseline.pageErrors.length}, candidate: ${candidate.pageErrors.length}`,
);
if (baseline.pageErrors.length) console.log("baseline errors:", baseline.pageErrors);
if (candidate.pageErrors.length) console.log("candidate errors:", candidate.pageErrors);

await browser.close();
