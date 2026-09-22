import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parseSvgPath, scaleSegments } from "./vector-path.ts";

/**
 * The Office writers are only useful if the output is *editable*: real text
 * runs, real table cells, real vector shapes. These tests unzip what the writers
 * produce and inspect the XML, because a file that opens but contains one image
 * per page would pass a "does it export" check and still be useless.
 */

const PAGE = {
  w: 210,
  h: 297,
  background: "#ffffff",
  name: "الغلاف",
  items: [
    {
      kind: "text" as const,
      x: 17,
      y: 40,
      w: 120,
      h: 24,
      rotation: 0,
      text: "التقرير الربع سنوي",
      font: "Tajawal",
      size: 24,
      weight: 700,
      italic: false,
      color: "#0b2545",
      align: "right" as const,
      lineHeight: 1.4,
      letterSpacing: 0,
      paragraphSpacing: 0,
      vertical: false,
      fill: null,
      border: null,
      radius: 0,
      padding: 0,
    },
    {
      kind: "table" as const,
      x: 17,
      y: 120,
      w: 176,
      h: 40,
      rotation: 0,
      rows: [
        ["البيان", "العدد"],
        ["إصابات", "27"],
        ["وفيات", "3"],
      ],
      font: "Cairo",
      size: 11,
      align: "right" as const,
      headerFill: "#0b2545",
      headerColor: "#ffffff",
      rowFill: "#ffffff",
      stripeFill: "#f2f5fa",
      border: { color: "#d9dee8", width: 0.3 },
      padding: 3,
    },
    {
      kind: "shape" as const,
      x: 17,
      y: 180,
      w: 60,
      h: 30,
      rotation: 0,
      fill: "#0b2545",
      stroke: { color: "#c6a05a", width: 0.6 },
      shapeId: "crescent",
      parts: [
        {
          k: "path" as const,
          d: "M50 5 A45 45 0 1 0 50 95 A35 35 0 1 1 50 5 Z",
        },
      ],
    },
    {
      kind: "shape" as const,
      x: 90,
      y: 180,
      w: 40,
      h: 40,
      rotation: 0,
      fill: "#c6a05a",
      stroke: null,
      shapeId: "circle",
      parts: [{ k: "circle" as const, cx: 50, cy: 50, r: 50 }],
    },
    {
      kind: "shape" as const,
      // A polygon with no PowerPoint preset, so the writers' `custGeom`
      // straight-line emission is exercised rather than only their curves.
      x: 140,
      y: 180,
      w: 40,
      h: 30,
      rotation: 0,
      fill: "#0b2545",
      stroke: null,
      shapeId: "parallelogram",
      parts: [{ k: "poly" as const, points: "20,2 100,2 80,98 0,98" }],
    },
    {
      kind: "icon" as const,
      x: 17,
      y: 250,
      w: 10,
      h: 10,
      rotation: 0,
      path: "M4 4h16v16H4z",
      color: "#0b2545",
      stroke: 2,
    },
  ],
};

describe("parseSvgPath", () => {
  it("parses absolute move/line/close", () => {
    const segs = parseSvgPath("M0 0 L10 0 L10 10 Z");
    assert.equal(segs.length, 4);
    assert.deepEqual(segs[0], { kind: "move", x: 0, y: 0 });
    assert.deepEqual(segs[2], { kind: "line", x: 10, y: 10 });
    assert.equal(segs[3].kind, "close");
  });

  it("tracks relative coordinates", () => {
    const segs = parseSvgPath("M10 10 l5 0 l0 5");
    assert.deepEqual(segs[1], { kind: "line", x: 15, y: 10 });
    assert.deepEqual(segs[2], { kind: "line", x: 15, y: 15 });
  });

  it("supports horizontal and vertical shorthands", () => {
    const segs = parseSvgPath("M0 0 H10 V10");
    assert.deepEqual(segs[1], { kind: "line", x: 10, y: 0 });
    assert.deepEqual(segs[2], { kind: "line", x: 10, y: 10 });
  });

  it("emits cubics with control points", () => {
    const segs = parseSvgPath("M0 0 C1 1 2 2 3 3");
    assert.equal(segs[1].kind, "cubic");
    assert.deepEqual(segs[1], {
      kind: "cubic",
      x: 3,
      y: 3,
      x1: 1,
      y1: 1,
      x2: 2,
      y2: 2,
    });
  });

  it("approximates arcs as cubics rather than dropping them", () => {
    const segs = parseSvgPath("M50 5 A45 45 0 1 0 50 95");
    assert.equal(segs.length, 2);
    assert.equal(segs[1].kind, "cubic");
    assert.equal((segs[1] as { x: number }).x, 50);
    assert.equal((segs[1] as { y: number }).y, 95);
  });

  it("stops at an unknown command instead of inventing geometry", () => {
    const segs = parseSvgPath("M0 0 L5 5 Q9 9 9 9");
    assert.equal(segs.length, 2);
  });

  it("keeps every subpath of a compound path", () => {
    const segs = parseSvgPath("M0 0 L10 0 Z M0 10 L10 10 Z");
    const closes = segs.filter((s) => s.kind === "close").length;
    const moves = segs.filter((s) => s.kind === "move").length;
    assert.equal(moves, 2);
    assert.equal(closes, 2);
  });
});

