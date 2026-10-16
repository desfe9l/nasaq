/** PSD import regression check: run against npm run dev.
 *
 * Guards the defect where importing a Photoshop file into the editor froze the
 * studio with «Too many re-renders» (React #301, "Maximum update depth
 * exceeded"): every PSD vector layer converts to an `svg` element with path
 * data, and the vector node overlay called a state setter during render for
 * any element with content, so a single imported shape re-rendered forever and
 * the error boundary replaced the editor. The check imports a generated PSD
 * through the editor's real file picker, then reloads the saved document (the
 * import service's save → navigate path) and requires the studio to open with
 * its elements both times. Auth endpoints are mocked; IndexedDB, the editor
 * and the PSD pipeline are real. NSQ_TEST_URL / BROWSER_EXECUTABLE override
 * local defaults. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { initializeCanvas, writePsd } from "ag-psd";

const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
const output = ".cache/psd-import-check";
mkdirSync(output, { recursive: true });

initializeCanvas(
  (() => {
    throw new Error("canvas is not used by the fixture");
  }),
  (width, height) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  }),
);

function solid(width, height, r, g, b) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function checker(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const on = ((x >> 2) ^ (y >> 2)) & 1;
      data[i] = on ? 210 : 12;
      data[i + 1] = on ? 40 : 70;
      data[i + 2] = on ? 32 : 150;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A compact but realistic template: raster layers, a group, Arabic text and a
 *  vector shape — the vector layer is what used to crash the editor. */
function templatePsd() {
  const children = [];
  for (let i = 0; i < 12; i += 1) {
    children.push({
      name: `طبقة ${i}`,
      left: 10 + i,
      top: 8 + i * 3,
      right: 60 + i,
      bottom: 40 + i * 3,
      imageData: solid(50 + (i % 5), 32, (i * 11) % 255, 60, 120),
    });
  }
  children.push({
    name: "المحتوى",
    children: [
      { name: "Photo", left: 20, top: 20, right: 220, bottom: 140, imageData: checker(200, 120) },
      { name: "شعار", left: 30, top: 30, right: 110, bottom: 70, imageData: solid(80, 40, 12, 90, 50) },
    ],
  });
  children.push({
    name: "عنوان الخبر",
    left: 30,
    top: 260,
    right: 620,
    bottom: 330,
    text: {
      text: "تقرير نَسَق السنوي",
      style: { font: { name: "Cairo" }, fontSize: 28, fillColor: { r: 12, g: 20, b: 30 } },
      paragraphStyle: { justification: "right" },
    },
  });
  children.push({
    name: "شكل متجهي",
    left: 320,
    top: 200,
    right: 520,
    bottom: 280,
    vectorFill: { type: "color", color: { r: 30, g: 90, b: 60 } },
    vectorMask: {
      paths: [
        {
          open: false,
          fillRule: "non-zero",
          operation: "combine",
          knots: [
            { linked: true, points: [320, 200, 320, 200, 320, 200] },
            { linked: true, points: [520, 200, 520, 200, 520, 200] },
            { linked: true, points: [420, 280, 420, 280, 420, 280] },
          ],
        },
      ],
    },
  });
  return Buffer.from(writePsd({ width: 900, height: 640, children }, { noBackground: true }));
}

/** Signatures of the defect and of the error boundary that replaces the studio. */
const LOOP = /Too many re-renders|Maximum update depth|getSnapshot should be cached/i;
const BOUNDARY = /Something went wrong/i;

