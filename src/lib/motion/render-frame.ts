/**
 * Deterministic frame resolution for the NASAQ Motion Studio.
 *
 * `seek(t)` is the single source of truth for what a composition looks like at
 * any instant. Everything downstream — the live preview, a still export, the
 * HTML composition, a background render — consumes the same
 * {@link RenderFrame}, which is why those can never disagree about what the
 * motion looks like.
 *
 * The output is a flat, ordered list of **draw ops**, not a tree and not a
 * React element. That is deliberate:
 *
 *  - A DOM renderer maps ops to absolutely-positioned elements.
 *  - A canvas renderer maps ops to canvas calls.
 *  - The HTML exporter serialises ops to markup.
 *  - A test can assert on geometry without a browser at all.
 *
 * One resolution, four consumers, zero drift.
 */

import { easedProgress, lerp, MOTION_EASE, windowedProgress } from "./easing.ts";
import { mixRgb, parseColor } from "./color.ts";
import { revealedCount, runDirection, splitClusters } from "./arabic-type.ts";
import {
  findPeriodAnchor,
  periodOriginState,
  PERIOD_BASELINE_OFFSET,
  type PeriodAnchor,
  type TextMeasure,
} from "./period-origin.ts";
import {
  scenesInProgress,
  transitionOffset,
  transitionProgress,
} from "./timeline.ts";
import {
  compositionHeight,
  type CaptionLayer,
  type Composition,
  type ImageLayer,
  type Layer,
  type PeriodOriginLayer,
  type ProgressLayer,
  type Scene,
  type ShapeLayer,
  type TextLayer,
} from "./types.ts";

/** A resolved, drawable instruction. Coordinates are composition px. */
export type FrameOp =
  | {
      kind: "rect";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: string;
      stroke?: string;
      strokeWidth?: number;
      opacity: number;
      rotation: number;
      z: number;
    }
  | {
      kind: "text";
      id: string;
      text: string;
      /** Logical-order clusters, ready for shaping. Never pre-reversed. */
      clusters: string[];
      /** How many leading logical clusters are revealed. */
      revealed: number;
      reveal: NonNullable<TextLayer["reveal"]>;
      x: number;
      y: number;
      /** Resolved alignment anchor in composition px (see `textAnchorX`). */
      anchorX: number;
      fontSize: number;
      fontFamily: string;
      fontWeight: number;
      color: string;
      align: "start" | "center" | "end";
      direction: "rtl" | "ltr";
      lineHeight: number;
      letterSpacing: number;
      rule?: TextLayer["rule"];
      opacity: number;
      z: number;
    }
  | {
      kind: "period-origin";
      id: string;
      wordmark: string;
      anchor: PeriodAnchor;
      /** Left edge of the wordmark box, positioned so the anchor lands on the iris. */
      originX: number;
      y: number;
      fontSize: number;
      fontFamily: string;
      fontWeight: number;
      color: string;
      innerColor: string;
      centreX: number;
      centreY: number;
      radius: number;
      inner: PeriodOriginLayer["inner"];
      beatIndex: number;
      opacity: number;
      z: number;
    }
  | {
      kind: "image";
      id: string;
      src: string;
      alt: string;
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fit: "cover" | "contain" | "fill";
      opacity: number;
      z: number;
    }
  | {
      kind: "caption";
      id: string;
      text: string;
      clusters: string[];
      x: number;
      y: number;
      /** Captions are always RTL; their anchor is the right margin. */
      anchorX: number;
      fontSize: number;
      fontFamily: string;
      fontWeight: number;
      color: string;
      plate?: CaptionLayer["plate"];
      opacity: number;
      z: number;
    }
  | {
      kind: "progress";
      id: string;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      trackColor: string;
      /** 0–1. Determinate — never a decorative indeterminate spinner. */
      value: number;
      labelFontSize: number;
      labelColor: string;
      opacity: number;
      z: number;
    };

export interface RenderFrame {
  timeMs: number;
  width: number;
  height: number;
  background: string;
  ops: FrameOp[];
}

/**
 * A deterministic measure used when no font metrics are available.
 *
 * Arabic advances in an open `type` joining context are close to half an em,
 * so 0.5em is a defensible default — but it is a *fallback*. The browser
 * renderer always injects a canvas-backed measure instead. Keeping this
 * injectable rather than hard-coding a constant inside the renderer is what
 * keeps exported HTML pixel-accurate.
 */
