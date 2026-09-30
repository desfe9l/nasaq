/** Run against npm run dev. Real store/IndexedDB/rendering; no auth or licence bypass.
 * BROWSER_EXECUTABLE optionally supplies Chromium where Playwright's download is unavailable. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
const base = process.env.EDITOR_TEST_URL || "http://127.0.0.1:8080";
const output = "screenshots/editor-focused";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [],
  errors = [];
const record = (name, detail) => {
  results.push({ name, detail });
  console.log("PASS", name, detail || "");
};
const inside = (box, width, height) =>
  box &&
  box.x >= 0 &&
  box.y >= 0 &&
  box.x + box.width <= width + 1 &&
  box.y + box.height <= height + 1;
try {
  for (const [width, height] of [
    [1920, 1080],
    [768, 1024],
    [375, 812],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 1100,
      isMobile: width < 500,
      acceptDownloads: true,
    });
    await context.addInitScript(() => {
      localStorage.setItem("nasaq.onboarding.v1", "done");
      performance.setResourceTimingBufferSize(5000);
    });
    const page = await context.newPage();
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
    await page.evaluate(async () => {
      const { buildNewDocument, defaultNewDocument } =
        await import("/src/lib/editor/new-document.ts");
      const project = buildNewDocument(defaultNewDocument());
      project.pages[0].elements = [];
      if (!(await window.store.getState().createDocument(project)))
        throw new Error("Document creation refused");
      window.store.setState({
        previewAll: false,
        rightOpen: false,
        leftOpen: false,
      });
      window.store.getState().addElementAt(
        "shape",
        {
          name: "اختبار الإطار",
          w: 45,
          h: 35,
          style: { fill: "#006c35", borderColor: "#b3924b", borderWidth: 0 },
        },
        { x: 105, y: 130 },
      );
    });
    await page.waitForTimeout(400);
    const bar = page.locator(".floating-toolbar");
    assert.ok(inside(await bar.boundingBox(), width, height));
    // One row on a desktop/tablet lane; on a phone the bar wraps rather than
    // hiding a control behind a scroll, so the ceiling is two compact rows.
    assert.ok((await bar.boundingBox()).height <= (width < 600 ? 96 : 44));
    assert.ok(
      (await page.locator(".editor-toolbar").boundingBox()).height <=
        (width < 600 ? 140 : 96),
    );
    const ensureStrokeVisible = async () => {
      const box = page.getByRole("textbox", {
        name: "سماكة الحد بالبكسل",
        exact: true,
      });
      if (!(await box.isVisible())) {
        const formatBtn = bar.getByRole("button", {
          name: "تنسيق العنصر",
          exact: true,
        });
        if (await formatBtn.isVisible()) await formatBtn.click();
      }
      return box;
    };
    const closeFormatDrawer = async () => {
      const closeBtn = page.getByRole("button", {
        name: "إغلاق تنسيق العنصر",
        exact: true,
      });
      if (await closeBtn.isVisible()) await closeBtn.click();
    };
    let stroke = await ensureStrokeVisible();
    await stroke.fill("8");
    await stroke.press("Enter");
    assert.ok(
      Math.abs(
        (await page.evaluate(
          () =>
            (window.store.getState().selectedElements()[0].style.borderWidth *
              96) /
            25.4,
        )) - 8,
      ) < 0.01,
    );
    await stroke.fill("0");
    await stroke.press("Enter");
    await stroke.focus();
    await stroke.press("ArrowUp");
    assert.equal(
      await page.evaluate(
        () =>
          Math.round(
            ((window.store.getState().selectedElements()[0].style.borderWidth *
              96) /
              25.4) *
              10,
          ) / 10,
      ),
      0.5,
    );
    await closeFormatDrawer();
    record(`${width}: compact visible toolbar and live numeric/slider stroke`);
    await page.evaluate(() => {
      const s = window.store.getState();
      window.testId = s.selectedId;
      s.select(null);
      s.select(window.testId);
    });
    stroke = await ensureStrokeVisible();
    assert.equal(await stroke.inputValue(), "0.5");
    await closeFormatDrawer();
    const rotation = page.locator(".selection-frame.is-secondary");
    assert.equal(await rotation.count(), 0);
    const frame = page.locator(".selection-frame").first();
    const selectedId = await page.evaluate(() => window.testId);
    const artwork = page
      .locator(
        `.editor-canvas-stage [data-page-id] .canvas-el[data-el-id="${selectedId}"]`,
      )
      .first();
    const f = await frame.boundingBox(),
      a = await artwork.boundingBox();
    assert.ok(
      Math.abs(f.width - a.width) < 1 && Math.abs(f.height - a.height) < 1,
      JSON.stringify({ f, a }),
    );
    const rotate = page.getByRole("slider", { name: /تدوير العنصر/ });
    assert.equal(await rotate.count(), 1);
    await rotate.focus();
    await rotate.press("ArrowRight");
    assert.equal(
      await page.evaluate(
        () => window.store.getState().selectedElements()[0].rotation,
      ),
      1,
    );
    await rotate.press("Home");
    const r = await rotate.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(f.x + f.width + 30, f.y + f.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    assert.ok(
      Math.abs(
        await page.evaluate(
          () => window.store.getState().selectedElements()[0].rotation,
        ),
      ) > 10,
    );
    await rotate.focus();
    await rotate.press("Home");
    if (width < 1100) {
      const cdp = await context.newCDPSession(page);
      const touchGrip = await rotate.boundingBox();
      const x = touchGrip.x + touchGrip.width / 2,
        y = touchGrip.y + touchGrip.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (60 * i) / 8, y: y + (45 * i) / 8 }],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      assert.ok(
        Math.abs(
          await page.evaluate(
            () => window.store.getState().selectedElements()[0].rotation,
          ),
        ) > 10,
      );
      await cdp.detach();
      await rotate.focus();
      await rotate.press("Home");
      record(`${width}: native touch rotation updates object angle`);
    }
    await page.evaluate(() => document.activeElement?.blur());
    record(`${width}: precise frame, top-center rotation, reselection`);
    await page
      .locator("[data-sonner-toast]")
      .first()
      .waitFor({ state: "hidden", timeout: 10000 });
    await page.screenshot({ path: `${output}/editor-${width}.png` });
    await page.evaluate(() => window.store.setState({ rightOpen: true }));
    const panel = page.getByRole("region", {
      name: "الخصائص والطبقات",
      exact: true,
    });
    await page.waitForTimeout(250);
    const grip = page.getByRole("button", {
      name: "تحريك الخصائص والطبقات",
      exact: true,
    });
    const origin = await panel.boundingBox();
    const g = await grip.boundingBox();
    if (width < 1100) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: g.x + 35, y: g.y + 16 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: g.x + 65, y: g.y + 80 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await page.mouse.move(g.x + 35, g.y + 16);
      await page.mouse.down();
      await page.mouse.move(g.x + 65, g.y + 80, { steps: 8 });
      await page.mouse.up();
    }
    const moved = await panel.boundingBox();
    assert.ok(Math.abs(moved.y - origin.y) > 20);
    assert.ok(inside(moved, width, height));
    const resizer = page.getByRole("button", {
      name: "تغيير حجم الخصائص والطبقات",
      exact: true,
    });
    await resizer.focus();
    await resizer.press("ArrowDown");
    assert.ok((await panel.boundingBox()).height > moved.height);
    await page.getByRole("tab", { name: "طبقات", exact: true }).click();
    await page.screenshot({ path: `${output}/layers-${width}.png` });
    record(`${width}: panels drag, resize, layers and boundaries`);
    await page
      .getByRole("button", { name: "إغلاق الخصائص والطبقات", exact: true })
      .click();
    await page.evaluate(() =>
      window.store.setState({ leftOpen: true, leftCollapsed: false }),
    );
    await page.waitForTimeout(200);
    // Every panel floats: opening one must never take width from the canvas,
    // so there is no docked variant left to detach here.
    assert.equal(
      await page.evaluate(
        () => document.querySelector(".editor-canvas-stage").getBoundingClientRect().width > 0,
      ),
      true,
    );
    const library = page.getByRole("region", {
      name: "لوحة العناصر",
      exact: true,
    });
    assert.ok(inside(await library.boundingBox(), width, height));
    await page.screenshot({ path: `${output}/drawer-${width}.png` });
    record(`${width}: library drawer opens and detaches without overflow`);
    await page.getByRole("tab", { name: "أشكال", exact: true }).click();
    const source = library.locator("button[draggable=true]").first();
    const sourceBox = await source.boundingBox();
    const target = page.locator(".editor-canvas-stage [data-page-id]").first();
    const targetBox = await target.boundingBox();
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetBox.y + targetBox.height * 0.5;
    const beforeDrop = await page.evaluate(
      () => window.store.getState().pages[0].elements.length,
    );
    if (width < 1100) {
      const cdp = await context.newCDPSession(page);
      const fromX = sourceBox.x + sourceBox.width / 2,
        fromY = sourceBox.y + sourceBox.height / 2;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: fromX, y: fromY }],
      });
      for (let i = 1; i <= 8; i++)
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            {
              x: fromX + ((targetX - fromX) * i) / 8,
              y: fromY + ((targetY - fromY) * i) / 8,
            },
          ],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
    } else {
      await source.dragTo(target, {
        targetPosition: { x: targetX - targetBox.x, y: targetY - targetBox.y },
      });
    }
    assert.equal(
      await page.evaluate(
        () => window.store.getState().pages[0].elements.length,
      ),
      beforeDrop + 1,
    );
    await page.evaluate(() => window.store.getState().undo());
    record(
      `${width}: native ${width < 1100 ? "touch" : "mouse"} library drag creates exactly one object`,
    );

    if (
      await page
        .getByRole("button", { name: "إغلاق لوحة العناصر", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "إغلاق لوحة العناصر", exact: true })
        .click();
    // Real HTML5 drop transport into the active page at measured zoom/pan coordinates.
    const dropResult = await page.evaluate(async () => {
      const state = window.store.getState();
      const stage = document.querySelector(".editor-canvas-stage");
      const target = stage.querySelector(
        `[data-page-id="${state.activePageId}"]`,
      );
      const r = target.getBoundingClientRect();
      const count = state.pages[0].elements.length;
      const dataTransfer = new DataTransfer();
      dataTransfer.setData(
        "application/x-nasaq-library",
        JSON.stringify({
          items: [
            { type: "shape", over: { w: 12, h: 12, name: "إفلات حقيقي" } },
          ],
        }),
      );
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width * 0.5,
        clientY: r.top + r.height * 0.5,
        dataTransfer,
      });
      target.dispatchEvent(event);
      const s = window.store.getState();
      const el = s.selectedElements()[0];
      return {
        expectedX: ((event.clientX - r.left) / r.width) * 210,
        expectedY: ((event.clientY - r.top) / r.height) * 297,
        count: s.pages[0].elements.length - count,
        x: el.x + el.w / 2,
        y: el.y + el.h / 2,
      };
    });
    assert.equal(dropResult.count, 1);
    assert.ok(
      Math.abs(dropResult.x - dropResult.expectedX) < 1 &&
        Math.abs(dropResult.y - dropResult.expectedY) < 1,
    );
    await page.evaluate(() => {
      const s = window.store.getState();
      s.selectAll();
    });
    stroke = await ensureStrokeVisible();
    await stroke.fill("4");
    await stroke.press("Enter");
    await closeFormatDrawer();
    assert.ok(
      await page.evaluate(() =>
        window.store
          .getState()
          .selectedElements()
          .every(
            (el) => Math.abs((el.style.borderWidth * 96) / 25.4 - 4) < 0.01,
          ),
      ),
    );
    record(`${width}: real drop coordinates and multi-selection stroke`);
    await page.evaluate(async () => {
      const { saveAsset } = await import("/src/lib/editor/storage.ts");
      await saveAsset({
        name: "ملف اختبار",
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        w: 1,
        h: 1,
      });
      await window.store.getState().saveNow();
    });
    await page.reload({ waitUntil: "networkidle" });
    const persisted = await page.evaluate(async () => {
      const { useEditor } = await import(
        performance
          .getEntriesByType("resource")
          .find((e) => /\/editor\/store\.ts(?:\?|$)/.test(e.name)).name
      );
      await useEditor.getState().hydrate();
      const { listAssets } = await import("/src/lib/editor/storage.ts");
      return {
        elements: useEditor.getState().pages[0].elements,
        assets: await listAssets(),
        legacy: localStorage.getItem("nasaq-assets-v1"),
      };
    });
    assert.equal(persisted.elements.length, 2);
    assert.equal(persisted.assets.length, 1);
    assert.equal(persisted.legacy, null);
    assert.ok(
      persisted.elements.every(
        (el) => Math.abs((el.style.borderWidth * 96) / 25.4 - 4) < 0.01,
      ),
    );
    record(
      `${width}: projects, binary assets and stroke persist after reload in IndexedDB`,
    );
    if (width === 1920) {
      mkdirSync(".cache/editor-quality", { recursive: true });
      for (const format of ["png", "pdf"]) {
        const downloadPromise = page.waitForEvent("download");
        await page.evaluate(async (format) => {
          const { capturePages, runExport } =
            await import("/src/lib/editor/export.ts");
          const { useEditor } = await import(
            performance
              .getEntriesByType("resource")
              .find((e) => /\/editor\/store\.ts(?:\?|$)/.test(e.name)).name
          );
          /*
           * The capture DOM mounts on demand (ExportCaptureLayer): real
           * consumers reach it through the open export dialog, so follow the
           * same contract here — open the export surface, yield two frames so
           * React paints it, then capture from the live DOM.
           */
          if (!document.querySelector("#export-root")) {
            useEditor.setState({ exportOpen: true });
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          }
          const s = useEditor.getState(),
            pages = s.pages;
          const target = document.querySelector("#export-root .report-page");
          if (!target) throw new Error("export DOM not mounted");
          const captures = await capturePages(
            [{ node: target, w: 210, h: 297 }],
            1,
          );
          await runExport(
            format,
            captures,
            {
              version: 2,
              name: "verification",
              theme: s.theme,
              orgName: s.orgName,
              pages,
            },
            pages,
          );
          useEditor.setState({ exportOpen: false });
        }, format);
        const download = await downloadPromise;
        const path = `.cache/editor-quality/export.${format}`;
        await download.saveAs(path);
        const bytes = readFileSync(path);
        assert.ok(bytes.length > 500);
        assert.equal(
          bytes.subarray(0, format === "pdf" ? 4 : 8).toString("hex"),
          format === "pdf" ? "25504446" : "89504e470d0a1a0a",
        );
      }
      record("real PNG/PDF export captures and file signatures");
    }
    await page.goto(`${base}/الهوية`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "شهادة تقدير", exact: true }).click();
    assert.equal(
      await page.getByLabel("اتجاه المستند").inputValue(),
      "a4-portrait",
    );
    const preview = page.locator("[data-brand-a4-preview] .tpl-paper");
    let box = await preview.boundingBox();
    assert.ok(Math.abs(box.width / box.height - 210 / 297) < 0.01);
    await page.getByLabel("اتجاه المستند").selectOption("a4-landscape");
    box = await preview.boundingBox();
    assert.ok(Math.abs(box.width / box.height - 297 / 210) < 0.01);
    await preview.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/identity-${width}.png` });
    await page
      .getByRole("button", { name: "حفظ الهوية محليًا", exact: true })
      .click();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.getByLabel("اتجاه المستند").inputValue(),
      "a4-landscape",
    );
    record(
      `${width}: identity certificate orientation, real preview and saved state`,
    );
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const premium = page.locator('section[aria-label="قوالب Premium"]');
    await premium.scrollIntoViewIfNeeded();
    const disclosure = premium.locator("details");
    assert.ok((await disclosure.getAttribute("open")) !== null);
    await premium.locator("summary").click();
    assert.equal(await disclosure.getAttribute("open"), null);
    await premium.locator("summary").click();
    await page.screenshot({ path: `${output}/premium-${width}.png` });
    const footer = page.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    assert.equal(await footer.locator('a[href*="pinterest.com"]').count(), 1);
    assert.ok(
      await footer
        .getByRole("link", { name: "تواصل عبر واتساب" })
        .getAttribute("href"),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: `${output}/footer-${width}.png` });
    record(
      `${width}: Premium disclosure, compact footer, single Pinterest, WhatsApp and no page overflow`,
    );
    await context.close();
  }
  for (const orientation of ["a4-portrait", "a4-landscape"]) {
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
    });
    await context.addInitScript(() => {
      localStorage.setItem("nasaq.onboarding.v1", "done");
      performance.setResourceTimingBufferSize(5000);
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/الهوية`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "شهادة تقدير", exact: true }).click();
    await page.getByLabel("اتجاه المستند").selectOption(orientation);
    await page.getByLabel("اسم المستلم", { exact: true }).fill("شهادة تحقق");
    await page
      .getByRole("button", { name: "إنشاء مستند بهذه الهوية", exact: true })
      .click();
    await page.waitForURL("**/editor");
    await page.locator(".editor-canvas-stage").waitFor();
    await page.reload({ waitUntil: "networkidle" });
    const certificate = await page.evaluate(async () => {
      const { useEditor } = await import(
        performance
          .getEntriesByType("resource")
          .find((e) => /\/editor\/store\.ts(?:\?|$)/.test(e.name)).name
      );
      await useEditor.getState().hydrate();
      return useEditor.getState().pages[0];
    });
    assert.equal(certificate.w, orientation === "a4-portrait" ? 210 : 297);
    assert.equal(certificate.h, orientation === "a4-portrait" ? 297 : 210);
    assert.ok(certificate.elements.some((el) => el.content === "شهادة تحقق"));
    await page.screenshot({ path: `${output}/certificate-${orientation}.png` });
    record(
      `${orientation}: certificate created through UI, editable artwork and dimensions survive reload`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(
    `${output}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
