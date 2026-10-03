import { create } from "zustand";
import {
  ASPECT_RATIOS,
  clampRegionBox,
  type AspectId,
  type SelectionRegion,
} from "./marquee";
import { TOOLS, toolDef, type ToolId } from "./tools";
import type { DocumentSize } from "./document-space";

/**
 * The tool store — one source of truth for "which tool is live, with which
 * settings".
 *
 * Root cause this removes: the previous tool state was a `drawTool` string
 * inside `CanvasStage`, a `marqueeShape` ref, an `eraserSize` ref, a mirrored
 * `activeTool` in the header and four window CustomEvents between them. Whoever
 * mounted last won, and a tool could be visibly "active" in the header while the
 * canvas still had the old settings — so a press did nothing, drew the wrong
 * shape, or erased whole elements instead of pixels.
 *
 * Everything a tool needs is set BEFORE the gesture starts (the picker writes
 * here, the canvas only reads), which is why the first pointerdown after
 * choosing a tool now behaves exactly like the tenth.
 */

export interface BrushSettings {
  /** Brush diameter in document millimetres — zoom independent, like geometry. */
  sizeMm: number;
  /** 0 = fully soft edge, 1 = hard edge. */
  hardness: number;
  /** 0..1. */
  opacity: number;
  /** 0 = follow the pointer exactly, 1 = maximum lag/straightening. */
  smoothing: number;
  color: string;
}

export interface EraserSettings {
  /** Eraser diameter in document millimetres. */
  sizeMm: number;
  hardness: number;
  opacity: number;
}

export const DEFAULT_BRUSH: BrushSettings = {
  sizeMm: 6,
  hardness: 0.85,
  opacity: 1,
  smoothing: 0.35,
  color: "#111827",
};

export const DEFAULT_ERASER: EraserSettings = {
  sizeMm: 10,
  hardness: 0.8,
  opacity: 1,
};

export const BRUSH_LIMITS = {
  size: { min: 0.5, max: 120 },
  hardness: { min: 0, max: 1 },
  opacity: { min: 0.02, max: 1 },
  smoothing: { min: 0, max: 1 },
} as const;

export const ERASER_LIMITS = {
  size: { min: 0.5, max: 200 },
  hardness: { min: 0, max: 1 },
  opacity: { min: 0.02, max: 1 },
} as const;

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/**
 * Live raster-gesture state. Never in React: the stroke repaints an overlay
 * canvas the session owns, so a 120Hz Pencil does not re-render the shell.
 */
export interface RasterGesture {
  pageId: string;
  elementId: string;
  tool: "brush" | "eraser";
  /** Element frame in page mm, for the overlay geometry. */
  frame: { x: number; y: number; w: number; h: number; rotation: number; flipX: boolean; flipY: boolean };
}

export interface ToolState {
  tool: ToolId;
  /** Element the raster tools are currently allowed to touch (null = pick at press). */
  rasterTarget: RasterGesture | null;
  /** Set while a stroke is live, so the UI can lock conflicting controls. */
  painting: boolean;
  brush: BrushSettings;
  eraser: EraserSettings;
  cropAspect: AspectId;
  /** Finished marquee region — editable, croppable, and the crop tool's input. */
  region: SelectionRegion | null;
  setTool: (tool: ToolId) => void;
  /** Choosing a tool clears tools that must not inherit the previous region. */
  resetTool: () => void;
  setBrush: (patch: Partial<BrushSettings>) => void;
  setEraser: (patch: Partial<EraserSettings>) => void;
  setCropAspect: (aspect: AspectId) => void;
  setRegion: (region: SelectionRegion | null) => void;
  /** Re-clamp the live region when the page size changes under it. */
  clampRegion: (pageId: string, size: DocumentSize) => void;
  setRasterTarget: (target: RasterGesture | null) => void;
  setPainting: (painting: boolean) => void;
}

export const useTools = create<ToolState>((set) => ({
  tool: "select",
  rasterTarget: null,
  painting: false,
  brush: { ...DEFAULT_BRUSH },
  eraser: { ...DEFAULT_ERASER },
  cropAspect: "free",
  region: null,
  setTool: (tool) =>
    set((state) => ({
      tool,
      region: tool === "select" ? null : state.region,
      rasterTarget: null,
      painting: false,
    })),
  resetTool: () =>
    set({ tool: "select", region: null, rasterTarget: null, painting: false }),
  setBrush: (patch) =>
    set((state) => {
      const next = { ...state.brush, ...patch };
      return {
        brush: {
          sizeMm: clamp(next.sizeMm, BRUSH_LIMITS.size.min, BRUSH_LIMITS.size.max),
          hardness: clamp(
            next.hardness,
            BRUSH_LIMITS.hardness.min,
            BRUSH_LIMITS.hardness.max,
          ),
          opacity: clamp(
            next.opacity,
            BRUSH_LIMITS.opacity.min,
            BRUSH_LIMITS.opacity.max,
          ),
          smoothing: clamp(
            next.smoothing,
            BRUSH_LIMITS.smoothing.min,
            BRUSH_LIMITS.smoothing.max,
          ),
          color: /^#[0-9a-f]{6}$/i.test(next.color) ? next.color : DEFAULT_BRUSH.color,
        },
      };
    }),
  setEraser: (patch) =>
    set((state) => {
      const next = { ...state.eraser, ...patch };
      return {
        eraser: {
          sizeMm: clamp(next.sizeMm, ERASER_LIMITS.size.min, ERASER_LIMITS.size.max),
          hardness: clamp(
            next.hardness,
            ERASER_LIMITS.hardness.min,
            ERASER_LIMITS.hardness.max,
          ),
          opacity: clamp(
            next.opacity,
            ERASER_LIMITS.opacity.min,
            ERASER_LIMITS.opacity.max,
          ),
        },
      };
    }),
  setCropAspect: (cropAspect) =>
    set({ cropAspect: ASPECT_RATIOS.some((a) => a.id === cropAspect) ? cropAspect : "free" }),
  setRegion: (region) => set({ region }),
  clampRegion: (pageId, size) =>
    set((state) => {
      if (!state.region || state.region.pageId !== pageId) return {};
      const box = clampRegionBox(state.region.box, size);
      if (!box) return { region: null };
      if (
        box.x === state.region.box.x &&
        box.y === state.region.box.y &&
        box.w === state.region.box.w &&
        box.h === state.region.box.h
      )
        return {};
      return { region: { ...state.region, box } };
    }),
  setRasterTarget: (rasterTarget) => set({ rasterTarget }),
  setPainting: (painting) => set({ painting }),
}));

/** Imperative read for pointer handlers (never a React subscription). */
export function toolState() {
  return useTools.getState();
}

export const toolLabel = (id: ToolId) => TOOLS[id]?.label ?? toolDef(id).label;

/** The aspect ratio the crop tool is currently constrained to. */
export function cropAspectRatio(id: AspectId): number | null {
  return ASPECT_RATIOS.find((aspect) => aspect.id === id)?.ratio ?? null;
}