export const defaultMeasure: TextMeasure = (text, fontSizePx) =>
  text.length * fontSizePx * 0.5;

/** Full-bleed layers are inset by this fraction of the composition width. */
const MARGIN_RATIO = 0.09;

const marginOf = (width: number): number => width * MARGIN_RATIO;

export interface SeekOptions {
  /**
   * Font metrics provider. Pass a canvas-backed measure for exact placement;
   * omit for a deterministic estimate.
   */
  measure?: TextMeasure;
}

interface WindowState {
  opacity: number;
  visible: boolean;
  /**
   * 0–1 across the whole enter/hold/exit window.
   *
   * A staggered reveal counts against the **enter** fraction of it, so callers
   * must scale by `enter` and clamp — otherwise the reveal keeps climbing
   * during hold and unwinds during the exit.
   */
  progress: number;
}

/**
 * Resolve a layer's presence at scene-local time.
 *
 * Outside its window the layer reports `visible: false` so renderers skip the
 * work entirely instead of building invisible geometry every frame.
 */
const resolveWindow = (layer: Layer, localMs: number): WindowState => {
  const start = (layer.startMs ?? 0) + (layer.delayMs ?? 0);
  const end = layer.endMs > 0 ? layer.endMs : Number.POSITIVE_INFINITY;
  const windowed = windowedProgress(
    localMs,
    start,
    end,
    { enter: layer.enter, hold: layer.hold, exit: layer.exit },
    MOTION_EASE,
  );
  if (windowed.phase === "before" || windowed.phase === "after") {
    return { opacity: 0, visible: false, progress: 0 };
  }
  return { opacity: windowed.value, visible: true, progress: windowed.value };
};

const hexToRgb = (hex: string): [number, number, number] | null =>
  parseColor(hex);

/**
 * Crossfade two colours. Used for the night→dawn→day sky cycle.
 *
 * Delegates to the shared colour module so this, the canvas renderer and the
 * embedded runtime cannot drift apart within a release.
 */
export const skyTint = (from: string, to: string, t: number): string =>
  mixRgb(from, to, t);

/**
 * Resolve the x an aligned text run is anchored at.
 *
 * This has to live here rather than in the renderer, because only the frame
 * knows its own width and RTL alignment is measured from the **right** margin.
 * A renderer that anchors "start" at the left inset — the obvious reading —
 * pushes every Arabic headline off the right edge of the frame, which is
 * exactly what a real render showed.
 */
const textAnchorX = (
  align: TextLayer["align"],
  direction: "rtl" | "ltr",
  margin: number,
  width: number,
): number => {
  if (align === "center") return width / 2;
  const fromLeft = align === "start" ? direction === "ltr" : direction === "rtl";
  return fromLeft ? margin : width - margin;
};

const textOp = (
  layer: TextLayer,
  margin: number,
  state: WindowState,
  sceneAlpha: number,
  width: number,
  height: number,
): FrameOp => {
  const clusters = splitClusters(layer.text);
  const reveal = layer.reveal ?? "none";
  const staggerMs = layer.revealStaggerMs;
  const revealed =
    reveal === "none"
      ? clusters.length
      : revealedCount(
          clusters.length,
          Math.min(1, state.progress / (layer.enter ?? 0.3)),
          staggerMs !== undefined ? staggerMs / 1000 : 0.06,
          ((layer.endMs - layer.startMs) * (layer.enter ?? 0.3)) / 1000,
        );
  const direction = runDirection(layer.text);
  return {
    kind: "text",
    id: layer.id,
    text: layer.text,
    clusters,
    revealed,
    reveal,
    x: margin,
    // `top` is a ratio of frame height; fall back to the side margin so a
    // layer without one still lands on the safe area.
    y: layer.top !== undefined ? layer.top * height : margin,
    // Resolved anchor, paired with `align`/`direction` so a renderer can turn
    // it into the correct `textAlign` without re-deriving the geometry.
    anchorX: textAnchorX(layer.align, direction, margin, width),
    fontSize: layer.fontSize,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
    color: layer.color,
    align: layer.align,
    direction,
    lineHeight: layer.lineHeight ?? 1.25,
    letterSpacing: layer.letterSpacing ?? 0,
    rule: layer.rule,
    opacity: state.opacity * sceneAlpha,
    z: layer.z,
  };
};

