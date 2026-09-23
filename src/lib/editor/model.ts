import type { FadeOverlay } from "./fade";
import { clamp, uid } from "../utils.ts";
import type { Numerals, TextFit } from "./arabic";

/** A4 portrait, in millimetres — the historical default and page-size fallback. */
export const A4 = { w: 210, h: 297 } as const;

export const MIN_SIZE = 4;
export const GRID = 5;
/**
 * Legacy single-project autosave slot, migrated into the library on first run.
 *
 * The keys were renamed with the NASAQ rebrand. The old names are kept as
 * `LEGACY_*` constants so `hydrate` can still pick up work saved before the
 * rename instead of starting the author from an empty library.
 */
export const STORE_KEY = "nasaq-report-project-v2";
export const LEGACY_STORE_KEY = "diwan-report-project-v2";
/** Legacy UI prefs slot (active project, dark mode, zoom). */
export const UI_KEY = "nasaq-report-ui-v2";
export const LEGACY_UI_KEY = "diwan-report-ui-v2";

export type SizeId =
  "a4-portrait" | "a4-landscape" | "slide-16-9" | "a3-portrait" | "custom";

export interface SizePreset {
  id: SizeId;
  name: string;
  desc: string;
  w: number;
  h: number;
}

/** Page presets offered in the editor. `custom` keeps whatever the user types. */
export const SIZE_PRESETS: SizePreset[] = [
  {
    id: "a4-portrait",
    name: "A4 رأسي",
    desc: "210 × 297 مم — التقارير الرسمية",
    w: 210,
    h: 297,
  },
  {
    id: "a4-landscape",
    name: "A4 أفقي",
    desc: "297 × 210 مم — الجداول العريضة",
    w: 297,
    h: 210,
  },
  {
    id: "slide-16-9",
    name: "عرض 16:9",
    desc: "338.7 × 190.5 مم — العروض التقديمية",
    w: 338.7,
    h: 190.5,
  },
  {
    id: "a3-portrait",
    name: "A3 رأسي",
    desc: "297 × 420 مم — الملصقات واللوحات",
    w: 297,
    h: 420,
  },
  {
    id: "custom",
    name: "مقاس مخصص",
    desc: "أدخل العرض والارتفاع بالمليمتر",
    w: 210,
    h: 297,
  },
];

export function sizePreset(id: SizeId | string | undefined): SizePreset {
  return SIZE_PRESETS.find((s) => s.id === id) || SIZE_PRESETS[0];
}

/** Page dimensions in mm; falls back to A4 so pre-upgrade projects keep working. */
export function pageSize(page?: { w?: number; h?: number } | null): {
  w: number;
  h: number;
} {
  const w = Number(page?.w);
  const h = Number(page?.h);
  return {
    w: w > 10 ? w : A4.w,
    h: h > 10 ? h : A4.h,
  };
}

/** Match stored dimensions back to a preset id so the UI can show the active one. */
export function sizeIdOf(page?: { w?: number; h?: number } | null): SizeId {
  const { w, h } = pageSize(page);
  const hit = SIZE_PRESETS.find(
    (s) =>
      s.id !== "custom" && Math.abs(s.w - w) < 0.5 && Math.abs(s.h - h) < 0.5,
  );
  return hit?.id || "custom";
}

export type ElType =
  | "text"
  | "box"
  | "table"
  | "shape"
  | "line"
  | "divider"
  | "image"
  | "logo"
  | "icon"
  | "stamp"
  | "qr"
  | "stat"
  | "progress"
  | "svg"
  | "group";

export type ThemeId = "official" | "eid" | "ministry" | "slate" | "sand";
export type PackId = "official" | "eid" | "briefing" | "blank" | "slides";

