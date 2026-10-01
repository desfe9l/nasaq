import {
  gradientVector,
  normalizeGradient,
  stopRgba,
  type Gradient,
  type SvgPaintCoordinates,
} from "@/lib/editor/gradient";

/** The same paint data powers CSS fills and SVG geometry. */
export function GradientDefs({
  gradient: value,
  id,
  box,
  coordinates = { w: 100, h: 100 },
}: {
  gradient?: Gradient;
  id: string;
  box: { w: number; h: number };
  coordinates?: SvgPaintCoordinates;
}) {
  const gradient = normalizeGradient(value);
  if (!gradient) return null;
  const stops = gradient.stops.map((s) => (
    <stop key={s.id} offset={s.offset} stopColor={stopRgba(s)} />
  ));
  const cx = gradient.cx / 100,
    cy = gradient.cy / 100;
  const { w, h } = coordinates,
    x = coordinates.x || 0,
    y = coordinates.y || 0;
  const vector = gradientVector(gradient.angle, box);
  return (
    <defs>
      {gradient.type === "linear" ? (
        <linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          x1={x + vector.x1 * w}
          y1={y + vector.y1 * h}
          x2={x + vector.x2 * w}
          y2={y + vector.y2 * h}
        >
          {stops}
        </linearGradient>
      ) : (
        <radialGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          cx={0}
          cy={0}
          r={1}
          gradientTransform={`translate(${x + cx * w} ${y + cy * h}) scale(${Math.max(cx, 1 - cx) * Math.SQRT2 * w} ${Math.max(cy, 1 - cy) * Math.SQRT2 * h})`}
        >
          {stops}
        </radialGradient>
      )}
    </defs>
  );
}
