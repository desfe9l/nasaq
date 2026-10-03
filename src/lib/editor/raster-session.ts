import { imageLayout, normalizeCrop, type ImageCrop } from "./image-crop";
import { mmToPx } from "./render-units";
import {
  brushRadiusPx,
  mergeDirtyRect,
  stampDab,
  strokeSpacing,
  StrokeSmoother,
  walkSegment,
  type DabOptions,
  type RasterBuffer,
  type RectPx,
  type Rgb,
} from "./raster";
import type { CanvasEl } from "./model";

/**
 * The raster painting engine: brush strokes and erasing on real pixels.
 *
 * Root cause this replaces: "erase" used to walk the element list and delete
 * whatever the brush touched, so the eraser destroyed whole objects and the
 * brush did not exist at all. Both are pixel operations, and a pixel operation
 * must not re-render the document per pointermove — so this module keeps ONE
 * offscreen canvas holding the artwork, paints dabs into it while the pointer
 * moves, mirrors only the touched rectangles into an overlay canvas that the
 * author sees, and commits a single undoable `src` write when the stroke ends.
 *
 * Consequences that matter:
 *  · Nothing in the document store changes until pointerup (no autosave storm,
 *    no React render per frame, no history entry per dab).
 *  · The overlay canvas is imperative DOM owned by the session: a 120Hz Pencil
 *    never re-renders the editor shell.
 *  · Only dirty sub-rectangles are blitted, so cost scales with brush size, not
 *    with image size.
 *  · Erasing works in straight RGBA, so a PNG keeps real transparency.
 */

/** Raster density of a brand-new paint layer, in pixels per document mm. */
export const RASTER_LAYER_PX_PER_MM = 8;
/** Above this many pixels the working canvas is scaled down (keeps memory sane). */
export const MAX_RASTER_PIXELS = 16_000_000;

