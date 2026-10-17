/**
 * Arabic typography for the motion studio.
 *
 * ## Why this module exists
 *
 * Kinetic typography — characters arriving one at a time — is only correct in
 * Arabic if it operates on *clusters* and in *reading order*. Both are easy to
 * get wrong in ways that look almost right:
 *
 *  - Splitting on `String.split("")` breaks every word. Arabic letters carry
 *    combining marks (tashkīl) that must stay welded to their base letter; a
 *    bare "by code unit" split separates a fatha or shadda from its letter and
 *    the shadda renders as a stray floating mark.
 *  - Revealing characters left-to-right looks wrong because Arabic is read
 *    right-to-left. The reveal has to walk the *visual* order, which is the
 *    reverse of the logical string, while the shaping engine still expects
 *    logical order as input.
 *
 * So this module separates three things that are easy to conflate:
 *
 *   1. **clusters** — the smallest indivisible visual unit (base + marks),
 *   2. **logical order** — what the author types, which shaping requires,
 *   3. **visual order** — left-to-right painting order, which is reversed for
 *      RTL runs and drives reveal direction.
 *
 * ## Fonts
 *
 * Only fonts that actually ship with NASAQ are used: **Tajawal** (display)
 * and **Noto Naskh Arabic** (prose), served from `public/fonts/motion/`.
 * The composition exporter inlines those exact files, so an exported
 * composition is self-contained and renders identically with no network.
 * Naming a face that is not bundled would silently fall back to a system font
 * and break the layout — so there are only two.
 */

import { hasArabic, normalizeArabic, toArabicDigits } from "../editor/arabic.ts";

/**
 * Fonts for motion compositions.
 *
 * These follow the type roles the NASAQ media system already documents —
 * **Tajawal** for display and wordmarks, **Noto Naskh Arabic** for prose —
 * and the four TTFs are served from `public/fonts/motion/`.
 *
 * Why not just reuse the site's web fonts (Alexandria, IBM Plex Sans Arabic)?
 * Both render Arabic correctly *in a browser*, so it would be reasonable to
 * stop there. But they are shipped as `woff2`, and the Node canvas used by the
 * offline renderer cannot read woff2 — and when it is fed the decomposed
 * subsets anyway, it picks a single face per family with no per-glyph
 * fallback, so a full stop renders as a tofu box. That was observed in real
 * frames, not anticipated.
 *
 * Using complete TTFs fixes the renderer and matches the documented art
 * direction at the same time. The stacks below still name the web fonts as
 * fallbacks, so if the motion fonts ever fail to load the composition still
 * renders Arabic correctly rather than falling back to a Latin face.
 */
export const DISPLAY_FONT = "Tajawal";
export const SANS_FONT = "Noto Naskh Arabic";

/** CSS `font-family` stacks, with the site web fonts as a safety net. */
export const DISPLAY_STACK = `"Tajawal", "Alexandria", system-ui, sans-serif`;
export const SANS_STACK = `"Noto Naskh Arabic", "IBM Plex Sans Arabic", system-ui, sans-serif`;

export type TypeRole = "display" | "caption" | "wordmark";

/** Resolve the font stack for a typographic role. */
export const fontForRole = (role: TypeRole): string =>
  role === "display" || role === "wordmark" ? DISPLAY_STACK : SANS_STACK;

/**
 * Combining marks and tatweel that must never be split from their base letter.
 *
 * Covers Arabic diacritics, Quranic annotation marks, and the tatweel (kashida)
 * that the document editor itself inserts for justified prose.
 */
const COMBINING =
  /[ؐ-ًؚ-ٰٟۖ-ۭـ‏‫-‮]/;

/**
 * Split text into grapheme clusters: a base character plus any following
 * combining marks.
 *
 * Uses `Intl.Segmenter` where available (it handles the full UAX #29 grapheme
 * rules, including emoji ZWJ sequences) and falls back to a combining-mark
 * scan otherwise. Both paths return logical order.
 */
export const splitClusters = (text: string): string[] => {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ar", { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  const clusters: string[] = [];
  for (const char of text) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && COMBINING.test(char)) {
      clusters[clusters.length - 1] = last + char;
    } else {
      clusters.push(char);
    }
  }
  return clusters;
};

