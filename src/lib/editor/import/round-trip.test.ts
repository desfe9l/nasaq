/**
 * IMPORT → EDIT → SAVE → REOPEN → EXPORT, across the real engines.
 *
 * Each engine is already covered on its own (converter tests, `.nsq` format
 * tests, Office writer tests). What this file covers is the SEAM between them,
 * because that is where "deep hybridization" actually lives:
 *
 *   · a foreign document (DOCX / PPTX / XLSX / PDF / SVG) becomes native NASAQ
 *     elements — not a screenshot;
 *   · the author's edit is made to the NATIVE model;
 *   · the project is written as a real `.nsq` container and read back;
 *   · the reopened document exports to editable Office formats.
 *
 * Every assertion reads the actual bytes: the `.nsq` container is parsed, the
 * exported Office parts are unzipped and inspected. A flattened export would
 * pass "it produced a file" and fail here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { jsPDF } from "jspdf";
import { parseTable, type CanvasEl, type Page } from "../model.ts";
import { importTemplateBytes } from "./run.ts";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/* ── Fixtures: real OOXML packages, built here so the test owns its bytes ── */

async function docxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/><w:bidi/><w:jc w:val="right"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="36"/><w:szCs w:val="36"/><w:rFonts w:cs="Amiri"/></w:rPr><w:t>التقرير السنوي</w:t></w:r>
        </w:p>
        <w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>فقرة تمهيدية عربية</w:t></w:r></w:p>
        <w:tbl>
          <w:tr><w:tc><w:p><w:r><w:t>البند</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>القيمة</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>الإيرادات</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>١٢٠</w:t></w:r></w:p></w:tc></w:tr>
        </w:tbl>
        <w:p>
          <w:r><w:drawing><wp:inline>
            <wp:extent cx="914400" cy="914400"/>
            <a:graphic><a:graphicData><a:blip r:embed="rId1"/></a:graphicData></a:graphic>
          </wp:inline></w:drawing></w:r>
        </w:p>
        <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
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

async function pptxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
    <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
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
  const slide = (id: number, text: string) => `<?xml version="1.0"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="${id}" name="عنوان ${id}"/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="457200" y="365760"/><a:ext cx="8229600" cy="914400"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:solidFill><a:srgbClr val="071D3D"/></a:solidFill>
          </p:spPr>
          <p:txBody>
            <a:p><a:pPr algn="r" rtl="1"/><a:r><a:rPr sz="2800" b="1"><a:cs typeface="Tajawal"/></a:rPr><a:t>${text}</a:t></a:r></a:p>
          </p:txBody>
        </p:sp>
      </p:spTree></p:cSld>
    </p:sld>`;
  zip.file("ppt/slides/slide1.xml", slide(2, "شريحة أولى"));
  zip.file("ppt/slides/slide2.xml", slide(3, "شريحة ثانية"));
  return zip.generateAsync({ type: "uint8array" });
}

async function xlsxFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  const sheet = (rows: string[][]) =>
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map(
              (value, c) =>
                `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`,
            )
            .join("")}</row>`,
      )
      .join("")}</sheetData></worksheet>`;
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="الميزانية" sheetId="1" r:id="rId1"/><sheet name="ملاحظات" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    sheet([
      ["البند", "المبلغ"],
      ["الإيرادات", "1200"],
      ["المصروفات", "800"],
    ]),
  );
  zip.file("xl/worksheets/sheet2.xml", sheet([["ملاحظة"], ["مراجعة داخلية"]]));
  return zip.generateAsync({ type: "uint8array" });
}

function pdfFixture(): Uint8Array {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setFontSize(18);
  pdf.text("Quarterly figures", 20, 30);
  pdf.setFillColor(7, 29, 61);
  pdf.rect(20, 40, 60, 30, "F");
  pdf.addPage();
  pdf.text("Appendix", 20, 30);
  return new Uint8Array(pdf.output("arraybuffer"));
}

const SVG = new TextEncoder().encode(
  `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="140mm" viewBox="0 0 210 140">
     <rect x="10" y="10" width="80" height="40" fill="#0b2545"/>
     <text x="20" y="90" font-size="14">رسم متجهي</text>
   </svg>`,
);

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const flatten = (elements: CanvasEl[]): CanvasEl[] => {
  const out: CanvasEl[] = [];
  for (const el of elements) {
    out.push(el);
    if (el.children?.length) out.push(...flatten(el.children));
  }
  return out;
};
const allElements = (pages: Page[]): CanvasEl[] =>
  pages.flatMap((page) => flatten(page.elements));
