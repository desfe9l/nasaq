import { useMemo, useRef, useState } from "react";
import {
  ClipboardPaste,
  FileSpreadsheet,
  Hash,
  Loader2,
  Table2,
} from "lucide-react";
import {
  createElement,
  type CanvasEl,
  type ElStyle,
  type Theme,
} from "@/lib/editor/model";
import {
  parsePastedTable,
  serializeTable,
  tableShape,
} from "@/lib/editor/tables";
import {
  clampImported,
  importTableFile,
  isImportableSheetFile,
  type ImportedTable,
} from "@/lib/editor/sheet-import";
import { cn } from "@/lib/utils";

// The hover grid is deliberately small (a quick pick), while the manual inputs
// go all the way to the ceilings `resizeMatrix` enforces — a real report table
// can be far taller than 12 rows.
const MAX_COLS = 10;
const MAX_ROWS = 12;
const LIMIT_COLS = 60;
const LIMIT_ROWS = 400;

/** Ready-made table shapes for common report layouts. */
const SHAPES: {
  id: string;
  label: string;
  cols: number;
  rows: number;
  header: boolean;
  hint: string;
}[] = [
  {
    id: "grid",
    label: "شبكة",
    cols: 3,
    rows: 5,
    header: true,
    hint: "رأس + صفوف بيانات",
  },
  {
    id: "list",
    label: "قائمة",
    cols: 2,
    rows: 6,
    header: true,
    hint: "بند وقيمة",
  },
  {
    id: "wide",
    label: "جدول عريض",
    cols: 6,
    rows: 4,
    header: true,
    hint: "أعمدة متعددة",
  },
  {
    id: "plain",
    label: "بدون رأس",
    cols: 3,
    rows: 4,
    header: false,
    hint: "خلايا فقط",
  },
];

interface Props {
  theme: Theme;
  onAdd: (over: Partial<CanvasEl>, style?: Partial<ElStyle>) => void;
}

/**
 * Table builder: pick a grid interactively, type exact rows × columns, start
 * from a layout preset, paste rows from Excel/Sheets/CSV, or import a real
 * `.xlsx` / `.csv` file. The import path is the one a report actually starts
 * from, so it reads the file (never the clipboard) and reports the shape it
 * found before inserting.
 */
