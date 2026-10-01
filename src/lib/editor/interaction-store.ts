import { create } from "zustand";
import type { CanvasEl } from "./model";
import type { CropTransform } from "./image-crop";
import type { RectMm } from "./document-space";

export interface CropSession {
  pageId: string;
  original: CanvasEl;
  transform: CropTransform;
  enteredGroupId: string | null;
  source: { w: number; h: number };
  box: RectMm;
  bounds: RectMm;
}

/**
 * Transient canvas interaction state — the frame-rate layer.
 *
 * WHY THIS EXISTS (root cause this fixes):
 *
 * The document used to be mutated through the editor store on every
 * `pointermove` (`replaceElement(…, live)`), and every subscriber of `pages`
 * re-rendered per frame: the whole studio shell, both side panels, the pages
 * rail, the export capture DOM and every element node on every page. That is
 * what made dragging one element on a large document feel heavy.
 *
 * This store holds ONLY what a live gesture needs, and nothing subscribes to it
 * except the pieces of UI that must follow the pointer:
 *
 *  · `overrides` — geometry (page mm) of the elements under the finger, keyed
 *    by element id. An element node subscribes to `overrides[its own id]`, so a
 *    drag re-renders exactly the dragged nodes — never their neighbours, never
 *    the panels.
 *  · `guides` / `rotationHint` / `marquee` — the visual feedback overlays.
 *  · `version` — bumped on every write; lets a single small component (the
 *    floating bubble) follow a drag of any element without subscribing to the
 *    document.
 *
 * The document store is touched exactly once per gesture: when the gesture
 * ends, the final geometry is committed through one batched, undoable store
 * write. Nothing here is persisted, undoable, or visible to autosave.
 */

/** Geometry fields a gesture may transiently change (page mm, absolute). */
export interface TransientGeom {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
}

/** Marquee rectangle in active-page mm. */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RotationHint {
  angle: number;
  shift: boolean;
  x: number;
  y: number;
}

export interface InteractionState {
  /** Increments on every transient write (cheap drag follower signal). */
  version: number;
  /** True between `beginInteraction` and `endInteraction`. */
  active: boolean;
  /** Exclusive, non-destructive crop mode; never shares transform handles. */
  crop: CropSession | null;
  beginCrop: (session: CropSession) => void;
  setCropBox: (box: RectMm) => void;
  endCrop: () => void;
  /** Element id → transient geometry while a gesture is live. */
  overrides: Record<string, TransientGeom>;
  /** Alignment guides for the live gesture. */
  guides: { v: number[]; h: number[] };
  /** Live rotation readout. */
  rotationHint: RotationHint | null;
  /** Live marquee rectangle. */
  marquee: MarqueeRect | null;
  beginInteraction: () => void;
  /**
   * Merge transient geometry for one element. Object spreads — NOT a store
   * `set` per field — so one pointer event produces at most one notification.
   */
  setOverride: (id: string, geom: TransientGeom) => void;
  setGuides: (guides: { v: number[]; h: number[] }) => void;
  setRotationHint: (hint: RotationHint | null) => void;
  setMarquee: (rect: MarqueeRect | null) => void;
  /** Drop every override/overlay — the gesture committed or cancelled. */
  endInteraction: () => void;
}

const EMPTY_GUIDES = { v: [], h: [] };

export const useInteraction = create<InteractionState>((set) => ({
  version: 0,
  active: false,
  crop: null,
  beginCrop: (crop) =>
    set((s) => ({
      crop,
      active: false,
      overrides: {},
      guides: EMPTY_GUIDES,
      version: s.version + 1,
    })),
  setCropBox: (box) =>
    set((s) =>
      s.crop ? { crop: { ...s.crop, box }, version: s.version + 1 } : {},
    ),
  endCrop: () => set((s) => ({ crop: null, version: s.version + 1 })),
  overrides: {},
  guides: EMPTY_GUIDES,
  rotationHint: null,
  marquee: null,
  beginInteraction: () =>
    set((s) =>
      s.active
        ? { version: s.version + 1 }
        : { active: true, version: s.version + 1 },
    ),
  setOverride: (id, geom) =>
    set((s) => ({
      overrides: { ...s.overrides, [id]: geom },
      version: s.version + 1,
    })),
  setGuides: (guides) =>
    set((s) => ({
      guides: guides.v.length || guides.h.length ? guides : EMPTY_GUIDES,
      version: s.version + 1,
    })),
  setRotationHint: (rotationHint) =>
    set((s) => ({ rotationHint, version: s.version + 1 })),
  setMarquee: (marquee) => set((s) => ({ marquee, version: s.version + 1 })),
  endInteraction: () =>
    set((s) => ({
      overrides: {},
      guides: EMPTY_GUIDES,
      rotationHint: null,
      marquee: null,
      active: false,
      version: s.version + 1,
    })),
}));

/** Imperative read for pointer handlers (never a React subscription). */
export function interactionState() {
  return useInteraction.getState();
}
