/**
 * Excel / CSV import for the table builder (step 11).
 *
 * A report table almost always starts life in a spreadsheet, so the builder has
 * to accept the two files people actually have: `.csv` (plain text) and `.xlsx`
 * (a zip of XML parts). No spreadsheet dependency is added — `jszip` is already
 * shipped for the export pipeline — and the XML reading is deliberately small:
 * shared strings, inline strings and cell references are all a real `.xlsx`
 * needs for tabular data.
 *
 * The parsing helpers are pure and unit-tested; only `importTableFile` touches
 * the `File` API.
 */

import JSZip from "jszip";

/** Hard ceilings, matching `resizeMatrix` so an import can never outgrow it. */
export const IMPORT_MAX_COLS = 60;
export const IMPORT_MAX_ROWS = 400;

export interface ImportedTable {
  /** Dense matrix, every row padded to the same width. */
  rows: string[][];
  cols: number;
  rowCount: number;
  source: "csv" | "xlsx";
  /** Worksheet name for `.xlsx`, or the file name for `.csv`. */
  label?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** Minimal XML entity decoder (named + numeric), enough for cell text. */
export function decodeXmlEntities(input: string): string {
  return String(input ?? "").replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

/**
 * Split CSV/TSV/semicolon text into a matrix.
 *
 * Implements the parts of RFC 4180 that actually appear in exports: quoted
 * fields, `""` as an escaped quote, embedded newlines inside quotes, a UTF-8
 * BOM, and CRLF or LF line endings. The delimiter is auto-detected from the
 * first line unless the caller names one.
 */
export function parseDelimitedText(
  text: string,
  delimiter?: string,
): string[][] {
  const clean = String(text ?? "").replace(/^\uFEFF/, "");
  if (!clean.trim()) return [];
  const delim = delimiter ?? detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Treat CRLF as one break.
      if (ch === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  row.push(field);
  rows.push(row);
  return normalizeMatrix(rows);
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const counts: Array<[string, number]> = [
    ["\t", (firstLine.match(/\t/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
    [",", (firstLine.match(/,/g) ?? []).length],
    ["|", (firstLine.match(/\|/g) ?? []).length],
  ];
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

/**
 * Trim the empty margins and pad every row to the widest one.
 *
 * Trailing blank rows are what spreadsheets leave behind; keeping them would
 * insert a table with a dozen empty rows at the bottom of the page.
 */
export function normalizeMatrix(matrix: string[][]): string[][] {
  const rows = matrix.map((row) =>
    row.map((cell) => String(cell ?? "").trim()),
  );
  while (rows.length && rows[rows.length - 1].every((cell) => cell === ""))
    rows.pop();
  while (rows.length && rows[0].every((cell) => cell === "")) rows.shift();
  const width = Math.max(
    1,
    ...rows.map((row) => {
      let last = row.length;
      while (last > 0 && row[last - 1] === "") last -= 1;
      return last;
    }),
  );
  return rows.map((row) => {
    const next = row.slice(0, width);
    while (next.length < width) next.push("");
    return next;
  });
}

/** Column index (0-based) of an A1-style cell reference: `A1` → 0, `AB3` → 27. */
export function columnIndexFromRef(ref: string): number {
  const letters = /^([A-Za-z]+)/.exec(String(ref ?? ""))?.[1] ?? "";
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Row index (0-based) of an A1-style reference; `-1` when there is no number. */
export function rowIndexFromRef(ref: string): number {
  const digits = /(\d+)$/.exec(String(ref ?? ""))?.[1];
  return digits ? Number(digits) - 1 : -1;
}

interface SheetCell {
  ref: string;
  value: string;
}

/**
 * Lay sparse cells out into a dense matrix.
 *
 * Worksheet XML only stores the cells that have something in them, so a table
 * with a gap in the middle arrives as A1, C1, A2 … — the gaps must become empty
 * cells, not shifts.
 */
export function buildMatrix(
  cells: SheetCell[],
  maxCols = IMPORT_MAX_COLS,
  maxRows = IMPORT_MAX_ROWS,
): string[][] {
  const matrix: string[][] = [];
  for (const cell of cells) {
    const col = columnIndexFromRef(cell.ref);
    const row = rowIndexFromRef(cell.ref);
    if (col < 0 || row < 0 || col >= maxCols || row >= maxRows) continue;
    while (matrix.length <= row) matrix.push([]);
    const target = matrix[row];
    while (target.length <= col) target.push("");
    target[col] = cell.value;
  }
  return normalizeMatrix(matrix);
}

/** Every `<si>` shared string, in order, with its runs flattened. */
export function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    /*
     * `<t>` runs hold the text; rich text splits one string across several runs
     * (`<r><t>…</t></r>`), so they are concatenated rather than joined with a
     * separator. `xml:space="preserve"` means the padding is intentional and is
     * NOT trimmed here.
     */
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeXmlEntities(t[1]))
      .join("")
      .replace(/\r\n/g, "\n"),
  );
}

/** Cells of one worksheet part, shared strings already resolved. */
export function readSheetCells(xml: string, shared: string[]): SheetCell[] {
  const cells: SheetCell[] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    for (const cellMatch of rowMatch[1].matchAll(
      /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g,
    )) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? "";
      const body = cellMatch[3] ?? "";
      const ref = /r="([^"]+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /(?:^|\s)t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      cells.push({ ref, value: readCellValue(type, body, shared) });
    }
  }
  return cells;
}

function readCellValue(type: string, body: string, shared: string[]): string {
  if (type === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeXmlEntities(t[1]))
      .join("");
  }
  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
  const text = decodeXmlEntities(raw);
  if (type === "s") {
    /*
     * A shared-string cell with no `<v>` at all is EMPTY — it must not fall back
     * to index 0 (`Number("")` is 0, which would silently paint the workbook's
     * first string into every blank cell).
     */
    const index = /^\d+$/.test(text.trim()) ? Number(text.trim()) : -1;
    return index >= 0 ? (shared[index] ?? "") : "";
  }
  if (type === "b") return text === "1" ? "نعم" : "لا";
  // Formulas (`t="str"`), numbers, dates-as-serial and errors all arrive as text.
  return text.replace(/\r\n/g, "\n");
}

/** Relationship map (`rId1` → `worksheets/sheet1.xml`) from `xl/_rels/workbook.xml.rels`. */
export function readWorkbookRelations(
  xml: string | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!xml) return map;
  for (const rel of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = rel[1];
    const id = /Id="([^"]+)"/.exec(attrs)?.[1];
    const target = /Target="([^"]+)"/.exec(attrs)?.[1];
    const type = /Type="([^"]+)"/.exec(attrs)?.[1] ?? "";
    // Charts/styles are relationships too — only worksheets carry cells.
    if (id && target && (type === "" || /worksheet/i.test(type))) {
      map[id] = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
    }
  }
  return map;
}