export function TablePicker({ theme, onAdd }: Props) {
  const [hover, setHover] = useState<{ c: number; r: number } | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  /** Manual size entry (step 11) — the precise path next to the hover grid. */
  const [manualCols, setManualCols] = useState("3");
  const [manualRows, setManualRows] = useState("4");
  /** File import (step 11): `.xlsx` / `.csv` straight into a canvas table. */
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedTable | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const grid = { c: hover?.c || 3, r: hover?.r || 4 };

  const preview = useMemo(() => {
    if (!pasteText.trim()) return null;
    return tableShape(parsePastedTable(pasteText));
  }, [pasteText]);

  const addGrid = (cols: number, rows: number, header = true) => {
    const el = createElement(
      "table",
      { w: Math.min(180, 34 + cols * 26), h: 12 + rows * 9 },
      theme,
    );
    const data = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, () => (header && r === 0 ? "العنوان" : "")),
    );
    onAdd({ content: serializeTable(data) }, { cols, rows, ...el.style });
  };

  const addFromPaste = () => {
    const parsed = parsePastedTable(pasteText);
    if (!parsed.length) return;
    const cols = Math.max(1, ...parsed.map((r) => r.length));
    const rows = parsed.length;
    const el = createElement(
      "table",
      { w: Math.min(190, 34 + cols * 26), h: 12 + rows * 9 },
      theme,
    );
    onAdd({ content: serializeTable(parsed) }, { cols, rows, ...el.style });
    setPasteText("");
    setShowPaste(false);
  };

  const clampInt = (
    raw: string,
    min: number,
    max: number,
    fallback: number,
  ) => {
    const value = Math.floor(Number(raw));
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  };

  /** Manual rows × columns: exactly the numbers typed, no grid hover needed. */
  const addManual = () => {
    addGrid(
      clampInt(manualCols, 1, LIMIT_COLS, 3),
      clampInt(manualRows, 1, LIMIT_ROWS, 4),
    );
  };

  /**
   * Import a spreadsheet into a structured canvas table.
   *
   * Two stages on purpose: reading shows what was found (rows × columns, sheet
   * name) and only the insert button writes to the artboard — so a wrong file is
   * a one-line correction instead of an undo.
   */
  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setImportError(null);
    if (!isImportableSheetFile(file.name)) {
      setImported(null);
      setImportError(
        "الصيغة غير مدعومة — استخدم ملف Excel (.xlsx) أو CSV (.csv).",
      );
      return;
    }
    setImporting(true);
    try {
      setImported(clampImported(await importTableFile(file)));
    } catch (error) {
      setImported(null);
      setImportError(
        error instanceof Error ? error.message : "تعذر قراءة الملف.",
      );
    } finally {
      setImporting(false);
    }
  };

  const insertImported = () => {
    if (!imported) return;
    const el = createElement(
      "table",
      {
        w: Math.min(190, 34 + imported.cols * 26),
        h: 12 + imported.rowCount * 9,
      },
      theme,
    );
    onAdd(
      {
        content: serializeTable(imported.rows),
        // Only name the layer when the file gave us one — `name: undefined`
        // would overwrite the element's default name.
        ...(imported.label ? { name: imported.label } : {}),
      },
      { cols: imported.cols, rows: imported.rowCount, ...el.style },
    );
    setImported(null);
    setImportError(null);
  };

  return (
    <div className="grid gap-3">
      <section>
        <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
          سحب لتحديد الحجم
        </h3>
        <div className="rounded-[8px] border border-line p-2 dark:border-white/10">
          <div
            className="grid gap-[3px]"
            style={{
              gridTemplateColumns: `repeat(${MAX_COLS}, minmax(0, 1fr))`,
            }}
            onMouseLeave={() => setHover(null)}
          >
            {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
              const c = (i % MAX_COLS) + 1;
              const r = Math.floor(i / MAX_COLS) + 1;
              const active = c <= grid.c && r <= grid.r;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`${r} صف × ${c} عمود`}
                  onMouseEnter={() => setHover({ c, r })}
                  onClick={() => addGrid(c, r)}
                  className={cn(
                    "h-[13px] rounded-[2px] border transition-colors",
                    active
                      ? "border-navy-2 bg-navy-2/25"
                      : "border-line bg-transparent dark:border-white/10",
                  )}
                />
              );
            })}
          </div>
          <p className="mt-2 text-center text-[11px] font-extrabold text-muted tabular-nums">
            {grid.r} صف × {grid.c} عمود
          </p>
        </div>
      </section>

      {/*
       * Manual size entry (step 11). The hover grid is fast but capped at
       * 10×12; a real data table is often taller, and an author who knows the
       * exact shape should be able to type it.
       */}
      <section>
        <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
          إدخال يدوي للأبعاد
        </h3>
        <div className="rounded-[8px] border border-line p-2 dark:border-white/10">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[68px] flex-1 text-[10px] font-bold text-muted">
              الصفوف
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMIT_ROWS}
                value={manualRows}
                onChange={(e) => setManualRows(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addManual();
                }}
                aria-label="عدد الصفوف"
                className="mt-1 h-9 w-full rounded-[8px] border border-line bg-white px-2 text-[12px] font-extrabold tabular-nums dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </label>
            <span className="pb-2 text-[12px] font-extrabold text-muted">
              ×
            </span>
            <label className="min-w-[68px] flex-1 text-[10px] font-bold text-muted">
              الأعمدة
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={LIMIT_COLS}
                value={manualCols}
                onChange={(e) => setManualCols(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addManual();
                }}
                aria-label="عدد الأعمدة"
                className="mt-1 h-9 w-full rounded-[8px] border border-line bg-white px-2 text-[12px] font-extrabold tabular-nums dark:border-white/10 dark:bg-white/5 dark:text-white"
              />
            </label>
            <button
              type="button"
              onClick={addManual}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[11px] font-extrabold text-white"
            >
              <Hash className="size-3.5" /> إنشاء جدول
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-5 text-muted tabular-nums">
            حتى {LIMIT_ROWS} صفًا × {LIMIT_COLS} عمودًا. الجدول يُدرج بعنوان صف
            أول جاهز للتسمية.
          </p>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
          قوالب جاهزة
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => addGrid(s.cols, s.rows, s.header)}
              className="rounded-[8px] border border-line px-2 py-2 text-right hover:border-navy-2 dark:border-white/10"
              title={s.hint}
            >
              <strong className="block text-[11px]">{s.label}</strong>
              <span className="text-[10px] text-muted tabular-nums">
                {s.cols}×{s.rows}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => setShowPaste((v) => !v)}
          aria-expanded={showPaste}
          className="flex w-full items-center justify-between rounded-[8px] border border-line px-2.5 py-2 text-[11px] font-extrabold dark:border-white/10"
        >
          <span className="inline-flex items-center gap-1.5">
            <ClipboardPaste className="size-3.5" /> لصق بيانات (Excel / CSV)
          </span>
          <span className="text-muted">{showPaste ? "إخفاء" : "فتح"}</span>
        </button>

        {showPaste && (
          <div className="mt-1.5 grid gap-1.5">
            <textarea
              rows={5}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={
                "الصق هنا مباشرة من Excel، أو اكتب صفوفاً:\nالاسم | المبلغ\nأحمد | 1000"
              }
              dir="rtl"
              className="w-full rounded-[8px] border border-line bg-white p-2 text-[12px] leading-6 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted tabular-nums">
                {preview
                  ? `${preview.rows} صف × ${preview.cols} عمود — ${preview.filled} خلية`
                  : "لم يتم التعرف على بيانات بعد"}
              </span>
              <button
                type="button"
                disabled={!preview}
                onClick={addFromPaste}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[11px] font-extrabold text-white disabled:opacity-40"
              >
                <Table2 className="size-3.5" /> إدراج الجدول
              </button>
            </div>
            <p className="text-[10px] leading-5 text-muted">
              يفصل المنصة بين الأعمدة تلقائياً: Tab من Excel، أو الشرطة | أو
              الفاصلة.
            </p>
          </div>
        )}
      </section>

      {/*
       * إستيراد من Excel / CSV (step 11).
       *
       * Pick a file or drop it on the box; the reader reports the shape it
       * found, and the insert button turns it into a real canvas table element
       * (rows, columns, header row and all) that stays editable afterwards.
       */}
      <section>
        <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
          إستيراد من Excel / CSV
        </h3>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "rounded-[8px] border border-dashed p-3 text-center transition-colors",
            dragOver
              ? "border-navy-2 bg-navy-2/10"
              : "border-line dark:border-white/15",
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              // Allow re-picking the same file after an error.
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-[11px] font-extrabold disabled:opacity-50 dark:border-white/10"
          >
            {importing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}
            اختيار ملف .xlsx أو .csv
          </button>
          <p className="mt-2 text-[10px] leading-5 text-muted">
            أو اسحب الملف وأفلته هنا — تُقرأ الورقة الأولى وتحوّل إلى جدول على
            اللوحة.
          </p>

          {importError && (
            <p
              role="alert"
              className="mt-2 text-[10px] font-bold text-[#b42318]"
            >
              {importError}
            </p>
          )}

          {imported && (
            <div className="mt-2 rounded-[8px] border border-line p-2 dark:border-white/10">
              <p className="text-[11px] font-extrabold tabular-nums">
                {imported.label ? `«${imported.label}» — ` : ""}
                {imported.rowCount} صف × {imported.cols} عمود
              </p>
              <p className="mt-1 truncate text-[10px] text-muted">
                {imported.rows[0]?.filter(Boolean).slice(0, 4).join(" · ") ||
                  "لا توجد عناوين في الصف الأول"}
              </p>
              <button
                type="button"
                onClick={insertImported}
                className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-navy text-[11px] font-extrabold text-white"
              >
                <Table2 className="size-3.5" /> إدراج الجدول في مساحة العمل
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Modal-style panel that wraps the table builder.
 *
 * Shared: the basics palette opens it for «جدول» (a table needs its shape
 * before it exists) and the smart library opens it for «إدراج جدول بيانات».
 */
export function TablePickerOverlay({
  theme,
  onAdd,
  onClose,
}: {
  theme: Theme;
  onAdd: (over: Partial<CanvasEl>, style?: Partial<ElStyle>) => void;
  onClose: () => void;
}) {
  return (
    <section className="rounded-[10px] border border-navy-2 bg-navy-2/5 p-3 dark:border-gold/40">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="inline-flex items-center gap-1.5 text-[12px] font-extrabold">
          <Table2 className="size-3.5" /> إنشاء جدول
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="h-7 rounded-[6px] border border-line px-2 text-[10px] font-extrabold dark:border-white/10"
        >
          إلغاء
        </button>
      </header>
      <TablePicker theme={theme} onAdd={onAdd} />
    </section>
  );
}