const shapeOp = (
  layer: ShapeLayer,
  margin: number,
  state: WindowState,
  sceneAlpha: number,
  height: number,
): FrameOp => {
  const grow = state.progress;
  const width = layer.grow === "x" ? layer.width * grow : layer.width;
  const h = layer.grow === "y" ? layer.height * grow : layer.height;
  return {
    kind: "rect",
    id: layer.id,
    x: margin,
    y: height / 2 - layer.height / 2,
    width,
    height: h,
    radius: layer.radius ?? 0,
    fill: layer.fill ?? "transparent",
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    opacity: state.opacity * sceneAlpha,
    rotation: 0,
    z: layer.z,
  };
};

const imageOp = (
  layer: ImageLayer,
  margin: number,
  state: WindowState,
  sceneAlpha: number,
  height: number,
): FrameOp => ({
  kind: "image",
  id: layer.id,
  src: layer.src,
  alt: layer.alt ?? "",
  x: margin,
  y: height / 2 - layer.height / 2,
  width: layer.width,
  height: layer.height,
  radius: layer.radius ?? 0,
  fit: layer.fit ?? "cover",
  opacity: state.opacity * sceneAlpha,
  z: layer.z,
});

const captionOp = (
  layer: CaptionLayer,
  state: WindowState,
  sceneAlpha: number,
  width: number,
  height: number,
): FrameOp => {
  const margin = marginOf(width);
  return {
    kind: "caption",
    id: layer.id,
    text: layer.text,
    clusters: splitClusters(layer.text),
    x: margin,
    y: height - margin - layer.fontSize * 1.9,
    anchorX: width - margin,
    fontSize: layer.fontSize,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
    color: layer.color,
    plate: layer.plate,
    opacity: state.opacity * sceneAlpha,
    z: layer.z,
  };
};

const progressOp = (
  layer: ProgressLayer,
  state: WindowState,
  sceneAlpha: number,
  width: number,
  height: number,
): FrameOp => {
  const margin = marginOf(width);
  return {
    kind: "progress",
    id: layer.id,
    label: layer.label ?? "",
    x: margin,
    y: height - margin * 2.2,
    width: width - margin * 2,
    height: layer.height,
    color: layer.color,
    trackColor: layer.trackColor,
    value: Math.max(0, Math.min(1, layer.value * state.progress)),
    labelFontSize: layer.labelFontSize ?? layer.height * 0.95,
    labelColor: layer.labelColor ?? layer.color,
    opacity: state.opacity * sceneAlpha,
    z: layer.z,
  };
};

/**
 * Resolve the period-origin op.
 *
 * Wordmark placement deserves a note. The run is RTL, so the *logical* start
 * is the right edge. To put the anchor glyph's centre exactly on the iris
 * centre, the distance from the anchor to the **end** of the measured run is
 * what must be subtracted from the centre:
 *
 *     drawX = centreX - (totalWidth - anchor.xFromStart)
 *
 * Getting this backwards by mirroring instead of subtracting is the usual bug,
 * and it places the wordmark one glyph-width off on every wordmark.
 */
const periodOp = (
  layer: PeriodOriginLayer,
  measure: TextMeasure,
  sceneStartMs: number,
  localMs: number,
  state: WindowState,
  sceneAlpha: number,
  width: number,
  height: number,
): FrameOp | null => {
  const anchor = findPeriodAnchor(layer.wordmark, layer.fontSize, measure);
  if (!anchor) return null;

  const cycleStart = sceneStartMs + layer.startMs;
  const cycleEnd = sceneStartMs + (layer.endMs > 0 ? layer.endMs : cycleStart + 2400);
  const span = Math.max(cycleEnd - cycleStart, 1);

  const centreX = width * (layer.centre?.x ?? 0.5);
  const centreY = height * (layer.centre?.y ?? 0.5);
  const maxDiameter = width * (layer.irisScale ?? 0.62);

  const state_ = periodOriginState(sceneStartMs + localMs, {
    startMs: cycleStart,
    openMs: cycleStart + span * 0.34,
    closeMs: cycleStart + span * 0.82,
    endMs: cycleEnd,
    centreX,
    centreY,
    maxDiameter,
    inner: layer.inner,
  });

  const totalWidth = measure(layer.wordmark, layer.fontSize);
  const distanceFromEnd = totalWidth - anchor.x;

  return {
    kind: "period-origin",
    id: layer.id,
    wordmark: layer.wordmark,
    anchor,
    originX: centreX - distanceFromEnd,
    // `y` is the **text baseline**. Renderers draw with an alphabetic baseline,
    // and the period's centre sits just above it — so placing the baseline a
    // hair below the iris centre puts the dot dead centre in the disc.
    y: centreY + PERIOD_BASELINE_OFFSET * layer.fontSize,
    fontSize: layer.fontSize,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
    color: layer.color,
    innerColor: layer.innerColor,
    centreX,
    centreY,
    radius: state_.radius,
    inner: layer.inner,
    beatIndex: state_.beatIndex,
    opacity: state.opacity * sceneAlpha,
    z: layer.z,
  };
};

