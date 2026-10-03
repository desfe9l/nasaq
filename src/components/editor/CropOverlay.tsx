import {
  cropLocalPoint,
  cropSceneTransform,
  sameCropTransform,
} from "@/lib/editor/image-crop";
import { mmToPx } from "@/lib/editor/render-units";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Crop, X } from "lucide-react";
import { pageSize, findElement } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import {
  useInteraction,
  type CropSession,
} from "@/lib/editor/interaction-store";
import { screenToDocument, type RectMm } from "@/lib/editor/document-space";
import { canvasViewport } from "@/lib/editor/canvas-space";
import { applyImageCrop } from "@/lib/editor/crop-session";

const corners = ["nw", "ne", "se", "sw"] as const;

/** Crop owns its own pointer frame; no document resize/move handler can acquire it. */
export function CropOverlay({ session }: { session: CropSession }) {
  const { original: el, transform, box, bounds } = session;
  const ref = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedId = useEditor((s) => s.selectedId);
  const enteredGroupId = useEditor((s) => s.enteredGroupId);
  const pages = useEditor((s) => s.pages);
  useEffect(() => {
    const page = pages.find((p) => p.id === session.pageId);
    if (
      !page ||
      page.locked ||
      enteredGroupId !== session.enteredGroupId ||
      findElement(page.elements, el.id)?.el !== el ||
      !sameCropTransform(
        cropSceneTransform(page.elements, el.id, enteredGroupId),
        transform,
      )
    )
      useInteraction.getState().endCrop();
  }, [
    pages,
    session.pageId,
    session.enteredGroupId,
    enteredGroupId,
    el,
    transform,
  ]);
  useEffect(() => {
    if (activePageId !== session.pageId || selectedId !== el.id)
      useInteraction.getState().endCrop();
  }, [activePageId, selectedId, el.id, session.pageId]);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    const cancel = () => useInteraction.getState().endCrop();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Enter") applyImageCrop();
        else cancel();
      } else if (!(
        event.target instanceof HTMLElement &&
        event.target.closest("input, select, textarea")
      )) {
        // Transform/delete/copy shortcuts cannot modify a frame during crop.
        if (
          ((event.metaKey || event.ctrlKey) &&
            !["0", "+", "-", "="].includes(event.key)) ||
          [
            "Delete",
            "Backspace",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].includes(event.key)
        )
          event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", keys, true);
    window.addEventListener("nasaq:menu-open", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("nasaq:menu-open", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  const start = (event: React.PointerEvent, handle: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    const node = ref.current?.closest<HTMLElement>("[data-page-id]");
    const page = useEditor
      .getState()
      .pages.find((p) => p.id === session.pageId);
    if (!node || !page) return;
    const pointerId = event.pointerId,
      target = event.currentTarget;
    const originalBox = { ...box };
    const origin = cropLocalPoint(
      transform,
      screenToDocument(
        node.getBoundingClientRect(),
        pageSize(page),
        event.clientX,
        event.clientY,
      ),
    );
    target.setPointerCapture(pointerId);
    const minW = Math.min(4, bounds.w),
      minH = Math.min(4, bounds.h);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const point = cropLocalPoint(
        transform,
        screenToDocument(
          node.getBoundingClientRect(),
          pageSize(page),
          ev.clientX,
          ev.clientY,
        ),
      );
      const lx = point.x - origin.x,
        ly = point.y - origin.y;
      const next = { ...originalBox };
      const clamp = (value: number, low: number, high: number) =>
        Math.max(low, Math.min(high, value));
      if (handle === "move") {
        next.x = clamp(
          originalBox.x + lx,
          bounds.x,
          bounds.x + bounds.w - next.w,
        );
        next.y = clamp(
          originalBox.y + ly,
          bounds.y,
          bounds.y + bounds.h - next.h,
        );
      } else {
        if (handle.includes("w")) {
          next.x = clamp(
            originalBox.x + lx,
            bounds.x,
            originalBox.x + originalBox.w - minW,
          );
          next.w = originalBox.x + originalBox.w - next.x;
        }
        if (handle.includes("e"))
          next.w = clamp(
            originalBox.w + lx,
            minW,
            bounds.x + bounds.w - next.x,
          );
        if (handle.includes("n")) {
          next.y = clamp(
            originalBox.y + ly,
            bounds.y,
            originalBox.y + originalBox.h - minH,
          );
          next.h = originalBox.y + originalBox.h - next.y;
        }
        if (handle.includes("s"))
          next.h = clamp(
            originalBox.h + ly,
            minH,
            bounds.y + bounds.h - next.y,
          );
      }
      useInteraction.getState().setCropBox(next);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.type === "pointerup") move(ev);
      else useInteraction.getState().setCropBox(originalBox);
      cleanup.current?.();
    };
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId);
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const rectStyle = (r: RectMm) => ({
    left: `${r.x}mm`,
    top: `${r.y}mm`,
    width: `${r.w}mm`,
    height: `${r.h}mm`,
  });
  return (
    <>
      <div
        ref={ref}
        className="crop-overlay"
        data-crop-id={el.id}
        style={{
          left: 0,
          top: 0,
          width: `${el.w}mm`,
          height: `${el.h}mm`,
          transformOrigin: "0 0",
          transform: `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${mmToPx(transform.e)}, ${mmToPx(transform.f)})`,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div
          className="crop-shade"
          style={rectStyle({ x: 0, y: 0, w: el.w, h: box.y })}
        />
        <div
          className="crop-shade"
          style={rectStyle({
            x: 0,
            y: box.y + box.h,
            w: el.w,
            h: el.h - box.y - box.h,
          })}
        />
        <div
          className="crop-shade"
          style={rectStyle({ x: 0, y: box.y, w: box.x, h: box.h })}
        />
        <div
          className="crop-shade"
          style={rectStyle({
            x: box.x + box.w,
            y: box.y,
            w: el.w - box.x - box.w,
            h: box.h,
          })}
        />
        <div
          className="crop-window"
          style={rectStyle(box)}
          onPointerDown={(e) => start(e, "move")}
        >
          {corners.map((handle) => (
            <button
              key={handle}
              type="button"
              aria-label={`مقبض قص ${handle}`}
              className={`crop-handle ${handle}`}
              onPointerDown={(e) => start(e, handle)}
            />
          ))}
        </div>
      </div>
      <CropActions pageId={session.pageId} elementId={el.id} />
    </>
  );
}
function CropActions({
  pageId,
  elementId,
}: {
  pageId: string;
  elementId: string;
}) {
  const zoom = useEditor((s) => s.zoom);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const place = () => {
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const page = stage?.querySelector<HTMLElement>(
        `[data-page-id="${CSS.escape(pageId)}"]`,
      );
      const element = page?.querySelector<HTMLElement>(
        `.canvas-el[data-el-id="${CSS.escape(elementId)}"]`,
      );
      if (!stage || !element) return;
      const v = canvasViewport(stage),
        r = element.getBoundingClientRect();
      setPos({
        left: Math.max(
          v.left + 8,
          Math.min(v.left + v.width - 224, r.left + r.width / 2 - 108),
        ),
        top:
          r.top - 52 >= v.top + 8
            ? r.top - 52
            : Math.min(v.top + v.height - 48, r.bottom + 16),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [pageId, elementId, zoom]);
  return createPortal(
    <div
      className="floating-toolbar crop-actions"
      style={pos}
      dir="rtl"
      role="toolbar"
      aria-label="وضع قص الصورة"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Crop className="size-4" />
      <span>قص الصورة</span>
      <button
        type="button"
        className="floating-toolbar-btn"
        title="تطبيق القص · Enter"
        aria-label="تطبيق القص"
        onClick={applyImageCrop}
      >
        <Check />
      </button>
      <button
        type="button"
        className="floating-toolbar-btn"
        title="إلغاء القص · Escape"
        aria-label="إلغاء القص"
        onClick={() => useInteraction.getState().endCrop()}
      >
        <X />
      </button>
    </div>,
    document.body,
  );
}
