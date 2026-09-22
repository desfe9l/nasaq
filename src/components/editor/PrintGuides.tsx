import { pageSize, type Page } from "@/lib/editor/model";
import {
  CROP_MARK_GAP_MM,
  CROP_MARK_LENGTH_MM,
  DEFAULT_PRINT_GUIDES,
  guideGeometry,
  type PrintGuideSettings,
} from "@/lib/editor/print-guides";

/**
 * Print guides painted over one artboard.
 *
 * Three invisible constraints a printed and bound report has — the safe type
 * area, the binding margin on the RTL side, and the bleed a commercial printer
 * needs — drawn at their true millimetre positions from `guideGeometry`, which
 * is the same source the pre-flight checker measures against. The overlay is
 * therefore a preview of the very numbers the export will complain about, not a
 * second set of assumptions that can drift from them.
 *
 * The SVG spans the bleed box plus the crop-mark margin, so the marks sit
 * outside the sheet exactly as they do on a real imposition; `.report-page` has
 * `overflow: visible`, which is what lets them show.
 */
export function PrintGuides(props: {
  page: Page;
  /** Absent means "all guides off" — the honest default before hydration. */
  settings?: PrintGuideSettings;
  /** Layer to paint at — above the artwork, below the selection chrome. */
  zIndex: number;
}) {
  const { page, zIndex } = props;
  const settings = props.settings ?? DEFAULT_PRINT_GUIDES;
  if (!settings.safe && !settings.gutter && !settings.bleed) return null;
  const size = pageSize(page);
  const geometry = guideGeometry(size, settings);
  const pad = CROP_MARK_GAP_MM + CROP_MARK_LENGTH_MM + 2;
  const w = size.w + pad * 2;
  const h = size.h + pad * 2;

  return (
    <svg
      className="print-guides"
      width={`${w}mm`}
      height={`${h}mm`}
      viewBox={`${-pad} ${-pad} ${w} ${h}`}
      style={{ left: `${-pad}mm`, top: `${-pad}mm`, zIndex }}
      aria-hidden
      focusable="false"
    >
      {settings.bleed && (
        <g className="pg-bleed">
          <rect
            x={geometry.bleed.x}
            y={geometry.bleed.y}
            width={geometry.bleed.w}
            height={geometry.bleed.h}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.2}
          />
          {geometry.cropMarks.map((mark, index) => (
            <rect
              key={index}
              x={mark.x}
              y={mark.y}
              width={mark.w}
              height={mark.h}
              fill="currentColor"
            />
          ))}
        </g>
      )}

      {settings.gutter && (
        <g className="pg-gutter">
          <rect
            x={geometry.gutter.x}
            y={geometry.gutter.y}
            width={geometry.gutter.w}
            height={geometry.gutter.h}
          />
          <line
            x1={geometry.gutter.x}
            y1={0}
            x2={geometry.gutter.x}
            y2={geometry.gutter.h}
            stroke="currentColor"
            strokeWidth={0.25}
            strokeDasharray="2 1.5"
          />
          <text
            x={geometry.gutter.x + geometry.gutter.w / 2}
            y={geometry.gutter.h / 2}
            fontSize={3.2}
            textAnchor="middle"
            transform={`rotate(-90 ${geometry.gutter.x + geometry.gutter.w / 2} ${geometry.gutter.h / 2})`}
          >
            هامش التجليد
          </text>
        </g>
      )}

      {settings.safe && (
        <g className="pg-safe">
          <rect
            x={geometry.safe.x}
            y={geometry.safe.y}
            width={geometry.safe.w}
            height={geometry.safe.h}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.25}
            strokeDasharray="2.5 1.5"
          />
          <text
            x={geometry.safe.x + geometry.safe.w - 2}
            y={geometry.safe.y - 1.6}
            fontSize={3}
            textAnchor="end"
          >
            المنطقة الآمنة
          </text>
        </g>
      )}
    </svg>
  );
}
