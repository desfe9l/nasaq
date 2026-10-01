import type { CanvasEl } from "./model";
import type { RectMm } from "./document-space";

/** Non-destructive crop, in decoded source pixels (never screen coordinates). */
export interface ImageCrop {
  sourceW: number;
  sourceH: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export function normalizeCrop(value: unknown): ImageCrop | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as ImageCrop;
  if (
    ![v.sourceW, v.sourceH, v.x, v.y, v.w, v.h].every(Number.isFinite) ||
    v.sourceW <= 0 ||
    v.sourceH <= 0 ||
    v.w <= 0 ||
    v.h <= 0
  )
    return undefined;
  const x = Math.min(v.sourceW - 0.01, Math.max(0, v.x));
  const y = Math.min(v.sourceH - 0.01, Math.max(0, v.y));
  return {
    sourceW: v.sourceW,
    sourceH: v.sourceH,
    x,
    y,
    w: Math.min(v.sourceW - x, v.w),
    h: Math.min(v.sourceH - y, v.h),
  };
}

/** Placement of the chosen source window inside the element's local frame. */
export function imageLayout(
  frame: { w: number; h: number },
  source: { w: number; h: number },
  crop?: ImageCrop,
  fit: "cover" | "contain" | "fill" = "cover",
  posX = 50,
  posY = 50,
) {
  const window = normalizeCrop(crop) || {
    sourceW: source.w,
    sourceH: source.h,
    x: 0,
    y: 0,
    w: source.w,
    h: source.h,
  };
  const sx = frame.w / window.w,
    sy = frame.h / window.h;
  const scale = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const scaleX = fit === "fill" ? sx : scale,
    scaleY = fit === "fill" ? sy : scale;
  const w = window.w * scaleX,
    h = window.h * scaleY;
  const x = ((frame.w - w) * posX) / 100,
    y = ((frame.h - h) * posY) / 100;
  return { window, x, y, w, h, scaleX, scaleY };
}

export function cropFromLocalBox(
  box: RectMm,
  layout: ReturnType<typeof imageLayout>,
): ImageCrop {
  const { window, x, y, scaleX, scaleY } = layout;
  return normalizeCrop({
    ...window,
    x: window.x + (box.x - x) / scaleX,
    y: window.y + (box.y - y) / scaleY,
    w: box.w / scaleX,
    h: box.h / scaleY,
  })!;
}

/** Keep the visual crop centre fixed, even when the artwork is rotated/flipped. */
export function croppedFrame(
  frame: RectMm & { rotation: number },
  box: RectMm,
  flipX = false,
  flipY = false,
): RectMm {
  const dx = (box.x + box.w / 2 - frame.w / 2) * (flipX ? -1 : 1);
  const dy = (box.y + box.h / 2 - frame.h / 2) * (flipY ? -1 : 1);
  const radians = (frame.rotation * Math.PI) / 180;
  const cx =
    frame.x + frame.w / 2 + dx * Math.cos(radians) - dy * Math.sin(radians);
  const cy =
    frame.y + frame.h / 2 + dx * Math.sin(radians) + dy * Math.cos(radians);
  return { x: cx - box.w / 2, y: cy - box.h / 2, w: box.w, h: box.h };
}

/** Image-local → page affine map. Crop handles must follow every rotated/flipped
 * ancestor, not just the leaf's additive XY or its axis-aligned bounding box. */
export interface CropTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
const IDENTITY: CropTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export function imageCropTransform(
  elements: CanvasEl[],
  id: string,
  parent = IDENTITY,
  isolatedGroup?: string | null,
): CropTransform | undefined {
  for (const el of elements) {
    const isolated = el.id === isolatedGroup;
    const angle = ((isolated ? 0 : el.rotation || 0) * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    const a = cos * (!isolated && el.style.flipX ? -1 : 1),
      b = sin * (!isolated && el.style.flipX ? -1 : 1);
    const c = -sin * (!isolated && el.style.flipY ? -1 : 1),
      d = cos * (!isolated && el.style.flipY ? -1 : 1);
    const e = el.x + el.w / 2 - (a * el.w) / 2 - (c * el.h) / 2;
    const f = el.y + el.h / 2 - (b * el.w) / 2 - (d * el.h) / 2;
    const matrix: CropTransform = {
      a: parent.a * a + parent.c * b,
      b: parent.b * a + parent.d * b,
      c: parent.a * c + parent.c * d,
      d: parent.b * c + parent.d * d,
      e: parent.a * e + parent.c * f + parent.e,
      f: parent.b * e + parent.d * f + parent.f,
    };
    if (el.id === id) return matrix;
    if (el.children?.length) {
      const hit = imageCropTransform(el.children, id, matrix, isolatedGroup);
      if (hit) return hit;
    }
  }
}
export function cropPagePoint(
  matrix: CropTransform,
  point: { x: number; y: number },
) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}
export function cropLocalPoint(
  matrix: CropTransform,
  point: { x: number; y: number },
) {
  const det = matrix.a * matrix.d - matrix.b * matrix.c,
    x = point.x - matrix.e,
    y = point.y - matrix.f;
  return {
    x: (matrix.d * x - matrix.c * y) / det,
    y: (-matrix.b * x + matrix.a * y) / det,
  };
}

export function sameCropTransform(
  actual: CropTransform | undefined,
  expected: CropTransform,
) {
  return (
    !!actual &&
    (["a", "b", "c", "d", "e", "f"] as const).every(
      (key) => Math.abs(actual[key] - expected[key]) < 1e-8,
    )
  );
}

/** Existing group-enter mode renders root-group children in its unrotated
 * page-space editing frame. Match that scene without changing the saved group. */
export function cropSceneTransform(
  elements: CanvasEl[],
  id: string,
  enteredGroup: string | null,
) {
  const isolated = elements.some((el) => el.id === enteredGroup)
    ? enteredGroup
    : undefined;
  return imageCropTransform(elements, id, IDENTITY, isolated);
}