export interface ElStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fontStyle?: string;
  /** Underline is a text-decoration, not a font variant — hence its own flag. */
  underline?: boolean;
  color?: string;
  background?: string;
  fill?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
  textAlign?: "right" | "center" | "left" | "justify";
  lineHeight?: number;
  letterSpacing?: number;
  /** Gap between paragraphs, in mm. Blank lines in the content become this gap. */
  paragraphSpacing?: number;
  textShadow?: string;
  shadow?: string;
  objectFit?: "cover" | "contain" | "fill";
  objectX?: number;
  objectY?: number;
  stroke?: number;
  shape?: "rect" | "circle" | "rounded";
  /**
   * `svg` elements: independent fill/stroke overrides applied on top of the
   * author's markup (see svg.ts `applySvgColors`). Unset means the artwork's
   * own colors stand — overriding is opt-in per channel.
   */
  svgFill?: string;
  svgStroke?: string;
  /** `svg` elements: stroke width override in mm; unset keeps the markup's. */
  svgStrokeWidth?: number;
  /** `shape` elements: id from `shapes.ts`. Absent means a plain rectangle. */
  shapeId?: string;
  /** Preserve the element's intrinsic proportions while resizing. */
  aspectLock?: boolean;
  /**
   * Mirror the element's artwork on that axis (step 7). Purely a render/transform
   * flag: geometry, position and the layer order are untouched, so flipping is
   * lossless and reversible — flip twice and the element is byte-identical again.
   */
  flipX?: boolean;
  flipY?: boolean;
  /**
   * طبقة التلاشي — a gradient scrim painted above an image (step 8). Percentages
   * and colours only; `fade.ts` owns the rendering rules.
   */
  fade?: FadeOverlay;
  cols?: number;
  rows?: number;
  headerBg?: string;
  headerColor?: string;
  tableBg?: string;
  /** Alternating row tint; empty means flat rows. */
  stripeBg?: string;
  cellAlign?: "right" | "center" | "left";
  icon?: string;
  /** `progress` elements: filled share of the bar, 0–100. */
  value?: number;
  /** `progress` elements: show the percentage number next to the caption. */
  showValue?: boolean;
  /** `progress` elements: linear bar or radial ring. */
  variant?: "bar" | "ring" | "steps";
  /** Steps variant: number of dots/stages (2–12). */
  steps?: number;
  /** Arabic typography: numeral style for digits inside the content. */
  numerals?: Numerals;
  /** How text behaves when it exceeds its box. */
  textFit?: TextFit;
  /**
   * Let text paint past the element box instead of clipping.
   *
   * Default is clipping, which is right for a fixed frame, but a paragraph the
   * author is still writing (or one set to `textFit: clip` on purpose) is more
   * useful spilling visibly than silently truncated.
   */
  overflowVisible?: boolean;
  /**
   * حتى نهاية السطر: justify every line but the last.
   *
   * CSS `text-align: justify` stretches the final short line of a paragraph,
   * which looks wrong in Arabic reports. This switches the element to the
   * `.justified-rtl` rule, which pins the last line back to the right edge.
   */
  justifyLastLine?: "start" | "stretch";
  /**
   * تطويل تلقائي (Auto-Kashida).
   *
   * Justify with Arabic elongation instead of word gaps: `kashida.ts` inserts
   * tatweel strokes only between dual-joining letters, evenly across the line,
   * and never on a paragraph's last line. This is the correct way to justify
   * formal Arabic prose — `text-align: justify` spreads the SPACES, which reads
   * as broken typesetting in Arabic because the whitespace is meant to stay
   * constant. Opt-in per element: setting it is an authorial choice, and the
   * rendered string (with its tatweel characters) is what every export writes,
   * so a document never changes appearance depending on the reader's engine.
   */
  kashida?: boolean;
  /** Draw the text vertically, top-to-bottom (titles on covers). */
  writingMode?: "horizontal" | "vertical";
  /** Apply the author's line breaks only; collapse soft wraps. */
  preserveBreaks?: boolean;
  /** Drop tashkeel and tatweel on render/export. */
  stripTashkeel?: boolean;
  /** Use a non-breaking space inside number+unit pairs (٪، م، ريال). */
  bindUnits?: boolean;
  /** Convert ASCII punctuation to its Arabic counterpart. */
  arabicPunctuation?: boolean;
  /**
   * How the text box reacts when its content outgrows it.
   *
   * `autoHeight` is the default for prose: the box grows downwards and the text
   * is never cut. `fixed` honours the author's box exactly and reports the
   * overflow instead of hiding it. `autoWidth` expands sideways, and `fit`
   * shrinks the font — the last resort, because a shrinking font is more
   * noticeable than a growing box.
   */
  textBoxMode?: TextBoxMode;
  /** Inner padding for text-ish elements, in mm. */
  padding?: number;
  /** Manual extra height added on top of measured text (mm, autoHeight only). */
  slackMm?: number;
}

export type TextBoxMode = "autoHeight" | "fixed" | "autoWidth" | "fit";

/** Types whose box can auto-size to their text. */
export const AUTO_TEXT_TYPES: ElType[] = ["text", "box", "stat", "stamp"];

export interface CanvasEl {
  id: string;
  type: ElType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  z: number;
  locked?: boolean;
  hidden?: boolean;
  /** Shared movement relationship; unlike a group, linked elements remain independent. */
  linkId?: string;
  content?: string;
  src?: string;
  icon?: string;
  style: ElStyle;
  /**
   * `group` members, positioned relative to the group.
   *
   * Relative coordinates are what make a group behave as one element: moving or
   * resizing the group is a single change to the parent box, and its children
   * follow without needing per-child rewrites. The editor bakes the members'
   * page coordinates into group-relative ones on grouping and the reverse on
   * ungrouping.
   */
  children?: CanvasEl[];
  /**
   * قناع القص (Clipping Mask): the id of the shape element on the same page
   * whose geometry clips this element's paint. One shape may clip several
   * elements; removing the mask clears the ids that point at it.
   */
  clippedBy?: string;
  /**
   * Page furniture (letterhead / footer strip) that «تثبيت الترويسة والتذييل»
   * has applied to this element.
   *
   * A pure marker: it records that the element belongs to the document's shared
   * header or footer, which is what makes re-applying idempotent and removing
   * the furniture exact. Geometry, styling and behaviour are untouched, and an
   * element without the marker is an ordinary element.
   */
  hfRole?: "header" | "footer";
}

export interface Page {
  id: string;
  name: string;
  bg?: string;
  /** Page width in mm; omitted means A4 portrait width. */
  w?: number;
  h?: number;
  elements: CanvasEl[];
}

