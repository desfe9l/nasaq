import { toast } from "sonner";
import { findElement, type CanvasEl, type Page } from "./model";
import {
  imageLayout,
  cropFromLocalBox,
  croppedFrame,
  cropSceneTransform,
  cropLocalPoint,
  planRegionCrop,
  sameCropTransform,
} from "./image-crop";
import type { RectMm } from "./document-space";
import type { SelectionRegion } from "./marquee";
import { useEditor } from "./store";
import { useInteraction } from "./interaction-store";
import { useTools } from "./tool-store";
import { isRasterElement } from "./tools";
import { loadRasterSource } from "./raster-session";

/**
 * Crop entry points — all of them non-destructive and undoable.
 *
 * Crop stores a source window on the element (`style.crop`) instead of
 * rewriting the bitmap, so the original pixels are never lost, quality is
 * whatever the source had, and one Undo restores the previous framing. The
 * only place pixels are re-encoded is «استخراج التحديد», and there the bytes go
 * into a NEW element while the original stays untouched.
 */

const activePage = (pages: Page[], id: string) =>
  pages.find((page) => page.id === id);

function rasterElements(page: Page, enteredGroupId: string | null): CanvasEl[] {
  const entered = enteredGroupId
    ? findElement(page.elements, enteredGroupId)?.el
    : null;
  if (entered?.children?.length)
    return entered.children.filter((el) => isRasterElement(el));
  return page.elements.filter((el) => isRasterElement(el));
}

/**
 * The image a region refers to: the selected one when it intersects, otherwise
 * the topmost artwork under the region. Returns null when the region misses
 * every image, which is what makes "crop" safe on empty space.
 */
export function rasterTargetForRegion(
  page: Page,
  region: SelectionRegion,
  enteredGroupId: string | null,
  selectedIds: string[],
): CanvasEl | null {
  const candidates = rasterElements(page, enteredGroupId).filter((el) => !el.hidden);
  const intersects = (el: CanvasEl) =>
    region.box.x < el.x + el.w &&
    region.box.x + region.box.w > el.x &&
    region.box.y < el.y + el.h &&
    region.box.y + region.box.h > el.y;
  // Absolute boxes only: an entered-group child is offset by its parent.
  const entered = enteredGroupId
    ? findElement(page.elements, enteredGroupId)?.el
    : null;
  const absolute = (el: CanvasEl): CanvasEl =>
    entered?.children?.includes(el)
      ? { ...el, x: el.x + entered.x, y: el.y + entered.y }
      : el;
  const hit = candidates.find(
    (el) => selectedIds.includes(el.id) && intersects(absolute(el)),
  );
  if (hit) return hit;
  return (
    [...candidates]
      .sort((a, b) => b.z - a.z)
      .find((el) => intersects(absolute(el))) ?? null
  );
}

/** The rendered `<img>` for an element — already decoded, so no extra fetch. */
function elementImage(pageId: string, elementId: string) {
  return document.querySelector<HTMLImageElement>(
    `.editor-canvas-stage [data-page-id="${CSS.escape(pageId)}"] .canvas-el[data-el-id="${CSS.escape(elementId)}"] img`,
  );
}

export function beginImageCrop(
  elementId: string,
  mode: "crop" | "pan" = "crop",
) {
  if (useInteraction.getState().active || typeof window === "undefined") return;
  // Finish live property edits before capturing the immutable crop source.
  window.dispatchEvent(new Event("nasaq:selection-ui-reset"));
  const state = useEditor.getState();
  const page = state.pages.find((p) => p.id === state.activePageId);
  const el = page && findElement(page.elements, elementId)?.el;
  if (
    !page ||
    page.locked ||
    !el ||
    el.locked ||
    !["image", "logo"].includes(el.type)
  )
    return;
  if (
    mode === "crop" &&
    (el.resizeLocked || el.widthLocked || el.heightLocked)
  ) {
    toast.message("فك قفل أبعاد الصورة قبل تغيير إطار القص");
    return;
  }
  const img = elementImage(page.id, elementId);
  const source = {
    w: el.style.crop?.sourceW || img?.naturalWidth || 0,
    h: el.style.crop?.sourceH || img?.naturalHeight || 0,
  };
  if (!source.w || !source.h) {
    toast.message("انتظر اكتمال تحميل الصورة قبل القص");
    return;
  }
  const layout = imageLayout(
    el,
    source,
    el.style.crop,
    el.style.objectFit || (el.type === "logo" ? "contain" : "cover"),
    el.style.objectX,
    el.style.objectY,
  );
  const x = Math.max(0, layout.x),
    y = Math.max(0, layout.y);
  const bounds = {
    x,
    y,
    w: Math.min(el.w, layout.x + layout.w) - x,
    h: Math.min(el.h, layout.y + layout.h) - y,
  };
  const transform = cropSceneTransform(
    page.elements,
    el.id,
    state.enteredGroupId,
  );
  if (!transform) return;
  state.select(el.id);
  state.setEditing(null);
  useInteraction.getState().beginCrop({
    pageId: page.id,
    original: el,
    transform,
    enteredGroupId: state.enteredGroupId,
    source,
    bounds,
    box: { ...bounds },
    mode,
  });
}

