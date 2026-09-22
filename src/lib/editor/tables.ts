/**
 * Table data utilities.
 *
 * Table content is stored as a JSON matrix of strings, but authors almost never
 * start there — they paste from Excel, Sheets or a CSV export. Parsing lives
 * here so the canvas, the properties panel and the importer all agree on how a
 * clipboard blob becomes rows.
 */

/** Delimiter priority: a real tab wins (spreadsheets), then the pipe we show in the UI. */
function detectDelimiter(text: string): string | null {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes("|")) return "|";
  if (firstLine.includes(";")) return ";";
  if (firstLine.includes(",")) return ",";
  return null;
}

/**
 * Split a spreadsheets/CSV blob into a matrix.
 *
 * A single column of plain text is still a valid table (one cell per row), which
 * is what an author pasting a list of names expects.
 */
export function parsePastedTable(text: string): string[][] {
  const rows = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter(
      (line, i, all) => line.trim() !== "" || (i > 0 && i < all.length - 1),
    );
  if (!rows.length) return [];

  const delim = detectDelimiter(text);
  if (!delim) return rows.map((line) => [line.trim()]);

  return rows.map((line) =>
    line.split(delim).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")),
  );
}

/** Serialise a matrix back to the stored JSON string. */
export function serializeTable(data: string[][]): string {
  return JSON.stringify(data.map((row) => row.map((c) => String(c ?? ""))));
}

/**
 * Grow or shrink a matrix to the requested shape, preserving existing values.
 * Extra cells come back empty rather than "قيمة 2×3" placeholders so a resized
 * table does not fill up with generated noise.
 */
export function resizeMatrix(
  data: string[][],
  cols: number,
  rows: number,
): string[][] {
  const safeCols = Math.max(1, Math.min(60, Math.floor(cols) || 1));
  const safeRows = Math.max(1, Math.min(400, Math.floor(rows) || 1));
  return Array.from({ length: safeRows }, (_, r) =>
    Array.from({ length: safeCols }, (_, c) => data[r]?.[c] ?? ""),
  );
}

/** Insert a row after `at` (or at the end when `at` is out of range). */
export function insertRow(data: string[][], at: number): string[][] {
  const cols = Math.max(1, ...data.map((r) => r.length));
  const next = data.map((r) => [...r]);
  next.splice(
    Math.max(0, Math.min(next.length, at + 1)),
    0,
    Array.from({ length: cols }, () => ""),
  );
  return next;
}

/** Insert an empty column after `at`. */
export function insertColumn(data: string[][], at: number): string[][] {
  return data.map((row) => {
    const next = [...row];
    next.splice(Math.max(0, Math.min(next.length, at + 1)), 0, "");
    return next;
  });
}

export function removeRow(data: string[][], at: number): string[][] {
  if (data.length <= 1) return data;
  return data.filter((_, i) => i !== at);
}

export function removeColumn(data: string[][], at: number): string[][] {
  const cols = Math.max(1, ...data.map((r) => r.length));
  if (cols <= 1) return data;
  return data.map((row) => row.filter((_, i) => i !== at));
}

/** Total numeric sum of a column, ignoring non-numeric cells. */
export function columnSum(data: string[][], col: number): number {
  return data.reduce((sum, row) => {
    const n = Number(String(row[col] ?? "").replace(/[^\d.-]/g, ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

/**
 * Per-column totals for the properties panel, excluding the header row.
 *
 * A column is only reported when at least one body cell parses as a number and
 * no cell fails: a text column that happens to contain one stray digit should
 * not be published as a total. Commas and whitespace are thousands separators.
 */
export function columnTotals(
  data: string[][],
): { col: number; total: number; numeric: boolean }[] {
  const { cols } = tableShape(data);
  const body = data.slice(1);
  return Array.from({ length: cols }, (_, c) => {
    const cells = body.map((row) => String(row[c] ?? ""));
    const parsed = cells.map((v) => Number(v.replace(/[,\s]/g, "")));
    return {
      col: c,
      total: parsed.reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0),
      numeric:
        cells.length > 0 &&
        parsed.some((n) => Number.isFinite(n)) &&
        parsed.every((n) => Number.isFinite(n)),
    };
  });
}

/** One-line summary used for the table status caption in the panel. */
export function tableShape(data: string[][]): {
  rows: number;
  cols: number;
  filled: number;
} {
  const rows = data.length;
  const cols = Math.max(0, ...data.map((r) => r.length));
  const filled = data.reduce(
    (n, row) => n + row.filter((c) => c.trim() !== "").length,
    0,
  );
  return { rows, cols, filled };
}

/** Export a matrix to CSV text (UTF-8 with BOM so Excel reads Arabic correctly). */
export function toCsv(data: string[][]): string {
  const escape = (cell: string) => {
    const v = String(cell ?? "");
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return `\uFEFF${data.map((row) => row.map(escape).join(",")).join("\r\n")}`;
}