export interface Project {
  version: number;
  name: string;
  theme: ThemeId;
  orgName: string;
  /**
   * Official transaction / outgoing number printed by the {رقم_المعاملة} macro.
   *
   * Optional: documents written before macros existed simply resolve the macro
   * to a fill-in placeholder, so no migration is needed.
   */
  transactionNo?: string;
  pages: Page[];
  /** Library metadata — absent on files exported before the upgrade. */
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  defaultSize?: SizeId;
  /** Which pack this document was created from (category filters on /projects). */
  pack?: PackId;
  /** Starred by the owner. Persisted with the row, never part of undo history. */
  favorite?: boolean;
  /**
   * Page-1 JPEG capture for the projects grid. Written on auto-save only —
   * deliberately excluded from undo history (`projectSlice`) so snapshots
   * never carry multi-KB data URLs.
   */
  thumbnail?: string;
}

/**
 * A Project snapshot that also remembers which page was active. Only
 * meaningful for in-memory history entries (undo/redo) — persisted project
 * files don't carry this, since loading always starts on the first page.
 * Carrying it through history means Undo restores the page the user was
 * actually on instead of silently jumping back to page 1. Kept out of the
 * base `Project` type so it doesn't collide with the editor store's own
 * (always-defined) `activePageId`.
 */
export type ProjectSnapshot = Project & { activePageId?: string };

export interface ProjectMeta {
  id: string;
  name: string;
  orgName: string;
  theme: ThemeId;
  pages: number;
  createdAt: number;
  updatedAt: number;
  pack?: PackId;
  favorite?: boolean;
  thumbnail?: string;
}

export function projectMeta(p: Project): ProjectMeta {
  return {
    id: p.id || uid("proj"),
    name: p.name || "مشروع بلا اسم",
    orgName: p.orgName || "",
    theme: p.theme || "official",
    pages: p.pages?.length || 0,
    createdAt: p.createdAt || Date.now(),
    updatedAt: p.updatedAt || Date.now(),
    pack: p.pack,
    favorite: p.favorite,
    thumbnail: p.thumbnail,
  };
}

export interface Theme {
  id: ThemeId;
  name: string;
  desc: string;
  primary: string;
  primarySoft: string;
  accent: string;
  paper: string;
  ink: string;
  muted: string;
  line: string;
  surface: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  official: {
    id: "official",
    name: "رسمي نَسَق",
    desc: "وثائق حكومية وتقارير أداء",
    primary: "#006c35",
    primarySoft: "#00874a",
    accent: "#c9a86a",
    paper: "#ffffff",
    ink: "#172033",
    muted: "#697184",
    line: "#d9dee8",
    surface: "#f7f8fb",
  },
  eid: {
    id: "eid",
    name: "عيد أخضر",
    desc: "فعاليات ومناسبات رسمية",
    primary: "#0c3d2c",
    primarySoft: "#145c42",
    accent: "#d4af37",
    paper: "#ffffff",
    ink: "#1a2e24",
    muted: "#5d7268",
    line: "#d7e3dc",
    surface: "#f3f7f4",
  },
  ministry: {
    id: "ministry",
    name: "وزاري",
    desc: "تقارير وزارية هادئة",
    primary: "#12344d",
    primarySoft: "#1b4b6b",
    accent: "#b08a4f",
    paper: "#ffffff",
    ink: "#1c2730",
    muted: "#667887",
    line: "#d5dde4",
    surface: "#f5f7f9",
  },
  slate: {
    id: "slate",
    name: "رمادي حديث",
    desc: "عرض تنفيذي معاصر",
    primary: "#1f2937",
    primarySoft: "#334155",
    accent: "#3b82c4",
    paper: "#ffffff",
    ink: "#111827",
    muted: "#64748b",
    line: "#e2e8f0",
    surface: "#f8fafc",
  },
  sand: {
    id: "sand",
    name: "رملي دافئ",
    desc: "تقارير ثقافية وإعلامية",
    primary: "#3f2e1f",
    primarySoft: "#5c4330",
    accent: "#c4a574",
    paper: "#fffdf8",
    ink: "#2a2118",
    muted: "#7a6a58",
    line: "#e6dccb",
    surface: "#faf6ee",
  },
};

/**
 * Arabic-first font stack. Every family here ships a real Arabic cut through the
 * Google Fonts link in `__root.tsx`; none is a Latin-only fallback.
 */
export const FONTS = [
  "Tajawal",
  "Cairo",
  "IBM Plex Sans Arabic",
  "Noto Sans Arabic",
  "Noto Naskh Arabic",
  "Noto Kufi Arabic",
  "Amiri",
  "Reem Kufi",
];

export const ICONS: Record<string, string> = {
  star: "M12 3 14.8 9l6.2.7-4.6 4.2 1.2 6.1L12 16.8 6.4 20l1.2-6.1L3 9.7 9.2 9 12 3Z",
  check: "M5 13.2 9.2 17.5 19 7",
  shield: "M12 3 5 6v6c0 4.2 2.8 7.8 7 9 4.2-1.2 7-4.8 7-9V6l-7-3Z",
  award: "M8 11a4 4 0 1 0 8 0 4 4 0 0 0-8 0M9.2 14.2 8 21l4-2 4 2-1.2-6.8",
  building: "M5 21V5h14v16M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 21v-4h6v4",
  chart: "M4 19h16M7 16v-5M12 16V8M17 16v-8",
  flag: "M5 21V4h10l-1.5 4L15 12H5",
  users:
    "M16 19v-1.4A3.6 3.6 0 0 0 12.4 14H7.6A3.6 3.6 0 0 0 4 17.6V19M14.5 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 19v-1.2A3.2 3.2 0 0 0 17.4 14.8M19 8.2a2.4 2.4 0 0 1 0 4.4",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01",
  leaf: "M5 19c8-1 13-8 14-16-8 1-14 7-14 16ZM5 19c3-4 8-7 14-8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2",
  doc: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
};

