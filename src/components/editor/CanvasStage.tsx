import { screenToDocument, clampZoom } from "@/lib/editor/document-space";
import { canvasDropPoint } from "@/lib/editor/canvas-space";
import { pageBackgroundCss } from "@/lib/editor/gradient";
import { CropOverlay } from "./CropOverlay";
import { mmToPx } from "@/lib/editor/render-units";
import { likelyNsqDrag } from "@/lib/nsq/format";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  findElement,
  MIN_SIZE,
  RESIZE_OVERFLOW_MM,
  pageSize,
  type Box,
  type CanvasEl,
  type Page,
} from "@/lib/editor/model";
import {
  applyResizeSnap,
  applySnap,
  elementAABB,
  mirrorHandle,
  resizeToPointer,
} from "@/lib/editor/transform";
import { useEditor } from "@/lib/editor/store";
import {
  marqueeForPage,
  useInteraction,
} from "@/lib/editor/interaction-store";
import {
  appendRegionPoint,
  clampRegionBox,
  lassoPath,
  marqueeBox,
  regionHitsBox,
  type SelectionRegion,
} from "@/lib/editor/marquee";
import {
  toolState,
  useTools,
} from "@/lib/editor/tool-store";
import {
  isRegionArmed,
  isRasterElement,
  isRasterTool,
  ownsCanvas,
  resolveMarqueeMode,
  toolAccepts,
  toolDef,
} from "@/lib/editor/tools";
import { beginImageCropToBox } from "@/lib/editor/crop-session";
import {
  loadRasterSource,
  parseHexColor,
  RasterStroke,
} from "@/lib/editor/raster-session";
import { cropLocalPoint, cropSceneTransform } from "@/lib/editor/image-crop";
import {
  CANVAS_LONG_PRESS_MS,
  isEditableTarget,
  shouldArmCanvasLongPress,
  startLongPressTimer,
  type LongPressHandle,
} from "@/lib/editor/keyboard";
import { prepareText } from "@/lib/editor/text-render";
import { clamp, cn, round } from "@/lib/utils";
import { ElementNode } from "./ElementNode";
import { PrintGuides } from "./PrintGuides";
import type { PrintGuideSettings } from "@/lib/editor/print-guides";
import { pageClipClass, pageClipsView } from "@/lib/editor/page-visibility";
import { FloatingToolbar } from "./FloatingToolbar";
import { toast } from "sonner";
import { beginCanvasNavigation, zoomAnchoredAt } from "@/lib/editor/viewport";
import { measuredSelectionBox, type PageBoxMm } from "@/lib/editor/ui-state";
import { LIBRARY_DND_MIME, parseLibraryDrop } from "@/lib/editor/library-dnd";
import { importableByName, openDesignFile } from "@/lib/editor/import/open";
import { ARTBOARD_GUTTER_MM } from "@/lib/editor/artboard";
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

import {
  CanvasPointerSession,
  POINTER_SLOP,
} from "@/lib/editor/canvas-pointer";

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

/** The stable gesture sink every element node receives (see ElementNode). */
type ElementGestureHandler = (
  e: React.PointerEvent,
  el: CanvasEl,
  kind: "move" | "resize" | "rotate",
  handle?: string,
  ctx?: { pageId?: string; parent?: { x: number; y: number } },
) => void;

type LayerPickerState = {
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  pageId: string;
  point: { x: number; y: number };
  elements: CanvasEl[];
} | null;

const SELECTION_LAYER_Z = 5000;
const GUIDE_LAYER_Z = SELECTION_LAYER_Z - 1;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const ROTATE_HANDLES = ["n"] as const;
const EMPTY_SELECTION = new Set<string>();

function snapRotation(raw: number, shift: boolean): number {
  if (!shift) {
    const free = (((raw % 360) + 540) % 360) - 180;
    return round(free);
  }
  const fifteen = Math.round(raw / 15) * 15;
  return (((fifteen % 360) + 540) % 360) - 180;
}

const pagePoint = screenToDocument;

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
  const tol = 0.2;
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
    if (el.locked) continue;
    const absEl =
      offset.x || offset.y
        ? { ...el, x: el.x + offset.x, y: el.y + offset.y }
        : el;
    if (pointInRotatedBox(absEl, px, py)) {
      hits.push(absEl);
    }
  }
  // الأعلى أولاً
  return hits.sort((a, b) => b.z - a.z);
}

/** Second tap on the same overlapping stack opens the picker. The first tap selects. */
let lastAmbiguousStack = { key: "", at: 0 };

