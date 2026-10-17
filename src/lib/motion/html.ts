/**
 * Export a NASAQ motion composition as a self-contained, seekable HTML file.
 *
 * ## What this produces
 *
 * A single `.html` file that is simultaneously:
 *
 *  - **a HyperFrames-compatible composition** — correct root attributes,
 *    `class="clip"` clips, unique ids, seconds-based timing, no `<template>`
 *    wrapper on a standalone root; and
 *  - **a fully self-contained artifact** — fonts inlined as data URIs, no
 *    module imports, no network access at render time.
 *
 * That combination is the point. A rendered video is produced from this one
 * file with nothing else present, so anything left external would simply fail
 * at render time on the frame that needs it.
 *
 * ## The rules this implements (and why)
 *
 * The HyperFrames authoring contract states several requirements that are easy
 * to violate accidentally. Each is handled explicitly below:
 *
 *  - `data-start` / `data-duration` are in **seconds**. The engine works in
 *    milliseconds, so every value is converted once, here.
 *  - The visibility window is **half-open** `[start, start + duration)`. A
 *    clip ending exactly at the root duration would never render its final
 *    state, so clip ends are pulled in by a small epsilon.
 *  - The **root `data-duration` is authoritative** and is read at compile
 *    time, so it must be a static literal in the markup — never assigned by
 *    script.
 *  - A standalone root sits **directly in `<body>`**. Wrapping it in a
 *    `<template>` hides all content and fails lint.
 *  - Every `id` must be **unique across the assembled document**.
 *  - Root-level clips get automatic layout; untimed elements need their own
 *    absolute positioning.
 *
 * ## Determinism
 *
 * No clocks, no `Math.random()`, no network. The embedded runtime is a pure
 * function of `(composition, t)`.
 */

import { MOTION_RUNTIME_JS } from "./html-runtime.ts";
import {
  compositionDuration,
  compositionHeight,
  type Composition,
  type Scene,
} from "./types.ts";

/**
 * Epsilon applied to every clip end, in ms.
 *
 * One frame at 30fps. Large enough that a float rounding cannot eat the final
 * state, small enough to be invisible.
 */
const CLIP_EPSILON_MS = 16;

export interface FontSource {
  family: string;
  weight: number;
  /** A `url(...)` value — a data URI for a truly self-contained file. */
  src: string;
}

export interface EmitOptions {
  /** Fonts to inline. Data URIs keep the file renderable offline. */
  fonts?: FontSource[];
  /** Composition title, used in `<title>`. */
  title?: string;
  /** Extra author notes embedded as an HTML comment. */
  notes?: string;
}

/** Seconds, with enough precision to avoid accumulating ms→s rounding drift. */
const seconds = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(4);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Serialise data for embedding inside a `<script>` element.
 *
 * `JSON.stringify` alone is **not** safe here. It escapes quotes and
 * backslashes but leaves `<`, `>` and `&` untouched, so any authored text
 * containing `</script>` terminates the element early and the remainder is
 * parsed as markup. Since scene names and captions are author-supplied, that
 * is a real injection path into a file that gets written to disk and opened
 * locally — not a theoretical one.
 *
 * Escaping `<` as `<` neutralises the tag terminator while keeping the
 * value byte-identical once JS parses it. U+2028/U+2029 are escaped too: they
 * are literal line terminators in older JS grammars and would otherwise be a
 * syntax error inside a string.
 */
const jsonForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

/**
 * Every clip the composition will draw, with absolute timings.
 *
 * The exporter emits one `class="clip"` element per scene so the timeline is
 * legible and editable in Studio — a clip whose time window matches the scene
 * it belongs to. The runtime's `applyFrame` owns the per-frame geometry, so
 * these are the structural skeleton rather than the animation itself.
 */
export const compositionClips = (
  composition: Composition,
): Array<{
  id: string;
  scene: Scene;
  index: number;
  startMs: number;
  endMs: number;
}> => {
  const clips: Array<{
    id: string;
    scene: Scene;
    index: number;
    startMs: number;
    endMs: number;
  }> = [];
  let cursor = 0;
  composition.scenes.forEach((scene, index) => {
    const end = cursor + scene.durationMs;
    clips.push({
      id: `${composition.id}-scene-${index}`,
      scene,
      index,
      startMs: cursor,
      // Pull the end in by one frame so the closing state is actually rendered.
      endMs: Math.max(cursor + 1, end - CLIP_EPSILON_MS),
    });
    cursor = end;
  });
  return clips;
};