const resolveLayer = (
  layer: Layer,
  measure: TextMeasure,
  sceneStartMs: number,
  localMs: number,
  state: WindowState,
  sceneAlpha: number,
  margin: number,
  width: number,
  height: number,
): FrameOp | null => {
  switch (layer.kind) {
    case "text":
      return textOp(layer, margin, state, sceneAlpha, width, height);
    case "shape":
      return shapeOp(layer, margin, state, sceneAlpha, height);
    case "image":
      return imageOp(layer, margin, state, sceneAlpha, height);
    case "caption":
      return captionOp(layer, state, sceneAlpha, width, height);
    case "progress":
      return progressOp(layer, state, sceneAlpha, width, height);
    case "period-origin":
      return periodOp(
        layer,
        measure,
        sceneStartMs,
        localMs,
        state,
        sceneAlpha,
        width,
        height,
      );
  }
};

/** Slide offset magnitude for a scene mid-transition. */
const sceneSlide = (scene: Scene, sceneAlpha: number, height: number) => {
  const offset = transitionOffset(scene.transition, height);
  if (offset.x === 0 && offset.y === 0) return { x: 0, y: 0 };
  const travel = 1 - sceneAlpha;
  return { x: offset.x * travel, y: offset.y * travel };
};

/**
 * Resolve the complete frame at `timeMs`.
 *
 * The hot path. One op array per frame, no I/O, no timers, no accumulation —
 * so a renderer can call it tens of thousands of times per second, and can
 * call it out of order without the result changing.
 */
export const seek = (
  composition: Composition,
  timeMs: number,
  options: SeekOptions = {},
): RenderFrame => {
  const measure = options.measure ?? defaultMeasure;
  const width = composition.width;
  const height = compositionHeight(composition);
  const margin = marginOf(width);

  const active = scenesInProgress(composition, timeMs);
  const lead = active[0];
  const background = lead?.scene.background ?? composition.palette.paper;

  const ops: FrameOp[] = [];

  for (const resolved of active) {
    const { scene, localMs, startMs } = resolved;
    // Only a scene that is *also* on its way out fades; the incoming scene is
    // always fully opaque, otherwise every cut would dip through black.
    const sceneAlpha =
      active.length > 1 ? transitionProgress(scene, localMs) : 1;
    if (sceneAlpha <= 0.001) continue;

    const slide = sceneSlide(scene, sceneAlpha, height);

    for (const layer of scene.layers) {
      const state = resolveWindow(layer, localMs);
      if (!state.visible) continue;
      if (state.opacity * sceneAlpha <= 0.001) continue;

      const op = resolveLayer(
        layer,
        measure,
        startMs,
        localMs,
        state,
        sceneAlpha,
        margin,
        width,
        height,
      );
      if (!op) continue;

      if (slide.x !== 0 || slide.y !== 0) {
        // The period-origin op stores its box as `originX` (the wordmark's left
        // edge, offset by the anchor distance) rather than a plain `x`, so it
        // needs its own shift or the wordmark would freeze while the scene
        // slides around it.
        if (op.kind === "period-origin") {
          op.originX += slide.x;
          op.centreX += slide.x;
          op.y += slide.y;
          op.centreY += slide.y;
        } else {
          op.x += slide.x;
          op.y += slide.y;
        }
      }
      ops.push(op);
    }
  }

  ops.sort((a, b) => a.z - b.z);

  return { timeMs, width, height, background, ops };
};

/**
 * Progress of a scene's transition, re-exported so renderers building custom
 * timelines do not have to import two modules for one number.
 */
export { easedProgress, MOTION_EASE };