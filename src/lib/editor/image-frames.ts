/**
 * إطارات الصور — the professional image-frame catalogue.
 *
 * A frame is NOT a second element and not a decoration laid on top: it is one
 * property of an ordinary `image` element (`style.frameId`) whose silhouette
 * clips the picture. Everything an author expects from a picture keeps working
 * — replacing the source, cropping and repositioning inside the frame,
 * resizing, rotating, fading, adjusting — and the frame travels with the
 * element through save, `.nsq` export, undo and every export path, because the
 * cut is expressed in fractional `objectBoundingBox` units of the element's own
 * box (the same mechanism the clipping mask uses, see `shape-affine.ts`).
 *
 * Geometry comes from `shapes.ts`, the single shape source shared by the shape
 * tool, the canvas renderer, the public previews and the HTML exporter, so a
 * circle frame is the same circle everywhere.
 */

import { mapShapePart } from "./shape-affine";
import { isCompoundShape, shapeDef, type ShapePart } from "./shapes";
import { placeholderImage, type CanvasEl, type ElStyle } from "./model";

/** Which family a frame belongs to — the gallery groups by it. */
export type ImageFrameGroup =
  | "basic"
  | "geometric"
  | "organic"
  | "editorial";

export const IMAGE_FRAME_GROUPS: {
  id: ImageFrameGroup;
  label: string;
}[] = [
  { id: "basic", label: "أساسية" },
  { id: "geometric", label: "هندسية" },
  { id: "organic", label: "عضوية" },
  { id: "editorial", label: "تحريرية ومؤسسية" },
];

export interface ImageFrameDef {
  /** Stable id written to `style.frameId`. */
  id: string;
  /** Arabic name — a tooltip and an accessible label, never tile text. */
  label: string;
  /** Geometry in `shapes.ts` (a 0–100 box). */
  shapeId: string;
  /** Default insertion box, in millimetres. */
  w: number;
  h: number;
  /** Keep the box proportional while resizing (circle, square, seal…). */
  aspectLock?: boolean;
  group: ImageFrameGroup;
}

/**
 * The gallery, in display order.
 *
 * Sizes are insertion defaults only — every frame can be resized freely
 * afterwards, and the silhouette stretches with its box exactly like a shape.
 */
export const IMAGE_FRAMES: ImageFrameDef[] = [
  // ── أساسية ────────────────────────────────────────────────────────────
  { id: "circle", label: "دائرة", shapeId: "circle", w: 62, h: 62, aspectLock: true, group: "basic" },
  { id: "rounded", label: "مستطيل مستدير", shapeId: "rounded", w: 84, h: 58, group: "basic" },
  { id: "square", label: "مربع", shapeId: "rect", w: 62, h: 62, aspectLock: true, group: "basic" },
  { id: "portrait", label: "مستطيل طولي", shapeId: "rect", w: 56, h: 80, group: "basic" },
  { id: "landscape", label: "مستطيل عرضي", shapeId: "rect", w: 92, h: 56, group: "basic" },
  { id: "oval", label: "بيضاوي", shapeId: "ellipse", w: 84, h: 56, group: "basic" },
  { id: "pill", label: "كبسولة", shapeId: "pill", w: 92, h: 38, group: "basic" },
  { id: "arch", label: "قوس", shapeId: "arch", w: 60, h: 86, group: "basic" },
  { id: "half-round", label: "نصف استدارة", shapeId: "half-round", w: 78, h: 56, group: "basic" },

  // ── هندسية ────────────────────────────────────────────────────────────
  { id: "hexagon", label: "سداسي", shapeId: "hexagon", w: 72, h: 64, group: "geometric" },
  { id: "octagon", label: "ثماني", shapeId: "octagon", w: 66, h: 66, aspectLock: true, group: "geometric" },
  { id: "diamond", label: "معيّن", shapeId: "diamond", w: 64, h: 64, aspectLock: true, group: "geometric" },
  { id: "triangle", label: "مثلث", shapeId: "triangle", w: 76, h: 66, group: "geometric" },
  { id: "trapezoid", label: "شبه منحرف", shapeId: "trapezoid", w: 86, h: 56, group: "geometric" },
  { id: "parallelogram", label: "متوازي أضلاع", shapeId: "parallelogram", w: 86, h: 56, group: "geometric" },
  { id: "chamfer", label: "مستطيل مشطوف", shapeId: "chamfer", w: 82, h: 56, group: "geometric" },
  { id: "squircle", label: "مربع ناعم", shapeId: "squircle", w: 66, h: 66, aspectLock: true, group: "geometric" },

  // ── عضوية ─────────────────────────────────────────────────────────────
  { id: "blob", label: "شكل عضوي", shapeId: "blob", w: 76, h: 70, group: "organic" },
  { id: "blob-leaf", label: "ورقة", shapeId: "blob-leaf", w: 78, h: 62, group: "organic" },
  { id: "blob-pebble", label: "حصاة", shapeId: "blob-pebble", w: 74, h: 66, group: "organic" },
  { id: "eye", label: "لوزة", shapeId: "eye", w: 88, h: 48, group: "organic" },
  { id: "wave", label: "موجة", shapeId: "wave", w: 92, h: 52, group: "organic" },
  { id: "curve-side", label: "قناع منحنٍ", shapeId: "curve-side", w: 82, h: 60, group: "organic" },

  // ── تحريرية ومؤسسية ───────────────────────────────────────────────────
  { id: "shield", label: "درع", shapeId: "shield", w: 62, h: 76, group: "editorial" },
  { id: "seal", label: "ختم مسنّن", shapeId: "seal", w: 66, h: 66, aspectLock: true, group: "editorial" },
  { id: "rub-el-hizb", label: "نجمة ثمانية", shapeId: "rub-el-hizb", w: 68, h: 68, aspectLock: true, group: "editorial" },
  { id: "ticket", label: "تذكرة", shapeId: "ticket", w: 92, h: 50, group: "editorial" },
  { id: "banner", label: "شريط", shapeId: "banner", w: 92, h: 40, group: "editorial" },
];

