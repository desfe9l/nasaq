/**
 * Native, editable Word writer.
 *
 * Word has no canvas: a page is a linear text flow, so an absolutely-positioned
 * report is expressed through *floating* objects — paragraphs in text frames
 * (`w:framePr`), floating tables (`tblpPr`) and anchored pictures (`wp:anchor`).
 * This writer emits exactly those, so every text block, table, picture and shape
 * in the `.docx` stays selectable and retypeable.
 *
 * Shapes go out as `wps:wsp` with either a preset geometry or a real `a:custGeom`
 * path built from the same vector primitives the canvas draws, so decorative
 * shapes survive as vectors instead of becoming pictures.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  FrameAnchorType,
  FrameWrap,
  HeightRule,
  ImageRun,
  ImportedXmlComponent,
  Run,
  OverlapType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  UnderlineType,
  TableAnchorType,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip as mm,
  type IImageOptions,
  type ITableOptions,
  type ParagraphChild,
} from "docx";
import type { SceneImage, SceneItem, ScenePage, SceneShape, SceneStroke } from "./scene";
import { parseSvgPath, scaleSegments, type PathSegment } from "./vector-path.ts";
import { BRAND } from "@/lib/brand";

const mm2pt = (v: number) => v * (72 / 25.4);
/** Word sizes strokes in eighths of a point; 2 (¼pt) is the practical minimum. */
const strokeEighths = (widthMm: number) => Math.max(2, Math.round(mm2pt(widthMm) * 8));
/** DrawingML distances are EMU: 1 mm = 36000 EMU. */
const mm2emu = (v: number) => Math.round(v * 36000);

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
  return !v || v === "transparent" || v === "none";
}

function fontFace(font: string): string {
  const first = font.split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first || "Tajawal";
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  right: AlignmentType.RIGHT,
  center: AlignmentType.CENTER,
  left: AlignmentType.LEFT,
  justify: AlignmentType.JUSTIFIED,
};

/**
 * Namespaces for an imported drawing subtree.
 *
 * `ImportedXmlComponent` passes attributes through verbatim, so the fragment
 * must declare everything it uses to stay valid regardless of where the host
 * document places it.
 */
const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

/** Word rejects duplicate `wp:docPr` ids within one document. */
let shapeSeq = 0;

/** Preset geometries shared by Word and PowerPoint, keyed by shape id. */
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

/**
 * Scale a shape's primitives into its EMU box.
 *
 * Primitives live in a 100×100 space, so the factors map straight onto the EMU
 * dimensions the path declaration uses.
 */
function shapePath(item: SceneShape): PathSegment[] {
  const sx = mm2emu(item.w) / 100;
  const sy = mm2emu(item.h) / 100;
  const out: PathSegment[] = [];

  for (const part of item.parts) {
    switch (part.k) {
      case "rect": {
        const x0 = part.x * sx;
        const y0 = part.y * sy;
        const x1 = (part.x + part.w) * sx;
        const y1 = (part.y + part.h) * sy;
        out.push(
          { kind: "move", x: x0, y: y0 },
          { kind: "line", x: x1, y: y0 },
          { kind: "line", x: x1, y: y1 },
          { kind: "line", x: x0, y: y1 },
          { kind: "close" },
        );
        break;
      }
      case "circle":
      case "ellipse": {
        const cx = part.cx * sx;
        const cy = part.cy * sy;
        const rx = (part.k === "circle" ? part.r : part.rx) * sx;
        const ry = (part.k === "circle" ? part.r : part.ry) * sy;
        const k = 0.5523;
        out.push(
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
            y1: cy + ry,
            x2: cx - rx,
            y2: cy + ry * k,
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
        );
        break;
      }
      case "poly": {
        const nums = part.points
          .trim()
          .split(/\s+/)
          .map((pair) => pair.split(",").map(Number));
        let first = true;
        for (const [px, py] of nums) {
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          out.push({ kind: first ? "move" : "line", x: px * sx, y: py * sy });
          first = false;
        }
        if (!first) out.push({ kind: "close" });
        break;
      }
      case "path":
        out.push(...scaleSegments(parseSvgPath(part.d), sx, sy));
        break;
    }
  }
  return out;
}

