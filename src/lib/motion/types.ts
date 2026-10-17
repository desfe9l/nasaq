/**
 * The motion composition model for the NASAQ Arabic Motion Studio.
 *
 * ## The contract
 *
 * A composition is a **pure description**. It holds no state, no DOM, and no
 * timers. Everything visible — the preview in the browser, the still frames,
 * the encoded video — is produced by calling `seek(composition, tMs)` and
 * rendering the returned frame. Two consequences matter and are relied on
 * everywhere else in this directory:
 *
 *  1. Frame N is identical whether it is the 10th frame of a live preview, the
 *     only frame of a still export, or the 900th frame of a background render.
 *     There is no accumulated state to drift.
 *  2. A frame can be produced in any order, and in parallel. A renderer may
 *     seek to 4.2s, then 0.0s, then 3.1s and get correct results each time.
 *
 * This is the same contract the NASAQ editor already uses for its document
 * model, and it is what makes an HTML composition renderable by a worker
 * without shipping the editor to the worker.
 *
 * ## Units
 *
 * Space is **pixels at composition resolution**; time is **milliseconds**. The
 * renderer scales to the output target, so a 1440-wide composition authored
 * once renders correctly at any size. Keeping one authoring space avoids the
 * class of bug where a 2× export doubles the wrong thing.
 */

/** Canonical NASAQ palette, in document order. Mirrors `src/styles.css`. */
export interface MotionPalette {
  /** Deep institutional green — fields, titles, key lines. */
  green: string;
  /** Lighter green used when a field sits on white. */
  greenLight: string;
  /** Brand green used for accents on dark grounds. */
  brand: string;
  /** Muted gold — rules, diamonds, page-number circles. */
  gold: string;
  /** Pale gold, for gold on dark grounds. */
  goldLight: string;
  /** Deep navy ink. */
  ink: string;
  /** Paper white. */
  paper: string;
  /** Ivory / sand page. */
  surface: string;
  /** Muted grey for Latin metadata only — never an Arabic title. */
  muted: string;
}

export const NASAQ_PALETTE: MotionPalette = {
  green: "#0c3d2c",
  greenLight: "#1f6b45",
  brand: "#006c35",
  gold: "#c6a05a",
  goldLight: "#e0c894",
  ink: "#172033",
  paper: "#ffffff",
  surface: "#f4f0e8",
  muted: "#6b7280",
};

/** An affine transform in degrees + pixels, applied around the element centre. */
export interface Transform {
  /** Horizontal offset in composition px. */
  x: number;
  /** Vertical offset in composition px. */
  y: number;
  scaleX: number;
  scaleY: number;
  /** Clockwise rotation in degrees. */
  rotation: number;
  opacity: number;
}

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

export type LayerKind =
  | "text"
  | "period-origin"
  | "shape"
  | "image"
  | "caption"
  | "progress";

/** Base fields shared by every layer. */
interface LayerBase {
  id: string;
  /** Authoring label; used by the timeline and the layer list. */
  name: string;
  /** Relative z within the scene. Higher paints later. */
  z: number;
  /** Window within the scene, in ms, relative to the scene start. */
  startMs: number;
  endMs: number;
  /** Fraction of the layer window spent entering / holding / leaving. */
  enter?: number;
  hold?: number;
  exit?: number;
  /** Stagger offset in ms, applied after the scene resolves its start. */
  delayMs?: number;
}

/**
 * Arabic text.
 *
 * `text` is logical order (what a human types). Shaping, glyph ordering and
 * bidi are resolved by the renderer via the `arabicType` module — never
 * pre-reversed here, because reversing twice is a silent corruption.
 */
export interface TextLayer extends LayerBase {
  kind: "text";
  text: string;
  /** Composition px. */
  fontSize: number;
  /**
   * Baseline position as a ratio of frame height.
   *
   * Required in practice: without it every text layer lands on the same top
   * margin and the kicker collides with the headline.
   */
  top?: number;
  /** CSS font stack. Arabic-first: Tajawal for display, Noto Naskh for prose. */
  fontFamily: string;
  fontWeight: number;
  color: string;
  align: "start" | "center" | "end";
  /** Optional gold rule under the line, in composition px. */
  rule?: { color: string; thickness: number; gap: number };
  /** Per-character reveal for kinetic typography. */
  reveal?: "none" | "fade" | "rise" | "slide-rtl" | "scale";
  /** Max characters revealed at the end of the enter phase. */
  revealStaggerMs?: number;
  /** Uppercase/lowercase/Arabic shaping is controlled by `text-transform` intent. */
  letterSpacing?: number;
  lineHeight?: number;
}