export const TYPE_NAME: Record<ElType, string> = {
  text: "نص",
  box: "مربع محتوى",
  table: "جدول",
  shape: "شكل",
  line: "خط زخرفي",
  divider: "فاصل",
  image: "صورة",
  logo: "شعار",
  icon: "أيقونة",
  stamp: "ختم",
  qr: "رمز QR",
  stat: "مؤشر",
  progress: "شريط تقدم",
  svg: "رسم SVG",
  group: "مجموعة",
};

/** Named text roles so a report author picks intent, not point sizes. */
export interface TextPreset {
  id: string;
  label: string;
  sample: string;
  style: Partial<ElStyle>;
  w: number;
  h: number;
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: "title",
    label: "عنوان رئيسي",
    sample: "عنوان التقرير",
    w: 150,
    h: 18,
    style: { fontSize: 26, fontWeight: 800, lineHeight: 1.25 },
  },
  {
    id: "subtitle",
    label: "عنوان فرعي",
    sample: "عنوان فرعي للقسم",
    w: 140,
    h: 14,
    style: { fontSize: 17, fontWeight: 700, lineHeight: 1.35 },
  },
  {
    id: "body",
    label: "نص أساسي",
    sample: "نص التقرير الأساسي. انقر نقراً مزدوجاً للتعديل المباشر.",
    w: 154,
    h: 24,
    style: { fontSize: 12.5, fontWeight: 500, lineHeight: 1.7 },
  },
  {
    id: "caption",
    label: "نص صغير",
    sample: "ملاحظة أو مصدر البيانات",
    w: 120,
    h: 8,
    style: { fontSize: 9, fontWeight: 500, lineHeight: 1.5 },
  },
  {
    id: "number",
    label: "رقم كبير",
    sample: "904",
    w: 60,
    h: 24,
    style: { fontSize: 34, fontWeight: 800, lineHeight: 1.1 },
  },
  {
    id: "label",
    label: "تسمية",
    sample: "إجمالي الحالات",
    w: 60,
    h: 8,
    style: { fontSize: 10, fontWeight: 600, lineHeight: 1.4 },
  },
];

export function textPreset(id: string): TextPreset {
  return TEXT_PRESETS.find((p) => p.id === id) || TEXT_PRESETS[2];
}

/**
 * One-click shapes for the element palette. Each entry defers to a definition in
 * `shapes.ts`, so the palette and the shape picker never drift apart.
 */
export interface ShapeTool {
  id: string;
  label: string;
  shapeId: string;
  w: number;
  h: number;
}

export const SHAPE_TOOLS: ShapeTool[] = [
  { id: "t-rect", label: "مستطيل", shapeId: "rect", w: 48, h: 28 },
  { id: "t-rounded", label: "مستطيل مستدير", shapeId: "rounded", w: 48, h: 28 },
  { id: "t-circle", label: "دائرة", shapeId: "circle", w: 32, h: 32 },
  { id: "t-ellipse", label: "بيضاوي", shapeId: "ellipse", w: 44, h: 28 },
  { id: "t-triangle", label: "مثلث", shapeId: "triangle", w: 34, h: 30 },
  { id: "t-diamond", label: "معيّن", shapeId: "diamond", w: 32, h: 32 },
  { id: "t-hexagon", label: "سداسي", shapeId: "hexagon", w: 34, h: 30 },
  { id: "t-star5", label: "نجمة", shapeId: "star5", w: 32, h: 32 },
  { id: "t-seal", label: "ختم مسنّن", shapeId: "seal", w: 36, h: 36 },
  { id: "t-ribbon", label: "شريط", shapeId: "ribbon", w: 52, h: 20 },
  { id: "t-banner", label: "لافتة", shapeId: "banner", w: 46, h: 26 },
  { id: "t-callout", label: "فقاعة حديث", shapeId: "callout", w: 54, h: 30 },
  { id: "t-shield", label: "درع", shapeId: "shield", w: 34, h: 38 },
  { id: "t-arrow", label: "سهم", shapeId: "arrow-right", w: 46, h: 22 },
  { id: "t-frame", label: "إطار", shapeId: "frame-rounded", w: 60, h: 40 },
  { id: "t-arch", label: "قوس محراب", shapeId: "arch", w: 40, h: 48 },
];

/** Ready-made completion indicators (نسبة الإنجاز) with sensible box sizes. */
export interface ProgressPreset {
  id: string;
  label: string;
  sample: string;
  w: number;
  h: number;
  style: Partial<ElStyle>;
}