export interface RasterFrameMm {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface RasterTarget {
  el: CanvasEl;
  image: CanvasImageSource;
  source: { w: number; h: number };
}

export interface BeginRasterArgs {
  pageId: string;
  /** The artboard node the overlay is mounted into (mm coordinate space). */
  pageNode: HTMLElement;
  /** Screen pixels per document millimetre at the current zoom. */
  pxPerMm: number;
  mode: "brush" | "eraser";
  sizeMm: number;
  hardness: number;
  opacity: number;
  smoothing: number;
  color: Rgb;
  /** Existing artwork to paint into; `null` creates a new raster layer. */
  target: RasterTarget | null;
  /** Page size in mm — required for the blank-layer path. */
  page: { w: number; h: number };
  /** Element-local → page mm map (rotation/flip aware). Identity for new layers. */
  transform: { a: number; b: number; c: number; d: number; e: number; f: number };
}

export interface RasterCommitPatch {
  /** New bitmap for an existing element. */
  src?: string;
  /** Crop rebased when the bitmap had to be scaled down. */
  crop?: ImageCrop | undefined;
  /** Geometry + bitmap of a newly created layer. */
  layer?: { x: number; y: number; w: number; h: number; src: string };
}

interface Axis {
  /** Working-canvas px per document millimetre. */
  pxPerMm: number;
  /** Local mm at working px 0. */
  originLocalMm: number;
}

export function parseHexColor(value: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return { r: 17, g: 24, b: 39 };
  const int = parseInt(match[1]!, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

/** Working-canvas resolution scale for a source: 1, or smaller for huge art. */
export function rasterScaleFor(w: number, h: number): number {
  const pixels = Math.max(1, w) * Math.max(1, h);
  if (pixels <= MAX_RASTER_PIXELS) return 1;
  return Math.sqrt(MAX_RASTER_PIXELS / pixels);
}

/** Keep a crop window valid after the bitmap was resampled by `scale`. */
export function scaleCropFor(crop: ImageCrop | undefined, scale: number): ImageCrop | undefined {
  const normalized = normalizeCrop(crop);
  if (!normalized || scale === 1) return normalized;
  const round = (value: number, max: number) =>
    Math.min(max, Math.max(1, Math.round(value * scale)));
  const sourceW = Math.max(1, Math.round(normalized.sourceW * scale));
  const sourceH = Math.max(1, Math.round(normalized.sourceH * scale));
  const x = Math.min(sourceW - 1, Math.round(normalized.x * scale));
  const y = Math.min(sourceH - 1, Math.round(normalized.y * scale));
  return normalizeCrop({
    sourceW,
    sourceH,
    x,
    y,
    w: round(normalized.w, sourceW - x),
    h: round(normalized.h, sourceH - y),
  });
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * A live paint gesture.
 *
 * Lifecycle: construct → `paint()` per pointer sample → `commit()` | `cancel()`.
 * Nothing else in the editor needs to know a stroke is happening.
 */
export class RasterStroke {
  readonly pageId: string;
  readonly mode: "brush" | "eraser";
  readonly frame: RasterFrameMm;
  /** Element this stroke paints into, or null when it creates a new layer. */
  readonly elementId: string | null;

  private layer: HTMLCanvasElement;
  private layerCtx: CanvasRenderingContext2D;
  private buffer: RasterBuffer;
  private preview: HTMLCanvasElement | null = null;
  private previewHost: HTMLDivElement | null = null;
  private previewPxPerMm = mmToPx(1);
  private hiddenTargetImg: HTMLElement | null = null;
  private hiddenTargetPrevVisibility = "";
  private cursor: HTMLDivElement | null = null;
  private smoother: StrokeSmoother;
  private last: { x: number; y: number } | null = null;
  private scale: number;
  private axes: { x: Axis; y: Axis };
  private clip: RectPx | null;
  private pxPerMm: number;
  private target: RasterTarget | null;
  private touched = false;
  private pendingDirty: RectPx | null = null;
  private strokeMin = { x: Infinity, y: Infinity };
  private strokeMax = { x: -Infinity, y: -Infinity };
  private destroyed = false;
  private args: BeginRasterArgs;

  constructor(args: BeginRasterArgs) {
    this.args = args;
    this.pageId = args.pageId;
    this.mode = args.mode;
    this.target = args.target;
    this.elementId = args.target?.el.id ?? null;
    this.smoother = new StrokeSmoother(args.smoothing);
    this.pxPerMm = Math.max(0.1, args.pxPerMm);
    const el = args.target?.el ?? null;
    const source = args.target?.source ?? { w: 1, h: 1 };
    this.scale = args.target ? rasterScaleFor(source.w, source.h) : 1;

    const width = args.target
      ? Math.max(1, Math.round(source.w * this.scale))
      : Math.max(1, Math.round(args.page.w * RASTER_LAYER_PX_PER_MM));
    const height = args.target
      ? Math.max(1, Math.round(source.h * this.scale))
      : Math.max(1, Math.round(args.page.h * RASTER_LAYER_PX_PER_MM));

    if (args.target && el) {
      const fit =
        el.style.objectFit || (el.type === "logo" ? "contain" : "cover");
      const layout = imageLayout(
        el,
        source,
        el.style.crop,
        fit,
        el.style.objectX,
        el.style.objectY,
      );
      /*
       * `layout.scaleX/Y` is millimetres per source pixel, and working pixels
       * are source pixels × `scale` — so a millimetre is worth `scale / scaleX`
       * working pixels, and working pixel 0 sits at `layout.x - window.x·scaleX`.
       */
      this.axes = {
        x: {
          pxPerMm: this.scale / Math.max(1e-6, layout.scaleX),
          originLocalMm: layout.x - layout.window.x * layout.scaleX,
        },
        y: {
          pxPerMm: this.scale / Math.max(1e-6, layout.scaleY),
          originLocalMm: layout.y - layout.window.y * layout.scaleY,
        },
      };
      // Never paint outside the artwork the author can actually see: the
      // visible window ∩ the element frame, in working px.
      const visibleLeft = Math.max(0, layout.x);
      const visibleTop = Math.max(0, layout.y);
      const visibleRight = Math.min(el.w, layout.x + layout.w);
      const visibleBottom = Math.min(el.h, layout.y + layout.h);
      this.clip =
        visibleRight > visibleLeft && visibleBottom > visibleTop
          ? {
              x: (visibleLeft - this.axes.x.originLocalMm) * this.axes.x.pxPerMm,
              y: (visibleTop - this.axes.y.originLocalMm) * this.axes.y.pxPerMm,
              w: (visibleRight - visibleLeft) * this.axes.x.pxPerMm,
              h: (visibleBottom - visibleTop) * this.axes.y.pxPerMm,
            }
          : null;
      const t = args.transform;
      const cx = t.a * (el.w / 2) + t.c * (el.h / 2) + t.e;
      const cy = t.b * (el.w / 2) + t.d * (el.h / 2) + t.f;
      const frameX = Math.abs(cx - el.w / 2 - el.x) < 1e-4 ? el.x : cx - el.w / 2;
      const frameY = Math.abs(cy - el.h / 2 - el.y) < 1e-4 ? el.y : cy - el.h / 2;
      this.frame = {
        x: frameX,
        y: frameY,
        w: el.w,
        h: el.h,
        rotation: el.rotation || 0,
        flipX: Boolean(el.style.flipX),
        flipY: Boolean(el.style.flipY),
      };
    } else {
      const density = RASTER_LAYER_PX_PER_MM;
      this.axes = {
        x: { pxPerMm: density, originLocalMm: 0 },
        y: { pxPerMm: density, originLocalMm: 0 },
      };
      this.clip = { x: 0, y: 0, w: width, h: height };
      this.frame = {
        x: 0,
        y: 0,
        w: args.page.w,
        h: args.page.h,
        rotation: 0,
        flipX: false,
        flipY: false,
      };
    }

    this.layer = document.createElement("canvas");
    this.layer.width = width;
    this.layer.height = height;
    const ctx = this.layer.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("لا يمكن تهيئة طبقة الرسم");
    this.layerCtx = ctx;
    if (args.target) {
      ctx.drawImage(args.target.image, 0, 0, width, height);
      this.buffer = ctx.getImageData(0, 0, width, height);
    } else {
      this.buffer = {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      };
    }
  }

  get width() {
    return this.layer.width;
  }

  get height() {
    return this.layer.height;
  }

  /** Brush diameter on screen right now — the cursor ring uses this. */
  get screenDiameter() {
    return Math.max(2, this.args.sizeMm * this.pxPerMm);
  }

  updatePxPerMm(pxPerMm: number) {
    if (Number.isFinite(pxPerMm) && pxPerMm > 0) {
      this.pxPerMm = Math.max(0.1, pxPerMm);
    }
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingDirty = null;
    this.hideCursor();
    this.removePreview();
    const ctx = this.layer.getContext("2d");
    ctx?.clearRect(0, 0, this.layer.width, this.layer.height);
    // Release the backing store rather than waiting for GC.
    this.layer.width = 0;
    this.layer.height = 0;
    this.buffer = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  }

  /**
   * Paint one pointer sample. `point` is in PAGE millimetres; the transform
   * maps it into the element's own frame, which is what keeps a stroke on a
   * rotated, flipped or grouped image landing exactly under the pointer.
   */
  paint(
    point: { x: number; y: number },
    pressure?: number,
    deferFlush = false,
  ): boolean {
    if (this.destroyed) return false;
    const local = this.toLocal(point);
    const step = this.smoother.push(local, pressure);
    const radius = brushRadiusPx(this.args.sizeMm, this.axes.x.pxPerMm);
    const toWorking = (p: { x: number; y: number }) => ({
      x: (p.x - this.axes.x.originLocalMm) * this.axes.x.pxPerMm,
      y: (p.y - this.axes.y.originLocalMm) * this.axes.y.pxPerMm,
    });
    const to = toWorking(step.to);
    const spacing = strokeSpacing(radius);
    const samples = this.last ? walkSegment(this.last, to, spacing) : [to];
    // Pencil pressure scales the dab; a mouse/finger stroke is full size.
    const pressureScale = 0.35 + step.pressure * 1.3;
    const radiusNow = radius * (this.args.mode === "brush" ? pressureScale : 1);
    let painted = false;
    for (const sample of samples) {
      if (this.stamp(sample, radiusNow)) painted = true;
    }
    this.last = to;
    if (painted) {
      this.touched = true;
      if (!deferFlush) this.flush();
    }
    return painted;
  }

  /** Flush accumulated dirty pixels to the working canvas and live overlay once. */
  flush() {
    if (this.destroyed || !this.pendingDirty) return;
    const dirty = this.pendingDirty;
    this.pendingDirty = null;
    this.writeBack(dirty);
    this.blit(dirty);
  }

  private stamp(point: { x: number; y: number }, radius: number): boolean {
    const dab: DabOptions = {
      x: point.x,
      y: point.y,
      radius,
      hardness: this.args.hardness,
      opacity: this.args.opacity,
      erase: this.args.mode === "eraser",
      color: this.args.color,
    };
    const dirty = stampDab(this.buffer, dab, this.clip);
    if (!dirty) return false;
    this.markStroke(dirty);
    this.pendingDirty = mergeDirtyRect(this.pendingDirty, dirty);
    return true;
  }

  /** Upload exactly the pixels the dab changed — never the whole bitmap. */
  private writeBack(dirty: RectPx) {
    const { data, width } = this.buffer;
    const out = new Uint8ClampedArray(dirty.w * dirty.h * 4);
    for (let row = 0; row < dirty.h; row++) {
      const from = ((dirty.y + row) * width + dirty.x) * 4;
      out.set(data.subarray(from, from + dirty.w * 4), row * dirty.w * 4);
    }
    const image = this.layerCtx.createImageData(dirty.w, dirty.h);
    image.data.set(out);
    this.layerCtx.putImageData(image, dirty.x, dirty.y);
  }

  private markStroke(dirty: RectPx) {
    this.strokeMin.x = Math.min(this.strokeMin.x, dirty.x);
    this.strokeMin.y = Math.min(this.strokeMin.y, dirty.y);
    this.strokeMax.x = Math.max(this.strokeMax.x, dirty.x + dirty.w);
    this.strokeMax.y = Math.max(this.strokeMax.y, dirty.y + dirty.h);
  }

  private toLocal(point: { x: number; y: number }) {
    const { a, b, c, d, e, f } = this.args.transform;
    const det = a * d - b * c || 1;
    const x = point.x - e;
    const y = point.y - f;
    return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
  }

  /* ---------------- overlay ---------------- */

  /** The overlay canvas: only what the stroke changed, in element geometry. */
  private ensurePreview() {
    if (this.preview) return this.preview;
    const host = document.createElement("div");
    host.className = "raster-stroke-layer";
    host.setAttribute("aria-hidden", "true");
    host.style.left = `${this.frame.x}mm`;
    host.style.top = `${this.frame.y}mm`;
    host.style.width = `${this.frame.w}mm`;
    host.style.height = `${this.frame.h}mm`;
    host.style.transformOrigin = "center center";
    host.style.transform = `rotate(${this.frame.rotation}deg)${
      this.frame.flipX ? " scaleX(-1)" : ""
    }${this.frame.flipY ? " scaleY(-1)" : ""}`;
    const canvas = document.createElement("canvas");
    // Crisp at the current zoom without letting a 400% zoom allocate 16× the
    // memory: quality is capped, then the browser interpolates the rest.
    const quality = clamp(this.pxPerMm / (96 / 25.4), 1, 2);
    const dpr =
      typeof window === "undefined" ? 1 : clamp(window.devicePixelRatio || 1, 1, 3);
    this.previewPxPerMm = mmToPx(1) * quality * dpr;
    canvas.width = Math.max(1, Math.round(mmToPx(this.frame.w) * quality * dpr));
    canvas.height = Math.max(1, Math.round(mmToPx(this.frame.h) * quality * dpr));
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);
    this.args.pageNode.appendChild(host);
    this.previewHost = host;
    this.preview = canvas;
    if (this.target && this.elementId) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const scale = this.previewPxPerMm;
        const srcRect = this.clip ?? {
          x: 0,
          y: 0,
          w: this.layer.width,
          h: this.layer.height,
        };
        const dst = {
          x: (srcRect.x / this.axes.x.pxPerMm + this.axes.x.originLocalMm) * scale,
          y: (srcRect.y / this.axes.y.pxPerMm + this.axes.y.originLocalMm) * scale,
          w: (srcRect.w / this.axes.x.pxPerMm) * scale,
          h: (srcRect.h / this.axes.y.pxPerMm) * scale,
        };
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(
          this.layer,
          srcRect.x,
          srcRect.y,
          srcRect.w,
          srcRect.h,
          dst.x,
          dst.y,
          dst.w,
          dst.h,
        );
      }
      const selector = `.canvas-el[data-el-id="${
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(this.elementId)
          : this.elementId
      }"] img`;
      const targetImg = this.args.pageNode.querySelector<HTMLElement>(selector);
      if (targetImg) {
        this.hiddenTargetImg = targetImg;
        this.hiddenTargetPrevVisibility = targetImg.style.visibility;
        targetImg.style.visibility = "hidden";
      }
    }
    return canvas;
  }

  /** Copy one dirty rectangle of the working bitmap into the overlay. */
  private blit(dirty: RectPx) {
    const canvas = this.ensurePreview();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = this.previewPxPerMm;
    const dst = {
      x: (dirty.x / this.axes.x.pxPerMm + this.axes.x.originLocalMm) * scale,
      y: (dirty.y / this.axes.y.pxPerMm + this.axes.y.originLocalMm) * scale,
      w: (dirty.w / this.axes.x.pxPerMm) * scale,
      h: (dirty.h / this.axes.y.pxPerMm) * scale,
    };
    const pad = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dst.x - pad, dst.y - pad, dst.w + pad * 2, dst.h + pad * 2);
    ctx.clip();
    ctx.clearRect(dst.x - pad, dst.y - pad, dst.w + pad * 2, dst.h + pad * 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      this.layer,
      dirty.x,
      dirty.y,
      dirty.w,
      dirty.h,
      dst.x,
      dst.y,
      dst.w,
      dst.h,
    );
    ctx.restore();
  }