/** `[name, partPath]` of the first worksheet in reading order. */
export function firstSheet(
  workbookXml: string | undefined,
  rels: Record<string, string>,
): { name: string; path: string } | null {
  const sheet = workbookXml
    ? /<sheet\b([^>]*)\/?>/.exec(workbookXml)?.[1]
    : undefined;
  if (!sheet) return null;
  const name = /name="([^"]*)"/.exec(sheet)?.[1] ?? "";
  const rid = /r:id="([^"]+)"/.exec(sheet)?.[1];
  const target = rid ? rels[rid] : undefined;
  if (!target) return null;
  return {
    name: decodeXmlEntities(name),
    path: `xl/${target.replace(/^\/?xl\//, "")}`,
  };
}

/**
 * Read the first worksheet of a `.xlsx` workbook.
 *
 * Throws a human, Arabic message when the file is not a workbook at all, so the
 * panel can show the reason instead of an empty table.
 */
export async function parseXlsx(
  buffer: ArrayBuffer,
  fileName = "",
): Promise<ImportedTable> {
  const zip = await JSZip.loadAsync(buffer);
  const readOptional = async (path: string) => {
    const file = zip.file(path);
    return file ? file.async("string") : undefined;
  };
  const workbookXml = await readOptional("xl/workbook.xml");
  const rels = readWorkbookRelations(
    await readOptional("xl/_rels/workbook.xml.rels"),
  );
  const sheet = firstSheet(workbookXml, rels);
  const path = sheet?.path ?? "xl/worksheets/sheet1.xml";
  const sheetXml = await readOptional(path);
  if (!sheetXml) {
    throw new Error("تعذر قراءة الملف — هل هو ملف Excel (xlsx) صالح؟");
  }
  const shared = readSharedStrings(await readOptional("xl/sharedStrings.xml"));
  const rows = buildMatrix(readSheetCells(sheetXml, shared));
  return {
    rows,
    cols: rows[0]?.length ?? 0,
    rowCount: rows.length,
    source: "xlsx",
    label: sheet?.name || fileName || "ورقة 1",
  };
}

/** True for the file names the builder accepts. */
export function isImportableSheetFile(name: string): boolean {
  return /\.(xlsx|csv|tsv|txt)$/i.test(name.trim());
}

/**
 * Turn a picked/dropped file into table rows.
 *
 * `.xlsx` goes through the zip reader; everything else is read as text (CSV,
 * TSV, or a `\t`-separated export saved with a `.txt` extension).
 */
export async function importTableFile(file: File): Promise<ImportedTable> {
  if (/\.xlsx$/i.test(file.name)) {
    const table = await parseXlsx(await file.arrayBuffer(), file.name);
    if (!table.rows.length)
      throw new Error("الملف لا يحتوي على بيانات في الورقة الأولى.");
    return table;
  }
  const rows = parseDelimitedText(await file.text());
  if (!rows.length) throw new Error("الملف لا يحتوي على بيانات.");
  return {
    rows,
    cols: rows[0]?.length ?? 0,
    rowCount: rows.length,
    source: "csv",
    label: file.name,
  };
}

/** Fit an imported table into the canvas-safe ceilings. */
export function clampImported(table: ImportedTable): ImportedTable {
  const rows = table.rows
    .slice(0, IMPORT_MAX_ROWS)
    .map((row) => row.slice(0, IMPORT_MAX_COLS));
  return {
    ...table,
    rows,
    cols: rows[0]?.length ?? 0,
    rowCount: rows.length,
  };
}
