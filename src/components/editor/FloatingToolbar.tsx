import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeftRight,
  ArrowUpDown,
  Bold,
  Copy,
  Layers2,
  Crop,
  Image,
  ImagePlus,
  Sparkles,
  Sun,
  Group,
  Ungroup,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Ratio,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Lock,
  Maximize2,
  MoreHorizontal,
  Move,
  Paintbrush,
  Palette,
  RotateCcw,
  RotateCw,
  Scaling,
  Trash2,
  Underline,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import { fitBoxToPage, type FitPageMode } from "@/lib/editor/fit-page";
import { pageSize } from "@/lib/editor/model";
import { TYPE_NAME, type CanvasEl } from "@/lib/editor/model";
import { useEditor } from "@/lib/editor/store";
import { useInteraction } from "@/lib/editor/interaction-store";
import { strokeBinding } from "@/lib/editor/stroke";
import { bubbleLayout, placeFloatingToolbar } from "@/lib/editor/ui-state";
import { cn } from "@/lib/utils";
import { StrokeControls, StrokeField } from "./StrokeControls";
import { ScrubInput } from "./ui/ScrubInput";
import { FillField } from "./ui/FillField";
import { beginImageCrop } from "@/lib/editor/crop-session";
import { snapshotPage, snapshotSelection } from "@/lib/editor/render-snapshot";
import { toast } from "sonner";
import type { Gradient } from "@/lib/editor/gradient";
import { ColorField } from "./ui/ColorField";
import { Tip } from "./ui/Tip";
import {
  AnchorMenu,
  MenuCell,
  MenuGrid,
  MenuGroup,
  MenuRow,
} from "./ui/AnchorMenu";
import { AlignIcon } from "./ui/AlignIcon";
import type { AlignEdge } from "@/lib/editor/model";

/** Elements that render an editable text body. */
const TEXT_TYPES = new Set(["text", "box", "stat", "stamp", "progress"]);

/** Gap between the selection interaction bounds and the toolbar. */
const GAP = 16;
/** Minimum distance from the viewport edges. */
const MARGIN = 8;
/** Widest lane the bubble is ever asked to fill (`ui-state` folds beyond it). */
const MAX_LANE = 760;

/**
 * The contextual selection toolbar.
 *
 * It appears only while something is selected, and it shows only what that
 * selection can use. The bar itself is ONE row of fixed 32px cells whose
 * contents are chosen by `bubbleLayout()` from the free lane beside the
 * artwork — so its rectangle is a function of the viewport and the selection
 * KIND, never of a font name, a tooltip or the drawer that happens to be open.
 * Everything that does not fit leaves the bar for one of two drawers:
 *
 *   • the group drawer (the palette icon) — the complete set of formatting
 *     controls for this kind of element, live and movable;
 *   • «المزيد» — arrange, transform, opacity, the style clipboard and equal
 *     sizing, which no selection needs in the first second.
 *
 * Nothing is dropped: every control that used to sit in the bar is still one
 * press away, and both drawers can be moved, closed and reopened.
 *
 * Anchor maths are done in SCREEN space (a `getBoundingClientRect` of the live
 * element), never from the element's mm geometry — that is what keeps the
 * toolbar glued to the artwork through zoom, scroll and rotation, and it makes
 * the whole computation RTL-agnostic: physical pixels have no direction. The
 * only RTL-sensitive part is the toolbar's own content, which stays `dir="rtl"`
 * so Arabic labels read correctly.
 *
 * The same option sets the properties panel uses are reused here
 * (`fontChoices`, `updateStyle`, `updateElement`), so there is no second
 * formatting model.
 */
