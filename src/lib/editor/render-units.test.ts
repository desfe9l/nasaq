import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  CSS_DPI,
  mmToPx,
  pxToMm,
  mmToEmu,
  assertUniformSlideSize,
} from "./render-units.ts";
import { writeDocx } from "./docx-writer.ts";
import { writePptx } from "./pptx-writer.ts";
import { buildScene, type SceneImage, type ScenePage } from "./scene.ts";
import type { Page } from "./model.ts";

const image: SceneImage = {
  kind: "image",
  name: "طبقة نص عربي",
  x: 25.4,
  y: 50.8,
  w: 25.4,
  h: 12.7,
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPzQAAAAASUVORK5CYII=",
  rotation: 0,
  fit: "fill",
  posX: 50,
  posY: 50,
  radius: 0,
};
const page: ScenePage = {
  w: 210,
  h: 297,
  background: "#ffffff",
  name: "صفحة",
  items: [image, { ...image, name: "طبقة ثانية", y: 60 }],
};

describe("96 DPI rendering contract", () => {
  it("keeps document page numbers when exporting only the current page", () => {
    const current: Page = {
      id: "second",
      name: "Second",
      elements: [
        {
          id: "text", name: "نص", rotation: 0, opacity: 1,
          type: "text",
          x: 0,
          y: 0,
          w: 100,
          h: 20,
          z: 0,
          content: "{رقم_الصفحة_من_الكل}",
          style: { fontSize: 14 },
        },
      ],
    };
    const documentPages: Page[] = [
      { id: "first", name: "First", elements: [] },
      current,
    ];
    const [scene] = buildScene([current], documentPages);
    assert.equal(scene.items[0].kind, "text");
    if (scene.items[0].kind === "text")
      assert.equal(scene.items[0].text, "صفحة 2 من 2");
  });
  it("does not round physical A4 dimensions or confuse pixels and EMU", () => {
    assert.equal(CSS_DPI, 96);
    assert.equal(mmToPx(25.4), 96);
    assert.equal(mmToEmu(25.4), 914400);
    assert.ok(Math.abs(pxToMm(mmToPx(297)) - 297) < 1e-10);
    assert.ok(Math.abs(mmToPx(210) - 793.7007874015749) < 1e-10);
  });
  it("writes Word picture offsets in EMU and extents via 96 DPI pixels", async () => {
    const zip = await JSZip.loadAsync(
      await (
        await writeDocx({ scenes: [page, page], title: "اختبار" })
      ).arrayBuffer(),
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    assert.match(xml, /<wp:posOffset>914400<\/wp:posOffset>/);
    assert.match(xml, /<wp:posOffset>1828800<\/wp:posOffset>/);
    assert.match(xml, /<wp:extent cx="914400" cy="457200"/);
    const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 4);
    assert.equal(new Set(ids).size, 4);
    const z = [...xml.matchAll(/relativeHeight="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    assert.deepEqual(z, [1, 2, 3, 4]);
    assert.equal((xml.match(/<w:drawing>/g) || []).length, 4);
    assert.equal(
      (xml.match(/w:lineRule="exact"/g) || []).length,
      2,
      "one minimal anchor paragraph per page, not one flow paragraph per layer",
    );
  });
  it("keeps PowerPoint layers separate, named and in paint order", async () => {
    const zip = await JSZip.loadAsync(
      await (await writePptx([page], "اختبار")).arrayBuffer(),
    );
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.equal((xml.match(/<p:pic>/g) || []).length, 2);
    assert.match(xml, /<a:off x="914400" y="1828800"/);
    assert.match(xml, /<a:ext cx="914400" cy="457200"/);
    assert.ok(xml.indexOf(image.name!) < xml.indexOf("طبقة ثانية"));
  });
  it("rejects mixed slide sizes instead of silently resizing earlier slides", async () => {
    assert.doesNotThrow(() => assertUniformSlideSize([page, page]));
    assert.throws(() => assertUniformSlideSize([page, { w: 297, h: 210 }]));
    await assert.rejects(
      writePptx([page, { ...page, w: 297, h: 210 }], "mixed"),
    );
  });
});
