/**
 * Canvas2D rendering for a resolved {@link RenderFrame}.
 *
 * ## One renderer, two consumers
 *
 * This module draws a frame onto any Canvas2D-compatible context. It is used
 * by:
 *
 *  - the **live preview** in the Motion Studio (a browser `<canvas>`), and
 *  - the **offline render script** (`scripts/render-motion.mjs`, a Node
 *    canvas).
 *
 * That sharing is the point. A preview drawn by one implementation and an
 * export drawn by another is the classic way a video product ships a preview
 * that looks right and an exported file that does not. Here they cannot
 * differ, because they call the same code with the same frame.
 *
 * ## Arabic handling
 *
 * The context is put into RTL mode and text is drawn cluster by cluster rather
 * than as one reversed string. Clusters keep their combining marks welded to
 * their base letter, which is the only ordering in which an Arabic reveal
 * animates correctly.
 *
 * **A note on measurement**: this module does not measure. Geometry comes from
 * `seek()`, which takes an injected measure function. In the browser that is a
 * canvas-backed `measureText`; in the render script it is the Node canvas.
 * Keeping measurement out of here is what lets a test assert geometry without
 * a canvas at all.
 */

import { mixRgb } from "./color.ts";
import type { FrameOp, RenderFrame } from "./render-frame.ts";

/** The subset of Canvas2D this module needs. */
export interface CanvasLike {
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    start: number,
    end: number,
    counterclockwise?: boolean,
  ): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  rect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  direction: CanvasDirection;
}

export interface RenderContext {
  ctx: CanvasLike;
  /** Frame pixel size. */
  width: number;
  height: number;
}

/** Font shorthand, matching the CSS the HTML exporter emits. */
const fontString = (
  family: string,
  weight: number,
  size: number,
): string => `${weight} ${size}px ${family}`;

/**
 * Draw a frame.
 *
 * The background is filled first, then every op in z order. Opacity is applied
 * with `globalAlpha` inside a save/restore pair so it can never leak into a
 * sibling — the single most common cause of a layer painting at the wrong
 * strength.
 */
export const renderFrame = (target: CanvasLike, frame: RenderFrame): void => {
  target.save();
  target.globalAlpha = 1;
  target.fillStyle = frame.background;
  target.fillRect(0, 0, frame.width, frame.height);

  for (const op of frame.ops) {
    if (op.opacity <= 0.001) continue;
    target.save();
    target.globalAlpha = op.opacity;
    drawOp(target, op);
    target.restore();
  }
  target.restore();
};

const drawOp = (ctx: CanvasLike, op: FrameOp): void => {
  switch (op.kind) {
    case "rect":
      drawRect(ctx, op);
      return;
    case "text":
      drawText(ctx, op);
      return;
    case "caption":
      drawCaption(ctx, op);
      return;
    case "progress":
      drawProgress(ctx, op);
      return;
    case "period-origin":
      drawPeriodOrigin(ctx, op);
      return;
    case "image":
      // Image drawing needs a decoded bitmap, which is environment-specific;
      // the built-in templates use no raster layers.
      return;
  }
};

const drawRect = (ctx: CanvasLike, op: Extract<FrameOp, { kind: "rect" }>): void => {
  ctx.fillStyle = op.fill;
  ctx.beginPath();
  if (op.radius > 0) {
    roundedPath(ctx, op.x, op.y, op.width, op.height, op.radius);
  } else {
    ctx.rect(op.x, op.y, op.width, op.height);
  }
  ctx.fill();
  if (op.stroke && op.strokeWidth) {
    ctx.strokeStyle = op.stroke;
    ctx.lineWidth = op.strokeWidth;
    ctx.stroke();
  }
};

/**
 * Rounded-rect path.
 *
 * Clamped to half the shorter side — a radius larger than that produces the
 * self-intersecting path that renders as a solid blob.
 */
const roundedPath = (
  ctx: CanvasLike,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void => {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, (Math.PI * 3) / 2);
  ctx.closePath();
};