const BY_ID = new Map(IMAGE_FRAMES.map((frame) => [frame.id, frame]));

/** A frame by id, or null when the id is unknown/absent. */
export function imageFrameDef(id: string | undefined | null): ImageFrameDef | null {
  return BY_ID.get(String(id ?? "")) ?? null;
}

/** True when a value names one of the catalogue frames. */
export function isImageFrameId(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

/**
 * Normalise a stored/imported `style.frameId`.
 *
 * Unknown ids (a file from a newer build, a hand edit) resolve to `undefined`,
 * which means "plain rectangle" — a picture is never swallowed by a frame the
 * renderer does not have.
 */
export function normalizeFrameId(value: unknown): string | undefined {
  return isImageFrameId(value) ? value : undefined;
}

/** The frame an element's style asks for, or null. */
export function frameOfStyle(style: Pick<ElStyle, "frameId"> | undefined): ImageFrameDef | null {
  return imageFrameDef(normalizeFrameId(style?.frameId));
}

/** Frames whose silhouette is the plain box — no clip needed for those. */
const BOX_FRAMES = new Set(["square", "portrait", "landscape"]);

/** True when this frame needs a real clip path (a plain box needs none). */
export function frameNeedsClip(frame: ImageFrameDef | null): boolean {
  return Boolean(frame) && !BOX_FRAMES.has(frame!.id);
}

/**
 * Frame geometry in fractional `objectBoundingBox` units (0–1).
 *
 * `shapes.ts` works in a 0–100 box; dividing by 100 per axis places the same
 * silhouette inside the element's own box, so the frame stretches with the
 * picture and survives rotation, resizing and export unchanged.
 */
export function frameClipParts(frameId: string | undefined): ShapePart[] | null {
  const frame = imageFrameDef(frameId);
  if (!frame || !frameNeedsClip(frame)) return null;
  const def = shapeDef(frame.shapeId);
  const unit = { sx: 0.01, sy: 0.01, tx: 0, ty: 0 };
  return def.parts.map((part) => {
    const mapped = mapShapePart(part, unit);
    /*
     * A `circle` in objectBoundingBox units is scaled by the box diagonal, not
     * by width and height, so on a non-square picture it would not meet the
     * edges. An ellipse with equal radii is the same silhouette expressed in
     * the units the clip actually uses.
     */
    if (mapped.k === "circle") {
      return { k: "ellipse", cx: mapped.cx, cy: mapped.cy, rx: mapped.r, ry: mapped.r };
    }
    return mapped;
  });
}

/** `fill-rule` for frames whose parts overlap (a union, cut with evenodd). */
export function frameFillRule(frameId: string | undefined): "evenodd" | undefined {
  const frame = imageFrameDef(frameId);
  if (!frame) return undefined;
  return isCompoundShape(frame.shapeId) ? "evenodd" : undefined;
}

/**
 * The picture a fresh frame holds until the author replaces it.
 *
 * Insertion must be immediate — one click puts a framed image on the page — so
 * the element arrives with a neutral placeholder instead of an empty box: the
 * frame is visible at once, and «استبدال الصورة» (or dropping a file on it)
 * swaps in the real photograph while keeping the frame, the box and the crop
 * behaviour.
 */
export const FRAME_PLACEHOLDER_SRC = placeholderImage("image");

/**
 * Insertion overrides for one frame.
 *
 * Returned as a plain partial element so the store's single insertion funnel
 * (`addElementAt`) keeps owning placement, z-order, history and the toast — a
 * frame never invents its own way onto the page.
 */
export function framedImageOverrides(
  frameId: string,
): (Partial<CanvasEl> & { style: Partial<ElStyle> }) | null {
  const frame = imageFrameDef(frameId);
  if (!frame) return null;
  return {
    name: `صورة ${frame.label}`,
    w: frame.w,
    h: frame.h,
    src: FRAME_PLACEHOLDER_SRC,
    style: {
      frameId: frame.id,
      objectFit: "cover",
      objectX: 50,
      objectY: 50,
      radius: 0,
      aspectLock: frame.aspectLock === true,
    },
  };
}

/** Frames of one group, in catalogue order. */
export function imageFramesByGroup(group: ImageFrameGroup): ImageFrameDef[] {
  return IMAGE_FRAMES.filter((frame) => frame.group === group);
}
