import { useState } from "react";
import {
  Gauge,
  LayoutTemplate,
  Minus,
  Plus,
  SeparatorHorizontal,
  Shapes,
  Table2,
  X,
} from "lucide-react";
import {
  ICONS,
  PROGRESS_PRESETS,
  SHAPE_TOOLS,
  THEMES,
  type CanvasEl,
  type ElType,
  type ProgressPreset,
  type ThemeId,
} from "@/lib/editor/model";
import { SHAPES } from "@/lib/editor/shapes";
import { PAGE_TEMPLATES, type PageTemplateDef } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import {
  insertLibraryDrop,
  writeLibraryDrag,
  type LibraryDropItem,
  type LibraryDropPayload,
} from "@/lib/editor/library-dnd";
import { ShapePreview } from "./ShapePreview";
import { TablePickerOverlay } from "./TablePicker";
import { AccordionSection, useAccordionState } from "./ui/Accordion";

/**
 * Quick tables for the «جداول وإحصائيات» category.
 *
 * Cards are drop targets as well as buttons, so the author can either click
 * (inserts centred) or drag the shape they want straight onto the page.
 */
const TABLE_TEMPLATES = [
  {
    id: "report",
    label: "جدول تقرير",
    hint: "3 أعمدة × 4 صفوف",
    cols: 3,
    rows: 4,
  },
  {
    id: "compare",
    label: "جدول مقارنة",
    hint: "4 أعمدة × 6 صفوف",
    cols: 4,
    rows: 6,
  },
] as const;

/**
 * Chart starters, described as data instead of closures.
 *
 * `dx`/`dy` are millimetre offsets from the drop anchor, so the same definition
 * serves a click (first bar centred, siblings follow) and a drop (first bar
 * under the cursor, siblings follow) — one source of truth, identical layout.
 */
const CHART_TEMPLATES = [
  { id: "bars", label: "مخطط أعمدة", hint: "4 أعمدة مقارنة" },
  { id: "rings", label: "حلقات الإنجاز", hint: "3 حلقات دائرية" },
  { id: "steps", label: "مراحل التنفيذ", hint: "شريط مراحل" },
] as const;

type ChartTemplate = (typeof CHART_TEMPLATES)[number];

/** Build the drop payload for a chart template in the current theme. */
function chartItems(chart: ChartTemplate): LibraryDropItem[] {
  const theme = THEMES[useEditor.getState().theme];
  if (chart.id === "bars") {
    const values = [82, 64, 91, 47];
    const labels = [
      "القسم الأول",
      "القسم الثاني",
      "القسم الثالث",
      "القسم الرابع",
    ];
    return labels.map((label, i) => ({
      type: "progress",
      dx: 0,
      dy: (i - 1.5) * 18,
      over: {
        name: label,
        content: label,
        w: 92,
        h: 14,
        style: {
          fontFamily: "Tajawal",
          color: theme.ink,
          fill: theme.primary,
          variant: "bar",
          value: values[i],
          fontSize: 11,
        },
      },
    }));
  }
  if (chart.id === "rings") {
    return [86, 72, 58].map((value, i) => ({
      type: "progress",
      dx: (i - 1) * 44,
      dy: 0,
      over: {
        name: `حلقة ${value}%`,
        content: `المؤشر ${i + 1}`,
        w: 40,
        h: 46,
        style: {
          fontFamily: "Tajawal",
          color: theme.ink,
          fill: theme.primary,
          variant: "ring",
          value,
          showValue: true,
          fontSize: 11,
        },
      },
    }));
  }
  return [
    {
      type: "progress",
      dx: 0,
      dy: 0,
      over: {
        name: "مراحل التنفيذ",
        content: "مراحل التنفيذ",
        w: 150,
        h: 26,
        style: {
          fontFamily: "Tajawal",
          color: theme.ink,
          fill: theme.primary,
          variant: "steps",
          steps: 5,
          value: 60,
          fontSize: 12,
        },
      },
    },
  ];
}

/** Drop payload for a quick table card. */
function tableDrop(
  cols: number,
  rows: number,
  name: string,
): LibraryDropPayload {
  return {
    items: [
      {
        type: "table",
        over: {
          name,
          w: Math.min(170, 34 * cols + 12),
          h: 14 + rows * 9,
          style: { cols, rows, fontSize: cols >= 4 ? 10 : 11 },
        },
      },
    ],
  };
}

