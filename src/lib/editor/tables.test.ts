import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  columnTotals,
  insertColumn,
  insertRow,
  parsePastedTable,
  removeColumn,
  removeRow,
  resizeMatrix,
  serializeTable,
  toCsv,
} from "./tables.ts";

describe("parsePastedTable", () => {
  it("splits tab-separated spreadsheet data", () => {
    assert.deepEqual(parsePastedTable("البيان\tالعدد\nإصابات\t27"), [
      ["البيان", "العدد"],
      ["إصابات", "27"],
    ]);
  });

  it("splits pipe-separated data", () => {
    assert.deepEqual(parsePastedTable("أ | ب | ج"), [["أ", "ب", "ج"]]);
  });

  it("splits comma-separated data", () => {
    assert.deepEqual(parsePastedTable("أ,ب\nج,د"), [
      ["أ", "ب"],
      ["ج", "د"],
    ]);
  });

  it("treats a single column of text as one cell per row", () => {
    assert.deepEqual(parsePastedTable("أحمد\nسعيد"), [["أحمد"], ["سعيد"]]);
  });

  it("unquotes quoted cells", () => {
    assert.deepEqual(parsePastedTable('"قيمة, فيها فاصلة"|ب'), [
      ["قيمة, فيها فاصلة", "ب"],
    ]);
  });

  it("returns an empty matrix for blank input", () => {
    assert.deepEqual(parsePastedTable("   "), []);
  });
});

describe("resizeMatrix", () => {
  const data = [
    ["أ", "ب"],
    ["ج", "د"],
  ];

  it("preserves existing cells when growing", () => {
    assert.deepEqual(resizeMatrix(data, 3, 3), [
      ["أ", "ب", ""],
      ["ج", "د", ""],
      ["", "", ""],
    ]);
  });

  it("drops trailing cells when shrinking", () => {
    assert.deepEqual(resizeMatrix(data, 1, 1), [["أ"]]);
  });

  it("clamps to at least one row and column", () => {
    assert.deepEqual(resizeMatrix(data, 0, 0), [["أ"]]);
  });
});

describe("row and column edits", () => {
  const data = [
    ["أ", "ب"],
    ["ج", "د"],
  ];

  it("inserts an empty row after the given index", () => {
    assert.deepEqual(insertRow(data, 0), [
      ["أ", "ب"],
      ["", ""],
      ["ج", "د"],
    ]);
  });

  it("appends a row when the index is out of range", () => {
    assert.equal(insertRow(data, 99).length, 3);
  });

  it("inserts a column after the given index in every row", () => {
    assert.deepEqual(insertColumn(data, 0), [
      ["أ", "", "ب"],
      ["ج", "", "د"],
    ]);
  });

  it("removes the requested row", () => {
    assert.deepEqual(removeRow(data, 0), [["ج", "د"]]);
  });

  it("refuses to remove the last remaining column", () => {
    const single = [["أ"], ["ب"]];
    assert.deepEqual(removeColumn(single, 0), single);
  });
});

describe("columnTotals", () => {
  it("sums body cells and skips the header row", () => {
    const totals = columnTotals([
      ["البيان", "العدد"],
      ["إصابات", "27"],
      ["وفيات", "3"],
    ]);
    assert.equal(totals[1].total, 30);
    assert.equal(totals[1].numeric, true);
  });

  it("marks a text column as non-numeric", () => {
    const totals = columnTotals([
      ["البيان", "العدد"],
      ["إصابات", "27"],
      ["ملاحظة", "غير متوفر"],
    ]);
    assert.equal(totals[0].numeric, false);
  });

  it("accepts thousands separators", () => {
    const totals = columnTotals([
      ["البيان", "العدد"],
      ["أ", "1,200"],
      ["ب", "800"],
    ]);
    assert.equal(totals[1].total, 2000);
  });

  it("treats a header-only column as non-numeric", () => {
    const totals = columnTotals([["العدد"]]);
    assert.equal(totals[0].numeric, false);
  });
});

describe("serializeTable", () => {
  it("round-trips through JSON", () => {
    const data = [["أ", "1"]];
    assert.deepEqual(JSON.parse(serializeTable(data)), data);
  });

  it("coerces missing cells to empty strings", () => {
    assert.equal(serializeTable([[undefined as unknown as string]]), '[[""]]');
  });
});

describe("toCsv", () => {
  it("starts with a BOM so Excel reads Arabic correctly", () => {
    assert.ok(toCsv([["أ"]]).startsWith("\uFEFF"));
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    const csv = toCsv([["قيمة, فيها فاصلة", 'علامة "اقتباس"', "سطر\nجديد"]]);
    assert.ok(csv.includes('"قيمة, فيها فاصلة"'));
    assert.ok(csv.includes('"علامة ""اقتباس"""'));
    assert.ok(csv.includes('"سطر\nجديد"'));
  });

  it("uses CRLF between rows", () => {
    assert.ok(toCsv([["أ"], ["ب"]]).includes("\r\n"));
  });
});
