/**
 * Page-1 thumbnail for the projects grid.
 *
 * Captured from the same offscreen export DOM the PDF/HTML exporters use, so
 * the little card preview matches what «تصدير» would print. A JPEG at
 * `image/jpeg` 0.5 keeps a page under ~30 KB — a data URL small enough to live
 * in every project row without bloating IndexedDB, and light enough for the
 * grid to lazy-load dozens at once.
 *
 * Captures are throttled: auto-save fires ~1s after every edit burst, and a
 * full html2canvas raster of an A4 page is too expensive to run that often.
 * Within the throttle window we return `null` and the caller keeps the row's
 * existing thumbnail untouched.
 */

const MIN_INTERVAL_MS = 8_000;
let lastCaptureAt = 0;
let inflight: Promise<string | null> | null = null;

/** Max pixel width of the generated thumbnail (A4 scales from here). */
const THUMB_WIDTH = 360;

export async function captureThumbnail(): Promise<string | null> {
  // Never stack captures: a save that lands mid-raster re-uses its result.
  if (inflight) return inflight;
  if (Date.now() - lastCaptureAt < MIN_INTERVAL_MS) return null;

  inflight = (async () => {
    try {
      const page = document.querySelector<HTMLElement>(
        "#export-root [data-export-page]",
      );
      if (!page || !page.offsetWidth || !page.offsetHeight) return null;

      lastCaptureAt = Date.now();
      const html2canvas = (await import("html2canvas")).default;
      const scale = THUMB_WIDTH / Math.max(1, page.offsetWidth);
      const canvas = await html2canvas(page, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        width: page.offsetWidth,
        height: page.offsetHeight,
        windowWidth: page.offsetWidth,
        windowHeight: page.offsetHeight,
      });
      return canvas.toDataURL("image/jpeg", 0.5);
    } catch (err) {
      console.warn("[editor] thumbnail capture failed", err);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
