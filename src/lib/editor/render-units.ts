/** Layout units are always CSS pixels at 96 DPI. Raster scale only adds samples. */
export const CSS_DPI = 96;
export const PX_PER_MM = CSS_DPI / 25.4;
export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const mmToEmu = (mm: number) => Math.round(mm * 36000);
export const mmToInches = (mm: number) => mm / 25.4;

/** PowerPoint has ONE size per presentation, not one size per slide. */
export function assertUniformSlideSize(pages: { w: number; h: number }[]) {
  const first = pages[0];
  if (first && pages.some((p) => p.w !== first.w || p.h !== first.h)) {
    throw new Error(
      "PowerPoint لا يدعم مقاسات مختلفة داخل العرض نفسه. صدّر الصفحات ذات المقاس نفسه معًا.",
    );
  }
}
