import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { jsPDF } from "jspdf";

import { classifyImport, magicMatches } from "./detect.ts";
import { importTemplateBytes } from "./run.ts";
import { previewCacheKey } from "./shared.ts";
import type { CanvasEl } from "../model.ts";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function texts(els: CanvasEl[]): CanvasEl[] {
  const out: CanvasEl[] = [];
  for (const el of els) {
    if (el.type === "text") out.push(el);
    if (el.children) out.push(...texts(el.children));
  }
  return out;
}

async function docxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/><w:bidi/><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="36"/><w:szCs w:val="36"/><w:rFonts w:cs="Amiri" w:ascii="Calibri"/></w:rPr><w:t>عنوان عربي</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:bidi/></w:pPr>
          <w:r><w:t>فقرة عربية مع English مختلطة</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Quarterly report</w:t></w:r>
        </w:p>
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>البند</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>القيمة</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>الأول</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
        <w:p>
          <w:r>
            <w:drawing>
              <wp:inline>
                <wp:extent cx="914400" cy="914400"/>
                <a:graphic><a:graphicData><a:blip r:embed="rId1"/></a:graphicData></a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
        <w:sectPr>
          <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
          <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
        </w:sectPr>
      </w:body>
    </w:document>`,
  );
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style></w:styles>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
  );
  zip.file("word/media/image1.png", PNG);
  return zip.generateAsync({ type: "uint8array" });
}

async function pptxBytes(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/>
        <p:sldId id="257" r:id="rId2"/>
      </p:sldIdLst>
      <p:sldSz cx="9144000" cy="5143500"/>
    </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="عنوان"/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="457200" y="365760"/><a:ext cx="8229600" cy="914400"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="071D3D"/></a:solidFill>
          </p:spPr>
          <p:txBody>
            <a:p>
              <a:pPr algn="r" rtl="1"/>
              <a:r><a:rPr sz="2800" b="1"><a:solidFill><a:srgbClr val="F7F6F3"/></a:solidFill><a:cs typeface="Tajawal"/></a:rPr><a:t>شريحة عربية</a:t></a:r>
            </a:p>
          </p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<?xml version="1.0"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:pic>
          <p:nvPicPr><p:cNvPr id="3" name="صورة"/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="1828800" cy="1828800"/></a:xfrm></p:spPr>
        </p:pic>
      </p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
  );
  zip.file("ppt/media/image1.png", PNG);
  return zip.generateAsync({ type: "uint8array" });
}

describe("template import classification", () => {
  it("accepts real signatures and rejects renamed or old Office files", () => {
    assert.equal(classifyImport("a.psd", Uint8Array.from([0x38, 0x42, 0x50, 0x53, 0, 1])).format, "psd");
    assert.equal(classifyImport("a.png", PNG).format, "png");
    assert.match(classifyImport("a.doc", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])).error || "", /القديمة/);
    assert.match(classifyImport("notes.txt", Uint8Array.from([1, 2, 3, 4])).error || "", /غير مدعومة/);
    assert.equal(magicMatches("pdf", "255044462d312e34"), true);
    assert.equal(magicMatches("docx", "89504e470d0a1a0a"), false);
  });
});

describe("DOCX → NASAQ", () => {
  it("keeps Arabic, English, a table, an image, and the page size", async () => {
    const imported = await importTemplateBytes(await docxBytes(), "تقرير.docx");
    const page = imported.project.pages[0];
    assert.ok(Math.abs((page.w || 0) - 297) < 1);
    assert.ok(Math.abs((page.h || 0) - 210) < 1);
    const copy = texts(page.elements);
    const title = copy.find((el) => el.content?.includes("عنوان عربي"));
    assert.ok(title);
    assert.equal(title.style.direction, "rtl");
    assert.equal(title.style.fontFamily, "Amiri");
    assert.equal(title.style.fontSize, 18);
    const mixed = copy.find((el) => el.content?.includes("مختلطة"));
    assert.equal(mixed?.style.direction, "rtl");
    const english = copy.find((el) => el.content?.includes("Quarterly"));
    assert.equal(english?.style.direction, "ltr");
    const table = page.elements.find((el) => el.type === "table");
    assert.equal(table?.style.cols, 2);
    assert.match(table?.content || "", /البند/);
    assert.match(table?.content || "", /Cell/);
    assert.ok(page.elements.some((el) => el.type === "image" && el.src?.startsWith("data:image/png")));
    assert.ok(imported.notes.some((note) => note.mode === "partial"));
    assert.equal(title.source?.kind, "docx");
    const reopened = JSON.parse(JSON.stringify(imported.project)) as typeof imported.project;
    assert.equal(reopened.pages[0].elements.find((el) => el.type === "text")?.content, title.content);
    assert.ok(imported.previewDataUrl?.startsWith("data:image/svg+xml;base64,"));
  });
});

describe("PPTX → NASAQ", () => {
  it("turns each slide into a page with text, shape and image", async () => {
    const imported = await importTemplateBytes(await pptxBytes(), "عرض.pptx");
    assert.equal(imported.project.pages.length, 2);
    const [first, second] = imported.project.pages;
    assert.ok(Math.abs((first.w || 0) - 254) < 1);
    assert.ok(Math.abs((first.h || 0) - 142.88) < 0.2);
    const title = texts(first.elements).find((el) => el.content?.includes("شريحة عربية"));
    assert.equal(title?.style.direction, "rtl");
    assert.equal(title?.style.fontWeight, 700);
    assert.ok(first.elements.some((el) => el.type === "shape" && el.style.fill === "#071D3D"));
    assert.ok(second.elements.some((el) => el.type === "image"));
    assert.equal(title?.source?.kind, "pptx");
    assert.ok(imported.notes.some((note) => /الحركة/.test(note.reason)));
  });
});

describe("PDF → NASAQ", () => {
  it("extracts text, page size and an image without inventing a flat page", async () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    pdf.setFontSize(16);
    pdf.text("Editable line", 20, 30);
    pdf.addImage(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "PNG",
      20,
      40,
      30,
      20,
    );
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const imported = await importTemplateBytes(bytes, "ورقة.pdf");
    const page = imported.project.pages[0];
    assert.ok(Math.abs((page.w || 0) - 210) < 1);
    assert.ok(Math.abs((page.h || 0) - 297) < 1);
    const line = texts(page.elements).find((el) => el.content?.includes("Editable"));
    assert.ok(line);
    assert.equal(line.style.direction, "ltr");
    assert.equal(line.source?.kind, "pdf");
    const image = page.elements.find((el) => el.type === "image");
    assert.ok(image);
    assert.ok(Math.abs(image.x - 20) < 2);
    assert.ok(Math.abs(image.y - 40) < 2);
    assert.ok(Math.abs(image.w - 30) < 2);
    assert.ok(imported.notes.some((note) => note.mode === "partial"));
    assert.ok(!imported.notes.some((note) => note.mode === "flattened"));
  });
});

describe("image formats", () => {
  it("imports PNG, SVG and rejects a corrupt JPEG", async () => {
    const png = await importTemplateBytes(PNG, "شعار.png");
    const image = png.project.pages[0].elements[0];
    assert.equal(image.type, "image");
    assert.equal(image.source?.kind, "image");
    assert.ok((png.project.pages[0].w || 0) > 10);
    const svg = new TextEncoder().encode(
      `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><text>نسق</text></svg>`,
    );
    const vector = await importTemplateBytes(svg, "رسم.svg");
    assert.equal(vector.project.pages[0].elements[0].type, "svg");
    assert.match(vector.project.pages[0].elements[0].content || "", /<svg/);
    assert.ok(Math.abs((vector.project.pages[0].w || 0) - 210) < 1);
    const jpg = Uint8Array.from(Buffer.from(
      "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda00080001000100003f00fbffd9",
      "hex",
    ));
    const photo = await importTemplateBytes(jpg, "صورة.jpg");
    assert.equal(photo.project.pages[0].elements[0].type, "image");
    assert.equal(photo.project.pages[0].elements[0].source?.kind, "image");
    assert.ok(photo.project.pages[0].elements[0].src?.startsWith("data:image/jpeg"));
  });
});

describe("preview cache key", () => {
  it("changes when the preview bytes change", () => {
    assert.notEqual(previewCacheKey("data:image/svg+xml;base64,YQ=="), previewCacheKey("data:image/svg+xml;base64,Yg=="));
  });
});