export function FloatingToolbar({
  el,
  pageId,
}: {
  el: CanvasEl;
  pageId: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const automaticPosRef = useRef<{ left: number; top: number } | null>(null);
  /**
   * The free lane beside the artwork, measured in screen pixels. It — and only
   * it — decides which controls stay in the bar, so the bar's size can change
   * with the viewport but never with the document or an open drawer.
   */
  const [lane, setLane] = useState(MAX_LANE);
  /** Which side the bubble settled on — drives its entrance animation. */
  const [side, setSide] = useState<"above" | "below" | "left" | "right">(
    "above",
  );

  const fontChoices = useEditor((s) => s.fontChoices);
  const zoom = useEditor((s) => s.zoom);
  /**
   * Which page the canvas is showing, and which panels are over it.
   *
   * Both change WHERE the selected element sits on screen without changing the
   * element itself, so neither was ever a trigger before — and that is exactly
   * why the bubble used to stay behind when the author turned the page.
   * `panelsKey` is a single string so one subscription covers every panel
   * arrangement instead of four.
   */
  const activePageId = useEditor((s) => s.activePageId);
  const panelsKey = useEditor(
    (s) =>
      `${s.leftOpen ? 1 : 0}${s.rightOpen ? 1 : 0}${s.pagesRailCollapsed ? 1 : 0}${
        s.focusMode ? 1 : 0
      }${s.leftCollapsed ? 1 : 0}${s.rightCollapsed ? 1 : 0}`,
  );
  /*
   * Follow the element while it is being dragged/rotated WITHOUT subscribing
   * to the document: the transient interaction store bumps `version` for this
   * element only. (The old `pages` subscription re-rendered the bubble on
   * every document write, and a drag wrote per frame.)
   */
  const dragVersion = useInteraction((s) =>
    s.overrides[el.id] ? s.version : 0,
  );
  const updateStyle = useEditor((s) => s.updateStyle);
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  /** «ملاءمة الصفحة»: resize the element to the page it sits on. */
  const fitElementToPage = (target: CanvasEl, mode: FitPageMode) => {
    const state = useEditor.getState();
    const page = state.pages.find((p) => p.id === pageId) ?? state.pages[0];
    if (!page) return;
    const box = fitBoxToPage(target, pageSize(page), mode);
    updateElement(target.id, {
      ...box,
      rotation: 0,
      ...(target.type === "image" || target.type === "logo"
        ? { style: { objectFit: mode === "fill" ? "cover" : "contain", objectX: 50, objectY: 50 } }
        : {}),
    });
  };
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const copyStyle = useEditor((s) => s.copyStyle);
  const pasteStyle = useEditor((s) => s.pasteStyle);
  const styleClipboard = useEditor((s) => s.styleClipboard);
  const deleteSelected = useEditor((s) => s.deleteSelected);
  const toggleBubble = useEditor((s) => s.toggleBubble);
  const bubbleOffset = useEditor((s) => s.bubbleOffset);
  const setBubbleOffset = useEditor((s) => s.setBubbleOffset);
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: { left: number; top: number; width: number; height: number };
    next: { left: number; top: number };
    moved: boolean;
    frame: number;
  } | null>(null);
  const flipSelected = useEditor((s) => s.flipSelected);
  const toggleResizeLock = useEditor((s) => s.toggleResizeLock);
  const toggleLock = useEditor((s) => s.toggleLock);
  const toggleHidden = useEditor((s) => s.toggleHidden);
  const align = useEditor((s) => s.align);
  const distribute = useEditor((s) => s.distribute);
  const matchSize = useEditor((s) => s.matchSize);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedId = useEditor((s) => s.selectedId);
  const mergeSelection = useEditor((s) => s.mergeSelection);

  const mergeSelected = useCallback(async () => {
    const state = useEditor.getState();
    const page = state.pages.find((candidate) => candidate.id === pageId);
    if (
      !page ||
      state.activePageId !== pageId ||
      state.selectedIds.length < 2 ||
      selectedId !== el.id
    )
      return;
    const node = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id="${CSS.escape(pageId)}"]`,
    );
    if (!node) {
      toast.error("تعذر العثور على مساحة الصفحة للدمج");
      return;
    }
    const hadExportId = node.hasAttribute("data-export-page");
    node.setAttribute("data-export-page", pageId);
    try {
      const snapshot = await snapshotPage({ node, ...pageSize(page) });
      const image = await snapshotSelection(snapshot, state.selectedIds, 2);
      const current = useEditor.getState();
      if (
        !image ||
        current.activePageId !== pageId ||
        current.selectedIds.length !== state.selectedIds.length ||
        current.selectedIds.some((id) => !state.selectedIds.includes(id))
      )
        throw new Error("تغير التحديد أثناء تجهيز الدمج؛ أعد المحاولة");
      mergeSelection(image);
      toast.success("دُمجت العناصر في طبقة صورة واحدة");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر دمج العناصر المحددة",
      );
    } finally {
      if (!hadExportId) node.removeAttribute("data-export-page");
    }
  }, [el.id, mergeSelection, pageId, selectedId]);

  /**
   * Place the toolbar 16px beyond the grips, flipping below when there is no
   * room, and clamp horizontally so it can never leave the viewport.
   */
  const place = useCallback(() => {
    const pageNode = document.querySelector<HTMLElement>(
      `.editor-canvas-stage [data-page-id="${CSS.escape(pageId)}"]`,
    );
    const target = pageNode?.querySelector<HTMLElement>(
      `[data-el-id="${CSS.escape(el.id)}"]`,
    );
    const toolbar = boxRef.current;
    /*
     * The anchor is gone: the page was switched away from, its artboard is
     * virtualised out of the tree, or the element itself was deleted.
     *
     * Returning early here is what left a dead rectangle hanging over the
     * canvas — `pos` kept its last value while `visibility` stayed `visible`,
     * so the bubble looked attached to nothing at all. Parking it (pos → null)
     * makes it invisible until the anchor is on screen again, which is both
     * honest and the only correct answer for an element you cannot see.
     */
    if (!target || !toolbar) {
      setPos((current) => (current === null ? current : null));
      return;
    }
    const rect = target.getBoundingClientRect();
    // A narrow tool rail must not force a phone toolbar down to the page rail.
    // Fit the bar into the lane beside the tools before placing it.
    let laneLeft = MARGIN,
      laneRight = window.innerWidth - MARGIN;
    document
      .querySelectorAll<HTMLElement>('[data-editor-obstacle="tool-dock"]')
      .forEach((dock) => {
        const r = dock.getBoundingClientRect();
        if (
          !r.width ||
          r.height < r.width ||
          getComputedStyle(dock).visibility === "hidden"
        )
          return;
        if (r.left > rect.left + rect.width / 2)
          laneRight = Math.min(laneRight, r.left - MARGIN);
        else if (r.right < rect.left + rect.width / 2)
          laneLeft = Math.max(laneLeft, r.right + MARGIN);
      });
    const nextLane = Math.min(
      MAX_LANE,
      window.innerWidth - MARGIN * 2,
      Math.max(240, laneRight - laneLeft),
    );
    /*
     * Publish the lane instead of measuring the bar: `bubbleLayout` turns this
     * one number into the bar's contents, so a re-render (not a resize of the
     * bar) is what answers a smaller viewport. Measuring the bar here and
     * resizing it there would be a loop.
     */
    setLane((current) => (current === nextLane ? current : nextLane));
    const box = toolbar.getBoundingClientRect();
    /*
     * `max-width` caps the border box while `overflow: visible` lets a wider
     * child paint outside it, so placement has to reason about what is ACTUALLY
     * painted — otherwise the bubble is positioned as if it were narrower than
     * it looks and ends up clipped at the viewport edge or thrown onto an
     * obstacle it was supposed to dodge.
     */
    const size = {
      width: Math.min(
        Math.max(box.width, toolbar.scrollWidth),
        Math.max(0, window.innerWidth - MARGIN * 2),
      ),
      height: box.height,
    };
    if (!rect.width && !rect.height) return;
    // Keep the bubble clear of the real, outward-expanded grip hit regions,
    // not just the visible 7px dots. These measurements include rotation/zoom.
    const grips = [
      ...(pageNode?.querySelectorAll<HTMLElement>(
        `.selection-frame[data-el-id="${CSS.escape(el.id)}"] .handle, .selection-frame[data-el-id="${CSS.escape(el.id)}"] .rotate-handle`,
      ) ?? []),
    ].map((node) => node.getBoundingClientRect());
    /*
     * The selection frame can be the MEASURED artwork box, so it is part of
     * the anchor: the bubble must clear what the author sees as "the
     * selection", not just the element's layout box.
     */
    const frameNode = pageNode?.querySelector<HTMLElement>(
      `.selection-frame[data-el-id="${CSS.escape(el.id)}"]`,
    );
    if (frameNode) grips.push(frameNode.getBoundingClientRect());
    const leftEdge = Math.min(rect.left, ...grips.map((r) => r.left));
    const rightEdge = Math.max(rect.right, ...grips.map((r) => r.right));
    const topEdge = Math.min(rect.top, ...grips.map((r) => r.top));
    const bottomEdge = Math.max(rect.bottom, ...grips.map((r) => r.bottom));
    const interactionBox = {
      left: leftEdge,
      right: rightEdge,
      top: topEdge,
      bottom: bottomEdge,
      width: rightEdge - leftEdge,
      height: bottomEdge - topEdge,
    };
    /*
     * Obstacles: the header, both sidebars, the pages rail and the status bar
     * all mark themselves `data-editor-obstacle`. Measuring them at placement
     * time (rather than assuming fixed widths) means the bubble dodges a
     * resized panel, a collapsed sidebar or a floating drawer exactly as it
     * dodges the docked layout.
     */
    const avoid = [
      ...document.querySelectorAll<HTMLElement>("[data-editor-obstacle]"),
    ]
      .filter(
        (node) =>
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility !== "hidden",
      )
      .map((node) => node.getBoundingClientRect());
    // The arithmetic is pure and unit-tested (`placeFloatingToolbar`); this
    // callback only feeds it live screen measurements.
    const { left, top, placement } = placeFloatingToolbar(
      interactionBox,
      { width: size.width, height: size.height },
      { width: window.innerWidth, height: window.innerHeight },
      GAP,
      MARGIN,
      [...avoid, ...grips],
    );
    automaticPosRef.current = { left, top };
    /*
     * A manual park wins over the automatic placement, still clamped into the
     * viewport so a resized window can never strand the bubble off screen.
     */
    const offset = useEditor.getState().bubbleOffset;
    const parked = offset
      ? {
          left: Math.min(
            Math.max(left + offset.dx, MARGIN),
            Math.max(MARGIN, window.innerWidth - size.width - MARGIN),
          ),
          top: Math.min(
            Math.max(top + offset.dy, MARGIN),
            Math.max(MARGIN, window.innerHeight - size.height - MARGIN),
          ),
        }
      : { left, top };
    setPos(parked);
    setSide(placement);
  }, [el.id, pageId]);

  /**
   * One coalesced frame, shared by every trigger.
   *
   * The previous version CANCELLED the pending frame and requested a new one on
   * every trigger. While an element is being dragged the interaction store bumps
   * `version` once per pointer event — 120Hz on an iPad Pro and on any precision
   * mouse — but `requestAnimationFrame` only runs 60 times a second, so each
   * pending frame was cancelled before it could fire and the bubble stopped
   * following the element until the drag ended. That single cancel is the whole
   * "the toolbar will not stay attached while I drag" bug.
   *
   * `schedule()` now only marks the placement dirty and asks for ONE frame when
   * none is pending; the frame then calls the freshest `place` through a ref, so
   * a burst of pointer events costs exactly one placement per frame.
   */
  const placeRef = useRef(place);
  placeRef.current = place;
  const schedulerRef = useRef<{
    schedule: () => void;
    dispose: () => void;
  } | null>(null);
  if (!schedulerRef.current) {
    let frame = 0;
    schedulerRef.current = {
      schedule: () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          placeRef.current();
        });
      },
      dispose: () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }
  const schedule = schedulerRef.current.schedule;

  /**
   * Re-place on every input that can move the element on screen: its own
   * geometry, the zoom, a live drag, a manual park, the ACTIVE PAGE (switching
   * pages changes what is under the bubble even when `el` is unchanged) and any
   * panel that opens, closes or collapses over the canvas.
   *
   * `lane` is in the list because a new lane means a new bar, and the bar has to
   * be measured AFTER it re-rendered, not before.
   */
  useLayoutEffect(() => {
    schedule();
  }, [
    schedule,
    lane,
    el.x,
    el.y,
    el.w,
    el.h,
    el.rotation,
    zoom,
    dragVersion,
    bubbleOffset,
    activePageId,
    panelsKey,
  ]);

  /**
   * Live triggers, registered once: a scroll inside the stage (which is what
   * panning actually is), a window resize, a panel transition finishing, and a
   * resize of any obstacle the bubble has to dodge.
   */
  useEffect(() => {
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("transitionend", schedule, true);
    window.addEventListener("nasaq:panel-layout", schedule);
    const observer = new ResizeObserver(schedule);
    document
      .querySelectorAll("[data-editor-obstacle]")
      .forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      window.removeEventListener("nasaq:panel-layout", schedule);
      window.removeEventListener("transitionend", schedule, true);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [schedule, panelsKey]);

  /** Drag locally at display rate; commit a single park when the gesture ends. */
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const toolbar = boxRef.current;
    if (!toolbar) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = toolbar.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: {
        left: origin.left,
        top: origin.top,
        width: Math.max(origin.width, toolbar.scrollWidth),
        height: origin.height,
      },
      next: { left: origin.left, top: origin.top },
      moved: false,
      frame: 0,
    };
    setDragPos({ left: origin.left, top: origin.top });
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      dragRef.current = null;
      setDragPos(null);
      setDragging(false);
    }
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const maxLeft = Math.max(
      MARGIN,
      window.innerWidth - drag.origin.width - MARGIN,
    );
    const maxTop = Math.max(
      MARGIN,
      window.innerHeight - drag.origin.height - MARGIN,
    );
    drag.next = {
      left: Math.min(
        maxLeft,
        Math.max(MARGIN, drag.origin.left + event.clientX - drag.startX),
      ),
      top: Math.min(
        maxTop,
        Math.max(MARGIN, drag.origin.top + event.clientY - drag.startY),
      ),
    };
    drag.moved ||=
      Math.abs(drag.next.left - drag.origin.left) > 1 ||
      Math.abs(drag.next.top - drag.origin.top) > 1;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      if (dragRef.current === drag) setDragPos(drag.next);
    });
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.frame) cancelAnimationFrame(drag.frame);
    const maxLeft = Math.max(
      MARGIN,
      window.innerWidth - drag.origin.width - MARGIN,
    );
    const maxTop = Math.max(
      MARGIN,
      window.innerHeight - drag.origin.height - MARGIN,
    );
    const position =
      event.type === "pointerup"
        ? {
            left: Math.min(
              maxLeft,
              Math.max(MARGIN, drag.origin.left + event.clientX - drag.startX),
            ),
            top: Math.min(
              maxTop,
              Math.max(MARGIN, drag.origin.top + event.clientY - drag.startY),
            ),
          }
        : drag.next;
    const automatic = automaticPosRef.current ?? {
      left: drag.origin.left - (bubbleOffset?.dx ?? 0),
      top: drag.origin.top - (bubbleOffset?.dy ?? 0),
    };
    const moved =
      drag.moved ||
      Math.abs(position.left - drag.origin.left) > 1 ||
      Math.abs(position.top - drag.origin.top) > 1;
    dragRef.current = null;
    setPos(position);
    if (moved) {
      setBubbleOffset({
        dx: position.left - automatic.left,
        dy: position.top - automatic.top,
      });
    }
    setDragPos(null);
    setDragging(false);
  };

  useEffect(
    () => () => {
      if (dragRef.current?.frame) cancelAnimationFrame(dragRef.current.frame);
    },
    [],
  );

  const style = el.style || {};
  const isText = TEXT_TYPES.has(el.type);
  const count = selectedIds.length;
  const isImage = el.type === "image" || el.type === "logo";
  const supportsFill = [
    "shape",
    "box",
    "stat",
    "progress",
    "svg",
    "icon",
    "line",
    "divider",
  ].includes(el.type);
  const supportsGradient = ["shape", "box", "stat", "progress", "svg"].includes(
    el.type,
  );
  /*
   * Border support is a property of the element's TYPE (and, for an imported
   * SVG, of its viewBox), so it is read here without subscribing to the
   * document: a selection that cannot carry a border simply has no border
   * control, in the bar or in a drawer, instead of an empty 76px slot.
   */
  const supportsStroke = useMemo(() => {
    if (strokeBinding(el) !== null) return true;
    // A mixed selection can hold a shape even when the primary element is a
    // plain text frame. `selectedIds` is subscribed above, so this re-runs with
    // every selection — and only a multi-selection needs the extra walk.
    if (selectedIds.length < 2) return false;
    return useEditor
      .getState()
      .selectedElements()
      .some((item) => strokeBinding(item) !== null);
  }, [el, selectedIds]);
  const layout = bubbleLayout(
    isImage ? "image" : isText ? "text" : "object",
    lane,
    {
      stroke: supportsStroke,
      fill: supportsFill,
    },
  );
  const inBar = new Set(layout.bar);
  const inDrawer = new Set(layout.drawer);

  const paragraphAlign: Array<{ id: string; label: string; icon: LucideIcon }> =
    [
      { id: "right", label: "محاذاة لليمين", icon: AlignRight },
      { id: "center", label: "توسيط", icon: AlignCenter },
      { id: "left", label: "محاذاة لليسار", icon: AlignLeft },
      { id: "justify", label: "ضبط", icon: AlignJustify },
    ];
  const AlignCurrent =
    paragraphAlign.find((item) => item.id === (style.textAlign || "right"))
      ?.icon ?? AlignRight;
  /** Align/distribute the selection (or the page when a single object is picked). */
  const alignEdge = (edge: string) =>
    align(
      (edge === "center-h"
        ? "center"
        : edge === "center-v"
          ? "middle"
          : edge) as AlignEdge,
      count >= 2 ? "selection" : "page",
    );
  const setParagraphAlign = (id: string) => {
    updateStyle(el.id, {
      textAlign: id as "right" | "center" | "left" | "justify",
    });
    commit();
  };
  const rotate = (delta: number) => {
    const state = useEditor.getState();
    for (const item of state.selectedElements()) {
      if (item.locked) continue;
      const next = ((((item.rotation || 0) + delta) % 360) + 360) % 360;
      state.updateElement(item.id, { rotation: next }, true);
    }
    commit();
  };
  /** The two colour bindings of an object, shared by the bar and the drawer. */
  const objectColors = {
    fill: {
      value:
        el.type === "svg"
          ? style.svgFill
          : ["icon", "line", "divider"].includes(el.type)
            ? style.color
            : style.fill,
      fallback: style.background || "#006c35",
      onChange: (v: string, gradient?: Gradient) =>
        updateStyle(
          el.id,
          el.type === "svg"
            ? { svgFill: v, gradient }
            : ["icon", "line", "divider"].includes(el.type)
              ? { color: v }
              : { fill: v, gradient },
          true,
        ),
      onCommit: (v: string, gradient?: Gradient) =>
        updateStyle(
          el.id,
          el.type === "svg"
            ? { svgFill: v, gradient }
            : ["icon", "line", "divider"].includes(el.type)
              ? { color: v }
              : { fill: v, gradient },
        ),
    },
    border: {
      value:
        el.type === "line" || el.type === "divider"
          ? style.color
          : el.type === "svg" || el.type === "icon"
            ? style.svgStroke
            : style.borderColor,
      fallback: style.color || "#c9a86a",
      onChange: (v: string) =>
        updateStyle(
          el.id,
          el.type === "line" || el.type === "divider"
            ? { color: v }
            : el.type === "svg" || el.type === "icon"
              ? { svgStroke: v }
              : { borderColor: v },
          true,
        ),
      onCommit: (v: string) =>
        updateStyle(
          el.id,
          el.type === "line" || el.type === "divider"
            ? { color: v }
            : el.type === "svg" || el.type === "icon"
              ? { svgStroke: v }
              : { borderColor: v },
        ),
    },
  };

  /** Typography, in the bar or in the drawer — the same controls either way. */
  const typographyControls = (
    <>
      <div className="editor-menu-field">
        <select
          className="editor-drawer-select"
          aria-label="نوع الخط"
          title={`نوع الخط — ${style.fontFamily || "Tajawal"}`}
          value={style.fontFamily || "Tajawal"}
          onChange={(event) => {
            updateStyle(el.id, { fontFamily: event.target.value });
            commit();
          }}
        >
          {fontChoices.map((font) => (
            <option key={font.family} value={font.family}>
              {font.family}
            </option>
          ))}
        </select>
      </div>
      <div className="editor-menu-field">
        <ScrubInput
          label="حجم الخط"
          value={Math.round(Number(style.fontSize || 12) * 10) / 10}
          min={5}
          max={200}
          step={0.5}
          precision={1}
          suffix="pt"
          onChange={(v) => updateStyle(el.id, { fontSize: v }, true)}
          onCommit={(v) => {
            updateStyle(el.id, { fontSize: v });
            commit();
          }}
        />
      </div>
    </>
  );

  /*
   * Portalled to `document.body` on purpose: the bubble is `position: fixed`
   * and must sit above the panel layer (`--z-bubble` > `--z-panel`), while the
   * canvas stage itself is deliberately isolated so artboard layers can never
   * escape it. Rendering here keeps both invariants true.
   */
  return createPortal(
    <div
      ref={boxRef}
      className={cn(
        "floating-toolbar",
        dragging && "is-dragging",
        bubbleOffset && "is-parked",
      )}
      data-floating-toolbar={el.id}
      data-placement={side}
      data-density={
        layout.drawer.length || layout.more.length ? "folded" : "full"
      }
      style={{
        left: dragPos?.left ?? pos?.left ?? -9999,
        top: dragPos?.top ?? pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      // The toolbar is chrome over the document: pointer events must never
      // reach the canvas beneath it. Right-click is stopped here too — the
      // stopPropagation means the workspace handler never runs, so without
      // preventDefault the browser's own menu would appear over the canvas.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      dir="rtl"
      role="toolbar"
      aria-label={`أدوات ${el.name || TYPE_NAME[el.type]}`}
    >
      {/*
       * Drag grip — the bubble can be parked anywhere on screen, and
       * double-clicking the grip hands placement back to the automatic
       * scoring (above → below → sides, never over the artwork).
       */}
      <button
        type="button"
        className="floating-toolbar-btn floating-toolbar-grip"
        title="اسحب لنقل الشريط — نقرتان لإعادته إلى الموضع التلقائي"
        aria-label="نقل الشريط العائم"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
        onDoubleClick={() => setBubbleOffset(null)}
      >
        <Move />
      </button>

      {/*
       * The group drawer: the whole formatting set for this kind of element,
       * opened only when the lane is too narrow to hold it in the bar. It is a
       * real drawer — titled, movable, closable — not a second toolbar.
       */}
      {inBar.has("drawer") && (
        <AnchorMenu
          label={isText ? "تنسيق النص" : "تنسيق العنصر"}
          drawer={{
            id: "selection-format",
            title: isText ? "تنسيق النص" : "تنسيق العنصر",
          }}
          width={248}
          side="top"
          align="start"
          trigger={({ ref, ...props }) => (
            <button
              {...props}
              ref={ref}
              type="button"
              className="floating-toolbar-btn"
              aria-label={isText ? "تنسيق النص" : "تنسيق العنصر"}
            >
              <Palette />
            </button>
          )}
        >
          {inDrawer.has("typography") && typographyControls}
          {inDrawer.has("format") && (
            <>
              <MenuGrid columns={4} label="تنسيق الأحرف">
                <MenuCell
                  icon={<Bold />}
                  label="عريض"
                  active={Number(style.fontWeight || 0) >= 700}
                  onSelect={() => {
                    updateStyle(el.id, {
                      fontWeight: Number(style.fontWeight) >= 700 ? 500 : 800,
                    });
                    commit();
                  }}
                />
                <MenuCell
                  icon={<Italic />}
                  label="مائل"
                  active={style.fontStyle === "italic"}
                  onSelect={() => {
                    updateStyle(el.id, {
                      fontStyle:
                        style.fontStyle === "italic" ? "normal" : "italic",
                    });
                    commit();
                  }}
                />
                <MenuCell
                  icon={<Underline />}
                  label="تحته خط"
                  active={style.underline === true}
                  onSelect={() => {
                    updateStyle(el.id, { underline: style.underline !== true });
                    commit();
                  }}
                />
                <ColorField
                  className="editor-menu-swatch"
                  label="لون النص"
                  value={style.color}
                  fallback="#172033"
                  onChange={(v) => updateStyle(el.id, { color: v }, true)}
                  onCommit={(v) => updateStyle(el.id, { color: v })}
                />
              </MenuGrid>
              <MenuGrid columns={4} label="محاذاة الفقرة">
                {paragraphAlign.map((item) => {
                  const Icon = item.icon;
                  return (
                    <MenuCell
                      key={item.id}
                      icon={<Icon />}
                      label={item.label}
                      active={(style.textAlign || "right") === item.id}
                      onSelect={() => setParagraphAlign(item.id)}
                    />
                  );
                })}
              </MenuGrid>
            </>
          )}
          {inDrawer.has("ink") && (
            <MenuGrid columns={2} label="ألوان العنصر">
              <FillField
                className="editor-menu-swatch"
                label="لون التعبئة"
                value={objectColors.fill.value}
                gradient={supportsGradient ? style.gradient : undefined}
                allowGradient={supportsGradient}
                fallback={objectColors.fill.fallback}
                onChange={objectColors.fill.onChange}
                onCommit={objectColors.fill.onCommit}
              />
              <ColorField
                className="editor-menu-swatch"
                label="لون الإطار"
                value={objectColors.border.value}
                fallback={objectColors.border.fallback}
                onChange={objectColors.border.onChange}
                onCommit={objectColors.border.onCommit}
              />
            </MenuGrid>
          )}
          {inDrawer.has("stroke") && (
            <div className="editor-menu-field">
              <StrokeField />
            </div>
          )}
        </AnchorMenu>
      )}

      {inBar.has("typography") && (
        <div className="floating-toolbar-section">
          <select
            className="floating-toolbar-select"
            aria-label="نوع الخط"
            title={`نوع الخط — ${style.fontFamily || "Tajawal"}`}
            value={style.fontFamily || "Tajawal"}
            onChange={(event) => {
              updateStyle(el.id, { fontFamily: event.target.value });
              commit();
            }}
          >
            {fontChoices.map((font) => (
              <option key={font.family} value={font.family}>
                {font.family}
              </option>
            ))}
          </select>
          {/*
           * Font size uses the shared scrubber: drag the value horizontally,
           * Shift for ×10, and ± steppers that stay thumb-sized on touch — the
           * same gesture as the properties panel, so the author does not
           * relearn it mid-canvas.
           */}
          <ScrubInput
            className="floating-toolbar-scrub"
            label="حجم الخط"
            value={Math.round(Number(style.fontSize || 12) * 10) / 10}
            min={5}
            max={200}
            step={0.5}
            precision={1}
            suffix="pt"
            onChange={(v) => updateStyle(el.id, { fontSize: v }, true)}
            onCommit={(v) => {
              updateStyle(el.id, { fontSize: v });
              commit();
            }}
          />
        </div>
      )}

      {inBar.has("format") && (
        <div className="floating-toolbar-section">
          <TipButton
            label="عريض"
            pressed={Number(style.fontWeight || 0) >= 700}
            onClick={() => {
              updateStyle(el.id, {
                fontWeight: Number(style.fontWeight) >= 700 ? 500 : 800,
              });
              commit();
            }}
          >
            <Bold />
          </TipButton>
          <TipButton
            label="مائل"
            pressed={style.fontStyle === "italic"}
            onClick={() => {
              updateStyle(el.id, {
                fontStyle: style.fontStyle === "italic" ? "normal" : "italic",
              });
              commit();
            }}
          >
            <Italic />
          </TipButton>
          <TipButton
            label="تحته خط"
            pressed={style.underline === true}
            onClick={() => {
              updateStyle(el.id, { underline: style.underline !== true });
              commit();
            }}
          >
            <Underline />
          </TipButton>
          <ColorField
            className="floating-toolbar-swatch"
            label="لون النص"
            value={style.color}
            fallback="#172033"
            onChange={(v) => updateStyle(el.id, { color: v }, true)}
            onCommit={(v) => updateStyle(el.id, { color: v })}
          />
          {/* Paragraph alignment is four choices for one job — a popover, not
              four permanent slots competing with the font controls. */}
          <AnchorMenu
            label="محاذاة الفقرة"
            width={168}
            trigger={({ ref, ...props }) => (
              <button
                {...props}
                ref={ref}
                type="button"
                className="floating-toolbar-btn"
                aria-label="محاذاة الفقرة"
              >
                <AlignCurrent />
              </button>
            )}
          >
            {paragraphAlign.map((item) => {
              const Icon = item.icon;
              return (
                <MenuRow
                  key={item.id}
                  icon={<Icon className="size-4" />}
                  label={item.label}
                  checked={(style.textAlign || "right") === item.id}
                  onSelect={() => setParagraphAlign(item.id)}
                />
              );
            })}
          </AnchorMenu>
        </div>
      )}

      {inBar.has("ink") && (
        <div className="floating-toolbar-section">
          <FillField
            className="floating-toolbar-swatch"
            label="لون التعبئة"
            value={objectColors.fill.value}
            gradient={supportsGradient ? style.gradient : undefined}
            allowGradient={supportsGradient}
            fallback={objectColors.fill.fallback}
            onChange={objectColors.fill.onChange}
            onCommit={objectColors.fill.onCommit}
          />
          <ColorField
            className="floating-toolbar-swatch"
            label="لون الإطار"
            value={objectColors.border.value}
            fallback={objectColors.border.fallback}
            onChange={objectColors.border.onChange}
            onCommit={objectColors.border.onCommit}
          />
        </div>
      )}

      {inBar.has("image") && (
        <div className="floating-toolbar-section">
          <TipButton
            label="تغيير الصورة"
            hint="استبدال الصورة مع الإبقاء على الموضع والحجم"
            disabled={el.locked || count !== 1}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("nasaq:replace-image", { detail: el.id }),
              )
            }
          >
            <ImagePlus />
          </TipButton>
          <TipButton
            label="قص الصورة"
            disabled={
              el.locked ||
              el.resizeLocked ||
              el.widthLocked ||
              el.heightLocked ||
              count !== 1
            }
            onClick={() => beginImageCrop(el.id)}
          >
            <Crop />
          </TipButton>
          <AnchorMenu
            label="ملاءمة الصورة"
            width={220}
            trigger={({ ref, ...props }) => (
              <button
                {...props}
                ref={ref}
                type="button"
                className="floating-toolbar-btn"
                aria-label="ملاءمة الصورة"
              >
                <Image />
              </button>
            )}
          >
            <MenuRow
              label="Fit · احتواء الصورة كاملة"
              checked={style.objectFit === "contain"}
              onSelect={() => updateStyle(el.id, { objectFit: "contain" })}
            />
            <MenuRow
              label="Fill · تعبئة الإطار دون تشويه"
              checked={style.objectFit !== "contain"}
              onSelect={() => updateStyle(el.id, { objectFit: "cover" })}
            />
            <MenuRow
              label="ملء الصفحة — تكبير التصميم على حجم الصفحة"
              hint="يغطي الصفحة كاملة دون تشويه الصورة"
              disabled={el.locked || el.resizeLocked}
              onSelect={() => fitElementToPage(el, "fill")}
            />
            <MenuRow
              label="ملاءمة داخل الصفحة — بنسبة الصورة"
              hint="أكبر حجم يبقى داخل الصفحة، في المنتصف"
              disabled={el.locked || el.resizeLocked}
              onSelect={() => fitElementToPage(el, "fit")}
            />
            <MenuRow
              label="إزالة القص"
              disabled={!style.crop}
              onSelect={() =>
                updateStyle(el.id, {
                  crop: undefined,
                  objectFit: "contain",
                  objectX: 50,
                  objectY: 50,
                })
              }
            />
          </AnchorMenu>
          <TipButton
            label="تدوير 90°"
            disabled={el.locked}
            onClick={() => rotate(90)}
          >
            <RotateCw />
          </TipButton>
          <TipButton
            label="تحسين الوضوح"
            hint="رفع حدة الصورة — انقر مرة أخرى للإلغاء"
            pressed={Number(style.sharpness ?? 0) >= 30}
            disabled={el.locked}
            onClick={() =>
              updateStyle(el.id, {
                sharpness: Number(style.sharpness ?? 0) >= 30 ? 0 : 40,
              })
            }
          >
            <Sparkles />
          </TipButton>
          <TipButton
            label="تفتيح"
            hint="رفع إضاءة الصورة — انقر مرة أخرى للإلغاء"
            pressed={Number(style.brightness ?? 100) > 100}
            disabled={el.locked}
            onClick={() =>
              updateStyle(el.id, {
                brightness: Number(style.brightness ?? 100) > 100 ? 100 : 118,
              })
            }
          >
            <Sun />
          </TipButton>
        </div>
      )}

      {/* Owns its leading separator, so a selection without stroke support
          never leaves a stray divider in the bar. */}
      {inBar.has("stroke") && <StrokeControls />}

      {inBar.has("element") && (
        <div className="floating-toolbar-section">
          <TipButton label="تكرار" shortcut="⌘D" onClick={duplicateSelected}>
            <Copy />
          </TipButton>
          <TipButton
            label="حذف"
            shortcut="Delete"
            danger
            onClick={deleteSelected}
          >
            <Trash2 />
          </TipButton>
        </div>
      )}

      <span className="floating-toolbar-sep" aria-hidden />

      {/*
       * «المزيد» — everything that is real but not immediate: alignment and
       * distribution, rotation and flips, lock/hide/duplicate/delete, opacity,
       * the style clipboard and equal sizing. A movable drawer of icon
       * controls, so the bar adapts to the selection instead of listing every
       * action the editor can perform.
       */}
      <AnchorMenu
        label="المزيد"
        drawer={{ id: "selection-more", title: "أدوات العنصر" }}
        width={420}
        side="top"
        align="end"
        trigger={({ ref, ...props }) => (
          <button
            {...props}
            ref={ref}
            type="button"
            className="floating-toolbar-btn"
            aria-label="المزيد من أدوات العنصر"
          >
            <MoreHorizontal />
          </button>
        )}
      >
        <MenuGroup title="الموضع والأبعاد" />
        <div className="editor-menu-field grid grid-cols-2 gap-2">
          {(
            [
              ["x", "X مم"],
              ["y", "Y مم"],
              ["w", "العرض مم"],
              ["h", "الارتفاع مم"],
              ["rotation", "الدوران °"],
            ] as const
          ).map(([key, label]) => (
            <ScrubInput
              key={key}
              label={label}
              value={el[key]}
              min={key === "w" || key === "h" ? 4 : -10000}
              max={10000}
              disabled={
                el.locked ||
                count > 1 ||
                ((key === "w" || key === "h") && el.resizeLocked) ||
                (key === "w" && el.widthLocked) ||
                (key === "h" && el.heightLocked)
              }
              onChange={(v) => updateElement(el.id, { [key]: v }, true)}
              onCommit={(v) => updateElement(el.id, { [key]: v })}
            />
          ))}
          <MenuCell
            icon={<Ratio />}
            label="قفل نسبة الأبعاد"
            active={style.aspectLock === true}
            onSelect={() => useEditor.getState().toggleAspectLock()}
          />
        </div>
        <MenuGrid columns={3} label="المحاذاة">
          {(
            [
              ["right", "محاذاة لليمين"],
              ["center-h", "توسيط أفقي"],
              ["left", "محاذاة لليسار"],
              ["top", "محاذاة للأعلى"],
              ["center-v", "توسيط رأسي"],
              ["bottom", "محاذاة للأسفل"],
            ] as const
          ).map(([kind, title]) => (
            <MenuCell
              key={kind}
              icon={<AlignIcon kind={kind} />}
              label={title}
              onSelect={() => alignEdge(kind)}
            />
          ))}
        </MenuGrid>
        <MenuGrid columns={4} label="التوزيع والتحويل">
          <MenuCell
            icon={<AlignIcon kind="dist-h" />}
            label="توزيع أفقي متساوٍ"
            disabled={count < 3}
            onSelect={() => distribute("h")}
          />
          <MenuCell
            icon={<AlignIcon kind="dist-v" />}
            label="توزيع رأسي متساوٍ"
            disabled={count < 3}
            onSelect={() => distribute("v")}
          />
          <MenuCell
            icon={<RotateCcw />}
            label="تدوير 90° لليسار"
            onSelect={() => rotate(-90)}
          />
          <MenuCell
            icon={<RotateCw />}
            label="تدوير 90° لليمين"
            onSelect={() => rotate(90)}
          />
        </MenuGrid>
        <MenuGrid columns={4} label="القلب والتحجيم">
          <MenuCell
            icon={<FlipHorizontal2 />}
            label="قلب أفقي"
            active={style.flipX === true}
            onSelect={() => flipSelected("x")}
          />
          <MenuCell
            icon={<FlipVertical2 />}
            label="قلب رأسي"
            active={style.flipY === true}
            onSelect={() => flipSelected("y")}
          />
          <MenuCell
            icon={<Scaling />}
            label="قفل التحجيم — تجميد العرض والارتفاع"
            active={el.resizeLocked === true}
            onSelect={() => toggleResizeLock()}
          />
          <MenuCell
            icon={<Maximize2 />}
            label="ملاءمة صندوق النص"
            disabled={!isText}
            onSelect={() => fitTextBox(el.id)}
          />
        </MenuGrid>
        <MenuGrid columns={4} label="ترتيب الطبقات">
          <MenuCell
            icon={<ChevronsUp />}
            label="إلى المقدمة"
            onSelect={() => useEditor.getState().bring("front")}
          />
          <MenuCell
            icon={<ArrowUp />}
            label="طبقة للأمام"
            onSelect={() => useEditor.getState().bring("forward")}
          />
          <MenuCell
            icon={<ArrowDown />}
            label="طبقة للخلف"
            onSelect={() => useEditor.getState().bring("back")}
          />
          <MenuCell
            icon={<ChevronsDown />}
            label="إلى الخلف"
            onSelect={() => useEditor.getState().bring("bottom")}
          />
        </MenuGrid>
        <MenuGrid columns={2} label="التجميع">
          <MenuCell
            icon={<Group />}
            label="تجميع"
            disabled={count < 2}
            onSelect={() => useEditor.getState().group()}
          />
          <MenuCell
            icon={<Ungroup />}
            label="فك التجميع"
            disabled={el.type !== "group"}
            onSelect={() => useEditor.getState().ungroup()}
          />
        </MenuGrid>
        {count > 1 && el.id === selectedId && (
          <MenuGrid columns={2} label="دمج العناصر">
            <MenuCell
              icon={<Layers2 />}
              label="دمج الطبقات المحددة في صورة واحدة — يتطلب طبقات متجاورة"
              onSelect={mergeSelected}
            />
          </MenuGrid>
        )}
        <MenuGrid columns={4} label="العنصر">
          <MenuCell
            icon={el.locked ? <Unlock /> : <Lock />}
            label={el.locked ? "فتح القفل" : "قفل العنصر — منع التحرير"}
            active={el.locked === true}
            onSelect={() => toggleLock()}
          />
          <MenuCell
            icon={<EyeOff />}
            label="إخفاء العنصر — يظهر مرة أخرى من شجرة الطبقات"
            onSelect={() => toggleHidden()}
          />
          <MenuCell
            icon={<Copy />}
            label="تكرار"
            onSelect={duplicateSelected}
          />
          <MenuCell
            icon={<Trash2 />}
            label="حذف العنصر"
            danger
            onSelect={deleteSelected}
          />
        </MenuGrid>
        <MenuGroup title="الشفافية" />
        <div className="editor-menu-field">
          <ScrubInput
            label="الشفافية"
            value={Math.round((el.opacity ?? 1) * 100)}
            min={0}
            max={100}
            step={1}
            precision={0}
            suffix="%"
            onChange={(v) => updateElement(el.id, { opacity: v / 100 }, true)}
            onCommit={(v) => {
              updateElement(el.id, { opacity: v / 100 });
              commit();
            }}
          />
        </div>
        <MenuGroup title="التنسيق والحجم" />
        <MenuGrid columns={2} label="نسخ التنسيق">
          <MenuCell
            icon={<Paintbrush />}
            label="نسخ التنسيق"
            onSelect={copyStyle}
          />
          <MenuCell
            icon={<Paintbrush />}
            label="لصق التنسيق"
            disabled={!styleClipboard}
            onSelect={pasteStyle}
          />
        </MenuGrid>
        <MenuGrid columns={3} label="توحيد المقاس">
          <MenuCell
            icon={<ArrowLeftRight />}
            label="نفس العرض"
            disabled={count < 2}
            onSelect={() => matchSize("width")}
          />
          <MenuCell
            icon={<ArrowUpDown />}
            label="نفس الارتفاع"
            disabled={count < 2}
            onSelect={() => matchSize("height")}
          />
          <MenuCell
            icon={<Maximize2 />}
            label="نفس الحجم"
            disabled={count < 2}
            onSelect={() => matchSize("both")}
          />
        </MenuGrid>
      </AnchorMenu>

      <span className="floating-toolbar-sep" aria-hidden />
      {/*
       * Quick dismiss. The author can silence the bubble from the bubble
       * itself (it follows every selection, so it is the thing that is in the
       * way right now); «عرض» turns it back on. The choice is persisted with
       * the rest of the UI state.
       */}
      <button
        type="button"
        className="floating-toolbar-btn"
        title="إخفاء الشريط العائم (يمكن إرجاعه من «عرض»)"
        aria-label="إخفاء الشريط العائم"
        onClick={() => toggleBubble(false)}
      >
        <X />
      </button>
    </div>,
    document.body,
  );
}

/**
 * One bubble button. Same tooltip contract as the rest of the studio
 * (hover on pointer devices, long-press on touch) so no icon in the bar is a
 * mystery, and the same pressed/active affordance the panel buttons use.
 *
 * `shortcut` is for a key the editor actually binds, shown in ONE place: a
 * decorative key cap that does nothing on press is worse than none.
 */
function TipButton({
  label,
  hint,
  shortcut,
  pressed,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  shortcut?: string;
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip label={label} hint={hint} shortcut={shortcut}>
      <button
        type="button"
        className={cn(
          "floating-toolbar-btn",
          pressed && "is-active",
          danger && "text-error",
        )}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut || undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tip>
  );
}