/** Alignment resolved to a canvas textAlign value for the run direction. */
const alignFor = (
  align: "start" | "center" | "end",
  direction: "rtl" | "ltr",
): CanvasTextAlign => {
  if (align === "center") return "center";
  const natural = align === "start" ? "start" : "end";
  void natural;
  // In an RTL run "start" is the right edge, which canvas expresses as "right".
  if (align === "start") return direction === "rtl" ? "right" : "left";
  return direction === "rtl" ? "left" : "right";
};

/**
 * Kinetic text.
 *
 * ## Why this does NOT draw cluster by cluster
 *
 * The obvious implementation — measure each cluster and place it individually
 * — is **wrong for Arabic**, and visibly so. Arabic letters are contextual:
 * a letter's rendered form depends on the letters either side of it (initial,
 * medial, final, isolated). Drawing clusters separately forces every letter
 * into its isolated form, so «نَسَق» renders as four disconnected glyphs
 * instead of one connected word. It also breaks RTL placement, because the
 * first character in reading order is the *rightmost* one.
 *
 * Both problems were confirmed by rendering real frames.
 *
 * ## What this does instead
 *
 * The reveal is expressed as a **prefix of the logical string**, drawn as a
 * single `fillText` call so the shaper still performs contextual joining:
 *
 *  - `fade` — the full string is drawn faintly, then the revealed prefix at
 *    full strength. Two draw calls, both correctly shaped.
 *  - everything else — the full string is drawn once, **clipped** to the width
 *    the revealed prefix occupies. One draw call, so joining is untouched,
 *    and the clip edge is the animation.
 *
 * The clip is anchored on the correct side for the direction: in RTL the
 * revealed prefix sits against the right edge, so the clip window grows
 * leftward.
 */
const drawText = (ctx: CanvasLike, op: Extract<FrameOp, { kind: "text" }>): void => {
  if (op.revealed <= 0) return;

  ctx.font = fontString(op.fontFamily, op.fontWeight, op.fontSize);
  ctx.direction = op.direction;
  ctx.textBaseline = "top";
  ctx.fillStyle = op.color;

  const align = alignFor(op.align, op.direction);
  ctx.textAlign = align;

  const fullWidth = ctx.measureText(op.text).width;
  const shownText = op.clusters.slice(0, op.revealed).join("");
  const shownWidth = ctx.measureText(shownText).width;

  // `anchorX` is resolved in `seek()` because only the frame knows its width
  // and RTL "start" is the *right* margin. Re-deriving it here is how the
  // headline ends up off-screen.
  const anchorX = op.anchorX;

  const rtl = op.direction === "rtl";

  // Leading-edge motion for the `rise` reveal: the block eases up into place
  // as the layer's own opacity rises. Derived from opacity rather than carried
  // as extra state so the renderer stays a pure function of the op.
  const offsetY = op.reveal === "rise" ? (1 - op.opacity) * op.fontSize * 0.3 : 0;

  if (op.reveal === "fade") {
    ctx.globalAlpha = 0.22;
    ctx.fillText(op.text, anchorX, op.y + offsetY);
    ctx.globalAlpha = op.opacity;
    ctx.fillText(shownText, anchorX, op.y + offsetY);
    ctx.globalAlpha = 1;
  } else {
    const lineHeight =
      op.fontSize * op.lineHeight + Math.abs(offsetY) + op.fontSize;
    ctx.save();
    ctx.beginPath();
    if (rtl) {
      // Revealed prefix hugs the right edge; the window grows leftward.
      ctx.rect(anchorX - shownWidth, op.y - op.fontSize, shownWidth + 2, lineHeight);
    } else {
      ctx.rect(anchorX - 2, op.y - op.fontSize, shownWidth + 4, lineHeight);
    }
    ctx.clip();
    ctx.fillText(op.text, anchorX, op.y + offsetY);
    ctx.restore();
  }

  if (op.rule) {
    ctx.fillStyle = op.rule.color;
    const ruleWidth = Math.min(fullWidth, 260);
    // Follow the run's alignment: inline-start edge when it hugs a margin,
    // centred under the run otherwise. Anchoring by `rtl` alone leaves the
    // rule hanging off to one side under a centred wordmark.
    const ruleX =
      op.align === "center"
        ? anchorX - ruleWidth / 2
        : rtl
          ? anchorX - fullWidth
          : anchorX;
    ctx.fillRect(
      ruleX,
      op.y + op.fontSize * op.lineHeight + op.rule.gap,
      ruleWidth,
      op.rule.thickness,
    );
  }
};