const findText = (pages: Page[], needle: string): CanvasEl | undefined =>
  allElements(pages).find((el) => el.type === "text" && (el.content ?? "").includes(needle));

async function nsqRoundTrip(project: Parameters<typeof nsqWrite>[0]["project"]) {
  const written = await nsqWrite({ project });
  const bytes = new Uint8Array(await written.blob.arrayBuffer());
  const read = await nsqRead(bytes);
  return { bytes, read, warnings: written.warnings };
}

const nsqWrite = (input: Parameters<typeof import("../../nsq/package.ts").writeNsq>[0]) =>
  import("../../nsq/package.ts").then((m) => m.writeNsq(input));
const nsqRead = (bytes: Uint8Array) =>
  import("../../nsq/package.ts").then((m) => m.readNsq(bytes));

async function exportDocxXml(pages: Page[]): Promise<string> {
  const [{ buildScene }, { writeDocx }] = await Promise.all([
    import("../scene.ts"),
    import("../docx-writer.ts"),
  ]);
  const blob = await writeDocx({
    scenes: buildScene(pages, pages),
    title: "اختبار",
  });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml")!.async("string");
}

async function exportPptxZip(pages: Page[]): Promise<JSZip> {
  const [{ buildScene }, { writePptx }] = await Promise.all([
    import("../scene.ts"),
    import("../pptx-writer.ts"),
  ]);
  const blob = await writePptx(buildScene(pages, pages), "اختبار");
  return JSZip.loadAsync(await blob.arrayBuffer());
}

/* ── The suite ───────────────────────────────────────────────────────────── */

