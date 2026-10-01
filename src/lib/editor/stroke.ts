import type { CanvasEl } from "./model";
import { mmToPx, pxToMm } from "./render-units";

/** The document is metric; icons/imported SVGs retain their native viewBox units.
 * Convert only at the inspector boundary, never change saved artwork units. */
export function strokeBinding(el: CanvasEl): {
  key: "stroke" | "borderWidth" | "svgStrokeWidth";
  pxPerUnit: number;
  fallback: number;
} | null {
  switch (el.type) {
    case "image":
    case "logo":
    case "stat":
    case "shape":
      return { key: "borderWidth", pxPerUnit: mmToPx(1), fallback: 0 };
    case "box":
      return { key: "borderWidth", pxPerUnit: mmToPx(1), fallback: 0.35 };
    case "table":
      return { key: "borderWidth", pxPerUnit: mmToPx(1), fallback: 0.3 };
    case "line":
      return { key: "stroke", pxPerUnit: mmToPx(1), fallback: 0.8 };
    case "divider":
      return { key: "stroke", pxPerUnit: mmToPx(1), fallback: 0.5 };
    case "icon":
      return {
        key: "stroke",
        pxPerUnit: mmToPx(Math.min(el.w, el.h)) / 24,
        fallback: 1.8,
      };
    case "svg": {
      const match = el.content?.match(
        /viewBox\s*=\s*["']\s*([-\d.e+]+)[ ,]+([-\d.e+]+)[ ,]+([\d.e+]+)[ ,]+([\d.e+]+)\s*["']/i,
      );
      if (!match || !(Number(match[3]) > 0) || !(Number(match[4]) > 0))
        return null;
      return {
        key: "svgStrokeWidth",
        pxPerUnit: Math.min(
          mmToPx(el.w) / Number(match[3]),
          mmToPx(el.h) / Number(match[4]),
        ),
        fallback: 1.8,
      };
    }
    default:
      return null;
  }
}

export function strokePixels(el: CanvasEl): number | undefined {
  const binding = strokeBinding(el);
  if (!binding) return undefined;
  // SVG without an override can contain several different native stroke widths.
  if (el.type === "svg" && el.style.svgStrokeWidth == null) return undefined;
  return Number(
    ((el.style[binding.key] ?? binding.fallback) * binding.pxPerUnit).toFixed(
      2,
    ),
  );
}

export function strokePatch(
  el: CanvasEl,
  pixels: number,
): CanvasEl["style"] | null {
  const binding = strokeBinding(el);
  if (!binding || !Number.isFinite(pixels) || !(binding.pxPerUnit > 0))
    return null;
  const px = Math.min(50, Math.max(0, pixels));
  return {
    [binding.key]:
      binding.pxPerUnit === mmToPx(1) ? pxToMm(px) : px / binding.pxPerUnit,
  };
}
