/**
 * MaskRenderer — visual application of raster and vector layer masks.
 *
 * Renders the element's content clipped/masked by a LayerMask definition.
 * Raster masks use CSS `mask-image`; vector masks use an SVG `<mask>`
 * referenced via CSS `mask`. Supports inversion, opacity, positioning,
 * and sizing per the mask definition.
 */

import { useMemo, useState } from "react";
import { type LayerMask } from "@/lib/editor/model";

interface MaskRendererProps {
  mask: LayerMask;
  box: { w: number; h: number };
  children: React.ReactNode;
}

export function MaskRenderer({
  mask,
  box,
  children,
}: MaskRendererProps): React.ReactNode {
  const { disabled } = mask;
  if (disabled) return children;

  const [maskId] = useState(() => `vector-mask-${crypto.randomUUID()}`);
  const { kind, dataUrl, pathData, opacity, inverted, x, y, w, h } = mask;

  /* Build the mask CSS. */
  let maskImage: string | undefined;
  let maskSize: string | undefined;
  let maskRepeat: string | undefined;
  let maskPosition: string | undefined;

  if (kind === "raster" && dataUrl) {
    maskImage = `url(${dataUrl})`;
    maskSize = "contain";
    maskRepeat = "no-repeat";
    maskPosition = "center";
  } else if (kind === "vector" && pathData) {
    /* Vector mask: inline SVG <mask> referenced via data URL. */
    const svgMarkup = `
      <svg width="0" height="0" style="display:none">
        <mask id="${maskId}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">
          <rect width="${box.w}" height="${box.h}" fill="white" />
          <path d="${pathData}" fill="${inverted ? "black" : "white"}" />
        </mask>
      </svg>
    `;
    maskImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}#${maskId}")`;
    maskSize = "100% 100%";
    maskRepeat = "no-repeat";
    maskPosition = "0 0";
  }

  const style: React.CSSProperties = {
    WebkitMaskImage: maskImage,
    maskImage,
    WebkitMaskSize: maskSize,
    maskSize,
    WebkitMaskRepeat: maskRepeat,
    maskRepeat,
    WebkitMaskPosition: maskPosition,
    maskPosition,
    opacity,
  };

  return (
    <div
      className="absolute inset-0 h-full w-full pointer-events-none"
      style={style}
      aria-hidden
      data-mask-kind={kind}
      data-mask-inverted={inverted ? "true" : undefined}
    >
      {children}
    </div>
  );
}
