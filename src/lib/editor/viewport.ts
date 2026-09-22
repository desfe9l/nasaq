import { useEditor } from "./store";

/*
 * Token guarding the post-render scroll adjustment below: a rapid burst of
 * zoom events queues several adjustments, and only the newest one may touch
 * scroll — an older loop's ratio is stale and would fight the fresh one.
 */
let zoomSeq = 0;

/**
 * Zoom the canvas to `next` while keeping the document point under
 * (`clientX`, `clientY`) stationary on screen.
 *
 * The anchor resolves against the page box under the point (first page when
 * the point is over bare workspace): the artboard scales 1:1 with zoom, so
 * once the re-render lands, scrolling by the delta between where the anchored
 * page offset ended up and where the pointer still is puts the same document
 * point back under it. Measuring after the render — the same way
 * `fitToScreen` recentres — stays exact however the column's centring and
 * stage padding shift with zoom, which a plain "scroll × ratio" prediction is
 * not: it ignores those unscaled offsets and drifts every step.
 */
export function zoomAnchoredAt(
  stage: HTMLElement | null,
  prev: number,
  next: number,
  clientX: number,
  clientY: number,
) {
  if (!stage) return;
  const target = Math.min(2, Math.max(0.2, next));
  if (target === prev) return;
  const pages = Array.from(stage.querySelectorAll<HTMLElement>("[data-page-id]"));
  const page =
    pages.find((p) => {
      const r = p.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    }) || pages[0];
  if (!page || !page.offsetWidth) return;
  const seq = ++zoomSeq;
  useEditor.getState().setZoom(target);
  /*
   * All anchor math runs in RENDERED pixels. The artboard paints at
   * `offsetWidth × renderedZoom`, and during a fast wheel burst the DOM can
   * still show the previous step when this one measures — the store's `prev`
   * is not necessarily what is on screen. Dividing the measured rect by the
   * untransformed `offsetWidth` yields the zoom that is actually painted,
   * keeping the ratio below self-consistent however far the renders lag
   * behind the events.
   */
  const rect = page.getBoundingClientRect();
  const renderedBefore = rect.width / page.offsetWidth;
  // The anchor's offset inside the artboard, in rendered pixels; the same
  // artboard offset at the new zoom is offset × (target / renderedBefore).
  const ax = clientX - rect.left;
  const ay = clientY - rect.top;
  const ratio = target / renderedBefore;
  const land = () => {
    if (seq !== zoomSeq || !page.isConnected || !page.offsetWidth) return;
    const r2 = page.getBoundingClientRect();
    // The re-render has not repainted the new size yet — try the next frame.
    if (Math.abs(r2.width / page.offsetWidth - target) > 0.01) {
      requestAnimationFrame(land);
      return;
    }
    stage.scrollLeft += r2.left + ax * ratio - clientX;
    stage.scrollTop += r2.top + ay * ratio - clientY;
  };
  requestAnimationFrame(land);
}
