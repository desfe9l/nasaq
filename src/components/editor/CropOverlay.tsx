import {
  cropLocalPoint,
  cropSceneTransform,
  sameCropTransform,
} from "@/lib/editor/image-crop";
import { mmToPx } from "@/lib/editor/render-units";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Crop, Move, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageSize, findElement } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import {
  useInteraction,
  type CropSession,
} from "@/lib/editor/interaction-store";
import { screenToDocument, type RectMm } from "@/lib/editor/document-space";
import { canvasViewport } from "@/lib/editor/canvas-space";
import { applyImageCrop, cancelImageCrop } from "@/lib/editor/crop-session";
import { ASPECT_RATIOS, aspectFitBox } from "@/lib/editor/marquee";
import { useTools } from "@/lib/editor/tool-store";

const corners = ["nw", "ne", "se", "sw"] as const;

/** Crop owns its own pointer frame; no document resize/move handler can acquire it. */
export function CropOverlay({ session }: { session: CropSession }) {
  const { original: el, transform, box, bounds } = session;
  const pan = session.mode === "pan";
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
    const cancel = () => cancelImageCrop();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Enter") applyImageCrop();
        else cancel();
      } else if (
        event.key.startsWith("Arrow") &&
        useInteraction.getState().crop?.mode === "pan" &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest("input, select, textarea")
        )
      ) {
        // Keyboard panning: 1 mm per press, 5 mm with Shift — the frame fixed.
        event.preventDefault();
        event.stopPropagation();
        const s = useInteraction.getState().crop;
        if (!s) return;
        const step = event.shiftKey ? 5 : 1;
        const dx =
          event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy =
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const fit = (v: number, lo: number, hi: number) =>
          Math.max(lo, Math.min(hi, v));
        useInteraction.getState().setCropBox({
          ...s.box,
          x: fit(s.box.x + dx, s.bounds.x, s.bounds.x + s.bounds.w - s.box.w),
          y: fit(s.box.y + dy, s.bounds.y, s.bounds.y + s.bounds.h - s.box.h),
        });
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
          className={cn("crop-window", pan && "is-pan")}
          style={rectStyle(box)}
          onPointerDown={(e) => start(e, "move")}
          title={pan ? "اسحب لتحريك الصورة داخل الإطار" : undefined}
        >
          {!pan &&
            corners.map((handle) => (
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
/**
 * The ephemeral bubble of a live crop: confirm, cancel, and the small ratio
 * row — nothing else, and nothing permanent. It positions itself INSIDE the
 * viewport at the measured size of its own content (a fixed guess was how a
 * bubble ended up half off-screen on a rotated tablet), flips below the image
 * when there is no room above, and disappears the moment the frame closes.
 */
function CropActions({
  pageId,
  elementId,
}: {
  pageId: string;
  elementId: string;
}) {
  const zoom = useEditor((s) => s.zoom);
  const box = useInteraction((s) => s.crop?.box ?? null);
  const pan = useInteraction((s) => s.crop?.mode === "pan");
  const aspect = useTools((s) => s.cropAspect);
  const setAspect = useTools((s) => s.setCropAspect);
  const bubbleRef = useRef<HTMLDivElement>(null);
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
      const size = bubbleRef.current?.getBoundingClientRect();
      const w = size?.width || 220,
        h = size?.height || 44;
      const margin = 8;
      const left = Math.max(
        v.left + margin,
        Math.min(v.left + v.width - w - margin, r.left + r.width / 2 - w / 2),
      );
      const above = r.top - h - 8;
      const top =
        above >= v.top + margin
          ? above
          : Math.min(v.top + v.height - h - margin, r.bottom + 12);
      setPos({ left, top });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [pageId, elementId, zoom, box]);
  /**
   * A ratio chip re-fits the LIVE frame around its centre — the constraint
   * belongs to the frame you are holding, not to some next gesture, which is
   * why the crop ratio is not a modal and never occupies the main bar.
   */
  const applyAspect = (id: (typeof ASPECT_RATIOS)[number]["id"]) => {
    setAspect(id);
    const session = useInteraction.getState().crop;
    if (!session) return;
    const ratio = ASPECT_RATIOS.find((entry) => entry.id === id)?.ratio ?? null;
    if (!ratio) return;
    useInteraction
      .getState()
      .setCropBox(aspectFitBox(session.box, session.bounds, ratio));
  };
  return createPortal(
    <div
      ref={bubbleRef}
      className="floating-toolbar crop-actions"
      style={{ ...pos, maxWidth: "calc(100vw - 16px)" }}
      dir="rtl"
      role="toolbar"
      aria-label={pan ? "وضع تحريك الصورة داخل الإطار" : "وضع قص الصورة"}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="crop-actions-row">
        <span className="crop-actions-mode" aria-hidden>
          {pan ? (
            <Move className="size-3.5" />
          ) : (
            <Crop className="size-3.5" />
          )}
        </span>
        {!pan && (
        <div className="tool-props-chips" role="group" aria-label="نسبة القص">
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio.id}
              type="button"
              className={cn("tool-props-chip", aspect === ratio.id && "is-active")}
              aria-pressed={aspect === ratio.id}
              title={`نسبة ${ratio.label}`}
              onClick={() => applyAspect(ratio.id)}
            >
              {ratio.label}
            </button>
          ))}
        </div>
        )}
        <button
          type="button"
          className="floating-toolbar-btn is-primary"
          title={pan ? "تطبيق التحريك · Enter" : "تطبيق القص · Enter"}
          aria-label={pan ? "تطبيق تحريك الصورة" : "تطبيق القص"}
          onClick={applyImageCrop}
        >
          <Check />
        </button>
        <button
          type="button"
          className="floating-toolbar-btn"
          title={pan ? "إلغاء التحريك · Escape" : "إلغاء القص · Escape"}
          aria-label={pan ? "إلغاء تحريك الصورة" : "إلغاء القص"}
          onClick={cancelImageCrop}
        >
          <X />
        </button>
      </div>
    </div>,
    document.body,
  );
}