function pathSegmentsToXml(segments: PathSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    switch (seg.kind) {
      case "move":
        parts.push(`<a:moveTo><a:pt x="${Math.round(seg.x)}" y="${Math.round(seg.y)}"/></a:moveTo>`);
        break;
      case "line":
        parts.push(`<a:lnTo><a:pt x="${Math.round(seg.x)}" y="${Math.round(seg.y)}"/></a:lnTo>`);
        break;
      case "cubic":
        parts.push(
          `<a:cubicBezTo><a:pt x="${Math.round(seg.x1)}" y="${Math.round(seg.y1)}"/><a:pt x="${Math.round(seg.x2)}" y="${Math.round(seg.y2)}"/><a:pt x="${Math.round(seg.x)}" y="${Math.round(seg.y)}"/></a:cubicBezTo>`,
        );
        break;
      case "close":
        parts.push("<a:close/>");
        break;
    }
  }
  return parts.join("");
}

/**
 * A floating shape anchored to the page, as a `wp:anchor` fragment.
 *
 * `behindDoc='1'` makes a shape behave like a canvas layer rather than an inline
 * object, so report backgrounds and frames do not push the body content down.
 *
 * The fragment is rooted at `wp:anchor` and declares its own namespaces, because
 * `ImportedXmlComponent` serialises the parsed tree under whatever root key the
 * caller sets — reusing a `w:drawing` root here would nest two of them.
 */
function shapeDrawing(item: SceneShape): string {
  const wEmu = mm2emu(item.w);
  const hEmu = mm2emu(item.h);
  const id = ++shapeSeq;
  const rot = item.rotation ? ` rot="${Math.round(item.rotation * 60000)}"` : "";

  const fillXml = isTransparent(item.fill)
    ? "<a:noFill/>"
    : `<a:solidFill><a:srgbClr val="${hex(item.fill)}"/></a:solidFill>`;
  const stroke = item.stroke;
  const lineXml =
    stroke && !isTransparent(stroke.color)
      ? `<a:ln w="${strokeEighths(stroke.width) * 12700}"><a:solidFill><a:srgbClr val="${hex(stroke.color)}"/></a:solidFill></a:ln>`
      : "<a:ln><a:noFill/></a:ln>";

  const preset = PRESET[item.shapeId];
  const geometry = preset
    ? `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`
    : `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${wEmu}" h="${hEmu}">${pathSegmentsToXml(
        shapePath(item),
      )}</a:path></a:pathLst></a:custGeom>`;

  return `<wp:anchor ${NS} distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="1" locked="0" layoutInCell="0" allowOverlap="1">
<wp:simplePos x="0" y="0"/>
<wp:positionH relativeFrom="page"><wp:posOffset>${mm2emu(item.x)}</wp:posOffset></wp:positionH>
<wp:positionV relativeFrom="page"><wp:posOffset>${mm2emu(item.y)}</wp:posOffset></wp:positionV>
<wp:extent cx="${wEmu}" cy="${hEmu}"/>
<wp:effectExtent l="0" t="0" r="0" b="0"/>
<wp:wrapNone/>
<wp:docPr id="${id}" name="Shape ${id}"/>
<wp:cNvGraphicFramePr/>
<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
<wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm${rot}><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm>${geometry}${fillXml}${lineXml}</wps:spPr>
<wps:txbx><w:txbxContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:txbxContent></wps:txbx>
<wps:bodyPr rot="0" anchor="ctr"/>
</wps:wsp></a:graphicData></a:graphic></wp:anchor>`;
}

function borderOpt(stroke: SceneStroke) {
  return {
    style: BorderStyle.SINGLE,
    size: strokeEighths(stroke.width),
    color: hex(stroke.color),
  };
}

/**
 * A text block as a floating frame.
 *
 * Only the first paragraph carries the frame; the remaining lines stack inside
 * it. `wrap: NONE` plus page anchoring reproduces the canvas, where a block sits
 * at its authored offset and never displaces a neighbour.
 */
