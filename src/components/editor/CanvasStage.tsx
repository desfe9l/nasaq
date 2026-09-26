import { useEffect, useMemo, useRef, useState } from "react";
import {
  findElement,
  MIN_SIZE,
  pageSize,
  WORKSPACE_MARGIN_MM,
  type Box,
  type CanvasEl,
  type ElType,
  type Page,
} from "@/lib/editor/model";
import { applySnap, mirrorHandle, resizeByHandle } from "@/lib/editor/transform";
import { useEditor } from "@/lib/editor/store";
import { prepareText } from "@/lib/editor/text-render";
import { clamp, cn, round } from "@/lib/utils";
import { ElementNode } from "./ElementNode";
import { PrintGuides } from "./PrintGuides";
import { FloatingToolbar } from "./FloatingToolbar";
import { toast } from "sonner";
import { beginCanvasNavigation, zoomAnchoredAt } from "@/lib/editor/viewport";
import {
  LIBRARY_DND_MIME,
  insertLibraryDrop,
  parseLibraryDrop,
} from "@/lib/editor/library-dnd";
const GRAPHIC_HEADING_MIME = "application/x-nasaq-graphic-heading";
import {
  clearPenHover,
  fireSyntheticDoubleClick,
  isPalmTouch,
  noteElementTap,
  notePenActivity,
  resetPenInput,
  updatePenHover,
} from "@/lib/editor/pen-input";

import { CanvasPointerSession, LONG_PRESS_MS, POINTER_SLOP } from "@/lib/editor/canvas-pointer";

type Op = {
  kind: "move" | "resize" | "rotate";
  id: string;
  handle?: string;
  startX: number;
  startY: number;
  origins: Record<string, { x: number; y: number }>;
  orig: CanvasEl;
  pageId: string;
  parent?: { x: number; y: number };
} | null;

type Marquee = { x0: number; y0: number; x1: number; y1: number } | null;

type LayerPickerState = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  pageId: string;
  point: { x: number; y: number };
  elements: CanvasEl[];
} | null;

const ARTBOARD_GAP_MM = 18;
const SELECTION_LAYER_Z = 5000;
const GUIDE_LAYER_Z = SELECTION_LAYER_Z - 1;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const ROTATE_HANDLES = ["nw", "ne", "se", "sw"] as const;

function snapRotation(raw: number, shift: boolean): number {
  if (!shift) {
    const free = (((raw % 360) + 540) % 360) - 180;
    return round(free);
  }
  const fifteen = Math.round(raw / 15) * 15;
  return (((fifteen % 360) + 540) % 360) - 180;
}

function pagePoint(
  rect: DOMRect,
  size: { w: number; h: number },
  clientX: number,
  clientY: number,
) {
  return {
    x: ((clientX - rect.left) / rect.width) * size.w,
    y: ((clientY - rect.top) / rect.height) * size.h,
  };
}

/**
 * هل النقطة داخل صندوق العنصر مع مراعاة الدوران — لاختيار دقيق بالقلم
 */
