/**
 * Template preview images, normalised for ANY reasonable source.
 *
 * The old path took the picked file's `FileReader` data URL verbatim and then
 * rejected it if it happened to exceed a byte budget. That is a size test
 * wearing a dimension test's clothes: a 4000 × 3000 photo from a phone sailed
 * past the "any image" promise and then died on the budget, while a perfectly
 * ordinary 200 × 283 A4 preview passed. The owner's conclusion — "the template
 * preview rejects my image" — was correct; the reason was not the dimensions at
 * all.
 *
 * So dimensions are now handled the way they should be: the browser re-encodes
 * the upload to a longest edge of `TEMPLATE_THUMB_MAX_EDGE`, preserving the
 * aspect ratio exactly, and every surface renders the result with
 * `object-contain` in a flexible box. A 3:4 portrait preview, a 16:9 landscape
 * capture and a square logo all fit the same card untouched, because the card
 * never asserts an aspect ratio of its own.
 *
 * Vector sources keep their own path: an uploaded `.svg` is stored as-is (an
 * `<img>` paints SVG with scripting disabled, and re-rasterising a vector
 * preview would throw away the thing that made it useful).
 */

/** Longest edge a raster preview is re-encoded to, in pixels. */
export const TEMPLATE_THUMB_MAX_EDGE = 1400;
/** Hard ceiling on the stored payload, in characters (server-side limit too). */
export const TEMPLATE_THUMB_MAX_BYTES = 2 * 1024 * 1024;

const RASTER = /^image\/(png|jpe?g|webp|gif|avif)$/i;

/**
 * Normalise one picked file into a storable preview image.
 *
 * Returns the original data URL when no decoder is available (SSR, a locked
 * down browser) — degrading to "store what we were given" beats refusing an
 * image the owner can plainly see on their own screen.
 */
export async function prepareTemplateThumbnail(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
    reader.readAsDataURL(file);
  });
  if (!raw) throw new Error("تعذّر قراءة الصورة");
  // Vectors are kept verbatim; see the module note.
  if (/^image\/svg\+xml$/i.test(file.type)) return raw;
  if (!RASTER.test(file.type) && !/^data:image\//i.test(raw)) {
    throw new Error("صيغة الصورة غير مدعومة — استخدم PNG أو JPG أو WebP أو SVG");
  }
  if (typeof document === "undefined") return raw;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
    el.src = raw;
  });
  const w = img.naturalWidth || 0;
  const h = img.naturalHeight || 0;
  if (!w || !h) throw new Error("تعذّر تحديد مقاس الصورة");
  const scale = Math.min(1, TEMPLATE_THUMB_MAX_EDGE / Math.max(w, h));
  // Already small enough and modestly sized: keep the original bytes (a PNG
  // with transparency must not be flattened by a needless JPEG round-trip).
  if (scale === 1 && raw.length <= TEMPLATE_THUMB_MAX_BYTES) return raw;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // PNG first so an upload with transparency survives; fall back to JPEG when
  // even the downscaled PNG is over the ceiling (a photo-sized preview).
  const png = canvas.toDataURL("image/png");
  if (png.length <= TEMPLATE_THUMB_MAX_BYTES) return png;
  return canvas.toDataURL("image/jpeg", 0.86);
}
