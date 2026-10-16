/**
 * Vector node editor — Bézier path point and handle manipulation.
 *
 * Renders anchor points and control handles for a selected `svg` element,
 * allowing the author to drag points and handles to reshape the path.
 * Changes are persisted through the editor store's `updateElement`, so they
 * participate in undo/redo, save/reload, and export like any other edit.
 *
 * THE RENDER PURITY CONTRACT (the React #301 fix):
 * the points drawn here are DERIVED from the element's own path data —
 * `el.content` is the single source of truth — and local state exists only
 * while a pointer drag is in flight. The previous implementation called
 * `setPoints(...)` during render whenever `el.content` was non-empty
 * (`points.length === 0 || el.content` is true on every render for any real
 * path), which re-rendered forever and stopped the editor with «Too many
 * re-renders» (React #301) the moment an imported PSD vector shape — every
 * Photoshop vector layer lands as an `svg` element with path data — was on an
 * interactive page. Nothing here may call a state setter outside an event
 * handler or an effect.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { type CanvasEl } from "@/lib/editor/model";

interface PathPoint {
  x: number;
  y: number;
  type: "M" | "L" | "C" | "Q";
  cp1?: { x: number; y: number };
  cp2?: { x: number; y: number };
  cp?: { x: number; y: number };
}

interface VectorNodeEditorProps {
  el: CanvasEl;
  selected: boolean;
}

type DragPart = "point" | "cp1" | "cp2" | "cp";

interface DragState {
  index: number;
  part: DragPart;
  /** Live preview of the dragged path; the store receives it throttled. */
  points: PathPoint[];
}

