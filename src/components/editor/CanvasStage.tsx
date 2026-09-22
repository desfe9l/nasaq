import { useEffect, useMemo, useRef, useState } from "react";
import { findElement, MIN_SIZE, pageSize, type Box, type CanvasEl, type ElType, type Page } from "@/lib/editor/model";
import { applySnap, resizeByHandle } from "@/lib/editor/transform";
import { useEditor } from "@/lib/editor/store";
import { prepareText } from "@/lib/editor/text-render";
import { clamp, cn, round } from "@/lib/utils";
import { ElementNode } from "./ElementNode";
import { FloatingToolbar } from "./FloatingToolbar";
import { toast } from "sonner";
import { zoomAnchoredAt } from "@/lib/editor/viewport";
import { LIBRARY_DND_MIME, insertLibraryDrop, parseLibraryDrop } from "@/lib/editor/library-dnd";

type Op =
  | {
      kind: "move" | "resize" | "rotate";
      id: string;
      handle?: string;
      startX: number;
      startY: number;
      /** Positions of every element the gesture moves, keyed by id. */
      origins: Record<string, { x: number; y: number }>;
      orig: CanvasEl;
      pageId: string;
      parent?: { x: number; y: number };
    }
  | null;

type Marquee = { x0: number; y0: number; x1: number; y1: number } | null;

const ARTBOARD_GAP_MM = 18;
/**
 * z-index of the selection/manipulation layer inside a page.
 *
 * `normalizeZ` keeps document elements at 1..n, and the marquee/guides live
 * below 100, so a large constant guarantees the overlay is painted above every
 * document element no matter how they stack — the overlay is chrome, never
 * content, and must never lose a hit-test to artwork that happens to overlap
 * the selected element.
 */
const SELECTION_LAYER_Z = 5000;
/** The eight resize handles, named by the corner/edge they sit on. */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

function pagePoint(rect: DOMRect, size: { w: number; h: number }, clientX: number, clientY: number) {
  return {
    x: ((clientX - rect.left) / rect.width) * size.w,
    y: ((clientY - rect.top) / rect.height) * size.h,
  };
}