/**
 * «تحريك الصورة داخل الإطار» — the same session as a crop, but the source
 * window keeps its size: dragging moves the picture inside a FIXED frame.
 * Dimension locks never block it, because the frame never changes; a frame
 * (mask) or shape applied to the element keeps clipping exactly as before.
 */
export function beginImageReposition(elementId: string) {
  beginImageCrop(elementId, "pan");
}

/**
 * The Crop tool's gesture: start a crop session whose window is exactly the
 * region the author just dragged.
 *
 * The box is converted through the element's affine map and clamped to the
 * visible artwork, so dragging across a rotated image (or past its edge) opens
 * a valid, editable crop frame rather than an out-of-range one.
 */
export function beginImageCropToBox(elementId: string, region: RectMm) {
  const state = useEditor.getState();
  const page = state.pages.find((p) => p.id === state.activePageId);
  const el = page && findElement(page.elements, elementId)?.el;
  if (!page || !el) return false;
  const transform = cropSceneTransform(
    page.elements,
    el.id,
    state.enteredGroupId,
  );
  if (!transform) return false;
  beginImageCrop(elementId);
  const session = useInteraction.getState().crop;
  if (!session || session.original.id !== elementId) return false;
  const a = cropLocalPoint(transform, { x: region.x, y: region.y });
  const b = cropLocalPoint(transform, {
    x: region.x + region.w,
    y: region.y + region.h,
  });
  const bounds = session.bounds;
  const clamp = (value: number, low: number, high: number) =>
    Math.max(low, Math.min(high, value));
  const left = clamp(Math.min(a.x, b.x), bounds.x, bounds.x + bounds.w);
  const top = clamp(Math.min(a.y, b.y), bounds.y, bounds.y + bounds.h);
  const right = clamp(Math.max(a.x, b.x), bounds.x, bounds.x + bounds.w);
  const bottom = clamp(Math.max(a.y, b.y), bounds.y, bounds.y + bounds.h);
  const box: RectMm = {
    x: left,
    y: top,
    w: Math.max(2, right - left),
    h: Math.max(2, bottom - top),
  };
  useInteraction.getState().setCropBox(box);
  return true;
}

export function applyImageCrop() {
  const session = useInteraction.getState().crop;
  if (!session) return;
  const { original: el, source, box, pageId } = session;
  /*
   * «تحريك داخل الإطار»: the window keeps its size and the element keeps its
   * frame — only the source window slides. The mask, the scale and every lock
   * on the geometry stay exactly as the author left them.
   */
  if (session.mode === "pan") {
    const state0 = useEditor.getState();
    const page0 = state0.pages.find((p) => p.id === pageId);
    if (
      !page0 ||
      page0.locked ||
      state0.activePageId !== pageId ||
      state0.selectedId !== el.id ||
      state0.enteredGroupId !== session.enteredGroupId ||
      findElement(page0.elements, el.id)?.el !== el
    ) {
      cancelImageCrop();
      return;
    }
    const layout0 = imageLayout(
      el,
      source,
      el.style.crop,
      el.style.objectFit || (el.type === "logo" ? "contain" : "cover"),
      el.style.objectX,
      el.style.objectY,
    );
    const crop = cropFromLocalBox(box, layout0);
    useInteraction.getState().endCrop();
    state0.updateElement(el.id, { style: { ...el.style, crop } });
    useTools.getState().armSelect("off");
    toast.success("تم تحريك الصورة داخل إطارها", { duration: 1500 });
    return;
  }
  const state = useEditor.getState();
  const page = state.pages.find((p) => p.id === pageId);
  // A source, selection or ancestor-transform change invalidates the draft.
  if (
    !page ||
    page.locked ||
    state.activePageId !== pageId ||
    state.selectedId !== el.id ||
    state.enteredGroupId !== session.enteredGroupId ||
    findElement(page.elements, el.id)?.el !== el ||
    !sameCropTransform(
      cropSceneTransform(page.elements, el.id, state.enteredGroupId),
      session.transform,
    )
  ) {
    cancelImageCrop();
    return;
  }
  const layout = imageLayout(
    el,
    source,
    el.style.crop,
    el.style.objectFit || (el.type === "logo" ? "contain" : "cover"),
    el.style.objectX,
    el.style.objectY,
  );
  const crop = cropFromLocalBox(box, layout);
  const frame = croppedFrame(el, box, el.style.flipX, el.style.flipY);
  useInteraction.getState().endCrop();
  state.updateElement(el.id, {
    ...frame,
    style: { ...el.style, crop, objectX: 50, objectY: 50 },
  });
  // The crop operation is over — the interface returns to its normal state:
  // no region, no armed shape, no ephemeral controls anywhere on screen.
  useTools.getState().armSelect("off");
}

