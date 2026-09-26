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
import { zoomAnchoredAt } from "@/lib/editor/viewport";
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

type Op = {
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
} | null;

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
/**
 * Print guides sit just under the selection chrome: above every document
 * element (1..n), below the outline and handles that must stay grabbable.
 */
const GUIDE_LAYER_Z = SELECTION_LAYER_Z - 1;
/** The eight resize handles, named by the corner/edge they sit on. */
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
/** Corner rotation grips (step 7). */
const ROTATE_HANDLES = ["nw", "ne", "se", "sw"] as const;

/**
 * Snap a raw drag angle.
 *
 * `Shift` engages the ladder: 15° steps with a strong pull onto the cardinal
 * lines (0/45/90/…) — the multiples an author actually wants — while a plain
 * drag stays continuous at 1° for fine alignment. Both branches normalise into
 * (−180, 180] so the readout never shows 359° where −1° is meant.
 */
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
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({
    v: [],
    h: [],
  });
  /** Live angle readout shown next to the pointer while rotating (step 7). */
  const [rotationHint, setRotationHint] = useState<{
    angle: number;
    shift: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [marquee, setMarquee] = useState<Marquee>(null);
  /** Which drop gesture is hovering: an image file, a library card, or none. */
  const [dropping, setDropping] = useState<"file" | "library" | null>(null);
  /**
   * The active drawing tool. `null` is the select/move tool (V).
   *
   * Kept in the canvas because only the canvas knows page geometry (zoom + the
   * active artboard rect). Everything else broadcasts through the
   * `nasaq:tool` / `nasaq:draw-text` window events, so there is exactly one
   * owner of "which tool is armed" and no second source of truth to sync.
   */
  const [drawTool, setDrawTool] = useState<"text" | "rect" | null>(null);
  const drawArmed = drawTool !== null;
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /*
   * Tool arming. «نص بالرسم» from the toolbar and `T` / `R` / `V` from the
   * keyboard all land here; Escape is the way out without drawing anything.
   */
  useEffect(() => {
    const armText = () => setDrawTool("text");
    const onTool = (event: Event) => {
      const detail = (event as CustomEvent<"text" | "rect" | null>).detail;
      setDrawTool(detail ?? null);
    };
    const disarm = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawTool(null);
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
      const next = Math.min(
        2,
        Math.max(0.2, prev + (e.deltaY < 0 ? 0.06 : -0.06)),
      );
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
      distance: Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      ),
    });

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        touchPan.current = null;
        return;
      }
      /*
       * A live element gesture (drag / resize / rotate / long-press) snapshotted
       * its page rect at press time — zooming mid-drag would desynchronise the
       * coordinates and throw the element. Navigation waits until it ends.
       */
      if (opRef.current) {
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
      /*
       * A live element gesture (drag / resize / rotate) owns the touch: claim
       * EVERY move while it is in flight — including a second finger that
       * lands mid-drag — so the browser's own pan/pinch never takes the touch
       * over and cancels the element drag with a pointercancel. The element
       * keeps tracking the original pointer through its own capture.
       */
      if (opRef.current) {
        event.preventDefault();
        return;
      }
      if (!state || event.touches.length !== 2) return;
      /*
       * Claim EVERY move the moment a second finger exists — before the mode
       * is decided. That freezes the browser's own one-finger pan and its
       * pinch-zoom for the whole gesture (touch-action already forbids
       * pinch-zoom on the stage), so the page never zooms or scrolls
       * underneath the canvas zoom that is about to run.
       */
      event.preventDefault();
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

  /*
   * Apple Pencil layer: palm-rejection bookkeeping, hover affordance and the
   * iOS-only gesture events.
   *
   *  · Pen activity is tracked at WINDOW level in the capture phase, so a palm
   *    landing anywhere (over a panel, over the artboard) is evaluated
   *    against the same pen state every gesture entry point reads.
   *  · Hover: iPadOS reports a hovering Pencil as pointermove with
   *    pointerType "pen" but does not flip CSS :hover for it — the canvas
   *    keeps its own hairline highlight on the element under the tip.
   *  · `gesturestart/gesturechange` are Safari's proprietary pinch that zooms
   *    the whole PAGE regardless of Pointer Events — the canvas claims them.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const track = (event: Event) =>
      notePenActivity(event as PointerEvent);
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
    const onPenLeave = (event: PointerEvent) => {
      if (event.pointerType === "pen") clearPenHover();
    };
    stage.addEventListener("pointermove", onPenMove);
    stage.addEventListener("pointerleave", onPenLeave);

    // A lost window (app switch) can strand pen-down state and lock touch out.
    const onBlur = () => {
      clearPenHover();
      resetPenInput();
    };
    window.addEventListener("blur", onBlur);

    const claim = (event: Event) => event.preventDefault();
    const GESTURE_EVENTS = [
      "gesturestart",
      "gesturechange",
      "gestureend",
    ] as const;
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

  /**
   * Translate a drop point into page millimetres.
   *
   * The drop target is resolved from the element under the pointer rather than
   * a ref, because the author may drop onto any page — including one that is not
   * the active page in the all-pages preview.
   */
  const dropPoint = (
    e: React.DragEvent,
  ): { x: number; y: number; pageId: string } | null => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-page-id]",
    );
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
    /*
     * Palm rejection FIRST: a resting palm must not dismiss drawers, clear the
     * selection or start any gesture — swallow the contact outright (stopping
     * propagation so the stage's click-to-deselect never sees it either).
     */
    if (isPalmTouch(e)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
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
    if (el.resizeLocked && kind === "resize") {
      /*
       * The resize lock rejects only the resize gesture: the press still
       * selects the element, and move / rotate / edit keep working exactly as
       * before — only width/height are protected.
       */
      e.stopPropagation();
      e.preventDefault();
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

    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    // Snapshot the live page geometry once: reading it per pointermove would
    // force a layout on every frame of a drag.
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) =>
      pagePoint(rect, size, ev.clientX, ev.clientY);

    const start = toMm(e);
    /** Movement before a deferred press commits counts as a drag (~4 CSS px). */
    const slopMm = Math.max(0.2, (4 * size.w) / Math.max(1, rect.width));
    /** Largest distance the pointer has travelled from the press point. */
    let maxDist = 0;

    // When inside a group, children live in entered.children with
    // group-relative coordinates; otherwise they're in page.elements. Hoisted
    // out of the gesture itself: both `beginGesture` (origins) and the live
    // `move` handler (sibling follow-along) read the same context.
    const enteredGroup = enteredGroupId
      ? findElement(page.elements, enteredGroupId)?.el || null
      : null;
    const enteredChildren = enteredGroup?.children || [];

    /*
     * Selection timing, per input:
     *
     *  · mouse (and Shift, which implies a keyboard): decide IMMEDIATELY, with
     *    the classic rules — shift extends, a member of a multi-selection
     *    keeps the group draggable, anything else replaces;
     *  · touch / Pencil without Shift: DEFER the decision — a plain tap
     *    applies the same rules on pointerup, crossing the slop starts a drag
     *    with those rules, and a press-and-hold toggles the element in/out of
     *    the selection (the keyboard-less twin of Shift+click for adding and
     *    removing elements).
     *
     * Deferring is what makes multi-touch selection honest: the gesture never
     * steals the selection on touchdown, so a hold can mean "add/remove"
     * instead of always meaning "replace".
     */
    const defer =
      kind === "move" &&
      !e.shiftKey &&
      (e.pointerType === "touch" || e.pointerType === "pen");
    let decided = !defer;
    let heldLong = false;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * The press-selection rules. Reads the LIVE store so the deferred path
     * (timer / slop) sees the same state a mouse press would have seen — the
     * outcome is identical to the old immediate evaluation.
     */
    const applyPressSelection = () => {
      const fresh = useEditor.getState();
      if (e.shiftKey) toggleSelect(el.id);
      else if (!fresh.selectedIds.includes(el.id)) select(el.id);
      // Anything already inside a multi-selection stays selected, so the
      // press can carry the whole group.
    };

    /**
     * Decide selection + snapshot every element the gesture moves. Called at
     * press time for a mouse, at slop time for a touch/pen drag.
     */
    const beginGesture = () => {
      applyPressSelection();
      const fresh = useEditor.getState();
      const live = new Set(fresh.selectedIds);

      // The elements this gesture moves. A resize or rotate handle only ever
      // acts on the pressed element; a plain drag carries the whole selection
      // unless the press was a shift-toggle, which is a selection change and
      // not a drag.
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

    if (decided) {
      beginGesture();
    } else {
      // Touch/pen: hold to toggle selection membership (add when absent,
      // remove when part of a multi-selection). Fires only if the pointer has
      // not already broken the slop into a drag.
      tapTimer = setTimeout(() => {
        tapTimer = undefined;
        if (decided) return;
        decided = true;
        heldLong = true;
        const fresh = useEditor.getState();
        const had = fresh.selectedIds.includes(el.id);
        if (!had) {
          toggleSelect(el.id);
          toast.info("تمت إضافة العنصر إلى التحديد");
        } else if (fresh.selectedIds.length > 1) {
          toggleSelect(el.id);
          toast.info("تمت إزالة العنصر من التحديد");
        }
        // A sole selection stays selected: a hold on it means "still selected".
      }, 450);
    }

    const others = page.elements.filter((x) => x.id !== el.id && !x.hidden);

    const move = (ev: PointerEvent) => {
      if (!decided) {
        const cur = toMm(ev);
        const dist = Math.hypot(cur.x - start.x, cur.y - start.y);
        // A few px of finger wobble during a press must not become a drag…
        if (dist < slopMm) return;
        // …but once it does, the gesture starts with the classic rules.
        decided = true;
        if (tapTimer !== undefined) {
          clearTimeout(tapTimer);
          tapTimer = undefined;
        }
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
        // Shift (or the element's own aspect lock) preserves the element's
        // current aspect ratio; a plain drag resizes freely.
        resizeByHandle(
          next,
          op.orig,
          // A mirrored element is drawn flipped, so the grip the author grabbed
          // must drive the opposite edge (step 7). `mirrorHandle` maps it.
          mirrorHandle(
            op.handle || "se",
            op.orig.style?.flipX === true,
            op.orig.style?.flipY === true,
          ),
          dx,
          dy,
          ev.shiftKey || op.orig.style?.aspectLock === true,
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
      // Editing is free: an element may sit fully inside the page, straddle its
      // edge, or move entirely outside it. Only export clips content to the
      // page rectangle. We keep a generous soft boundary so the user can freely
      // position elements outside the page area when needed. The stage pads
      // each artboard by the same margin (WORKSPACE_MARGIN_MM), so every
      // reachable position stays visible and grabbable.
      const workspaceW = size.w + WORKSPACE_MARGIN_MM * 2;
      const workspaceH = size.h + WORKSPACE_MARGIN_MM * 2;
      next.w = Math.max(clamp(next.w, MIN_SIZE, workspaceW), MIN_SIZE);
      next.h = Math.max(clamp(next.h, MIN_SIZE, workspaceH), MIN_SIZE);
      // Soft boundary: allow elements to extend beyond page but keep them
      // within the generous workspace area the stage makes reachable.
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
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (tapTimer !== undefined) {
        clearTimeout(tapTimer);
        tapTimer = undefined;
      }
    };

    const up = (ev: PointerEvent) => {
      // A gesture existed only if `beginGesture` ran: taps and holds never
      // touch document content, so they skip `commit()` instead of padding
      // the undo stack with no-op snapshots (a free cleanup for mouse taps
      // too — they behave exactly as before otherwise).
      const hadGesture = opRef.current !== null;
      if (!decided) {
        decided = true;
        // Plain tap on touch/pen: apply the classic selection rules now.
        applyPressSelection();
      }
      detach();
      const wasTap = !heldLong && maxDist < slopMm;
      if (
        wasTap &&
        (ev.pointerType === "touch" || ev.pointerType === "pen") &&
        noteElementTap(el.id, ev.pointerType)
      ) {
        // Second quick tap: text edit / step into the group — the touch twin
        // of double-click, dispatched through the same single edit pathway.
        fireSyntheticDoubleClick(el.id);
      }
      opRef.current = null;
      setRotationHint(null);
      setGuides({ v: [], h: [] });
      if (hadGesture) commit();
    };

    /*
     * Safari cancels pointers it takes over (system gesture, incoming call,
     * palm/edge rejection) without a pointerup — without this the op would
     * stay armed, window listeners would leak, and the element would keep
     * tracking a finger that is no longer there.
     */
    const cancel = () => {
      const hadGesture = opRef.current !== null;
      detach();
      opRef.current = null;
      setRotationHint(null);
      setGuides({ v: [], h: [] });
      // A cancelled drag commits the geometry reached so far — it is still on
      // screen, so it must be undoable like any other drag.
      if (hadGesture) commit();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  /**
   * Elements a click or marquee can pick, in the current grouping context.
   *
   * Outside a group that is the top-level list — a group counts as one element.
   * Once the author steps into a group, its members become pickable instead, at
   * their absolute page positions.
   */
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
    // Palm on the artboard: no marquee, no deselect, no drawer dismissal.
    if (isPalmTouch(e)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) =>
      pagePoint(rect, size, ev.clientX, ev.clientY);
    const start = toMm(e);
    if (drawTool) {
      const move = (ev: PointerEvent) => {
        const cur = toMm(ev);
        setMarquee({ x0: start.x, y0: start.y, x1: cur.x, y1: cur.y });
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
      };
      const up = (ev: PointerEvent) => {
        finish();
        const end = toMm(ev);
        setMarquee(null);
        setDrawTool(null);
        const w = Math.max(MIN_SIZE, Math.abs(end.x - start.x));
        const h = Math.max(MIN_SIZE, Math.abs(end.y - start.y));
        const box = {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w,
          h,
        };
        if (drawTool === "rect") {
          // `over` wins over the computed position inside `addElementAt`, so the
          // rectangle lands exactly where it was drawn — not centred.
          addElementAt("box", box);
          return;
        }
        const id = addTextAt(box, page.id);
        if (id) {
          // The box opens for typing immediately — the drawn rectangle IS the
          // text element, so editing starts as soon as the pointer is up.
          requestAnimationFrame(() => requestEdit(page.id, id));
        }
      };
      // Interrupted (system gesture / palm): drop the preview, arm nothing.
      const cancel = () => {
        finish();
        setMarquee(null);
        setDrawTool(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
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
      setMarquee({
        x0: box.x,
        y0: box.y,
        x1: box.x + box.w,
        y1: box.y + box.h,
      });
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

    const finish = () => {
      setMarquee(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };

    const up = (ev: PointerEvent) => {
      finish();
      // A press with no drag is a plain click on empty space, which clears the
      // selection the way every design tool does — left button only, so a
      // right-click never wipes the selection its menu is about to act on.
      if (!moved && !additive && ev.button === 0) select(null);
    };

    // A cancelled marquee (Safari took the gesture over) ends silently: the
    // rubber band disappears, the selection the band had built stays as-is,
    // and no phantom "click" clears anything.
    const cancel = () => {
      finish();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
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
      onPointerDownCapture={(e) => {
        if (isPalmTouch(e)) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
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
        // A palm resting on the bare workspace is not a click: no drawer
        // dismissal, no deselect.
        if (isPalmTouch(e)) return;
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
        // Graphic heading drag: precise placement
        const graphicId = e.dataTransfer.getData(GRAPHIC_HEADING_MIME);
        if (graphicId) {
          e.preventDefault();
          const at = dropPoint(e);
          if (at) {
            setActivePage(at.pageId);
            const store = useEditor.getState();
            // @ts-ignore
            if (store.insertGraphicHeadingAt) store.insertGraphicHeadingAt(graphicId as any, { x: at.x, y: at.y });
          }
          return;
        }
        // Library card: place it exactly where it was dropped, on whichever
        // page received it.
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
        /*
         * Workspace reachability: the drag clamp lets elements live up to
         * WORKSPACE_MARGIN_MM outside the artboard on every side; the scroller
         * must make that same band visible and scrollable, or an element
         * dragged off the sheet could not be grabbed again to bring it back in.
         * Padding the column by the margin (× zoom, because the page frame is
         * already zoom-scaled in mm) aligns the reachable scroll area with the
         * clamp exactly — mouse, touch and Pencil all grab the element the same
         * way, on its own node, regardless of the artboard edge.
         */
        style={{ padding: `${WORKSPACE_MARGIN_MM * zoom}mm` }}
      >
        {visible.map((page) => {
          const size = pageSize(page);
          const isActive = page.id === activePageId;
          /* 1-based document position — `visible` may hold a single page. */
          const pageNo = pages.findIndex((p) => p.id === page.id) + 1;
          const entered = enteredGroupId
            ? findElement(page.elements, enteredGroupId)?.el || null
            : null;
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
                  /*
                   * Content protection, scoped to the artboard ONLY (site UI
                   * outside keeps native behaviour):
                   *  • right-click never opens the browser menu here ("Save
                   *    Image As" disappears with it) — the custom NASAQ menu
                   *    still opens because this only prevents the default and
                   *    lets the event bubble up to the workspace handler;
                   *  • native HTML5 drags cannot start from document content,
                   *    so an image/selection cannot be dropped onto the
                   *    desktop. Element moving/resizing uses pointer events
                   *    and incoming library/file drops use dragover+drop, so
                   *    neither is affected. Editing inside a contentEditable
                   *    keeps its native drag behaviour.
                   */
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
                    // Only a press on the page itself starts a marquee; presses on
                    // elements are handled by the element and stop propagation.
                    if (e.target !== e.currentTarget) return;
                    // Palm on the artboard: swallow it — no marquee, and no
                    // fall-through to the stage's click-to-deselect either.
                    if (isPalmTouch(e)) {
                      e.stopPropagation();
                      e.preventDefault();
                      return;
                    }
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
                  {/*
                   * Live rotation readout. Rendered inside the (clipped) page for
                   * simplicity but positioned from client coordinates, so it never
                   * adds a layout box to the artboard.
                   */}
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
      {/*
       * Phase 4 — floating contextual toolbar.
       *
       * Rendered for a single selected element (the primary selection), and
       * hidden while the caret is inside a text node so it never competes with
       * in-place editing. It lives in a FIXED overlay — outside the scaled page
       * — so its buttons keep a constant screen size and its 16px gap is real.
       */}
      {primarySelection &&
        editingId !== primarySelection.id &&
        bubbleEnabled &&
        /*
         * Never competing with a modal surface: while the export dialog, the
         * page manager or a context menu is open the bubble is hidden outright,
         * so it cannot sit on a dialog (which is what "never overlaps active
         * dialogs" means in practice — the dialog owns the screen then).
         */
        !exportOpen &&
        !pageManagerOpen &&
        !contextMenu && <FloatingToolbar el={primarySelection} />}

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
  onGesture: (
    e: React.PointerEvent,
    kind: "move" | "resize" | "rotate",
    handle?: string,
  ) => void;
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
        el.resizeLocked && "is-resize-locked",
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
        transform: `rotate(${el.rotation || 0}deg)${el.style?.flipX ? " scaleX(-1)" : ""}${el.style?.flipY ? " scaleY(-1)" : ""}`,
      }}
      onPointerDown={(e) => {
        // Palm rejection also covers the manipulation frame: a resting hand
        // must not drag the selection or steal it from under the pen.
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
        // Text editing, group stepping: delegate to the element node itself so
        // there is exactly one edit pathway, never a duplicate.
        e.stopPropagation();
        onEditRequest();
      }}
    >
      {/*
       * Resize handles render only while the element's own resize lock is off
       * — the badge below marks the locked state so their absence reads as a
       * deliberate lock, not as missing chrome. Move, rotate and text editing
       * are all still available on a resize-locked element.
       */}
      {primary && !el.locked && !editing && !el.resizeLocked && (
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
          {/*
           * Step 7 — a rotation grip on EVERY corner, not just the top edge,
           * so the element can be spun with whichever hand is already there.
           * Mirroring the frame (flipX/flipY) is handled by CSS, so the grips
           * always sit on the corners the author can see.
           */}
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
        </>
      )}
      {/*
       * The resize lock must not hide the rotation grips: rotation changes
       * orientation, not size, so it stays fully available next to the badge.
       */}
      {primary && !el.locked && !editing && el.resizeLocked && (
        <>
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
          <span
            className="resize-lock-badge"
            title="التحجيم مقفل — فك القفل من القائمة السياقية أو الخصائص"
          >
            🔒
          </span>
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