/**
 * The period-origin launch effect: the world's story happens *inside* the
 * final period character of a name or wordmark, which opens like an iris.
 *
 * Modelled explicitly rather than as a generic shape because the geometry is
 * load-bearing: see `periodOrigin.ts` for the centre/area/offset contract.
 */
export interface PeriodOriginLayer extends LayerBase {
  kind: "period-origin";
  /**
   * The full wordmark, logical order, including the final period when there is
   * one. The effect anchors to the LAST period glyph.
   */
  wordmark: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  /** Colour of the wordmark outside the iris. */
  color: string;
  /** Colour of the wordmark once the inner world has taken it. */
  innerColor: string;
  /** What plays inside the iris: a colour field with optional caption beats. */
  inner: PeriodInner;
  /** Max iris diameter as a fraction of composition width. */
  irisScale?: number;
  /** Centre offset as a fraction of composition width/height. */
  centre?: { x: number; y: number };
}

/** Content revealed through the period-origin iris. */
export interface PeriodInner {
  background: string;
  /** Accent used for the sweeping scan line. */
  accent: string;
  /** Optional headline inside the iris. */
  title?: string;
  titleFontSize?: number;
  titleColor?: string;
  /** Optional caption beats that roll through the iris. */
  beats?: Array<{ text: string; startMs: number; endMs: number }>;
}

export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: "rect" | "circle" | "line" | "diamond";
  width: number;
  height: number;
  /** Corner radius for `rect`. */
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Grow from one edge; used for the scan sweep. */
  grow?: "none" | "x" | "y";
}

export interface ImageLayer extends LayerBase {
  kind: "image";
  /** Data URL or an absolute http(s)/relative asset path resolved by the renderer. */
  src: string;
  width: number;
  height: number;
  radius?: number;
  /** How the image fills its box. */
  fit?: "cover" | "contain" | "fill";
  alt?: string;
}

/** An Arabic caption band — always bottom-anchored and always RTL. */
export interface CaptionLayer extends LayerBase {
  kind: "caption";
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  /** Optional plate behind the caption for legibility over photography. */
  plate?: { color: string; padding: number; radius: number };
}

/** A determinate progress bar — reads as real work, never decorative. */
export interface ProgressLayer extends LayerBase {
  kind: "progress";
  width: number;
  height: number;
  color: string;
  trackColor: string;
  /** Where the bar ends up, 0–1. */
  value: number;
  label?: string;
  labelFontSize?: number;
  labelColor?: string;
}

export type Layer =
  | TextLayer
  | PeriodOriginLayer
  | ShapeLayer
  | ImageLayer
  | CaptionLayer
  | ProgressLayer;

/** How one scene hands over to the next. */
export interface Transition {
  kind: "none" | "iris" | "cut" | "slide";
  durationMs: number;
  /** Direction for `slide`, in degrees. */
  direction?: number;
}

export interface Scene {
  id: string;
  /** Authoring name, Arabic or Latin as the author wrote it. */
  name: string;
  /** Scene-local timing. Scenes are contiguous and non-overlapping. */
  durationMs: number;
  background: string;
  transition: Transition;
  layers: Layer[];
}

export type AspectRatio = "square" | "portrait" | "landscape";

export interface Composition {
  id: string;
  name: string;
  /** Authoring width in px. Height follows from `aspect`. */
  width: number;
  aspect: AspectRatio;
  fps: number;
  palette: MotionPalette;
  scenes: Scene[];
  /** When true the last frame is authored to equal the first. */
  loop: boolean;
  /** Optional audio track description; rendering resolves it separately. */
  audio?: { src: string; startMs: number; durationMs: number; gainDb?: number };
}

/** Height in px for a composition, derived from its aspect. */
export const compositionHeight = (composition: Composition): number => {
  const { width, aspect } = composition;
  switch (aspect) {
    case "square":
      return width;
    case "landscape":
      return Math.round((width * 9) / 16);
    case "portrait":
      // 9:16 — the Reels / TikTok / Shorts frame.
      return Math.round((width * 16) / 9);
  }
};

/** Total duration in ms. Derived from the scenes, never stored separately. */
export const compositionDuration = (composition: Composition): number =>
  composition.scenes.reduce((total, scene) => total + scene.durationMs, 0);

/** Total frames at the composition's fps. Always at least 1. */
export const compositionFrameCount = (composition: Composition): number => {
  const seconds = compositionDuration(composition) / 1000;
  return Math.max(1, Math.round(seconds * composition.fps));
};

/** Duration of one frame in ms. Used to quantise discrete steps. */
export const frameDurationMs = (composition: Composition): number =>
  1000 / composition.fps;