function textBlock(item: Extract<SceneItem, { kind: "text" }>): Paragraph[] {
  const frame = {
    type: "absolute" as const,
    position: { x: mm(item.x), y: mm(item.y) },
    width: mm(item.w),
    height: mm(item.h),
    anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
    wrap: FrameWrap.NONE,
    rule: HeightRule.ATLEAST,
  };

  const lines = item.text.split("\n");
  const bordered = item.border && !isTransparent(item.border.color) ? item.border : null;

  return lines.map((line, idx) => {
    const isLast = idx === lines.length - 1;
    const spaceAfter = !isLast && item.paragraphSpacing > 0 ? mm(item.paragraphSpacing) : 0;
    return new Paragraph({
      ...(idx === 0 ? { frame } : {}),
      alignment: ALIGN[item.align] || AlignmentType.RIGHT,
      bidirectional: true,
      spacing: {
        line: Math.round((item.lineHeight || 1.4) * 240),
        lineRule: "auto",
        after: spaceAfter,
        before: 0,
      },
      shading:
        item.fill && !isTransparent(item.fill)
          ? { type: ShadingType.CLEAR, color: "auto", fill: hex(item.fill) }
          : undefined,
      border: bordered
        ? {
            top: borderOpt(bordered),
            bottom: borderOpt(bordered),
            left: borderOpt(bordered),
            right: borderOpt(bordered),
          }
        : undefined,
      indent: item.padding ? { start: mm(item.padding), end: mm(item.padding) } : undefined,
      children: [
        new TextRun({
          text: line.length ? line : " ",
          rightToLeft: true,
          bold: item.weight >= 600,
          italics: item.italic,
          // Complex scripts (Arabic) need the explicit complex-script flags,
          // otherwise Word renders the run without them.
          underline: item.underline ? { type: UnderlineType.SINGLE } : undefined,
          boldComplexScript: item.weight >= 600,
          italicsComplexScript: item.italic,
          size: Math.max(4, Math.round(item.size * 2)),
          color: hex(item.color),
          font: fontFace(item.font),
          characterSpacing: item.letterSpacing ? Math.round(item.letterSpacing * 20) : undefined,
        }),
      ],
    });
  });
}

/**
 * A floating table anchored to the page.
 *
 * `tblpPr` is what keeps a designed table at its own coordinates; without it
 * Word drops the table into the body flow and every table in the report lands in
 * sequence down the page instead of where it was placed.
 */
function floatingTable(item: Extract<SceneItem, { kind: "table" }>): Table {
  const cols = Math.max(1, item.rows[0]?.length || 1);
  const colWidth = mm(item.w) / cols;
  const columnWidths = Array.from({ length: cols }, () => colWidth);

  const rows = item.rows.map((row, ri) => {
    const header = ri === 0;
    const stripe = !header && item.stripeFill && ri % 2 === 0 ? item.stripeFill : null;
    return new TableRow({
      children: row.map(
        (cell) =>
          new TableCell({
            width: { size: colWidth, type: WidthType.DXA },
            shading: {
              type: ShadingType.CLEAR,
              color: "auto",
              fill: hex(stripe || (header ? item.headerFill : item.rowFill)),
            },
            margins: {
              top: mm(item.padding),
              bottom: mm(item.padding),
              left: mm(item.padding),
              right: mm(item.padding),
            },
            children: [
              new Paragraph({
                alignment: ALIGN[item.align] || AlignmentType.RIGHT,
                bidirectional: true,
                children: [
                  new TextRun({
                    text: cell.length ? cell : " ",
                    rightToLeft: true,
                    bold: header,
                    size: Math.max(4, Math.round(item.size * 2)),
                    color: header ? hex(item.headerColor) : hex("#172033"),
                    font: fontFace(item.font),
                  }),
                ],
              }),
            ],
          }),
      ),
    });
  });

  const borderSet = {
    style: BorderStyle.SINGLE,
    size: strokeEighths(item.border.width),
    color: hex(item.border.color),
  };

  return new Table({
    rows,
    width: { size: mm(item.w), type: WidthType.DXA },
    columnWidths,
    borders: {
      top: borderSet,
      bottom: borderSet,
      left: borderSet,
      right: borderSet,
      insideHorizontal: borderSet,
      insideVertical: borderSet,
    },
    float: {
      horizontalAnchor: TableAnchorType.PAGE,
      verticalAnchor: TableAnchorType.PAGE,
      absoluteHorizontalPosition: mm(item.x),
      absoluteVerticalPosition: mm(item.y),
      overlap: OverlapType.OVERLAP,
      topFromText: 0,
      bottomFromText: 0,
      leftFromText: 0,
      rightFromText: 0,
    },
  } as ITableOptions);
}

/**
 * An anchored picture.
 *
 * Images arrive as data URLs from the editor's store, where large uploads live
 * in IndexedDB. Word needs raw bytes plus an explicit format, so the data URL is
 * decoded here and its extension decides the media type.
 */
