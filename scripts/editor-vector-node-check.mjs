/** Vector node editing regression check: run against npm run dev.
 *
 * Guards the interaction the studio advertised but never actually delivered:
 * a selected Photoshop vector shape showed node handles that could not be
 * grabbed. Four independent root causes, all covered here:
 *
 *   1. the overlay was mounted for EVERY svg element on a live page (and was
 *      `pointer-events: none`, so nothing could ever be dragged);
 *   2. the point parser scraped numbers out of the whole markup (viewBox
 *      included) and a drag committed a bare path string over `el.content`,
 *      replacing the drawing with text;
 *   3. the overlay lived inside `.canvas-svg-content` (`overflow: hidden`), so
 *      every handle on an element's edge was clipped away for hit testing;
 *   4. the selection frame — and, in capture, the stage's own element-move
 *      gesture — swallowed the press, so an edge node drag MOVED THE ELEMENT.
 *
 * Node editing is therefore a MODE, the way in-place text editing is: the
 * shape is selected first (`select`), double-clicking the artwork enters node
 * editing, the selection frame yields (`.is-node-editing`), Escape leaves.
 * This check drives that exact path: it imports a generated PSD through the
 * editor's real file picker, requires handles ONLY after entering the mode,
 * requires them for exactly one element, drags the anchor that sits exactly
 * where the frame's NE handle sits with a real mouse, requires the drawn
 * geometry to change while the element stays put and the markup survives
 * (still an `<svg>` with its viewBox), and requires ONE undo to restore the
 * exact original content. Escape then leaves the mode without losing the
 * selection.
 *
 * Auth endpoints are mocked; IndexedDB, the editor and the PSD pipeline are
 * real. NSQ_TEST_URL / BROWSER_EXECUTABLE override local defaults.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { initializeCanvas, writePsd } from "ag-psd";

const base = process.env.NSQ_TEST_URL || "http://127.0.0.1:8080";
const output = ".cache/vector-node-check";
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

/** One vector layer (the editable target) plus raster + Arabic text layers. */
function fixturePsd() {
  return Buffer.from(
    writePsd(
      {
        width: 900,
        height: 640,
        children: [
          {
            name: "خلفية",
            left: 0,
            top: 0,
            right: 420,
            bottom: 200,
            imageData: solid(420, 200, 14, 24, 40),
          },
          {
            name: "عنوان",
            left: 30,
            top: 260,
            right: 620,
            bottom: 330,
            text: {
              text: "تصميم متجهي",
              style: {
                font: { name: "Cairo" },
                fontSize: 28,
                fillColor: { r: 12, g: 20, b: 30 },
              },
              paragraphStyle: { justification: "right" },
            },
          },
          {
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
          },
        ],
      },
      { noBackground: true },
    ),
  );
}

const LOOP = /Too many re-renders|Maximum update depth|getSnapshot should be cached/i;
const BOUNDARY = /Something went wrong/i;

const psd = fixturePsd();
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
        updatedAt: "2099-01-01T00:00:00Z",
      },
    },
  }),
);

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e?.message || e)));
page.on("console", (m) => {
  if (m.type() === "error" && LOOP.test(m.text())) errors.push(m.text());
});

/**
 * Read the imported svg element out of the LIVE dev store.
 *
 * `window.__nsqStore` is the app's own store instance. A bare module import of
 * `/src/lib/editor/store.ts` can hand back a SECOND instance (Vite stamps the
 * app's module URL with an HMR timestamp after any edit), whose state is stale
 * — the exact trap that made an earlier version of this check chase ghosts.
 */
const readSvg = () =>
  page.evaluate(() => {
    const state = window.__nsqStore?.getState?.();
    if (!state) return null;
    const walk = (list) => {
      for (const el of list || []) {
        if (el.type === "svg") return el;
        const inner = walk(el.children);
        if (inner) return inner;
      }
      return null;
    };
    const el = state.pages.map((p) => walk(p.elements)).find(Boolean);
    if (!el) return null;
    const d = /<path\b[^>]*\sd="([^"]*)"/i.exec(el.content || "")?.[1] ?? null;
    return {
      id: el.id,
      content: el.content,
      d,
      x: el.x,
      y: el.y,
      locked: Boolean(el.locked),
    };
  });

/** The live store's node-editing / selection state. */
const readState = () =>
  page.evaluate(() => {
    const s = window.__nsqStore?.getState?.();
    return s
      ? {
          selectedId: s.selectedId,
          nodeEditId: s.nodeEditId,
          phase: s.documentPhase,
        }
      : null;
  });