export const PROGRESS_PRESETS: ProgressPreset[] = [
  {
    id: "bar",
    label: "شريط إنجاز",
    sample: "نسبة الإنجاز",
    w: 120,
    h: 16,
    style: { value: 70, showValue: true },
  },
  {
    id: "bar-thin",
    label: "شريط رفيع",
    sample: "التقدم",
    w: 120,
    h: 10,
    style: { value: 45, showValue: true, fontSize: 9 },
  },
  {
    id: "bar-thick",
    label: "شريط عريض",
    sample: "المؤشر العام",
    w: 130,
    h: 24,
    style: { value: 82, showValue: true, fontSize: 12, radius: 6 },
  },
  {
    id: "ring",
    label: "دائرة كنسبة",
    sample: "الإنجاز",
    w: 44,
    h: 44,
    style: { value: 68, showValue: true, fontSize: 11 },
  },
  {
    id: "steps",
    label: "نقاط مراحل",
    sample: "مراحل المشروع",
    w: 120,
    h: 18,
    style: {
      value: 60,
      showValue: true,
      fontSize: 10,
      variant: "steps",
      steps: 5,
    },
  },
];

/** Multi-step progress sets, for a page of indicators filled at once. */
export const PROGRESS_LEVELS = [10, 25, 50, 65, 75, 90, 100];

export function placeholderImage(kind: "logo" | "image") {
  const title = kind === "logo" ? "LOGO" : "IMAGE";
  const bg = kind === "logo" ? "#ffffff" : "#f4f6fa";
  const stroke = kind === "logo" ? "#c9a86a" : "#d9dee8";
  const text = kind === "logo" ? "#006c35" : "#697184";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520"><rect width="800" height="520" fill="${bg}"/><rect x="30" y="30" width="740" height="460" rx="26" fill="none" stroke="${stroke}" stroke-width="10"/><path d="M180 350 310 220l92 105 72-70 146 155H160Z" fill="${stroke}" opacity=".45"/><circle cx="275" cy="162" r="42" fill="${stroke}" opacity=".55"/><text x="400" y="450" text-anchor="middle" font-family="Arial" font-size="54" font-weight="700" fill="${text}">${title}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function defaultTable(cols: number, rows: number) {
  const data: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(r === 0 ? `عنوان ${c + 1}` : `قيمة ${r}×${c + 1}`);
    }
    data.push(row);
  }
  return JSON.stringify(data);
}

export function parseTable(
  content: string | undefined,
  cols = 3,
  rows = 4,
): string[][] {
  try {
    const parsed = JSON.parse(content || "[]");
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((row: unknown) =>
        Array.isArray(row) ? row.map((c) => String(c ?? "")) : [String(row)],
      );
    }
  } catch {
    /* fall through to a generated table */
  }
  return JSON.parse(defaultTable(cols, rows)) as string[][];
}

export function createElement(
  type: ElType,
  over: Partial<CanvasEl> = {},
  theme?: Theme,
): CanvasEl {
  const t = theme || THEMES.official;
  const defaults: Record<ElType, Partial<CanvasEl>> = {
    text: {
      w: 90,
      h: 18,
      content: "نص جديد",
      style: {
        fontFamily: "Tajawal",
        fontSize: 16,
        color: t.ink,
        fontWeight: 600,
        textAlign: "right",
        lineHeight: 1.45,
      },
    },
    box: {
      w: 92,
      h: 36,
      content:
        "محتوى المربع — يمكن تعديل النص والمحاذاة والخلفية من لوحة الخصائص.",
      style: {
        fontFamily: "Cairo",
        fontSize: 12,
        color: t.ink,
        fill: t.surface,
        borderColor: t.line,
        borderWidth: 0.35,
        radius: 4,
        fontWeight: 500,
        textAlign: "right",
        lineHeight: 1.7,
        padding: 4,
      },
    },
    table: {
      w: 154,
      h: 52,
      style: {
        cols: 3,
        rows: 4,
        fontSize: 11,
        fontFamily: "Cairo",
        headerBg: t.primary,
        headerColor: "#ffffff",
        tableBg: "#ffffff",
        borderColor: t.line,
        borderWidth: 0.3,
        cellAlign: "right",
        color: t.ink,
      },
    },
    shape: {
      w: 48,
      h: 28,
      style: {
        fill: t.primary,
        borderColor: t.primary,
        borderWidth: 0,
        radius: 0,
        shape: "rect",
        shapeId: "rect",
      },
    },
    line: {
      w: 120,
      h: 4,
      style: { color: t.accent, stroke: 0.8 },
    },
    divider: {
      w: 140,
      h: 8,
      style: { color: t.accent, stroke: 0.6 },
    },
    image: {
      w: 72,
      h: 48,
      src: placeholderImage("image"),
      style: { objectFit: "cover", radius: 2 },
    },
    logo: {
      w: 28,
      h: 28,
      src: placeholderImage("logo"),
      style: { objectFit: "contain" },
    },
    icon: {
      w: 16,
      h: 16,
      icon: "star",
      style: { color: t.accent, stroke: 1.8 },
    },
    stamp: {
      w: 40,
      h: 40,
      content: "معتمد",
      style: {
        color: t.accent,
        borderColor: t.accent,
        fontFamily: "Amiri",
        fontSize: 13,
        fontWeight: 700,
        textAlign: "center",
      },
    },
    qr: {
      w: 28,
      h: 28,
      content: "https://",
      style: { fill: "#ffffff", color: t.primary },
    },
    svg: {
      w: 60,
      h: 60,
      // A tiny sample glyph (stroke-only rounded square + diagonal) so the
      // element is never empty; the author pastes their own markup in the
      // properties panel. Content is sanitised before it ever renders —
      // see sanitizeSvgContent in svg.ts.
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2"/><path d="M7 14l3-3 3 3 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      style: { color: t.primary, overflowVisible: true },
    },
    stat: {
      w: 72,
      h: 36,
      content: "92%\nنسبة الإنجاز",
      style: {
        fontFamily: "Tajawal",
        fontSize: 22,
        color: t.primary,
        fill: "#ffffff",
        borderColor: t.accent,
        borderWidth: 0.45,
        radius: 4,
        fontWeight: 800,
        textAlign: "center",
        lineHeight: 1.3,
        numerals: "western",
        textFit: "shrink",
      },
    },
    progress: {
      w: 120,
      h: 16,
      content: "نسبة الإنجاز",
      style: {
        fontFamily: "Cairo",
        fontSize: 10,
        fontWeight: 700,
        color: t.ink,
        fill: t.primary,
        background: "#e8ecf3",
        radius: 3,
        value: 70,
        textAlign: "right",
        showValue: true,
      },
    },
    group: {
      w: 60,
      h: 40,
      children: [],
      style: {},
    },
  };

  const d = defaults[type] || {};
  const el: CanvasEl = {
    id: uid("el"),
    type,
    name: over.name || TYPE_NAME[type],
    x: 28,
    y: 40,
    w: d.w || 40,
    h: d.h || 20,
    rotation: 0,
    opacity: 1,
    z: 1,
    style: {},
    ...d,
    ...over,
  };
  el.style = { ...(d.style || {}), ...(over.style || {}) };
  if (type === "table" && !el.content)
    el.content = defaultTable(el.style.cols || 3, el.style.rows || 4);
  return el;
}

