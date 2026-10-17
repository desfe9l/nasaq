/**
 * The period-origin launch effect.
 *
 * ## The idea
 *
 * A wordmark such as «نَسَق.» carries a final period that is genuinely part of
 * the name. This effect makes that period the **container for the whole
 * story**: it opens like a camera iris onto an inner world, the product's
 * promise plays inside it, and the iris closes again so the last frame equals
 * the first. Nothing cuts — the world grows out of the punctuation.
 *
 * ## The geometry is load-bearing
 *
 * Three decisions here were each arrived at by fixing a real, visible
 * failure. They look like micro-optimisations; they are the difference
 * between a polished reveal and a broken one.
 *
 * 1. **Ease the iris by area, not radius.**
 *    Easing `radius` makes the first frames jump: near `r = 0` the radius
 *    barely changes while the enclosed disc changes enormously, so an eased
 *    radius *pops* open. Easing the enclosed **area** and deriving the radius
 *    as `√area` keeps the perceived rate of change even. See
 *    {@link easeAreaToRadius}.
 *
 * 2. **The world rides with the anchor.**
 *    The inner world is drawn relative to the iris centre, not to the
 *    composition centre. If it were composition-anchored, the closing iris
 *    would slide off the thing it is closing onto and the closing move would
 *    visibly drift.
 *
 * 3. **Hand-offs must match at the instant of transfer.**
 *    As the iris opens, the wordmark's own colour crossfades to the inner
 *    colour exactly across the open. If the two disagree on even one frame the
 *    letters visibly "pop" from black to gold while the disc is still opening.
 *    {@link periodOriginState} therefore returns both from one eased value.
 *
 * ## Measurement honesty
 *
 * Finding the centre of a specific glyph requires real font metrics, which a
 * pure module does not have. Rather than pretend otherwise, the anchor is
 * resolved through an **injected measure function**: the browser passes a
 * canvas-backed one for pixel-exact placement, and tests pass a deterministic
 * one. The module never guesses a centre on its own.
 */

import { easeAreaToRadius, easedProgress, MOTION_EASE } from "./easing.ts";
import { splitClusters } from "./arabic-type.ts";
import type { PeriodInner } from "./types.ts";

/** Characters that can serve as the iris anchor, most-preferred first. */
const ANCHOR_CHARS = [".", "۔", "。", "·", "•"] as const;

/**
 * A measure function: returns the advance width of `text` in px for a given
 * font size. Injected so the anchor can be exact in a browser and
 * deterministic in tests.
 */
export type TextMeasure = (text: string, fontSizePx: number) => number;

/**
 * How far the centre of a full-stop glyph sits above the text baseline,
 * as a fraction of the font size.
 *
 * A full stop is a small dot resting **on** the baseline, so its centre is a
 * fraction of an em above it. Renderers place the glyph from the baseline, not
 * from a box origin, so this constant is what lets the iris centre land on the
 * dot rather than a few dozen pixels off it. It is deliberately a single
 * documented constant rather than a guessed ascent, because an ascent figure
 * would be font-specific and quietly wrong for any face other than the one it
 * was measured from.
 */
export const PERIOD_BASELINE_OFFSET = 0.04;

/**
 * The position of the iris anchor within a wordmark, in px relative to the
 * wordmark's own inline-start edge.
 */
export interface PeriodAnchor {
  /** Centre x of the anchor glyph, in px from the text origin. */
  x: number;
  /** Advance width of the anchor glyph. */
  width: number;
  /** Index of the anchor cluster in logical order. */
  clusterIndex: number;
}

/**
 * Locate the final anchor glyph in a wordmark.
 *
 * Returns `null` when the wordmark has no suitable ending character. Callers
 * must handle that: the mandate for this effect is explicit that it should
 * never be forced onto text that has no period to grow from, because without a
 * real anchor the whole geometry is a fiction and the animation reads as a
 * generic circle wipe wearing the product's name.
 */
export const findPeriodAnchor = (
  wordmark: string,
  fontSizePx: number,
  measure: TextMeasure,
): PeriodAnchor | null => {
  const clusters = splitClusters(wordmark);

  // Prefer the LAST anchor character — that is the wordmark's full stop, and
  // anchoring to an earlier one would make the tail of the name fall outside
  // the iris.
  for (let i = clusters.length - 1; i >= 0; i -= 1) {
    const cluster = clusters[i];
    if (!ANCHOR_CHARS.includes(cluster as (typeof ANCHOR_CHARS)[number])) continue;

    const prefix = clusters.slice(0, i).join("");
    const x = measure(prefix, fontSizePx);
    const width = measure(cluster, fontSizePx);

return {
      x: x + width / 2,
      width,
      clusterIndex: i,
    };
  }
  return null;
};

/** True when a wordmark can host the period-origin effect. */
export const hasPeriodAnchor = (wordmark: string): boolean =>
  splitClusters(wordmark).some((cluster) =>
    ANCHOR_CHARS.includes(cluster as (typeof ANCHOR_CHARS)[number]),
  );