/**
 * Cancel a live crop frame. The frame and the draft region it came from end
 * together — one Escape never leaves an orphaned selection behind — but the
 * armed region mode stays, so an immediate re-drag redraws the same shape.
 */
export function cancelImageCrop() {
  useInteraction.getState().endCrop();
  useTools.getState().setRegion(null);
}

/**
 * «قص التحديد» — crop the image under the current marquee region, in one
 * undoable write, without destroying a single source pixel.
 */
export async function cropSelectionToImage(region?: SelectionRegion | null) {
  const active = region ?? useTools.getState().region;
  if (!active) {
    toast.message("اسحب منطقة على الصورة أولاً");
    return false;
  }
  const state = useEditor.getState();
  const page = activePage(state.pages, active.pageId);
  if (!page || page.locked) return false;
  const el = rasterTargetForRegion(
    page,
    active,
    state.enteredGroupId,
    state.selectedIds,
  );
  if (!el) {
    toast.message("لا توجد صورة داخل منطقة التحديد");
    return false;
  }
  if (el.locked) {
    toast.message("الصورة مقفلة");
    return false;
  }
  const transform = cropSceneTransform(page.elements, el.id, state.enteredGroupId);
  if (!transform) return false;
  const loaded = await loadRasterSource(
    el,
    elementImage(page.id, el.id),
  );
  if (!loaded) {
    toast.error("تعذر قراءة الصورة لقص التحديد");
    return false;
  }
  const plan = planRegionCrop({
    el,
    source: loaded.source,
    crop: el.style.crop,
    fit: el.style.objectFit || (el.type === "logo" ? "contain" : "cover"),
    objectX: el.style.objectX,
    objectY: el.style.objectY,
    flipX: el.style.flipX,
    flipY: el.style.flipY,
    region: active.box,
    transform,
  });
  if (!plan) {
    toast.message("منطقة التحديد خارج الصورة أو أصغر من أن تُقص");
    return false;
  }
  state.patchElementOnPage(page.id, el.id, {
    ...plan.frame,
    style: { ...el.style, crop: plan.crop, objectX: 50, objectY: 50 },
  });
  // Apply ends the operation: the region, its controls and the armed shape
  // all disappear, and the interface returns to its natural pointer state.
  useTools.getState().armSelect("off");
  toast.success("تم قص الصورة إلى منطقة التحديد", { duration: 1600 });
  return true;
}

/**
 * «استخراج التحديد» — copy the selected pixels into a NEW image element and
 * leave the original exactly as it was. This is the destructive-looking half of
 * the feature made safe: extraction is an insert, so Undo simply removes it.
 */
export async function extractRegionFromImage(region?: SelectionRegion | null) {
  const active = region ?? useTools.getState().region;
  if (!active) {
    toast.message("اسحب منطقة على الصورة أولاً");
    return false;
  }
  const state = useEditor.getState();
  const page = activePage(state.pages, active.pageId);
  if (!page || page.locked) return false;
  const el = rasterTargetForRegion(
    page,
    active,
    state.enteredGroupId,
    state.selectedIds,
  );
  if (!el) {
    toast.message("لا توجد صورة داخل منطقة التحديد");
    return false;
  }
  const transform = cropSceneTransform(page.elements, el.id, state.enteredGroupId);
  if (!transform) return false;
  const loaded = await loadRasterSource(el, elementImage(page.id, el.id));
  if (!loaded) {
    toast.error("تعذر قراءة الصورة لاستخراج التحديد");
    return false;
  }
  const plan = planRegionCrop({
    el,
    source: loaded.source,
    crop: el.style.crop,
    fit: el.style.objectFit || (el.type === "logo" ? "contain" : "cover"),
    objectX: el.style.objectX,
    objectY: el.style.objectY,
    flipX: el.style.flipX,
    flipY: el.style.flipY,
    region: active.box,
    transform,
  });
  if (!plan) {
    toast.message("منطقة التحديد خارج الصورة أو أصغر من أن تُستخرج");
    return false;
  }
  const w = Math.max(1, Math.round(plan.crop.w));
  const h = Math.max(1, Math.round(plan.crop.h));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(
    loaded.image,
    plan.crop.x,
    plan.crop.y,
    plan.crop.w,
    plan.crop.h,
    0,
    0,
    w,
    h,
  );
  let src: string;
  try {
    src = canvas.toDataURL("image/png");
  } catch {
    toast.error("لا يمكن استخراج صورة من مصدر خارجي محمي");
    return false;
  }
  state.addElementAt(
    "image",
    {
      name: "تحديد مُستخرج",
      src,
      x: plan.frame.x,
      y: plan.frame.y,
      w: plan.frame.w,
      h: plan.frame.h,
      rotation: el.rotation,
      style: { ...el.style, crop: undefined, objectX: 50, objectY: 50 },
    },
    undefined,
    page.id,
  );
  useTools.getState().setRegion(null);
  toast.success("تم استخراج منطقة التحديد كصورة مستقلة", { duration: 1800 });
  return true;
}