export function CanvasStage({
  onDropImage,
  onCanvasTap,
}: {
  onDropImage?: (file: File, at?: { x: number; y: number }) => void;
  /** Fired on a canvas press — used to dismiss the floating drawers. */
  onCanvasTap?: () => void;
}) {
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor((s) => s.selectedId);
  const addElementAt = useEditor((s) => s.addElementAt);
  const enteredGroupId = useEditor((s) => s.enteredGroupId);
  const zoom = useEditor((s) => s.zoom);
  const previewAll = useEditor((s) => s.previewAll);
  const showGrid = useEditor((s) => s.showGrid);
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
  /**
   * Active two-finger gesture. Captured on start (midpoint, scroll origin,
   * finger distance) and resolved on the first move into either a PAN (fingers
   * move together) or a PINCH (the distance changes) — mixing the two makes a
   * zoom drift sideways, which is the classic broken pinch.
   */
  const touchPan = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    distance: number;
    mode: "pan" | "pinch" | null;
  } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<Marquee>(null);
  /** Which drop gesture is hovering: an image file, a library card, or none. */
  const [dropping, setDropping] = useState<"file" | "library" | null>(null);
  /** Armed when the author picks «نص بالرسم»: next page drag draws a text box. */
  const [drawArmed, setDrawArmed] = useState(false);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // «نص بالرسم»: any surface can arm the tool (the toolbar button broadcasts);
  // Escape is the way out without drawing anything.
  useEffect(() => {
    const arm = () => setDrawArmed(true);
    const disarm = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawArmed(false);
    };
    window.addEventListener("nasaq:draw-text", arm);
    window.addEventListener("keydown", disarm);
    return () => {
      window.removeEventListener("nasaq:draw-text", arm);
      window.removeEventListener("keydown", disarm);
    };
  }, []);

  /*
   * Ctrl/cmd + wheel zooms the canvas, anchored on the pointer.
   *
   * This must be a NATIVE, non-passive listener: React registers `wheel` at
   * its root passively, so `preventDefault()` inside `onWheel` cannot stop the
   * browser's default — the stage would also natively scroll (or, on real
   * desktop browsers, the whole page would run its own pinch-zoom) while the
   * anchored zoom adjusts scroll, and the two fight every step.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const prev = useEditor.getState().zoom;
      const next = Math.min(2, Math.max(0.2, prev + (e.deltaY < 0 ? 0.06 : -0.06)));
      // Pointer-anchored zoom: the page point under the cursor stays put, so
      // zooming in on a detail never throws the author somewhere else.
      zoomAnchoredAt(stage, prev, next, e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  /*
   * Touch navigation: two fingers pan, and a change in finger distance zooms.
   *
   * Bound natively and non-passively on purpose. React registers touch
   * listeners passively at the root, so `preventDefault()` inside `onTouchMove`
   * cannot stop the browser's own pinch-zoom — the page would zoom underneath
   * the artboard while the canvas zoomed with it. One native handler owns the
   * whole gesture instead, and the midpoint anchoring reuses `zoomAnchoredAt`,
   * the same path ctrl+wheel takes.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const midpoint = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
      distance: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY),
    });

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        touchPan.current = null;
        return;
      }
      // A two-finger gesture is navigation, never a rubber-band selection.
      setMarquee(null);
      const mid = midpoint(event.touches);
      touchPan.current = {
        x: mid.x,
        y: mid.y,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
        distance: Math.max(24, mid.distance),
        mode: null,
      };
    };

    const onMove = (event: TouchEvent) => {
      const state = touchPan.current;
      if (!state || event.touches.length !== 2) return;
      const mid = midpoint(event.touches);
      // Decide the gesture once, after a deliberate movement: a few px of
      // finger wobble during a pan must not start zooming.
      if (!state.mode) {
        const spread = Math.abs(mid.distance - state.distance);
        const shift = Math.hypot(mid.x - state.x, mid.y - state.y);
        if (spread > 10 && spread > shift) state.mode = "pinch";
        else if (shift > 8) state.mode = "pan";
        else return;
      }
      event.preventDefault();
      if (state.mode === "pinch") {
        const ratio = mid.distance / state.distance;
        const prev = useEditor.getState().zoom;
        const next = Math.min(2, Math.max(0.2, prev * ratio));
        if (Math.abs(next - prev) > 0.004) {
          zoomAnchoredAt(stage, prev, next, mid.x, mid.y);
          // Incremental: the ratio is applied against the last applied frame,
          // so a slow pinch does not accumulate rounding drift.
          state.distance = mid.distance;
        }
        return;
      }
      stage.scrollLeft = state.scrollLeft - (mid.x - state.x);
      stage.scrollTop = state.scrollTop - (mid.y - state.y);
    };

    const onEnd = () => {
      touchPan.current = null;
    };

    stage.addEventListener("touchstart", onStart, { passive: false });
    stage.addEventListener("touchmove", onMove, { passive: false });
    stage.addEventListener("touchend", onEnd);
    stage.addEventListener("touchcancel", onEnd);
    return () => {
      stage.removeEventListener("touchstart", onStart);
      stage.removeEventListener("touchmove", onMove);
      stage.removeEventListener("touchend", onEnd);
      stage.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target as HTMLElement | null)?.isContentEditable) spaceDown.current = true;
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

  /**
   * Translate a drop point into page millimetres.
   *
   * The drop target is resolved from the element under the pointer rather than
   * a ref, because the author may drop onto any page — including one that is not
   * the active page in the all-pages preview.
   */
  const dropPoint = (e: React.DragEvent): { x: number; y: number; pageId: string } | null => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-page-id]");
    if (!target) return null;
    const pageId = target.dataset.pageId;
    const page = pages.find((p) => p.id === pageId);
    if (!page) return null;
    const size = pageSize(page);
    const rect = target.getBoundingClientRect();
    const point = pagePoint(rect, size, e.clientX, e.clientY);
    return { pageId: page.id, ...point };
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
    // The press lands on an element, so the stage handler never sees it — but
    // the drawer must still get out of the way.
    onCanvasTap?.();
    if (el.locked) {
      // Locked elements can be selected but not gestured; stopping the press
      // here keeps the stage's click-to-deselect from immediately undoing it.
      e.stopPropagation();
      select(el.id);
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    // setPointerCapture throws NotFoundError for synthetic/dispatched events
    // that carry no live pointer — wrap so a programmatic click (tests,
    // a11y tools) can't crash the interaction handler.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* no live pointer: capture is a drag-quality optimisation, not required */
    }
    setActivePage(page.id);

    /*
     * Selection rules, in the order a design tool applies them:
     *  · shift extends the selection, so several elements can be gathered;
     *  · pressing an element that is already part of a multi-selection keeps the
     *    whole selection, so it can be dragged as a unit;
     *  · anything else replaces the selection with the pressed element.
     */
    if (e.shiftKey) toggleSelect(el.id);
    else if (!selectedSet.has(el.id)) select(el.id);

    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    // Snapshot the live page geometry once: reading it per pointermove would
    // force a layout on every frame of a drag.
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) => pagePoint(rect, size, ev.clientX, ev.clientY);

    const start = toMm(e);

    // The elements this gesture moves. A resize or rotate handle only ever acts
    // on the pressed element; a plain drag carries the whole selection unless
    // the press was a shift-toggle, which is a selection change and not a drag.
    const draggingIds =
      kind !== "move" || e.shiftKey ? [el.id] : selectedSet.has(el.id) ? selectedIds : [el.id];
    const linkedIds =
      kind === "move" && !e.shiftKey
        ? page.elements
            .filter((candidate) => candidate.linkId && draggingIds.some((id) => page.elements.find((item) => item.id === id)?.linkId === candidate.linkId))
            .map((candidate) => candidate.id)
        : [];
    const gestureIds = [...new Set([...draggingIds, ...linkedIds])];

    // When inside a group, children live in entered.children with
    // group-relative coordinates; otherwise they're in page.elements.
    const enteredGroup = enteredGroupId
      ? findElement(page.elements, enteredGroupId)?.el || null
      : null;
    const enteredChildren = enteredGroup?.children || [];

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

    const others = page.elements.filter((x) => x.id !== el.id && !x.hidden);

    const move = (ev: PointerEvent) => {
      const op = opRef.current;
      if (!op) return;
      const cur = toMm(ev);
      let dx = cur.x - op.startX;
      let dy = cur.y - op.startY;
      const next: CanvasEl = { ...op.orig, style: { ...op.orig.style } };

      /*
       * Drag auto-pan: near the viewport edge the stage scrolls itself, so a
       * drag can continue past what is on screen. Edge zones are screen pixels
       * (80px engage, speed eases to 0 at the very edge) — zoom-independent by
       * definition because they are measured on the visible viewport itself.
       */
      const stageEl = stageRef.current;
      if (stageEl) {
        const vr = stageEl.getBoundingClientRect();
        const margin = 80;
        const ease = (dist: number) => (margin - Math.max(dist, 0)) * 0.12;
        const fromLeft = ev.clientX - vr.left;
        const fromRight = vr.right - ev.clientX;
        const fromTop = ev.clientY - vr.top;
        const fromBottom = vr.bottom - ev.clientY;
        const ax = fromLeft < margin ? -ease(fromLeft) : fromRight < margin ? ease(fromRight) : 0;
        const ay = fromTop < margin ? -ease(fromTop) : fromBottom < margin ? ease(fromBottom) : 0;
        if (ax || ay) {
          stageEl.scrollLeft += ax;
          stageEl.scrollTop += ay;
          // Scroll changes what the pointer means in document space; re-read it
          // so the element keeps tracking the cursor instead of lagging.
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
        /*
         * Snap policy for moves:
         *  · Alt escapes all snapping mid-gesture, so a stuck alignment never
         *    traps the element;
         *  · Shift is the alignment mode — smart guides stay available for the
         *    gesture even when the element-snap preference is off;
         *  · otherwise the author's grid/element snap preferences apply.
         * The threshold itself is screen-space (see transform.ts), so zoom has
         * no effect on how eagerly an element locks on.
         */
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
        // Everything else in the selection follows the pressed element's final,
        // snapped offset, so their spacing relative to each other is preserved.
        const appliedDx = next.x - op.orig.x;
        const appliedDy = next.y - op.orig.y;
        // When inside a group, siblings live in entered.children; otherwise in page.elements.
        const siblingList = op.parent && enteredGroup
          ? enteredChildren
          : page.elements;
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
        // Shift (or the element's own aspect lock) preserves the element's
        // current aspect ratio; a plain drag resizes freely.
        resizeByHandle(next, op.orig, op.handle || "se", dx, dy, ev.shiftKey || op.orig.style?.aspectLock === true);
      } else if (op.kind === "rotate") {
        const cx = op.orig.x + op.orig.w / 2;
        const cy = op.orig.y + op.orig.h / 2;
        const a0 = Math.atan2(op.startY - cy, op.startX - cx);
        const a1 = Math.atan2(cur.y - cy, cur.x - cx);
        const raw = (op.orig.rotation || 0) + ((a1 - a0) * 180) / Math.PI;
        next.rotation = ev.shiftKey ? Math.round(raw / 15) * 15 : round(raw % 360);
      }
      // Editing is free: an element may sit fully inside the page, straddle its
      // edge, or move entirely outside it. Only export clips content to the
      // page rectangle. We keep a generous soft boundary so the user can freely
      // position elements outside the page area when needed.
      const workspaceMargin = 120; // extra workspace area around page (mm)
      const workspaceW = size.w + workspaceMargin * 2;
      const workspaceH = size.h + workspaceMargin * 2;
      next.w = Math.max(clamp(next.w, MIN_SIZE, workspaceW), MIN_SIZE);
      next.h = Math.max(clamp(next.h, MIN_SIZE, workspaceH), MIN_SIZE);
      // Soft boundary: allow elements to extend beyond page but keep them
      // within a generous workspace area so nothing disappears unexpectedly.
      next.x = Math.max(-workspaceMargin, Math.min(next.x, size.w + workspaceMargin - next.w));
      next.y = Math.max(-workspaceMargin, Math.min(next.y, size.h + workspaceMargin - next.h));
      replaceElement(op.parent ? { ...next, x: next.x - op.parent.x, y: next.y - op.parent.y } : next, true);
    };

    const up = () => {
      opRef.current = null;
      setGuides({ v: [], h: [] });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * Elements a click or marquee can pick, in the current grouping context.
   *
   * Outside a group that is the top-level list — a group counts as one element.
   * Once the author steps into a group, its members become pickable instead, at
   * their absolute page positions.
   */
  const pickables = (page: Page): { id: string; box: Box }[] => {
    const entered = enteredGroupId ? findElement(page.elements, enteredGroupId)?.el || null : null;
    if (entered?.children?.length) {
      return entered.children.map((child) => ({
        id: child.id,
        box: { x: entered.x + child.x, y: entered.y + child.y, w: child.w, h: child.h },
      }));
    }
    return page.elements.map((el) => ({ id: el.id, box: { x: el.x, y: el.y, w: el.w, h: el.h } }));
  };

  /**
   * The element the contextual toolbar formats: the primary selection, resolved
   * through the current grouping context so a group member gets its own tools.
   */
  const activePageForSelection = pages.find((p) => p.id === activePageId);
  const primarySelection = (() => {
    if (!selectedId || !activePageForSelection) return null;
    const found = findElement(activePageForSelection.elements, selectedId)?.el;
    return found && !found.hidden ? found : null;
  })();

  /** Rubber-band selection on empty page space, or a drawn text box when armed. */
  const startMarquee = (e: React.PointerEvent, page: Page) => {
    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) => pagePoint(rect, size, ev.clientX, ev.clientY);
    const start = toMm(e);
    if (drawArmed) {
      let done = false;
      const move = (ev: PointerEvent) => {
        const cur = toMm(ev);
        setMarquee({ x0: start.x, y0: start.y, x1: cur.x, y1: cur.y });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (done) return;
        done = true;
        const end = toMm(ev);
        setMarquee(null);
        setDrawArmed(false);
        const w = Math.max(MIN_SIZE, Math.abs(end.x - start.x));
        const h = Math.max(MIN_SIZE, Math.abs(end.y - start.y));
        const id = addTextAt(
          { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w, h },
          page.id,
        );
        if (id) {
          // The box opens for typing immediately — the drawn rectangle IS the
          // text element, so editing starts as soon as the pointer is up.
          requestAnimationFrame(() => requestEdit(page.id, id));
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    const additive = e.shiftKey;
    const before = additive ? [...selectedIds] : [];
    const candidates = pickables(page);
    let moved = false;

    const move = (ev: PointerEvent) => {
      const cur = toMm(ev);
      moved = true;
      const box: Box = {
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      };
      setMarquee({ x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h });
      // Intersection, not full containment: brushing across a row of elements is
      // the gesture people actually use to grab them all.
      const hits = candidates
        .filter(
          (p) =>
            p.box.x < box.x + box.w &&
            p.box.x + p.box.w > box.x &&
            p.box.y < box.y + box.h &&
            p.box.y + p.box.h > box.y,
        )
        .map((p) => p.id);
      selectMany([...before, ...hits.filter((id) => !before.includes(id))]);
    };

    const up = (ev: PointerEvent) => {
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // A press with no drag is a plain click on empty space, which clears the
      // selection the way every design tool does — left button only, so a
      // right-click never wipes the selection its menu is about to act on.
      if (!moved && !additive && ev.button === 0) select(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={stageRef}
      className={cn(
        "editor-canvas-stage studio-grid relative min-h-0 min-w-0 overflow-auto px-6 py-8",
        dropping && "is-dropping",
        drawArmed && "draw-armed",
      )}
      style={{ "--editor-zoom": zoom } as React.CSSProperties}
      dir="ltr"
      onPointerDownCapture={(e) => {
        if (!spaceDown.current || !stageRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const stage = stageRef.current;
        const startX = e.clientX;
        const startY = e.clientY;
        const scrollLeft = stage.scrollLeft;
        const scrollTop = stage.scrollTop;
        const move = (event: PointerEvent) => {
          stage.scrollLeft = scrollLeft - (event.clientX - startX);
          stage.scrollTop = scrollTop - (event.clientY - startY);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      /*
       * Click-to-deselect is a LEFT-button gesture. Clearing on every button
       * meant the right-click itself wiped the multi-selection a moment before
       * its context menu opened — so تجميع/فك التجميع vanished from the
       * empty-space menu even with several elements selected.
       */
      onPointerDown={(e) => {
        // Floating drawers close on any canvas press — including a press that
        // starts a marquee or grabs an element, because on a tablet the tap
        // means "get the panel out of my way", not "deselect".
        onCanvasTap?.();
        if (e.button === 0) select(null);
      }}
      /* Two-finger pan and pinch-to-zoom are owned by the native touch effect
         above, so a trackpad (browser scroll) and a touchscreen behave the
         same way without two competing handlers. */
      onDragOver={(e) => {
        /*
         * Two kinds of drop land here: an image file from the OS, and a card
         * dragged out of the smart library. Both must claim the gesture (that
         * is what stops the browser from navigating to the file), but only the
         * library payload should insert anything on `drop`.
         */
        const isFile = e.dataTransfer.types.includes("Files");
        const isLibrary = e.dataTransfer.types.includes(LIBRARY_DND_MIME);
        if ((!onDropImage || !isFile) && !isLibrary) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(isLibrary ? "library" : "file");
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropping(null);
      }}
      onDrop={(e) => {
        setDropping(null);
        // Library card: place it exactly where it was dropped, on whichever
        // page received it.
        const payload = parseLibraryDrop(e.dataTransfer.getData(LIBRARY_DND_MIME));
        if (payload) {
          e.preventDefault();
          const at = dropPoint(e);
          if (at) setActivePage(at.pageId);
          insertLibraryDrop(payload, at ? { x: at.x, y: at.y } : null, (type, over, center) => {
            const el = addElementAt(type as ElType, over as Partial<CanvasEl>, center);
            return el ? { x: el.x, y: el.y, w: el.w, h: el.h } : undefined;
          });
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
        <div className="pointer-events-none sticky top-0 z-50 mx-auto w-max rounded-full border border-gold/40 bg-white/95 px-4 py-1.5 text-[11px] font-extrabold text-navy shadow-sm dark:bg-[#161c26] dark:text-gold-2">
          {dropping === "library" ? "أفلت العنصر ليُضاف في هذا الموضع" : "أفلت الصورة لإضافتها إلى الصفحة"}
        </div>
      )}
      <div className="mx-auto flex w-max min-w-full flex-col items-center gap-3" dir="rtl">
        {visible.map((page) => {
          const size = pageSize(page);
          const isActive = page.id === activePageId;
          const entered = enteredGroupId ? findElement(page.elements, enteredGroupId)?.el || null : null;
          const enteredKids = entered?.children ?? [];
          /*
           * Selection/manipulation frames for this page, in the grouping
           * context the author is in (group members at their absolute page
           * positions). They render in a dedicated overlay layer above every
           * document element so overlapping artwork can never block the
           * selection outline, the handles or a drag on the selected element.
           */
          const selectionFrames: SelectionBox[] = [];
          if (isActive) {
            if (entered && enteredKids.length) {
              for (const child of enteredKids) {
                if (selectedSet.has(child.id) && !child.hidden) {
                  selectionFrames.push({
                    el: { ...child, x: entered.x + child.x, y: entered.y + child.y },
                    parent: { x: entered.x, y: entered.y },
                  });
                }
              }
            } else {
              for (const el of page.elements) {
                if (selectedSet.has(el.id) && !el.hidden && el.id !== entered?.id) {
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
              <div className="page-frame-content" dir="ltr" style={{ width: `${size.w}mm`, height: `${size.h + 12}mm`, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
              <div className="mb-2 flex items-center justify-between gap-4 text-[12px] text-muted" dir="rtl">
                <strong className="text-ink dark:text-white">
                  {page.name}
                  {entered && <span className="ms-2 font-semibold text-gold-2">· داخل «{entered.name}»</span>}
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
                style={{ width: `${size.w}mm`, height: `${size.h}mm`, background: page.bg || "#fff" }}
                onPointerDown={(e) => {
                  // Only a press on the page itself starts a marquee; presses on
                  // elements are handled by the element and stop propagation.
                  if (e.target !== e.currentTarget) return;
                  e.stopPropagation();
                  setActivePage(page.id);
                  // A right press only opens the context menu — it must not
                  // start a marquee (whose plain-click branch would clear the
                  // selection from under the menu about to open).
                  if (e.button !== 0) return;
                  startMarquee(e, page);
                }}
              >
                {page.elements
                  .slice()
                  .sort((a, b) => a.z - b.z)
                  .map((el) => {
                    // Stepped into this group: its frame is drawn for context and
                    // its members become individually selectable nodes, instead of
                    // the group behaving as one opaque element.
                    if (entered && el.id === entered.id && enteredKids.length) {
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
                              const abs = { ...child, x: entered.x + child.x, y: entered.y + child.y };
                              return (
                                <ElementNode
                                  key={child.id}
                                  el={abs}
                                  interactive
                                  onPointerDown={(ev, kind, handle) => startOp(ev, page, abs, kind, handle, { x: entered.x, y: entered.y })}
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
                        interactive
                        onEnterGroup={el.type === "group" ? () => enterGroup(el.id) : undefined}
                        onPointerDown={(ev, kind, handle) => startOp(ev, page, el, kind, handle)}
                      />
                    );
                  })}
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
                    <OverflowFlag key={el.id} el={el} onFit={() => fitTextBox(el.id)} />
                  ))}
                {isActive &&
                  guides.v.map((x) => <div key={`v${x}`} className="guide-v" style={{ left: `${x}mm` }} />)}
                {isActive &&
                  guides.h.map((y) => <div key={`h${y}`} className="guide-h" style={{ top: `${y}mm` }} />)}
                {isActive &&
                  selectionFrames.length > 0 && (
                    <div className="selection-layer" style={{ zIndex: SELECTION_LAYER_Z }}>
                      {selectionFrames.map((frame) => (
                        <SelectionFrame
                          key={frame.el.id}
                          frame={frame}
                          primary={selectedIds.length === 1}
                          editing={editingId === frame.el.id}
                          onGesture={(ev, kind, handle) =>
                            startOp(ev, page, frame.el, kind, handle, frame.parent)
                          }
                          onEditRequest={() => requestEdit(page.id, frame.el.id)}
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
      {/*
        * Phase 4 — floating contextual toolbar.
        *
        * Rendered for a single selected element (the primary selection), and
        * hidden while the caret is inside a text node so it never competes with
        * in-place editing. It lives in a FIXED overlay — outside the scaled page
        * — so its buttons keep a constant screen size and its 16px gap is real.
        */}
      {primarySelection && editingId !== primarySelection.id && <FloatingToolbar el={primarySelection} />}

      <ExportCapture pages={pages} />
    </div>
  );
}

/**
 * Overflow marker for an element whose text does not fit its box.
 *
 * Drawn as a sibling of the element rather than inside it, because `.canvas-el`
 * clips its own content — a badge placed inside would be cut off by exactly the
 * element it is warning about. Clicking it applies the fix.
 */
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

/** A selected element to draw a manipulation frame for, plus its group offset. */
interface SelectionBox {
  /** Absolute page-space geometry (group members already offset). */
  el: CanvasEl;
  /** Group-relative coordinate offset, when stepping inside a group. */
  parent?: { x: number; y: number };
}

/**
 * Manipulation frame for one selected element, rendered in the selection layer.
 *
 * This is the editor's separation of concerns in practice: the document layer
 * (ElementNode) paints content in z-order, while this frame — always above all
 * artwork — owns selection chrome and pointer interaction for the selection.
 * Overlapping elements can never steal its handles, its drag, or its outline.
 *
 * The frame mirrors the element's box and rotation exactly, so the handles sit
 * on the true rotated corners; `--editor-zoom` keeps their screen size stable
 * at every zoom level.
 */
function SelectionFrame({
  frame,
  primary,
  editing,
  onGesture,
  onEditRequest,
}: {
  frame: SelectionBox;
  primary: boolean;
  editing: boolean;
  onGesture: (e: React.PointerEvent, kind: "move" | "resize" | "rotate", handle?: string) => void;
  onEditRequest: () => void;
}) {
  const select = useEditor((s) => s.select);
  const el = frame.el;
  return (
    <div
      className={cn(
        "selection-frame",
        !primary && "is-secondary",
        el.locked && "is-locked",
        editing && "is-editing",
      )}
      /*
       * Carry the element id: the workspace context menu resolves its target
       * with `closest("[data-el-id]")`, and the frame — not the element node —
       * is what a right-click on SELECTED artwork actually lands on. Without
       * this the menu opened as the empty-space menu (paste/select-all) even
       * though the author was pointing at an element.
       */
      data-el-id={el.id}
      style={{
        left: `${el.x}mm`,
        top: `${el.y}mm`,
        width: `${el.w}mm`,
        height: `${el.h}mm`,
        transform: `rotate(${el.rotation || 0}deg)`,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".handle, .rotate-handle")) return;
        e.stopPropagation();
        if (el.locked) {
          select(el.id);
          return;
        }
        onGesture(e, "move");
      }}
      onDoubleClick={(e) => {
        // Text editing, group stepping: delegate to the element node itself so
        // there is exactly one edit pathway, never a duplicate.
        e.stopPropagation();
        onEditRequest();
      }}
    >
      {primary && !el.locked && !editing && (
        <>
          {HANDLES.map((h) => (
            <div
              key={h}
              className={cn("handle", h)}
              onPointerDown={(e) => {
                e.stopPropagation();
                onGesture(e, "resize", h);
              }}
            />
          ))}
          <div
            className="rotate-handle"
            onPointerDown={(e) => {
              e.stopPropagation();
              onGesture(e, "rotate");
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Forward a double-click on the manipulation frame to the element node beneath
 * it, which owns in-place text editing and group stepping. Dispatching a real
 * `dblclick` keeps one editing implementation instead of duplicating it in the
 * overlay.
 */
function requestEdit(pageId: string, elId: string) {
  const host = document.querySelector<HTMLElement>(`[data-page-id="${pageId}"]`);
  const node = host?.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(elId)}"]`);
  node?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
}

/**
 * Hidden 1:1 pages used by export capture. Rendered off-screen (not
 * `display:none`) so html2canvas still measures real boxes and loads images.
 */
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
            style={{ width: `${size.w}mm`, height: `${size.h}mm`, background: page.bg || "#fff" }}
          >
            {page.elements
              .slice()
              .sort((a, b) => a.z - b.z)
              .map((el) => (
                <ElementNode key={el.id} el={el} interactive={false} onPointerDown={() => {}} />
              ))}
          </div>
        );
      })}
    </div>
  );
}
