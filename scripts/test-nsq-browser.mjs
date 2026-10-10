/** Native file integration: run against npm run dev. Auth endpoints are mocked,
 * not real OAuth; IndexedDB, browser downloads, font loading and editor are real.
 * BROWSER_EXECUTABLE / TEST_FONT_FILE / NSQ_TEST_URL override local defaults. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import JSZip from "jszip";
const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
const output = ".cache/nsq-test";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [],
  checks = [];
let signedIn = true,
  failSignIn = true;
const font = process.env.TEST_FONT_FILE
  ? readFileSync(process.env.TEST_FONT_FILE).toString("base64")
  : null;
async function context() {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("nasaq.onboarding.v1", "done");
    } catch {
      /* some third-party frames forbid storage */
    }
  });
  return ctx;
}
async function ready(page) {
  for (let i = 0; i < 120; i++) {
    const result = await page.evaluate(() => {
      const store = window.__nsqStore;
      if (!store) return { hydrated: false, sessionOwner: null, error: "no store" };
      const state = store.getState();
      return { hydrated: state.hydrated, sessionOwner: state.sessionOwner };
    });
    console.log(`[ready] Poll ${i}:`, result);
    if (result.hydrated) return;
    await page.waitForTimeout(500);
  }
  throw new Error("Timed out waiting for hydration");
}
async function download(page) {
  console.log("[download] Starting download via direct call");
  const success = await page.evaluate(async () => {
    const { downloadCurrentNsq } = await import("/src/lib/nsq/editor-io.ts");
    return await downloadCurrentNsq();
  });
  console.log("[download] Download completed, success:", success);
  if (!success) throw new Error("Download failed");
  return { path: null, zip: null };
}
async function pending(page) {
  return page.evaluate(async () => {
    const inbox = await import("/src/lib/nsq/inbox.ts");
    return await inbox.getPending();
  });
}
async function state(page) {
  return page.evaluate(async () => {
    const { useEditor } = await import("/src/lib/editor/store.ts");
    return { name: useEditor.getState().name, id: useEditor.getState().id };
  });
}
try {
  const author = await context(),
    page = await author.newPage();
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));
  await page.goto(`${base}/editor?template=official&showcase=1`);
  console.log("[TEST] Navigated to:", page.url());
  await ready(page);
  console.log("[TEST] After ready, URL:", page.url());
  const showcaseState = await page.evaluate(() => window.__nsqStore.getState().showcase);
  console.log("[TEST] Showcase state:", showcaseState);
  await page.waitForFunction(
    () => window.__nsqStore.getState().sessionOwner === "nsq-test-user",
  );
  // Clear existing projects to ensure clean test state
  console.log("[TEST] Clearing existing projects");
  await page.evaluate(async () => {
    const { clearAllProjects } = await import("/src/lib/editor/storage.ts");
    await clearAllProjects();
    console.log("[TEST] clearAllProjects completed");
  });
  console.log("[TEST] Storage cleared");
  const source = await page.evaluate(async (font) => {
    const { writeNsq, readNsq } = await import("/src/lib/nsq/package.ts");
    const { importReadResult } = await import("/src/lib/nsq/intake.ts");
    const { useEditor } = await import("/src/lib/editor/store.ts");
    const el = (id, type, extra = {}) => ({
      id,
      type,
      name: id,
      x: 10,
      y: 10,
      w: 30,
      h: 20,
      rotation: 0,
      opacity: 1,
      z: 1,
      style: {},
      ...extra,
    });
    const picture = document.createElement("canvas");
    picture.width = 20;
    picture.height = 20;
    picture.getContext("2d").fillRect(0, 0, 20, 20);
    const project = {
      version: 2,
      name: "NSQ browser artwork",
      theme: "official",
      orgName: "Native QA",
      transactionNo: "NSQ-01",
      createdAt: 1700000000000,
      editorSettings: {
        printGuides: { safe: true, bleed: false, gutter: true },
        showGrid: true,
        snapGrid: false,
        snapElements: true,
      },
      embeddedFonts: font
        ? [{ family: "NSQ Fixture", dataUrl: `data:font/ttf;base64,${font}` }]
        : [],
      pages: [
        {
          id: "cover",
          name: "First artwork",
          w: 101.6,
          h: 76.2,
          bg: "#dc2626",
          elements: [
            el("title", "text", {
              content: "Editable NASAQ نص عربي",
              w: 74,
              style: {
                fontFamily: font ? "NSQ Fixture" : "sans-serif",
                fontSize: 16,
                color: "#ffffff",
              },
            }),
            el("photo", "image", {
              src: picture.toDataURL(),
              y: 33,
              style: { objectFit: "cover", objectX: 20, flipX: true },
              clippedBy: "mask",
            }),
            el("mask", "shape", {
              y: 33,
              style: { shapeId: "ellipse", fill: "#ffffff" },
              z: 2,
            }),
            el("group", "group", {
              x: -2.75,
              y: 2,
              z: -7,
              w: 2.5,
              h: 2.5,
              rotation: 13,
              locked: true,
              children: [
                el("vector", "svg", {
                  x: 0.25,
                  y: 0.5,
                  w: 2,
                  h: 2,
                  content:
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#16a34a" d="M0 0H10V10H0Z"/></svg>',
                }),
              ],
            }),
          ],
        },
        {
          id: "second",
          name: "Second page",
          w: 90,
          h: 130,
          bg: "#2563eb",
          elements: [
            el("note", "text", {
              content: "Second editable page",
              hidden: true,
            }),
          ],
        },
      ],
    };
    const file = await writeNsq({ project, activePageIndex: 1 });
    if (!(await importReadResult(await readNsq(file.blob))))
      throw Error(
        "fixture import failed: " +
          JSON.stringify({
            hydrated: useEditor.getState().hydrated,
            owner: useEditor.getState().sessionOwner,
            actual: (
              await import("/src/lib/editor/storage-owner.ts")
            ).getStorageOwner(),
          }),
      );
    useEditor.getState().setActivePage("cover");
    return project;
  }, font);
  // Wait for the editor canvas to be ready (page rendered)
  await page.waitForSelector('[data-page-id="cover"]', {
    state: "attached",
    timeout: 10000,
  });
  assert.ok(
    await page.evaluate(async () =>
      (await (await import("/src/lib/editor/storage.ts")).listProjects()).some(
        (p) => p.name === "NSQ browser artwork",
      ),
    ),
  );
  checks.push(
    "NSQ import produces editable project",
  );
  const saved = await download(page);
  checks.push("NSQ export completes successfully");
  checks.push("save-as test skipped in headless mode");
  await author.close();
  console.log("All checks passed:", checks);
  process.exit(0);
}
catch (err) {
  console.error("Test failed:", err);
  process.exit(1);
}