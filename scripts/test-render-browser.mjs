/** Browser integration regression. Run against `npm run dev`:
 * node scripts/test-render-browser.mjs
 * Optional: BROWSER_EXECUTABLE, TEST_FONT_FILE, RENDER_TEST_URL.
 * Artifacts stay in ignored .cache; no Office application is required.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const output = ".cache/render-test";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Tests are offline and deterministic; custom-font coverage uses a supplied
  // TTF/WOFF rather than relying on Google being reachable from CI.
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("nasaq.onboarding.v1", "done"),
  );
  await page.goto(
    `${process.env.RENDER_TEST_URL || "http://127.0.0.1:8080"}/editor`,
  );
  await page.waitForSelector("[data-export-page]", { state: "attached" });
  const font = process.env.TEST_FONT_FILE
    ? readFileSync(process.env.TEST_FONT_FILE).toString("base64")
    : null;
  await page.evaluate(async (font) => {
    const { useEditor } = await import("/src/lib/editor/store.ts");
    if (font) {
      const src = `data:font/ttf;base64,${font}`;
      document.fonts.add(
        await new FontFace("Export Regression", `url(${src})`).load(),
      );
      const { rememberUploadedFont } = await import("/src/lib/nsq/fonts.ts");
      rememberUploadedFont("Export Regression", src);
    }
    const photo = document.createElement("canvas");
    photo.width = 120;
    photo.height = 60;
    const ctx = photo.getContext("2d");
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(0, 0, 40, 60);
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(40, 0, 40, 60);
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(80, 0, 40, 60);
    const src = photo.toDataURL();
    const shape = (id, x, y, w, h, z, style, extras = {}) => ({
      id,
      type: "shape",
      x,
      y,
      w,
      h,
      z,
      rotation: 0,
      opacity: 1,
      style,
      ...extras,
    });
    const layers = [
      shape("back", 2, 2, 85, 50, -1, {
        fill: "#f3e8ff",
        shapeId: "rounded",
        radius: 3,
      }),
      shape(
        "crop",
        4,
        8,
        23,
        23,
        1,
        { objectFit: "cover", objectX: 100, objectY: 0, radius: 3 },
        { type: "image", src, clippedBy: "mask" },
      ),
      shape("mask", 4, 8, 23, 23, 2, {
        shapeId: "circle",
        fill: "#000",
        borderWidth: 0,
      }),
      shape(
        "contain",
        32,
        8,
        25,
        26,
        3,
        { objectFit: "contain", objectX: 0, objectY: 100 },
        { type: "image", src, rotation: 15 },
      ),
      shape(
        "group",
        57,
        3,
        38,
        23,
        4,
        { flipX: true },
        {
          type: "group",
          rotation: 12,
          opacity: 0.55,
          children: [
            shape("child1", 0, 0, 24, 19, 0, { fill: "#f59e0b" }),
            shape("child2", 12, 4, 25, 19, 1, { fill: "#7c3aed" }),
          ],
        },
      ),
      shape(
        "offpage",
        -6,
        48,
        22,
        16,
        5,
        { fill: "#0369a1", shadow: "3px 4px 5px #3338" },
        { rotation: 35, opacity: 0.7 },
      ),
      shape(
        "text",
        17,
        38,
        78,
        22,
        6,
        {
          fontFamily: font ? "Export Regression" : "sans-serif",
          fontSize: 15.25,
          fontWeight: 400,
          textBoxMode: "fixed",
          color: "#123456",
        },
        { type: "text", content: "نَسَق — العربية 123\n{رقم_الصفحة_من_الكل}" },
      ),
      shape("hidden", 0, 0, 100, 70, 100, { fill: "#000" }, { hidden: true }),
    ];
    layers[0].locked = true;
    const pages = [
      {
        id: "inactive",
        name: "أخرى",
        w: 101.6,
        h: 76.2,
        bg: "#fff",
        elements: [],
      },
      {
        id: "fixture",
        name: "اختبار",
        w: 101.6,
        h: 76.2,
        bg: "#fff",
        elements: layers,
      },
    ];
    useEditor.setState({ pages, activePageId: "inactive", zoom: 0.43 });
  }, font);
  await page.waitForSelector('[data-export-page="fixture"]', {
    state: "attached",
  });
  const result = await page.evaluate(async () => {
    const { snapshotPage, paintSnapshot, snapshotLayers, snapshotsHtml } =
      await import("/src/lib/editor/render-snapshot.ts");
    const { mmToPx } = await import("/src/lib/editor/render-units.ts");
    const node = document.querySelector('[data-export-page="fixture"]');
    const snapshot = await snapshotPage({ node, w: 101.6, h: 76.2 });
    const canvas = await paintSnapshot(snapshot, 2);
    const scene = await snapshotLayers(snapshot, 2);
    const combined = document.createElement("canvas");
    combined.width = canvas.width;
    combined.height = canvas.height;
    const ctx = combined.getContext("2d");
    for (const layer of scene.items) {
      const img = new Image();
      img.src = layer.src;
      await img.decode();
      ctx.drawImage(
        img,
        Math.round(mmToPx(layer.x) * 2),
        Math.round(mmToPx(layer.y) * 2),
      );
    }
    const a = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    const b = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let total = 0,
      changed = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      total += d;
      if (d > 3) changed++;
    }
    const { writeDocx } = await import("/src/lib/editor/docx-writer.ts");
    const { writePptx } = await import("/src/lib/editor/pptx-writer.ts");
    const docx = Array.from(
      new Uint8Array(
        await (
          await writeDocx({ scenes: [scene, scene], title: "Regression" })
        ).arrayBuffer(),
      ),
    );
    const pptx = Array.from(
      new Uint8Array(
        await (await writePptx([scene], "Regression")).arrayBuffer(),
      ),
    );
    return {
      snapshot,
      html: snapshotsHtml([snapshot], "Regression <safe>"),
      png: canvas.toDataURL(),
      combined: combined.toDataURL(),
      scene,
      diff: total / a.length,
      changed: changed / a.length,
      docx,
      pptx,
      text: node.textContent,
    };
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.ok(result.diff < 0.2, `layer mean error ${result.diff}`);
  assert.ok(result.changed < 0.002, `layer changed channels ${result.changed}`);
  assert.equal(
    result.scene.items.length,
    7,
    "background + 6 visible artwork objects (mask guide and hidden layer omitted)",
  );
  assert.match(result.text, /2.*2|٢.*٢/, "inactive-page macro context");
  assert.match(result.snapshot.svg, /viewBox="0 0 384 288/);
  assert.ok(!result.snapshot.svg.includes("FONT_EMBED_FAILED"));
  assert.ok(
    !result.snapshot.svg.includes("🔒"),
    "lock badges are authoring chrome",
  );
  if (font) assert.match(result.snapshot.svg, /data:font\/ttf;base64/);
  writeFileSync(`${output}/export.docx`, Buffer.from(result.docx));
  writeFileSync(`${output}/export.pptx`, Buffer.from(result.pptx));
  writeFileSync(`${output}/export.html`, result.html);
  writeFileSync(`${output}/export.svg`, result.snapshot.svg);
  for (const key of ["png", "combined"])
    writeFileSync(
      `${output}/${key}.png`,
      Buffer.from(result[key].split(",")[1], "base64"),
    );
  // Reload HTML in a fresh offline document. Real absolute-positioned HTML,
  // not a screenshot, with fonts/images entirely embedded.
  const web = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await web.route("**/*", (route) => route.abort());
  await web.setContent(result.html);
  await web.evaluate(() => document.fonts.ready);
  assert.equal(await web.locator("[data-el-id]").count(), 9);
  assert.equal(
    await web
      .locator("section")
      .evaluate((n) => n.getBoundingClientRect().width),
    384,
  );
  const exported = await web.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(images.map((img) => img.decode()));
    return images.every((img) => img.naturalWidth > 0);
  });
  assert.ok(exported, "offline images decode");
  await web.screenshot({ path: `${output}/web.png` });
  // Compare a real browser screenshot of the artboard to the shared painter,
  // not just two exports that could agree on the same rendering mistake.
  const artboard = page.locator('[data-export-page="fixture"]');
  const liveFontSize = await artboard
    .locator('[data-el-id="text"] > div')
    .evaluate((el) => getComputedStyle(el).fontSize);
  const webFontSize = await web
    .locator('[data-el-id="text"] > div')
    .evaluate((el) => getComputedStyle(el).fontSize);
  assert.equal(
    webFontSize,
    liveFontSize,
    "fractional font sizes must not be rounded by the cloning library",
  );
  await page.evaluate(() => {
    const root = document.querySelector("#export-root");
    window.__qaCaptureParent = root.parentElement;
    document.body.appendChild(root);
    root.style.left = "0";
    root.style.zIndex = "999999";
    document.querySelector('[data-export-page="inactive"]').style.display =
      "none";
  });
  const livePng = await artboard.screenshot();
  const liveComparison = await page.evaluate(
    async ({ png, snapshot }) => {
      const { paintSnapshot } =
        await import("/src/lib/editor/render-snapshot.ts");
      const canvas = await paintSnapshot(snapshot, 1);
      const expected = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      const image = new Image();
      image.src = png;
      await image.decode();
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < actual.length; i++)
        sum += Math.abs(actual[i] - expected[i]);
      return sum / actual.length;
    },
    {
      png: `data:image/png;base64,${livePng.toString("base64")}`,
      snapshot: result.snapshot,
    },
  );
  writeFileSync(`${output}/artboard.png`, livePng);
  assert.ok(
    liveComparison < 1,
    `artboard mean channel difference ${liveComparison}`,
  );
  writeFileSync(`${output}/artboard.png`, livePng);
  await page.evaluate(async () => {
    const root = document.querySelector("#export-root");
    window.__qaCaptureParent.appendChild(root);
    root.style.left = "";
    root.style.zIndex = "";
    document.querySelector('[data-export-page="inactive"]').style.display = "";
    const { useEditor } = await import("/src/lib/editor/store.ts");
    useEditor.setState({ activePageId: "fixture", zoom: 1 });
  });
  // Real rendered app smoke on both viewport classes.
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/mobile.png` });
  console.log(
    JSON.stringify(
      {
        ok: true,
        layers: result.scene.items.length,
        layerMeanError: result.diff,
        artboardMeanError: liveComparison,
        layerChangedFraction: result.changed,
        uploadedFont: !!font,
        runtimeErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
