import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";

import {
  buildMatrix,
  clampImported,
  columnIndexFromRef,
  decodeXmlEntities,
  firstSheet,
  IMPORT_MAX_ROWS,
  isImportableSheetFile,
  normalizeMatrix,
  parseDelimitedText,
  parseXlsx,
  readSharedStrings,
  readSheetCells,
  readWorkbookRelations,
  rowIndexFromRef,
} from "./sheet-import.ts";

describe("csv / delimited import", () => {
  it("parses a plain comma table", () => {
    const rows = parseDelimitedText("الاسم,المبلغ\nأحمد,1000\nسارة,2500");
    assert.deepEqual(rows, [
      ["الاسم", "المبلغ"],
      ["أحمد", "1000"],
      ["سارة", "2500"],
    ]);
  });

  it("honours quoted fields, escaped quotes and embedded newlines", () => {
    const rows = parseDelimitedText('a,"b,1"\n"say ""hi""","line\nbreak"');
    assert.deepEqual(rows, [
      ["a", "b,1"],
      ['say "hi"', "line\nbreak"],
    ]);
  });

  it("auto-detects tabs and semicolons", () => {
    assert.deepEqual(parseDelimitedText("a\tb\tc")[0], ["a", "b", "c"]);
    assert.deepEqual(parseDelimitedText("a;b;c")[0], ["a", "b", "c"]);
  });

  it("strips a UTF-8 BOM and CRLF endings", () => {
    const rows = parseDelimitedText("\uFEFFx,y\r\n1,2\r\n");
    assert.deepEqual(rows, [
      ["x", "y"],
      ["1", "2"],
    ]);
  });

  it("pads short rows to the widest one and drops blank edges", () => {
    const rows = parseDelimitedText("a,b,c\n1,2\n\n\n");
    assert.deepEqual(rows, [
      ["a", "b", "c"],
      ["1", "2", ""],
    ]);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(parseDelimitedText(""), []);
    assert.deepEqual(parseDelimitedText("   \n  "), []);
  });

  it("normalizeMatrix keeps a single empty cell for an empty table", () => {
    assert.deepEqual(normalizeMatrix([]), []);
    assert.deepEqual(normalizeMatrix([["", ""]]), []);
  });

  it("recognises the file names it accepts", () => {
    assert.equal(isImportableSheetFile("جدول.xlsx"), true);
    assert.equal(isImportableSheetFile("data.CSV"), true);
    assert.equal(isImportableSheetFile("data.tsv"), true);
    assert.equal(isImportableSheetFile("sheet.xls"), false);
    assert.equal(isImportableSheetFile("photo.png"), false);
  });
});

describe("xlsx reading", () => {
  it("maps A1 references to zero-based indices", () => {
    assert.equal(columnIndexFromRef("A1"), 0);
    assert.equal(columnIndexFromRef("B2"), 1);
    assert.equal(columnIndexFromRef("Z1"), 25);
    assert.equal(columnIndexFromRef("AA1"), 26);
    assert.equal(columnIndexFromRef("AB10"), 27);
    assert.equal(rowIndexFromRef("AB10"), 9);
    assert.equal(rowIndexFromRef("A"), -1);
  });

  it("decodes entities and numeric character references", () => {
    assert.equal(decodeXmlEntities("R&amp;D &#169; &#x62;"), "R&D © b");
  });

  it("keeps rich-text runs together as one shared string", () => {
    const xml =
      '<?xml version="1.0"?><sst><si><t>عنوان</t></si>' +
      '<si><r><t>مرح</t></r><r><t>با</t></r></si><si><t xml:space="preserve"> 2 </t></si></sst>';
    assert.deepEqual(readSharedStrings(xml), ["عنوان", "مرحبا", " 2 "]);
  });

  it("leaves gaps as empty cells instead of shifting columns", () => {
    const xml =
      '<worksheet><sheetData><row r="1">' +
      '<c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c>' +
      '</row><row r="2"><c r="A2"><v>42</v></c></row></sheetData></worksheet>';
    const cells = readSheetCells(xml, ["الاسم", "المبلغ"]);
    assert.equal(cells.length, 3);
    assert.deepEqual(buildMatrix(cells), [
      ["الاسم", "", "المبلغ"],
      ["42", "", ""],
    ]);
  });

  it("reads inline strings, booleans and formula results", () => {
    const xml =
      '<worksheet><sheetData><row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>مباشر</t></is></c>' +
      '<c r="B1" t="b"><v>1</v></c>' +
      '<c r="C1" t="str"><v>=SUM(A1:B1)</v></c>' +
      "</row></sheetData></worksheet>";
    assert.deepEqual(buildMatrix(readSheetCells(xml, [])), [
      ["مباشر", "نعم", "=SUM(A1:B1)"],
    ]);
  });

  it("handles self-closing cells (a shared string left empty)", () => {
    const xml =
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"/><c r="B1"><v>7</v></c></row></sheetData></worksheet>';
    const cells = readSheetCells(xml, ["x"]);
    assert.equal(cells.length, 2);
    assert.equal(cells[0].value, "");
  });

  it("resolves the first worksheet through the relationship map", () => {
    const rels = readWorkbookRelations(
      '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://x/styles" Target="styles.xml"/></Relationships>',
    );
    assert.deepEqual(rels, { rId1: "worksheets/sheet1.xml" });
    const sheet = firstSheet(
      '<workbook><sheets><sheet name="الميزانية" sheetId="1" r:id="rId1"/></sheets></workbook>',
      rels,
    );
    assert.deepEqual(sheet, {
      name: "الميزانية",
      path: "xl/worksheets/sheet1.xml",
    });
  });

  it("caps an enormous sheet at the canvas ceiling", () => {
    const cells = Array.from({ length: 500 }, (_, i) => ({
      ref: `A${i + 1}`,
      value: String(i),
    }));
    const matrix = buildMatrix(cells, 60, 400);
    assert.equal(matrix.length, 400);
  });

  it("clampImported trims over-wide imported rows", () => {
    const wide = {
      rows: [Array.from({ length: 80 }, (_, i) => String(i))],
      cols: 80,
      rowCount: 1,
      source: "csv" as const,
    };
    const safe = clampImported(wide);
    assert.equal(safe.cols, 60);
    assert.equal(safe.rows[0].length, 60);
  });

  it("stays inside the documented row ceiling", () => {
    assert.equal(IMPORT_MAX_ROWS, 400);
  });
});

describe("xlsx end-to-end", () => {
  /** Build a minimal but genuine workbook: workbook, rels, sharedStrings, sheet. */
  async function makeWorkbook(): Promise<ArrayBuffer> {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0"?><workbook><sheets><sheet name="البيانات" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file(
      "xl/sharedStrings.xml",
      '<?xml version="1.0"?><sst><si><t>البند</t></si><si><t>المبلغ</t></si><si><t>أحمد &amp; شركاه</t></si></sst>',
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0"?><worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1500</v></c></row>' +
        "</sheetData></worksheet>",
    );
    return zip.generateAsync({ type: "arraybuffer" });
  }

  it("reads a real workbook into a table", async () => {
    const table = await parseXlsx(await makeWorkbook());
    assert.equal(table.source, "xlsx");
    assert.equal(table.label, "البيانات");
    assert.equal(table.rowCount, 2);
    assert.equal(table.cols, 2);
    assert.deepEqual(table.rows, [
      ["البند", "المبلغ"],
      ["أحمد & شركاه", "1500"],
    ]);
  });

  it("throws a readable error for a zip that is not a workbook", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "not a spreadsheet");
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    await assert.rejects(() => parseXlsx(buffer), /xlsx/);
  });
});
