/** Document geometry is millimetres. View geometry is CSS pixels, never model data. */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 16;
export const clampZoom = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(value) ? value : 1));
export const stepZoom = (zoom: number, direction: 1 | -1) =>
  clampZoom(zoom * (direction > 0 ? 1.2 : 1 / 1.2));

export interface RectMm {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface DocumentSize {
  w: number;
  h: number;
}

/** Invert the ACTUALLY painted artboard, including zoom, pan and layout offsets. */
export function screenToDocument(
  rect: ScreenRect,
  size: DocumentSize,
  clientX: number,
  clientY: number,
) {
  return {
    x: rect.width > 0 ? ((clientX - rect.left) * size.w) / rect.width : 0,
    y: rect.height > 0 ? ((clientY - rect.top) * size.h) / rect.height : 0,
  };
}

export function visibleDocumentRect(
  page: ScreenRect,
  viewport: ScreenRect,
  size: DocumentSize,
): RectMm | null {
  const start = screenToDocument(
    page,
    size,
    Math.max(page.left, viewport.left),
    Math.max(page.top, viewport.top),
  );
  const end = screenToDocument(
    page,
    size,
    Math.min(page.left + page.width, viewport.left + viewport.width),
    Math.min(page.top + page.height, viewport.top + viewport.height),
  );
  if (end.x <= start.x || end.y <= start.y) return null;
  return { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
}

/** Drop centres are literal; only palette clicks use a visible-page centre. */
export function insertionPosition(
  box: DocumentSize,
  center: { x: number; y: number },
) {
  return { x: center.x - box.w / 2, y: center.y - box.h / 2 };
}