const overlayCount = () => page.locator("[data-vector-node-editor]").count();

/**
 * `/create` performs a soft reload of its own while Vite finishes hydrating, so
 * an evaluate fired at `domcontentloaded` can land in a destroyed context. The
 * work is idempotent (`hydrate` + `createDocument` both are), so retrying the
 * same evaluate is safe — and retrying is the honest fix, not a sleep.
 */
async function evaluateStable(fn, arg) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await page.evaluate(fn, arg);
    } catch (error) {
      if (attempt >= 3 || !/context was destroyed|navigation/i.test(String(error)))
        throw error;
      await page.waitForFunction(() => document.readyState === "complete");
    }
  }
}

try {
  await page.goto(`${base}/create`, { waitUntil: "domcontentloaded" });

  const created = await evaluateStable(async () => {
    const { useEditor } = await import("/src/lib/editor/store.ts");
    const { buildNewDocument, defaultNewDocument } = await import(
      "/src/lib/editor/new-document.ts"
    );
    await useEditor.getState().hydrate();
    useEditor
      .getState()
      .setEntitlements({
        ...(await import("/src/lib/license/types.ts")).LICENSE_ENTITLEMENTS.PRO,
      });
    const ok = await useEditor
      .getState()
      .createDocument(
        buildNewDocument(defaultNewDocument({ name: "Vector node check", pages: 1 })),
      );
    return { ok, id: useEditor.getState().id };
  });
  assert.ok(created.ok && created.id, "could not create the starting document");

  await page.goto(`${base}/editor/${created.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__nsqStore?.getState?.().documentPhase === "ready",
    null,
    { timeout: 60000 },
  );

  /*
   * A mocked-session check browser cannot pass the server's licence middleware,
   * so the background revalidation would downgrade this deliberately licensed
   * run back to the free tier — and the free tier refuses the second saved
   * project, stopping the import before the drawing ever renders. Pin the plan
   * on the live store for the duration of the check.
   */
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
    { name: "fixture.psd", mimeType: "image/vnd.adobe.photoshop", buffer: psd },
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

  const before = await readSvg();
  assert.ok(before, "the imported document has no svg element to edit");

  /* NOTHING is selected yet: a live page must not paint handles on artwork
   * nobody selected (the overlay used to mount for every svg element). */
  assert.equal(
    await overlayCount(),
    0,
    "node handles were rendered before any selection",
  );

  /* Select the shape: the frame appears — but node editing is a MODE, so a
   * plain selection must not sprout handles yet. */
  await page.evaluate((id) => {
    window.__nsqStore.getState().select(id);
  }, before.id);
  await page.waitForSelector('.selection-frame[data-el-id]', { timeout: 15000 });
  assert.equal(
    await overlayCount(),
    0,
    "node handles appeared on selection instead of on entering node editing",
  );

  /* Enter node editing the way the author does: double-click the artwork. */
  const artwork = page.locator(`.canvas-el[data-el-id="${before.id}"]`).first();
  const artBox = await artwork.boundingBox();
  assert.ok(artBox && artBox.width > 0, "the imported shape has no box on screen");
  await page.mouse.dblclick(artBox.x + artBox.width / 2, artBox.y + artBox.height / 2);
  await page.waitForSelector("[data-vector-node-editor]", { timeout: 15000 });

  const entered = await readState();
  assert.equal(entered.nodeEditId, before.id, "double-click did not enter node editing");
  assert.equal(await overlayCount(), 1, "expected one overlay for one selection");
  const handles = await page.locator('[data-node-part="point"]').count();
  assert.ok(handles >= 3, `expected the triangle's handles, found ${handles}`);
  await page.screenshot({ path: `${output}/before-drag.png` });

  /*
   * Real mouse drag on the second anchor — the artwork's top-right corner, the
   * one point that sits EXACTLY where the selection frame's NE resize handle
   * sits. This is the regression: the press used to be captured by the frame
   * (or by the stage's element-move gesture) and moved the element.
   */
  const handle = page.locator('[data-node-part="point"]').nth(1);
  const box = await handle.boundingBox();
  assert.ok(box && box.width > 0, "the anchor handle has no hit area");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  /* The press must reach a node handle — not the element, not the frame. */
  const hitPart = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.getAttribute?.("data-node-part") ?? null;
  }, from);
  assert.ok(
    hitPart,
    "the press at the anchor lands on the artwork instead of a node handle",
  );

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 45, from.y + 35, { steps: 10 });
  await page.mouse.up();

  await page.waitForFunction(
    (original) => {
      const state = window.__nsqStore?.getState?.();
      const walk = (list) => {
        for (const el of list || []) {
          if (el.type === "svg") return el;
          const inner = walk(el.children);
          if (inner) return inner;
        }
        return null;
      };
      const el = state?.pages.map((p) => walk(p.elements)).find(Boolean);
      return Boolean(el && el.content !== original);
    },
    before.content,
    { timeout: 15000 },
  );

  const after = await readSvg();
  assert.equal(after.x, before.x, "the node drag moved the ELEMENT (x)");
  assert.equal(after.y, before.y, "the node drag moved the ELEMENT (y)");
  assert.ok(
    (after.content || "").includes("<svg"),
    "the drag replaced the drawing's markup",
  );
  for (const kept of ["<svg", "<path", "viewBox=", "xmlns="])
    assert.ok(
      after.content.includes(kept),
      `the drag lost ${kept} from the markup`,
    );
  assert.notEqual(
    after.d,
    before.d,
    `the path geometry did not change\nbefore: ${before.content}\nafter: ${after.content}`,
  );

  /* The rendered artwork must follow the store, not just the overlay. */
  const domPath = await page.evaluate(() => {
    const host = document
      .querySelector("[data-vector-node-editor]")
      ?.closest(".canvas-el");
    return host?.querySelector("path")?.getAttribute("d") ?? null;
  });
  assert.equal(domPath, after.d, "the painted path does not match the document");
  await page.screenshot({ path: `${output}/after-drag.png` });

  /* ONE undo restores the exact prior markup (live frames never pushed). */
  await page.evaluate(() => window.__nsqStore.getState().undo());
  await page.waitForFunction(
    (original) => {
      const state = window.__nsqStore?.getState?.();
      const walk = (list) => {
        for (const el of list || []) {
          if (el.type === "svg") return el;
          const inner = walk(el.children);
          if (inner) return inner;
        }
        return null;
      };
      const el = state?.pages.map((p) => walk(p.elements)).find(Boolean);
      return Boolean(el && el.content === original);
    },
    before.content,
    { timeout: 15000 },
  );
  await page.screenshot({ path: `${output}/after-undo.png` });

  /*
   * Leaving the mode: the editor's own snapshot policy clears the selection on
   * undo, so re-select and re-enter first — Escape must then leave node editing
   * WITHOUT dropping the selection the author is working on.
   */
  await page.evaluate((id) => window.__nsqStore.getState().select(id), before.id);
  const artAgain = await artwork.boundingBox();
  await page.mouse.dblclick(
    artAgain.x + artAgain.width / 2,
    artAgain.y + artAgain.height / 2,
  );
  await page.waitForSelector("[data-vector-node-editor]", { timeout: 15000 });
  await page.screenshot({ path: `${output}/re-entered.png` });

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => document.querySelectorAll("[data-vector-node-editor]").length === 0,
    null,
    { timeout: 15000 },
  );
  const left = await readState();
  assert.equal(left.nodeEditId, null, "Escape did not leave node editing");
  assert.equal(left.selectedId, before.id, "Escape dropped the selection too");

  /* Selecting something else keeps the overlay off for good measure. */
  const otherId = await page.evaluate(() => {
    const state = window.__nsqStore.getState();
    const other = state.pages
      .flatMap((p) => p.elements)
      .find((el) => el.type !== "svg");
    if (!other) return null;
    state.select(other.id);
    return other.id;
  });
  assert.ok(otherId, "the fixture has no non-svg element to select");
  await page.waitForFunction(
    () => document.querySelectorAll("[data-vector-node-editor]").length === 0,
    null,
    { timeout: 15000 },
  );

  const body = await page.evaluate(() => document.body.innerText || "");
  assert.ok(!LOOP.test(body), "the editor shows a render-loop message");
  assert.ok(!BOUNDARY.test(body), "the editor was replaced by the error boundary");
  assert.deepEqual(
    errors.map((e) => e.slice(0, 200)),
    [],
    "the page reported uncaught errors",
  );

  console.log(
    `[vector-node-check] ok — ${handles} handles, press landed on ${hitPart}, ` +
      `d ${before.d?.slice(0, 24)}… → ${after.d?.slice(0, 24)}…, ` +
      `element unmoved (${after.x}, ${after.y}), undo restored the original markup`,
  );
} finally {
  await browser.close();
}
