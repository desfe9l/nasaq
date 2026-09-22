import { isCompoundShape, shapeDef, type ShapePart } from "./shapes";

/**
 * Shape rendering for both surfaces.
 *
 * The canvas renders React SVG and the exporter builds HTML strings, but the
 * geometry source must be identical or a shape would shift between the editor
 * and the exported PDF. These builders emit the same primitive list, so only the
 * wrapper differs.
 */

/** `shapeId` when present, else the legacy `shape` enum from pre-upgrade files. */
export function shapeIdOf(
  style: { shapeId?: string; shape?: string } | undefined,
): string {
  if (style?.shapeId) return style.shapeId;
  switch (style?.shape) {
    case "circle":
      return "circle";
    case "rounded":
      return "rounded";
    default:
      return "rect";
  }
}

function partAttrs(part: ShapePart): string {
  switch (part.k) {
    case "rect":
      return `x="${part.x}" y="${part.y}" width="${part.w}" height="${part.h}"${part.rx ? ` rx="${part.rx}"` : ""}`;
    case "circle":
      return `cx="${part.cx}" cy="${part.cy}" r="${part.r}"`;
    case "ellipse":
      return `cx="${part.cx}" cy="${part.cy}" rx="${part.rx}" ry="${part.ry}"`;
    case "poly":
      return `points="${part.points}"`;
    case "path":
      return `d="${part.d}"`;
  }
}

function partTag(part: ShapePart): string {
  switch (part.k) {
    case "circle":
      return "circle";
    case "ellipse":
      return "ellipse";
    case "poly":
      return "polygon";
    default:
      return "path";
  }
}

/**
 * Serialise a shape to SVG source.
 *
 * `fill`/`stroke` are supplied by the caller rather than read here, because the
 * canvas and the exporter resolve colours slightly differently (theme fallbacks
 * vs. whitelisted values).
 *
 * `strokeUnits` is the outline width already converted to viewBox units. The
 * geometry is inset by half of it via a transform, because an SVG stroke
 * straddles the path edge: a full-bleed shape would lose its outer half to the
 * element's `overflow: hidden`, and a thick outline would look thinner than the
 * `border-width` the properties panel reports. Insetting keeps the outline the
 * stated weight and fully inside the frame.
 */
export function shapeSvgMarkup(
  shapeId: string | undefined,
  opts: { fill: string; stroke: string; strokeUnits: number },
): string {
  const def = shapeDef(shapeId);
  const evenOdd = isCompoundShape(def.id) ? ' fill-rule="evenodd"' : "";
  const strokeUnits = Math.max(0, opts.strokeUnits);
  const inner = 100 - strokeUnits;
  const transform =
    strokeUnits > 0
      ? ` transform="translate(${strokeUnits / 2} ${strokeUnits / 2}) scale(${inner / 100})"`
      : "";
  const stroke =
    strokeUnits > 0
      ? ` stroke="${opts.stroke}" stroke-width="${strokeUnits}" stroke-linejoin="round"`
      : "";
  const body = def.parts
    .map(
      (p) =>
        `<${partTag(p)} ${partAttrs(p)}${p.k === "path" ? ' stroke-linejoin="round"' : ""}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%"><g${transform} fill="${opts.fill}"${evenOdd}${stroke}>${body}</g></svg>`;
}

/**
 * Convert a border width in mm to viewBox units for a given box.
 *
 * The SVG stretches to a non-square frame (`preserveAspectRatio="none"`), so a
 * single scalar cannot match both axes; the geometric mean keeps the outline
 * visually even on the square-ish shapes it is normally used with.
 */
export function strokeToUnits(
  borderWidthMm: number,
  box: { w: number; h: number },
): number {
  const w = Number(box?.w) || 1;
  const h = Number(box?.h) || 1;
  const scale = Math.sqrt(w * h);
  return ((Number(borderWidthMm) || 0) / Math.max(0.5, scale)) * 100;
}

export type { ShapePart };
