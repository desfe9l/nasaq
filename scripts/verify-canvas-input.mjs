// Focused interactive regression against the dev editor (uses its real store
// only to seed fixtures; all manipulation uses browser/CDP pointer input).
// node scripts/verify-canvas-input.mjs [baseURL]
// Optional CHROMIUM_PATH for environments with a system browser.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});
const base = process.argv[2] || "http://127.0.0.1:8080";
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem("nasaq.onboarding.v1", "done"),
  );
  await page.goto(`${base}/editor`);
  await page.locator(".editor-canvas-stage").waitFor();
  await page.waitForTimeout(1200);
  await page.evaluate(async () => {
    window.editor = (await import("/src/lib/editor/store.ts")).useEditor;
    window.makeEl = (await import("/src/lib/editor/model.ts")).createElement;
  });
  const fixture = async (over = {}) => {
    await page.evaluate((over) => {
      const s = window.editor.getState();
      const el = window.makeEl("box", {
        id: "qa-box",
        x: 50,
        y: 50,
        w: 70,
        h: 45,
        ...over,
      });
      window.editor.setState({
        id: "qa-project",
        pages: [{ ...s.pages[0], id: "qa-page", elements: [el] }],
        activePageId: "qa-page",
        selectedIds: [],
        selectedId: null,
        enteredGroupId: null,
        editingId: null,
        zoom: 1,
        previewAll: false,
        snapGrid: false,
        snapElements: false,
        bubbleEnabled: false,
        rightOpen: false,
        leftOpen: false,
        leftCollapsed: true,
        rightCollapsed: true,
        contextMenu: null,
        past: [],
        future: [],
      });
      window.editor.getState().commit();
    }, over);
    await page.waitForTimeout(180);
    await page.evaluate(() => window.editor.setState({ zoom: 1 }));
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const stage = document.querySelector(".editor-canvas-stage");
      const r = document
        .querySelector('.canvas-el[data-el-id="qa-box"]')
        .getBoundingClientRect();
      const v = stage.getBoundingClientRect();
      stage.scrollLeft += r.x + r.width / 2 - v.x - v.width / 2;
      stage.scrollTop += r.y + r.height / 2 - v.y - v.height / 2;
    });
    await page.waitForTimeout(100);
  };
  const state = () =>
    page.evaluate(() => {
      const s = window.editor.getState(),
        stage = document.querySelector(".editor-canvas-stage");
      return {
        el: s.pages[0].elements[0],
        zoom: s.zoom,
        selected: s.selectedId,
        menu: s.contextMenu,
        past: s.past.length,
        scrollX: stage.scrollLeft,
        scrollY: stage.scrollTop,
        uiScale: window.visualViewport.scale,
      };
    });
  const box = async (selector = '.canvas-el[data-el-id="qa-box"]') => {
    const r = await page
      .locator(
        selector.startsWith(".canvas-el") ||
          selector.startsWith(".selection-frame") ||
          selector.startsWith("[data-page-id")
          ? `.editor-canvas-stage ${selector.startsWith(".canvas-el") ? "[data-page-id] " : ""}${selector}`
          : selector,
      )
      .boundingBox();
    assert.ok(r);
    return r;
  };
  const center = async (selector) => {
    const r = await box(selector);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, i) => ({
        id: p.id ?? i + 1,
        x: p.x,
        y: p.y,
        radiusX: 3,
        radiusY: 3,
      })),
    });
  const pen = (type, p) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: p.x,
      y: p.y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      pointerType: "pen",
      force: type === "mouseReleased" ? 0 : 0.5,
    });
  const penDrag = async (a, b) => {
    await pen("mousePressed", a);
    await pen("mouseMoved", b);
    await pen("mouseReleased", b);
    await page.waitForTimeout(80);
  };
  const pass = (name) => {
    results.push(name);
    console.log("PASS", name);
  };

  await fixture();
  let c = await center();
  const chromeBefore = await box(".editor-toolbar");
  let before = await state();
  await touch("touchStart", [{ x: c.x - 45, y: c.y }]);
  await touch("touchStart", [
    { x: c.x - 45, y: c.y },
    { x: c.x + 45, y: c.y },
  ]);
  await touch("touchMove", [
    { x: c.x - 80, y: c.y },
    { x: c.x + 80, y: c.y },
  ]);
  await touch("touchEnd", []);
  await page.waitForTimeout(250);
  let after = await state();
  assert.ok(after.zoom > before.zoom + 0.5);
  assert.equal(after.past, before.past);
  assert.equal(after.uiScale, 1);
  assert.deepEqual(await box(".editor-toolbar"), chromeBefore);
  pass(
    "two-finger pinch from artwork zooms only canvas; toolbar/browser scale unchanged; no undo",
  );

  await fixture();
  c = await center();
  before = await state();
  await touch("touchStart", [
    { x: c.x - 45, y: c.y },
    { x: c.x + 45, y: c.y },
  ]);
  await touch("touchMove", [
    { x: c.x - 15, y: c.y + 25 },
    { x: c.x + 75, y: c.y + 25 },
  ]);
  await touch("touchEnd", []);
  await page.waitForTimeout(150);
  after = await state();
  assert.ok(Math.abs(after.scrollX - before.scrollX + 30) < 3);
  assert.ok(Math.abs(after.scrollY - before.scrollY + 25) < 3);
  assert.equal(after.zoom, before.zoom);
  assert.equal(after.el.x, before.el.x);
  pass("two-finger pan does not move artwork or zoom");

  await fixture();
  c = await center();
  before = await state();
  await penDrag(c, { x: c.x + 35, y: c.y + 20 });
  after = await state();
  assert.ok(after.el.x > before.el.x + 5);
  assert.equal(after.selected, "qa-box");
  assert.equal(after.el.w, before.el.w);
  assert.equal(after.zoom, before.zoom);
  pass("pen selects/drags element only");
  let h = await center(".selection-frame .handle.se");
  before = await state();
  await penDrag(h, { x: h.x + 30, y: h.y + 25 });
  after = await state();
  assert.ok(after.el.w > before.el.w + 5);
  assert.equal(after.el.x, before.el.x);
  pass("pen resize handle resizes without moving element");
  h = await center(".selection-frame .rotate-handle.ne");
  before = await state();
  await penDrag(h, { x: h.x + 25, y: h.y + 35 });
  after = await state();
  assert.ok(Math.abs(after.el.rotation - before.el.rotation) > 2);
  assert.equal(after.el.w, before.el.w);
  pass("pen rotation handle rotates only");

  await fixture();
  await page.waitForTimeout(550);
  await page.evaluate(() => window.editor.getState().select("qa-box"));
  await page.waitForTimeout(100);
  h = await center(".selection-frame .handle.se");
  before = await state();
  await touch("touchStart", [h]);
  await touch("touchStart", [h, { x: h.x - 100, y: h.y - 70 }]);
  await touch("touchMove", [
    { x: h.x + 20, y: h.y + 20 },
    { x: h.x - 130, y: h.y - 70 },
  ]);
  await touch("touchEnd", [{ id: 1, x: h.x + 20, y: h.y + 20 }]);
  await page.waitForTimeout(650);
  assert.equal((await state()).menu, null);
  await touch("touchEnd", []);
  after = await state();
  assert.ok(after.el.w > before.el.w);
  assert.equal(after.zoom, before.zoom);
  assert.equal(after.el.x, before.el.x);
  pass(
    "resize owns its pointer despite another finger; no pinch/undo/long-press takeover",
  );

  for (const zoom of [0.2, 1, 2]) {
    await fixture({ w: 4, h: 4 });
    await page.evaluate((zoom) => {
      window.editor.setState({ zoom });
      window.editor.getState().select("qa-box");
    }, zoom);
    await page.waitForTimeout(100);
    const targets = await page
      .locator(".selection-frame .handle, .selection-frame .rotate-handle")
      .evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().toJSON()));
    for (let i = 0; i < targets.length; i++)
      for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i],
          b = targets[j];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left),
          overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        assert.ok(
          overlapX < 0.5 || overlapY < 0.5,
          `overlapping handle targets at zoom ${zoom}: ${i},${j}`,
        );
      }
    assert.ok(targets[0].width >= 43.9);
  }
  pass(
    "44px outward corner targets remain disjoint from other grips on tiny artwork at 20/100/200 percent",
  );

  await fixture();
  await page.evaluate(() => {
    window.editor.getState().select("qa-box");
    window.editor.setState({ bubbleEnabled: true });
  });
  await page.waitForTimeout(200);
  const bubble = await box(".floating-toolbar");
  const grips = await page
    .locator(".selection-frame .handle, .selection-frame .rotate-handle")
    .evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().toJSON()));
  for (const grip of grips) {
    assert.ok(
      Math.min(bubble.x + bubble.width, grip.right) <=
        Math.max(bubble.x, grip.left) ||
        Math.min(bubble.y + bubble.height, grip.bottom) <=
          Math.max(bubble.y, grip.top),
    );
  }
  pass("floating canvas toolbar clears the actual handle hit regions");

  for (const type of ["pen", "touch"]) {
    await fixture();
    await page.waitForTimeout(550);
    c = await center();
    before = await state();
    if (type === "pen") await pen("mousePressed", c);
    else await touch("touchStart", [c]);
    await page.waitForTimeout(650);
    assert.equal((await state()).menu?.targetId, "qa-box");
    if (type === "pen") await pen("mouseReleased", c);
    else await touch("touchEnd", []);
    after = await state();
    assert.equal(after.el.x, before.el.x);
    assert.equal(after.past, before.past);
    pass(
      `${type} long press opens existing context menu without dragging/history`,
    );
  }

  await fixture();
  await page.waitForTimeout(550);
  c = await center();
  await touch("touchStart", [c]);
  await touch("touchMove", [{ x: c.x + 25, y: c.y }]);
  await page.waitForTimeout(650);
  assert.equal((await state()).menu, null);
  await touch("touchEnd", []);
  pass("movement cancels long press, including a held drag");
  before = await state();
  c = await center();
  await touch("touchStart", [
    { x: c.x - 25, y: c.y },
    { x: c.x + 25, y: c.y },
  ]);
  await touch("touchEnd", [{ id: 2, x: c.x + 25, y: c.y }]);
  await touch("touchEnd", []);
  after = await state();
  assert.equal(after.past, before.past - 1);
  assert.equal(after.el.x, 50);
  pass(
    "two-finger tap undoes exactly one real history entry with sequential lifts",
  );

  for (const [name, x, grabFraction] of [
    ["fully outside", -75, 0.5],
    ["half outside", -35, 0.2],
  ]) {
    await fixture({ x });
    c = await center();
    const r = await box();
    c.x = r.x + r.width * grabFraction;
    const art = await box('[data-page-id="qa-page"]');
    assert.ok(c.x < art.x);
    before = await state();
    await penDrag(c, { x: c.x + 20, y: c.y + 5 });
    after = await state();
    assert.equal(after.selected, "qa-box");
    assert.ok(after.el.x > before.el.x);
    pass(`${name} artboard: pen grabs visible overflow`);
  }

  await fixture();
  await page.waitForTimeout(550);
  c = await center();
  await touch("touchStart", [c]);
  await touch("touchCancel", []);
  await page.waitForTimeout(650);
  assert.equal((await state()).menu, null);
  await penDrag(c, { x: c.x + 20, y: c.y });
  assert.ok((await state()).el.x > 50);
  pass(
    "pointercancel clears the long-press timer and releases ownership for the next pen drag",
  );

  await fixture();
  await page.evaluate(() => window.editor.setState({ id: undefined }));
  await page.waitForTimeout(180);
  await page.evaluate(() => window.editor.setState({ zoom: 1.25 }));
  await page.evaluate(() => window.editor.setState({ id: "qa-first-save" }));
  await page.waitForTimeout(200);
  assert.equal((await state()).zoom, 1.25);
  await page.evaluate(() => window.editor.getState().select("qa-box"));
  assert.equal((await state()).zoom, 1.25);
  pass("selection and first autosave id assignment preserve authored zoom");

  await fixture();
  before = await state();
  const stageBefore = await box(".editor-canvas-stage");
  await page.evaluate(() => window.editor.setState({ rightOpen: true }));
  await page.waitForTimeout(250);
  const sheet = await box(".touch-properties-sheet");
  assert.equal(sheet.height, 320);
  assert.ok(sheet.width <= 340);
  assert.deepEqual(await box(".editor-canvas-stage"), stageBefore);
  assert.equal((await state()).zoom, before.zoom);
  await page.getByRole("button", { name: "طي الخصائص", exact: true }).click();
  await page.waitForTimeout(220);
  assert.equal((await box(".touch-properties-sheet")).height, 56);
  await page
    .getByRole("button", { name: "توسيع الخصائص", exact: true })
    .click();
  await page.waitForTimeout(220);
  const grip = await center(".touch-properties-grip");
  await touch("touchStart", [grip]);
  await touch("touchMove", [{ x: grip.x, y: grip.y - 70 }]);
  await touch("touchEnd", []);
  assert.ok((await box(".touch-properties-sheet")).height > 360);
  pass(
    "compact, draggable, collapsible non-modal iPad properties; viewport unchanged",
  );
  await page.screenshot({ path: "screenshots/ipad-input-verified.png" });
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 1366, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const r = await box(".touch-properties-sheet");
    assert.ok(r.x >= 0 && r.x + r.width <= viewport.width);
    assert.ok(r.height <= viewport.height * 0.72 + 1);
    assert.ok((await box(".editor-canvas-stage")).height > 250);
  }
  pass(
    "properties fit iPad portrait/Pro landscape and iPhone without entering canvas grid",
  );

  await context.close();
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const d = await desktop.newPage();
  d.on("pageerror", (e) => errors.push(e.message));
  await d.addInitScript(() =>
    localStorage.setItem("nasaq.onboarding.v1", "done"),
  );
  await d.goto(`${base}/editor`);
  await d.locator(".editor-canvas-stage").waitFor();
  await d.waitForTimeout(900);
  await d.evaluate(async () => {
    window.editor = (await import("/src/lib/editor/store.ts")).useEditor;
    const make = (await import("/src/lib/editor/model.ts")).createElement;
    const s = window.editor.getState();
    window.editor.setState({
      pages: [
        {
          ...s.pages[0],
          id: "desktop-page",
          elements: [
            make("text", { id: "desktop-text", x: 50, y: 70, w: 80, h: 30 }),
          ],
        },
      ],
      activePageId: "desktop-page",
      previewAll: false,
      zoom: 0.6,
      selectedId: null,
      selectedIds: [],
      snapGrid: false,
      snapElements: false,
      bubbleEnabled: false,
      past: [],
      future: [],
    });
    window.editor.getState().commit();
  });
  await d.waitForTimeout(200);
  const el = d.locator(
    '.editor-canvas-stage [data-page-id] .canvas-el[data-el-id="desktop-text"]',
  );
  await el.scrollIntoViewIfNeeded();
  let r = await el.boundingBox();
  await d.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await d.mouse.down();
  await d.mouse.move(r.x + r.width / 2 + 30, r.y + r.height / 2 + 15, {
    steps: 5,
  });
  await d.mouse.up();
  assert.ok(
    await d.evaluate(
      () => window.editor.getState().pages[0].elements[0].x > 50,
    ),
  );
  await d.keyboard.press("Control+z");
  await d.waitForTimeout(100);
  assert.equal(
    await d.evaluate(() => window.editor.getState().pages[0].elements[0].x),
    50,
  );
  const stage = await d.locator(".editor-canvas-stage").boundingBox();
  await d.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  const z = await d.evaluate(() => window.editor.getState().zoom);
  await d.keyboard.down("Control");
  await d.mouse.wheel(0, -100);
  await d.keyboard.up("Control");
  await d.waitForTimeout(180);
  assert.ok(await d.evaluate((z) => window.editor.getState().zoom > z, z));
  await d.keyboard.press("Meta+0");
  await d.waitForTimeout(180);
  assert.ok(
    await d.evaluate(() => {
      const stage = document
        .querySelector(".editor-canvas-stage")
        .getBoundingClientRect();
      const art = document
        .querySelector('[data-page-id="desktop-page"]')
        .getBoundingClientRect();
      return art.width <= stage.width && art.height <= stage.height;
    }),
  );
  const wheelZoom = await d.evaluate(() => window.editor.getState().zoom);
  await d.mouse.wheel(0, 50);
  await d.waitForTimeout(100);
  assert.equal(
    await d.evaluate(() => window.editor.getState().zoom),
    wheelZoom,
  );
  const frame = d.locator(".selection-frame");
  if (await frame.count()) await frame.dblclick();
  else await el.dblclick();
  assert.ok(await d.locator("[contenteditable=true]").count());
  pass(
    "desktop mouse drag, Ctrl+wheel zoom, Cmd+0 and double-click text editing",
  );
  assert.deepEqual(errors, []);
  pass("no uncaught browser errors");
  await desktop.close();
  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} finally {
  await browser.close();
}
