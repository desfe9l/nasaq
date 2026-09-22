import { useMemo, useState } from "react";
import { ClipboardPaste, Table2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

const MAX_COLS = 10;
const MAX_ROWS = 12;

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
 * Table builder: pick a grid interactively, start from a layout preset, or paste
 * rows straight from Excel/Sheets/CSV. Pasting is the fastest path for real
 * report data, so it is offered first rather than hidden behind a textarea.
 */
export function TablePicker({ theme, onAdd }: Props) {
  const [hover, setHover] = useState<{ c: number; r: number } | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);

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