  private removePreview() {
    if (this.hiddenTargetImg) {
      this.hiddenTargetImg.style.visibility = this.hiddenTargetPrevVisibility;
      this.hiddenTargetImg = null;
      this.hiddenTargetPrevVisibility = "";
    }
    this.previewHost?.remove();
    this.previewHost = null;
    this.preview = null;
  }

  /** Live cursor ring: position in client px, diameter from the current zoom. */
  moveCursor(clientX: number, clientY: number) {
    if (this.destroyed) return;
    if (!this.cursor) {
      const node = document.createElement("div");
      node.className = `raster-cursor raster-cursor-${this.mode}`;
      node.setAttribute("aria-hidden", "true");
      document.body.appendChild(node);
      this.cursor = node;
    }
    const size = this.screenDiameter;
    this.cursor.style.width = `${size}px`;
    this.cursor.style.height = `${size}px`;
    this.cursor.style.transform = `translate(${clientX - size / 2}px, ${clientY - size / 2}px)`;
  }

  hideCursor() {
    this.cursor?.remove();
    this.cursor = null;
  }

  /* ---------------- finish ---------------- */

  get painted() {
    return this.touched;
  }

  /**
   * Turn the stroke into one document patch — or null when nothing changed,
   * so a stray tap can never write history.
   */
  commit(): RasterCommitPatch | null {
    if (this.destroyed || !this.touched) {
      this.dispose();
      return null;
    }
    this.flush();
    if (this.args.target && this.elementId) {
      const src = this.layer.toDataURL("image/png");
      const crop = scaleCropFor(
        this.args.target.el.style.crop,
        this.scale,
      );
      this.dispose();
      return { src, crop };
    }
    // A new layer becomes a real element: only the painted bounds are stored,
    // so a small stroke in a corner stays a small bitmap.
    // The dirty rect of every dab already includes the brush radius, so these
    // bounds are the stroke plus its edges — nothing more.
    const bounds = {
      x: clamp(Math.floor(this.strokeMin.x), 0, this.layer.width),
      y: clamp(Math.floor(this.strokeMin.y), 0, this.layer.height),
      right: clamp(Math.ceil(this.strokeMax.x), 0, this.layer.width),
      bottom: clamp(Math.ceil(this.strokeMax.y), 0, this.layer.height),
    };
    const w = Math.max(1, bounds.right - bounds.x);
    const h = Math.max(1, bounds.bottom - bounds.y);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) {
      this.dispose();
      return null;
    }
    ctx.drawImage(this.layer, bounds.x, bounds.y, w, h, 0, 0, w, h);
    const src = out.toDataURL("image/png");
    const pxPerMm = RASTER_LAYER_PX_PER_MM;
    const patch: RasterCommitPatch = {
      layer: {
        x: (this.frame.x * pxPerMm + bounds.x) / pxPerMm,
        y: (this.frame.y * pxPerMm + bounds.y) / pxPerMm,
        w: w / pxPerMm,
        h: h / pxPerMm,
        src,
      },
    };
    this.dispose();
    return patch;
  }

  cancel() {
    this.touched = false;
    this.dispose();
  }
}

/** Decode the artwork of a raster element, preferring the already-loaded node. */
export async function loadRasterSource(
  el: CanvasEl,
  node?: HTMLImageElement | null,
): Promise<{ image: CanvasImageSource; source: { w: number; h: number } } | null> {
  const size = {
    w: el.style.crop?.sourceW || 0,
    h: el.style.crop?.sourceH || 0,
  };
  const loaded = node && node.complete && node.naturalWidth ? node : null;
  if (loaded) {
    return {
      image: loaded,
      source: {
        w: size.w || loaded.naturalWidth,
        h: size.h || loaded.naturalHeight,
      },
    };
  }
  const src = String(el.src || "");
  if (!src) return null;
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const next = new Image();
    // Remote artwork needs CORS or the canvas would be tainted and the commit
    // would throw — better to fail here, before anything was painted.
    if (/^https?:/i.test(src)) next.crossOrigin = "anonymous";
    next.onload = () => resolve(next);
    next.onerror = () => resolve(null);
    next.src = src;
  });
  if (!image || !image.naturalWidth) return null;
  return {
    image,
    source: { w: size.w || image.naturalWidth, h: size.h || image.naturalHeight },
  };
}