export function TemplatePreview({
  variant = "grid",
  large = false,
}: {
  variant?: (typeof PAGE_TEMPLATES)[number]["preview"];
  large?: boolean;
}) {
  const width = large ? "w-full" : "w-[72px]";
  const height = large ? "h-64" : "h-[64px]";
  const base =
    "relative overflow-hidden rounded-[5px] border border-line bg-white dark:border-white/10 dark:bg-white";
  const block = "absolute block";
  const green = "#0c3d2c";
  const gold = "#c6a05a";
  const ink = "#24352e";
  const muted = "#aeb8b1";
  const line = "#d8e0db";

  return (
    <span className={`${base} ${width} ${height}`} aria-hidden>
      {variant === "editorial" && (
        <>
          <span
            className={block}
            style={{
              right: "9%",
              top: "10%",
              width: "42%",
              height: "4%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              right: "9%",
              top: "22%",
              width: "62%",
              height: "17%",
              background: ink,
            }}
          />
          <span
            className={block}
            style={{
              right: "9%",
              top: "50%",
              width: "43%",
              height: "25%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "12%",
              top: "44%",
              width: "15%",
              height: "18%",
              background: green,
            }}
          />
        </>
      )}
      {variant === "grid" && (
        <>
          <span
            className={block}
            style={{ inset: "0 0 auto", height: "18%", background: green }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              top: "25%",
              width: "38%",
              height: "23%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "8%",
              top: "25%",
              width: "38%",
              height: "23%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              bottom: "12%",
              width: "38%",
              height: "22%",
              background: "#f5f8f5",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "8%",
              bottom: "12%",
              width: "38%",
              height: "22%",
              background: "#f5f8f5",
              border: `1px solid ${line}`,
            }}
          />
        </>
      )}
      {variant === "data" && (
        <>
          <span
            className={block}
            style={{
              right: "8%",
              top: "16%",
              width: "45%",
              height: "26%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              left: "8%",
              top: "15%",
              width: "25%",
              height: "22%",
              background: ink,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              bottom: "16%",
              width: "84%",
              height: "30%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "17%",
              bottom: "21%",
              width: "7%",
              height: "15%",
              background: gold,
            }}
          />
          <span
            className={block}
            style={{
              left: "29%",
              bottom: "21%",
              width: "7%",
              height: "24%",
              background: green,
            }}
          />
        </>
      )}
      {variant === "flow" && (
        <>
          <span
            className={block}
            style={{
              right: "9%",
              top: "12%",
              width: "55%",
              height: "5%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              right: "9%",
              top: "28%",
              width: "76%",
              height: "12%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "18%",
              top: "46%",
              width: "67%",
              height: "14%",
              background: "#f5f8f5",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "27%",
              top: "66%",
              width: "58%",
              height: "16%",
              border: `1px solid ${line}`,
            }}
          />
        </>
      )}
      {variant === "asymmetric" && (
        <>
          <span
            className={block}
            style={{ inset: "0 auto 0 0", width: "30%", background: green }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              top: "20%",
              width: "52%",
              height: "16%",
              background: ink,
            }}
          />
          <span
            className={block}
            style={{
              right: "12%",
              top: "47%",
              width: "27%",
              height: "18%",
              background: gold,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              bottom: "12%",
              width: "55%",
              height: "16%",
              border: `1px solid ${line}`,
            }}
          />
        </>
      )}
      {variant === "modular" && (
        <>
          <span
            className={block}
            style={{
              right: "8%",
              top: "15%",
              width: "48%",
              height: "27%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "8%",
              top: "15%",
              width: "31%",
              height: "16%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              left: "8%",
              top: "36%",
              width: "31%",
              height: "30%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              bottom: "14%",
              width: "70%",
              height: "18%",
              background: "#f5f8f5",
            }}
          />
        </>
      )}
      {variant === "executive" && (
        <>
          <span
            className={block}
            style={{
              left: "44%",
              top: "12%",
              width: "12%",
              height: "8%",
              borderRadius: "50%",
              background: gold,
            }}
          />
          <span
            className={block}
            style={{
              right: "20%",
              top: "31%",
              width: "60%",
              height: "9%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              right: "28%",
              top: "48%",
              width: "44%",
              height: "14%",
              border: `1px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "36%",
              bottom: "13%",
              width: "28%",
              height: "13%",
              background: ink,
            }}
          />
        </>
      )}
      {variant === "statistical" && (
        <>
          <span
            className={block}
            style={{
              right: "8%",
              top: "15%",
              width: "40%",
              height: "22%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              left: "8%",
              top: "16%",
              width: "23%",
              height: "15%",
              background: ink,
            }}
          />
          <span
            className={block}
            style={{
              left: "13%",
              bottom: "17%",
              width: "74%",
              height: "28%",
              borderBottom: `2px solid ${line}`,
            }}
          />
          <span
            className={block}
            style={{
              left: "20%",
              bottom: "17%",
              width: "6%",
              height: "16%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              left: "34%",
              bottom: "17%",
              width: "6%",
              height: "24%",
              background: gold,
            }}
          />
          <span
            className={block}
            style={{
              left: "48%",
              bottom: "17%",
              width: "6%",
              height: "20%",
              background: green,
            }}
          />
        </>
      )}
      {variant === "section" && (
        <>
          <span
            className={block}
            style={{
              right: "8%",
              top: "17%",
              width: "76%",
              height: "26%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              top: "56%",
              width: "48%",
              height: "8%",
              background: ink,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              top: "71%",
              width: "33%",
              height: "5%",
              background: muted,
            }}
          />
          <span
            className={block}
            style={{
              left: "10%",
              bottom: "13%",
              width: "10%",
              height: "10%",
              background: gold,
              borderRadius: "50%",
            }}
          />
        </>
      )}
      {variant === "process" && (
        <>
          <span
            className={block}
            style={{
              right: "8%",
              top: "18%",
              width: "80%",
              height: "5%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              right: "74%",
              top: "13%",
              width: "12%",
              height: "12%",
              borderRadius: "50%",
              background: green,
            }}
          />
          <span
            className={block}
            style={{
              right: "51%",
              top: "13%",
              width: "12%",
              height: "12%",
              borderRadius: "50%",
              border: `1px solid ${green}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "28%",
              top: "13%",
              width: "12%",
              height: "12%",
              borderRadius: "50%",
              border: `1px solid ${green}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              top: "13%",
              width: "12%",
              height: "12%",
              borderRadius: "50%",
              border: `1px solid ${green}`,
            }}
          />
          <span
            className={block}
            style={{
              right: "8%",
              bottom: "16%",
              width: "70%",
              height: "20%",
              border: `1px solid ${line}`,
            }}
          />
        </>
      )}
    </span>
  );
}

/** Miniature of a progress preset, drawn with the same shapes as the canvas. */
function ProgressPreview({
  preset,
  color,
}: {
  preset: ProgressPreset;
  color: string;
}) {
  const value = Math.max(0, Math.min(100, Number(preset.style.value) || 0));
  if (preset.id === "ring") {
    const size = 22;
    const thickness = 3;
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    return (
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="size-6 shrink-0"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e8ecf3"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    );
  }
  if (preset.id === "steps") {
    const total = Math.max(2, Math.min(12, Number(preset.style.steps) || 5));
    const filled = Math.round((value / 100) * total);
    return (
      <span className="flex size-6 shrink-0 items-center gap-[3px]" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className="block size-[7px] rounded-full"
            style={{
              background: i < filled ? color : "var(--color-line-2, #e8ecf3)",
            }}
          />
        ))}
      </span>
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center" aria-hidden>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-line-2 dark:bg-white/15">
        <span
          className="block h-full"
          style={{ width: `${value}%`, background: color }}
        />
      </span>
    </span>
  );
}

/**
 * المكتبة الذكية — the smart library shelf, rendered in the «المكتبة» tab.
 *
 * Six accordion categories (أشكال · رموز وأيقونات · خطوط وفواصل · مؤشرات
 * وإنجازات · جداول وإحصانات · نماذج جاهزة) over the same store actions the rest
 * of the editor uses, so every item is a real element on the page: nothing here
 * has its own model, renderer or export path.
 *
 * Cards are clickable (inserted centred on the visible page) *and* draggable
 * (inserted where they are dropped); `library-dnd.ts` owns that arithmetic, so
 * both gestures produce the same layout.
 */
export function SmartLibraryPanel({
  theme,
  onAddCustomAsset,
  onOpenShapes,
  onOpenTemplates,
  onPreviewTemplate,
}: {
  theme: ThemeId;
  /** Import an SVG as a reusable icon/divider (owned by the shell's file input). */
  onAddCustomAsset: (kind: "icon" | "divider") => void;
  onOpenShapes: () => void;
  onOpenTemplates: () => void;
  onPreviewTemplate: (template: PageTemplateDef) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const library = useAccordionState<
    "shapes" | "icons" | "dividers" | "indicators" | "tables" | "templates"
  >("library", { shapes: true, icons: true });
  const addElement = useEditor((s) => s.addElement);
  const addElementAt = useEditor((s) => s.addElementAt);
  const removeCustomIcon = useEditor((s) => s.removeCustomIcon);
  const customIcons = useEditor((s) => s.customIcons);

  /**
   * Insert a library payload.
   *
   * `at` is null for a click (the first element is centred on what the author is
   * looking at) and a page point for a drop; `insertLibraryDrop` owns the
   * anchoring arithmetic, so both gestures produce the same geometry.
   */
  const insertDrop = (
    payload: LibraryDropPayload,
    at: { x: number; y: number } | null = null,
  ) => {
    insertLibraryDrop(payload, at, (type, over, center) => {
      const el = addElementAt(
        type as ElType,
        over as Partial<CanvasEl>,
        center,
      );
      return el ? { x: el.x, y: el.y, w: el.w, h: el.h } : undefined;
    });
  };

  /** Start an HTML5 drag carrying a validated library payload. */
  const startLibraryDrag = (
    event: React.DragEvent,
    payload: LibraryDropPayload,
  ) => {
    writeLibraryDrag(event.dataTransfer, payload);
  };

  return (
    <>
      {/*
       * The table builder sits at the top of the category that needs it: a table
       * has no meaningful default shape, so the author picks rows/columns first.
       */}
      {pickerOpen && (
        <TablePickerOverlay
          theme={THEMES[theme]}
          onClose={() => setPickerOpen(false)}
          onAdd={(over, style) => {
            addElement("table", {
              ...over,
              style: { ...(over.style || {}), ...(style || {}) },
            });
            setPickerOpen(false);
          }}
        />
      )}

      {/*
       * The accordion categories. Every item inserts a REAL element on the page
       * (no parallel model, no second renderer).
       */}
      <AccordionSection
        title="أشكال"
        id="shapes"
        open={library.isOpen("shapes", true)}
        onToggle={() => library.toggle("shapes")}
        badge={
          <span className="text-[10px] font-bold text-muted">
            {SHAPES.length}
          </span>
        }
      >
        <div className="grid grid-cols-4 gap-1.5">
          {SHAPE_TOOLS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                addElement("shape", {
                  w: s.w,
                  h: s.h,
                  name: s.label,
                  style: { fill: THEMES[theme].primary, shapeId: s.shapeId },
                })
              }
              title={s.label}
              className="library-hit grid aspect-square place-items-center rounded-[8px] border border-line p-1.5 text-navy-2 transition dark:border-white/10 dark:text-gold-2"
            >
              <ShapePreview shapeId={s.shapeId} className="size-full max-h-7" />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenShapes}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
        >
          <Shapes className="size-3.5" /> كل الأشكال ({SHAPES.length})
        </button>
      </AccordionSection>

      {/*
       * Phase 7.3 — icons & symbols, including the author's own vectors.
       * Custom icons are stored as SVG markup and inserted as `svg`
       * elements, so they stay vector on canvas, in print and in export.
       */}
      <AccordionSection
        title="رموز وأيقونات"
        id="icons"
        open={library.isOpen("icons", true)}
        onToggle={() => library.toggle("icons")}
      >
        <div className="library-grid-icons">
          {Object.keys(ICONS).map((key) => (
            <button
              key={key}
              type="button"
              title={key}
              aria-label={`إضافة أيقونة ${key}`}
              onClick={() =>
                addElement("icon", {
                  icon: key,
                  name: key,
                  style: { color: THEMES[theme].accent },
                })
              }
              className="library-asset-card"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={ICONS[key]} />
              </svg>
            </button>
          ))}
          {customIcons
            .filter((item) => item.kind === "icon")
            .map((item) => (
              <div
                key={item.id}
                className="library-asset-card"
                title={item.name}
              >
                <button
                  type="button"
                  aria-label={`إضافة ${item.name}`}
                  onClick={() =>
                    addElement("svg", {
                      name: item.name,
                      content: item.svg,
                      w: 24,
                      h: 24,
                    })
                  }
                  className="grid size-full place-items-center"
                  dangerouslySetInnerHTML={{ __html: item.svg }}
                />
                <button
                  type="button"
                  className="library-asset-remove"
                  title={`حذف ${item.name}`}
                  aria-label={`حذف ${item.name}`}
                  onClick={() => void removeCustomIcon(item.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
        </div>
        <button
          type="button"
          onClick={() => onAddCustomAsset("icon")}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line text-[11px] font-extrabold dark:border-white/15"
        >
          <Plus className="size-3.5" /> إضافة رمز جديد (SVG)
        </button>
      </AccordionSection>

      {/*
       * Phase 7.4 — lines & dividers: weights, dashed variants and
       * decorative arabesque dividers, plus the author's own divider SVGs.
       */}
      <AccordionSection
        title="خطوط وفواصل"
        id="dividers"
        open={library.isOpen("dividers", false)}
        onToggle={() => library.toggle("dividers")}
      >
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() =>
              addElement("line", {
                w: 120,
                h: 1,
                style: { color: THEMES[theme].accent, stroke: 0.4 },
              })
            }
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
          >
            <Minus className="size-3.5" /> خط رقيق
          </button>
          <button
            type="button"
            onClick={() =>
              addElement("line", {
                w: 120,
                h: 1,
                style: { color: THEMES[theme].accent, stroke: 1.2 },
              })
            }
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
          >
            <Minus className="size-4" /> خط عريض
          </button>
          <button
            type="button"
            onClick={() => addElement("divider")}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
          >
            <SeparatorHorizontal className="size-3.5" /> فاصل مزخرف
          </button>
          {/* Dashed line: a vector, so the dash pattern survives print. */}
          <button
            type="button"
            onClick={() =>
              addElement("svg", {
                name: "فاصل متقطع",
                w: 120,
                h: 4,
                content:
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 4" preserveAspectRatio="none"><line x1="0" y1="2" x2="120" y2="2" stroke="currentColor" stroke-width="0.8" stroke-dasharray="3 3" /></svg>',
              })
            }
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
          >
            <Minus className="size-3.5 opacity-60" /> خط متقطع
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() =>
              addElement("svg", {
                name: "زخرفة عربية",
                w: 150,
                h: 10,
                content:
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 10" preserveAspectRatio="none"><path d="M0 5h50l5-4 5 4h40l5-4 5 4h40" fill="none" stroke="currentColor" stroke-width="0.7"/></svg>',
              })
            }
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
          >
            زخرفة عربية
          </button>
          <button
            type="button"
            onClick={() =>
              addElement("svg", {
                name: "فاصل منقّط",
                w: 150,
                h: 8,
                content:
                  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 8" preserveAspectRatio="none"><path d="M0 4h64" stroke="currentColor" stroke-width="0.6"/><circle cx="75" cy="4" r="2.4" fill="currentColor"/><path d="M86 4h64" stroke="currentColor" stroke-width="0.6"/></svg>',
              })
            }
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
          >
            فاصل منقّط
          </button>
        </div>
        {customIcons.filter((item) => item.kind === "divider").length > 0 && (
          <div className="library-grid-icons">
            {customIcons
              .filter((item) => item.kind === "divider")
              .map((item) => (
                <div
                  key={item.id}
                  className="library-asset-card col-span-2"
                  title={item.name}
                >
                  <button
                    type="button"
                    aria-label={`إضافة ${item.name}`}
                    onClick={() =>
                      addElement("svg", {
                        name: item.name,
                        content: item.svg,
                        w: 150,
                        h: 10,
                      })
                    }
                    className="grid size-full place-items-center p-1"
                    dangerouslySetInnerHTML={{ __html: item.svg }}
                  />
                  <button
                    type="button"
                    className="library-asset-remove"
                    title={`حذف ${item.name}`}
                    aria-label={`حذف ${item.name}`}
                    onClick={() => void removeCustomIcon(item.id)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onAddCustomAsset("divider")}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-line text-[11px] font-extrabold dark:border-white/15"
        >
          <Plus className="size-3.5" /> إضافة فاصل جديد (SVG)
        </button>
      </AccordionSection>

      {/* «مؤشرات وإنجازات» — statistics, progress and achievement blocks. */}
      <AccordionSection
        title="مؤشرات وإنجازات"
        id="indicators"
        open={library.isOpen("indicators", false)}
        onToggle={() => library.toggle("indicators")}
      >
        <section>
          <h3 className="mb-2 text-[11px] font-extrabold tracking-wide text-muted">
            مؤشرات الإنجاز
          </h3>
          <div className="grid gap-2">
            {PROGRESS_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  addElement("progress", {
                    content: p.sample,
                    w: p.w,
                    h: p.h,
                    name: p.label,
                    style: {
                      fontFamily: "Tajawal",
                      color: THEMES[theme].ink,
                      fill: THEMES[theme].primary,
                      ...p.style,
                      variant:
                        p.style.variant ?? (p.id === "ring" ? "ring" : "bar"),
                    },
                  } as Partial<CanvasEl>)
                }
                className="flex items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-right transition hover:bg-line-2 dark:hover:bg-white/5"
              >
                <ProgressPreview preset={p} color={THEMES[theme].primary} />
                <span className="min-w-0 flex-1">
                  <strong className="block text-[12px]">{p.label}</strong>
                  <span className="text-[10px] text-muted">
                    {Math.round(Number(p.style.value) || 0)}%
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </AccordionSection>

      {/*
       * Phase 7.6 — tables & charts. Chart starters are REAL elements
       * (progress bars / a numeric table) rather than a new element type:
       * they inherit export, print and theming for free, and the author
       * can keep editing every bar individually.
       */}
      <AccordionSection
        title="جداول وإحصائيات"
        id="tables"
        open={library.isOpen("tables", false)}
        onToggle={() => library.toggle("tables")}
      >
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] bg-navy text-[11px] font-extrabold text-white"
        >
          <Table2 className="size-3.5" /> إدراج جدول بيانات (اختيار الأعمدة
          والصفوف)
        </button>

        {/*
         * Quick tables and chart templates. Every card is both clickable
         * (inserts centred on the visible page) and DRAGGABLE (lands
         * where it is dropped), and both paths run the same definition —
         * so a chart keeps its internal layout however it is placed.
         */}
        <p className="text-[10px] font-bold text-muted">
          اسحب إلى الصفحة، أو انقر لإدراجها في المنتصف
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {TABLE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              draggable
              onDragStart={(event) =>
                startLibraryDrag(event, tableDrop(t.cols, t.rows, t.label))
              }
              onClick={() => insertDrop(tableDrop(t.cols, t.rows, t.label))}
              className="library-drag-card flex min-h-[46px] flex-col items-start justify-center gap-0.5 rounded-[8px] border border-line px-2.5 py-1.5 text-start transition hover:border-navy-2 hover:bg-navy-2/5 dark:border-white/10"
            >
              <strong className="text-[11px]">{t.label}</strong>
              <span className="text-[10px] text-muted">{t.hint}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          {CHART_TEMPLATES.map((chart) => (
            <button
              key={chart.id}
              type="button"
              draggable
              onDragStart={(event) =>
                startLibraryDrag(event, { items: chartItems(chart) })
              }
              onClick={() => insertDrop({ items: chartItems(chart) })}
              className="library-drag-card flex min-h-[44px] items-center justify-between gap-2 rounded-[8px] border border-line px-2.5 py-1.5 text-start text-[11px] font-bold transition hover:border-navy-2 hover:bg-navy-2/5 dark:border-white/10 dark:hover:border-gold/60"
            >
              <span className="min-w-0">
                <strong className="block text-[12px]">{chart.label}</strong>
                <span className="text-[10px] text-muted">{chart.hint}</span>
              </span>
              <Gauge className="size-4 shrink-0 text-navy-2 dark:text-gold-2" />
            </button>
          ))}
        </div>
      </AccordionSection>

      {/* Phase 7.7 — ready-made report page layouts. */}
      <AccordionSection
        title="نماذج جاهزة"
        id="templates"
        open={library.isOpen("templates", false)}
        onToggle={() => library.toggle("templates")}
      >
        <div className="grid gap-2">
          {PAGE_TEMPLATES.slice(0, 5).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPreviewTemplate(t)}
              className="library-hit grid min-h-[52px] grid-cols-[64px_1fr] items-center gap-2 rounded-[8px] border border-line p-2 text-right transition dark:border-white/10"
            >
              <TemplatePreview variant={t.preview} />
              <span className="min-w-0">
                <strong className="block text-[12px]">{t.title}</strong>
                <span className="block text-[10px] leading-4 text-muted">
                  {t.desc}
                </span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenTemplates}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-line text-[11px] font-extrabold dark:border-white/10"
        >
          <LayoutTemplate className="size-3.5" /> كل النماذج (
          {PAGE_TEMPLATES.length})
        </button>
      </AccordionSection>
    </>
  );
}