const drawCaption = (
  ctx: CanvasLike,
  op: Extract<FrameOp, { kind: "caption" }>,
): void => {
  ctx.font = fontString(op.fontFamily, op.fontWeight, op.fontSize);
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  const width = ctx.measureText(op.text).width;
  if (op.plate) {
    const pad = op.plate.padding;
    ctx.fillStyle = op.plate.color;
    ctx.beginPath();
    roundedPath(
      ctx,
      op.anchorX - width - pad,
      op.y - pad,
      width + pad * 2,
      op.fontSize * 1.6 + pad * 2,
      op.plate.radius,
    );
    ctx.fill();
  }
  ctx.fillStyle = op.color;
  ctx.fillText(op.text, op.anchorX, op.y);
};

const drawProgress = (
  ctx: CanvasLike,
  op: Extract<FrameOp, { kind: "progress" }>,
): void => {
  ctx.fillStyle = op.trackColor;
  ctx.beginPath();
  roundedPath(ctx, op.x, op.y, op.width, op.height, op.height / 2);
  ctx.fill();

  const filled = op.width * Math.max(0, Math.min(1, op.value));
  if (filled > 0) {
    ctx.fillStyle = op.color;
    ctx.beginPath();
    roundedPath(ctx, op.x + op.width - filled, op.y, filled, op.height, op.height / 2);
    ctx.fill();
  }

  if (op.label) {
    ctx.font = fontString(`"IBM Plex Sans Arabic", sans-serif`, 600, op.labelFontSize);
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = op.labelColor;
    ctx.fillText(op.label, op.x + op.width, op.y - op.height);
  }
};

/**
 * The period-origin effect.
 *
 * Draws the inner world through a circular clip anchored at the wordmark's
 * period, then the wordmark itself with its ink crossfaded on the same eased
 * value. The world is drawn at the clip centre rather than the canvas centre,
 * which is what makes the closing iris stay locked to the CTA dot instead of
 * sliding off it.
 */
const drawPeriodOrigin = (
  ctx: CanvasLike,
  op: Extract<FrameOp, { kind: "period-origin" }>,
): void => {
  // Inner world first, clipped to the iris.
  ctx.save();
  ctx.beginPath();
  ctx.arc(op.centreX, op.centreY, Math.max(op.radius, 0.001), 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = op.inner.background;
  ctx.fillRect(
    op.centreX - op.radius,
    op.centreY - op.radius,
    op.radius * 2,
    op.radius * 2,
  );

  const beats = op.inner.beats ?? [];
  const beat = op.beatIndex >= 0 ? beats[op.beatIndex] : null;
  if (beat && op.radius > 24) {
    ctx.font = fontString(
      `"Alexandria", sans-serif`,
      700,
      op.inner.titleFontSize ?? op.fontSize * 0.3,
    );
    ctx.direction = "rtl";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = op.inner.titleColor ?? "#ffffff";
    ctx.fillText(beat.text, op.centreX, op.centreY, op.radius * 1.6);
  }
  ctx.restore();

  // The wordmark, with the ink crossfade riding the iris radius.
  ctx.font = fontString(op.fontFamily, op.fontWeight, op.fontSize);
  ctx.direction = "rtl";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const maxR = Math.max(op.radius, 1);
  ctx.fillStyle = mixRgb(op.color, op.innerColor, op.radius > 0 ? op.radius / maxR : 0);
  ctx.fillText(op.wordmark, op.originX, op.y);
};