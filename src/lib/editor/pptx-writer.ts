/**
 * Native, editable PowerPoint writer.
 *
 * The previous exporter drew each page into a canvas and dropped the bitmap on
 * a slide, so nothing in the resulting `.pptx` could be selected or typed into.
 * This writer walks the same `ScenePage` list the Word exporter uses and emits
 * real DrawingML: text frames (`p:sp` with runs), `a:tbl` tables, preset and
 * custom-geometry shapes, and pictures. Text stays text, tables stay tables.
 *
 * Coordinate mapping: the editor works in millimetres, PowerPoint in EMU via
 * `pptxgenjs`'s inches-based API, so every length passes through `mm2in`.
 */

import PptxGenJS from "pptxgenjs";
import type { SceneItem, ScenePage, SceneShape, SceneStroke } from "./scene";
import type { ShapePart } from "./shapes";
import { parseSvgPath, scaleSegments } from "./vector-path.ts";
import { BRAND } from "@/lib/brand";

/** Millimetres → inches, the unit `pptxgenjs` expects. */
const mm2in = (mm: number) => mm / 25.4;
/** Millimetres → points, for stroke weights and type sizes' siblings. */
const mm2pt = (mm: number) => mm * (72 / 25.4);
/** Millimetres → EMU, the coordinate space `pptxgenjs` uses for shape paths. */
const mm2emu = (mm: number) => Math.round(mm * 36000);

/** Shape ids with a true PowerPoint preset, so they stay editable presets. */
const PRESET: Record<string, string> = {
  rect: "rect",
  rounded: "roundRect",
  circle: "ellipse",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  pentagon: "pentagon",
  hexagon: "hexagon",
  octagon: "octagon",
  star5: "star5",
  star6: "star6",
  star12: "star12",
  seal: "irregularSeal1",
  "arrow-right": "rightArrow",
  "arrow-left": "leftArrow",
  "arrow-up": "upArrow",
  "arrow-down": "downArrow",
  "arrow-double": "leftRightArrow",
  chevron: "chevron",
  plus: "mathPlus",
  heart: "heart",
  cloud: "cloud",
  callout: "wedgeRectCallout",
  thought: "cloudCallout",
  banner: "ribbon2",
  moon: "moon",
};

function hex(color: string): string {
  const v = String(color || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return v
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase();
  }
  return "172033";
}

function isTransparent(color: string): boolean {
  const v = String(color || "").trim().toLowerCase();
  return !v || v === "transparent" || v === "none" || v === "rgba(0,0,0,0)";
}

function lineOf(stroke: SceneStroke | null): { color: string; width: number } | undefined {
  if (!stroke || isTransparent(stroke.color)) return undefined;
  // PowerPoint rejects a zero-width line; 0.25pt is the practical minimum.
  return { color: hex(stroke.color), width: Math.max(0.25, Number(mm2pt(stroke.width).toFixed(2))) };
}

/**
 * A rounded rectangle's corner radius, as the fraction PowerPoint expects.
 *
 * `roundRect` takes its radius from the `adj` guide as a share of the *shorter*
 * side, so a pill-shaped box needs a fraction of half the smaller dimension.
 */
function rectRadius(radiusMm: number, w: number, h: number): number | undefined {
  if (!radiusMm || radiusMm <= 0) return undefined;
  const shorter = Math.min(w, h);
  if (shorter <= 0) return undefined;
  return Math.min(0.5, radiusMm / shorter);
}

/**
 * Convert scene primitives (a 100×100 box) into `custGeom` points.
 *
 * Points must be EMU, not inches. `pptxgenjs` writes `<a:path w="cx" h="cy">`
 * with the shape's EMU extent, so the path coordinate space is EMU; and its
 * `getSmartParseNumber` treats any number below 100 as inches and multiplies it,
 * so millimetre-scaled points would be silently inflated. Emitting EMU also
 * keeps them above that threshold and passes through untouched.
 *
 * This is what keeps non-preset shapes — the Arabic ornament set, the arch
 * frames, the crescent — as real vectors in PowerPoint instead of a raster fill.
 */
