/**
 * Stamp the as-converted geometry onto imported elements.
 *
 * «إصلاح العناصر» needs a ground truth to repair against. That truth is the
 * geometry the conversion itself produced — measured ONCE, at the end of the
 * pipeline, after every scaling pass (dpi maths, the small-page boost, group
 * re-basing). Stamped this late, `source.origin` is exactly what a correct
 * conversion emits; any later divergence is drift the repair engine may
 * conservatively undo.
 *
 * Group children keep group-space coordinates in their origin — the same space
 * the element's own `x/y` lives in — so repairs never need a coordinate-system
 * translation to compare them.
 */

import type { CanvasEl, Project } from "../model.ts";
import { imageSizeFromDataUrl } from "./image-size.ts";

export interface PxResolver {
  /** Intrinsic pixel size for an element's asset, when the importer knows it. */
  (el: CanvasEl): { w: number; h: number } | null;
}

const never: PxResolver = () => null;

/**
 * Stamp `origin` (and best-effort `px`) on every element that carries import
 * provenance. Mutates the project in place — call it on a fresh conversion,
 * before anything can drift.
 *
 * Used by the Office/PDF/raster builder, whose elements are placed once from
 * file geometry and never re-based. The PSD converter instead stamps each
 * element's origin *from the source layer bounds* while converting (groups
 * re-base children, the small-page boost rescales everything — the origin must
 * follow those transforms), and only takes `px` from here.
 */
export function stampImportOrigins(project: Project, pxOf: PxResolver = never): void {
  const walk = (els: CanvasEl[]): void => {
    for (const el of els) {
      if (el.source) {
        el.source.origin = {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          ...(Number.isFinite(el.rotation) ? { rot: el.rotation } : {}),
        };
        const px = pxOf(el);
        if (px && px.w > 0 && px.h > 0 && !el.source.px) el.source.px = px;
      }
      if (el.children?.length) walk(el.children);
    }
  };
  for (const page of project.pages) walk(page.elements);
}

/** Stamp only the intrinsic asset size (px) — origins were set during conversion. */
export function stampAssetPx(project: Project, pxOf: PxResolver): void {
  const walk = (els: CanvasEl[]): void => {
    for (const el of els) {
      if (el.source && !el.source.px) {
        const px = pxOf(el);
        if (px && px.w > 0 && px.h > 0) el.source.px = px;
      }
      if (el.children?.length) walk(el.children);
    }
  };
  for (const page of project.pages) walk(page.elements);
}

/**
 * Intrinsic size of an element's embedded raster, honouring what the importer
 * already knew and falling back to a header-only read of the data URL.
 */
export function intrinsicPxOf(el: CanvasEl): { w: number; h: number } | null {
  if (el.source?.px && el.source.px.w > 0 && el.source.px.h > 0) return el.source.px;
  if (el.type !== "image" && el.type !== "logo") return null;
  return imageSizeFromDataUrl(el.src);
}
