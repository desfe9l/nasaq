import {
  ICONS,
  cssFont,
  pageSize,
  parseTable,
  type CanvasEl,
  type Page,
} from "./model";
import { applyNumerals } from "./arabic";
import { safeImageSrc } from "./images";
import { safeSvgSrc } from "./svg";
import { shapeDef, type ShapePart } from "./shapes";
import { shapeIdOf } from "./shape-render";
import { prepareText, textPadding, type PageContext } from "./text-render";

/**
 * A page described in millimetres, independent of how it is drawn.
 *
 * The PDF/PNG exporters rasterise the live DOM, which is correct for pixel
 * output but useless for the Office writers: a flattened bitmap in a `.docx`
 * cannot be edited. Word and PowerPoint need the *structure* — this text run,
 * that table, this rectangle — so both writers read the same scene and each
 * emits its own native objects.
 *
 * Everything here is resolved (group offsets applied, Arabic numerals and text
 * auto-fit already run through `prepareText`), so the two writers cannot drift
 * from each other or from the canvas.
 */

/** A shape's outline width, in mm. */
export interface SceneStroke {
  color: string;
  width: number;
}

/** A flat, positioned primitive. Coordinates are page millimetres. */
export interface SceneText {
  kind: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  text: string;
  font: string;
  /** Point size, after any auto-fit. */
  size: number;
  weight: number;
  italic: boolean;
  /**
   * Optional so synthetic scene fixtures (tests, generated tables) stay valid —
   * absent means "not underlined".
   */
  underline?: boolean;
  color: string;
  align: "right" | "center" | "left" | "justify";
  lineHeight: number;
  letterSpacing: number;
  /** Paragraph gap in mm; blank lines in the content become this. */
  paragraphSpacing: number;
  vertical: boolean;
  /** Background fill for boxed text, `null` when the text is bare. */
  fill: string | null;
  border: SceneStroke | null;
  radius: number;
  /** Inner padding in mm. */
  padding: number;
}

export interface SceneShape {
  kind: "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  fill: string;
  stroke: SceneStroke | null;
  /** Authored geometry id, for writers that map to a native preset. */
  shapeId: string;
  /** Resolved primitives in a 100×100 box, for writers that need real vectors. */
  parts: ShapePart[];
}

export interface SceneLine {
  kind: "line";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  color: string;
  /** Thickness in mm. */
  width: number;
  vertical: boolean;
}

export interface SceneImage {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  /** Already validated by `safeImageSrc`; empty when the source is unusable. */
  src: string;
  fit: "cover" | "contain" | "fill";
  posX: number;
  posY: number;
  radius: number;
}

export interface SceneTable {
  kind: "table";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  rows: string[][];
  font: string;
  size: number;
  align: "right" | "center" | "left";
  headerFill: string;
  headerColor: string;
  rowFill: string;
  stripeFill: string | null;
  border: SceneStroke;
  /** Uniform cell padding in mm. */
  padding: number;
}

export interface SceneProgress {
  kind: "progress";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  label: string;
  /** 0–100. */
  value: number;
  variant: "bar" | "ring" | "steps";
  /** Steps variant: number of dots/stages. */
  steps: number;
  showValue: boolean;
  fill: string;
  track: string;
  color: string;
  font: string;
  size: number;
  weight: number;
  radius: number;
}

export interface SceneIcon {
  kind: "icon";
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;

  /** Mirrored artwork (step 7); absent means "not mirrored". */
  flipX?: boolean;
  flipY?: boolean;
  /** `24×24` SVG path data from `ICONS`. */
  path: string;
  color: string;
  /** Stroke weight in the 24-unit icon box. */
  stroke: number;
}

export type SceneItem =
  | SceneText
  | SceneShape
  | SceneLine
  | SceneImage
  | SceneTable
  | SceneProgress
  | SceneIcon;