describe("scaleSegments", () => {
  it("scales points and control points into the target box", () => {
    const segs = scaleSegments(parseSvgPath("M0 0 C1 1 2 2 3 3"), 10, 20);
    assert.deepEqual(segs[1], {
      kind: "cubic",
      x: 30,
      y: 60,
      x1: 10,
      y1: 20,
      x2: 20,
      y2: 40,
    });
  });
});

describe("writeDocx", () => {
  it("emits editable text runs, real tables and vector shapes", async () => {
    const { writeDocx } = await import("./docx-writer.ts");
    const blob = await writeDocx({ scenes: [PAGE], title: "تقرير" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file("word/document.xml")!.async("string");

    // The title must be a real text run, not a picture.
    assert.match(doc, /التقرير الربع سنوي/);
    assert.match(doc, /<w:t[ >]/);
    assert.doesNotMatch(doc, /<w:drawing>[^]*?<wp:inline>[^]*?<a:blip/);

    // Tables must be genuine `w:tbl` with cells.
    assert.match(doc, /<w:tbl>/);
    assert.match(doc, /<w:tc>/);
    assert.match(doc, /إصابات/);

    // Shapes must carry DrawingML geometry, not rasterised pixels.
    assert.match(doc, /<wps:wsp>/);
    assert.match(doc, /<a:custGeom>/);
    assert.match(doc, /<a:cubicBezTo>/);
    assert.match(doc, /<a:prstGeom prst="ellipse"/);
    // Custom geometry is what keeps the crescent a vector.
    assert.match(doc, /<a:moveTo>/);
    assert.match(doc, /<a:lnTo>/);
  });

  it("floats tables so designed coordinates survive", async () => {
    const { writeDocx } = await import("./docx-writer.ts");
    const blob = await writeDocx({ scenes: [PAGE], title: "تقرير" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file("word/document.xml")!.async("string");
    assert.match(doc, /<w:tblpPr/);
    assert.match(doc, /w:tblpX/);
    assert.match(doc, /w:tblpY/);
  });

  it("keeps tables at body level rather than inside a paragraph", async () => {
    const { writeDocx } = await import("./docx-writer.ts");
    const blob = await writeDocx({ scenes: [PAGE], title: "تقرير" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file("word/document.xml")!.async("string");

    // Word only accepts `<w:tbl>` as a body-level sibling. A table nested in
    // `<w:p>` still passes substring checks but is silently dropped by Word,
    // python-docx and LibreOffice, so assert the table is not inside a paragraph.
    const tblStart = doc.indexOf("<w:tbl");
    assert.ok(tblStart > -1, "expected a table");
    const prefix = doc.slice(0, tblStart);
    const opened = (prefix.match(/<w:p[ >]/g) || []).length;
    const closed = (prefix.match(/<\/w:p>/g) || []).length;
    assert.equal(
      opened,
      closed,
      "the table must not be nested inside an open <w:p>",
    );
  });

  it("gives every drawing a unique id and page anchoring", async () => {
    const { writeDocx } = await import("./docx-writer.ts");
    const blob = await writeDocx({ scenes: [PAGE], title: "تقرير" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file("word/document.xml")!.async("string");
    const ids = [...doc.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
    assert.ok(ids.length >= 2, "expected multiple anchored drawings");
    assert.equal(new Set(ids).size, ids.length, "drawing ids must be unique");
    assert.match(doc, /relativeFrom="page"/);
  });

  it("sizes the section to the authored page", async () => {
    const { writeDocx } = await import("./docx-writer.ts");
    const blob = await writeDocx({ scenes: [PAGE], title: "تقرير" });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const doc = await zip.file("word/document.xml")!.async("string");
    // 210 × 297 mm, converted to twips by the `docx` unit helper.
    const { convertMillimetersToTwip } = await import("docx");
    assert.match(doc, new RegExp(`w:w="${convertMillimetersToTwip(210)}"`));
    assert.match(doc, new RegExp(`w:h="${convertMillimetersToTwip(297)}"`));
    // Zero margins keep an absolutely-positioned report at true page coordinates.
    assert.match(doc, /<w:pgMar[^>]*w:top="0"/);
  });
});

describe("writePptx", () => {
  it("emits editable slide text, tables and native geometry", async () => {
    const { writePptx } = await import("./pptx-writer.ts");
    const blob = await writePptx([PAGE], "تقرير");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files);
    assert.ok(names.includes("ppt/slides/slide1.xml"), "expected a slide");

    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    // Real text body, not a full-bleed picture.
    assert.match(slide, /<a:t>التقرير الربع سنوي<\/a:t>/);
    assert.match(slide, /<a:tbl>/);
    assert.match(slide, /إصابات/);
    // Native geometry, including a custom path for the crescent.
    assert.match(slide, /<a:prstGeom prst="ellipse"/);
    assert.match(slide, /<a:custGeom>/);
    assert.match(slide, /<a:cubicBezTo>/);
    assert.match(slide, /<a:moveTo>/);
    // Right-to-left runs must be flagged so Arabic orders correctly.
    assert.match(slide, /rtl="1"/);
  });

  it("keeps custom-geometry points inside the declared path box", async () => {
    const { writePptx } = await import("./pptx-writer.ts");
    const blob = await writePptx([PAGE], "تقرير");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");

    // pptxgenjs declares the path box as the shape's EMU extent, so points
    // outside it are clamped by PowerPoint and the shape renders wrong. It also
    // rescales any value under 100 as inches, so a writer emitting millimetres
    // passes this comparison only by accident.
    const paths = [
      ...slide.matchAll(/<a:path w="(\d+)" h="(\d+)">([^]*?)<\/a:path>/g),
    ];
    assert.ok(paths.length > 0, "expected at least one custom path");
    let ptCount = 0;
    for (const [, pw, ph, body] of paths) {
      for (const [, px, py] of body.matchAll(
        /<a:pt x="(-?\d+)" y="(-?\d+)"/g,
      )) {
        ptCount++;
        const x = Number(px);
        const y = Number(py);
        assert.ok(x >= 0 && x <= Number(pw), `x ${x} outside 0..${pw}`);
        assert.ok(y >= 0 && y <= Number(ph), `y ${y} outside 0..${ph}`);
      }
    }
    assert.ok(ptCount > 0, "custom paths must define points");
  });

  it("uses a slide size matching the report page", async () => {
    const { writePptx } = await import("./pptx-writer.ts");
    const blob = await writePptx([PAGE], "تقرير");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    // 210 × 297 mm in EMU (1 mm = 36000 EMU).
    assert.match(pres, /sldSz cx="7560000" cy="10692000"/);
  });

  it("names every slide object so it is selectable in the pane", async () => {
    const { writePptx } = await import("./pptx-writer.ts");
    const blob = await writePptx([PAGE], "تقرير");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const names = [...slide.matchAll(/<p:cNvPr id="\d+" name="([^"]+)"/g)].map(
      (m) => m[1],
    );
    assert.ok(names.length >= 3, "expected several named objects");
    // pptxgenjs falls back to "Shape 1", which passes a non-empty check while
    // leaving the selection pane useless in a long report.
    assert.ok(
      names.every((n) => !/^(Shape|Text|Table|Picture|Image)\s*\d*$/.test(n)),
      `objects must have descriptive names, got: ${names.join(", ")}`,
    );
    assert.ok(
      names.some((n) => n.includes("جدول")),
      "the table should be named as a table",
    );
  });

  it("writes icons as well-formed SVG data URLs", async () => {
    const { writePptx } = await import("./pptx-writer.ts");
    const blob = await writePptx([PAGE], "تقرير");
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const media = Object.keys(zip.files).filter((f) => f.endsWith(".svg"));
    assert.ok(media.length >= 1, "the icon should be embedded as an SVG part");

    const svg = await zip.file(media[0])!.async("string");
    assert.match(svg, /^<svg/, "the embedded part must be the raw SVG");

    // pptxgenjs turns the SVG into a PNG fallback by loading it in an <img>.
    // A `data:` prefix is required; without it the browser resolves the value as
    // a relative path and the export rejects with "Unable to load image".
    const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.doesNotMatch(slide, /r:embed="[^"]*image\/svg/);
  });
});
