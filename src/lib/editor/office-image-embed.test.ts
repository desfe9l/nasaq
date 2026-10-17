import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

/**
 * The mandate concern, stated as a test: a generated DOCX/PPTX must contain
 * the *actual image bytes*, not a reference to a temporary file that no longer
 * exists once the browser session ends. SVG icons were already covered; raster
 * images were not.
 */

// 2x2 opaque PNG: red, green, blue, transparent.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+F" +
  "ABJADveWkH6oAAAAAElFTkSuQmCC";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

const PAGE = {
  w: 210,
  h: 297,
  background: "#ffffff",
  name: "صورة",
  items: [
    {
      kind: "image" as const,
      x: 20,
      y: 30,
      w: 60,
      h: 40,
      rotation: 0,
      src: PNG_DATA_URL,
      name: "شعار",
      fit: "cover" as const,
      posX: 0.5,
      posY: 0.5,
      radius: 0,
      flipX: false,
      flipY: false,
    },
  ],
};

describe("Office export: raster images", () => {
  it("embeds the real PNG bytes in the DOCX media part", async () => {
    const { writeDocx } = await import("./docx-writer.ts");
    const blob = await writeDocx({ scenes: [PAGE], title: "صورة" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    // Directory entries end with "/" and carry no bytes.
    const media = Object.keys(zip.files).filter(
      (f) => f.startsWith("word/media/") && !f.endsWith("/"),
    );
    assert.ok(media.length >= 1, "the DOCX must contain a media part");

    const bytes = await zip.file(media[0])!.async("uint8array");
    // A real PNG signature, not a 0-byte placeholder or an HTML error page.
    assert.deepEqual(
      Array.from(bytes.slice(0, 8)),
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "the embedded media must be the actual PNG",
    );

    const doc = await zip.file("word/document.xml")!.async("string");
    // The drawing must reference the media by relationship id, never a path.
    assert.match(doc, /r:embed="rId\d+"/);
    assert.doesNotMatch(doc, /file:\/\//, "no filesystem reference may leak into the DOCX");

    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    assert.match(rels, /media\//, "the relationship must point at the embedded part");
  });

  it("embeds the real PNG bytes in the PPTX media part", async () => {
    const { writePptx } = await import("./pptx-writer.ts");
    const blob = await writePptx([PAGE], "صورة");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    const media = Object.keys(zip.files).filter(
      (f) => f.startsWith("ppt/media/") && !f.endsWith("/"),
    );
    assert.ok(media.length >= 1, "the PPTX must contain a media part");

    const bytes = await zip.file(media[0])!.async("uint8array");
    assert.deepEqual(
      Array.from(bytes.slice(0, 8)),
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "the embedded media must be the actual PNG",
    );

    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.doesNotMatch(slide, /file:\/\//, "no filesystem reference may leak into the PPTX");
  });
});