export function imageOptions(item: SceneImage): IImageOptions | null {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(item.src);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const type = kind === "jpg" || kind === "jpeg" ? "jpg" : (kind as "png" | "gif" | "bmp");
  const data = Buffer.from(match[2], "base64");

  return {
    type,
    data,
    transformation: { width: mm(item.w), height: mm(item.h) },
    floating: {
      horizontalPosition: { relative: "page", offset: mm(item.x) },
      verticalPosition: { relative: "page", offset: mm(item.y) },
      behindDocument: false,
      allowOverlap: true,
      zIndex: 1,
    },
    // `ImageRun` ignores `docProperties` and derives the drawing id from
    // `altText`, numbering from 1 for every picture. That collides with the ids
    // handed out by `shapeSeq` and yields a document Word rejects, so allocate
    // the id from the shared counter here instead.
    altText: {
      id: String(++shapeSeq),
      name: "صورة",
      description: `صورة من ${BRAND.nameAr}`,
    },
  } as IImageOptions;
}

/** A paragraph that carries one anchored picture. */
function imageParagraph(item: SceneImage): Paragraph | null {
  const options = imageOptions(item);
  if (!options) return null;
  return new Paragraph({
    children: [new ImageRun(options) as unknown as ParagraphChild],
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
  });
}

/** Wrap a raw drawing fragment as the paragraph that carries it. */
function drawingParagraph(fragment: string): Paragraph {
  const drawing = ImportedXmlComponent.fromXmlString(fragment);
  // `fromXmlString` keeps the parsed root's name on the tree but leaves the
  // component's own root key unset, which would serialise as `<undefined>`.
  (drawing as unknown as { rootKey: string }).rootKey = "w:drawing";
  const run = new Run({});
  run.addChildElement(drawing);
  return new Paragraph({
    children: [run],
    spacing: { before: 0, after: 0, line: 240, lineRule: "auto" },
  });
}

/** Wrap a raw shape as the paragraph carrying its anchored drawing. */
function shapeParagraph(item: SceneShape): Paragraph {
  return drawingParagraph(shapeDrawing(item));
}

/**
 * A shape or rule as an anchored drawing.
 *
 * A line becomes a thin filled rectangle: Word's `line` preset has no fill and
 * renders inconsistently across viewers, whereas a rectangle honours the
 * authored thickness and colour exactly.
 */
function shapeBlock(item: SceneItem): Paragraph[] {
  if (item.kind === "shape") return [shapeParagraph(item)];
  if (item.kind === "line") {
    const thickness = Math.max(0.4, item.width);
    return [
      shapeParagraph({
        kind: "shape",
        x: item.vertical ? item.x + (item.w - thickness) / 2 : item.x,
        y: item.vertical ? item.y : item.y + (item.h - thickness) / 2,
        w: item.vertical ? thickness : item.w,
        h: item.vertical ? item.h : thickness,
        rotation: 0,
        fill: item.color,
        stroke: null,
        shapeId: "rect",
        parts: [{ k: "rect", x: 0, y: 0, w: 100, h: 100 }],
      }),
    ];
  }
  return [];
}

/**
 * An icon as an SVG picture.
 *
 * Icon paths are stroke-only line art with no fill, which `custGeom` cannot
 * express faithfully. As a picture the icon stays sharp at any zoom while
 * everything around it remains editable.
 */
function iconParagraph(item: Extract<SceneItem, { kind: "icon" }>): Paragraph {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${item.color}" stroke-width="${item.stroke}" stroke-linecap="round" stroke-linejoin="round"><path d="${item.path}"/></svg>`;
  return new Paragraph({
    children: [
      new ImageRun({
        type: "svg",
        data: new TextEncoder().encode(svg),
        // Word needs a raster fallback for viewers that skip SVG blips.
        fallback: {
          type: "png",
          data: new Uint8Array(0),
        },
        transformation: { width: mm(item.w), height: mm(item.h) },
        floating: {
          horizontalPosition: { relative: "page", offset: mm(item.x) },
          verticalPosition: { relative: "page", offset: mm(item.y) },
          allowOverlap: true,
          zIndex: 1,
        },
        altText: {
          id: String(++shapeSeq),
          name: "أيقونة",
          description: "أيقونة",
        },
      } as IImageOptions) as unknown as ParagraphChild,
    ],
    spacing: { before: 0, after: 0, line: 1, lineRule: "auto" },
  });
}

/**
 * A progress indicator: a track rectangle plus a filled value rectangle with the
 * caption as its own floating frame. All three pieces stay editable, so the
 * value can be retyped and the bars restyled in Word.
 */
