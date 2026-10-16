/**
 * Vector node editor — anchor point and control handle manipulation for the
 * selected `svg` element's first path.
 *
 * Renders handles over the artwork the canvas already painted, and writes the
 * reshaped path back through the editor store, so a node edit participates in
 * undo/redo, save/reload and export like any other change.
 *
 * THE RENDER PURITY CONTRACT (the React #301 fix — do not regress it):
 * the drawn points are DERIVED from the element's own markup — `el.content` is
 * the single source of truth — and local state exists only while a pointer
 * drag is in flight. The previous implementation called `setPoints(...)`
 * during render whenever `el.content` was non-empty (`points.length === 0 ||
 * el.content` is true on every render for any real path), which re-rendered
 * forever and stopped the editor with «Too many re-renders» (React #301) the
 * moment an imported PSD vector shape was on an interactive page. Nothing here
 * may call a setter during render.
 *
 * THE GEOMETRY CONTRACT:
 * path data lives in the drawing's own coordinate system, which the browser
 * already maps into the element's box (viewBox, `transform`, rotation, zoom).
 * The overlay therefore MEASURES that mapping (`getScreenCTM`) instead of
 * re-deriving it, so handles sit exactly on the path at every zoom, and a
 * pointer move is converted back through the very same matrix. The committed
 * value rewrites only the `d` attribute inside the markup (see
 * `@/lib/editor/vector-node-edit`) — never the whole document, never a bare
 * path string.
 *
 * THE HIT-TESTING CONTRACT:
 * a path's extreme points sit exactly ON its bounding box, so half of every
 * edge handle falls outside the artwork box. An SVG viewport clips hit testing
 * to its own box (CSS `overflow: visible` only helps painting), which is how a
 * click meant for a corner handle used to land on the element and MOVE it
 * instead. The overlay therefore pads its box well past the artwork, and every
 * handle is drawn at a constant SCREEN size with an invisible, comfortably
 * larger grab area — the same convention `.handle` uses in `styles.css`.
 *
 * Mounting is the parent's decision: `ElementNode` renders this overlay only
 * for the PRIMARY-SELECTED, unlocked `svg` element, so a live page never shows
 * node handles on artwork nobody selected.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor } from "@/lib/editor/store";
import { type CanvasEl } from "@/lib/editor/model";
import {
  extractVectorTarget,
  movePoint,
  pointsToPathData,
  rewritePathData,
  type DragPart,
  type PathPoint,
  type VectorTarget,
} from "@/lib/editor/vector-node-edit";

/** Visual sizes, in SCREEN pixels — divided by the measured zoom at render. */
const POINT_RADIUS = 6.5;
const HANDLE_RADIUS = 4.5;
/** Invisible grab area around every handle (constant on screen, touch-friendly). */
const HIT_RADIUS = 12;
/** How far the overlay extends past the artwork box, in screen pixels. */
const EDGE_PAD = 160;
const HANDLE_COLOR = "#006c35";
const POINT_COLOR = "#00874a";
const HANDLE_LINE_COLOR = "#c9a86a";

interface VectorNodeEditorProps {
  el: CanvasEl;
  selected: boolean;
}

interface DragState {
  index: number;
  part: DragPart;
  /** Live preview of the dragged path (overlay + artwork read this). */
  points: PathPoint[];
  /** The markup as it should be saved right now (points already applied). */
  content: string;
  /** The `d` value currently inside `content` for this path. */
  liveD: string;
  /** True once a pointer move actually changed the geometry. */
  moved: boolean;
}

/** The rendered artwork path this editor is bound to, looked up live. */
function artworkPath(svg: SVGSVGElement | null): SVGGraphicsElement | null {
  /* The artwork div is the overlay's previous sibling; the overlay itself
     contains no <path>, so the first path in document order is the target. */
  return svg?.parentElement?.querySelector<SVGGraphicsElement>("path") ?? null;
}