export function partsToPoints(parts: ShapePart[], w: number, h: number) {
  const sx = mm2emu(w) / 100;
  const sy = mm2emu(h) / 100;
  const out: Array<Record<string, unknown>> = [];

  const emit = (segments: ReturnType<typeof scaleSegments>) => {
    const scaled = segments;
    if (scaled.length < 2) return;
    const points: Array<Record<string, unknown>> = [];
    let started = false;
    for (const seg of scaled) {
      if (seg.kind === "move") {
        points.push({ x: seg.x, y: seg.y });
        started = true;
      } else if (seg.kind === "line") {
        if (!started) continue;
        points.push({ x: seg.x, y: seg.y });
      } else if (seg.kind === "cubic") {
        if (!started) continue;
        points.push({
          x: seg.x,
          y: seg.y,
          curve: { type: "cubic", x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 },
        });
      } else if (seg.kind === "close") {
        points.push({ close: true });
      }
    }
    if (points.length > 1) out.push(...points);
  };

  for (const part of parts) {
    switch (part.k) {
      case "rect": {
        const x0 = part.x * sx;
        const y0 = part.y * sy;
        const x1 = (part.x + part.w) * sx;
        const y1 = (part.y + part.h) * sy;
        emit([
          { kind: "move", x: x0, y: y0 },
          { kind: "line", x: x1, y: y0 },
          { kind: "line", x: x1, y: y1 },
          { kind: "line", x: x0, y: y1 },
          { kind: "close" },
        ]);
        break;
      }
      case "circle":
      case "ellipse": {
        const cx = part.cx * sx;
        const cy = part.cy * sy;
        const rx = (part.k === "circle" ? part.r : part.rx) * sx;
        const ry = (part.k === "circle" ? part.r : part.ry) * sy;
        // Four cubic arcs approximate a full ellipse; the control-point distance
        // uses the standard 0.5523 circle constant.
        const k = 0.5523;
        emit([
          { kind: "move", x: cx, y: cy - ry },
          {
            kind: "cubic",
            x: cx + rx,
            y: cy,
            x1: cx + rx * k,
            y1: cy - ry,
            x2: cx + rx,
            y2: cy - ry * k,
          },
          {
            kind: "cubic",
            x: cx,
            y: cy + ry,
            x1: cx + rx,
            y1: cy + ry * k,
            x2: cx + rx * k,
            y2: cy + ry,
          },
          {
            kind: "cubic",
            x: cx - rx,
            y: cy,
            x1: cx - rx * k,
            y1: cy + ry * k,
            x2: cx - rx * k,
            y2: cy + ry,
          },
          {
            kind: "cubic",
            x: cx,
            y: cy - ry,
            x1: cx - rx,
            y1: cy - ry * k,
            x2: cx - rx * k,
            y2: cy - ry,
          },
          { kind: "close" },
        ]);
        break;
      }
      case "poly": {
        const nums = part.points.trim().split(/\s+/).map((pair) => pair.split(",").map(Number));
        const segments: ReturnType<typeof scaleSegments> = [];
        let first = true;
        for (const [px, py] of nums) {
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          if (first) {
            segments.push({ kind: "move", x: px * sx, y: py * sy });
            first = false;
          } else {
            segments.push({ kind: "line", x: px * sx, y: py * sy });
          }
        }
        if (segments.length) segments.push({ kind: "close" });
        emit(segments);
        break;
      }
      case "path": {
        emit(scaleSegments(parseSvgPath(part.d), sx, sy));
        break;
      }
    }
  }
  return out;
}


function addShapeItem(slide: PptxGenJS.Slide, item: SceneShape, name: string) {
  const fill = isTransparent(item.fill) ? { color: "FFFFFF", transparency: 100 } : { color: hex(item.fill) };
  const line = lineOf(item.stroke);
  const preset = PRESET[item.shapeId];

  if (preset && item.shapeId !== "rounded") {
    slide.addShape(preset as PptxGenJS.SHAPE_NAME, {
      x: mm2in(item.x),
      y: mm2in(item.y),
      w: mm2in(item.w),
      h: mm2in(item.h),
      rotate: item.rotation || undefined,
      objectName: name,
      fill,
      line: line ? { color: line.color, width: line.width } : { color: "FFFFFF", width: 0 },
    });
    return;
  }

  if (item.shapeId === "rounded") {
    slide.addShape("roundRect" as PptxGenJS.SHAPE_NAME, {
      x: mm2in(item.x),
      y: mm2in(item.y),
      w: mm2in(item.w),
      h: mm2in(item.h),
      rotate: item.rotation || undefined,
      fill,
      line: line ? { color: line.color, width: line.width } : { color: "FFFFFF", width: 0 },
      rectRadius: rectRadius(4, item.w, item.h),
      objectName: name,
    });
    return;
  }

  const points = partsToPoints(item.parts, item.w, item.h);
  if (!points.length) {
    // A shape whose path could not be parsed still occupies its box; an empty
    // rectangle is a better failure than a missing object.
    slide.addShape("rect", {
      x: mm2in(item.x),
      y: mm2in(item.y),
      w: mm2in(item.w),
      h: mm2in(item.h),
      objectName: name,
      fill,
      line: line ? { color: line.color, width: line.width } : { color: "FFFFFF", width: 0 },
    });
    return;
  }
  slide.addShape("custGeom" as PptxGenJS.SHAPE_NAME, {
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    h: mm2in(item.h),
    rotate: item.rotation || undefined,
    fill,
    line: line ? { color: line.color, width: line.width } : { color: "FFFFFF", width: 0 },
    points: points as PptxGenJS.ShapeProps["points"],
    objectName: name,
  } as PptxGenJS.ShapeProps);
}