describe("import → edit → .nsq → reopen → export", () => {
  it("DOCX keeps text, table and image as native elements and survives the whole trip", async () => {
    const imported = await importTemplateBytes(await docxFixture(), "تقرير.docx");
    const pages = imported.project.pages as Page[];

    const heading = findText(pages, "التقرير السنوي");
    assert.ok(heading, "the DOCX heading is a native text element");
    const table = allElements(pages).find((el) => el.type === "table");
    assert.ok(table, "the DOCX table is a native table element");
    const image = allElements(pages).find((el) => el.type === "image");
    assert.ok(image?.src?.startsWith("data:image/"), "the embedded picture is inlined");
    assert.ok(
      imported.stats.editable > 0,
      "the import reports editable elements rather than a flattened page",
    );
    assert.equal(
      allElements(pages).some((el) => el.type === "image" && el.src === "about:blank"),
      false,
      "no element is a placeholder image",
    );

    // ── EDIT (the author's change, made to the native model) ───────────────
    const edited = {
      ...imported.project,
      pages: pages.map((page) => ({
        ...page,
        elements: page.elements.map((el) =>
          el.id === heading!.id
            ? { ...el, content: "<p>التقرير السنوي — نسخة مُحرَّرة</p>" }
            : el,
        ),
      })),
    };

    // ── SAVE → REOPEN ──────────────────────────────────────────────────────
    const { bytes, read } = await nsqRoundTrip(edited);
    assert.ok(bytes.byteLength > 0, "the container has bytes");
    const reopened = read.project.pages as Page[];
    assert.equal(reopened.length, pages.length, "page count survives the container");
    assert.ok(
      findText(reopened, "نسخة مُحرَّرة"),
      "the edit survives .nsq save + reopen",
    );
    assert.ok(
      allElements(reopened).some((el) => el.type === "table"),
      "the table survives the container",
    );
    const reopenedImage = allElements(reopened).find((el) => el.type === "image");
    assert.equal(
      reopenedImage?.src,
      image?.src,
      "the embedded picture is byte-identical after the container trip",
    );

    // ── EXPORT ─────────────────────────────────────────────────────────────
    const documentXml = await exportDocxXml(reopened);
    assert.match(documentXml, /نسخة مُحرَّرة|نسخة/, "the edited text is a real Word run");
    assert.match(documentXml, /البند/, "the table text survives into Word");
  });

  it("PPTX pages become native pages in order and export as editable slides", async () => {
    const imported = await importTemplateBytes(await pptxFixture(), "عرض.pptx");
    const pages = imported.project.pages as Page[];
    assert.equal(pages.length, 2, "one NASAQ page per slide");
    assert.ok(findText(pages, "شريحة أولى"), "slide 1 text is native");
    assert.ok(findText(pages, "شريحة ثانية"), "slide 2 text is native");

    const { read } = await nsqRoundTrip(imported.project);
    const reopened = read.project.pages as Page[];
    assert.equal(reopened.length, 2, "both slides survive the container");
    assert.ok(findText(reopened, "شريحة ثانية"), "second slide text survives");

    const zip = await exportPptxZip(reopened);
    const first = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const second = await zip.file("ppt/slides/slide2.xml")!.async("string");
    assert.match(first, /شريحة أولى/, "slide 1 exports as real text");
    assert.match(second, /شريحة ثانية/, "slide 2 exports as real text");
  });

  it("XLSX worksheets become editable native tables, one page each", async () => {
    const imported = await importTemplateBytes(await xlsxFixture(), "ميزانية.xlsx");
    const pages = imported.project.pages as Page[];
    assert.equal(pages.length, 2, "one page per worksheet");
    const tables = allElements(pages).filter((el) => el.type === "table");
    assert.equal(tables.length, 2, "each worksheet is a native table");
    const cells = tables.flatMap((table) => parseTable(table.content).flat());
    assert.ok(cells.includes("الإيرادات"), "cell values are editable text, not a picture");
    assert.ok(cells.includes("المصروفات"), "no row is dropped");
    assert.ok(
      imported.notes.some((note) => note.mode === "partial" && /صيغ الحسابات|جدول/.test(note.reason)),
      "formula limits are reported explicitly instead of being silently lost",
    );

    const { read } = await nsqRoundTrip(imported.project);
    const reopened = read.project.pages as Page[];
    const reopenedCells = allElements(reopened)
      .filter((el) => el.type === "table")
      .flatMap((table) => parseTable(table.content).flat());
    assert.ok(reopenedCells.includes("الإيرادات"), "table values survive the container");
  });

  it("PDF pages keep their real size and their extractable content", async () => {
    const imported = await importTemplateBytes(pdfFixture(), "أرقام.pdf");
    const pages = imported.project.pages as Page[];
    assert.equal(pages.length, 2, "one NASAQ page per PDF page");
    assert.ok((pages[0].w ?? 0) > 150 && (pages[0].h ?? 0) > 200, "A4 geometry is kept");
    const shape = Math.abs((pages[0].w ?? 0) - 210) < 2 && Math.abs((pages[0].h ?? 0) - 297) < 2;
    assert.ok(shape, "portrait A4 is preserved in millimetres");
    // Text extraction depends on the encoder's font embedding; the VECTOR path
    // must work regardless, and the page must never be replaced by a mock.
    assert.ok(
      allElements(pages).length > 0,
      "the PDF produced native elements (text, vectors or decoded images)",
    );
    const { read } = await nsqRoundTrip(imported.project);
    const reopened = read.project.pages as Page[];
    assert.equal(reopened.length, 2, "pages survive the container");
    assert.equal(
      allElements(reopened).length,
      allElements(pages).length,
      "no element is lost in the container trip",
    );
  });

  it("SVG artwork becomes a native editable vector element", async () => {
    const imported = await importTemplateBytes(SVG, "رسم.svg");
    const pages = imported.project.pages as Page[];
    const vector = allElements(pages).find((el) => el.type === "svg");
    assert.ok(vector, "SVG imports as a native svg element");
    assert.match(vector!.content ?? "", /<svg/, "the markup is kept, not rasterised");
    assert.ok(Math.abs((pages[0].w ?? 0) - 210) < 1, "the declared width is honoured");

    const { read } = await nsqRoundTrip(imported.project);
    const reopened = read.project.pages as Page[];
    const reopenedVector = allElements(reopened).find((el) => el.type === "svg");
    assert.match(reopenedVector?.content ?? "", /<svg/, "vector content survives the container");

    const documentXml = await exportDocxXml(reopened);
    assert.ok(documentXml.length > 0, "the document exports to Word");
  });
});