function parsePathData(d: string): PathPoint[] {
  const points: PathPoint[] = [];
  const tokens = d.match(/[MLCSQZmlcsqz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i += 1;

    if (/^[MLCSQZ]$/.test(cmd)) {
      const upper = cmd.toUpperCase();
      if (upper === "M") {
        const x = parseFloat(tokens[i]);
        const y = parseFloat(tokens[i + 1]);
        i += 2;
        points.push({ x, y, type: "M" });
      } else if (upper === "L") {
        const x = parseFloat(tokens[i]);
        const y = parseFloat(tokens[i + 1]);
        i += 2;
        points.push({ x, y, type: "L" });
      } else if (upper === "C") {
        const cp1x = parseFloat(tokens[i]);
        const cp1y = parseFloat(tokens[i + 1]);
        const cp2x = parseFloat(tokens[i + 2]);
        const cp2y = parseFloat(tokens[i + 3]);
        const x = parseFloat(tokens[i + 4]);
        const y = parseFloat(tokens[i + 5]);
        i += 6;
        points.push({ x, y, type: "C", cp1: { x: cp1x, y: cp1y }, cp2: { x: cp2x, y: cp2y } });
      } else if (upper === "Q") {
        const cpx = parseFloat(tokens[i]);
        const cpy = parseFloat(tokens[i + 1]);
        const x = parseFloat(tokens[i + 2]);
        const y = parseFloat(tokens[i + 3]);
        i += 4;
        points.push({ x, y, type: "Q", cp: { x: cpx, y: cpy } });
      } else if (upper === "Z") {
        // close path - no point to add
      }
    } else if (/^[mlcsqz]$/.test(cmd)) {
      // Relative commands: skip the command and its coordinate args
      const argCount = { m: 2, l: 2, c: 6, s: 4, q: 2, t: 2 }[cmd] || 2;
      i += argCount;
    }
  }
  return points;
}

function pathPointToString(p: PathPoint): string {
  if (p.type === "M") return `M ${p.x} ${p.y}`;
  if (p.type === "L") return `L ${p.x} ${p.y}`;
  if (p.type === "C") {
    return `C ${p.cp1!.x} ${p.cp1!.y} ${p.cp2!.x} ${p.cp2!.y} ${p.x} ${p.y}`;
  }
  if (p.type === "Q") {
    return `Q ${p.cp!.x} ${p.cp!.y} ${p.x} ${p.y}`;
  }
  return "";
}

function pointsToPathData(points: PathPoint[]): string {
  return points.map(pathPointToString).join(" ");
}

/**
 * Move one path point (carrying its handles) or a single control handle.
 * Pure: every object it returns is fresh, so React state updates compare
 * by value of the produced array, never by mutating a previous snapshot.
 */
function movePoint(
  points: PathPoint[],
  index: number,
  part: DragPart,
  x: number,
  y: number,
): PathPoint[] {
  const current = points[index];
  if (!current) return points;
  const next = [...points];
  const p: PathPoint = { ...current };
  if (part === "point") {
    const dx = x - current.x;
    const dy = y - current.y;
    p.x = x;
    p.y = y;
    if (p.cp1) p.cp1 = { x: p.cp1.x + dx, y: p.cp1.y + dy };
    if (p.cp2) p.cp2 = { x: p.cp2.x + dx, y: p.cp2.y + dy };
    if (p.cp) p.cp = { x: p.cp.x + dx, y: p.cp.y + dy };
  } else if (part === "cp1" && p.cp1) {
    p.cp1 = { x, y };
  } else if (part === "cp2" && p.cp2) {
    p.cp2 = { x, y };
  } else if (part === "cp" && p.cp) {
    p.cp = { x, y };
  }
  next[index] = p;
  return next;
}

const HANDLE_RADIUS = 6;
const POINT_RADIUS = 8;
const HANDLE_COLOR = "#006c35";
const POINT_COLOR = "#00874a";
const HANDLE_LINE_COLOR = "#c9a86a";

export function VectorNodeEditor({ el, selected }: VectorNodeEditorProps) {
  const updateElement = useEditor((s) => s.updateElement);

  /* Derived — never synchronised with a setter during render (see the file
   * header): the drawn points always describe the element's current path. */
  const parsed = useMemo(() => parsePathData(el.content || ""), [el.content]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const points = drag?.points ?? parsed;
  const dragging = drag !== null;

  const commitPath = useCallback(
    (next: PathPoint[]) => {
      updateElement(el.id, { content: pointsToPathData(next) }, true);
    },
    [el.id, updateElement],
  );

  const beginDrag = (
    e: React.PointerEvent,
    index: number,
    part: DragPart,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const state: DragState = { index, part, points: parsed };
    dragRef.current = state;
    setDrag(state);
  };

  /**
   * Global move/up listeners exist only for the duration of one drag. They run
   * outside React's render cycle for smooth dragging and are cleaned up when
   * the drag ends or the editor unmounts mid-drag.
   */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (e.buttons === 0) return;
      const current = dragRef.current;
      if (!current) return;
      const svg =
        overlayRef.current ??
        (document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("svg") as SVGSVGElement | null);
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Screen coordinates → element-local millimetres (the overlay spans the
      // element's own box, so the mapping is exact at every zoom).
      const x = ((e.clientX - rect.left) / rect.width) * el.w;
      const y = ((e.clientY - rect.top) / rect.height) * el.h;
      const updated: DragState = {
        ...current,
        points: movePoint(current.points, current.index, current.part, x, y),
      };
      dragRef.current = updated;
      setDrag(updated);
      // Throttle commits to the store via requestAnimationFrame; the fluid
      // preview is local state, the document is written once per frame.
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const latest = dragRef.current;
          if (latest) commitPath(latest.points);
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
      // The final position lands as one undoable store edit.
      if (latest) commitPath(latest.points);
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
  }, [dragging, el.w, el.h, commitPath]);

  if (!selected) return null;

  return (
    <svg
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: `${el.w}mm`, height: `${el.h}mm` }}
    >
      <defs>
        <marker
          id="handle-arrow"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L0,6 L9,3 z" fill={HANDLE_COLOR} />
        </marker>
      </defs>
      {points.map((p, index) => {
        const handleEls: React.ReactNode[] = [];
        if (p.type === "C") {
          if (p.cp1) {
            handleEls.push(
              <line
                key={`cp1-line-${index}`}
                x1={p.x}
                y1={p.y}
                x2={p.cp1.x}
                y2={p.cp1.y}
                stroke={HANDLE_LINE_COLOR}
                strokeWidth="1"
                strokeDasharray="4,4"
              />,
            );
            handleEls.push(
              <circle
                key={`cp1-${index}`}
                cx={p.cp1.x}
                cy={p.cp1.y}
                r={HANDLE_RADIUS}
                fill={HANDLE_COLOR}
                stroke="#ffffff"
                strokeWidth="1.5"
                cursor="crosshair"
                onPointerDown={(e) => beginDrag(e, index, "cp1")}
              />,
            );
          }
          if (p.cp2) {
            handleEls.push(
              <line
                key={`cp2-line-${index}`}
                x1={p.x}
                y1={p.y}
                x2={p.cp2.x}
                y2={p.cp2.y}
                stroke={HANDLE_LINE_COLOR}
                strokeWidth="1"
                strokeDasharray="4,4"
              />,
            );
            handleEls.push(
              <circle
                key={`cp2-${index}`}
                cx={p.cp2.x}
                cy={p.cp2.y}
                r={HANDLE_RADIUS}
                fill={HANDLE_COLOR}
                stroke="#ffffff"
                strokeWidth="1.5"
                cursor="crosshair"
                onPointerDown={(e) => beginDrag(e, index, "cp2")}
              />,
            );
          }
        } else if (p.type === "Q" && p.cp) {
          handleEls.push(
            <line
              key={`cp-line-${index}`}
              x1={p.x}
              y1={p.y}
              x2={p.cp.x}
              y2={p.cp.y}
              stroke={HANDLE_LINE_COLOR}
              strokeWidth="1"
              strokeDasharray="4,4"
            />,
          );
          handleEls.push(
            <circle
              key={`cp-${index}`}
              cx={p.cp.x}
              cy={p.cp.y}
              r={HANDLE_RADIUS}
              fill={HANDLE_COLOR}
              stroke="#ffffff"
              strokeWidth="1.5"
              cursor="crosshair"
              onPointerDown={(e) => beginDrag(e, index, "cp")}
            />,
          );
        }

        return (
          <g key={`point-${index}`}>
            {handleEls}
            <circle
              cx={p.x}
              cy={p.y}
              r={POINT_RADIUS}
              fill={POINT_COLOR}
              stroke="#ffffff"
              strokeWidth="2"
              cursor="move"
              onPointerDown={(e) => beginDrag(e, index, "point")}
            />
          </g>
        );
      })}
    </svg>
  );
}