/**
 * Sanitises an element's geometry — NOT a page-bounds clamp.
 *
 * Editing is free: an element may sit fully inside the page, straddle its
 * edge, or move entirely outside it (see WORKSPACE_MARGIN in CanvasStage).
 * Only export clips content to the page rectangle. This function's only job
 * is to guard against corrupt/non-finite values (a bad paste, an old file,
 * a manual edit) — it must never pull a legitimately off-page element back
 * onto the page, or every drag/reload would silently undo itself.
 *
 * `size` (the page size) is still used to size the sanity ceiling: large
 * enough that any real design fits, small enough that garbage data can't
 * blow up layout/export math. ±1e4mm matches the bound export.ts already
 * applies per-field when serialising, so the two stay consistent.
 */
export function constrainElement(
  el: CanvasEl,
  size: { w: number; h: number } = A4,
) {
  const maxDim = Math.max(size.w, size.h, A4.w, A4.h) * 10;
  el.w = clamp(Number(el.w) || MIN_SIZE, MIN_SIZE, maxDim);
  el.h = clamp(Number(el.h) || MIN_SIZE, MIN_SIZE, maxDim);
  el.x = clamp(Number.isFinite(Number(el.x)) ? Number(el.x) : 0, -1e4, 1e4);
  el.y = clamp(Number.isFinite(Number(el.y)) ? Number(el.y) : 0, -1e4, 1e4);
  el.opacity = clamp(
    Number.isFinite(Number(el.opacity)) ? Number(el.opacity) : 1,
    0,
    1,
  );
  el.rotation = Number(el.rotation) || 0;
}

export function normalizeZ(page: Page) {
  page.elements
    .sort((a, b) => (a.z || 0) - (b.z || 0))
    .forEach((el, i) => {
      el.z = i + 1;
    });
}