function progressBlocks(item: Extract<SceneItem, { kind: "progress" }>): Paragraph[] {
  if (item.variant === "steps") {
    // Stages row: one dot per stage, filled up to the value — the same picture
    // the canvas draws, kept as native ellipse shapes so Word stays editable.
    const total = item.steps;
    const filled = Math.round((item.value / 100) * total);
    const dot = Math.max(2.4, Math.min(item.h * 0.34, 7));
    const gap = dot * 0.55;
    const rowW = total * dot + (total - 1) * gap;
    const out: Paragraph[] = [];
    for (let i = 0; i < total; i++) {
      // RTL: the first stage sits at the right edge, matching the canvas.
      const x = item.x + item.w - rowW + i * (dot + gap);
      out.push(...shapeBlock({
        kind: "shape",
        x,
        y: item.y + item.h - dot,
        w: dot,
        h: dot,
        rotation: 0,
        fill: i < filled ? item.fill : item.track,
        stroke: null,
        shapeId: "circle",
        parts: [{ k: "rect", x: 0, y: 0, w: 100, h: 100 }],
      }));
    }
    out.push(
      ...textBlock({
        kind: "text",
        x: item.x + 1,
        y: item.y,
        w: Math.max(6, item.w - 2),
        h: Math.max(4, item.h - dot),
        rotation: 0,
        text: `${item.label}${item.showValue ? ` — ${item.value}%` : ""}`.trim(),
        font: item.font,
        size: item.size,
        weight: item.weight,
        italic: false,
        color: item.color,
        align: "right",
        lineHeight: 1.2,
        letterSpacing: 0,
        paragraphSpacing: 0,
        vertical: false,
        fill: null,
        border: null,
        radius: 0,
        padding: 0,
      }),
    );
    return out;
  }

  const track = Math.max(2, item.h);
  const bar = (w: number, x: number, fill: string): Paragraph[] =>
    shapeBlock({
      kind: "shape",
      x,
      y: item.y + (item.h - track) / 2,
      w: Math.max(0.3, w),
      h: track,
      rotation: 0,
      fill,
      stroke: null,
      shapeId: "rounded",
      parts: [{ k: "rect", x: 0, y: 0, w: 100, h: 100 }],
    });

  const out = bar(item.w, item.x, item.track);
  const valueW = (item.w * item.value) / 100;
  if (valueW > 0.3) out.push(...bar(valueW, item.x + item.w - valueW, item.fill));

  // The caption sits over the bar, matching the canvas where the label is
  // rendered on top of the track.
  out.push(
    ...textBlock({
      kind: "text",
      x: item.x + 1,
      y: item.y,
      w: Math.max(6, item.w - 2),
      h: item.h,
      rotation: 0,
      text: `${item.label}${item.showValue ? ` — ${item.value}%` : ""}`.trim(),
      font: item.font,
      size: item.size,
      weight: item.weight,
      italic: false,
      color: item.color,
      align: "right",
      lineHeight: 1.2,
      letterSpacing: 0,
      paragraphSpacing: 0,
      vertical: false,
      fill: null,
      border: null,
      radius: 0,
      padding: 0,
    }),
  );
  return out;
}

function blocksFor(item: SceneItem): Array<Paragraph | Table> {
  switch (item.kind) {
    case "text":
      return textBlock(item);
    case "shape":
    case "line":
      return shapeBlock(item);
    case "image": {
      const p = imageParagraph(item);
      return p ? [p] : [];
    }
    case "icon":
      return [iconParagraph(item)];
    case "table":
      // A floating table needs an anchor paragraph to hang from; an empty one
      // keeps the page from starting with a bare table. The table itself must be
      // a sibling of the paragraphs, not a paragraph child: Word only tolerates
      // `<w:tbl>` at body level, and nesting it inside `<w:p>` makes the reader
      // silently drop the table while leaving the paragraph behind.
      return [
        new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 1, lineRule: "auto" } }),
        floatingTable(item),
      ];
    case "progress":
      return progressBlocks(item);
    default:
      return [];
  }
}

export interface DocxOptions {
  scenes: ScenePage[];
  title: string;
}

/** Build a `.docx` whose every text block, table and shape stays editable. */
export async function writeDocx(options: DocxOptions): Promise<Blob> {
  shapeSeq = 0;
  const sections = options.scenes.map((scene) => ({
    properties: {
      page: {
        size: { width: mm(scene.w), height: mm(scene.h) },
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    },
    children: scene.items.flatMap(blocksFor),
  }));

  const doc = new Document({
    title: options.title,
    creator: BRAND.developer,
    description: `${BRAND.name} — ${BRAND.platformEn}`,
    styles: {
      default: {
        document: {
          run: { font: "Tajawal", size: 22 },
          paragraph: { spacing: { line: 276, lineRule: "auto" } },
        },
      },
    },
    sections,
  });

  return Packer.toBlob(doc);
}