export interface ScenePage {
  /** Page width/height in mm. */
  w: number;
  h: number;
  background: string;
  name: string;
  /** Paint order: first item is drawn first (furthest back). */
  items: SceneItem[];
}

const DEFAULT_INK = "#172033";
const DEFAULT_ACCENT = "#c9a86a";
const DEFAULT_LINE = "#bfc7d6";

function cleanColor(value: unknown, fallback: string): string {
  const v = String(value ?? "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^[a-z]+$/i.test(v)) return v;
  return fallback;
}

/** A stroke, or `null` when it is too thin to survive an Office renderer. */
function strokeOf(
  color: unknown,
  widthMm: unknown,
  fallbackColor: string,
): SceneStroke | null {
  const width = Number(widthMm);
  if (!Number.isFinite(width) || width <= 0) return null;
  return { color: cleanColor(color, fallbackColor), width };
}

function weightOf(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(900, Math.max(100, Math.round(n)))
    : fallback;
}

/**
 * Walk a page's element tree into flat, page-positioned primitives.
 *
 * Groups hold their members in group-relative coordinates and may carry their
 * own rotation and opacity. Members are lifted into page space with the group's
 * offset applied — the writers have no notion of a nested group, and flattening
 * here keeps each primitive independently addressable, which is exactly what
 * makes the exported file editable.
 */
function walk(
  els: CanvasEl[],
  ox: number,
  oy: number,
  inherited: { rotation: number; opacity: number },
  out: SceneItem[],
  pageRef?: PageContext,
) {
  for (const el of els) {
    if (el.hidden) continue;
    const opacity =
      inherited.opacity * (Number.isFinite(el.opacity) ? el.opacity : 1);
    // A fully transparent element is invisible on the canvas too; emitting it
    // would put an unreachable object in the user's PowerPoint.
    if (opacity <= 0.01) continue;

    if (el.type === "group") {
      if (!el.children?.length) continue;
      walk(
        el.children,
        ox + el.x,
        oy + el.y,
        { rotation: inherited.rotation + (el.rotation || 0), opacity },
        out,
        pageRef,
      );
      continue;
    }

    const item = toItem(
      el,
      ox,
      oy,
      inherited.rotation + (el.rotation || 0),
      pageRef,
    );
    if (Array.isArray(item)) out.push(...item);
    else if (item) out.push(item);
  }
}

/** A `rect` primitive at page millimetres — the building block of the divider. */
function bar(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
  fill: string,
): SceneShape {
  return {
    kind: "shape",
    x,
    y,
    w: Math.max(0.2, w),
    h: Math.max(0.2, h),
    rotation,
    fill,
    stroke: null,
    shapeId: "rect",
    parts: shapeDef("rect").parts,
  };
}

function toItem(
  el: CanvasEl,
  ox: number,
  oy: number,
  rotation: number,
  pageRef?: PageContext,
): SceneItem | SceneItem[] | null {
  const s = el.style || {};
  const base = {
    x: ox + el.x,
    y: oy + el.y,
    w: Math.max(0.5, el.w),
    h: Math.max(0.5, el.h),
    rotation,
    /*
     * Mirrors (step 7). Optional on every item so existing fixtures, generated
     * tables and office writers that ignore them keep working unchanged.
     */
    ...(s.flipX ? { flipX: true } : {}),
    ...(s.flipY ? { flipY: true } : {}),
  };

  const prepared = prepareText(el, pageRef);
  const font = cssFont(s.fontFamily);
  const padding = textPadding(el);

  switch (el.type) {
    case "text":
      return {
        kind: "text",
        ...base,
        text: prepared.text,
        font,
        size: prepared.fontSize,
        weight: weightOf(s.fontWeight, 600),
        italic: s.fontStyle === "italic" || s.fontStyle === "oblique",
        underline: s.underline === true,
        color: cleanColor(s.color, DEFAULT_INK),
        align: s.textAlign || "right",
        lineHeight: prepared.lineHeight,
        letterSpacing: Number(s.letterSpacing) || 0,
        paragraphSpacing: Number(s.paragraphSpacing) || 0,
        vertical: s.writingMode === "vertical",
        fill: null,
        border: null,
        radius: 0,
        padding,
      };

    case "box":
    case "stat":
      return {
        kind: "text",
        ...base,
        text: prepared.text,
        font,
        size: prepared.fontSize,
        weight: weightOf(s.fontWeight, 600),
        italic: s.fontStyle === "italic" || s.fontStyle === "oblique",
        underline: s.underline === true,
        color: cleanColor(s.color, DEFAULT_INK),
        align: s.textAlign || "right",
        lineHeight: prepared.lineHeight,
        letterSpacing: Number(s.letterSpacing) || 0,
        paragraphSpacing: Number(s.paragraphSpacing) || 0,
        vertical: s.writingMode === "vertical",
        fill: cleanColor(s.fill || s.background, "#f7f8fb"),
        border: strokeOf(s.borderColor, s.borderWidth ?? 0.35, "#d9dee8"),
        radius: Number(s.radius) || 0,
        padding,
      };

    case "stamp":
      return {
        kind: "text",
        ...base,
        text: prepared.text,
        font: cssFont(s.fontFamily || "Amiri"),
        size: prepared.fontSize,
        weight: weightOf(s.fontWeight, 700),
        italic: false,
        underline: false,
        color: cleanColor(s.color, DEFAULT_ACCENT),
        align: "center",
        lineHeight: prepared.lineHeight,
        letterSpacing: 0,
        paragraphSpacing: 0,
        vertical: false,
        fill: null,
        // The canvas draws the stamp as a double-ring pill; a writer that cannot
        // express that keeps the outline, which reads the same at page scale.
        border: {
          color: cleanColor(s.borderColor || s.color, DEFAULT_ACCENT),
          width: 0.7,
        },
        radius: Math.min(base.w, base.h) / 2,
        padding,
      };

    case "table": {
      const cols = Math.max(1, Number(s.cols) || 3);
      const rows = Math.max(1, Number(s.rows) || 4);
      const data = parseTable(el.content, cols, rows).map((row) =>
        row.map((cell) => applyNumerals(cell, s.numerals)),
      );
      return {
        kind: "table",
        ...base,
        rows: data,
        font,
        size: Number(s.fontSize) || 11,
        align: s.cellAlign || "right",
        headerFill: cleanColor(s.headerBg, "#006c35"),
        headerColor: cleanColor(s.headerColor, "#ffffff"),
        rowFill: cleanColor(s.tableBg, "#ffffff"),
        stripeFill: s.stripeBg ? cleanColor(s.stripeBg, "#f4f6fa") : null,
        border: strokeOf(s.borderColor, s.borderWidth ?? 0.3, DEFAULT_LINE) || {
          color: DEFAULT_LINE,
          width: 0.3,
        },
        padding: 1.6,
      };
    }

    case "shape":
      return {
        kind: "shape",
        ...base,
        fill: cleanColor(s.fill, "#006c35"),
        stroke: strokeOf(s.borderColor, s.borderWidth, "transparent"),
        shapeId: shapeIdOf(s),
        parts: shapeDef(shapeIdOf(s)).parts,
      };

    case "line": {
      const vertical = base.h > base.w;
      return {
        kind: "line",
        ...base,
        color: cleanColor(s.color, DEFAULT_ACCENT),
        width: Number(s.stroke) || 0.8,
        vertical,
      };
    }

    case "divider": {
      // The canvas draws rule–diamond–rule. Emitting all three keeps the motif
      // in the export instead of collapsing it to a plain bar.
      const color = cleanColor(s.color, DEFAULT_ACCENT);
      const thickness = Math.max(0.2, Number(s.stroke) || 0.6);
      const diamond = Math.min(base.h, 3.6);
      const side = Math.max(0, (base.w - diamond) / 2);
      const midY = base.y + (base.h - thickness) / 2;
      return [
        bar(base.x, midY, side, thickness, rotation, color),
        {
          kind: "shape",
          x: base.x + (base.w - diamond) / 2,
          y: base.y + (base.h - diamond) / 2,
          w: diamond,
          h: diamond,
          rotation: rotation + 45,
          fill: "transparent",
          stroke: { color, width: thickness },
          shapeId: "rect",
          parts: shapeDef("rect").parts,
        },
        bar(base.x + base.w - side, midY, side, thickness, rotation, color),
      ];
    }

    case "image":
    case "logo":
    case "qr":
    case "svg": {
      // SVG converts to a PNG at the export boundary only — the editor itself
      // keeps it vector. Rasterising happens in export.ts (async) and lands in
      // el.src temporarily; here we consume whichever source is usable.
      const src = safeImageSrc(el.src) || safeSvgSrc(el.src);
      if (!src) return null;
      return {
        kind: "image",
        ...base,
        src,
        fit:
          s.objectFit ||
          (el.type === "logo" || el.type === "qr" || el.type === "svg"
            ? "contain"
            : "cover"),
        posX: Number.isFinite(s.objectX) ? Number(s.objectX) : 50,
        posY: Number.isFinite(s.objectY) ? Number(s.objectY) : 50,
        radius: Number(s.radius) || 0,
      };
    }

    case "icon":
      return {
        kind: "icon",
        ...base,
        path: ICONS[el.icon || "star"] || ICONS.star,
        color: cleanColor(s.color, DEFAULT_ACCENT),
        stroke: Number(s.stroke) || 1.8,
      };

    case "progress":
      return {
        kind: "progress",
        ...base,
        label: prepared.text,
        value: Math.min(100, Math.max(0, Number(s.value) || 0)),
        variant:
          s.variant === "ring"
            ? "ring"
            : s.variant === "steps"
              ? "steps"
              : "bar",
        steps: Math.max(2, Math.min(12, Number(s.steps) || 5)),
        showValue: s.showValue !== false,
        fill: cleanColor(s.fill, "#006c35"),
        track: cleanColor(s.background, "#e8ecf3"),
        color: cleanColor(s.color, DEFAULT_INK),
        font,
        size: prepared.fontSize,
        weight: weightOf(s.fontWeight, 700),
        radius: Number(s.radius) || 3,
      };

    default:
      return null;
  }
}

/** Resolve one page into a flat scene in millimetres. */
export function buildScenePage(page: Page, pageRef?: PageContext): ScenePage {
  const size = pageSize(page);
  const items: SceneItem[] = [];
  const ordered = page.elements.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  walk(ordered, 0, 0, { rotation: 0, opacity: 1 }, items, pageRef);
  return {
    w: size.w,
    h: size.h,
    background: cleanColor(page.bg, "#ffffff"),
    name: page.name || "",
    items,
  };
}

/**
 * Build the writer-neutral scene for a whole document.
 *
 * Each page is rendered with its own page number so a Word/PowerPoint export
 * carries the same «صفحة n من m» the canvas shows.
 */
export function buildScene(pages: Page[]): ScenePage[] {
  return pages.map((page, index) =>
    buildScenePage(page, { number: index + 1, count: pages.length }),
  );
}

/** Every distinct font family in a scene, so a writer can declare them up front. */
export function sceneFonts(scenes: ScenePage[]): string[] {
  const names = new Set<string>();
  for (const scene of scenes) {
    for (const item of scene.items) {
      if (
        item.kind === "text" ||
        item.kind === "table" ||
        item.kind === "progress"
      ) {
        const first = item.font
          .split(",")[0]
          .trim()
          .replace(/^["']|["']$/g, "");
        if (first) names.add(first);
      }
    }
  }
  return [...names];
}
