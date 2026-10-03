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

/** Smallest croppable region, in mm. Below this the crop is refused rather
 *  than producing a one-pixel sliver nobody asked for. */
export const MIN_CROP_MM = 0.5;

export interface CropPlan {
  /** Region in the element's own (unrotated, unflipped) mm frame. */
  box: RectMm;
  /** Non-destructive source window to store on the element. */
  crop: ImageCrop;
  /** The element's new page-space frame; the visual centre is preserved. */
  frame: RectMm;
}

/**
 * Turn "a region on the page" into a crop for one image element.
 *
 * This is the shared maths behind BOTH crop entry points: the Crop tool's drag
 * and «قص التحديد» from a marquee. It is deliberately defensive, because the
 * region comes from a user's hand:
 *
 *  · the region is mapped through the element's real affine transform, so a
 *    rotated, flipped or grouped image crops where the author drew;
 *  · it is then intersected with the part of the artwork actually visible in
 *    the frame — a region hanging off the edge crops the visible overlap
 *    instead of stretching or blanking the bitmap;
 *  · an empty or sub-pixel overlap returns null, so the caller can refuse
 *    cleanly and the document never receives a corrupt crop.
 */
export function planRegionCrop(args: {
  el: { x: number; y: number; w: number; h: number; rotation?: number };
  source: { w: number; h: number };
  crop?: ImageCrop;
  fit?: "cover" | "contain" | "fill";
  objectX?: number;
  objectY?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Region in page mm. */
  region: RectMm;
  transform: CropTransform;
}): CropPlan | null {
  const { el, source, transform, region } = args;
  if (source.w <= 0 || source.h <= 0) return null;
  // All four corners: the region is a page-axis-aligned rectangle, so once it is
  // mapped into a rotated element's frame it is a rotated quad and its extent is
  // only correct when every corner is considered — two opposite corners would
  // crop away part of what the author selected.
  const corners = [
    { x: region.x, y: region.y },
    { x: region.x + region.w, y: region.y },
    { x: region.x, y: region.y + region.h },
    { x: region.x + region.w, y: region.y + region.h },
  ].map((corner) => cropLocalPoint(transform, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const local: RectMm = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
  const layout = imageLayout(
    el,
    source,
    args.crop,
    args.fit || "cover",
    args.objectX,
    args.objectY,
  );
  // Visible artwork = the placed source window ∩ the element frame.
  const visible: RectMm = {
    x: Math.max(0, layout.x),
    y: Math.max(0, layout.y),
    w: Math.min(el.w, layout.x + layout.w) - Math.max(0, layout.x),
    h: Math.min(el.h, layout.y + layout.h) - Math.max(0, layout.y),
  };
  if (visible.w <= 0 || visible.h <= 0) return null;
  const left = Math.max(local.x, visible.x);
  const top = Math.max(local.y, visible.y);
  const right = Math.min(local.x + local.w, visible.x + visible.w);
  const bottom = Math.min(local.y + local.h, visible.y + visible.h);
  if (right - left < MIN_CROP_MM || bottom - top < MIN_CROP_MM) return null;
  const box: RectMm = { x: left, y: top, w: right - left, h: bottom - top };
  const crop = cropFromLocalBox(box, layout);
  const frame = croppedFrame(
    { ...el, rotation: el.rotation || 0 },
    box,
    args.flipX,
    args.flipY,
  );
  return { box, crop, frame };
}