/** Build the `@font-face` block. Omitted entirely when no fonts are supplied. */
const fontFaceCss = (fonts: FontSource[]): string => {
  if (fonts.length === 0) return "";
  return fonts
    .map(
      (font) => `@font-face{font-family:"${font.family}";font-style:normal;` +
        `font-weight:${font.weight};font-display:block;src:${font.src};}`,
    )
    .join("\n");
};

/**
 * The seekable runtime bootstrap.
 *
 * The timeline is registered **after** `document.fonts.ready` resolves. The
 * contract is explicit that registering the key before the build finishes is
 * treated as ready and renders blank — which is exactly the kind of failure
 * that looks like "the video is just black" with no error anywhere.
 */
const runtimeScript = (composition: Composition): string => `${MOTION_RUNTIME_JS}
;(function () {
  var composition = ${jsonForScript(composition)};
  var measureCtx = document.createElement("canvas").getContext("2d");
  function measure(text, size) {
    if (!measureCtx) return NasaqMotion.splitClusters(text).length * size * 0.5;
    measureCtx.font = "700 " + size + 'px "Alexandria", sans-serif';
    return measureCtx.measureText(text).width;
  }
  function boot() {
    NasaqMotion.createRuntime(composition, measure);
  }
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    document.fonts.ready.then(boot);
  } else {
    boot();
  }
})();`;

/**
 * Emit the standalone composition document.
 *
 * Pure and synchronous: it takes a composition plus already-resolved font
 * sources and returns the file. Fetching and base64-ing the fonts is the
 * caller's job, which keeps this module testable without a DOM or a network.
 */
export const emitCompositionHtml = (
  composition: Composition,
  options: EmitOptions = {},
): string => {
  const width = composition.width;
  const height = compositionHeight(composition);
  const totalMs = compositionDuration(composition);
  const clips = compositionClips(composition);
  const fonts = options.fonts ?? [];
  const title = options.title ?? composition.name;

  const fontCss = fontFaceCss(fonts);

  const clipMarkup = clips
    .map((clip) => {
      const durationMs = clip.endMs - clip.startMs;
      return `      <div id="${clip.id}" class="clip scene"\n` +
        `           data-start="${seconds(clip.startMs)}"\n` +
        `           data-duration="${seconds(durationMs)}"\n` +
        `           data-track-index="${clip.index}"\n` +
        `           aria-label="${escapeHtml(clip.scene.name)}"></div>`;
    })
    .join("\n");

  const notes = options.notes
    ? `\n<!-- ${options.notes.replace(/--+/g, "-")} -->\n`
    : "\n";

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${fontCss}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    background: #0b0f14;
    /* The stage is a fixed pixel frame; the page only centres it. */
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100%;
  }
  /* Standalone composition root: explicit pixel frame, relative, clipped.
     Never hardcode a different size here — data-width/data-height is the
     contract and the runtime stamps these pixels onto the root. */
  #root {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: ${composition.palette.ink};
    transform-origin: top left;
  }
  /* Root-level clips are laid out by the runtime; these rules only give a
     readable default before the first seek and keep Studio's lanes sane. */
  .clip { position: absolute; top: 0; left: 0; }
</style>
</head>
<body>
  <!--
    Composition root. Standalone shape: directly in <body>, NOT wrapped in a
    <template> — wrapping a standalone root hides all content and fails lint.
    data-duration is authoritative and is read at compile time, so it is a
    static literal here and is never assigned by script.
  -->
  <div id="root"
       data-root="true"
       data-composition-id="${escapeHtml(composition.id)}"
       data-width="${width}"
       data-height="${height}"
       data-duration="${seconds(totalMs)}"
       data-fps="${composition.fps}">
${clipMarkup}
  </div>
<script>
${runtimeScript(composition)}
</script>
</body>
</html>
${notes}`;
};

/**
 * Scale the stage to fit a viewport without ever changing the frame size.
 *
 * The composition is authored at a fixed pixel size and must *render* at that
 * size — scaling is a viewing convenience, so it is applied with a transform on
 * a wrapper rather than by rewriting the root's width.
 */
export const stageScaleScript = (): string => `(function(){
  var root = document.getElementById("root");
  if (!root) return;
  function fit() {
    var w = root.offsetWidth, h = root.offsetHeight;
    if (!w || !h) return;
    var s = Math.min(window.innerWidth / w, window.innerHeight / h, 1);
    root.style.transform = "scale(" + s + ")";
    document.body.style.margin = "0 auto";
  }
  window.addEventListener("resize", fit);
  fit();
})();`;