const psd = templatePsd();
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("nasaq.onboarding.v1", "done");
  } catch {
    /* some third-party frames forbid storage */
  }
});
await ctx.route("https://fonts.googleapis.com/**", (r) =>
  r.fulfill({ contentType: "text/css", body: "" }),
);
await ctx.route("https://grok.com/**", (r) =>
  r.fulfill({ contentType: "application/javascript", body: "" }),
);
await ctx.route("**/api/auth/get-session**", (r) =>
  r.fulfill({
    json: {
      user: {
        id: "nsq-test-user",
        email: "reader@example.test",
        name: "Reader",
        emailVerified: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      session: {
        id: "test-session",
        userId: "nsq-test-user",
        token: "test-only",
        expiresAt: "2099-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    },
  }),
);

const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push({ type: m.type(), text: m.text() }));
page.on("pageerror", (e) => logs.push({ type: "pageerror", text: String(e?.message || e) }));

const state = () =>
  page.evaluate(() => {
    const s = window.__nsqStore?.getState?.();
    return s
      ? {
          id: s.id,
          phase: s.documentPhase,
          pages: s.pages?.length ?? 0,
          elements: s.pages?.[0]?.elements?.length ?? 0,
        }
      : null;
  });

const assertStudioAlive = async (stage) => {
  const body = await page.evaluate(() => document.body.innerText || "");
  assert.ok(!LOOP.test(body), `${stage}: editor shows the render loop message`);
  assert.ok(!BOUNDARY.test(body), `${stage}: editor was replaced by the error boundary`);
  const loops = logs.filter((entry) => LOOP.test(entry.text));
  assert.deepEqual(
    loops.map((entry) => entry.text.slice(0, 160)),
    [],
    `${stage}: React reported a render loop`,
  );
};

try {
  await page.goto(`${base}/create`, { waitUntil: "domcontentloaded" });

  /* A blank document on a licensed account: the free plan refuses a second
   * saved project, which would stop the import before the editor ever renders
   * the PSD (a licence decision, not this defect). */
  const created = await page.evaluate(async () => {
    const { useEditor } = await import("/src/lib/editor/store.ts");
    const { buildNewDocument, defaultNewDocument } = await import(
      "/src/lib/editor/new-document.ts"
    );
    await useEditor.getState().hydrate();
    useEditor.getState().setEntitlements({ ...(await import("/src/lib/license/types.ts")).LICENSE_ENTITLEMENTS.PRO });
    const ok = await useEditor
      .getState()
      .createDocument(buildNewDocument(defaultNewDocument({ name: "PSD import check", pages: 1 })));
    return { ok, id: useEditor.getState().id };
  });
  assert.ok(created.ok && created.id, "could not create the starting document");

  await page.goto(`${base}/editor/${created.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__nsqStore?.getState?.().documentPhase === "ready",
    null,
    { timeout: 60000 },
  );

  /* The import itself runs through the editor's real picker. The licence state
   * is re-applied on the LIVE dev store (`window.__nsqStore` — a bare module
   * import can hand back a second, HMR-stamped store instance) and pinned,
   * because a mocked test session cannot pass the server's licence middleware:
   * the background revalidation would otherwise downgrade this deliberately
   * licensed run mid-import, and the free tier refuses the second project. */
  await page.evaluate(async () => {
    const { LICENSE_ENTITLEMENTS } = await import("/src/lib/license/types.ts");
    const store = window.__nsqStore;
    if (!store) throw new Error("the dev store is not exposed");
    const original = store.getState().setEntitlements;
    original.call(store.getState(), { ...LICENSE_ENTITLEMENTS.PRO });
    store.setState({
      setEntitlements: (next, owner) =>
        next && next.unlimited_projects
          ? original.call(store.getState(), next, owner)
          : undefined,
    });
  });
  const input = page.locator('input[type="file"][accept*=".psd"]').first();
  await input.setInputFiles(
    { name: "template.psd", mimeType: "image/vnd.adobe.photoshop", buffer: psd },
    { timeout: 30000 },
  );
  await page.waitForFunction(
    (previousId) => {
      const s = window.__nsqStore?.getState?.();
      return Boolean(s && s.id && s.id !== previousId && s.documentPhase === "ready");
    },
    created.id,
    { timeout: 60000 },
  );
  const imported = await state();
  assert.ok(imported.elements > 0, "the imported document opened empty");
  await assertStudioAlive("import");
  await page.screenshot({ path: `${output}/after-import.png` });

  /* The import service saves first and then navigates the browser to the
   * document's own address — the cold load is where the loop also surfaced. */
  await page.goto(`${base}/editor/${imported.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__nsqStore?.getState?.().documentPhase === "ready",
    null,
    { timeout: 60000 },
  );
  const reloaded = await state();
  assert.equal(reloaded.id, imported.id, "the cold load opened a different document");
  assert.ok(reloaded.elements > 0, "the cold load opened the document empty");
  await assertStudioAlive("cold load");
  await page.screenshot({ path: `${output}/after-reload.png` });

  console.log(
    `[psd-import-check] ok — imported ${imported.elements} elements, reloaded ${reloaded.elements}`,
  );
} finally {
  await browser.close();
}
