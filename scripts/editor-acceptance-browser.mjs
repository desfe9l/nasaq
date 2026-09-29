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
  const geometry = async (type) => {
    const result = await page.evaluate((type) => {
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
    await page
      .getByRole("button", { name: "الخصائص والإعدادات", exact: true })
      .click();
    assert.equal(await page.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]').count(), 1);
    await page.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]').waitFor({ state: "visible" });
    await page.getByRole("button", { name: "الطبقات", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.store.getState().rightTab),
      "layers",
    );
    assert.equal(
      await page
        .locator('.studio-tool-dock .is-active[aria-label="الطبقات"]')
        .count(),
      1,
    );
    const slider = page.getByRole("button", { name: "تغيير حجم الخصائص والطبقات" });
    const sheetNode = page.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]');
    const h = (await sheetNode.boundingBox()).height;
    await slider.press("ArrowUp");
    assert.ok((await sheetNode.boundingBox()).height < h);
    await page.waitForTimeout(220);
    const sheet = await page.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]').boundingBox();
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
      .getByRole("button", { name: "إغلاق الخصائص والطبقات", exact: true })
      .click();
    await page.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]').waitFor({ state: "hidden" });
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
  const pagesBefore = await page.evaluate(
    () => window.store.getState().pages.length,
  );
  await page.getByTitle("نسخ الصفحة الحالية", { exact: true }).click();
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
  assert.equal(await page.locator(".collapsed-panel-dock").count(), 0);
  assert.equal(await page.locator(".studio-tool-dock").count(), 1);
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
  await touch
    .getByRole("button", { name: "الخصائص والإعدادات", exact: true })
    .tap();
  const grip = touch.getByRole("button", {
    name: "تغيير حجم الخصائص والطبقات",
  });
  await grip.waitFor();
  await touch.waitForTimeout(250);
  const startHeight = (await touch.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]').boundingBox()).height;
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
    (await touch.locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]').boundingBox()).height < startHeight,
    "touch grip resizes sheet",
  );
  const touchSheet = await touch
    .locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"]')
    .boundingBox();
  const touchHeader = await touch.locator(".editor-toolbar").boundingBox();
  assert.ok(touchSheet.y >= touchHeader.y + touchHeader.height);
  for (const selector of [".editor-page-rail", ".editor-status-bar"]) {
    const b = await touch.locator(selector).boundingBox();
    assert.ok(b.y + b.height <= 768);
  }
  await touch
    .locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"] .touch-properties-content')
    .evaluate((n) => (n.scrollTop = n.scrollHeight));
  const lastAction = await touch
    .locator('.touch-properties-sheet[aria-label="الخصائص والطبقات"] .editor-panel-footer button')
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
    "PASS: geometry, drag, resize, rotation, live SVG picker, single drawers, four responsive viewports, zoom, subscription copy/CTA, WhatsApp and portrait A4.",
  );
} catch (error) {
  console.log("Browser errors:", errors);
  console.log((await page.locator("body").innerText()).slice(-2000));
  await page.screenshot({ path: ".cache/editor-acceptance/failure.png" });
  throw error;
} finally {
  await browser.close();
}