export function nextZ(page: Page) {
  return Math.max(0, ...page.elements.map((e) => e.z || 0)) + 1;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Axis-aligned bounds of a set of boxes, or null when the set is empty. */
export function boundsOf(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Bounds of elements' own boxes (page coordinates, no group resolution). */
export function elementsBounds(els: CanvasEl[]): Box | null {
  return boundsOf(els);
}

/**
 * Flatten an element list to include group members.
 *
 * Used by anything that treats the page as a flat set of painted boxes — the
 * marquee, snapping and the exporters — while the editor itself keeps groups
 * whole.
 */
export function flattenElements(els: CanvasEl[]): CanvasEl[] {
  const out: CanvasEl[] = [];
  const walk = (list: CanvasEl[]) => {
    for (const el of list) {
      out.push(el);
      if (el.children?.length) walk(el.children);
    }
  };
  walk(els);
  return out;
}

/** Deepest element list that contains `id`, plus the element itself. */
export function findElement(
  els: CanvasEl[],
  id: string,
): { el: CanvasEl; list: CanvasEl[]; index: number } | null {
  const index = els.findIndex((e) => e.id === id);
  if (index >= 0) return { el: els[index], list: els, index };
  for (const el of els) {
    if (el.children?.length) {
      const hit = findElement(el.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Page-space position of an element nested in groups.
 *
 * Group children store group-relative coordinates, so reaching a nested element
 * means adding every ancestor's origin on the way down.
 */
export function absolutePosition(
  els: CanvasEl[],
  id: string,
  ox = 0,
  oy = 0,
): { x: number; y: number } | null {
  for (const el of els) {
    const x = ox + el.x;
    const y = oy + el.y;
    if (el.id === id) return { x, y };
    if (el.children?.length) {
      const hit = absolutePosition(el.children, id, x, y);
      if (hit) return hit;
    }
  }
  return null;
}

/** Scale group children so they stay proportional when the group box changes. */
export function scaleChildren(group: CanvasEl, prevW: number, prevH: number) {
  if (!group.children?.length) return;
  const sx = prevW > 0 ? group.w / prevW : 1;
  const sy = prevH > 0 ? group.h / prevH : 1;
  for (const child of group.children) {
    child.x *= sx;
    child.y *= sy;
    child.w *= sx;
    child.h *= sy;
    // Grandchildren are relative to this child, so they scale but do not move.
    if (child.children?.length) scaleChildren(child, prevW / sx, prevH / sy);
  }
}

/**
 * Wrap elements into a single group, converting their page coordinates into
 * group-relative ones.
 */
export function createGroupFrom(
  els: CanvasEl[],
  name?: string,
): CanvasEl | null {
  const box = elementsBounds(els);
  if (!box || els.length < 2) return null;
  const children = els.map((el) => ({
    ...clone(el),
    x: el.x - box.x,
    y: el.y - box.y,
  }));
  return {
    id: uid("grp"),
    type: "group",
    name: name || `مجموعة (${els.length})`,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    opacity: 1,
    z: Math.max(...els.map((e) => e.z || 1)),
    children,
    style: {},
  };
}

/** Flatten a group back to page coordinates, so members rejoin the page list. */
export function explodeGroup(group: CanvasEl): CanvasEl[] {
  return (group.children || []).map((child) => ({
    ...clone(child),
    x: group.x + child.x,
    y: group.y + child.y,
    z: (child.z || 1) + (group.z || 1),
  }));
}

export type AlignEdge =
  "left" | "right" | "center" | "top" | "middle" | "bottom";

/**
 * New positions that align elements to a shared edge.
 *
 * `frame` is what the elements align *against*: their own combined bounding box
 * by default, or the page when the author picks that. Returning plain positions
 * rather than mutating keeps this pure and testable, and lets the caller decide
 * whether it is one history entry or many.
 */
export function alignPositions(
  els: CanvasEl[],
  edge: AlignEdge,
  frame: Box,
): { id: string; x: number; y: number }[] {
  return els.map((el) => {
    let { x, y } = el;
    switch (edge) {
      case "left":
        x = frame.x;
        break;
      case "right":
        x = frame.x + frame.w - el.w;
        break;
      case "center":
        x = frame.x + (frame.w - el.w) / 2;
        break;
      case "top":
        y = frame.y;
        break;
      case "bottom":
        y = frame.y + frame.h - el.h;
        break;
      case "middle":
        y = frame.y + (frame.h - el.h) / 2;
        break;
    }
    return { id: el.id, x, y };
  });
}

/**
 * Alignment moves for a selection, resolved in absolute page space.
 *
 * Group members store group-relative coordinates, so each pick is lifted into
 * page space, aligned against `frame` (the page or the selection bounds), and
 * mapped back into the space it actually lives in. Doing the math in mixed
 * coordinate spaces would fling a group member to the page corner while the
 * frame said otherwise. With one id this aligns that single element against
 * the frame — the artboard when the frame is the page box.
 */
export function alignmentMoves(
  pageEls: CanvasEl[],
  ids: string[],
  edge: AlignEdge,
  frame: Box,
): { id: string; x: number; y: number }[] {
  const picked = ids.flatMap((id) => {
    const found = findElement(pageEls, id)?.el;
    if (!found) return [];
    const abs = absolutePosition(pageEls, id);
    return [
      {
        el: found,
        dx: abs ? abs.x - found.x : 0,
        dy: abs ? abs.y - found.y : 0,
      },
    ];
  });
  const absPicked = picked.map((p) => ({
    ...p.el,
    x: p.el.x + p.dx,
    y: p.el.y + p.dy,
  }));
  return alignPositions(absPicked, edge, frame).map((m, i) => ({
    id: m.id,
    x: m.x - picked[i].dx,
    y: m.y - picked[i].dy,
  }));
}

/**
 * Even gaps between elements on one axis ("distribute spacing").
 *
 * The outermost two elements stay put and the rest are spread so the *gaps*
 * between neighbours are equal. Distributing the centres instead would look
 * wrong the moment elements differ in size, which is the normal case for a row
 * of stat cards next to a paragraph.
 */
export function distributePositions(
  els: CanvasEl[],
  axis: "h" | "v",
): { id: string; x: number; y: number }[] | null {
  if (els.length < 3) return null;
  const sizeOf = (el: CanvasEl) => (axis === "h" ? el.w : el.h);
  const posOf = (el: CanvasEl) => (axis === "h" ? el.x : el.y);
  const sorted = [...els].sort((a, b) => posOf(a) - posOf(b));

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = posOf(last) + sizeOf(last) - posOf(first);
  const totalSize = sorted.reduce((sum, el) => sum + sizeOf(el), 0);
  const gap = (span - totalSize) / (sorted.length - 1);

  const out: { id: string; x: number; y: number }[] = [];
  let cursor = posOf(first);
  for (const el of sorted) {
    out.push(
      axis === "h"
        ? { id: el.id, x: cursor, y: el.y }
        : { id: el.id, x: el.x, y: cursor },
    );
    cursor += sizeOf(el) + gap;
  }
  return out;
}

/** Bounding box of elements in page space, resolving group nesting. */
export function absoluteBounds(pageEls: CanvasEl[], ids: string[]): Box | null {
  const boxes: Box[] = [];
  for (const id of ids) {
    const found = findElement(pageEls, id);
    if (!found) continue;
    const abs = absolutePosition(pageEls, id);
    if (!abs) continue;
    boxes.push({ x: abs.x, y: abs.y, w: found.el.w, h: found.el.h });
  }
  return boundsOf(boxes);
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function cssFont(font?: string) {
  return `"${String(font || "Tajawal").replace(/"/g, "")}", "Cairo", sans-serif`;
}

/** Shared box-shadow vocabulary for elements and panels. */
export const SHADOWS: { id: string; label: string; value: string }[] = [
  { id: "none", label: "بدون ظل", value: "" },
  { id: "soft", label: "خفيف", value: "0 1mm 3mm rgba(15,23,42,.10)" },
  { id: "medium", label: "متوسط", value: "0 2mm 5mm rgba(15,23,42,.16)" },
  { id: "strong", label: "قوي", value: "0 3mm 8mm rgba(15,23,42,.24)" },
];

// ── Viewer geometry: millimetres ⇄ screen pixels ───────────────────────────

/** Millimetres per CSS pixel at 100% zoom (1px = 25.4/96 mm). */
export const MM_PER_PX = 25.4 / 96;

/**
 * Convert a screen-space length to document millimetres at a given zoom.
 *
 * All thresholds the editor feels (snap stickiness, auto-pan margins, cursor
 * hit radii) are specified in *screen* pixels — what the user actually sees —
 * then converted here so the math stays in document space at every zoom.
 */
export function pxToMm(px: number, zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (px * MM_PER_PX) / z;
}

/**
 * Convert a document-space length to screen pixels at a given zoom.
 * Inverse of `pxToMm` — used to keep on-screen chrome a constant size.
 */
export function mmToPx(mm: number, zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return (mm * z) / MM_PER_PX;
}

// ── Element defaults: one source for palette inserts and drawn elements ────

/**
 * Default geometry and style for a new element of `type`.
 *
 * Palette inserts, text drawn on the canvas and pasted fallbacks all start
 * from this single source, so an element behaves the same however it was
 * created. Values are document millimetres (and pt for fonts) exactly as the
 * properties panel expects them.
 */
export function createElementDefaults(
  type: ElType,
): Partial<CanvasEl> & { style: Partial<ElStyle> } {
  const base: Partial<CanvasEl> & { style: Partial<ElStyle> } = {
    style: {
      fontFamily: "Tajawal",
      fontSize: 14,
      color: "#172033",
      textAlign: "right",
    },
  };
  switch (type) {
    case "text":
      /*
       * New text is borderless and fill-free: only the glyphs carry colour
       * (#0F172A). An empty background/fill and a zero border keep the frame
       * transparent so the selection box is the only chrome ever drawn.
       */
      return {
        ...base,
        w: 80,
        h: 14,
        style: {
          ...base.style,
          color: "#0F172A",
          background: "",
          fill: "",
          borderWidth: 0,
          stroke: 0,
        },
      };
    case "box":
      return {
        ...base,
        w: 60,
        h: 30,
        style: { ...base.style, fill: "#f7f8fb", radius: 4 },
      };
    case "stat":
      return {
        ...base,
        w: 55,
        h: 32,
        style: { ...base.style, fill: "#f2f7f3", radius: 6 },
      };
    case "shape":
      return {
        ...base,
        w: 40,
        h: 40,
        style: { ...base.style, fill: "#006c35" },
      };
    case "line":
      return {
        ...base,
        w: 60,
        h: 4,
        style: { ...base.style, color: "#c9a86a", stroke: 0.8 },
      };
    case "divider":
      return {
        ...base,
        w: 80,
        h: 6,
        style: { ...base.style, color: "#c9a86a", stroke: 0.5 },
      };
    case "table":
      return {
        ...base,
        w: 150,
        h: 60,
        style: { ...base.style, cols: 3, rows: 4 },
      };
    case "image":
      return {
        ...base,
        w: 60,
        h: 45,
        style: { ...base.style, objectFit: "cover" },
      };
    case "logo":
      return {
        ...base,
        w: 24,
        h: 24,
        style: { ...base.style, objectFit: "contain" },
      };
    case "qr":
      return { ...base, w: 26, h: 26 };
    case "icon":
      return {
        ...base,
        w: 10,
        h: 10,
        style: { ...base.style, color: "#c9a86a" },
      };
    case "progress":
      return {
        ...base,
        w: 70,
        h: 16,
        style: { ...base.style, fill: "#006c35", value: 70 },
      };
    case "stamp":
      return {
        ...base,
        w: 34,
        h: 34,
        style: { ...base.style, color: "#c9a86a" },
      };
    default:
      return { ...base, w: 40, h: 30 };
  }
}

/**
 * Top-left position that centres a `w × h` element inside the visible area of
 * the workspace (in document millimetres), clamped so the element stays fully
 * on the page. Palette inserts and drawn text both land here, so what you add
 * always appears where you are looking — never in a fixed corner.
 */
export function centerFor(
  visible: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number; elW: number; elH: number },
): { x: number; y: number } {
  const cx = visible.x + visible.w / 2;
  const cy = visible.y + visible.h / 2;
  const x = clamp(cx - size.elW / 2, 0, Math.max(0, size.w - size.elW));
  const y = clamp(cy - size.elH / 2, 0, Math.max(0, size.h - size.elH));
  return { x: round2(x), y: round2(y) };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