export function CanvasStage({
  onDropImage,
  onCanvasTap,
}: {
  onDropImage?: (
    file: File,
    at?: { x: number; y: number; pageId: string },
  ) => void;
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
  const showOutsidePage = useEditor((s) => s.showOutsidePage);
  const printGuides = useEditor((s) => s.printGuides);
  const snapGrid = useEditor((s) => s.snapGrid);
  const snapElements = useEditor((s) => s.snapElements);
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const selectMany = useEditor((s) => s.selectMany);
  const addTextAt = useEditor((s) => s.addTextAt);
  const enterGroup = useEditor((s) => s.enterGroup);
  const applyElements = useEditor((s) => s.applyElements);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const setActivePage = useEditor((s) => s.setActivePage);
  const editingId = useEditor((s) => s.editingId);
  const artboardGridCols = useEditor((s) => s.artboardGridCols);
  const renamePage = useEditor((s) => s.renamePage);

  /** Tools that draw on the canvas: artwork becomes a surface, not a drag target. */
  const toolOwnsCanvas = useTools(
    (s) => ownsCanvas(s.tool, s.regionMode),
  );
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);

  const opRef = useRef<Op>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const spaceDown = useRef(false);
  const input = useRef<CanvasPointerSession | null>(null);
  if (!input.current)
    input.current = new CanvasPointerSession({
      navigate: (start) =>
        stageRef.current
          ? beginCanvasNavigation(stageRef.current, start)
          : () => {},
      undo: () => useEditor.getState().undo(),
      redo: () => useEditor.getState().redo(),
    });

  /*
   * Guides, the rotation readout and the marquee are TRANSIENT interaction
   * overlays: they live in the interaction store, and only the small overlay
   * components that paint them subscribe. Keeping them as local state here
   * re-rendered the ENTIRE stage (every artboard, every element) on each
   * pointer frame of a drag.
   */
  const setGuides = useInteraction((s) => s.setGuides);
  const setRotationHint = useInteraction((s) => s.setRotationHint);
  const setMarquee = useInteraction((s) => s.setMarquee);
  const [dropping, setDropping] = useState<
    "file" | "document" | "library" | null
  >(null);
  /*
   * The live tool comes from the ONE tool store. Reading `toolState()` inside a
   * gesture (never a stale closure) is what makes the first press after picking
   * a tool behave exactly like the tenth — the old code kept a local
   * `drawTool` plus two refs fed by window events, so the canvas and the header
   * could disagree about what was armed.
   */
  const tool = useTools((s) => s.tool);
  const regionMode = useTools((s) => s.regionMode);
  const rasterCursor = useRef<{
    show: (x: number, y: number, size: number) => void;
    hide: () => void;
  } | null>(null);
  const strokeRef = useRef<RasterStroke | null>(null);
  const drawArmed = toolDef(tool).family === "draw";
  const rasterActive = isRasterTool(tool);
  /** Only the plain pointer touches artwork; an armed region draws over it. */
  const pointerTool = tool === "select" && regionMode === "off";
  /** Tools whose gesture is drawn, not dragged: the page shows a crosshair. */
  const crosshairTool =
    rasterActive || drawArmed || isRegionArmed(tool, regionMode);
  const pageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  /** The stage node, as state so the artboard IntersectionObservers (which are
   *  created in an effect and need a real element for `root`) can use it. */
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setStageEl(stage);
    const measure = () => {
      stage.style.setProperty("--canvas-pan-x", `${stage.clientWidth}px`);
      stage.style.setProperty("--canvas-pan-y", `${stage.clientHeight}px`);
    };
    measure();
    const active = stage.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(useEditor.getState().activePageId || "")}"]`,
    );
    if (active) {
      const rect = active.getBoundingClientRect(),
        viewport = stage.getBoundingClientRect();
      stage.scrollLeft +=
        rect.left + rect.width / 2 - viewport.left - stage.clientWidth / 2;
      stage.scrollTop +=
        rect.top + rect.height / 2 - viewport.top - stage.clientHeight / 2;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
  /**
   * Page node registry, stable across renders.
   *
   * The key is deleted (not just nulled) when a virtualised artboard unmounts,
   * so the map cannot grow without bound as you scroll a long document and
   * hit-testing never sees a detached node for an offscreen page.
   */
  const registerPageRef = useCallback(
    (pageId: string, node: HTMLDivElement | null) => {
      if (node) pageRefs.current[pageId] = node;
      else delete pageRefs.current[pageId];
    },
    [],
  );
  /** Clicking an artboard's name: make it active and drop the selection. */
  const activatePage = useCallback((pageId: string) => {
    useEditor.getState().setActivePage(pageId);
    useEditor.getState().select(null);
  }, []);
  const [layerPicker, setLayerPicker] = useState<LayerPickerState>(null);

  /*
   * Raster tools own a cursor ring; it is imperative DOM, not React state, so
   * a hovering Pencil over the canvas never re-renders the editor. The ring is
   * created once per tool change and destroyed on unmount — no leaked nodes.
   */
  useEffect(() => {
    if (!rasterActive) {
      rasterCursor.current?.hide();
      rasterCursor.current = null;
      return;
    }
    const node = document.createElement("div");
    node.className = `raster-cursor raster-cursor-${tool === "eraser" ? "eraser" : "brush"}`;
    node.setAttribute("aria-hidden", "true");
    node.style.display = "none";
    document.body.appendChild(node);
    rasterCursor.current = {
      show: (x, y, size) => {
        const mode = toolState().tool === "eraser" ? "eraser" : "brush";
        node.className = `raster-cursor raster-cursor-${mode}`;
        node.style.display = "block";
        node.style.width = `${size}px`;
        node.style.height = `${size}px`;
        node.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
      },
      hide: () => {
        node.style.display = "none";
      },
    };
    return () => {
      node.remove();
      rasterCursor.current = null;
    };
  }, [rasterActive, tool]);

  /**
   * Single-owner Escape hierarchy for canvas interactions:
   *  1. Active pointer gesture / live raster stroke / marquee → cancel immediately
   *  2. Open layer-picker popup → dismiss
   *  3. Finished selection region → clear region (keeping tool armed)
   *  4. Armed non-default tool → reset to plain pointer (`select`)
   * Each press consumes at most one step and stops propagation so EditorApp
   * never cascades into deselecting artwork on the same keydown event.
   */
  useEffect(() => {
    const disarm = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      if (
        typeof document !== "undefined" &&
        document.querySelector('[role="dialog"], [role="menu"], .anchor-menu')
      )
        return;
      const interaction = useInteraction.getState();
      if (
        input.current?.busy ||
        strokeRef.current !== null ||
        interaction.active ||
        interaction.marquee
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        input.current?.reset();
        strokeRef.current?.cancel();
        strokeRef.current = null;
        useTools.getState().setPainting(false);
        interaction.endInteraction();
        interaction.setMarquee(null);
        document.body.classList.remove("is-gesturing");
        return;
      }
      if (layerPicker) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setLayerPicker(null);
        return;
      }
      if (interaction.crop) return;
      const live = toolState();
      if (live.region) {
        e.preventDefault();
        e.stopImmediatePropagation();
        useTools.getState().setRegion(null);
        return;
      }
      if (live.tool !== "select" || live.regionMode !== "off") {
        e.preventDefault();
        e.stopImmediatePropagation();
        useTools.getState().resetTool();
      }
    };
    window.addEventListener("keydown", disarm, true);
    return () => window.removeEventListener("keydown", disarm, true);
  }, [layerPicker]);

  /** A stroke must never outlive its component, a page switch or a tool swap. */
  useEffect(
    () => () => {
      strokeRef.current?.cancel();
      strokeRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!rasterActive) {
      strokeRef.current?.cancel();
      strokeRef.current = null;
    }
  }, [rasterActive]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const prev = useEditor.getState().zoom;
      const next = clampZoom(prev * Math.exp(-e.deltaY * 0.002));
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
    const visibility = () => {
      if (document.hidden) reset();
    };
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
      updatePenHover(
        event.clientX,
        event.clientY,
        useEditor.getState().activePageId,
      );
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

  const dropPoint = (e: { clientX: number; clientY: number }) =>
    canvasDropPoint(
      stageRef.current,
      useEditor.getState().pages,
      e.clientX,
      e.clientY,
    );

  const visible = useMemo(
    () => (previewAll ? pages : pages.filter((p) => p.id === activePageId)),
    [pages, previewAll, activePageId],
  );

  /*
   * ---------------------------------------------------------------- raster
   *
   * Brush and eraser are PIXEL tools. The gesture owns the pointer, paints
   * into an offscreen bitmap through `RasterStroke`, mirrors only the touched
   * rectangles into an overlay canvas, and writes to the document exactly once
   * on pointerup — one undoable step, no re-render per frame, and no risk of a
   * stroke landing on a neighbouring element: the dab is clipped to the target
   * element's own visible artwork.
   */
  const rasterTargetAt = (
    page: Page,
    point: { x: number; y: number },
    preferSelected: boolean,
    padMm = 0,
  ) => {
    const state = useEditor.getState();
    const enteredGroupId =
      state.activePageId === page.id ? state.enteredGroupId : null;
    const group = enteredGroupId
      ? findElement(page.elements, enteredGroupId)?.el
      : null;
    const candidates = (group?.children ?? page.elements).filter(
      (el) => !el.hidden && !el.locked && isRasterElement(el),
    );
    const pad = Math.max(0, padMm);
    const hits = candidates.filter((el) => {
      const scene = cropSceneTransform(page.elements, el.id, enteredGroupId);
      if (scene) {
        const local = cropLocalPoint(scene, point);
        return (
          local.x >= -pad &&
          local.x <= el.w + pad &&
          local.y >= -pad &&
          local.y <= el.h + pad
        );
      }
      const offset = group ? { x: group.x, y: group.y } : { x: 0, y: 0 };
      return pointInRotatedBox(
        {
          ...el,
          x: el.x + offset.x - pad,
          y: el.y + offset.y - pad,
          w: el.w + pad * 2,
          h: el.h + pad * 2,
        },
        point.x,
        point.y,
      );
    });
    if (!hits.length) return null;
    hits.sort((a, b) => b.z - a.z);
    if (preferSelected) {
      const selected = hits.find((el) => state.selectedIds.includes(el.id));
      if (selected) return selected;
    }
    return hits[0]!;
  };

  const startRaster = (e: React.PointerEvent, page: Page) => {
    const state = useEditor.getState();
    if (state.activePageId !== page.id) state.setActivePage(page.id);
    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    let cachedRect = pageEl.getBoundingClientRect();
    const toMm = (
      event: { clientX: number; clientY: number },
      rect = cachedRect,
    ) => pagePoint(rect, size, event.clientX, event.clientY);
    const active = useTools.getState();
    const strokeTool = toolState().tool === "eraser" ? "eraser" : "brush";
    const settings =
      strokeTool === "eraser" ? active.eraser : active.brush;
    const hitPadMm = strokeTool === "eraser" ? settings.sizeMm / 2 : 0;
    const point = toMm(e, cachedRect);
    let target = rasterTargetAt(page, point, true, hitPadMm);

    const resolveTransform = (candidate: CanvasEl | null) =>
      candidate
        ? (cropSceneTransform(
            page.elements,
            candidate.id,
            useEditor.getState().enteredGroupId,
          ) ?? null)
        : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

    let transform = resolveTransform(target);
    if (target && !transform) return;

    const samplePressure = (ev: { pointerType?: string; pressure?: number }) =>
      ev.pointerType === "pen" && typeof ev.pressure === "number" && ev.pressure > 0
        ? ev.pressure
        : ev.pressure && ev.pressure > 0
          ? ev.pressure
          : undefined;

    let lastClient = { x: e.clientX, y: e.clientY };
    let lastPressure = samplePressure(e);
    let cancelled = false;
    let loadingTarget = false;
    let rafId = 0;

    const queued: { clientX: number; clientY: number; pressure?: number }[] = [
      { clientX: e.clientX, clientY: e.clientY, pressure: lastPressure },
    ];
    let node: HTMLImageElement | null = null;

    const lookupNode = (candidate: CanvasEl | null) =>
      candidate
        ? pageEl.querySelector<HTMLImageElement>(
            `.canvas-el[data-el-id="${CSS.escape(candidate.id)}"] img`,
          )
        : null;

    node = lookupNode(target);
    rasterCursor.current?.hide();
    document.body.classList.add("is-gesturing");

    const flushQueued = () => {
      rafId = 0;
      if (cancelled) return;
      const stroke = strokeRef.current;
      if (!stroke || !queued.length) return;
      cachedRect = pageEl.getBoundingClientRect();
      const livePxPerMm =
        cachedRect.width > 0 ? cachedRect.width / size.w : mmToPx(1);
      stroke.updatePxPerMm(livePxPerMm);
      for (const sample of queued) {
        const pt = toMm(sample, cachedRect);
        stroke.paint(pt, sample.pressure, true);
      }
      queued.length = 0;
      stroke.flush();
    };

    const scheduleFlush = () => {
      if (rafId !== 0 || cancelled || !strokeRef.current) return;
      rafId = requestAnimationFrame(flushQueued);
    };

    const create = (
      image: CanvasImageSource | null,
      source: { w: number; h: number },
    ) => {
      if (cancelled || !transform) return;
      cachedRect = pageEl.getBoundingClientRect();
      const pxPerMm =
        cachedRect.width > 0 ? cachedRect.width / size.w : mmToPx(1);
      const stroke = new RasterStroke({
        pageId: page.id,
        pageNode: pageEl,
        pxPerMm,
        mode: strokeTool,
        sizeMm: settings.sizeMm,
        hardness: settings.hardness,
        opacity: settings.opacity,
        smoothing: strokeTool === "brush" ? active.brush.smoothing : 0,
        color:
          strokeTool === "brush"
            ? parseHexColor(active.brush.color)
            : parseHexColor("#000000"),
        target: target && image ? { el: target, image, source } : null,
        page: { w: size.w, h: size.h },
        transform,
      });
      strokeRef.current = stroke;
      useTools.getState().setPainting(true);
      stroke.moveCursor(lastClient.x, lastClient.y);
      flushQueued();
    };

    const beginForTarget = () => {
      if (cancelled) return;
      if (strokeTool === "eraser" && !target) return;
      node = lookupNode(target);
      const loadedSync =
        target && node && node.complete && node.naturalWidth
          ? {
              image: node as CanvasImageSource,
              source: {
                w: target.style.crop?.sourceW || node.naturalWidth,
                h: target.style.crop?.sourceH || node.naturalHeight,
              },
            }
          : null;
      if (target && !loadedSync) {
        loadingTarget = true;
        void loadRasterSource(target, node).then((loaded) => {
          loadingTarget = false;
          if (!cancelled && loaded) create(loaded.image, loaded.source);
        });
        return;
      }
      create(
        loadedSync?.image ?? null,
        loadedSync?.source ?? { w: size.w, h: size.h },
      );
    };

    const cancelStroke = () => {
      cancelled = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      queued.length = 0;
      const stroke = strokeRef.current;
      strokeRef.current = null;
      useTools.getState().setPainting(false);
      document.body.classList.remove("is-gesturing");
      stroke?.cancel();
    };

    const finish = (event?: PointerEvent) => {
      if (cancelled) return;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      document.body.classList.remove("is-gesturing");
      const stroke = strokeRef.current;
      if (!stroke) {
        useTools.getState().setPainting(false);
        if (strokeTool === "eraser" && !target) {
          toast.message(
            "أداة المسح تعمل على الصور والطبقات النقطية — لا يوجد بكسل هنا",
          );
        }
        return;
      }
      if (event) {
        const movedFromLast =
          Math.hypot(
            event.clientX - lastClient.x,
            event.clientY - lastClient.y,
          ) > 0.5;
        if (movedFromLast || !stroke.painted) {
          const endPressure = samplePressure(event) ?? lastPressure;
          queued.push({
            clientX: event.clientX,
            clientY: event.clientY,
            pressure: endPressure,
          });
        }
      }
      flushQueued();
      strokeRef.current = null;
      useTools.getState().setPainting(false);
      stroke.hideCursor();
      let patch: ReturnType<RasterStroke["commit"]> = null;
      try {
        patch = stroke.commit();
      } catch {
        toast.error("لا يمكن تعديل هذه الصورة — المصدر خارجي محمي");
        return;
      }
      if (!patch) return;
      const store = useEditor.getState();
      if (patch.layer) {
        store.addElementAt(
          "image",
          {
            name: strokeTool === "eraser" ? "طبقة مسح" : "طبقة رسم",
            src: patch.layer.src,
            x: patch.layer.x,
            y: patch.layer.y,
            w: patch.layer.w,
            h: patch.layer.h,
            style: { objectFit: "fill", crop: undefined },
          },
          undefined,
          page.id,
        );
        return;
      }
      if (!patch.src) return;
      /*
       * Geometry is NEVER part of this patch. Erasing or painting changes the
       * pixels and nothing else, so a stroke cannot move an element, break its
       * transform, or disturb its neighbours.
       */
      if (node) node.src = patch.src;
      const elementPatch: Partial<CanvasEl> = { src: patch.src };
      if (patch.crop && target?.style.crop)
        elementPatch.style = { crop: patch.crop };
      const elementId = stroke.elementId ?? target?.id;
      if (elementId) store.patchElementOnPage(page.id, elementId, elementPatch);
    };

    input.current!.claim(e, {
      yieldable: e.pointerType === "touch",
      move: (ev) => {
        if (cancelled) return;
        const coalesced =
          typeof ev.getCoalescedEvents === "function"
            ? ev.getCoalescedEvents()
            : [];
        const events = coalesced.length ? coalesced : [ev];
        for (const item of events) {
          const p = samplePressure(item) ?? lastPressure;
          if (p !== undefined) lastPressure = p;
          lastClient = { x: item.clientX, y: item.clientY };
          queued.push({
            clientX: item.clientX,
            clientY: item.clientY,
            pressure: p,
          });
        }
        if (queued.length > 256) queued.splice(0, queued.length - 256);

        const stroke = strokeRef.current;
        if (!stroke) {
          if (strokeTool === "eraser" && !target && !loadingTarget) {
            cachedRect = pageEl.getBoundingClientRect();
            const curPt = toMm(ev, cachedRect);
            const swept = rasterTargetAt(page, curPt, true, hitPadMm);
            if (swept) {
              target = swept;
              transform = resolveTransform(target);
              if (transform) {
                queued.splice(0, queued.length - 1);
                beginForTarget();
              }
            }
          }
          return;
        }
        stroke.moveCursor(ev.clientX, ev.clientY);
        scheduleFlush();
      },
      end: (ev) => finish(ev),
      cancel: () => cancelStroke(),
    });
    beginForTarget();
  };

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
    if (e.button !== 0 || input.current!.busy || useInteraction.getState().crop)
      return;
    /*
     * Defence in depth for the shared interaction layer.
     *
     * The capture-phase router claims the pointer for drawing tools before an
     * element can see it, but selection-frame handles are real buttons and are
     * deliberately skipped there. This guard is the second half of the same
     * rule: a paint/draw tool can never start an element gesture, and a select
     * tool with an armed region shape can move nothing — only resize/rotate
     * its own frame or region.
     */
    const liveTool = toolState();
    const activeFamily = toolDef(liveTool.tool).family;
    if (activeFamily === "raster" || activeFamily === "draw") return;
    if (isRegionArmed(liveTool.tool, liveTool.regionMode) && kind === "move")
      return;
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
        const isHorizontalOnly = handle === "e" || handle === "w";
        if (isHorizontalOnly) {
          e.stopPropagation();
          select(el.id);
          return;
        }
      }
      if (el.heightLocked && (handle.includes("n") || handle.includes("s"))) {
        const isVerticalOnly = handle === "n" || handle === "s";
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
      try {
        captureTarget.setPointerCapture(e.pointerId);
      } catch {
        /* detached */
      }
    }

    const stateBeforeActivation = useEditor.getState();
    const enteredGroupForPage =
      stateBeforeActivation.activePageId === page.id
        ? stateBeforeActivation.enteredGroupId
        : null;
    stateBeforeActivation.setActivePage(page.id);

    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    const size = pageSize(page);
    const rect = pageEl.getBoundingClientRect();
    const toMm = (ev: { clientX: number; clientY: number }) =>
      pagePoint(pageEl.getBoundingClientRect(), size, ev.clientX, ev.clientY);

    const start = toMm(e);
    const slopMm = Math.max(
      0.2,
      (POINTER_SLOP * size.w) / Math.max(1, rect.width),
    );
    let maxDist = 0;

    const enteredGroup = enteredGroupForPage
      ? findElement(page.elements, enteredGroupForPage)?.el || null
      : null;
    const enteredChildren = enteredGroup?.children || [];

    const defer =
      kind === "move" &&
      !e.shiftKey &&
      (e.pointerType === "touch" || e.pointerType === "pen");
    let decided = !defer;
    let heldLong = false;
    let longPressHandle: LongPressHandle | null = null;
    let longPressFired = false;
    /** Last informative pointer angle for a rotation (see the dead zone in
     * the rotate branch of `paintFrame`). */
    let rotateHold: number | null = null;

    /**
     * `additive` keeps whatever is already selected and adds this element —
     * the multi-select a long press enters, and the Shift+click equivalent on
     * a desktop. `selectMany` (not `toggleSelect`) so a long press on an
     * element that is ALREADY selected keeps the group instead of dropping it.
     */
    const applyPressSelection = (additive = false) => {
      const fresh = useEditor.getState();
      if (additive) {
        if (!fresh.selectedIds.includes(el.id))
          fresh.selectMany([...fresh.selectedIds, el.id]);
        return;
      }
      if (e.shiftKey) toggleSelect(el.id);
      else if (!fresh.selectedIds.includes(el.id)) select(el.id);
    };

    const beginGesture = () => {
      document.body.classList.add("is-gesturing");
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
      useInteraction.getState().beginInteraction();
    };

    if (decided) beginGesture();

    // Centralized long-press timer, only for element bodies when plain pointer is active.
    if (
      defer &&
      shouldArmCanvasLongPress({
        pointerType: e.pointerType,
        tool: liveTool.tool,
        regionMode: liveTool.regionMode,
        cropActive: Boolean(useInteraction.getState().crop),
        spacePanning: spaceDown.current,
      })
    ) {
      longPressHandle = startLongPressTimer({
        startX: e.clientX,
        startY: e.clientY,
        delayMs: CANVAS_LONG_PRESS_MS,
        slopPx: POINTER_SLOP,
        onTrigger: () => {
          input.current!.lock(e.pointerId);
          longPressFired = true;
          heldLong = true;
          decided = true;
          /*
           * A long press enters MULTI-SELECT: the pressed element joins the
           * current selection and the object does not move — the gesture never
           * becomes a drag (`heldLong` blocks every frame and the commit), so
           * the author can hold, add, and then drag the group with the next
           * press.
           */
          applyPressSelection(true);
          useEditor.getState().openContextMenu({
            x: e.clientX,
            y: e.clientY,
            targetId: el.id,
            source: "canvas",
          });
        },
      });
    }

    const others = page.elements.filter((x) => x.id !== el.id && !x.hidden);

    /*
     * ── Transient gesture loop ────────────────────────────────────────────
     *
     * Pointer frames NEVER write the document store. Each frame:
     *   1. computes the final geometry exactly as before (snap, clamp,
     *      shift/alt semantics unchanged),
     *   2. publishes it to the interaction store, which re-renders only the
     *      dragged element nodes and the guide overlay at display rate,
     *   3. records the STORE-space result for the commit.
     * The document is written once, on release, through `applyElements` —
     * one store notification, one undo entry, one autosave scheduling.
     *
     * Frames are coalesced with requestAnimationFrame: on 120 Hz pointers the
     * old path recomputed snapping and re-rendered the app twice per displayed
     * frame.
     */
    const interaction = useInteraction.getState();
    /** Store-space geometry of every gesture element at the last frame. */
    let finals: CanvasEl[] = [];
    let framePending = false;
    let lastMoveEv: PointerEvent | null = null;

    const paintFrame = (ev: PointerEvent) => {
      framePending = false;
      const op = opRef.current;
      if (!op || heldLong) return;
       if (!decided) return;
      /*
       * ONE modifier rule for every input: the keyboard's Shift/Alt, or the
       * held second finger a touch/Pencil gesture reports through the pointer
       * session. Nothing below branches on the device — it reads the merged
       * value, so a modifier drag snaps angles and locks proportions exactly
       * like Shift does, and releasing the finger mid-drag frees it again.
       */
      const touchShift = input.current!.shiftModifier;
      const shiftHeld = ev.shiftKey || touchShift;
      const altHeld = ev.altKey;
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
          snapGrid && !altHeld,
          !altHeld && (snapElements || shiftHeld),
          zoomNow,
          op.origins,
          op.orig.rotation || 0,
        );
        setGuides(snapped);
      } else if (op.kind === "resize") {
        const mirrored = mirrorHandle(
          op.handle || "se",
          op.orig.style?.flipX === true,
          op.orig.style?.flipY === true,
        );
        const ratioLocked = shiftHeld || op.orig.style?.aspectLock === true;
        /*
         * Anchor-based resize — the ONE model for every shape at every
         * rotation (see `resizeToPointer`). The pointer's absolute page
         * position is the input: the anchor stays put, the grabbed
         * corner/edge lands exactly under the pointer, and x/y/w/h are
         * back-solved. At rotation 0 this reduces to the classic
         * `resizeByHandle` results, so axis-aligned behaviour is unchanged.
         *
         * Alt = التحويل من المركز (center-based resize): the original centre
         * stays pinned while both sides move — the same modifier the move
         * gesture uses to suspend snapping, so holding Alt always means
         * "raw, unassisted transform". Snapping is skipped while Alt is held
         * and during ratio-locked resizes (the dragged edge would fight the
         * proportion constraint) — EXCEPT for the touch modifier, which keeps
         * a uniform, proportion-preserving snap so a locked resize still
         * reports its alignment.
         */
        resizeToPointer(
          next,
          op.orig,
          mirrored,
          { x: cur.x, y: cur.y },
          op.orig.rotation || 0,
          ratioLocked,
          {
            widthLocked: op.orig.widthLocked,
            heightLocked: op.orig.heightLocked,
            centered: altHeld,
          },
        );
        if (!ratioLocked) {
          const zoomNow = useEditor.getState().zoom;
          setGuides(
            applyResizeSnap(
              next,
              mirrored,
              others,
              size,
              snapGrid && !altHeld,
              snapElements && !altHeld,
              zoomNow,
              op.orig.rotation || 0,
            ),
          );
        } else if (touchShift) {
          const zoomNow = useEditor.getState().zoom;
          setGuides(
            applyResizeSnap(
              next,
              mirrored,
              others,
              size,
              false,
              true,
              zoomNow,
              op.orig.rotation || 0,
              { ratioLock: true },
            ),
          );
        }
      } else if (op.kind === "rotate") {
        const cx = op.orig.x + op.orig.w / 2;
        const cy = op.orig.y + op.orig.h / 2;
        const a0 = Math.atan2(op.startY - cy, op.startX - cx);
        /*
         * Guard against pointer noise at the centre: atan2 is undefined at
         * zero radius, and within a couple of mm of the centre a 1px wobble
         * swings the angle through tens of degrees, which reads as the
         * object spinning "randomly". Inside that dead zone the pointer
         * angle carries no information, so the angle is held from the last
         * informative frame (the drag still rotates by whatever the pointer
         * swept before entering the zone).
         */
        const distC = Math.hypot(cur.x - cx, cur.y - cy);
        const a1 =
          distC < 2 ? (rotateHold ?? a0) : Math.atan2(cur.y - cy, cur.x - cx);
        if (distC >= 2) rotateHold = a1;
        const raw = (op.orig.rotation || 0) + ((a1 - a0) * 180) / Math.PI;
        next.rotation = snapRotation(raw, shiftHeld);
        setRotationHint({
          angle: next.rotation,
          shift: shiftHeld,
          touch: ev.pointerType !== "mouse",
          x: ev.clientX,
          y: ev.clientY,
        });
      }
      // Only resize dimensions have a safety cap; x/y stay free in page space.
      const maxWidth = size.w + RESIZE_OVERFLOW_MM * 2;
      const maxHeight = size.h + RESIZE_OVERFLOW_MM * 2;
      next.w = Math.max(clamp(next.w, MIN_SIZE, maxWidth), MIN_SIZE);
      next.h = Math.max(clamp(next.h, MIN_SIZE, maxHeight), MIN_SIZE);
      /*
       * Publish the frame. `next` (and the sibling maths below) are in
       * ABSOLUTE page mm — the coordinate space the element nodes render in.
       * The store, however, keeps entered-group children in parent-relative
       * mm, so the commit stash carries the shifted copy.
       */
      const batch: CanvasEl[] = [
        op.parent
          ? { ...next, x: next.x - op.parent.x, y: next.y - op.parent.y }
          : next,
      ];
      interaction.setOverride(op.id, {
        x: next.x,
        y: next.y,
        w: next.w,
        h: next.h,
        rotation: next.rotation,
      });
      if (op.kind === "move") {
        const appliedDx = next.x - op.orig.x;
        const appliedDy = next.y - op.orig.y;
        // Group members live in their own (parent-relative) list.
        const siblingList =
          op.parent && enteredGroup ? enteredChildren : page.elements;
        for (const [id, origin] of Object.entries(op.origins)) {
          if (id === op.id) continue;
          const sibling = siblingList.find((x) => x.id === id);
          if (!sibling) continue;
          const storeX = origin.x + appliedDx;
          const storeY = origin.y + appliedDy;
          batch.push({ ...sibling, x: storeX, y: storeY });
          interaction.setOverride(id, {
            x: storeX + (op.parent?.x ?? 0),
            y: storeY + (op.parent?.y ?? 0),
          });
        }
      }
      finals = batch;
    };

    const move = (ev: PointerEvent) => {
      if (longPressFired) return;
      longPressHandle?.move(ev.clientX, ev.clientY);
      if (!decided) {
        const cur = toMm(ev);
        const dist = Math.hypot(cur.x - start.x, cur.y - start.y);
        const screenDist = Math.hypot(
          ev.clientX - e.clientX,
          ev.clientY - e.clientY,
        );
        if (dist < slopMm && screenDist < POINTER_SLOP) return;
        decided = true;
        longPressHandle?.cancel();
        longPressHandle = null;
        input.current!.lock(e.pointerId);
        beginGesture();
        /*
         * A held modifier finger can be confirmed after the finger has already
         * travelled (that is how the two-finger case is disambiguated from a
         * pan). Starting the drag from the CURRENT point keeps the element
         * exactly where it is instead of jumping the distance the finger
         * covered while the gesture was still undecided.
         */
        if (input.current!.shiftModifier && opRef.current) {
          opRef.current.startX = cur.x;
          opRef.current.startY = cur.y;
        }
        maxDist = dist;
      }
      if (heldLong) return;
      lastMoveEv = ev;
      if (!framePending) {
        framePending = true;
        requestAnimationFrame(() => {
          if (framePending && lastMoveEv) paintFrame(lastMoveEv);
        });
      }
    };

    const detach = () => {
      // Capture belongs to the stage until native up/cancel, including promotion
      // from a pending element press to a two-finger gesture.
      longPressHandle?.cancel();
      longPressHandle = null;
    };

    const up = (ev: PointerEvent) => {
      const hadGesture = opRef.current !== null;
      if (longPressFired) {
        detach();
        opRef.current = null;
      document.body.classList.remove("is-gesturing");
        interaction.endInteraction();
        return;
      }
      if (!decided) {
        decided = true;
        applyPressSelection();
      }
      detach();
      const wasTap = kind === "move" && !heldLong && maxDist < slopMm;

      if (wasTap) {
        const pageForHit = pages.find((p) => p.id === page.id);
        if (pageForHit) {
          const hits = elementsAtPoint(
            pageForHit,
            enteredGroupId,
            start.x,
            start.y,
          );
          const key = hits.map((hit) => hit.id).join("\0");
          const now = performance.now();
          const repeat =
            hits.length > 1 &&
            key === lastAmbiguousStack.key &&
            now - lastAmbiguousStack.at < 1400 &&
            useEditor.getState().selectedIds.includes(hits[0].id);
          lastAmbiguousStack = { key, at: now };
          if (hits.length > 1 && (repeat || ev.altKey)) {
            setTimeout(() => {
              if (!input.current!.busy) {
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
        if (
          (ev.pointerType === "touch" || ev.pointerType === "pen") &&
          noteElementTap(page.id, el.id, ev.pointerType)
        ) {
          fireSyntheticDoubleClick(page.id, el.id);
        }
      }
      opRef.current = null;
      document.body.classList.remove("is-gesturing");
      /*
       * Commit: flush any frame the rAF gate had not painted, drop the
       * transient overrides, then write the final geometry to the document in
       * ONE batched store update (single history entry, single autosave).
       */
      if (hadGesture) {
        if (framePending && lastMoveEv) paintFrame(lastMoveEv);
        framePending = false;
        const committed = finals;
        finals = [];
        interaction.endInteraction();
        if (committed.length) applyElements(page.id, committed);
      } else {
        interaction.endInteraction();
      }
    };

    const cancel = () => {
      detach();
      framePending = false;
      lastMoveEv = null;
      opRef.current = null;
      document.body.classList.remove("is-gesturing");
      finals = [];
      interaction.endInteraction();
    };

    /*
     * `supportsModifier` is what lets a second contact act as the held
     * Shift-equivalent for THIS gesture (angle snapping, aspect-ratio resize,
     * element snapping). It is an element transform, so a held finger is a
     * modifier and never a pan — whichever finger happens to be holding it.
     */
    input.current!.claim(e, {
      move,
      end: up,
      cancel,
      yieldable: defer,
      supportsModifier: true,
    });
  };

  /*
   * Stable gesture sink for every element node. A fresh closure per stage
   * render would defeat ElementNode's memo — the whole point is that a
   * re-render of the stage (a zoom tick, a selection change, a page switch)
   * reconciles hundreds of element wrappers without re-running their paint.
   *
   * The page and element are resolved from the LIVE store at call time, so a
   * gesture that starts after an undo still acts on current geometry. The
   * element passed by the node wins when it is already the stored one; the
   * entered-group case passes absolute coordinates plus the parent offset,
   * exactly like the old inline closures did.
   */
  const startOpRef = useRef(startOp);
  startOpRef.current = startOp;
  const onElementGesture = useCallback<ElementGestureHandler>(
    (e, el, kind, handle, ctx) => {
      const state = useEditor.getState();
      const page = ctx?.pageId
        ? state.pages.find((p) => p.id === ctx.pageId)
        : state.pages.find((p) => p.id === state.activePageId);
      if (!page) return;
      startOpRef.current(e, page, el, kind, handle, ctx?.parent);
    },
    [],
  );

  const pickables = (
    page: Page,
    groupId: string | null,
  ): { id: string; box: Box; el: CanvasEl }[] => {
    const entered = groupId
      ? findElement(page.elements, groupId)?.el || null
      : null;
    if (entered?.children?.length) {
      // Entered-group children are parent-relative; the group's own rotation
      // is part of each child's visual silhouette, so the AABB is computed
      // in the group's local space (child rotation about the child's centre,
      // group rotation about the GROUP's centre) and translated by the
      // group's origin.
      return entered.children
        .filter((child) => !child.hidden)
        .map((child) => ({
          id: child.id,
          el: child,
          box: elementAABB(
            { x: child.x, y: child.y, w: child.w, h: child.h },
            child.rotation || 0,
            { x: entered.x, y: entered.y },
            entered.rotation || 0,
            { x: entered.w / 2, y: entered.h / 2 },
          ),
        }));
    }
    // Top level: the element's own box and rotation in page mm.
    return page.elements
      .filter((el) => !el.hidden)
      .map((el) => ({
        id: el.id,
        el,
        box: elementAABB(
          { x: el.x, y: el.y, w: el.w, h: el.h },
          el.rotation || 0,
          { x: 0, y: 0 },
        ),
      }));
  };

  const activePageForSelection = pages.find((p) => p.id === activePageId);
  const primarySelection = (() => {
    if (!selectedId || !activePageForSelection) return null;
    const found = findElement(activePageForSelection.elements, selectedId)?.el;
    return found && !found.hidden ? found : null;
  })();

  /**
   * ONE region gesture for every selection tool.
   *
   * Rectangle, Square, Ellipse, Lasso and the Shape/Image/Layer pickers all run
   * through this function, so they share one pointer lifecycle (claim → live
   * preview → commit), one coordinate conversion, one hit-test and one
   * page-clamping rule. Before this, the marquee shape lived in a ref fed by a
   * window event and only two tools could use it, which is why choosing
   * «تحديد بيضاوي» could look armed and still draw a rectangle — or nothing.
   *
   * Contract for the author:
   *  · pointerdown starts the region immediately (no arm-then-drag),
   *  · pointermove paints it live over the artwork,
   *  · pointerup keeps it, with handles, using `data-region` chrome,
   *  · Shift = 1:1, Alt = from the centre,
   *  · the region is clamped to its own artboard, so it can never leak into
   *    another page in multi-page view.
   */
  const startMarquee = (
    e: React.PointerEvent,
    pageId: string,
    activate: "always" | "onmove" = "always",
  ) => {
    if (
      e.button !== 0 ||
      input.current!.busy ||
      isPalmTouch(e) ||
      useInteraction.getState().crop
    )
      return;
    /** Resolved at gesture time, like every other handler here: the node that
     *  started the gesture may belong to a page that has since been
     *  re-created by an undo, and virtualisation may have unmounted it. */
    const gestureState = toolState();
    const gestureTool = gestureState.tool;
    const gestureDef = toolDef(gestureTool);
    const drawing = gestureDef.family === "draw";
    const selecting = gestureTool === "select";
    if (!drawing && !selecting) return;
    /*
     * ONE select tool with a region shape armed keeps the finished region
     * (with its crop affordance); the plain pointer just rubber-bands a
     * group selection and lets the rectangle vanish on release.
     */
    const keepRegion = selecting && gestureState.regionMode !== "off";
    const stateAtStart = useEditor.getState();
    const page = stateAtStart.pages.find((candidate) => candidate.id === pageId);
    if (!page || page.locked || page.hidden) return;
    /*
     * A marquee that starts on the pasteboard is scoped to the already-active
     * page. It may clear or change artwork selection, but never activates the
     * nearest artboard just because a gesture began in empty workspace.
     */
    let activated = stateAtStart.activePageId === pageId;
    if (!activated && activate === "always") {
      stateAtStart.setActivePage(pageId);
      activated = true;
    }
    const activeState = useEditor.getState();
    const selectionForPage =
      activeState.activePageId === pageId ? activeState.selectedIds : [];
    const groupForPage =
      activeState.activePageId === pageId ? activeState.enteredGroupId : null;
    const pageEl = pageRefs.current[page.id];
    if (!pageEl) return;
    e.stopPropagation();
    const size = pageSize(page);
    const toMm = (ev: { clientX: number; clientY: number }) =>
      pagePoint(pageEl.getBoundingClientRect(), size, ev.clientX, ev.clientY);
    const start = toMm(e);
    const stage = stageRef.current!;
    const scroll = { x: stage.scrollLeft, y: stage.scrollTop };
    /*
     * One-finger pan on blank canvas belongs to the PLAIN POINTER only. A
     * region tool must draw on the first finger, and a raster tool must paint:
     * letting navigation steal those gestures is exactly what made them feel
     * dead. Finger scrolling works on blank canvas even when an element is
     * selected; a stationary tap on blank canvas still deselects on release.
     */
    const pan =
      e.pointerType === "touch" &&
      selecting &&
      gestureState.regionMode === "off";
    const before = e.shiftKey ? [...selectionForPage] : [];
    const candidates = pickables(page, groupForPage).flatMap((item) => {
      if (!toolAccepts(gestureTool, item.el)) return [];
      // A page whose overflow is VISIBLE keeps its off-sheet artwork
      // selectable: the marquee may not trim what the author can see.
      if (!pageClipsView(page, showOutsidePage)) return [item];
      const x = Math.max(0, item.box.x);
      const y = Math.max(0, item.box.y);
      const right = Math.min(size.w, item.box.x + item.box.w);
      const bottom = Math.min(size.h, item.box.y + item.box.h);
      return right > x && bottom > y
        ? [{ ...item, box: { x, y, w: right - x, h: bottom - y } }]
        : [];
    });
    let mode = resolveMarqueeMode(gestureTool, gestureState.regionMode, {
      shift: e.shiftKey,
      alt: e.altKey,
    });
    let points: { x: number; y: number }[] = [];
    let moved = false;
    let held = false;
    /** Last selection written by the marquee — a set-difference guard so a
     * pointer sweep does not write the store (and re-render the editor) on
     * every frame when the hit set has not actually changed. */
    let lastHitKey = "";
    const holdHandle = shouldArmCanvasLongPress({
      pointerType: e.pointerType,
      tool: gestureTool,
      regionMode: gestureState.regionMode,
      cropActive: Boolean(useInteraction.getState().crop),
      spacePanning: spaceDown.current,
    })
      ? startLongPressTimer({
          startX: e.clientX,
          startY: e.clientY,
          delayMs: CANVAS_LONG_PRESS_MS,
          slopPx: POINTER_SLOP,
          onTrigger: () => {
            held = true;
            input.current!.lock(e.pointerId);
            useEditor.getState().openContextMenu({
              x: e.clientX,
              y: e.clientY,
              targetId: null,
              source: "canvas",
            });
          },
        })
      : null;
    const finish = () => {
      holdHandle?.cancel();
      setMarquee(null);
    };
    input.current!.claim(e, {
      yieldable: e.pointerType === "touch",
      move: (ev) => {
        if (held) return;
        holdHandle?.move(ev.clientX, ev.clientY);
        if (
          !moved &&
          Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) <
            POINTER_SLOP
        )
          return;
        holdHandle?.cancel();
        moved = true;
        // A blank one-finger pan may promote to a two-finger navigation;
        // drawing/marquee selection, like an element drag, owns its pointer.
        if (!pan) input.current!.lock(e.pointerId);
        if (pan) {
          stage.scrollLeft = scroll.x - (ev.clientX - e.clientX);
          stage.scrollTop = scroll.y - (ev.clientY - e.clientY);
          return;
        }
        if (!activated) {
          useEditor.getState().setActivePage(pageId);
          activated = true;
        }
        // Shift/Alt are read live, so the author can lock the ratio mid-drag.
        mode = resolveMarqueeMode(gestureTool, gestureState.regionMode, {
          shift: ev.shiftKey,
          alt: ev.altKey,
        });
        const cur = toMm(ev);
        const box = marqueeBox({
          startX: start.x,
          startY: start.y,
          endX: cur.x,
          endY: cur.y,
          square: mode.square,
          fromCenter: mode.fromCenter,
        });
        if (mode.shape === "lasso") {
          points = appendRegionPoint(points, cur);
          setMarquee({
            pageId,
            x0: box.x,
            y0: box.y,
            x1: box.x + box.w,
            y1: box.y + box.h,
            shape: "lasso",
            points,
          });
        } else {
          setMarquee({
            pageId,
            x0: box.x,
            y0: box.y,
            x1: box.x + box.w,
            y1: box.y + box.h,
            shape: mode.shape === "ellipse" ? "ellipse" : "rect",
          });
        }
        if (drawing) return;
        const region = {
          shape: (mode.shape === "lasso" ? "lasso" : mode.shape === "ellipse" ? "ellipse" : "rect") as
            | "rect"
            | "ellipse"
            | "lasso",
          box,
          points: mode.shape === "lasso" ? points : undefined,
        };
        const hits = candidates
          .filter((item) => regionHitsBox(region, item.box))
          .map((item) => item.id);
        const merged = [...new Set([...before, ...hits])];
        const key = merged.join("\u0000");
        if (key !== lastHitKey) {
          lastHitKey = key;
          selectMany(merged);
        }
      },
      end: (ev) => {
        finish();
        if (held) return;
        if (drawing) {
          const end = toMm(ev);
          const box = {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            w: Math.max(MIN_SIZE, Math.abs(end.x - start.x)),
            h: Math.max(MIN_SIZE, Math.abs(end.y - start.y)),
          };
          useTools.getState().setTool("select");
          /*
           * «Draw Square» paints a real filled rectangle SHAPE in the
           * interface's single blue — the author sketches the box and gets a
           * finished, rescalable design element, not a blank container.
           */
          if (gestureTool === "shape")
            addElementAt("shape", {
              ...box,
              name: "مربع",
              style: { fill: "#3b6e9c", shapeId: "rect", shape: "rect" },
            });
          else {
            const id = addTextAt(box, page.id);
            if (id) requestAnimationFrame(() => requestEdit(page.id, id));
          }
          return;
        }
        if (!moved) {
          /*
           * A press that never moved is a PICK, in every mode of the select
           * tool: the topmost element under the finger is chosen, empty space
           * clears the selection. What used to need three scope-picker tools
           * is now one behaviour — the pointer and the region modes pick
           * identically, so no artwork is ever "the wrong kind" to select.
           */
          if (isRegionArmed(gestureTool, gestureState.regionMode)) {
            const point = toMm(ev);
            const outsideClippedPage =
              pageClipsView(page, showOutsidePage) &&
              (point.x < 0 ||
                point.y < 0 ||
                point.x > size.w ||
                point.y > size.h);
            const hit = outsideClippedPage
              ? undefined
              : elementsAtPoint(page, groupForPage, point.x, point.y).find(
                  (el) => !el.hidden && toolAccepts(gestureTool, el),
                );
            if (hit) select(hit.id);
            else if (!e.shiftKey) select(null);
            return;
          }
          if (!e.shiftKey) select(null);
          return;
        }
        // Keep the finished region: the handles make it editable, and
        // «قص التحديد» / «استخراج التحديد» consume exactly this geometry.
        if (!keepRegion) return;
        const end = toMm(ev);
        const raw = marqueeBox({
          startX: start.x,
          startY: start.y,
          endX: end.x,
          endY: end.y,
          square: mode.square,
          fromCenter: mode.fromCenter,
        });
        const box = clampRegionBox(raw, size);
        if (!box) return;
        const region: SelectionRegion = {
          pageId,
          shape:
            mode.shape === "lasso"
              ? "lasso"
              : mode.shape === "ellipse"
                ? "ellipse"
                : "rect",
          box,
          points: mode.shape === "lasso" ? points : undefined,
        };
        /*
         * A rectangular region drawn ON an image hands itself straight to the
         * non-destructive crop frame — the region IS the crop draft, so the
         * only controls the author needs now are the frame's handles and the
         * ephemeral Apply/Cancel bubble. Freeform and ellipse regions stay
         * selections (their geometry cannot survive a rectangular crop), with
         * «قص» offered from the region bar for a one-shot apply.
         */
        let handedToCrop = false;
        if (region.shape === "rect") {
          const target = rasterTargetAt(
            page,
            { x: box.x + box.w / 2, y: box.y + box.h / 2 },
            true,
          );
          /*
           * A region that swallows the whole picture was a SELECTION, not a
           * crop — only a region that leaves pixels outside opens the frame.
           */
          const cropsSomething =
            target && box.w * box.h < target.w * target.h * 0.94;
          if (target && cropsSomething) handedToCrop = beginImageCropToBox(target.id, box);
        }
        // One control surface at a time: while the crop frame owns the box,
        // the kept region must not draw a second set of handles under it.
        useTools.getState().setRegion(handedToCrop ? null : region);
      },
      cancel: finish,
    });
  };

  /** Resolve the visible artboard under a stage-level pointer start. */
  const pageAtPoint = (x: number, y: number): Page | null => {
    for (const page of [...visible].reverse()) {
      const node = pageRefs.current[page.id];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
        return page;
    }
    return null;
  };

  // Geometry is relative to each artboard, NOT bounded by it. Rendering and
  // export clipping stay unchanged; visible workspace overflow remains usable.
  /**
   * Resolve the topmost editable object at a screen point. Alt/Option-click
   * deliberately advances through the hit stack, which gives desktop users a
   * direct path to artwork behind another object without opening a context menu
   * or temporarily changing layer order.
   */
  const workspaceHit = (x: number, y: number, cycle = false) => {
    for (const page of [...visible].reverse()) {
      const node = pageRefs.current[page.id];
      if (!node) continue;
      const point = pagePoint(
        node.getBoundingClientRect(),
        pageSize(page),
        x,
        y,
      );
      const size = pageSize(page);
      // Hidden overflow is not a hit target. Once the author turns clipping
      // off, the same workspace geometry remains directly selectable.
      if (
        pageClipsView(page, showOutsidePage) &&
        (point.x < 0 || point.y < 0 || point.x > size.w || point.y > size.h)
      )
        continue;
      const pageIsActive = page.id === activePageId;
      const pageSelection = pageIsActive ? selectedSet : EMPTY_SELECTION;
      const pageEnteredGroupId = pageIsActive ? enteredGroupId : null;
      const hits = elementsAtPoint(
        page,
        pageEnteredGroupId,
        point.x,
        point.y,
      ).filter((el) => !el.hidden);
      let el = hits.find((el) => pageSelection.has(el.id)) || hits[0];
      if (cycle && hits.length > 1) {
        const selectedIndex = hits.findIndex((item) =>
          pageSelection.has(item.id),
        );
        el = hits[(selectedIndex + 1 + hits.length) % hits.length] || hits[0];
      }
      if (el) {
        const group = pageEnteredGroupId
          ? findElement(page.elements, pageEnteredGroupId)?.el
          : null;
        return {
          page,
          el,
          parent: group ? { x: group.x, y: group.y } : undefined,
        };
      }
    }
    return null;
  };

  return (
    <div
      ref={stageRef}
      className={cn(
        "editor-canvas-stage studio-grid relative min-h-0 min-w-0 overflow-auto",
        dropping && "is-dropping",
      )}
      /*
       * The tool's family and identity are ON the stage element, so every
       * cursor rule in CSS answers the same question the gesture layer does:
       * one attribute instead of four event-driven class names that could
       * disagree with the store.
       */
      data-tool={tool}
      data-pointer={pointerTool ? "true" : "false"}
      data-crosshair={crosshairTool ? "true" : "false"}
      style={{ "--editor-zoom": zoom } as React.CSSProperties}
      dir="ltr"
      onPointerMove={(e) => {
        if (!rasterActive || strokeRef.current || e.pointerType === "touch") {
          rasterCursor.current?.hide();
          return;
        }
        const page = pageAtPoint(e.clientX, e.clientY);
        if (!page) {
          rasterCursor.current?.hide();
          return;
        }
        const pageNode = pageRefs.current[page.id];
        const rect = pageNode?.getBoundingClientRect();
        const size = pageSize(page);
        const pxPerMm =
          rect && rect.width > 0 ? rect.width / size.w : mmToPx(zoom);
        const live = toolState();
        const sizeMm =
          live.tool === "eraser" ? live.eraser.sizeMm : live.brush.sizeMm;
        rasterCursor.current?.show(
          e.clientX,
          e.clientY,
          Math.max(2, sizeMm * pxPerMm),
        );
      }}
      onPointerLeave={() => {
        rasterCursor.current?.hide();
      }}
      onLostPointerCapture={(e) => input.current!.end(e.nativeEvent, true)}
      onPointerDownCapture={(e) => {
        if (isPalmTouch(e)) {
          e.stopPropagation();
          return;
        }
        const target = e.target as HTMLElement;
        if (target.closest(".crop-overlay")) return;
        if (
          target.closest(
            "button, input, textarea, select, [contenteditable=true], .floating-toolbar, .layer-picker-popup",
          )
        )
          return;
        if (input.current!.down(e.nativeEvent)) {
          e.stopPropagation();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* detached */
          }
          return;
        }
        /*
         * Raster tools claim the pointer HERE, in capture, before any element
         * handler can see it. That is what makes "the brush painted a stroke"
         * and "the brush dragged the photo underneath it" mutually
         * exclusive — no element can be moved by a drawing tool, ever. The
         * select tool's region modes go through the stage's own pointer-down
         * (the marquee path), which is what routes them to the crop engine.
         */
        const liveTool = toolState().tool;
        if (e.button === 0 && isRasterTool(liveTool)) {
          const page = pageAtPoint(e.clientX, e.clientY);
          if (page) {
            e.preventDefault();
            startRaster(e, page);
          }
          return;
        }
        if (
          spaceDown.current &&
          e.pointerType === "mouse" &&
          e.button === 0 &&
          !target.closest(".handle, .rotate-handle")
        ) {
          e.preventDefault(); // Space+drag replaces native text selection.
          e.stopPropagation();
          const stage = e.currentTarget;
          const left = stage.scrollLeft,
            top = stage.scrollTop;
          input.current!.claim(e, {
            yieldable: false,
            move: (ev) => {
              stage.scrollLeft = left - (ev.clientX - e.clientX);
              stage.scrollTop = top - (ev.clientY - e.clientY);
            },
            end: () => {},
            cancel: () => {},
          });
          return;
        }
        // Handles keep first refusal. Geometry then resolves selected artwork
        // ahead of other elements, including overflow outside the page DOM box.
        // A drawing tool — or the select tool with a region shape armed —
        // never falls through to a move gesture: the element under the pointer
        // is artwork to select or crop, not to drag.
        if (
          e.button === 0 &&
          !ownsCanvas(liveTool, toolState().regionMode) &&
          !target.closest(".handle, .rotate-handle")
        ) {
          if (e.altKey) e.preventDefault();
          const hit = workspaceHit(e.clientX, e.clientY, e.altKey);
          if (hit && toolAccepts(liveTool, hit.el))
            startOp(e, hit.page, hit.el, "move", undefined, hit.parent);
        }
      }}
      onPointerDown={(e) => {
        if (isPalmTouch(e) || input.current!.busy) return;
        const target = e.target as HTMLElement;
        if (target.closest(".crop-overlay")) return;
        if (
          target.closest(
            "button, input, textarea, select, [contenteditable=true], .floating-toolbar, .layer-picker-popup",
          )
        )
          return;
        setLayerPicker(null);
        onCanvasTap?.();
        let page = pageAtPoint(e.clientX, e.clientY);
        let activate: "always" | "onmove" = "always";
        if (!page) {
          // Empty pasteboard space never selects or activates a neighboring
          // artboard. Keep a select-tool marquee on the current page only.
          const state = useEditor.getState();
          const activePage = state.pages.find(
            (candidate) => candidate.id === state.activePageId,
          );
          if (
            toolState().tool !== "select" ||
            !activePage ||
            activePage.locked ||
            activePage.hidden
          ) {
            if (!e.shiftKey) state.select(null);
            return;
          }
          page = activePage;
          activate = "onmove";
        }
        if (!page || page.locked || page.hidden) {
          if (!e.shiftKey) useEditor.getState().select(null);
          return;
        }
        startMarquee(e, page.id, activate);
      }}
      onContextMenu={(e) => {
        e.preventDefault(); // Only the canvas replaces the browser context menu.
        e.stopPropagation();
        const hit = workspaceHit(e.clientX, e.clientY);
        if (hit) {
          useEditor.getState().setActivePage(hit.page.id);
          const activeState = useEditor.getState();
          if (
            activeState.activePageId === hit.page.id &&
            !activeState.selectedIds.includes(hit.el.id)
          )
            activeState.select(hit.el.id);
        }
        useEditor.getState().openContextMenu({
          x: e.clientX,
          y: e.clientY,
          targetId: hit?.el.id ?? null,
          source: "canvas",
        });
      }}
      onDragOver={(e) => {
        const isFile = e.dataTransfer.types.includes("Files");
        const isLibrary = e.dataTransfer.types.includes(LIBRARY_DND_MIME);
        const isGraphic = e.dataTransfer.types.includes(GRAPHIC_HEADING_MIME);
        if ((!onDropImage || !isFile) && !isLibrary && !isGraphic) return;
        // An `.nsq` project is opened by the editor-wide intake (NsqIntake),
        // which shows its own drop overlay — not the canvas hint.
        if (isFile && !isLibrary && !isGraphic && likelyNsqDrag(e.dataTransfer))
          return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        /*
         * Images are placed as elements; every other supported file is a
         * DOCUMENT drop that goes through the one importer. The hint says
         * which promise the drop keeps.
         */
        const items = Array.from(e.dataTransfer.items || []).filter(
          (item) => item.kind === "file",
        );
        const imagesOnly =
          items.length > 0 && items.every((item) => item.type.startsWith("image/"));
        setDropping(
          isLibrary || isGraphic ? "library" : imagesOnly ? "file" : "document",
        );
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
            if (store.insertGraphicHeadingAt)
              store.insertGraphicHeadingAt(graphicId as any, {
                x: at.x,
                y: at.y,
              });
          }
          return;
        }
        const payload = parseLibraryDrop(
          e.dataTransfer.getData(LIBRARY_DND_MIME),
        );
        if (payload) {
          e.preventDefault();
          const at = dropPoint(e);
          if (!at) return;
          useEditor.getState().insertLibraryElements(payload, at, at.pageId);
          return;
        }
        if (!onDropImage) return;
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files)[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          /*
           * A design document dropped on the canvas opens exactly like one
           * chosen from «استيراد ملف» — the same canonical importer, the same
           * editable NASAQ document (import/open.ts).
           */
          if (importableByName(file.name)) {
            void openDesignFile(file);
            return;
          }
          toast.error("نوع الملف غير مدعوم.");
          return;
        }
        const at = dropPoint(e);
        if (at) setActivePage(at.pageId);
        if (at) onDropImage(file, at);
      }}
    >
      {dropping && (
        <div className="canvas-drop-hint pointer-events-none absolute top-3 left-1/2 z-[var(--z-canvas-overlay)] -translate-x-1/2 w-max rounded-full border border-line bg-surface px-4 py-1.5 text-[11px] font-extrabold text-brand shadow-sm">
          {dropping === "library"
            ? "أفلت العنصر ليُضاف في هذا الموضع"
            : dropping === "document"
              ? "أفلت الملف ليُفتح كمستند نَسَق قابل للتحرير"
              : "أفلت الصورة لإضافتها إلى الصفحة"}
        </div>
      )}
      <div
        className="workspace-scroll-surface mx-auto flex w-max min-w-full min-h-full items-center justify-center"
        dir="ltr"
        style={{
          padding:
            "max(48px, var(--canvas-pan-y, 100vh)) max(48px, var(--canvas-pan-x, 100vw))",
        }}
      >
        <div
          className="artboard-grid"
          dir="rtl"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, Math.min(visible.length, artboardGridCols))}, max-content)`,
            gap: `max(32px, ${ARTBOARD_GUTTER_MM * zoom}mm)`,
            alignItems: "start",
            justifyContent: "center",
          }}
        >
          {visible.map((page) => (
            /*
             * One memoised artboard per page. `ArtboardPage` owns its own mount
             * decision, so in preview-all the pages outside the viewport are not
             * in the React tree at all — see the comment on the component for
             * why that, and not "render everything and hide it", is what keeps a
             * 30-page document responsive.
             */
            <ArtboardPage
              key={page.id}
              page={page}
              pageNo={pages.findIndex((p) => p.id === page.id) + 1}
              pageCount={pages.length}
              isActive={page.id === activePageId}
              isRenaming={renamingPageId === page.id}
              zoom={zoom}
              root={stageEl}
              selectedSet={page.id === activePageId ? selectedSet : EMPTY_SELECTION}
              selectedId={page.id === activePageId ? selectedId : null}
              editingId={page.id === activePageId ? editingId : null}
              enteredGroupId={page.id === activePageId ? enteredGroupId : null}
              showGrid={showGrid}
              showOutsidePage={showOutsidePage}
              printGuides={printGuides}
              toolOwnsCanvas={toolOwnsCanvas}
              onElementGesture={onElementGesture}
              onEnterGroup={enterGroup}
              onMarquee={startMarquee}
              onRegisterRef={registerPageRef}
              onFit={fitTextBox}
              onEditRequest={requestEdit}
              onActivate={activatePage}
              onStartRename={setRenamingPageId}
              onRename={renamePage}
            />
          ))}
        </div>
      </div>
      {primarySelection &&
        editingId !== primarySelection.id &&
        bubbleEnabled &&
        !exportOpen &&
        !pageManagerOpen &&
        !contextMenu &&
        !layerPicker && (
          <SelectionTools
            key={`${activePageId}:${primarySelection.id}`}
            el={primarySelection}
            pageId={activePageId}
          />
        )}

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

      <ExportCaptureLayer />
    </div>
  );
}

/**
 * Mount margin for artboard virtualisation: a page starts rendering this far
 * before it enters the viewport and is dropped this far after it leaves, which
 * is what makes fast scrolling / cmd-scroll zooming feel like the page was
 * always there instead of flashing empty artboards.
 */
const ARTBOARD_MOUNT_MARGIN = "900px 700px";

/*
 * WHY VIRTUALISE THE ARTBOARDS
 *
 * `previewAll` (View → «معاينة كل الصفحات») used to mount every page of the
 * document at once. A 30-page report then means 30 artboards × their full
 * element trees — every text run, table cell, chart SVG and embedded image —
 * live in the DOM simultaneously, and because the stage re-renders on any
 * document or selection change, React reconciled all of them on every commit.
 * That is the wall the editor hits on long documents (and the reason an iPad
 * Pro, with its much slower single-threaded paint, felt worst): the cost is not
 * in one page, it is in thirty.
 *
 * The fix is not to hide offscreen pages with CSS — a hidden subtree still
 * mounts, still measures, still reconciles. It is to keep them out of the tree
 * entirely, and to give each page its OWN component so React can skip the ones
 * whose data has not changed:
 *
 *   • `ArtboardPage` is memoised on its page object. The store updates
 *     immutably, so editing page 4 leaves pages 1–3 and 5–30 with an identical
 *     `page` reference and React skips them without rendering a single node.
 *   • An IntersectionObserver against the stage decides whether the page's
 *     contents are mounted at all. The outer cell keeps its exact size either
 *     way, so the artboard grid geometry, scrollbars and scroll position never
 *     move — the placeholder is indistinguishable from the real thing until you
 *     scroll to it.
 *   • The ACTIVE page is always mounted (`isActive`/`isRenaming` force it), so
 *     selection, editing, guides and hit-testing behave exactly as before
 *     however far you scroll.
 *
 * Unmounting a page is safe because nothing outside the viewport can be
 * interacted with: the gesture layer resolves the page and element from the
 * live store at pointer time, and `ExportCaptureLayer` renders all pages itself
 * for export/thumbnails, so virtualisation never affects output.
 */
const ArtboardPage = memo(function ArtboardPage({
  page,
  pageNo,
  pageCount,
  isActive,
  isRenaming,
  zoom,
  root,
  selectedSet,
  selectedId,
  editingId,
  enteredGroupId,
  showGrid,
  showOutsidePage,
  printGuides,
  toolOwnsCanvas,
  onElementGesture,
  onEnterGroup,
  onMarquee,
  onRegisterRef,
  onFit,
  onEditRequest,
  onActivate,
  onStartRename,
  onRename,
}: {
  page: Page;
  pageNo: number;
  pageCount: number;
  isActive: boolean;
  isRenaming: boolean;
  zoom: number;
  root: HTMLElement | null;
  selectedSet: Set<string>;
  selectedId: string | null;
  editingId: string | null;
  enteredGroupId: string | null;
  showGrid: boolean;
  /**
   * Workspace preference «إظهار العناصر خارج الصفحة»: when false the artboard
   * clips its own overflow. Paint only — the page keeps every element.
   */
  showOutsidePage: boolean;
  printGuides: PrintGuideSettings | undefined;
  /** A drawing/region tool owns the canvas: the artwork is a surface, not a target. */
  toolOwnsCanvas: boolean;
  onElementGesture: ElementGestureHandler;
  onEnterGroup: (id: string) => void;
  onMarquee: (e: React.PointerEvent, pageId: string) => void;
  onRegisterRef: (pageId: string, node: HTMLDivElement | null) => void;
  onFit: (id: string) => void;
  onEditRequest: (pageId: string, elId: string) => void;
  onActivate: (pageId: string) => void;
  onStartRename: (pageId: string | null) => void;
  onRename: (pageId: string, name: string) => void;
}) {
  const size = pageSize(page);
  const cellRef = useRef<HTMLDivElement>(null);
  const renameTimer = useRef<number | undefined>(undefined);
  // The active page is pinned so its selection frames, guides and editing
  // surface exist no matter where the viewport is.
  const pinned = isActive || isRenaming;
  const [mounted, setMounted] = useState(pinned);

  useEffect(() => {
    if (pinned) {
      setMounted(true);
      return;
    }
    const node = cellRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // No observer (very old browser, or SSR): mount unconditionally rather
      // than showing a document that never renders.
      setMounted(true);
      return;
    }
    /*
     * Wait for the real scroll root.
     *
     * Children's effects run before the parent's, so on the very first commit
     * `root` is still null. Observing against the viewport then would answer
     * for content the stage CLIPS — briefly mounting pages that are scrolled
     * out of the stage but inside the window, which is precisely the cost this
     * exists to avoid. One frame later the parent publishes the stage element
     * and this effect re-runs with the correct root.
     */
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setMounted(entry.isIntersecting);
      },
      { root, rootMargin: ARTBOARD_MOUNT_MARGIN },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [pinned, root]);

  const isLocked = Boolean(page.locked);
  const isHidden = Boolean(page.hidden);

  const header = (
    /* The name is UI, never a document element or a transform child. */
    <div
      className="artboard-header"
      dir="rtl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {isRenaming ? (
        <input
          autoFocus
          aria-label="اسم لوحة الرسم"
          defaultValue={page.name}
          className="artboard-title-input"
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value) onRename(page.id, value);
            onStartRename(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") onStartRename(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="artboard-name"
          aria-pressed={isActive && selectedSet.size === 0}
          title={page.name + " — نقرة للإعدادات، نقرتان لإعادة التسمية"}
          onClick={() => {
            onActivate(page.id);
            window.clearTimeout(renameTimer.current);
            renameTimer.current = window.setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("nasaq:open-page-settings", { detail: page.id }),
              );
            }, 220);
          }}
          onDoubleClick={() => {
            window.clearTimeout(renameTimer.current);
            onStartRename(page.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "F2") {
              e.preventDefault();
              onStartRename(page.id);
            }
          }}
        >
          {page.name}
        </button>
      )}
    </div>
  );

  if (!mounted) {
    return (
      <div
        ref={cellRef}
        className={`artboard-cell relative shrink-0 ${isActive ? "is-active" : ""}`}
        dir="ltr"
        style={{
          width: `${size.w * zoom}mm`,
          height: `calc(${size.h * zoom}mm + 22px)`,
        }}
      >
        {header}
      </div>
    );
  }

  /**
   * While a drawing tool owns the canvas the artwork is a SURFACE, not a
   * target: no hover outlines, no element drag, no double-click editing. The
   * capture-phase router claims the gesture anyway; this makes the promise
   * visible and removes a whole class of "the tool did nothing because the
   * element under it swallowed the press" bugs.
   */
  const live = !isLocked && !isHidden && !toolOwnsCanvas;
  const entered = enteredGroupId
    ? findElement(page.elements, enteredGroupId)?.el || null
    : null;
  const enteredKids = entered?.children ?? [];
  const selectionFrames: SelectionBox[] = [];
  if (isActive && !isLocked && !isHidden) {
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
        if (selectedSet.has(el.id) && !el.hidden && el.id !== entered?.id) {
          selectionFrames.push({ el, parent: undefined });
        }
      }
    }
  }

  return (
    <div
      ref={cellRef}
      className={`artboard-cell relative shrink-0 ${isActive ? "is-active" : ""}`}
      dir="ltr"
      style={{
        width: `${size.w * zoom}mm`,
        height: `calc(${size.h * zoom}mm + 22px)`,
      }}
    >
      {header}

      {/* Scaled Page Container */}
      <div
        className="page-frame-content absolute"
        dir="ltr"
        style={{
          width: `${mmToPx(size.w)}px`,
          height: `${size.h}mm`,
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
          top: "22px",
          left: 0,
        }}
      >
        <div
          ref={(n) => onRegisterRef(page.id, n)}
          data-page-id={page.id}
          className={`report-page ${showGrid ? "show-grid" : ""} ${
            isActive ? "artboard-active-outline" : ""
          } ${isLocked ? "artboard-locked" : ""} ${isHidden ? "artboard-hidden-content" : ""} ${
            pageClipClass(page, showOutsidePage)
          }`}
          style={{
            width: `${mmToPx(size.w)}px`,
            height: `${mmToPx(size.h)}px`,
            background: pageBackgroundCss(page),
            opacity: isHidden ? 0.35 : 1,
            pointerEvents: isLocked ? "none" : undefined,
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
            useEditor.getState().setActivePage(page.id);
            if (e.button !== 0 || isLocked) return;
            onMarquee(e, page.id);
          }}
        >
          <PageSurface page={page} active={isActive} />
          {page.elements
            .slice()
            .sort((a, b) => a.z - b.z)
            .map((el) => {
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
                      .map((child) => (
                        <EnteredChildNode
                          key={child.id}
                          child={child}
                          pageNo={pageNo}
                          pageCount={pageCount}
                          siblings={enteredKids}
                          interactive={live}
                          onGesture={onElementGesture}
                          pageId={page.id}
                          offX={entered.x}
                          offY={entered.y}
                        />
                      ))}
                  </div>
                );
              }
              if (entered && el.id === entered.id) return null;
              return (
                <ElementNode
                  key={el.id}
                  el={el}
                  pageNo={pageNo}
                  pageCount={pageCount}
                  siblings={page.elements}
                  interactive={live}
                  onEnterGroup={el.type === "group" ? onEnterGroup : undefined}
                  pageId={page.id}
                  onGesture={onElementGesture}
                />
              );
            })}
          <PrintGuides
            page={page}
            settings={printGuides}
            zIndex={GUIDE_LAYER_Z}
          />
          <MarqueeLayer pageId={page.id} size={size} />
          {isActive && !isLocked && <SelectionRegionLayer pageId={page.id} />}
          {isActive && !isLocked && !isHidden && (
            <OverflowFlagLayer elements={page.elements} onFit={onFit} />
          )}
          {isActive && !isLocked && <GuideLines size={size} />}
          {isActive && !isLocked && <CropLayer pageId={page.id} />}
          {isActive && <RotationHintLayer />}
          {isActive && !isLocked && !isHidden && selectionFrames.length > 0 && (
            <div
              className="selection-layer"
              style={{ zIndex: SELECTION_LAYER_Z }}
            >
              {selectionFrames.map((frame) => (
                <SelectionFrame
                  key={frame.el.id}
                  frame={frame}
                  primary={frame.el.id === selectedId}
                  editing={editingId === frame.el.id}
                  onGesture={(ev, kind, handle) =>
                    onElementGesture(ev, frame.el, kind, handle, {
                      pageId: page.id,
                      parent: frame.parent,
                    })
                  }
                  onEditRequest={() => onEditRequest(page.id, frame.el.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const OverflowFlag = memo(function OverflowFlag({
  el,
  onFit,
}: {
  el: CanvasEl;
  onFit: (id: string) => void;
}) {
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
        onFit(el.id);
      }}
      title="النص أطول من الصندوق — اضغط لملاءمة الصندوق مع النص"
    >
      النص أطول من الصندوق
    </button>
  );
});

/**
 * The clipped-text badges for the active page. `prepareText` runs per element;
 * rendering them through a memoized child means an edit to ONE element
 * re-measures ONE badge, not the whole page's.
 */
const OverflowFlagLayer = memo(function OverflowFlagLayer({
  elements,
  onFit,
}: {
  elements: CanvasEl[];
  onFit: (id: string) => void;
}) {
  return (
    <>
      {elements.map((el) => (
        <OverflowFlag key={el.id} el={el} onFit={onFit} />
      ))}
    </>
  );
});

/**
 * Absolute-space node for an element of an ENTERED group (double-clicked
 * into). Exists so the per-child `{...child, x: offX + child.x}` spread is
 * computed inside a component memoized on the CHILD's identity — the spread
 * object stays referentially stable across stage re-renders, which is what
 * keeps the memoized ElementNode beneath it from re-rendering.
 */
const EnteredChildNode = memo(function EnteredChildNode({
  child,
  pageNo,
  pageCount,
  siblings,
  interactive,
  onGesture,
  pageId,
  offX,
  offY,
}: {
  child: CanvasEl;
  pageNo: number;
  pageCount: number;
  siblings: CanvasEl[];
  interactive: boolean;
  onGesture: ElementGestureHandler;
  pageId: string;
  offX: number;
  offY: number;
}) {
  const abs = { ...child, x: child.x + offX, y: child.y + offY };
  return (
    <ElementNode
      el={abs}
      pageNo={pageNo}
      pageCount={pageCount}
      siblings={siblings}
      interactive={interactive}
      pageId={pageId}
      parent={{ x: offX, y: offY }}
      onGesture={onGesture}
    />
  );
});

/** Page-scoped marquee from the transient interaction store: rect, ellipse or lasso. */
function MarqueeLayer({
  pageId,
  size,
}: {
  pageId: string;
  size: { w: number; h: number };
}) {
  const marquee = useInteraction((s) => marqueeForPage(s.marquee, pageId));
  if (!marquee) return null;
  if (marquee.shape === "lasso" && marquee.points?.length) {
    /*
     * The path is authored in page millimetres, so the viewBox is the page in
     * millimetres too: one SVG user unit is one millimetre, and the lasso lands
     * exactly under the pointer at every zoom instead of at an arbitrary px
     * scale.
     */
    return (
      <svg
        className="marquee-lasso"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <path d={lassoPath(marquee.points)} />
      </svg>
    );
  }
  return (
    <div
      className={cn("marquee", marquee.shape === "ellipse" && "marquee-ellipse")}
      style={{
        left: `${marquee.x0}mm`,
        top: `${marquee.y0}mm`,
        width: `${Math.abs(marquee.x1 - marquee.x0)}mm`,
        height: `${Math.abs(marquee.y1 - marquee.y0)}mm`,
      }}
    />
  );
}

/**
 * The finished region, with handles.
 *
 * A selection the author cannot adjust is a one-shot gesture; this overlay
 * keeps the region alive so it can be nudged, reshaped, cropped or extracted.
 * Handles are real buttons (so the canvas gesture router leaves them alone) and
 * dragging one writes only to the tool store — the document is never touched.
 */
function SelectionRegionLayer({ pageId }: { pageId: string }) {
  const region = useTools((s) => s.region);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  // A fresh object per render would re-render forever under `Object.is`.
  const size = useMemo(() => {
    const page = pages.find((p) => p.id === activePageId);
    return page ? pageSize(page) : { w: 210, h: 297 };
  }, [pages, activePageId]);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  if (!region || region.pageId !== pageId) return null;
  const { box } = region;

  const start = (event: React.PointerEvent, handle: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { ...useTools.getState().region!.box };
    const node = event.currentTarget as HTMLElement;
    const pageNode = node.closest<HTMLElement>("[data-page-id]");
    if (!pageNode) return;
    const rect = pageNode.getBoundingClientRect();
    node.setPointerCapture(event.pointerId);
    const pointerId = event.pointerId;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const liveRect = pageNode.getBoundingClientRect();
      const baseRect = liveRect.width > 0 ? liveRect : rect;
      const dx =
        baseRect.width > 0
          ? ((ev.clientX - event.clientX) * size.w) / baseRect.width
          : 0;
      const dy =
        baseRect.height > 0
          ? ((ev.clientY - event.clientY) * size.h) / baseRect.height
          : 0;
      if (!moved && Math.hypot(dx, dy) < 0.2) return;
      moved = true;
      const next = { ...origin };
      if (handle === "move") {
        next.x = origin.x + dx;
        next.y = origin.y + dy;
      } else {
        if (handle.includes("w")) {
          next.x = origin.x + dx;
          next.w = origin.w - dx;
        }
        if (handle.includes("e")) next.w = origin.w + dx;
        if (handle.includes("n")) {
          next.y = origin.y + dy;
          next.h = origin.h - dy;
        }
        if (handle.includes("s")) next.h = origin.h + dy;
      }
      if (next.w < 0) {
        next.x += next.w;
        next.w = Math.abs(next.w);
      }
      if (next.h < 0) {
        next.y += next.h;
        next.h = Math.abs(next.h);
      }
      const clamped = clampRegionBox(next, size);
      if (clamped) useTools.getState().setRegion({ ...region, box: clamped });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup.current?.();
    };
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div
      className="selection-region"
      style={{
        left: `${box.x}mm`,
        top: `${box.y}mm`,
        width: `${box.w}mm`,
        height: `${box.h}mm`,
      }}
      data-region-shape={region.shape}
    >
      <button
        type="button"
        className="selection-region-move"
        aria-label="تحريك منطقة التحديد"
        onPointerDown={(e) => start(e, "move")}
      />
      {["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((handle) => (
        <button
          key={handle}
          type="button"
          aria-label={`تعديل منطقة التحديد ${handle}`}
          className={`selection-region-handle is-${handle}`}
          onPointerDown={(e) => start(e, handle)}
        />
      ))}
      <span className="selection-region-size" dir="ltr">
        {round(box.w)} × {round(box.h)} مم
      </span>
    </div>
  );
}

function PageSurface({ page, active }: { page: Page; active: boolean }) {
  const size = pageSize(page);
  const overrides = useInteraction((s) => (active ? s.overrides : EMPTY_OVERRIDES));
  const gesturing = useInteraction((s) => active && s.active);
  let nearEdge = false;
  if (gesturing) {
    for (const geom of Object.values(overrides)) {
      const x = geom.x;
      const y = geom.y;
      const w = geom.w;
      const h = geom.h;
      if (x == null || y == null || w == null || h == null) continue;
      if (x <= 2.5 || y <= 2.5 || x + w >= size.w - 2.5 || y + h >= size.h - 2.5) {
        nearEdge = true;
        break;
      }
    }
  }
  return (
    <>
      {page.bgImage ? (
        <div
          className="page-bg-image"
          aria-hidden
          style={{
            backgroundImage: `url("${page.bgImage.replace(/"/g, "%22")}")`,
            backgroundSize: page.bgImageFit === "contain" ? "contain" : "cover",
            backgroundPosition: `${page.bgImageX ?? 50}% ${page.bgImageY ?? 50}%`,
          }}
        />
      ) : null}
      <div className={nearEdge ? "page-trim is-hot" : "page-trim"} aria-hidden />
    </>
  );
}