function pointInRotatedBox(el: CanvasEl, px: number, py: number): boolean {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  const rad = (-(el.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  // تسامح صغير لتسهيل الالتقاط بالقلم والإصبع
  const tol = 0.8;
  return Math.abs(rx) <= el.w / 2 + tol && Math.abs(ry) <= el.h / 2 + tol;
}

/**
 * جميع العناصر الموجودة في نقطة معينة — مرتبة من الأعلى (z الأكبر) إلى الأسفل
 * تراعي حالة الدخول إلى مجموعة (enteredGroup)
 */
function elementsAtPoint(
  page: Page,
  enteredGroupId: string | null,
  px: number,
  py: number,
): CanvasEl[] {
  const entered = enteredGroupId
    ? findElement(page.elements, enteredGroupId)?.el || null
    : null;
  let list: CanvasEl[];
  let offset = { x: 0, y: 0 };
  if (entered?.children?.length) {
    list = entered.children;
    offset = { x: entered.x, y: entered.y };
  } else {
    list = page.elements;
  }
  const hits: CanvasEl[] = [];
  for (const el of list) {
    if (el.hidden) continue;
    const absEl = offset.x || offset.y
      ? { ...el, x: el.x + offset.x, y: el.y + offset.y }
      : el;
    if (pointInRotatedBox(absEl, px, py)) {
      hits.push(absEl);
    }
  }
  // الأعلى أولاً
  return hits.sort((a, b) => b.z - a.z);
}

export function CanvasStage({
  onDropImage,
  onCanvasTap,
}: {
  onDropImage?: (file: File, at?: { x: number; y: number }) => void;
  onCanvasTap?: () => void;
}) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor((s) => s.selectedId);
  const addElementAt = useEditor((s) => s.addElementAt);
  const bubbleEnabled = useEditor((s) => s.bubbleEnabled);
  const exportOpen = useEditor((s) => s.exportOpen);
  const pageManagerOpen = useEditor((s) => s.pageManagerOpen);
  const contextMenu = useEditor((s) => s.contextMenu);
  const enteredGroupId = useEditor((s) => s.enteredGroupId);
  const zoom = useEditor((s) => s.zoom);
  const previewAll = useEditor((s) => s.previewAll);
  const showGrid = useEditor((s) => s.showGrid);
  const printGuides = useEditor((s) => s.printGuides);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const selectMany = useEditor((s) => s.selectMany);
  const addTextAt = useEditor((s) => s.addTextAt);
  const enterGroup = useEditor((s) => s.enterGroup);
  const replaceElement = useEditor((s) => s.replaceElement);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const commit = useEditor((s) => s.commit);
  const setActivePage = useEditor((s) => s.setActivePage);
  const editingId = useEditor((s) => s.editingId);

  const opRef = useRef<Op>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  const input = useRef<CanvasPointerSession | null>(null);
  if (!input.current) input.current = new CanvasPointerSession({
    navigate: (start) => stageRef.current
      ? beginCanvasNavigation(stageRef.current, start) : () => {},
    undo: () => useEditor.getState().undo(),
    redo: () => useEditor.getState().redo(),
  });

  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({
    v: [],
    h: [],
  });
  const [rotationHint, setRotationHint] = useState<{
    angle: number;
    shift: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [dropping, setDropping] = useState<"file" | "library" | null>(null);
  const [drawTool, setDrawTool] = useState<"text" | "rect" | null>(null);
  const drawArmed = drawTool !== null;
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [layerPicker, setLayerPicker] = useState<LayerPickerState>(null);

  useEffect(() => {
    const armText = () => setDrawTool("text");
    const onTool = (event: Event) => {
      const detail = (event as CustomEvent<"text" | "rect" | null>).detail;
      setDrawTool(detail ?? null);
    };
    const disarm = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawTool(null);
        setLayerPicker(null);
      }
    };
    window.addEventListener("nasaq:draw-text", armText);
    window.addEventListener("nasaq:tool", onTool);
    window.addEventListener("keydown", disarm);
    return () => {
      window.removeEventListener("nasaq:draw-text", armText);
      window.removeEventListener("nasaq:tool", onTool);
      window.removeEventListener("keydown", disarm);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const prev = useEditor.getState().zoom;
      const next = Math.min(
        2,
        Math.max(0.2, prev + (e.deltaY < 0 ? 0.06 : -0.06)),
      );
      zoomAnchoredAt(stage, prev, next, e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const session = input.current!;
    const move = (event: PointerEvent) => session.move(event);
    const up = (event: PointerEvent) => session.end(event);
    const cancel = (event: PointerEvent) => session.end(event, true);
    const reset = () => session.reset();
    const visibility = () => { if (document.hidden) reset(); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      reset();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const track = (event: Event) => notePenActivity(event as PointerEvent);
    const PEN_WINDOW_EVENTS = [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "pointerover",
      "pointerout",
      "pointermove",
    ] as const;
    for (const type of PEN_WINDOW_EVENTS) {
      window.addEventListener(type, track, true);
    }

    const onPenMove = (event: PointerEvent) => {
      if (event.pointerType !== "pen") return;
      updatePenHover(event.clientX, event.clientY);
    };
    const onPenLeave = () => {
      clearPenHover();
    };
    stage.addEventListener("pointermove", onPenMove);
    stage.addEventListener("pointerleave", onPenLeave);

    const onBlur = () => {
      clearPenHover();
      resetPenInput();
    };
    window.addEventListener("blur", onBlur);

    const claim = (event: Event) => event.preventDefault();
    const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;
    for (const type of GESTURE_EVENTS) {
      stage.addEventListener(type, claim, { passive: false });
    }

    return () => {
      for (const type of PEN_WINDOW_EVENTS) {
        window.removeEventListener(type, track, true);
      }
      stage.removeEventListener("pointermove", onPenMove);
      stage.removeEventListener("pointerleave", onPenLeave);
      window.removeEventListener("blur", onBlur);
      for (const type of GESTURE_EVENTS) {
        stage.removeEventListener(type, claim);
      }
      clearPenHover();
    };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !(event.target as HTMLElement | null)?.isContentEditable
      )
        spaceDown.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceDown.current = false;
    };
    const blur = () => {
      spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const dropPoint = (
    e: React.DragEvent | { clientX: number; clientY: number; target?: any },
  ): { x: number; y: number; pageId: string } | null => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-page-id]",
    );
    if (target) {
      const pageId = target.dataset.pageId;
      const page = pages.find((p) => p.id === pageId);
      if (!page) return null;
      const size = pageSize(page);
      const rect = target.getBoundingClientRect();
      const point = pagePoint(rect, size, (e as any).clientX, (e as any).clientY);
      return { pageId: page.id, ...point };
    }
    // إذا لم يكن فوق صفحة مباشرة، استخدم أقرب صفحة أو الصفحة النشطة — لا نلغي السحب بسبب حدود الـArtboard
    const stage = stageRef.current;
    if (!stage) return null;
    // ابحث عن أقرب صفحة لنقطة المؤشر
    let closest: { page: Page; rect: DOMRect; dist: number } | null = null;
    for (const page of pages) {
      const el = pageRefs.current[page.id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot((e as any).clientX - cx, (e as any).clientY - cy);
      if (!closest || dist < closest.dist) {
        closest = { page, rect, dist };
      }
    }
    if (closest) {
      const size = pageSize(closest.page);
      // حتى لو خارج الحدود، احسب النقطة مع clamp ناعم داخل مساحة العمل
      const clampedX = Math.max(
        closest.rect.left,
        Math.min((e as any).clientX, closest.rect.right),
      );
      const clampedY = Math.max(
        closest.rect.top,
        Math.min((e as any).clientY, closest.rect.bottom),
      );
      const point = pagePoint(closest.rect, size, clampedX, clampedY);
      return { pageId: closest.page.id, ...point };
    }
    // fallback للصفحة النشطة
    const active = pages.find((p) => p.id === activePageId) || pages[0];
    if (!active) return null;
    const ref = pageRefs.current[active.id];
    if (!ref) return null;
    const size = pageSize(active);
    const rect = ref.getBoundingClientRect();
    const point = pagePoint(rect, size, (e as any).clientX, (e as any).clientY);
    return { pageId: active.id, ...point };
  };

  const visible = useMemo(
    () => (previewAll ? pages : pages.filter((p) => p.id === activePageId)),
    [pages, previewAll, activePageId],
  );

  const startOp = (
    e: React.PointerEvent,
    page: Page,
    el: CanvasEl,
    kind: "move" | "resize" | "rotate",
    handle?: string,
    parent?: { x: number; y: number },
  ) => {
    if (isPalmTouch(e)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || input.current!.busy) return;
    onCanvasTap?.();
    setLayerPicker(null);
    if (el.locked) {
      e.stopPropagation();
      select(el.id);
      return;
    }
    if (el.resizeLocked && kind === "resize") {
      e.stopPropagation();
      e.preventDefault();
      select(el.id);
      return;
    }
    // قفل عرض/ارتفاع مستقل — يمنع Resize فقط على المحور المقفل
    if (kind === "resize" && handle) {
      if (el.widthLocked && (handle.includes("e") || handle.includes("w"))) {
        // إذا كان العرض مقفلاً ونحاول تغييره مع بقاء الارتفاع مقفلاً أيضاً، امنع تماماً
        if (el.heightLocked) {
          e.stopPropagation();
          select(el.id);
          toast.info("العرض والارتفاع مقفلان — فك القفل للتحجيم");
          return;
        }
        // إذا كان مقفل عرض فقط، نسمح بتغيير الارتفاع فقط إذا كان المقبض عمودي
        const isHorizontalOnly = (handle === "e" || handle === "w");
        if (isHorizontalOnly) {
          e.stopPropagation();
          select(el.id);
          return;
        }
      }
      if (el.heightLocked && (handle.includes("n") || handle.includes("s"))) {
        const isVerticalOnly = (handle === "n" || handle === "s");
        if (isVerticalOnly) {
          e.stopPropagation();
          select(el.id);
          return;
        }
        if (el.widthLocked) {
          e.stopPropagation();
          select(el.id);
          return;
        }
      }
    }
    e.stopPropagation();
    // Direct manipulation replaces native text/image dragging, only here.
    e.preventDefault();
    const captureTarget = stageRef.current!;
    if (e.pointerType !== "mouse") {
      try { captureTarget.setPointerCapture(e.pointerId); } catch { /* detached */ }
    }

    setActivePage(page.id);

    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) =>
      pagePoint(pageEl.getBoundingClientRect(), size, ev.clientX, ev.clientY);

    const start = toMm(e);
    const slopMm = Math.max(0.2, (POINTER_SLOP * size.w) / Math.max(1, rect.width));
    let maxDist = 0;

    const enteredGroup = enteredGroupId
      ? findElement(page.elements, enteredGroupId)?.el || null
      : null;
    const enteredChildren = enteredGroup?.children || [];

    const defer =
      kind === "move" &&
      !e.shiftKey &&
      (e.pointerType === "touch" || e.pointerType === "pen");
    let decided = !defer;
    let heldLong = false;
    let longPressTimer: ReturnType<typeof setTimeout> | undefined;
    let longPressFired = false;

    const applyPressSelection = () => {
      const fresh = useEditor.getState();
      if (e.shiftKey) toggleSelect(el.id);
      else if (!fresh.selectedIds.includes(el.id)) select(el.id);
    };

    const beginGesture = () => {
      applyPressSelection();
      const fresh = useEditor.getState();
      const live = new Set(fresh.selectedIds);
      const draggingIds =
        kind !== "move" || e.shiftKey
          ? [el.id]
          : live.has(el.id)
            ? fresh.selectedIds
            : [el.id];
      const linkedIds =
        kind === "move" && !e.shiftKey
          ? page.elements
              .filter(
                (candidate) =>
                  candidate.linkId &&
                  draggingIds.some(
                    (id) =>
                      page.elements.find((item) => item.id === id)?.linkId ===
                      candidate.linkId,
                  ),
              )
              .map((candidate) => candidate.id)
          : [];
      const gestureIds = [...new Set([...draggingIds, ...linkedIds])];

      const origins: Record<string, { x: number; y: number }> = {};
      if (kind === "move" && !e.shiftKey) {
        for (const id of gestureIds) {
          let found: CanvasEl | undefined;
          if (enteredGroup && enteredChildren.some((c) => c.id === id)) {
            found = enteredChildren.find((c) => c.id === id);
          } else {
            found = page.elements.find((x) => x.id === id);
          }
          if (found) origins[id] = { x: found.x, y: found.y };
        }
      }

      opRef.current = {
        kind,
        id: el.id,
        handle,
        startX: start.x,
        startY: start.y,
        origins,
        orig: { ...el, style: { ...el.style } },
        pageId: page.id,
        parent,
      };
    };

    if (decided) beginGesture();

    // One long-press timer, only for element bodies. Handles never open menus.
    if (defer) {
      longPressTimer = setTimeout(() => {
        input.current!.lock(e.pointerId);
        longPressFired = true;
        heldLong = true;
        decided = true;
        applyPressSelection();
        useEditor.getState().openContextMenu({
          x: e.clientX, y: e.clientY, targetId: el.id, source: "canvas",
        });
      }, LONG_PRESS_MS);
    }

    const others = page.elements.filter((x) => x.id !== el.id && !x.hidden);

    const move = (ev: PointerEvent) => {
      if (longPressFired) return;
      if (!decided) {
        const cur = toMm(ev);
        const dist = Math.hypot(cur.x - start.x, cur.y - start.y);
        if (dist < slopMm) return;
        decided = true;
        if (longPressTimer !== undefined) {
          clearTimeout(longPressTimer);
          longPressTimer = undefined;
        }
        input.current!.lock(e.pointerId);
        beginGesture();
        maxDist = dist;
      }
      if (heldLong) return;
      const op = opRef.current;
      if (!op) return;
      const cur = toMm(ev);
      const dist = Math.hypot(cur.x - start.x, cur.y - start.y);
      if (dist > maxDist) maxDist = dist;
      let dx = cur.x - op.startX;
      let dy = cur.y - op.startY;
      const next: CanvasEl = { ...op.orig, style: { ...op.orig.style } };

      const stageEl = stageRef.current;
      if (stageEl) {
        const vr = stageEl.getBoundingClientRect();
        const margin = 80;
        const ease = (dist: number) => (margin - Math.max(dist, 0)) * 0.12;
        const fromLeft = ev.clientX - vr.left;
        const fromRight = vr.right - ev.clientX;
        const fromTop = ev.clientY - vr.top;
        const fromBottom = vr.bottom - ev.clientY;
        const ax =
          fromLeft < margin
            ? -ease(fromLeft)
            : fromRight < margin
              ? ease(fromRight)
              : 0;
        const ay =
          fromTop < margin
            ? -ease(fromTop)
            : fromBottom < margin
              ? ease(fromBottom)
              : 0;
        if (ax || ay) {
          stageEl.scrollLeft += ax;
          stageEl.scrollTop += ay;
          const pageElNow = pageRefs.current[op.pageId];
          if (pageElNow) {
            const rectNow = pageElNow.getBoundingClientRect();
            const curNow = pagePoint(rectNow, size, ev.clientX, ev.clientY);
            cur.x = curNow.x;
            cur.y = curNow.y;
            dx = curNow.x - op.startX;
            dy = curNow.y - op.startY;
          }
        }
      }

      if (op.kind === "move") {
        next.x = op.orig.x + dx;
        next.y = op.orig.y + dy;
        const zoomNow = useEditor.getState().zoom;
        const snapped = applySnap(
          next,
          others,
          size,
          snapGrid && !ev.altKey,
          !ev.altKey && (snapElements || ev.shiftKey),
          zoomNow,
          op.origins,
        );
        setGuides(snapped);
        const appliedDx = next.x - op.orig.x;
        const appliedDy = next.y - op.orig.y;
        const siblingList =
          op.parent && enteredGroup ? enteredChildren : page.elements;
        for (const [id, origin] of Object.entries(op.origins)) {
          if (id === op.id) continue;
          const sibling = siblingList.find((x) => x.id === id);
          if (!sibling) continue;
          replaceElement(
            { ...sibling, x: origin.x + appliedDx, y: origin.y + appliedDy },
            true,
          );
        }
      } else if (op.kind === "resize") {
        resizeByHandle(
          next,
          op.orig,
          mirrorHandle(
            op.handle || "se",
            op.orig.style?.flipX === true,
            op.orig.style?.flipY === true,
          ),
          dx,
          dy,
          ev.shiftKey || op.orig.style?.aspectLock === true,
          { widthLocked: op.orig.widthLocked, heightLocked: op.orig.heightLocked },
        );
      } else if (op.kind === "rotate") {
        const cx = op.orig.x + op.orig.w / 2;
        const cy = op.orig.y + op.orig.h / 2;
        const a0 = Math.atan2(op.startY - cy, op.startX - cx);
        const a1 = Math.atan2(cur.y - cy, cur.x - cx);
        const raw = (op.orig.rotation || 0) + ((a1 - a0) * 180) / Math.PI;
        next.rotation = snapRotation(raw, ev.shiftKey);
        setRotationHint({
          angle: next.rotation,
          shift: ev.shiftKey,
          x: ev.clientX,
          y: ev.clientY,
        });
      }
      const workspaceW = size.w + WORKSPACE_MARGIN_MM * 2;
      const workspaceH = size.h + WORKSPACE_MARGIN_MM * 2;
      next.w = Math.max(clamp(next.w, MIN_SIZE, workspaceW), MIN_SIZE);
      next.h = Math.max(clamp(next.h, MIN_SIZE, workspaceH), MIN_SIZE);
      next.x = Math.max(
        -WORKSPACE_MARGIN_MM,
        Math.min(next.x, size.w + WORKSPACE_MARGIN_MM - next.w),
      );
      next.y = Math.max(
        -WORKSPACE_MARGIN_MM,
        Math.min(next.y, size.h + WORKSPACE_MARGIN_MM - next.h),
      );
      replaceElement(
        op.parent
          ? { ...next, x: next.x - op.parent.x, y: next.y - op.parent.y }
          : next,
        true,
      );
    };

    const detach = () => {
      // Capture belongs to the stage until native up/cancel, including promotion
      // from a pending element press to a two-finger gesture.
      if (longPressTimer !== undefined) {
        clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    };

    const up = (ev: PointerEvent) => {
      const hadGesture = opRef.current !== null;
      if (longPressFired) {
        detach();
        opRef.current = null;
        setRotationHint(null);
        setGuides({ v: [], h: [] });
        return;
      }
      if (!decided) {
        decided = true;
        applyPressSelection();
      }
      detach();
      const wasTap = kind === "move" && !heldLong && maxDist < slopMm;

      if (wasTap) {
        // تحقق من العناصر المتداخلة — إذا كان هناك أكثر من عنصر في نقطة الضغط، اعرض قائمة اختيار
        const pageForHit = pages.find((p) => p.id === page.id);
        if (pageForHit) {
          const hits = elementsAtPoint(pageForHit, enteredGroupId, start.x, start.y);
          if (hits.length > 1) {
            // إذا كان العنصر المحدد هو الأعلى، وكان هناك تداخل صعب، اعرض القائمة
            // نعرض القائمة عندما يكون هناك أكثر من عنصرين متداخلين أو عندما يكون الضغط بالقلم/اللمس
            const shouldShowPicker =
              hits.length >= 2 &&
              (ev.pointerType === "pen" || ev.pointerType === "touch" || hits.length > 2);
            if (shouldShowPicker) {
              // تأخير صغير لتجنب التعارض مع double-tap
              setTimeout(() => {
                const stillTap = !input.current!.busy;
                if (stillTap) {
                  setLayerPicker({
                    x: ev.clientX,
                    y: ev.clientY,
                    clientX: ev.clientX,
                    clientY: ev.clientY,
                    pageId: page.id,
                    point: start,
                    elements: hits,
                  });
                }
              }, 80);
            }
          }
        }
        if (
          (ev.pointerType === "touch" || ev.pointerType === "pen") &&
          noteElementTap(el.id, ev.pointerType)
        ) {
          fireSyntheticDoubleClick(el.id);
        }
      }
      opRef.current = null;
      setRotationHint(null);
      setGuides({ v: [], h: [] });
      if (hadGesture) commit();
    };

    const cancel = () => {
      const hadGesture = opRef.current !== null;
      detach();
      opRef.current = null;
      setRotationHint(null);
      setGuides({ v: [], h: [] });
      if (hadGesture) commit();
    };

    input.current!.claim(e, { move, end: up, cancel, yieldable: defer });
  };

  const pickables = (page: Page): { id: string; box: Box }[] => {
    const entered = enteredGroupId
      ? findElement(page.elements, enteredGroupId)?.el || null
      : null;
    if (entered?.children?.length) {
      return entered.children.map((child) => ({
        id: child.id,
        box: {
          x: entered.x + child.x,
          y: entered.y + child.y,
          w: child.w,
          h: child.h,
        },
      }));
    }
    return page.elements.map((el) => ({
      id: el.id,
      box: { x: el.x, y: el.y, w: el.w, h: el.h },
    }));
  };

  const activePageForSelection = pages.find((p) => p.id === activePageId);
  const primarySelection = (() => {
    if (!selectedId || !activePageForSelection) return null;
    const found = findElement(activePageForSelection.elements, selectedId)?.el;
    return found && !found.hidden ? found : null;
  })();

  const startMarquee = (e: React.PointerEvent, page: Page) => {
    if (e.button !== 0 || input.current!.busy || isPalmTouch(e)) return;
    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    e.stopPropagation();
    const size = pageSize(page);
    const toMm = (ev: { clientX: number; clientY: number }) =>
      pagePoint(pageEl.getBoundingClientRect(), size, ev.clientX, ev.clientY);
    const start = toMm(e);
    const stage = stageRef.current!;
    const scroll = { x: stage.scrollLeft, y: stage.scrollTop };
    const pan = e.pointerType === "touch" && !drawTool && !selectedIds.length;
    const before = e.shiftKey ? [...selectedIds] : [];
    const candidates = pickables(page);
    let moved = false;
    let held = false;
    const timer = !drawTool && e.pointerType !== "mouse" ? setTimeout(() => {
      held = true;
      input.current!.lock(e.pointerId);
      useEditor.getState().openContextMenu({
        x: e.clientX, y: e.clientY, targetId: null, source: "canvas",
      });
    }, LONG_PRESS_MS) : undefined;
    const finish = () => {
      clearTimeout(timer);
      setMarquee(null);
    };
    input.current!.claim(e, {
      yieldable: e.pointerType === "touch",
      move: (ev) => {
        if (held) return;
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < POINTER_SLOP) return;
        clearTimeout(timer);
        moved = true;
        // A blank one-finger pan may promote to a two-finger navigation;
        // drawing/marquee selection, like an element drag, owns its pointer.
        if (!pan) input.current!.lock(e.pointerId);
        if (pan) {
          stage.scrollLeft = scroll.x - (ev.clientX - e.clientX);
          stage.scrollTop = scroll.y - (ev.clientY - e.clientY);
          return;
        }
        const cur = toMm(ev);
        const box = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
        setMarquee({ x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h });
        if (!drawTool) {
          const hits = candidates.filter(p => p.box.x < box.x + box.w && p.box.x + p.box.w > box.x &&
            p.box.y < box.y + box.h && p.box.y + p.box.h > box.y).map(p => p.id);
          selectMany([...new Set([...before, ...hits])]);
        }
      },
      end: (ev) => {
        finish();
        if (held) return;
        if (drawTool) {
          const end = toMm(ev);
          const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
            w: Math.max(MIN_SIZE, Math.abs(end.x - start.x)), h: Math.max(MIN_SIZE, Math.abs(end.y - start.y)) };
          setDrawTool(null);
          if (drawTool === "rect") addElementAt("box", box);
          else {
            const id = addTextAt(box, page.id);
            if (id) requestAnimationFrame(() => requestEdit(page.id, id));
          }
        } else if (!moved && !e.shiftKey) select(null);
      },
      cancel: finish,
    });
  };

  // Geometry is relative to each artboard, NOT bounded by it. Rendering and
  // export clipping stay unchanged; visible workspace overflow remains usable.
  const workspaceHit = (x: number, y: number) => {
    for (const page of [...visible].reverse()) {
      const node = pageRefs.current[page.id];
      if (!node) continue;
      const point = pagePoint(node.getBoundingClientRect(), pageSize(page), x, y);
      const hits = elementsAtPoint(page, enteredGroupId, point.x, point.y).filter(el => !el.locked);
      const el = hits.find(el => selectedSet.has(el.id)) || hits[0];
      if (el) {
        const group = enteredGroupId ? findElement(page.elements, enteredGroupId)?.el : null;
        return { page, el, parent: group ? { x: group.x, y: group.y } : undefined };
      }
    }
    return null;
  };

  return (
    <div
      ref={stageRef}
      className={cn(
        "editor-canvas-stage studio-grid relative min-h-0 min-w-0 overflow-auto px-6 py-8",
        dropping && "is-dropping",
        drawArmed && "draw-armed",
        drawTool === "rect" && "draw-rect",
      )}
      style={{ "--editor-zoom": zoom } as React.CSSProperties}
      dir="ltr"
      onLostPointerCapture={(e) => input.current!.end(e.nativeEvent, true)}
      onPointerDownCapture={(e) => {
        if (isPalmTouch(e)) { e.stopPropagation(); return; }
        const target = e.target as HTMLElement;
        if (target.closest("button, input, textarea, select, [contenteditable=true], .floating-toolbar, .layer-picker-popup")) return;
        if (input.current!.down(e.nativeEvent)) {
          e.stopPropagation();
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* detached */ }
          return;
        }
        if (spaceDown.current && e.pointerType === "mouse" && e.button === 0 && !target.closest(".handle, .rotate-handle")) {
          e.preventDefault(); // Space+drag replaces native text selection.
          e.stopPropagation();
          const stage = e.currentTarget;
          const left = stage.scrollLeft, top = stage.scrollTop;
          input.current!.claim(e, { yieldable: false,
            move: ev => { stage.scrollLeft = left - (ev.clientX - e.clientX); stage.scrollTop = top - (ev.clientY - e.clientY); },
            end: () => {}, cancel: () => {},
          });
          return;
        }
        // Handles keep first refusal. Geometry then resolves selected artwork
        // ahead of other elements, including overflow outside the page DOM box.
        if (e.button === 0 && !target.closest(".handle, .rotate-handle")) {
          const hit = workspaceHit(e.clientX, e.clientY);
          if (hit) startOp(e, hit.page, hit.el, "move", undefined, hit.parent);
        }
      }}
      onPointerDown={(e) => {
        if (isPalmTouch(e) || input.current!.busy) return;
        const target = e.target as HTMLElement;
        if (target.closest("button, input, textarea, select, [contenteditable=true], .floating-toolbar, .layer-picker-popup")) return;
        setLayerPicker(null);
        onCanvasTap?.();
        const page = pages.find(p => p.id === activePageId);
        if (page) startMarquee(e, page);
      }}
      onContextMenu={(e) => {
        e.preventDefault(); // Only the canvas replaces the browser context menu.
        e.stopPropagation();
        const hit = workspaceHit(e.clientX, e.clientY);
        const state = useEditor.getState();
        if (hit) { state.setActivePage(hit.page.id); if (!state.selectedIds.includes(hit.el.id)) state.select(hit.el.id); }
        state.openContextMenu({ x: e.clientX, y: e.clientY, targetId: hit?.el.id ?? null, source: "canvas" });
      }}
      onDragOver={(e) => {
        const isFile = e.dataTransfer.types.includes("Files");
        const isLibrary = e.dataTransfer.types.includes(LIBRARY_DND_MIME);
        const isGraphic = e.dataTransfer.types.includes(GRAPHIC_HEADING_MIME);
        if ((!onDropImage || !isFile) && !isLibrary && !isGraphic) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(isLibrary || isGraphic ? "library" : "file");
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropping(null);
      }}
      onDrop={(e) => {
        setDropping(null);
        const graphicId = e.dataTransfer.getData(GRAPHIC_HEADING_MIME);
        if (graphicId) {
          e.preventDefault();
          const at = dropPoint(e);
          if (at) {
            setActivePage(at.pageId);
            const store = useEditor.getState();
            if (store.insertGraphicHeadingAt) store.insertGraphicHeadingAt(graphicId as any, { x: at.x, y: at.y });
          }
          return;
        }
        const payload = parseLibraryDrop(
          e.dataTransfer.getData(LIBRARY_DND_MIME),
        );
        if (payload) {
          e.preventDefault();
          const at = dropPoint(e);
          if (at) setActivePage(at.pageId);
          insertLibraryDrop(
            payload,
            at ? { x: at.x, y: at.y } : null,
            (type, over, center) => {
              const el = addElementAt(
                type as ElType,
                over as Partial<CanvasEl>,
                center,
              );
              return el ? { x: el.x, y: el.y, w: el.w, h: el.h } : undefined;
            },
          );
          return;
        }
        if (!onDropImage) return;
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files)[0];
        if (!file || !file.type.startsWith("image/")) {
          toast.error("نوع الملف غير مدعوم.");
          return;
        }
        const at = dropPoint(e);
        if (at) setActivePage(at.pageId);
        onDropImage(file, at ? { x: at.x, y: at.y } : undefined);
      }}
    >
      {dropping && (
        <div className="pointer-events-none sticky top-0 z-[var(--z-canvas-overlay)] mx-auto w-max rounded-full border border-gold/40 bg-white/95 px-4 py-1.5 text-[11px] font-extrabold text-navy shadow-sm dark:bg-[#161c26] dark:text-gold-2">
          {dropping === "library"
            ? "أفلت العنصر ليُضاف في هذا الموضع"
            : "أفلت الصورة لإضافتها إلى الصفحة"}
        </div>
      )}
      <div
        className="mx-auto flex w-max min-w-full flex-col items-center gap-6"
        dir="rtl"
        style={{ padding: `${WORKSPACE_MARGIN_MM * zoom}mm` }}
      >
        {visible.map((page) => {
          const size = pageSize(page);
          const isActive = page.id === activePageId;
          const pageNo = pages.findIndex((p) => p.id === page.id) + 1;
          const entered = enteredGroupId
            ? findElement(page.elements, enteredGroupId)?.el || null
            : null;
          const enteredKids = entered?.children ?? [];
          const selectionFrames: SelectionBox[] = [];
          if (isActive) {
            if (entered && enteredKids.length) {
              for (const child of enteredKids) {
                if (selectedSet.has(child.id) && !child.hidden) {
                  selectionFrames.push({
                    el: {
                      ...child,
                      x: entered.x + child.x,
                      y: entered.y + child.y,
                    },
                    parent: { x: entered.x, y: entered.y },
                  });
                }
              }
            } else {
              for (const el of page.elements) {
                if (
                  selectedSet.has(el.id) &&
                  !el.hidden &&
                  el.id !== entered?.id
                ) {
                  selectionFrames.push({ el, parent: undefined });
                }
              }
            }
          }
          return (
            <div
              key={page.id}
              className="page-frame shrink-0"
              dir="ltr"
              style={{
                width: `${size.w * zoom}mm`,
                height: `${(size.h + 12 + ARTBOARD_GAP_MM) * zoom}mm`,
              }}
            >
              <div
                className="page-frame-content"
                dir="ltr"
                style={{
                  width: `${size.w}mm`,
                  height: `${size.h + 12}mm`,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <div
                  className="mb-2 flex items-center justify-between gap-4 text-[12px] text-muted"
                  dir="rtl"
                >
                  <strong className="text-ink dark:text-white">
                    {page.name}
                    {entered && (
                      <span className="ms-2 font-semibold text-gold-2">
                        · داخل «{entered.name}»
                      </span>
                    )}
                  </strong>
                  <span className="tabular-nums">
                    {previewAll
                      ? `صفحة ${pages.findIndex((p) => p.id === page.id) + 1} من ${pages.length}`
                      : `${round(size.w)} × ${round(size.h)} مم`}
                  </span>
                </div>
                <div
                  ref={(n) => {
                    pageRefs.current[page.id] = n;
                  }}
                  data-page-id={page.id}
                  className={`report-page ${showGrid ? "show-grid" : ""} ${isActive ? "ring-2 ring-gold ring-offset-8" : ""}`}
                  style={{
                    width: `${size.w}mm`,
                    height: `${size.h}mm`,
                    background: page.bg || "#fff",
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                  }}
                  onDragStart={(e) => {
                    const t = e.target as HTMLElement;
                    if (
                      t.closest?.(
                        '[contenteditable="true"], [contenteditable=""], input, textarea',
                      )
                    ) {
                      return;
                    }
                    e.preventDefault();
                  }}
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (isPalmTouch(e)) {
                      e.stopPropagation();
                      e.preventDefault();
                      return;
                    }
                    e.stopPropagation();
                    setActivePage(page.id);
                    if (e.button !== 0) return;
                    startMarquee(e, page);
                  }}
                >
                  {page.elements
                    .slice()
                    .sort((a, b) => a.z - b.z)
                    .map((el) => {
                      if (
                        entered &&
                        el.id === entered.id &&
                        enteredKids.length
                      ) {
                        return (
                          <div key={el.id}>
                            <div
                              className="canvas-el group-frame"
                              style={{
                                left: `${el.x}mm`,
                                top: `${el.y}mm`,
                                width: `${el.w}mm`,
                                height: `${el.h}mm`,
                                transform: `rotate(${el.rotation || 0}deg)`,
                                zIndex: el.z,
                              }}
                            />
                            {enteredKids
                              .slice()
                              .sort((a, b) => a.z - b.z)
                              .map((child) => {
                                const abs = {
                                  ...child,
                                  x: entered.x + child.x,
                                  y: entered.y + child.y,
                                };
                                return (
                                  <ElementNode
                                    key={child.id}
                                    el={abs}
                                    pageNo={pageNo}
                                    interactive
                                    onPointerDown={(ev, kind, handle) =>
                                      startOp(ev, page, abs, kind, handle, {
                                        x: entered.x,
                                        y: entered.y,
                                      })
                                    }
                                  />
                                );
                              })}
                          </div>
                        );
                      }
                      if (entered && el.id === entered.id) return null;
                      return (
                        <ElementNode
                          key={el.id}
                          el={el}
                          pageNo={pageNo}
                          interactive
                          onEnterGroup={
                            el.type === "group"
                              ? () => enterGroup(el.id)
                              : undefined
                          }
                          onPointerDown={(ev, kind, handle) =>
                            startOp(ev, page, el, kind, handle)
                          }
                        />
                      );
                    })}
                  <PrintGuides
                    page={page}
                    settings={printGuides}
                    zIndex={GUIDE_LAYER_Z}
                  />
                  {marquee && (
                    <div
                      className="marquee"
                      style={{
                        left: `${marquee.x0}mm`,
                        top: `${marquee.y0}mm`,
                        width: `${Math.abs(marquee.x1 - marquee.x0)}mm`,
                        height: `${Math.abs(marquee.y1 - marquee.y0)}mm`,
                      }}
                    />
                  )}
                  {isActive &&
                    page.elements.map((el) => (
                      <OverflowFlag
                        key={el.id}
                        el={el}
                        onFit={() => fitTextBox(el.id)}
                      />
                    ))}
                  {rotationHint && isActive && (
                    <div
                      className="rotation-hint"
                      dir="ltr"
                      style={{ left: rotationHint.x, top: rotationHint.y }}
                    >
                      <strong className="tabular-nums">
                        {Math.round(rotationHint.angle)}°
                      </strong>
                      <span>
                        {rotationHint.shift
                          ? "التقاط 15°/45°/90°"
                          : "Shift للالتقاط"}
                      </span>
                    </div>
                  )}
                  {isActive &&
                    guides.v.map((x) => (
                      <div
                        key={`v${x}`}
                        className="guide-v"
                        style={{ left: `${x}mm` }}
                      />
                    ))}
                  {isActive &&
                    guides.h.map((y) => (
                      <div
                        key={`h${y}`}
                        className="guide-h"
                        style={{ top: `${y}mm` }}
                      />
                    ))}
                  {isActive && selectionFrames.length > 0 && (
                    <div
                      className="selection-layer"
                      style={{ zIndex: SELECTION_LAYER_Z }}
                    >
                      {selectionFrames.map((frame) => (
                        <SelectionFrame
                          key={frame.el.id}
                          frame={frame}
                          primary={selectedIds.length === 1}
                          editing={editingId === frame.el.id}
                          zoom={zoom}
                          onGesture={(ev, kind, handle) =>
                            startOp(
                              ev,
                              page,
                              frame.el,
                              kind,
                              handle,
                              frame.parent,
                            )
                          }
                          onEditRequest={() =>
                            requestEdit(page.id, frame.el.id)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {primarySelection &&
        editingId !== primarySelection.id &&
        bubbleEnabled &&
        !exportOpen &&
        !pageManagerOpen &&
        !contextMenu &&
        !layerPicker && <FloatingToolbar el={primarySelection} />}

      {layerPicker && (
        <LayerPickerPopup
          picker={layerPicker}
          onSelect={(id) => {
            const state = useEditor.getState();
            state.setActivePage(layerPicker.pageId);
            state.select(id);
            setLayerPicker(null);
          }}
          onClose={() => setLayerPicker(null)}
        />
      )}

      <ExportCapture pages={pages} />
    </div>
  );
}

function OverflowFlag({ el, onFit }: { el: CanvasEl; onFit: () => void }) {
  if (el.hidden || el.type === "group") return null;
  const prepared = prepareText(el);
  if (!prepared.clipped) return null;
  return (
    <button
      type="button"
      className="overflow-badge"
      style={{ left: `${el.x}mm`, top: `${el.y + el.h + 1}mm` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onFit();
      }}
      title="النص أطول من الصندوق — اضغط لملاءمة الصندوق مع النص"
    >
      النص أطول من الصندوق
    </button>
  );
}

interface SelectionBox {
  el: CanvasEl;
  parent?: { x: number; y: number };
}

function SelectionFrame({
  frame,
  primary,
  editing,
  zoom,
  onGesture,
  onEditRequest,
}: {
  frame: SelectionBox;
  primary: boolean;
  editing: boolean;
  zoom: number;
  onGesture: (
    e: React.PointerEvent,
    kind: "move" | "resize" | "rotate",
    handle?: string,
  ) => void;
  onEditRequest: () => void;
}) {
  const select = useEditor((s) => s.select);
  const el = frame.el;

  // حتى لا يصبح العنصر غير قابل للتحكم بسبب صغر حجمه — حد أدنى بصري للإطار
  // نحافظ على موضع ونسبة العنصر أثناء Resize عبر توسيط الإطار المصغر على مركز العنصر
  const MIN_SCREEN_PX = 32;
  const pxPerMm = 96 / 25.4;
  const screenW = el.w * zoom * pxPerMm;
  const screenH = el.h * zoom * pxPerMm;
  let visualW = el.w;
  let visualH = el.h;
  let visualX = el.x;
  let visualY = el.y;
  if (screenW < MIN_SCREEN_PX) {
    const minWmm = MIN_SCREEN_PX / (zoom * pxPerMm);
    visualX = el.x - (minWmm - el.w) / 2;
    visualW = minWmm;
  }
  if (screenH < MIN_SCREEN_PX) {
    const minHmm = MIN_SCREEN_PX / (zoom * pxPerMm);
    visualY = el.y - (minHmm - el.h) / 2;
    visualH = minHmm;
  }

  return (
    <div
      className={cn(
        "selection-frame",
        !primary && "is-secondary",
        el.locked && "is-locked",
        el.resizeLocked && "is-resize-locked",
        (el.widthLocked || el.heightLocked) && "is-dimension-locked",
        editing && "is-editing",
      )}
      data-el-id={el.id}
      style={{
        left: `${visualX}mm`,
        top: `${visualY}mm`,
        width: `${visualW}mm`,
        height: `${visualH}mm`,
        transform: `rotate(${el.rotation || 0}deg)${el.style?.flipX ? " scaleX(-1)" : ""}${el.style?.flipY ? " scaleY(-1)" : ""}`,
      } as React.CSSProperties}
      onPointerDown={(e) => {
        if (isPalmTouch(e)) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if ((e.target as HTMLElement).closest(".handle, .rotate-handle"))
          return;
        e.stopPropagation();
        if (el.locked) {
          select(el.id);
          return;
        }
        onGesture(e, "move");
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEditRequest();
      }}
    >
      {primary && !el.locked && !editing && (
        <>
          {/* Resize handles — Hit Area أكبر من المرئي، مناسب لـ Apple Pencil */}
          {!el.resizeLocked &&
            HANDLES.map((h) => {
              const isLockedAxis =
                (el.widthLocked && (h.includes("e") || h.includes("w"))) ||
                (el.heightLocked && (h.includes("n") || h.includes("s")));
              if (isLockedAxis && el.widthLocked && el.heightLocked) return null;
              return (
                <div
                  key={h}
                  className={cn("handle", h, isLockedAxis && "is-axis-locked")}
                  data-handle={h}
                  onPointerDown={(e) => {
                    if (isLockedAxis) {
                      // إذا كان المحور مقفلاً، لا نسمح بالتحجيم في هذا الاتجاه
                      if (
                        (h === "e" || h === "w") && el.widthLocked ||
                        (h === "n" || h === "s") && el.heightLocked
                      ) {
                        e.stopPropagation();
                        return;
                      }
                    }
                    e.stopPropagation();
                    onGesture(e, "resize", h);
                  }}
                />
              );
            })}
          {ROTATE_HANDLES.map((corner) => (
            <div
              key={`rot-${corner}`}
              className={cn("rotate-handle", corner)}
              title="اسحب للتدوير — Shift للالتقاط بزوايا 15° / 45° / 90°"
              onPointerDown={(e) => {
                e.stopPropagation();
                onGesture(e, "rotate");
              }}
            />
          ))}
          {(el.resizeLocked || el.widthLocked || el.heightLocked) && (
            <span
              className="resize-lock-badge"
              title="التحجيم مقفل — فك القفل من القائمة السياقية أو الخصائص"
            >
              🔒
            </span>
          )}
        </>
      )}
    </div>
  );
}

function LayerPickerPopup({
  picker,
  onSelect,
  onClose,
}: {
  picker: NonNullable<LayerPickerState>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ left: picker.clientX, top: picker.clientY });

  useEffect(() => {
    // ضمان عدم خروج القائمة خارج الشاشة
    const margin = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const estimatedW = 220;
    const estimatedH = Math.min(320, picker.elements.length * 44 + 40);
    let left = picker.clientX + 12;
    let top = picker.clientY + 12;
    if (left + estimatedW > vw - margin) left = vw - estimatedW - margin;
    if (top + estimatedH > vh - margin) top = vh - estimatedH - margin;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    setPos({ left, top });
  }, [picker]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-context)]"
      onPointerDown={(e) => {
        // إغلاق عند الضغط خارج القائمة
        if (!(e.target as HTMLElement).closest(".layer-picker-popup")) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="layer-picker-popup fixed min-w-[200px] max-w-[260px] rounded-[10px] border border-line bg-white p-1.5 shadow-2xl dark:border-white/15 dark:bg-[#1e2633]"
        style={{ left: pos.left, top: pos.top }}
        onPointerDown={(e) => e.stopPropagation()}
        role="menu"
        aria-label="اختيار طبقة متداخلة"
      >
        <div className="mb-1.5 px-2 py-1 text-[10px] font-extrabold text-muted">
          {picker.elements.length} عناصر في هذه النقطة — اختر المطلوب
        </div>
        <div className="max-h-[280px] overflow-auto">
          {picker.elements.map((el, idx) => (
            <button
              key={el.id}
              type="button"
              role="menuitem"
              onClick={() => onSelect(el.id)}
              className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-right text-[11px] font-bold hover:bg-line-2 dark:hover:bg-white/10"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-navy/10 text-[10px] font-extrabold text-navy dark:bg-white/10 dark:text-gold-2">
                {idx + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="block truncate">{el.name || el.type}</span>
                <span className="block truncate text-[9px] font-semibold text-muted">
                  {el.type} · z:{el.z}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-1 border-t border-line pt-1 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[6px] px-2.5 py-1.5 text-center text-[10px] font-bold text-muted hover:bg-line-2 dark:hover:bg-white/10"
          >
            إغلاق — Esc
          </button>
        </div>
      </div>
    </div>
  );
}

function requestEdit(pageId: string, elId: string) {
  const host = document.querySelector<HTMLElement>(
    `[data-page-id="${pageId}"]`,
  );
  const node = host?.querySelector<HTMLElement>(
    `[data-el-id="${CSS.escape(elId)}"]`,
  );
  node?.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
}

function ExportCapture({ pages }: { pages: Page[] }) {
  return (
    <div
      id="export-root"
      className="pointer-events-none fixed top-0 left-[-2400px] z-[-1]"
      aria-hidden
    >
      {pages.map((page) => {
        const size = pageSize(page);
        return (
          <div
            key={page.id}
            data-export-page={page.id}
            className="report-page"
            style={{
              width: `${size.w}mm`,
              height: `${size.h}mm`,
              background: page.bg || "#fff",
            }}
          >
            {page.elements
              .slice()
              .sort((a, b) => a.z - b.z)
              .map((el) => (
                <ElementNode
                  key={el.id}
                  el={el}
                  interactive={false}
                  onPointerDown={() => {}}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