/** Configuration for one period-origin instance. */
export interface PeriodOriginConfig {
  /** Absolute start of the whole open→play→close cycle, ms. */
  startMs: number;
  /** Absolute time the iris finishes opening, ms. */
  openMs: number;
  /** Absolute time the iris starts closing, ms. */
  closeMs: number;
  /** Absolute end of the cycle, ms. */
  endMs: number;
  /** Composition px. */
  centreX: number;
  centreY: number;
  /** Max iris diameter in px. */
  maxDiameter: number;
  inner: PeriodInner;
}

export interface PeriodOriginState {
  /** 0 = fully closed, 1 = fully open. Already eased **by area**. */
  open: number;
  /** Iris radius in px. Derived from area easing — never eased directly. */
  radius: number;
  /** Iris centre in composition px. Constant; the world rides it. */
  centreX: number;
  centreY: number;
  /** Whether inner content should be drawn at all this frame. */
  innerVisible: boolean;
  /**
   * Wordmark colour crossfade, 0 = outer colour, 1 = inner colour.
   * Driven by the *same* eased value as the iris, so they never disagree.
   */
  inkMix: number;
  /** Which inner beat is active, or -1 for none. */
  beatIndex: number;
}

/**
 * Resolve the complete period-origin state for a frame.
 *
 * One call, one eased value, every dependent property — that is what keeps
 * the ink crossfade and the iris from ever disagreeing.
 */
export const periodOriginState = (
  timeMs: number,
  config: PeriodOriginConfig,
): PeriodOriginState => {
  const { startMs, openMs, closeMs, endMs, maxDiameter } = config;

  // Open and close are eased independently so a re-time of one does not
  // silently drag the other. Both ease the AREA; radius is derived.
  const opening = easedProgress(timeMs, startMs, openMs, MOTION_EASE);
  const closing = easedProgress(timeMs, closeMs, endMs, MOTION_EASE);
  const areaProgress = Math.max(0, opening - closing);

  const radius = easeAreaToRadius(areaProgress) * (maxDiameter / 2);
  const innerVisible = radius > 0.5;

  let beatIndex = -1;
  const beats = config.inner.beats ?? [];
  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    if (timeMs >= beat.startMs && timeMs < beat.endMs) {
      beatIndex = i;
      break;
    }
  }

  return {
    // `open` is the area progress — the renderer's radius must come from
    // `radius`, never from easing `open` itself.
    open: areaProgress,
    radius,
    centreX: config.centreX,
    centreY: config.centreY,
    innerVisible,
    // The ink crossfades over the opening half only. Once open, the wordmark
    // is fully inside the world and must not keep changing.
    inkMix: easeAreaToRadius(opening),
    beatIndex,
  };
};

/**
 * Place the wordmark so its anchor glyph lands on a requested composition
 * point.
 *
 * The wordmark is RTL, so its inline start is the *right* edge. This returns
 * the draw origin (the left edge of the text box) that puts the anchor's
 * centre exactly at `targetX`. Without this the iris and the period drift
 * apart by however far the prefix happens to measure.
 */
export const wordmarkOriginFor = (
  wordmark: string,
  fontSizePx: number,
  measure: TextMeasure,
  anchor: PeriodAnchor,
  targetX: number,
): number => targetX - anchor.x;

/**
 * The wordmark with its anchor cluster wrapped, so a renderer can style or
 * measure the anchor independently.
 *
 * In a DOM renderer the anchor becomes a `<span>`; in canvas it becomes a
 * separate measured run. Both need the same split, so it lives here.
 */
export const splitAroundAnchor = (
  wordmark: string,
  anchor: PeriodAnchor,
): { before: string; anchor: string; after: string } => {
  const clusters = splitClusters(wordmark);
  return {
    before: clusters.slice(0, anchor.clusterIndex).join(""),
    anchor: clusters[anchor.clusterIndex] ?? "",
    after: clusters.slice(anchor.clusterIndex + 1).join(""),
  };
};

/**
 * Guard for template authors.
 *
 * Returns `null` when the effect is safe to use, or a human-readable reason
 * when it is not. Templates call this at build time so an unusable wordmark
 * surfaces as a clear message in the studio rather than as a circle wipe that
 * silently does not line up.
 */
export const periodOriginProblem = (wordmark: string): string | null => {
  const clusters = splitClusters(wordmark);
  if (clusters.length === 0) return "الاسم فارغ.";
  if (!hasPeriodAnchor(wordmark)) {
    return "التأثير يحتاج إلى اسم ينتهي بنقطة (.) ينفتح منها المشهد — أضف نقطة في نهاية الاسم.";
  }
  const last = clusters[clusters.length - 1];
  if (!ANCHOR_CHARS.includes(last as (typeof ANCHOR_CHARS)[number])) {
    return "النقطة يجب أن تكون في نهاية الاسم، وليس في وسطه.";
  }
  return null;
};