const EMPTY_OVERRIDES: Record<string, { x?: number; y?: number; w?: number; h?: number }> = {};

/** Alignment guides, driven by the transient interaction store. */
const GuideLines = memo(function GuideLines({
  size,
}: {
  size: { w: number; h: number };
}) {
  const guides = useInteraction((s) => s.guides);
  if (!guides.v.length && !guides.h.length) return null;
  return (
    <>
      {guides.v.map((x) => (
        <div
          key={`v${x}`}
          className={cn(
            "guide-v",
            (x === 0 || x === size.w) && "is-page-edge",
            x === size.w / 2 && "is-page-center",
          )}
          data-snap-target={
            x === 0 || x === size.w
              ? "edge"
              : x === size.w / 2
                ? "center"
                : "alignment"
          }
          style={{ left: `${x}mm` }}
        />
      ))}
      {guides.h.map((y) => (
        <div
          key={`h${y}`}
          className={cn(
            "guide-h",
            (y === 0 || y === size.h) && "is-page-edge",
            y === size.h / 2 && "is-page-center",
          )}
          data-snap-target={
            y === 0 || y === size.h
              ? "edge"
              : y === size.h / 2
                ? "center"
                : "alignment"
          }
          style={{ top: `${y}mm` }}
        />
      ))}
      <span className="snap-feedback" aria-live="polite">
        {guides.v.some((x) => x === 0 || x === size.w) ||
        guides.h.some((y) => y === 0 || y === size.h)
          ? "ملاصق لحافة الصفحة"
          : guides.v.includes(size.w / 2) || guides.h.includes(size.h / 2)
            ? "توسيط الصفحة"
            : "محاذاة"}
      </span>
    </>
  );
});

