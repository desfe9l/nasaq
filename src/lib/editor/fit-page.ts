/**
 * «ملاءمة الصفحة» — size an element to the page it sits on.
 *
 * Two intents, both common with a dropped photo or an imported design:
 *   • `fill`  — cover the WHOLE sheet (full bleed); the box becomes the page
 *               rectangle itself. For images the raster keeps its proportions
 *               through `objectFit: cover`, so nothing stretches.
 *   • `fit`   — the largest size that keeps the element's own proportions
 *               INSIDE the page, centred — the design scales up (or down) to
 *               the sheet without leaving its edges.
 *
 * Pure geometry, millimetres in and out, so the Node test runner can pin it.
 */
export type FitPageMode = "fill" | "fit";

export interface BoxMm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fitBoxToPage(
  box: { w: number; h: number },
  page: { w: number; h: number },
  mode: FitPageMode,
): BoxMm {
  const pw = Math.max(1, Number(page.w) || 1);
  const ph = Math.max(1, Number(page.h) || 1);
  if (mode === "fill") return { x: 0, y: 0, w: pw, h: ph };
  const bw = Math.max(0.01, Number(box.w) || 0.01);
  const bh = Math.max(0.01, Number(box.h) || 0.01);
  const scale = Math.min(pw / bw, ph / bh);
  const w = round(bw * scale);
  const h = round(bh * scale);
  return { x: round((pw - w) / 2), y: round((ph - h) / 2), w, h };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
