/** AI image lifecycle → export regression. Run against `npm run dev`:
 *   node scripts/test-ai-image-export.mjs
 *
 * Optional: BROWSER_EXECUTABLE, RENDER_TEST_URL.
 *
 * Proves the whole chain in a real browser: an AI-generated design (its
 * pictures are `data:image/svg+xml` plates) renders in the editor, survives a
 * save/reload round-trip, and is actually embedded in the exported `.docx` and
 * `.pptx` bytes — the files opened from disk, not a helper return value.
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import JSZip from "jszip";

const output = ".cache/ai-image-export";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.BROWSER_EXECUTABLE || "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ contentType: "text/css", body: "" }),
  );
  await page.addInitScript(() =>
    localStorage.setItem("nasaq.onboarding.v1", "done"),
  );
  await page.goto(
    `${process.env.RENDER_TEST_URL || "http://127.0.0.1:8080"}/editor?showcase=1`,
    { waitUntil: "domcontentloaded" },
  );

  const result = await page.evaluate(async () => {
    const { generateDesignFromPrompt } = await import(
      "/src/lib/intelligence/pipeline.ts"
    );
    const { useEditor } = await import("/src/lib/editor/store.ts");

    // A real AI design: the generator paints its plates as SVG data URLs.
    const project = generateDesignFromPrompt("تقرير أمن سيبراني", {
      format: "report",
    }).primaryResult.project;

    const svgEls = project.pages
      .flatMap((p) => p.elements)
      .filter((el) => typeof el.src === "string" && el.src.startsWith("data:image/svg+xml"));
    if (svgEls.length === 0)
      throw new Error("the AI design produced no SVG picture to test");

    // Save/reload round-trip: the serialized document must keep the source.
    const reopened = JSON.parse(JSON.stringify(project));
    const reopenedSvg = reopened.pages
      .flatMap((p) => p.elements)
      .filter((el) => typeof el.src === "string" && el.src.startsWith("data:image/svg+xml"));
    const durable = await (async () => {
      const { durableImageSrc } = await import("/src/lib/editor/images.ts");
      return durableImageSrc(svgEls[0].src);
    })();

    useEditor.setState({
      pages: reopened.pages,
      activePageId: reopened.pages[0].id,
      zoom: 0.5,
      captureArmed: true,
    });

    // The editor artboard must render the picture, fully decoded.
    let editorImgDecoded = false;
    for (let i = 0; i < 180 && !editorImgDecoded; i++) {
      const node = document.querySelector(
        `[data-export-page="${CSS.escape(reopened.pages[0].id)}"]`,
      );
      const imgs = node ? [...node.querySelectorAll("img")] : [];
      editorImgDecoded = imgs.some((img) => img.complete && img.naturalWidth > 0);
      if (!editorImgDecoded)
        await new Promise((r) => requestAnimationFrame(() => r()));
    }

    // Raster export (PNG/PDF base) must show non-white pixels where the plate is.
    const { captureSnapshots, materializeSceneSources } = await import(
      "/src/lib/editor/export.ts"
    );
    const rs = await import("/src/lib/editor/render-snapshot.ts");
    const snaps = await captureSnapshots(reopened.pages);
    const canvas = await rs.paintSnapshot(snaps[0], 1);
    const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let coloured = 0;
    for (let i = 0; i < px.length; i += 4)
      if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255) coloured++;

    // Editable Office export: the materialised scene must carry rasters.
    const materialised = await materializeSceneSources(reopened.pages);
    const stillSvg = materialised
      .flatMap((p) => p.elements)
      .filter((el) => typeof el.src === "string" && el.src.startsWith("data:image/svg+xml"));
    const { buildScene } = await import("/src/lib/editor/scene.ts");
    const scene = buildScene(materialised, materialised);
    const { writeDocx } = await import("/src/lib/editor/docx-writer.ts");
    const { writePptx } = await import("/src/lib/editor/pptx-writer.ts");
    const toB64 = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (const b of buf) s += String.fromCharCode(b);
      return btoa(s);
    };
    const docx = await toB64(await writeDocx({ scenes: scene, title: "AI" }));
    const pptx = await toB64(await writePptx(scene, "AI"));
    return {
      svgCount: svgEls.length,
      reopenedSvgCount: reopenedSvg.length,
      durableUnchanged: durable === svgEls[0].src,
      editorImgDecoded,
      rasterColoured: coloured,
      rasterStillSvg: stillSvg.length,
      docx,
      pptx,
    };
  });

  assert.equal(result.svgCount, result.reopenedSvgCount, "picture survives save/reload");
  assert.ok(result.durableUnchanged, "a durable data URL is left untouched");
  assert.ok(result.editorImgDecoded, "the AI picture renders in the editor");
  assert.ok(result.rasterColoured > 1000, `raster export has artwork (${result.rasterColoured})`);
  assert.equal(result.rasterStillSvg, 0, "no SVG source reaches the Office writers");

  const docxZip = await JSZip.loadAsync(Buffer.from(result.docx, "base64"));
  const docxMedia = Object.keys(docxZip.files).filter((f) =>
    /word\/media\/.+\.(png|jpe?g)$/i.test(f),
  );
  const docXml = await docxZip.file("word/document.xml").async("string");
  assert.ok(docxMedia.length >= 1, "the .docx embeds the AI picture");
  assert.match(docXml, /<w:drawing>/, "the .docx places the picture");

  const pptxZip = await JSZip.loadAsync(Buffer.from(result.pptx, "base64"));
  const pptxMedia = Object.keys(pptxZip.files).filter((f) =>
    /ppt\/media\/.+\.(png|jpe?g)$/i.test(f),
  );
  const slideXml = await pptxZip.file("ppt/slides/slide1.xml").async("string");
  assert.ok(pptxMedia.length >= 1, "the .pptx embeds the AI picture");
  assert.match(slideXml, /r:embed=/, "the slide places the picture");

  writeFileSync(`${output}/export.docx`, Buffer.from(result.docx, "base64"));
  writeFileSync(`${output}/export.pptx`, Buffer.from(result.pptx, "base64"));
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    `ok — AI picture: editor render, save/reload, ${docxMedia.length} DOCX media, ` +
      `${pptxMedia.length} PPTX media (artifacts in ${output}/)`,
  );
} finally {
  await browser.close();
}
