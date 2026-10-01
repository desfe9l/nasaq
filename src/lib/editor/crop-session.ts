import { toast } from "sonner";
import { findElement } from "./model";
import {
  imageLayout,
  cropFromLocalBox,
  croppedFrame,
  cropSceneTransform,
  sameCropTransform,
} from "./image-crop";
import { useEditor } from "./store";
import { useInteraction } from "./interaction-store";

export function beginImageCrop(elementId: string) {
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
  if (el.resizeLocked || el.widthLocked || el.heightLocked) {
    toast.message("فك قفل أبعاد الصورة قبل تغيير إطار القص");
    return;
  }
  const img = document.querySelector<HTMLImageElement>(
    `.editor-canvas-stage .canvas-el[data-el-id="${CSS.escape(elementId)}"] img`,
  );
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
  });
}

export function applyImageCrop() {
  const session = useInteraction.getState().crop;
  if (!session) return;
  const { original: el, source, box, pageId } = session;
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
    useInteraction.getState().endCrop();
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
}
