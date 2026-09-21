import { isCompoundShape, shapeDef, type ShapePart } from "@/lib/editor/shapes";
import { shapeIdOf, strokeToUnits } from "@/lib/editor/shape-render";

interface Props {
  /** Resolved shape id; falls back to the legacy `shape` enum. */
  style: { shapeId?: string; shape?: string };
  fill: string;
  stroke: string;
  borderWidthMm: number;
  /** Element box in mm — needed to convert the outline to viewBox units. */
  box: { w: number; h: number };
  /** Dash pattern in viewBox units — the clipping-mask outline marker. */
  strokeDasharray?: string;
}

/**
 * Renders a shape's geometry as React SVG.
 *
 * Geometry comes from the shared `shapes.ts` definitions, the same source the
 * HTML exporter serialises, so an exported PDF matches the canvas exactly.
 * Children are built as elements rather than injected markup — shape ids arrive
 * from imported project files and must never reach the DOM as raw SVG source.
 */
/**
 * Raw geometry of a shape as SVG children, in whatever box the caller passes.
 *
 * The clip-path of a clipping mask needs the exact same primitives the glyph
 * paints, otherwise the cut would follow a different silhouette than the shape
 * the author sees. Keeping one builder guarantees they can never drift.
 */
export function ShapeParts({ parts, fillRule }: { parts: ShapePart[]; fillRule?: "evenodd" }) {
  return (
    <>
      {parts.map((part, i) => {
        const shared = { strokeLinejoin: "round" as const, fillRule };
        if (part.k === "rect") {
          return <rect key={i} {...shared} x={part.x} y={part.y} width={part.w} height={part.h} rx={part.rx} />;
        }
        if (part.k === "circle") {
          return <circle key={i} {...shared} cx={part.cx} cy={part.cy} r={part.r} />;
        }
        if (part.k === "ellipse") {
          return <ellipse key={i} {...shared} cx={part.cx} cy={part.cy} rx={part.rx} ry={part.ry} />;
        }
        if (part.k === "poly") {
          return <polygon key={i} {...shared} points={part.points} />;
        }
        return <path key={i} {...shared} d={part.d} />;
      })}
    </>
  );
}

export function ShapeGlyph({ style, fill, stroke, borderWidthMm, box, strokeDasharray }: Props) {
  const def = shapeDef(shapeIdOf(style));
  const strokeUnits = strokeToUnits(borderWidthMm, box);
  const inner = Math.max(1, 100 - strokeUnits);
  const transform = strokeUnits > 0 ? `translate(${strokeUnits / 2} ${strokeUnits / 2}) scale(${inner / 100})` : undefined;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      aria-hidden
      focusable="false"
    >
      <g
        transform={transform}
        fill={fill}
        fillRule={isCompoundShape(def.id) ? "evenodd" : undefined}
        stroke={strokeUnits > 0 ? stroke : undefined}
        strokeWidth={strokeUnits > 0 ? strokeUnits : undefined}
        strokeDasharray={strokeDasharray}
        strokeLinejoin="round"
      >
        <ShapeParts parts={def.parts} fillRule={isCompoundShape(def.id) ? "evenodd" : undefined} />
      </g>
    </svg>
  );
}