export interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** Clamp the whole panel, not just its grab handle. Physical pixels are RTL-neutral. */
export function clampPanel(
  rect: PanelRect,
  viewport: { width: number; height: number },
  top = 8,
): PanelRect {
  const margin = 8;
  const minTop = Math.min(top, Math.max(margin, viewport.height - 80));
  const width = Math.min(
    Math.max(240, rect.width),
    Math.max(0, viewport.width - margin * 2),
  );
  const height = Math.min(
    Math.max(80, rect.height),
    Math.max(0, viewport.height - minTop - margin),
  );
  return {
    width,
    height,
    left: Math.max(
      margin,
      Math.min(rect.left, viewport.width - width - margin),
    ),
    top: Math.max(
      minTop,
      Math.min(rect.top, viewport.height - height - margin),
    ),
  };
}
