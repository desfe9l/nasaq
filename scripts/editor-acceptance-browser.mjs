/** Real guest editor, real store and DOM. No authentication or API stubs.
 * Run against npm run dev; BROWSER_EXECUTABLE optionally selects Chromium. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const base = process.env.EDITOR_TEST_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem("nasaq.onboarding.v1", "done");
  performance.setResourceTimingBufferSize(5000);
});
mkdirSync(".cache/editor-acceptance", { recursive: true });
try {
  await page.goto(base + "/editor");
  await page.locator(".editor-canvas-stage").waitFor();
  await page.evaluate(async () => {
    const source = performance.getEntriesByType("resource").find(e => /\/editor\/store\.ts(?:\?|$)/.test(e.name));
    window.store = (await import(source.name)).useEditor;
    await window.store.getState().hydrate();
    const s = window.store.getState();
    window.store.setState({
      pages: [{ ...s.pages[0], elements: [] }],
      activePageId: s.pages[0].id,
      previewAll: false,
      artboardGridCols: 1,
      leftCollapsed: true,
      leftOpen: false,
      rightOpen: false,
      showGrid: false,
      snapGrid: false,
      snapElements: false,
      zoom: 0.8,
    });
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0C3D2C";
    ctx.fillRect(0, 0, 200, 100);
    window.ids = {};
    for (const type of ["image", "text", "shape", "svg", "icon"]) {
      window.ids[type] = s.addElement(type, {
        x: 70,
        y: 90,
        w: 50,
        h: 25,
        src: canvas.toDataURL(),
        content:
          type === "svg"
            ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="#111111"><g fill="#222222"><path d="M2 2h20v20H2z"/></g></svg>'
            : "اختبار التحديد",
        style: { fill: type === "shape" ? "#0C3D2C" : undefined },
      });
    }
    s.select(window.ids.image);
  });
  const select = async (type) => {
    await page.evaluate(
      (type) => window.store.getState().select(window.ids[type]),
      type,
    );
    await page.waitForTimeout(80);
  };
  const measure = (type) =>
    page.evaluate((type) => {
      const id = window.ids[type];
      const node = document.querySelector(
        `.editor-canvas-stage .canvas-el[data-el-id="${id}"]`,
      );
      const frame = document.querySelector(
        `.selection-frame[data-el-id="${id}"]`,
      );
      if (!node || !frame)
        throw new Error(
          JSON.stringify({
            id,
            selected: window.store.getState().selectedId,
            body: document.body.innerText.slice(0, 100),
            els: window.store.getState().pages[0].elements.map((e) => e.id),
          }),
        );
      const a = (
          type === "image" ? node.querySelector("img") : node
        ).getBoundingClientRect(),
        b = frame.getBoundingClientRect();
      return {
        delta: ["x", "y", "width", "height"].map((k) => Math.abs(a[k] - b[k])),
        origin: [
          getComputedStyle(node).transformOrigin,
          getComputedStyle(frame).transformOrigin,
        ],
        rotate: frame.querySelectorAll(".rotate-handle").length,
        background: getComputedStyle(frame).backgroundImage,
      };
    }, type);
  const geometry = async (type) => {
    let result;
    // Frame and node settle after pointer-up; poll rather than sample once.
    for (let attempt = 0; attempt < 12; attempt++) {
      result = await measure(type);
      if (result.delta.every((v) => v < 0.2)) break;
      await page.waitForTimeout(100);
    }
    assert.ok(
      result.delta.every((v) => v < 0.2),
      JSON.stringify(result),
    );
    assert.equal(result.origin[0], result.origin[1]);
    assert.equal(result.rotate, 1);
    assert.equal(result.background, "none");
  };
  for (const type of ["image", "text", "shape", "svg", "icon"]) {
    await select(type);
    for (const zoom of [0.3, 0.8, 1.4]) {
      await page.evaluate(
        (zoom) => window.store.getState().setZoom(zoom),
        zoom,
      );
      await page.waitForTimeout(60);
      await geometry(type);
    }
    await page.evaluate(() => window.store.getState().setZoom(0.8));
    await page.locator(".selection-frame").scrollIntoViewIfNeeded();
    let box = await page.locator(".selection-frame").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 25,
      box.y + box.height / 2 + 20,
      { steps: 5 },
    );
    await page.mouse.up();
    await geometry(type);
    const handle = page.locator(".selection-frame .handle.se");
    box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 20,
      box.y + box.height / 2 + 15,
      { steps: 5 },
    );
    await page.mouse.up();
    await geometry(type);
    box = await page.locator(".selection-frame .rotate-handle").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 45,
      box.y + box.height / 2 + 25,
      { steps: 5 },
    );
    await page.mouse.up();
    await geometry(type);
    assert.ok(
      await page.evaluate(
        (type) =>
          Math.abs(
            window.store
              .getState()
              .pages[0].elements.find((e) => e.id === window.ids[type])
              .rotation,
          ) > 1,
        type,
      ),
      type + " rotation changed",
    );
  }
  // A model box below the old 3mm CSS floor must render at its actual size.
  await select("image");
  await page.evaluate(() =>
    window.store
      .getState()
      .updateElement(window.ids.image, { w: 2, h: 2, rotation: 0 }),
  );
  await geometry("image");
  // Dock picker -> updateStyle -> selected SVG -> inline rendered path, without reselection.
  await select("svg");
  await page
    .getByLabel("اختيار لون التعبئة", { exact: true })
    .evaluate((input) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, "#e04050");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await page.waitForTimeout(80);
  assert.equal(
    await page.evaluate(
      () =>
        window.store
          .getState()
          .pages[0].elements.find((e) => e.id === window.ids.svg).style.svgFill,
    ),
    "#e04050",
  );
  await page.getByLabel("اختيار لون الإطار", { exact: true }).fill("#1255cc");
  await page.waitForTimeout(80);
  const colors = await page.evaluate(() => {
    const path = document.querySelector(
      `.editor-canvas-stage .canvas-el[data-el-id="${window.ids.svg}"] path`,
    );
    return [path.getAttribute("fill"), path.getAttribute("stroke")];
  });
  assert.deepEqual(colors, ["#e04050", "#1255cc"]);
  // The floating picker uses the same fields as the dock and Properties.
  await page
    .locator(".floating-toolbar")
    .getByRole("button", { name: "لون التعبئة", exact: true })
    .click();
  await page.getByRole("textbox", { name: "قيمة HEX" }).fill("#aabbcc");
  await page.getByRole("textbox", { name: "قيمة HEX" }).press("Tab");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(
      () =>
        window.store
          .getState()
          .pages[0].elements.find((e) => e.id === window.ids.svg).style.svgFill,
    ),
    "#aabbcc",
  );
  await select("icon");
  await page.getByLabel("اختيار لون التعبئة", { exact: true }).fill("#ddaa22");
  await page.getByLabel("اختيار لون الإطار", { exact: true }).fill("#2244aa");
  await page.waitForTimeout(80);
  assert.deepEqual(
    await page.evaluate(() => {
      const svg = document.querySelector(
        `.editor-canvas-stage .canvas-el[data-el-id="${window.ids.icon}"] svg`,
      );
      return [svg.getAttribute("fill"), svg.getAttribute("stroke")];
    }),
    ["#ddaa22", "#2244aa"],
  );
  await select("svg");
  const svgViewport = await page.evaluate(() => {
    const node = document.querySelector(
      `.editor-canvas-stage .canvas-el[data-el-id="${window.ids.svg}"]`,
    );
    const a = node.getBoundingClientRect(),
      b = node.querySelector("svg").getBoundingClientRect();
    return [Math.abs(a.width - b.width), Math.abs(a.height - b.height)];
  });
  assert.ok(svgViewport.every((d) => d < 0.2));
  // Viewport changes, panel state replacement and reachable bottom commands.
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    await geometry("svg");
    await page.evaluate(async () => {
      if (!window.store) {
        const source = performance.getEntriesByType("resource").find(e => /\/editor\/store\.ts(?:\?|$)/.test(e.name));
        window.store = (await import(source.name)).useEditor;
      }
      window.store.getState().setRightTab("properties");
    });
    const sheetNode = page.locator('.touch-properties-sheet[aria-label="الخصائص"]');
    assert.equal(await sheetNode.count(), 1);
    await sheetNode.waitFor({ state: "visible" });
    // الطبقات is an INDEPENDENT window: opening it leaves الخصائص open too.
    await page.evaluate(() => window.store.getState().setRightTab("layers"));
    assert.equal(
      await page.evaluate(() => window.store.getState().layersOpen),
      true,
    );
    assert.ok(
      await page.locator('.touch-properties-sheet[aria-label="الطبقات"]').waitFor({ state: "visible" }),
      "layers window shows alongside properties",
    );
    // The se corner grip resizes the window (arrow keys included).
    const slider = page.getByRole("button", { name: "تغيير حجم الخصائص من الركن se" });
    const h = (await sheetNode.boundingBox()).height;
    await slider.press("ArrowUp");
    assert.ok((await sheetNode.boundingBox()).height < h);
    await page.waitForTimeout(220);
    const sheet = await page.locator('.touch-properties-sheet[aria-label="الخصائص"]').boundingBox();
    const rail = await page.locator(".editor-page-rail").boundingBox();
    const header = await page.locator(".editor-toolbar").boundingBox();
    assert.ok(
      sheet.y >= header.y + header.height,
      "drawer must not cover header",
    );
    assert.ok(
      sheet.y + sheet.height <= rail.y + 1,
      "drawer must not cover page commands",
    );
    await page
      .getByRole("button", { name: "إغلاق الخصائص", exact: true })
      .click();
    await page.locator('.touch-properties-sheet[aria-label="الخصائص"]').waitFor({ state: "hidden" });
    const exportBox = await page.locator(".editor-export-btn").boundingBox();
    assert.ok(
      exportBox.x >= 0 && exportBox.x + exportBox.width <= viewport.width,
      "export must not scroll off-screen",
    );
    for (const selector of [".editor-status-bar", ".editor-page-rail"]) {
      const b = await page.locator(selector).boundingBox();
      assert.ok(
        b.x >= -1 &&
          b.y >= 0 &&
          b.x + b.width <= viewport.width + 1 &&
          b.y + b.height <= viewport.height + 1,
        `${selector} ${JSON.stringify(b)}`,
      );
    }
    const zoom = await page.evaluate(() => window.store.getState().zoom);
    await page
      .getByRole("button", { name: "تكبير اللوحة", exact: true })
      .click();
    assert.ok((await page.evaluate(() => window.store.getState().zoom)) > zoom);
    await page.screenshot({
      path: `.cache/editor-acceptance/editor-${viewport.width}.png`,
    });
  }
  // ── The six independent floating windows ────────────────────────────────
  // Open ALL of them at once: the canvas must not move or resize at all.
  const canvasAtRest = await page.locator(".editor-canvas-stage").boundingBox();
  await page.evaluate(() => {
    const s = window.store.getState();
    s.setLeftTab("elements");
    s.setRightTab("properties");
    s.setRightTab("layers");
    s.toggle("libraryOpen");
    s.toggle("toolsOpen");
    s.toggle("reportToolsOpen");
  });
  await page.waitForTimeout(250);
  const canvasWithWindows = await page.locator(".editor-canvas-stage").boundingBox();
  assert.ok(
    Math.abs(canvasAtRest.x - canvasWithWindows.x) < 1 &&
      Math.abs(canvasAtRest.y - canvasWithWindows.y) < 1 &&
      Math.abs(canvasAtRest.width - canvasWithWindows.width) < 1 &&
      Math.abs(canvasAtRest.height - canvasWithWindows.height) < 1,
    `floating windows must not reflow the canvas: ${JSON.stringify({ canvasAtRest, canvasWithWindows })}`,
  );
  for (const label of ["المكتبة", "أدوات العناصر", "لوحة العناصر", "الخصائص", "الطبقات", "أدوات التقرير"]) {
    const win = page.locator(`.touch-properties-sheet[aria-label="${label}"]`);
    assert.equal(await win.count(), 1, `window "${label}" exists`);
    await win.waitFor({ state: "visible" });
  }

  // Title-bar drag moves the window.
  const props = page.locator('.touch-properties-sheet[aria-label="الخصائص"]');
  const propsStart = await props.boundingBox();
  const gripBar = await page
    .locator('.touch-properties-sheet[aria-label="الخصائص"] .touch-properties-grip')
    .boundingBox();
  await page.mouse.move(gripBar.x + gripBar.width / 2, gripBar.y + gripBar.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBar.x + gripBar.width / 2 - 70, gripBar.y + gripBar.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const propsMoved = await props.boundingBox();
  assert.ok(
    Math.abs(propsMoved.x - (propsStart.x - 70)) < 3 &&
      Math.abs(propsMoved.y - (propsStart.y + 40)) < 3,
    `header drag moves the window: ${JSON.stringify({ propsStart, propsMoved })}`,
  );

  // The west EDGE grip resizes from an edge, not just a corner.
  const westGrip = await page
    .locator('.touch-properties-sheet[aria-label="الخصائص"] .fp-resize-w')
    .boundingBox();
  await page.mouse.move(westGrip.x + westGrip.width / 2, westGrip.y + westGrip.height / 2);
  await page.mouse.down();
  await page.mouse.move(westGrip.x + westGrip.width / 2 - 60, westGrip.y + westGrip.height / 2, { steps: 5 });
  await page.mouse.up();
  const propsWider = await props.boundingBox();
  assert.ok(
    propsWider.width >= propsMoved.width + 50 &&
      Math.abs(propsWider.x - (propsMoved.x - 60)) < 3,
    `west edge drag widens the window: ${JSON.stringify({ propsMoved, propsWider })}`,
  );

  // Dock to the right: the canvas SHRINKS (its space is reserved), it is never covered.
  const canvasBeforeDock = await page.locator(".editor-canvas-stage").boundingBox();
  await page.getByRole("button", { name: "تثبيت الخصائص" }).click();
  await page.getByRole("menuitemradio", { name: "اليمين", exact: true }).click();
  await page.waitForTimeout(450);
  const canvasDocked = await page.locator(".editor-canvas-stage").boundingBox();
  assert.ok(
    canvasDocked.width < canvasBeforeDock.width - 150,
    `docking reserves canvas space: ${canvasBeforeDock.width} -> ${canvasDocked.width}`,
  );
  const dockedProps = await page.locator('.touch-properties-sheet[aria-label="الخصائص"]').boundingBox();
  assert.ok(
    Math.abs(dockedProps.x - (canvasDocked.x + canvasDocked.width)) < 2,
    `docked panel sits flush at the canvas edge: ${JSON.stringify({ canvasDocked, dockedProps })}`,
  );
  assert.ok(
    dockedProps.y >= canvasDocked.y - 1 &&
      dockedProps.y + dockedProps.height <= canvasDocked.y + canvasDocked.height + 1,
    "docked panel stays within the canvas band",
  );

  // Undock: the canvas gets its space back.
  await page.getByRole("button", { name: "تغيير تثبيت الخصائص" }).click();
  await page.getByRole("menuitemradio", { name: "نافذة حرة", exact: true }).click();
  await page.waitForTimeout(450);
  const canvasUndocked = await page.locator(".editor-canvas-stage").boundingBox();
  assert.ok(
    Math.abs(canvasUndocked.width - canvasBeforeDock.width) < 2,
    `undocking restores the canvas: ${canvasBeforeDock.width} -> ${canvasUndocked.width}`,
  );

  // Pages rail: hidden completely, the artboard reclaims its full height.
  const railShown = await page.locator(".editor-page-rail").boundingBox();
  assert.ok(railShown, "pages rail shown by default");
  await page.getByRole("button", { name: "إخفاء شريط الصفحات بالكامل" }).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".editor-page-rail").count(), 0, "rail fully hidden");
  const canvasRailHidden = await page.locator(".editor-canvas-stage").boundingBox();
  assert.ok(
    canvasRailHidden.height >= canvasAtRest.height + 80,
    `hiding the rail gives the canvas its space back: ${canvasAtRest.height} -> ${canvasRailHidden.height}`,
  );
  await page.getByRole("button", { name: "إظهار شريط الصفحات" }).click();
  await page.waitForTimeout(250);
  assert.ok(await page.locator(".editor-page-rail").boundingBox(), "rail restored from the status bar");

  // Clean slate for the remaining checks.
  await page.evaluate(() => window.store.getState().closeFloatingPanels());
  await page.waitForTimeout(120);

  const pagesBefore = await page.evaluate(
    () => window.store.getState().pages.length,
  );
  await page
    .getByRole("button", { name: "تكرار الصفحة الحالية كنسخة مطابقة", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => window.store.getState().pages.length),
    pagesBefore + 1,
  );
  await page
    .getByRole("button", { name: "الصفحة السابقة", exact: true })
    .click();
  const previous = await page.evaluate(
    () => window.store.getState().activePageId,
  );
  await page
    .getByRole("button", { name: "الصفحة التالية", exact: true })
    .click();
  assert.notEqual(
    await page.evaluate(() => window.store.getState().activePageId),
    previous,
  );
  assert.equal(await page.locator("header .editor-wand-btn").count(), 0);
  await page.goto(base + "/purchase");
  await page.locator("footer a[href^='https://wa.me/966552017111?text=']").waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /Gumroad|Keygen|الجهات الحكومية/,
  );
  for (const cta of await page.locator(".subscription-cta").all())
    assert.equal(
      await cta.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(12, 61, 44)",
    );
  assert.equal(
    await page.locator('footer a[href^="https://wa.me/966552017111?text="]').count(),
    1,
  );
  const social = await page
    .locator("footer ul")
    .first()
    .locator("a")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        url: n.href,
        rect: n.getBoundingClientRect().toJSON(),
      })),
    );
  assert.equal(social.length, 4); // all configured accounts, including explicit Pinterest
  assert.ok(social.every((a) => Math.abs(a.rect.y - social[0].rect.y) < 1));
  assert.deepEqual(
    social.map((a) => a.url),
    [
      "https://www.instagram.com/nasaqdocs",
      "https://www.tiktok.com/@nasaqdocs",
      "https://x.com/nasaq_ar",
      "https://www.pinterest.com/nasaqdocs",
    ],
  );
  await page.goto(base + "/");
  await page.locator(".subscription-cta").first().waitFor();
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /الجهات الحكومية|Gumroad|Keygen/,
  );
  assert.ok((await page.locator(".subscription-cta").count()) >= 2);
  for (const cta of await page.locator(".subscription-cta").all())
    assert.equal(
      await cta.evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgb(12, 61, 44)",
    );
  await page.goto(base + "/payment/success");
  await page.locator("footer").waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /Gumroad|Keygen/);
  await page.goto(base + "/الهوية");
  await page.locator("[data-brand-a4-preview]").waitFor();
  const a4 = await page.locator("[data-brand-a4-preview]").boundingBox();
  assert.ok(a4.height > a4.width);
  assert.ok(Math.abs(a4.width / a4.height - 210 / 297) < 0.01);
  // Native touch pointer capture, not just a desktop-sized screenshot.
  const touchContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const touch = await touchContext.newPage();
  await touch.addInitScript(() =>
    localStorage.setItem("nasaq.onboarding.v1", "done"),
  );
  await touch.goto(base + "/editor");
  await touch.locator(".editor-canvas-stage").waitFor();
  await touch.evaluate(async () => {
    const source = performance.getEntriesByType("resource").find(e => /\/editor\/store\.ts(?:\?|$)/.test(e.name));
    window.store = (await import(source.name)).useEditor;
    window.store.getState().setRightTab("properties");
  });
  const grip = touch.getByRole("button", {
    name: "تغيير حجم الخصائص من الركن se",
  });
  await grip.waitFor();
  await touch.waitForTimeout(250);
  const startHeight = (await touch.locator('.touch-properties-sheet[aria-label="الخصائص"]').boundingBox()).height;
  const gripBox = await grip.boundingBox();
  const cdp = await touchContext.newCDPSession(touch);
  const x = gripBox.x + gripBox.width / 2,
    y = gripBox.y + gripBox.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: y - 70 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await touch.waitForTimeout(220);
  assert.ok(
    (await touch.locator('.touch-properties-sheet[aria-label="الخصائص"]').boundingBox()).height < startHeight,
    "touch grip resizes sheet",
  );
  const touchSheet = await touch
    .locator('.touch-properties-sheet[aria-label="الخصائص"]')
    .boundingBox();
  const touchHeader = await touch.locator(".editor-toolbar").boundingBox();
  assert.ok(touchSheet.y >= touchHeader.y + touchHeader.height);
  for (const selector of [".editor-page-rail", ".editor-status-bar"]) {
    const b = await touch.locator(selector).boundingBox();
    assert.ok(b.y + b.height <= 768);
  }
  await touch
    .locator('.touch-properties-sheet[aria-label="الخصائص"] .touch-properties-content')
    .evaluate((n) => {
      const scroller = n.querySelector(".editor-panel-body") ?? n;
      scroller.scrollTop = scroller.scrollHeight;
    });
  const lastAction = await touch
    .locator('.touch-properties-sheet[aria-label="الخصائص"] .editor-panel-body button')
    .last()
    .boundingBox();
  assert.ok(
    lastAction.y + lastAction.height <= touchSheet.y + touchSheet.height,
    "all drawer footer actions are reachable by scrolling",
  );
  await touch.screenshot({ path: ".cache/editor-acceptance/touch-drawer.png" });
  await touchContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: geometry, drag, resize, rotation, live SVG picker, six independent floating windows (no canvas reflow, drag, edge resize, dock/undock space reservation), hidden pages rail, four responsive viewports, zoom, subscription copy/CTA, WhatsApp and portrait A4.",
  );
} catch (error) {
  console.log("Browser errors:", errors);
  console.log((await page.locator("body").innerText()).slice(-2000));
  await page.screenshot({ path: ".cache/editor-acceptance/failure.png" });
  throw error;
} finally {
  await browser.close();
}
