/**
 * Vector node editor — Bézier path point and handle manipulation.
 *
 * Renders anchor points and control handles for a selected `svg` element,
 * allowing the author to drag points and handles to reshape the path.
 * Integrates with the existing selection model: only the currently selected
 * element is editable, and changes flow through the standard update cycle.
 */

import { useCallback, useRef, useState } from "react";
import { useEditor } from "@/lib/editor/store";
import { type CanvasEl } from "@/lib/editor/model";

interface PathPoint {
  x: number;
  y: number;
  type: "M" | "L" | "C" | "Q";
  /** For cubic curves: control point before this point. */
  cp1?: { x: number; y: number };
  /** For cubic curves: control point after this point. */
  cp2?: { x: number; y: number };
  /** For quadratic curves: single control point. */
  cp?: { x: number; y: number };
}

interface VectorNodeEditorProps {
  el: CanvasEl;
  selected: boolean;
  onUpdate: (pathData: string) => void;
}

function parsePathData(d: string): PathPoint[] {
  const points: PathPoint[] = [];
  const tokens = d.match(/[MLCSQZmlcsqz]|[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  let i = 0;
  let current: PathPoint | null = null;

  while (i < tokens.length) {
    const cmd = tokens[i];
    i += 1;

    if (/^[MLCSQZ]$/.test(cmd)) {
      const upper = cmd.toUpperCase();
      if (upper === "M") {
        const x = parseFloat(tokens[i]);
        const y = parseFloat(tokens[i + 1]);
        i += 2;
        current = { x, y, type: "M" };
        points.push(current);
      } else if (upper === "L") {
        const x = parseFloat(tokens[i]);
        const y = parseFloat(tokens[i + 1]);
        i += 2;
        current = { x, y, type: "L" };
        points.push(current);
      } else if (upper === "C") {
        const cp1x = parseFloat(tokens[i]);
        const cp1y = parseFloat(tokens[i + 1]);
        const cp2x = parseFloat(tokens[i + 2]);
        const cp2y = parseFloat(tokens[i + 3]);
        const x = parseFloat(tokens[i + 4]);
        const y = parseFloat(tokens[i + 5]);
        i += 6;
        current = { x, y, type: "C", cp1: { x: cp1x, y: cp1y }, cp2: { x: cp2x, y: cp2y } };
        points.push(current);
      } else if (upper === "Q") {
        const cpx = parseFloat(tokens[i]);
        const cpy = parseFloat(tokens[i + 1]);
        const x = parseFloat(tokens[i + 2]);
        const y = parseFloat(tokens[i + 3]);
        i += 4;
        current = { x, y, type: "Q", cp: { x: cpx, y: cpy } };
        points.push(current);
      } else if (upper === "Z") {
        current = null;
      }
    } else if (/^[mlcsqz]$/.test(cmd)) {
      // Relative commands - skip for now, treat as absolute
      i += 2;
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

const HANDLE_RADIUS = 6;
const POINT_RADIUS = 8;
const HANDLE_COLOR = "#006c35";
const POINT_COLOR = "#00874a";
const HANDLE_LINE_COLOR = "#c9a86a";

export function VectorNodeEditor({ el, selected, onUpdate }: VectorNodeEditorProps) {
  const [points, setPoints] = useState<PathPoint[]>([]);
  const [dragging, setDragging] = useState<{ index: number; part: "point" | "cp1" | "cp2" | "cp" } | null>(null);
  const store = useEditor();
  const elRef = useRef<SVGSVGElement | null>(null);

  const updatePath = useCallback(
    (next: PathPoint[]) => {
      setPoints(next);
      onUpdate(pointsToPathData(next));
    },
    [onUpdate],
  );

  // Parse path data when element changes.
  if (selected && (points.length === 0 || el.content)) {
    const parsed = parsePathData(el.content || "");
    if (parsed.length > 0) setPoints(parsed);
  }

  if (!selected) return null;

  const updatePoint = useCallback(
    (index: number, part: "point" | "cp1" | "cp2" | "cp", x: number, y: number) => {
      setPoints((prev) => {
        const next = [...prev];
        const p = { ...next[index] };
        if (part === "point") {
          p.x = x;
          p.y = y;
          // Keep relative handle positions.
          if (p.cp1) { p.cp1.x += x - next[index].x; p.cp1.y += y - next[index].y; }
          if (p.cp2) { p.cp2.x += x - next[index].x; p.cp2.y += y - next[index].y; }
          if (p.cp) { p.cp.x += x - next[index].x; p.cp.y += y - next[index].y; }
        } else if (part === "cp1" && p.cp1) {
          p.cp1.x = x;
          p.cp1.y = y;
        } else if (part === "cp2" && p.cp2) {
          p.cp2.x = x;
          p.cp2.y = y;
        } else if (part === "cp" && p.cp) {
          p.cp.x = x;
          p.cp.y = y;
        }
        next[index] = p;
        return next;
      });
    },
    [],
  );

  return (
    <svg
      ref={elRef}
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
        // Draw control handle lines.
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
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragging({ index, part: "cp1" });
                }}
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
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragging({ index, part: "cp2" });
                }}
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
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragging({ index, part: "cp" });
              }}
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
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragging({ index, part: "point" });
              }}
            />
          </g>
        );
      })}
    </svg>
  );
}