/** Rotation readout, driven by the transient interaction store. */
function RotationHintLayer() {
  const rotationHint = useInteraction((s) => s.rotationHint);
  if (!rotationHint) return null;
  return (
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
          : rotationHint.touch
            ? "إصبع ثانٍ للالتقاط"
            : "Shift للالتقاط"}
      </span>
    </div>
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
  const updateElement = useEditor((s) => s.updateElement);
  const commit = useEditor((s) => s.commit);
  const zoom = useEditor((s) => s.zoom);
  /*
   * Live drag geometry for THIS element: the frame follows the pointer at
   * display rate without the document (or the stage) re-rendering.
   */
  const cropping = useInteraction((s) => s.crop?.original.id === frame.el.id);
  const transient = useInteraction((s) => s.overrides[frame.el.id]);
  const el = transient ? { ...frame.el, ...transient } : frame.el;
  const frameRef = useRef<HTMLDivElement>(null);
  /**
   * The measured artwork box (page mm) — see `measuredSelectionBox`.
   *
   * A DOM node's `getBoundingClientRect` reports what is actually painted:
   * padding, border, a shadowed/oversized SVG viewport. Painting the frame at
   * that box is what makes the selection hug the artwork at every zoom, and
   * because all edit mathematics run on `el.x/el.w` (never on handle
   * positions), a measured frame is purely presentational — resizing, rotating
   * and snapping behave exactly as before.
   */
  const [measured, setMeasured] = useState<PageBoxMm | null>(null);

  useEffect(() => {
    if (!primary || editing) {
      setMeasured(null);
      return;
    }
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      const node = frameRef.current?.closest<HTMLElement>("[data-page-id]");
      const artwork = node?.querySelector<HTMLElement>(
        `.canvas-el[data-el-id="${CSS.escape(el.id)}"]`,
      );
      const page = node?.querySelector<HTMLElement>(".report-page") || node;
      if (!artwork || !page) {
        setMeasured(null);
        return;
      }
      const artworkRect = artwork.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      // The page element is authored in CSS pixels for its millimetre size and
      // then scaled by the zoom, so its layout width is the millimetre truth.
      const modelPage = useEditor
        .getState()
        .pages.find((p) => p.id === node?.dataset.pageId);
      const pageWidthMm = modelPage
        ? pageSize(modelPage).w
        : page.clientWidth / mmToPx(1);
      setMeasured(
        measuredSelectionBox({
          node: artworkRect,
          page: pageRect,
          pageWidthMm,
          model: { x: el.x, y: el.y, w: el.w, h: el.h },
          rotation: el.rotation || 0,
        }),
      );
    };
    const id = requestAnimationFrame(read);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [primary, editing, zoom, el.id, el.x, el.y, el.w, el.h, el.rotation]);

  const box =
    el.type === "line"
      ? el.h > el.w
        ? {
            x: el.x + (el.w - (el.style.stroke ?? 0.8)) / 2,
            y: el.y,
            w: el.style.stroke ?? 0.8,
            h: el.h,
          }
        : {
            x: el.x,
            y: el.y + (el.h - (el.style.stroke ?? 0.8)) / 2,
            w: el.w,
            h: el.style.stroke ?? 0.8,
          }
      : (measured ?? { x: el.x, y: el.y, w: el.w, h: el.h });
  const angle =
    (((Math.round((el.rotation || 0) * 10) / 10) % 360) + 360) % 360;

  /** One keyboard rotation step: 1°, or 15° with Shift (the pointer ladder). */
  const rotateBy = (delta: number) => {
    const next = (((angle + delta) % 360) + 360) % 360;
    updateElement(el.id, { rotation: Number(next.toFixed(1)) });
    commit();
  };

  if (cropping) return null;
  // Paint the exact geometry; only handle hit targets have a screen-space minimum.
  // Inflating small frames made separate objects appear attached at low zoom.

  return (
    <div
      ref={frameRef}
      className={cn(
        "selection-frame",
        !primary && "is-secondary",
        el.locked && "is-locked",
        el.resizeLocked && "is-resize-locked",
        (el.widthLocked || el.heightLocked) && "is-dimension-locked",
        editing && "is-editing",
      )}
      data-el-id={el.id}
      style={
        {
          left: `${box.x}mm`,
          top: `${box.y}mm`,
          width: `${box.w}mm`,
          height: `${box.h}mm`,
          transform: `rotate(${el.rotation || 0}deg)${el.style?.flipX ? " scaleX(-1)" : ""}${el.style?.flipY ? " scaleY(-1)" : ""}`,
        } as React.CSSProperties
      }
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
              if (isLockedAxis && el.widthLocked && el.heightLocked)
                return null;
              return (
                <div
                  key={h}
                  className={cn("handle", h, isLockedAxis && "is-axis-locked")}
                  data-handle={h}
                  onPointerDown={(e) => {
                    if (isLockedAxis) {
                      // إذا كان المحور مقفلاً، لا نسمح بالتحجيم في هذا الاتجاه
                      if (
                        ((h === "e" || h === "w") && el.widthLocked) ||
                        ((h === "n" || h === "s") && el.heightLocked)
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
          {/*
           * Rotation grip: one distinct control, not a recoloured resize dot.
           *
           * The 44px hit area keeps it reachable with a finger or a Pencil
           * while the visible grip stays small; the glyph marks it as
           * "rotate" at a glance, the hairline ties it to the frame, the ready
           * angle readout appears while dragging, and the whole control is a
           * keyboard slider (←/→ = 1°, Shift = 15°) so rotation is not a
           * pointer-only gesture.
           */}
          {ROTATE_HANDLES.map((corner) => (
            <div
              key={`rot-${corner}`}
              className={cn("rotate-handle", corner)}
              role="slider"
              tabIndex={0}
              aria-label={`تدوير العنصر — الزاوية الحالية ${Math.round(angle)} درجة`}
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={Math.round(angle)}
              title="اسحب للتدوير — ← / → للتغيير الدقيق، مع Shift خطوات 15°، وShift أثناء السحب للالتقاط"
              onKeyDown={(event) => {
                const step = event.shiftKey ? 15 : 1;
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  event.stopPropagation();
                  rotateBy(-step);
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                  rotateBy(step);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  event.stopPropagation();
                  updateElement(el.id, { rotation: 0 });
                  commit();
                }
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onGesture(e, "rotate");
              }}
            >
              <span className="rotate-handle-grip" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M20 12a8 8 0 1 1-2.4-5.7"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M20 4.5V9h-4.5"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
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
              <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-navy/10 text-[10px] font-extrabold text-brand dark:bg-white/10 dark:text-gold-2">
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
    `[data-page-id="${CSS.escape(pageId)}"]`,
  );
  const node = host?.querySelector<HTMLElement>(
    `[data-el-id="${CSS.escape(elId)}"]`,
  );
  node?.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
}

/**
 * The offscreen capture DOM. It paints the ENTIRE document a second time, so
 * it is mounted only while something actually reads it: an open export
 * dialog, or an armed thumbnail capture during a save. The old always-on
 * mount doubled the render cost of every document edit for nothing.
 */
function ExportCaptureLayer() {
  const pages = useEditor((s) => s.pages);
  const exportOpen = useEditor((s) => s.exportOpen);
  const captureArmed = useEditor((s) => s.captureArmed);
  const clipExport = useEditor((s) => s.clipExport);
  if (!exportOpen && !captureArmed) return null;
  return (
    <div
      id="export-root"
      className="pointer-events-none fixed top-0 left-[-2400px] z-[-1]"
      aria-hidden
    >
      {pages.map((page, pageIndex) => {
        const size = pageSize(page);
        return (
          <div
            key={page.id}
            data-export-page={page.id}
            className={`report-page${clipExport !== false ? " is-clip-export" : " is-export-visible"}`}
            style={{
              width: `${mmToPx(size.w)}px`,
              height: `${mmToPx(size.h)}px`,
              background: pageBackgroundCss(page),
            }}
          >
            {page.bgImage ? (
              <div
                className="page-bg-image"
                aria-hidden
                style={{
                  backgroundImage: `url("${page.bgImage.replace(/"/g, "%22")}")`,
                  backgroundSize: page.bgImageFit === "contain" ? "contain" : "cover",
                  backgroundPosition: `${page.bgImageX ?? 50}% ${page.bgImageY ?? 50}%`,
                }}
              />
            ) : null}
            {page.elements
              .slice()
              .sort((a, b) => a.z - b.z)
              .map((el) => (
                <ElementNode
                  key={el.id}
                  el={el}
                  interactive={false}
                  pageNo={pageIndex + 1}
                  pageCount={pages.length}
                  siblings={page.elements}
                  onGesture={() => {}}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** Contextual tools stay available when panels open; the placer routes around them. */
function SelectionTools({
  el,
  pageId,
}: {
  el: CanvasEl;
  pageId: string;
}) {
  const active = useInteraction((s) => s.active);
  const cropping = useInteraction((s) => s.crop !== null);
  if (active || cropping) return null;
  return <FloatingToolbar el={el} pageId={pageId} />;
}
function CropLayer({ pageId }: { pageId: string }) {
  const session = useInteraction((s) => s.crop);
  return session?.pageId === pageId ? <CropOverlay session={session} /> : null;
}
