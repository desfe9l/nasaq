/**
 * تمويه الطبقة — layer blur.
 *
 * A pure codec between the properties panel's numeric control (millimetres,
 * the document's own unit) and the single CSS `filter: blur()` the canvas
 * paints and every raster export captures. The value is deliberately NOT a
 * free-form CSS string the way `style.shadow` is: a blur is one number, so it
 * gets one clamp, one renderer and one export path — canvas, PDF, PNG and the
 * office fidelity rasteriser all read this module.
 *
 * Imported Photoshop smart filters (Gaussian/Box/Surface blur) arrive as
 * millimetres through `psd/parse.ts`, which converts the filter radius with
 * the document DPI — the same conversion every other PSD measurement uses.
 */

/** Ceiling in millimetres. Beyond this a 210 mm page turns into fog. */
export const MAX_BLUR_MM = 25;

/** Clamp any incoming value to a finite, in-range blur radius in mm. */
export function normalizeBlurMm(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_BLUR_MM, Math.round(n * 100) / 100);
}

/**
 * The CSS filter for an element's blur, or `undefined` when there is nothing
 * to paint — so an element without a blur never grows a filter layer (and the
 * DOM stays identical to a document authored before blur existed).
 */
export function blurFilterCss(value: unknown): string | undefined {
  const mm = normalizeBlurMm(value);
  return mm > 0 ? `blur(${mm}mm)` : undefined;
}

/**
 * Compose the layer blur with an element's own paint filters (image
 * adjustments, sharpening) into one `filter` declaration. Order is
 * significant: the author's clarity/brightness corrections apply to the
 * picture first, then the layer blur softens the corrected result — the same
 * order Photoshop applies a smart filter on top of an adjusted layer.
 */
export function withLayerBlur(
  existing: string | undefined,
  value: unknown,
): string | undefined {
  const blur = blurFilterCss(value);
  if (!blur) return existing;
  return existing ? `${existing} ${blur}` : blur;
}