export function VectorNodeEditor({ el, selected }: VectorNodeEditorProps) {
  const updateElement = useEditor((s) => s.updateElement);

  /* Derived — never synchronised with a setter during render. */
  const target = useMemo(
    () => extractVectorTarget(el.content || ""),
    [el.content],
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Path-local coordinates → overlay pixels, plus the overlay's own zoom. */
  const [measure, setMeasure] = useState<{
    rel: DOMMatrix;
    scale: number;
  } | null>(null);

  const dragging = drag !== null;
  const points = drag?.points ?? target?.points ?? null;
  /* Screen pixels → overlay user units (the stage scales the overlay). */
  const u = measure && measure.scale > 0 ? 1 / measure.scale : 1;
  const pad = Math.round(EDGE_PAD * u);

  /**
   * Measure how the artwork's path coordinates map into this overlay. Both
   * elements sit in the same box inside the same transformed stage, so the
   * relative matrix is stable through zoom, pan and page rotation — it only
   * changes with the element's own box, its path document, the overlay's own
   * padding, or selection.
   */
  useLayoutEffect(() => {
    setMeasure(null);
    if (!selected || !target) return;
    const svg = svgRef.current;
    const pathEl = artworkPath(svg);
    if (!svg || !pathEl) return;
    /* Refuse to draw handles over artwork we did not parse: if the rendered
       path is not the one this editor read, the overlay would lie. */
    const expected = dragRef.current?.liveD ?? target.d;
    if (pathEl.getAttribute("d") !== expected) return;
    const overlayCTM = svg.getScreenCTM();
    const pathCTM = pathEl.getScreenCTM();
    if (!overlayCTM || !pathCTM) return;
    const scale = Math.hypot(overlayCTM.a, overlayCTM.b);
    if (!Number.isFinite(scale) || scale <= 0.01) return;
    try {
      const rel = overlayCTM.inverse().multiply(pathCTM);
      if (![rel.a, rel.b, rel.c, rel.d, rel.e, rel.f].every(Number.isFinite))
        return;
      setMeasure({ rel, scale });
    } catch {
      /* A degenerate matrix (collapsed element) simply hides the handles. */
      setMeasure(null);
    }
  }, [selected, target, dragging, el.id, el.w, el.h, el.rotation, pad]);

  const toOverlay = useCallback(
    (p: { x: number; y: number } | undefined) => {
      if (!measure || !p) return null;
      const q = new DOMPoint(p.x, p.y).matrixTransform(measure.rel);
      return Number.isFinite(q.x) && Number.isFinite(q.y) ? q : null;
    },
    [measure],
  );

  const beginDrag = useCallback(
    (e: React.PointerEvent, index: number, part: DragPart) => {
      if (!target || el.locked) return;
      const pathEl = artworkPath(svgRef.current);
      /* Bound check: only drag the path the overlay actually describes. */
      if (!pathEl || pathEl.getAttribute("d") !== target.d) return;
      e.preventDefault();
      e.stopPropagation();
      const state: DragState = {
        index,
        part,
        points: target.points,
        content: el.content ?? "",
        liveD: target.d,
        moved: false,
      };
      dragRef.current = state;
      setDrag(state);
    },
    [target, el.content, el.locked],
  );

  /**
   * Global move/up listeners exist only for the duration of one drag. They run
   * outside React's render cycle for smooth dragging and are cleaned up when
   * the drag ends or the editor unmounts mid-drag.
   */
  useEffect(() => {
    if (!dragging) return;
    /** Client coordinates → the path's own coordinate system (where `d` lives). */
    const toPathSpace = (clientX: number, clientY: number) => {
      const m = artworkPath(svgRef.current)?.getScreenCTM();
      if (!m) return null;
      try {
        const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
        return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
      } catch {
        return null;
      }
    };
    const onMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current || e.buttons === 0) return;
      const local = toPathSpace(e.clientX, e.clientY);
      if (!local) return;
      const nextPoints = movePoint(
        current.points,
        current.index,
        current.part,
        local.x,
        local.y,
      );
      if (nextPoints === current.points) return;
      const nextD = pointsToPathData(nextPoints);
      const nextContent = rewritePathData(current.content, current.liveD, nextD);
      if (!nextContent) return;
      const updated: DragState = {
        ...current,
        points: nextPoints,
        content: nextContent,
        liveD: nextD,
        moved: true,
      };
      dragRef.current = updated;
      setDrag(updated);
      /*
       * One store write per frame keeps the artwork following the handle
       * without a history entry per pixel: `live` writes only schedule a save.
       * The pointer-up commit below is the one undoable edit.
       */
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const latest = dragRef.current;
          if (latest) updateElement(el.id, { content: latest.content }, true);
        });
      }
    };
    const onEnd = () => {
      const latest = dragRef.current;
      dragRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (latest?.moved) updateElement(el.id, { content: latest.content });
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [dragging, el.id, updateElement]);

  if (!selected || !target || !points || el.locked) return null;

  const pointRadius = POINT_RADIUS * u;
  const handleRadius = HANDLE_RADIUS * u;
  const hitRadius = HIT_RADIUS * u;
  const lineWidth = u;

  /*
   * Two passes on purpose: every control handle first, every anchor last. An
   * imported straight segment puts its control points exactly ON its anchors,
   * so within one node the anchor is already on top — but the NEXT node's
   * control circles would otherwise cover the previous anchor. Anchors win
   * every tie, which is the corner the author sees and means to grab.
   */
  const controlNodes: React.ReactNode[] = [];
  const anchorNodes: React.ReactNode[] = [];
  points.forEach((p, index) => {
    if (p.type === "Z") return;
    const anchor = toOverlay(p);
    if (!anchor) return;
    const pushHandle = (
      key: string,
      part: DragPart,
      at: { x: number; y: number } | undefined,
    ) => {
      const q = toOverlay(at);
      if (!q) return;
      controlNodes.push(
        <line
          key={`${key}-line`}
          x1={anchor.x}
          y1={anchor.y}
          x2={q.x}
          y2={q.y}
          stroke={HANDLE_LINE_COLOR}
          strokeWidth={lineWidth}
          strokeDasharray={`${u * 4},${u * 4}`}
        />,
        <g key={key}>
          <circle
            cx={q.x}
            cy={q.y}
            r={hitRadius}
            fill="transparent"
            data-node-index={index}
            data-node-part={part}
            style={{ pointerEvents: "auto" }}
            onPointerDown={(e) => beginDrag(e, index, part)}
          />
          <circle
            cx={q.x}
            cy={q.y}
            r={handleRadius}
            fill={HANDLE_COLOR}
            stroke="#ffffff"
            strokeWidth={lineWidth}
            cursor="crosshair"
            style={{ pointerEvents: "none" }}
          />
        </g>,
      );
    };
    if (p.type === "C") {
      pushHandle(`cp1-${index}`, "cp1", p.cp1);
      pushHandle(`cp2-${index}`, "cp2", p.cp2);
    } else if (p.type === "Q") {
      pushHandle(`cp-${index}`, "cp", p.cp);
    }
    anchorNodes.push(
      <g key={`point-${index}`}>
        <circle
          cx={anchor.x}
          cy={anchor.y}
          r={hitRadius}
          fill="transparent"
          data-node-index={index}
          data-node-part="point"
          style={{ pointerEvents: "auto" }}
          onPointerDown={(e) => beginDrag(e, index, "point")}
        />
        <circle
          cx={anchor.x}
          cy={anchor.y}
          r={pointRadius}
          fill={POINT_COLOR}
          stroke="#ffffff"
          strokeWidth={lineWidth * 1.5}
          cursor="move"
          style={{ pointerEvents: "none" }}
        />
      </g>,
    );
  });

  return (
    <svg
      ref={svgRef}
      className="absolute pointer-events-none"
      style={{
        top: -pad,
        left: -pad,
        width: `calc(100% + ${pad * 2}px)`,
        height: `calc(100% + ${pad * 2}px)`,
        /* Dynamically sized: only its own content concerns a repaint. */
        contain: "layout style",
      }}
      data-vector-node-editor
    >
      {controlNodes}
      {anchorNodes}
    </svg>
  );
}