/** True when a cluster is only marks — it has no base letter of its own. */
export const isMarkCluster = (cluster: string): boolean =>
  COMBINING.test(cluster[0] ?? "") && cluster.trim().length > 0;

/** Direction of a text run, as the renderer must lay it out. */
export type RunDirection = "rtl" | "ltr";

/** Resolve the base direction of a line from its content. */
export const runDirection = (text: string): RunDirection =>
  hasArabic(text) ? "rtl" : "ltr";

/**
 * Painting order for a run.
 *
 * For RTL the visual order is the reverse of the logical order. Spaces and the
 * punctuation that binds them are kept attached to their neighbour so a
 * trailing or leading space does not jump to the wrong end when reversed.
 */
export const visualOrder = (text: string): string[] => {
  const clusters = splitClusters(text);
  if (runDirection(text) === "ltr") return clusters;
  return clusters
    .map((cluster, index) => ({ cluster, index }))
    .reverse()
    .map((entry) => entry.cluster);
};

/** Logical-order indices, in the order they should be revealed. */
export const revealOrder = (text: string): number[] => {
  const total = splitClusters(text).length;
  const order: number[] = [];
  for (let i = total - 1; i >= 0; i -= 1) order.push(i);
  return order;
};

/**
 * How many clusters are visible at `progress` (0–1) for a staggered reveal.
 *
 * `stagger` is the per-cluster interval as a fraction of the window; 0 means
 * "all at once". The result is quantised to whole clusters, because a
 * half-visible Arabic letter with a detached mark is worse than a hard step —
 * it is exactly the artefact that makes Arabic motion-blur look broken.
 *
 * `progress` is 0–1 across the **enter phase** and `enterSeconds` is that
 * phase's real duration. `stagger` is the authored gap in seconds between the
 * first and last cluster. These must agree on units: mixing normalised
 * progress with a seconds-derived step silently pins every reveal to a single
 * cluster, which is how this shipped broken.
 */
export const revealedCount = (
  clusterCount: number,
  progress: number,
  stagger = 0.06,
  enterSeconds = 1,
): number => {
  if (clusterCount <= 0) return 0;
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return 0;
  if (stagger <= 0) return clusterCount;
  // Spread the clusters across the enter phase, leaving the authored stagger as
  // the gap between the first and the last one, so the final cluster lands
  // exactly as the enter phase completes.
  const duration = Math.max(0, enterSeconds);
  const span = Math.max(0, duration - stagger);
  const perCluster =
    clusterCount > 1 ? span / (clusterCount - 1) : Math.max(duration, stagger);
  const elapsed = p * duration;
  const shown =
    perCluster > 0 ? Math.floor(elapsed / perCluster) : clusterCount - 1;
  return Math.max(1, Math.min(clusterCount, shown + 1));
};

/**
 * Prepare authored text for rendering.
 *
 * Applies the same normalisation the document editor applies, so a line typed
 * into a motion template renders with the same tashkīl, punctuation and
 * numeral handling as the same line typed into a report page. One product, one
 * text pipeline.
 */
export const prepareText = (
  text: string,
  options: { numerals?: "western" | "arabic" | "none" } = {},
): string => {
  const { numerals = "none" } = options;
  const normalized = normalizeArabic(text);
  return numerals === "none" ? normalized : toArabicDigits(normalized);
};

/** Split a caption into short beats, preferring natural Arabic punctuation. */
export const splitBeats = (text: string, maxChars = 42): string[] => {
  const parts = text
    .split(/(?<=[\.\n،؛!؟])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    // No usable punctuation — fall back to word wrapping so a long caption
    // still breaks somewhere sensible instead of running off the frame.
    const words = text.split(/\s+/).filter(Boolean);
    const beats: string[] = [];
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > maxChars) {
        beats.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) beats.push(line);
    return beats;
  }

  // A punctuated part may still exceed one beat; wrap it too.
  const out: string[] = [];
  for (const part of parts) {
    if (part.length <= maxChars) {
      out.push(part);
      continue;
    }
    const words = part.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      if (line && (line + " " + word).length > maxChars) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
};

/** Base direction CSS value for a container. */
export const dirAttribute = (text: string): RunDirection => runDirection(text);