const ALIGN: Record<string, "left" | "center" | "right" | "justify"> = {
  right: "right",
  center: "center",
  left: "left",
  justify: "justify",
};

function addTextItem(
  slide: PptxGenJS.Slide,
  item: Extract<SceneItem, { kind: "text" }>,
  name: string,
) {
  const lines = item.text.split("\n");
  const runs: PptxGenJS.TextProps[] = [];
  const align = ALIGN[item.align] || "right";
  const lineSpacingMultiple = Math.max(0.7, Math.min(3, item.lineHeight || 1.4));

  lines.forEach((line, idx) => {
    const isLast = idx === lines.length - 1;
    // `paragraphSpacing` is authored in mm and only ever applied between
    // paragraphs, matching how the canvas gaps hard line breaks.
    const spaceAfter = !isLast && item.paragraphSpacing > 0 ? item.paragraphSpacing : undefined;
    runs.push({
      text: line.length ? line : " ",
      options: {
        fontFace: item.font.split(",")[0].trim().replace(/^["']|["']$/g, ""),
        fontSize: item.size,
        bold: item.weight >= 600,
        italic: item.italic || undefined,
        color: hex(item.color),
        align,
        rtlMode: true,
        breakLine: !isLast,
        lineSpacingMultiple,
        charSpacing: item.letterSpacing || undefined,
        paraSpaceAfter: spaceAfter ? Number(mm2pt(spaceAfter).toFixed(1)) : undefined,
      },
    });
  });

  if (!runs.length) runs.push({ text: " ", options: { fontSize: item.size } });

  const fill = item.fill
    ? isTransparent(item.fill)
      ? undefined
      : { color: hex(item.fill) }
    : undefined;
  const line = lineOf(item.border);

  slide.addText(runs, {
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    h: mm2in(item.h),
    rotate: item.rotation || undefined,
    isTextBox: true,
    inset: mm2in(item.padding || 0),
    valign: "middle",
    margin: 0,
    fit: "shrink",
    fill,
    line: line ? { color: line.color, width: line.width } : undefined,
    shape: item.radius > 0 ? ("roundRect" as PptxGenJS.SHAPE_NAME) : undefined,
    rectRadius: item.radius > 0 ? rectRadius(item.radius, item.w, item.h) : undefined,
    vert: item.vertical ? "vert" : undefined,
    wrap: true,
    objectName: name,
  } as PptxGenJS.TextPropsOptions);
}

function addTableItem(
  slide: PptxGenJS.Slide,
  item: Extract<SceneItem, { kind: "table" }>,
  name: string,
) {
  const cols = Math.max(1, item.rows[0]?.length || 1);
  const colW = item.w / cols;
  const rows: PptxGenJS.TableRow[] = item.rows.map((row, ri) => {
    const header = ri === 0;
    const stripe = !header && item.stripeFill && ri % 2 === 0 ? item.stripeFill : null;
    return row.map((cell) => ({
      text: cell.length ? cell : " ",
      options: {
        fontFace: item.font.split(",")[0].trim().replace(/^["']|["']$/g, ""),
        fontSize: item.size,
        bold: header,
        color: header ? hex(item.headerColor) : hex("#172033"),
        fill: { color: hex(stripe || (header ? item.headerFill : item.rowFill)) },
        align: ALIGN[item.align] || "right",
        valign: "middle" as const,
        rtlMode: true,
        margin: mm2pt(item.padding),
      },
    }));
  });

  slide.addTable(rows, {
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    // A taller element keeps its authored height so page layout does not shift.
    rowH: mm2in(item.h / Math.max(1, item.rows.length)),
    // One width per *column*; passing one per row makes pptxgenjs discard the
    // list and fall back to evenly distributed columns.
    colW: Array.from({ length: cols }, () => mm2in(colW)),
    border: {
      type: "solid",
      color: hex(item.border.color),
      pt: Math.max(0.25, Number(mm2pt(item.border.width).toFixed(2))),
    },
    autoPage: false,
    margin: 0,
    objectName: name,
  } as PptxGenJS.TableProps);
}

function addProgressItem(slide: PptxGenJS.Slide, item: Extract<SceneItem, { kind: "progress" }>) {
  if (item.variant === "steps") {
    // Stages row: one ellipse per stage, filled up to the value, caption above
    // — the same composition the canvas draws.
    const total = item.steps;
    const filled = Math.round((item.value / 100) * total);
    const dot = Math.max(2.4, Math.min(item.h * 0.34, 7));
    const gap = dot * 0.55;
    const rowW = total * dot + (total - 1) * gap;
    for (let i = 0; i < total; i++) {
      // RTL: the first stage sits at the right edge, matching the canvas.
      const x = item.x + item.w - rowW + i * (dot + gap);
      slide.addShape("ellipse" as PptxGenJS.SHAPE_NAME, {
        x: mm2in(x),
        y: mm2in(item.y + item.h - dot),
        w: mm2in(dot),
        h: mm2in(dot),
        fill: { color: hex(i < filled ? item.fill : item.track) },
        line: { color: hex(i < filled ? item.fill : item.track), width: 0 },
      });
    }
    slide.addText(`${item.label}${item.showValue ? ` ${item.value}%` : ""}`.trim(), {
      x: mm2in(item.x),
      y: mm2in(item.y),
      w: mm2in(item.w),
      h: mm2in(Math.max(4, item.h - dot)),
      fontFace: item.font.split(",")[0].trim().replace(/^["']|["']$/g, ""),
      fontSize: item.size,
      bold: item.weight >= 600,
      color: hex(item.color),
      align: "right",
      rtlMode: true,
      valign: "top",
      isTextBox: true,
      margin: 0,
    });
    return;
  }

  if (item.variant === "ring") {
    // PowerPoint has a `blockArc` preset but no adjustable donut with a label,
    // so the ring is drawn as a true arc plus the caption beside it.
    slide.addShape("blockArc" as PptxGenJS.SHAPE_NAME, {
      x: mm2in(item.x),
      y: mm2in(item.y),
      w: mm2in(item.h),
      h: mm2in(item.h),
      fill: { color: hex(item.track) },
      line: { color: hex(item.track), width: 0 },
      angleRange: [270, 270 + Math.round((item.value / 100) * 360)] as [number, number],
    });
    const labelX = item.x + item.h + 2;
    slide.addText(
      `${item.label}${item.showValue ? ` ${item.value}%` : ""}`.trim(),
      {
        x: mm2in(labelX),
        y: mm2in(item.y),
        w: mm2in(Math.max(10, item.w - item.h - 2)),
        h: mm2in(item.h),
        fontFace: item.font.split(",")[0].trim().replace(/^["']|["']$/g, ""),
        fontSize: item.size,
        bold: item.weight >= 600,
        color: hex(item.color),
        align: "right",
        rtlMode: true,
        valign: "middle",
        isTextBox: true,
        margin: 0,
      },
    );
    return;
  }

  const track = Math.max(2, item.h);
  slide.addShape("roundRect" as PptxGenJS.SHAPE_NAME, {
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    h: mm2in(track),
    fill: { color: hex(item.track) },
    line: { color: hex(item.track), width: 0 },
    rectRadius: rectRadius(Math.min(item.radius, track / 2), item.w, track),
  });
  const valueW = (item.w * item.value) / 100;
  if (valueW > 0.2) {
    slide.addShape("roundRect" as PptxGenJS.SHAPE_NAME, {
      // RTL: the fill grows from the right, matching the canvas.
      x: mm2in(item.x + item.w - valueW),
      y: mm2in(item.y),
      w: mm2in(valueW),
      h: mm2in(track),
      fill: { color: hex(item.fill) },
      line: { color: hex(item.fill), width: 0 },
      rectRadius: rectRadius(Math.min(item.radius, track / 2), valueW, track),
    });
  }
  const caption = `${item.label}${item.showValue ? ` — ${item.value}%` : ""}`.trim();
  slide.addText(caption, {
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    h: mm2in(track),
    fontFace: item.font.split(",")[0].trim().replace(/^["']|["']$/g, ""),
    fontSize: item.size,
    bold: item.weight >= 600,
    color: hex(item.color),
    align: "right",
    rtlMode: true,
    valign: "middle",
    isTextBox: true,
    margin: 0,
  });
}

function addIconItem(
  slide: PptxGenJS.Slide,
  item: Extract<SceneItem, { kind: "icon" }>,
  name: string,
) {
  // Icon paths are stroke-only `24×24` line art, which has no PowerPoint preset
  // and no faithful `custGeom` fill. Rendering the SVG as a picture keeps the
  // artwork exact; the surrounding layout stays fully editable.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${item.color}" stroke-width="${item.stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${item.path}"/></svg>`;
  slide.addImage({
    // pptxgenjs rasterises SVG through an <img>, so the value must be a full
    // data URL; without the `data:` prefix the browser resolves it as a relative
    // path and the whole export rejects with "Unable to load image".
    data: `data:image/svg+xml;base64,${base64(svg)}`,
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    h: mm2in(item.h),
    rotate: item.rotation || undefined,
    altText: "أيقونة",
    objectName: name,
  });
}

function base64(input: string): string {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(input)));
  return Buffer.from(input, "utf8").toString("base64");
}

function addLineItem(slide: PptxGenJS.Slide, item: Extract<SceneItem, { kind: "line" }>, name: string) {
  const horizontal = !item.vertical;
  slide.addShape("line" as PptxGenJS.SHAPE_NAME, {
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(horizontal ? item.w : 0),
    h: mm2in(horizontal ? 0 : item.h),
    line: { color: hex(item.color), width: Math.max(0.25, Number(mm2pt(item.width).toFixed(2))) },
    rotate: item.rotation || undefined,
    objectName: name,
  } as PptxGenJS.ShapeProps);
}

function addImageItem(
  slide: PptxGenJS.Slide,
  item: Extract<SceneItem, { kind: "image" }>,
  name: string,
) {
  slide.addImage({
    data: item.src,
    x: mm2in(item.x),
    y: mm2in(item.y),
    w: mm2in(item.w),
    h: mm2in(item.h),
    rotate: item.rotation || undefined,
    sizing:
      item.fit === "contain"
        ? { type: "contain", w: mm2in(item.w), h: mm2in(item.h) }
        : item.fit === "cover"
          ? { type: "cover", w: mm2in(item.w), h: mm2in(item.h) }
          : undefined,
    altText: "صورة",
    objectName: name,
  } as PptxGenJS.ImageProps);
}

/**
 * Arabic display names for the PowerPoint selection pane.
 *
 * Without these, pptxgenjs falls back to "Shape 1", "Shape 2", which makes a
 * deck with dozens of objects impossible to navigate when the user reopens it.
 */
const LABELS: Record<string, string> = {
  text: "نص",
  image: "صورة",
  shape: "شكل",
  table: "جدول",
  progress: "مؤشر",
  icon: "أيقونة",
  line: "خط",
};

function addItem(slide: PptxGenJS.Slide, item: SceneItem, name: string) {
  switch (item.kind) {
    case "shape":
      addShapeItem(slide, item, name);
      break;
    case "text":
      addTextItem(slide, item, name);
      break;
    case "table":
      addTableItem(slide, item, name);
      break;
    case "progress":
      addProgressItem(slide, item);
      break;
    case "icon":
      addIconItem(slide, item, name);
      break;
    case "line":
      addLineItem(slide, item, name);
      break;
    case "image":
      addImageItem(slide, item, name);
      break;
  }
}

/**
 * Build a presentation whose slides hold native, editable objects.
 *
 * `definedLayout` is created per page size so an A4 or 16:9 project maps to a
 * slide with identical millimetre dimensions; that keeps the exported PDF/PNG
 * and the `.pptx` in agreement about where every element sits.
 */
export async function writePptx(scenes: ScenePage[], title: string): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.author = BRAND.developer;
  pptx.company = BRAND.name;
  pptx.title = title;
  pptx.subject = `${BRAND.name} — ${BRAND.platformEn}`;
  pptx.rtlMode = true;

  // Declare every distinct page size up front: a project can mix A4 portrait,
  // A4 landscape and 16:9 slides, and each needs its own slide master.
  const layoutName = (scene: ScenePage) => `page-${scene.w}x${scene.h}`;
  const declared = new Set<string>();
  for (const scene of scenes) {
    const name = layoutName(scene);
    if (declared.has(name)) continue;
    declared.add(name);
    pptx.defineLayout({
      name,
      // Full precision: rounding here shifts the slide size by a few EMU and
      // makes elements drift relative to the exported PDF.
      width: mm2in(scene.w),
      height: mm2in(scene.h),
    });
  }

  for (const scene of scenes) {
    pptx.layout = layoutName(scene);
    const slide = pptx.addSlide();
    slide.background = { color: hex(scene.background) };
    const counters: Record<string, number> = {};
    for (const item of scene.items) {
      const n = counters[item.kind] ?? 0;
      counters[item.kind] = n + 1;
      addItem(slide, item, `${LABELS[item.kind]} ${n + 1}`);
    }
  }

  const out = await pptx.write({ outputType: "arraybuffer" });
  return new Blob([out as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
