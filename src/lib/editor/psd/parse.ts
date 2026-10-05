/**
 * Read a PSD/PSB into a `PsdDocument`.
 *
 * Pixel layers stay as PNG bytes (hashed). Text, vector fills, groups,
 * opacity, blend and the effects we can describe are lifted out of ag-psd.
 * Anything we cannot represent is recorded on the node instead of throwing.
 */

import { initializeCanvas, readPsd, type Layer, type PixelArray } from "ag-psd";

import { resolvePsdFont, textDirection } from "./fonts";
import { pngDataUrl, sha256Hex, uniformColor } from "./image-codec";
import { assertPsdBytes, asUint8, sanitizeFileName, sanitizeLayerName } from "./security";
import type { PsdDocument, PsdEffectNotes, PsdNode, PsdPage, PsdProgress, PsdTextRun } from "./types";
import { buildShadow } from "../shadow";

let canvasReady = false;

function ensureImageDataFactory(): void {
  if (canvasReady || typeof document !== "undefined") return;
  canvasReady = true;
  initializeCanvas(
    ((width: number, height: number) => {
      if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
      return { width, height, getContext: () => null };
    }) as unknown as (width: number, height: number) => HTMLCanvasElement,
    ((width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4),
    })) as unknown as (width: number, height: number) => ImageData,
  );
}

function channelByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbHex(color: { r?: number; g?: number; b?: number } | undefined, fallback = "#172033"): string {
  if (!color || typeof color.r !== "number") return fallback;
  const hex = (n: number) => channelByte(n).toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g ?? 0)}${hex(color.b ?? 0)}`;
}

function unitPx(value: { value?: number; units?: string } | undefined, dpi: number): number {
  if (!value || typeof value.value !== "number") return 0;
  const v = value.value;
  switch (value.units) {
    case "Millimeters":
      return (v / 25.4) * dpi;
    case "Centimeters":
      return (v / 2.54) * dpi;
    case "Inches":
      return v * dpi;
    case "Points":
      return (v / 72) * dpi;
    case "Picas":
      return (v / 6) * dpi;
    default:
      return v;
  }
}

const CSS_BLEND: Record<string, string> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

function opacityAt(stops: { location: number; opacity: number }[], offset: number): number {
  if (!stops.length) return 1;
  const sorted = [...stops].sort((a, b) => a.location - b.location);
  if (offset <= sorted[0]!.location) return sorted[0]!.opacity;
  for (let i = 1; i < sorted.length; i += 1) {
    const right = sorted[i]!;
    if (offset <= right.location) {
      const left = sorted[i - 1]!;
      const span = Math.max(1e-6, right.location - left.location);
      const t = (offset - left.location) / span;
      return left.opacity + (right.opacity - left.opacity) * t;
    }
  }
  return sorted[sorted.length - 1]!.opacity;
}

interface GradientSource {
  type?: string;
  style?: string;
  angle?: number;
  opacity?: number;
  reverse?: boolean;
  gradient?: {
    type?: string;
    colorStops?: { color?: { r?: number; g?: number; b?: number; a?: number }; location?: number }[];
    opacityStops?: { opacity?: number; location?: number }[];
  };
  colorStops?: { color?: { r?: number; g?: number; b?: number; a?: number }; location?: number }[];
  opacityStops?: { opacity?: number; location?: number }[];
}

function gradientOf(source: GradientSource | undefined, multiplier = 1): PsdEffectNotes["gradient"] {
  if (!source) return undefined;
  const rawColors = source.gradient?.colorStops || source.colorStops || [];
  if (source.gradient?.type === "noise" || rawColors.length < 2) return undefined;
  const style = (source.style || (source.type === "solid" ? "linear" : source.type) || "linear").toLowerCase();
  if (!["linear", "radial", "reflected", "angle", "diamond"].includes(style)) return undefined;
  const alphaStops = source.gradient?.opacityStops || source.opacityStops || [];
  const locations = [...rawColors, ...alphaStops].map((stop) => Number(stop.location ?? 0));
  const locationScale = Math.max(1, ...locations) > 1 ? 4096 : 1;
  const normalizedAlphaStops = alphaStops.map((stop) => ({
    location: Math.max(0, Math.min(1, Number(stop.location ?? 0) / locationScale)),
    opacity: Number(stop.opacity ?? 1),
  }));
  const globalOpacity = Math.max(0, Math.min(1, Number(source.opacity ?? 1) * multiplier));
  const reversed = source.reverse === true;
  const stops = rawColors.map((stop, index) => {
    const original = Math.max(0, Math.min(1, Number(stop.location ?? index / (rawColors.length - 1)) / locationScale));
    const offset = reversed ? 1 - original : original;
    const color = stop.color;
    const colorAlpha = typeof color?.a === "number" ? Math.max(0, Math.min(1, color.a > 1 ? color.a / 255 : color.a)) : 1;
    return {
      id: `psd-gradient-${index}`,
      offset,
      color: rgbHex(color, "#172033"),
      opacity: Math.max(0, Math.min(1, opacityAt(normalizedAlphaStops, original) * globalOpacity * colorAlpha)),
    };
  }).sort((a, b) => a.offset - b.offset);
  return {
    type: style === "radial" || style === "diamond" ? "radial" : "linear",
    angle: Number.isFinite(source.angle) ? source.angle! : 90,
    cx: 50,
    cy: 50,
    stops,
  };
}

function cssShadowRow(
  x: number,
  y: number,
  blur: number,
  color: string,
  alpha: number,
  inset = false,
): string {
  const hex = color.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16) || 0;
  const green = Number.parseInt(hex.slice(2, 4), 16) || 0;
  const blue = Number.parseInt(hex.slice(4, 6), 16) || 0;
  return `${inset ? "inset " : ""}${x.toFixed(2)}mm ${y.toFixed(2)}mm ${Math.max(0, blur).toFixed(2)}mm rgba(${red},${green},${blue},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/**
 * Text transform is a 2×3 matrix `[xx, xy, yx, yy, tx, ty]`.
 * A placed-layer transform is eight corner coordinates and must never be read
 * as that matrix — doing so rotates every logo by `atan2(y, x)` of its corner.
 */
export function textMatrix(transform?: number[]): {
  scaleX: number;
  scaleY: number;
  rotation: number;
  tx: number;
  ty: number;
} | null {
  if (!transform || transform.length < 6 || transform.length >= 8) return null;
  const xx = transform[0] ?? 1;
  const xy = transform[1] ?? 0;
  const yx = transform[2] ?? 0;
  const yy = transform[3] ?? 1;
  const scaleX = Math.hypot(xx, xy) || 1;
  const scaleY = Math.hypot(yx, yy) || 1;
  let deg = (Math.atan2(xy, xx) * 180) / Math.PI;
  if (!Number.isFinite(deg) || Math.abs(deg) < 0.4) deg = 0;
  else deg = Math.round(deg * 100) / 100;
  return { scaleX, scaleY, rotation: deg, tx: transform[4] ?? 0, ty: transform[5] ?? 0 };
}

/**
 * Four corners of a smart object, TL TR BR BL.
 * The layer's stored pixels are already the on-canvas appearance when they
 * match the layer box, so this is only applied when the pixel buffer is a
 * different size from the placed frame (the raw asset, not the render).
 */
export function placedFlip(transform?: number[]): { flipX: boolean; flipY: boolean } {
  if (!transform || transform.length < 8) return { flipX: false, flipY: false };
  const x0 = transform[0] ?? 0;
  const y0 = transform[1] ?? 0;
  const ux = (transform[2] ?? 0) - x0;
  const uy = (transform[3] ?? 0) - y0;
  const vx = (transform[6] ?? 0) - x0;
  const vy = (transform[7] ?? 0) - y0;
  let angle = Math.atan2(uy, ux);
  let flipX = false;
  if (Math.cos(angle) < 0) {
    flipX = true;
    angle += Math.PI;
    if (angle > Math.PI) angle -= Math.PI * 2;
  }
  const downX = -Math.sin(angle);
  const downY = Math.cos(angle);
  const flipY = vx * downX + vy * downY < 0;
  return { flipX, flipY };
}

function effectsOf(layer: Layer, dpi: number): PsdEffectNotes {
  const notes: PsdEffectNotes = { mapped: [], unsupported: [] };
  const fx = layer.effects;
  const mm = (px: number) => (px * 25.4) / dpi;
  const shadows: string[] = [];
  if (fx && !fx.disabled) {
    const dropShadows = (fx.dropShadow || []).filter((s) => s.enabled !== false && s.present !== false);
    if (dropShadows.length > 4) notes.unsupported.push("تجاوزت الظلال الخارجية الأربعة المحوّلة");
    for (const shadow of dropShadows.slice(0, 4)) {
      const distance = unitPx(shadow.distance, dpi);
      const blur = unitPx(shadow.size, dpi);
      const angle = typeof shadow.angle === "number" ? shadow.angle : 120;
      const rad = ((180 - angle) * Math.PI) / 180;
      const color = rgbHex(shadow.color && "r" in shadow.color ? shadow.color : undefined, "#000000");
      const alpha = typeof shadow.opacity === "number" ? shadow.opacity : 0.75;
      const rendered = buildShadow({ x: Math.cos(rad) * mm(distance), y: Math.sin(rad) * mm(distance), blur: mm(blur), color, alpha });
      if (rendered) shadows.push(rendered);
      if ((shadow.blendMode && shadow.blendMode !== "normal") || shadow.contour || shadow.choke) {
        notes.unsupported.push("مزج أو محيط الظل الخارجي ممثل تقريبياً");
      }
    }
    if (shadows.length) notes.mapped.push("ظل خارجي");

    const innerShadows = (fx.innerShadow || []).filter((s) => s.enabled !== false && s.present !== false);
    if (innerShadows.length > 2) notes.unsupported.push("تجاوزت الظلال الداخلية اثنين محوّلين");
    for (const shadow of innerShadows.slice(0, 2)) {
      const distance = unitPx(shadow.distance, dpi);
      const blur = unitPx(shadow.size, dpi);
      const angle = typeof shadow.angle === "number" ? shadow.angle : 120;
      const rad = ((180 - angle) * Math.PI) / 180;
      shadows.push(cssShadowRow(Math.cos(rad) * mm(distance), Math.sin(rad) * mm(distance), mm(blur), rgbHex(shadow.color && "r" in shadow.color ? shadow.color : undefined, "#000000"), typeof shadow.opacity === "number" ? shadow.opacity : 0.5, true));
    }
    if (innerShadows.length) {
      notes.mapped.push("ظل داخلي تقريبي");
      if (innerShadows.some((s) => (s.blendMode && s.blendMode !== "normal") || s.contour || s.choke || s.layerConceals === false)) {
        notes.unsupported.push("تفاصيل الظل الداخلي ممثلة تقريبياً");
      }
    }

    const glow = fx.outerGlow;
    if (glow?.enabled) {
      shadows.push(cssShadowRow(0, 0, mm(unitPx(glow.size, dpi)), rgbHex(glow.color && "r" in glow.color ? glow.color : undefined, "#ffffff"), typeof glow.opacity === "number" ? glow.opacity : 0.75));
      notes.mapped.push("توهج خارجي تقريبي");
      notes.unsupported.push("توهج خارجي ممثل تقريبياً بظل CSS");
    }
    const innerGlow = fx.innerGlow;
    if (innerGlow?.enabled) {
      shadows.push(cssShadowRow(0, 0, mm(unitPx(innerGlow.size, dpi)), rgbHex(innerGlow.color && "r" in innerGlow.color ? innerGlow.color : undefined, "#ffffff"), typeof innerGlow.opacity === "number" ? innerGlow.opacity : 0.5, true));
      notes.mapped.push("توهج داخلي تقريبي");
      notes.unsupported.push("توهج داخلي ممثل تقريبياً بظل CSS");
    }
    if (fx.bevel?.enabled) {
      const size = mm(unitPx(fx.bevel.size, dpi));
      shadows.push(cssShadowRow(-size / 2, -size / 2, size, rgbHex(fx.bevel.highlightColor && "r" in fx.bevel.highlightColor ? fx.bevel.highlightColor : undefined, "#ffffff"), fx.bevel.highlightOpacity ?? 0.55, true));
      shadows.push(cssShadowRow(size / 2, size / 2, size, rgbHex(fx.bevel.shadowColor && "r" in fx.bevel.shadowColor ? fx.bevel.shadowColor : undefined, "#000000"), fx.bevel.shadowOpacity ?? 0.55, true));
      notes.mapped.push("Bevel / Emboss تقريبي");
      notes.unsupported.push("Bevel / Emboss ممثل تقريبياً بظلال داخلية");
    }
    if (fx.satin?.enabled) notes.unsupported.push("Satin");

    const stroke = fx.stroke?.find((s) => s.enabled !== false && s.present !== false);
    if (stroke) {
      const width = unitPx(stroke.size, dpi);
      const color = stroke.color && "r" in stroke.color ? rgbHex(stroke.color, "#172033") : undefined;
      if (width > 0 && color) {
        notes.strokeWidthMm = mm(width);
        notes.strokeColor = color;
        notes.mapped.push("حد الطبقة");
        if ((stroke.position && stroke.position !== "inside") || (typeof stroke.opacity === "number" && stroke.opacity < 1) || (stroke.blendMode && stroke.blendMode !== "normal")) {
          notes.unsupported.push("موضع أو شفافية أو مزج الحد ممثل تقريبياً");
        }
      } else if (stroke.fillType === "gradient" && stroke.gradient) {
        notes.unsupported.push("حد بتدرج لوني");
      } else if (stroke.fillType === "pattern") {
        notes.unsupported.push("حد بنقش Pattern");
      }
    }

    const gradientLayer = fx.gradientOverlay?.find((g) => g.enabled !== false && g.present !== false);
    if (gradientLayer) {
      if (!layer.text) {
        notes.gradient = gradientOf(gradientLayer as GradientSource);
        notes.gradientOverlay = !!notes.gradient;
      }
      const blend = CSS_BLEND[String(gradientLayer.blendMode || "normal").toLowerCase()];
      if (blend) notes.gradientBlendMode = blend;
      if (notes.gradient) {
        notes.mapped.push("تدرج لوني فوق الطبقة");
        if (["angle", "diamond", "reflected"].includes(String(gradientLayer.type))) {
          notes.unsupported.push(`نمط التدرج «${gradientLayer.type}» مُمثّل تقريبياً`);
        }
      } else {
        notes.unsupported.push(layer.text ? "تدرج النص غير مدعوم" : "تدرج لوني لا يمكن تمثيله بدقة");
      }
      if (fx.gradientOverlay!.filter((g) => g.enabled !== false && g.present !== false).length > 1) {
        notes.unsupported.push("تدرجات متعددة فوق الطبقة؛ حُوّل أول تدرج فقط");
      }
      if (gradientLayer.blendMode && gradientLayer.blendMode !== "normal" && !blend) {
        notes.unsupported.push(`مزج التدرج «${gradientLayer.blendMode}» غير مدعوم`);
      }
    }
    if (fx.patternOverlay?.enabled) notes.unsupported.push("نقش Pattern");
    if (fx.solidFill?.some((f) => f.enabled !== false)) notes.unsupported.push("تعبئة لون فوق الطبقة");
  }
  notes.shadow = shadows.length ? shadows.join(", ") : undefined;
  smartFilterBlur(layer, dpi, notes);

  return notes;
}

/**
 * العوامل الذكية (Smart Filters) على كائن ذكي.
 *
 * A smart object's filters live on `placedLayer.filter.list`. The blur family
 * (Gaussian / Box / Surface / plain Blur) becomes ONE native «تمويه الطبقة»
 * value in millimetres — the same layer-blur effect the editor paints and
 * every raster export captures — so a smart-object blur survives as an
 * editable effect instead of being flattened into the bitmap. Filters with no
 * NASAQ equivalent (motion/radial/shape/smart blur, displace, stylize, …) are
 * named in the report; they are never silently dropped.
 */
export function smartFilterBlur(layer: Layer, dpi: number, notes: PsdEffectNotes): void {
  const list = layer.placedLayer?.filter;
  if (!list?.enabled || !list.list?.length) return;
  const pxToMm = (px: number) => (px * 25.4) / dpi;
  const radii: number[] = [];
  let approximate = false;
  let skipped = 0;
  for (const item of list.list) {
    if (item.enabled === false) continue;
    switch (item.type) {
      case "gaussian blur":
      case "box blur": {
        const radius = unitPx(item.filter?.radius, dpi);
        if (radius > 0) radii.push(pxToMm(radius));
        if (typeof item.opacity === "number" && item.opacity < 1) approximate = true;
        break;
      }
      case "surface blur": {
        const radius = unitPx(item.filter?.radius, dpi);
        if (radius > 0) radii.push(pxToMm(radius));
        approximate = true; // the threshold keeps edges crisp in Photoshop
        break;
      }
      case "blur":
      case "blur more":
        // The file stores no radius for the canned filters; the note says so.
        approximate = true;
        skipped += 1;
        break;
      default:
        notes.unsupported.push(`عامل ذكي «${item.type}»`);
    }
  }
  if (radii.length) {
    const strongest = Math.max(...radii);
    notes.blurMm = Math.min(25, Math.round(strongest * 100) / 100);
    notes.mapped.push("تمويه طبقة من عامل ذكي");
    if (radii.length > 1) {
      notes.unsupported.push(`دُمجت ${radii.length} عوامل تمويه في قيمة واحدة`);
    }
    if (approximate) notes.unsupported.push("تفاصيل العامل الذكي ممثلة تقريبياً");
  } else if (skipped) {
    notes.unsupported.push("تمويه ذكي بلا قيمة نصف قطر مخزّنة في الملف");
  }
}

function textOf(layer: Layer): PsdTextRun | null {
  const text = layer.text;
  if (!text || typeof text.text !== "string" || !text.text) return null;
  const style = text.style || {};
  const run = text.styleRuns?.[0]?.style;
  const fontName = style.font?.name || run?.font?.name || "Unknown";
  const rawSize =
    typeof style.fontSize === "number" && style.fontSize > 0
      ? style.fontSize
      : typeof run?.fontSize === "number" && run.fontSize > 0
        ? run.fontSize
        : 16;
  // Photoshop's UI size is the stored size times the text-matrix scale.
  // Without it a 22px label arrives as 1.5pt and the line no longer fits its box.
  const scale = textMatrix(text.transform)?.scaleY ?? 1;
  const fontSize = rawSize * scale;
  const resolved = resolvePsdFont(fontName, !!(style.fauxBold || run?.fauxBold), !!(style.fauxItalic || run?.fauxItalic));
  const justification = text.paragraphStyle?.justification || "left";
  const align = justification.startsWith("justify")
    ? "justify"
    : justification === "center" || justification === "right" || justification === "left"
      ? justification
      : "left";
  const rawLeading =
    typeof style.leading === "number" && style.leading > 0
      ? style.leading
      : typeof run?.leading === "number" && run.leading > 0
        ? run.leading
        : rawSize * 1.2;
  const leading = rawLeading * scale;
  const tracking = typeof style.tracking === "number" ? style.tracking : 0;
  const emMm = fontSize * 0.3528;
  const fill = style.fillColor && "r" in style.fillColor
    ? style.fillColor
    : run?.fillColor && "r" in run.fillColor
      ? run.fillColor
      : undefined;
  // PSD text layers embed ETX (\u0003) as a paragraph/field terminator; the
  // strip is intentional, hence the control-regex allowance on this line only.
  // eslint-disable-next-line no-control-regex
  const content = text.text.replace(/\r\n?/g, "\n").replace(/\u0003/g, "").replace(/\n+$/g, "");
  return {
    content,
    fontName: resolved.fontName,
    fontSize,
    fauxBold: !!(style.fauxBold || run?.fauxBold),
    fauxItalic: !!(style.fauxItalic || run?.fauxItalic),
    underline: !!(style.underline || run?.underline),
    color: rgbHex(fill),
    align,
    lineHeight: Math.min(4, Math.max(0.8, leading / fontSize)),
    letterSpacingMm: (tracking / 1000) * emMm,
    direction: textDirection(content),
  };
}

/** Frame for a text layer whose pixel bounds were not stored. */
function textFrame(
  layer: Layer,
  text: PsdTextRun,
  dpi: number,
): { left: number; top: number; width: number; height: number } | null {
  const matrix = textMatrix(layer.text?.transform);
  if (!matrix) return null;
  const box = layer.text?.boxBounds;
  if (box && box.length >= 4) {
    const l = box[0] ?? 0;
    const t = box[1] ?? 0;
    const r = box[2] ?? l;
    const b = box[3] ?? t;
    const width = Math.abs(r - l) * matrix.scaleX;
    const height = Math.abs(b - t) * matrix.scaleY;
    if (width > 1 && height > 1) {
      return {
        left: matrix.tx + Math.min(l, r) * matrix.scaleX,
        top: matrix.ty + Math.min(t, b) * matrix.scaleY,
        width,
        height,
      };
    }
  }
  const fontPx = text.fontSize * (dpi / 72);
  const lines = text.content.split("\n");
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const width = Math.max(fontPx * 0.62 * longest, fontPx * 2);
  const height = Math.max(fontPx * text.lineHeight * lines.length, fontPx * 1.15);
  let left = matrix.tx;
  if (text.align === "center") left = matrix.tx - width / 2;
  else if (text.align === "right" || text.align === "justify") left = matrix.tx - width;
  return { left, top: matrix.ty - fontPx * 0.8, width, height };
}

function svgGradient(id: string, gradient: NonNullable<PsdEffectNotes["gradient"]>): string {
  const stopMarkup = gradient.stops.slice(0, 16).map((stop) =>
    `<stop offset="${Math.max(0, Math.min(1, stop.offset)) * 100}%" stop-color="${stop.color}" stop-opacity="${Math.max(0, Math.min(1, stop.opacity))}"/>`,
  ).join("");
  if (gradient.type === "radial") {
    return `<radialGradient id="${id}" cx="${gradient.cx}%" cy="${gradient.cy}%">${stopMarkup}</radialGradient>`;
  }
  const radians = (gradient.angle * Math.PI) / 180;
  const dx = Math.sin(radians) * 50;
  const dy = -Math.cos(radians) * 50;
  return `<linearGradient id="${id}" x1="${50 - dx}%" y1="${50 - dy}%" x2="${50 + dx}%" y2="${50 + dy}%">${stopMarkup}</linearGradient>`;
}

interface PsdVectorMaskSvg {
  content: string;
  left: number;
  top: number;
  width: number;
  height: number;
  approximations: string[];
}

function vectorMaskSvg(layer: Layer, effects: PsdEffectNotes): PsdVectorMaskSvg | null {
  const mask = layer.vectorMask;
  const fill = layer.vectorFill;
  if (!mask || mask.disable || mask.invert || mask.fillStartsWithAllPixels || !mask.paths?.length || !fill) return null;
  let baseColor: string | null = null;
  let baseGradient: PsdEffectNotes["gradient"];
  if (fill.type === "color" && fill.color && "r" in fill.color) baseColor = rgbHex(fill.color);
  else if (fill.type === "solid") baseGradient = gradientOf(fill as unknown as GradientSource);
  else return null;
  if (!baseColor && !baseGradient) return null;

  const paths: { d: string; rule: string; open: boolean }[] = [];
  const pointsForBounds: [number, number][] = [];
  const approximations: string[] = [];
  const num = (value: number) => Number(value.toFixed(3)).toString();
  let knotCount = 0;
  for (const path of mask.paths.slice(0, 128)) {
    const knots = (path.knots || []).slice(0, Math.max(0, 10_000 - knotCount));
    if (knots.length < (path.knots || []).length) approximations.push("تجاوز عدد عقد القناع المتجهي 10000 عقدة");
    knotCount += knots.length;
    if (!knots.length) continue;
    for (const knot of knots) {
      const points = knot.points || [];
      if (points.length < 6 || points.slice(0, 6).some((point) => !Number.isFinite(point) || Math.abs(point) > 1_000_000)) continue;
      pointsForBounds.push([points[0]!, points[1]!], [points[2]!, points[3]!], [points[4]!, points[5]!]);
    }
    const valid = knots.filter((knot) => knot.points?.length >= 6 && knot.points.slice(0, 6).every((point) => Number.isFinite(point) && Math.abs(point) <= 1_000_000));
    if (!valid.length) continue;
    const first = valid[0]!.points;
    const firstX = first[2]!;
    const firstY = first[3]!;
    const d = [`M${num(firstX)} ${num(firstY)}`];
    for (let i = 1; i < valid.length; i += 1) {
      const previous = valid[i - 1]!.points;
      const next = valid[i]!.points;
      d.push(`C${num(previous[4]!)} ${num(previous[5]!)} ${num(next[0]!)} ${num(next[1]!)} ${num(next[2]!)} ${num(next[3]!)}`);
    }
    if (!path.open && valid.length > 1) {
      const previous = valid[valid.length - 1]!.points;
      d.push(`C${num(previous[4]!)} ${num(previous[5]!)} ${num(first[0]!)} ${num(first[1]!)} ${num(firstX)} ${num(firstY)} Z`);
    }
    paths.push({ d: d.join(" "), rule: path.fillRule === "non-zero" ? "nonzero" : "evenodd", open: !!path.open });
    if (path.operation && path.operation !== "combine" && path.operation !== "exclude") {
      approximations.push(`عملية متجهية «${path.operation}» ممثلة تقريبياً`);
    }
  }
  if (!paths.length || !pointsForBounds.length) return null;
  if (mask.paths.length > 128) approximations.push("تجاوز عدد مسارات القناع المتجهي 128 مساراً");
  const xs = pointsForBounds.map((point) => point[0]);
  const ys = pointsForBounds.map((point) => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - left);
  const height = Math.max(1, Math.max(...ys) - top);
  const defs: string[] = [];
  const basePaint = baseGradient ? "url(#psdVectorBase)" : baseColor!;
  if (baseGradient) defs.push(svgGradient("psdVectorBase", baseGradient));
  const overlay = effects.gradientOverlay ? effects.gradient : undefined;
  if (overlay) defs.push(svgGradient("psdVectorOverlay", overlay));
  const pathMarkup = paths.map((path) => {
    const openFill = path.open ? "none" : basePaint;
    const base = `<path d="${path.d}" transform="translate(${-left} ${-top})" fill="${openFill}" fill-rule="${path.rule}"/>`;
    if (!overlay || path.open) return base;
    const blend = effects.gradientBlendMode && effects.gradientBlendMode !== "normal"
      ? ` style="mix-blend-mode:${effects.gradientBlendMode}"`
      : "";
    return `${base}<path d="${path.d}" transform="translate(${-left} ${-top})" fill="url(#psdVectorOverlay)" fill-rule="${path.rule}"${blend}/>`;
  }).join("");
  const defsMarkup = defs.length ? `<defs>${defs.join("")}</defs>` : "";
  const content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(width)} ${num(height)}">${defsMarkup}${pathMarkup}</svg>`;
  if (content.length > 1_000_000) return null;
  return { content, left, top, width, height, approximations };
}

function vectorBox(layer: Layer): { left: number; top: number; width: number; height: number; radius: number; kind: "rect" | "circle" | "rounded" } | null {
  const item = layer.vectorOrigination?.keyDescriptorList?.find((d) => d.keyOriginShapeBoundingBox);
  const box = item?.keyOriginShapeBoundingBox;
  if (!box) return null;
  const left = box.left?.value ?? 0;
  const top = box.top?.value ?? 0;
  const right = box.right?.value ?? left;
  const bottom = box.bottom?.value ?? top;
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;
  const origin = item?.keyOriginType;
  const radii = item?.keyOriginRRectRadii;
  const radius = radii
    ? Math.max(
        radii.topLeft?.value ?? 0,
        radii.topRight?.value ?? 0,
        radii.bottomLeft?.value ?? 0,
        radii.bottomRight?.value ?? 0,
      )
    : 0;
  const kind = origin === 5 ? "circle" : radius > 0.5 || origin === 2 ? "rounded" : "rect";
  return { left, top, width, height, radius, kind };
}

interface Walk {
  id: number;
  dpi: number;
  onProgress?: PsdProgress;
  seen: number;
  total: number;
}

function countLayers(layers: Layer[] | undefined): number {
  let n = 0;
  for (const layer of layers || []) {
    n += 1;
    n += countLayers(layer.children);
  }
  return n;
}

function rgbaBytes(data: PixelArray): Uint8Array | null {
  if (data instanceof Uint8Array || data instanceof Uint8ClampedArray) return new Uint8Array(data);
  if (data instanceof Uint16Array) return Uint8Array.from(data, (value) => Math.round(value / 257));
  if (data instanceof Float32Array) return Uint8Array.from(data, (value) => Math.round(Math.max(0, Math.min(255, value <= 1 ? value * 255 : value))));
  return null;
}

function applyRasterMask(
  pixels: { width: number; height: number; data: Uint8Array },
  layer: Layer,
): boolean {
  const mask = layer.mask;
  const image = mask?.imageData;
  if (!mask || mask.disabled || !image?.data || image.width < 1 || image.height < 1) return false;
  const maskPixels = image.data;
  const channelCount = Math.max(1, Math.floor(maskPixels.length / (image.width * image.height)));
  if (channelCount < 1) return false;
  const layerLeft = layer.left ?? 0;
  const layerTop = layer.top ?? 0;
  const maskLeft = (mask.left ?? layerLeft) + (mask.positionRelativeToLayer ? layerLeft : 0);
  const maskTop = (mask.top ?? layerTop) + (mask.positionRelativeToLayer ? layerTop : 0);
  const defaultAlpha = Math.max(0, Math.min(1, (mask.defaultColor ?? 255) / 255));
  const density = Math.max(0, Math.min(1, mask.userMaskDensity ?? 1));
  const sample = (index: number): number => {
    const value = Number(maskPixels[index]);
    if (maskPixels instanceof Uint16Array) return Math.max(0, Math.min(1, value / 65535));
    if (maskPixels instanceof Float32Array) return Math.max(0, Math.min(1, value <= 1 ? value : value / 255));
    return Math.max(0, Math.min(1, value / 255));
  };
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const mx = Math.floor(layerLeft + x - maskLeft);
      const my = Math.floor(layerTop + y - maskTop);
      const maskAlpha = mx >= 0 && my >= 0 && mx < image.width && my < image.height
        ? sample((my * image.width + mx) * channelCount)
        : defaultAlpha;
      const effective = defaultAlpha + (maskAlpha - defaultAlpha) * density;
      const alphaIndex = (y * pixels.width + x) * 4 + 3;
      pixels.data[alphaIndex] = Math.round(pixels.data[alphaIndex]! * effective);
    }
  }
  return true;
}

async function readPixels(
  layer: Layer,
): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const image = layer.imageData;
  if (!image || image.width < 1 || image.height < 1 || !image.data) return null;
  const data = rgbaBytes(image.data);
  if (!data || data.length < image.width * image.height * 4) return null;
  const pixels = { width: image.width, height: image.height, data };
  applyRasterMask(pixels, layer);
  return pixels;
}

async function toNode(layer: Layer, walk: Walk): Promise<PsdNode> {
  walk.seen += 1;
  if (walk.onProgress && walk.seen % 4 === 0) {
    const pct = 12 + Math.round((walk.seen / Math.max(1, walk.total)) * 48);
    walk.onProgress("استخراج الطبقات", pct, sanitizeLayerName(layer.name || "", "طبقة"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const id = `L${walk.id++}`;
  const name = sanitizeLayerName(layer.name || layer.text?.text?.slice(0, 40) || "", "طبقة");
  const issues: string[] = [];
  const effects = effectsOf(layer, walk.dpi);
  if (effects.unsupported.length) {
    issues.push(`مؤثرات غير محوّلة أو ممثلة تقريبياً: ${effects.unsupported.join("، ")}`);
  }
  const blend = layer.blendMode || "normal";
  const cssBlend = CSS_BLEND[blend];
  if (blend !== "normal" && blend !== "pass through" && !cssBlend) {
    issues.push(`وضع المزج «${blend}» ليس له معادل في المحرر`);
  }
  const hasActiveRasterMask = !!layer.mask && !layer.mask.disabled && !!layer.mask.imageData;
  if (layer.mask && !layer.mask.disabled) {
    if (layer.text) {
      issues.push("قناع النص غير مطبق؛ حُفظ النص قابلاً للتحرير مع تنبيه بصري");
    } else if (layer.children?.length) {
      issues.push("قناع المجموعة غير مطبق على العناصر الفرعية");
    } else if (hasActiveRasterMask) {
      issues.push("طُبّق قناع الطبقة على شفافية الصورة؛ قد لا يحافظ التمويه أو القناع المتجهي على دقتهما");
    } else {
      issues.push("بيانات قناع الطبقة غير متاحة؛ حُفظ المحتوى دون تطبيق القناع");
    }
  }
  if (layer.text?.warp && layer.text.warp.style && layer.text.warp.style !== "none") {
    issues.push("انحناء النص (Warp) غير مدعوم، أُبقي النص مستويًا");
  }
  const text = textOf(layer);
  const vector = vectorBox(layer);
  let left = layer.left ?? 0;
  let top = layer.top ?? 0;
  let width = (layer.right ?? left) - left;
  let height = (layer.bottom ?? top) - top;
  let boundsEstimated = false;
  if ((width < 1 || height < 1) && vector) {
    left = vector.left;
    top = vector.top;
    width = vector.width;
    height = vector.height;
  }
  if ((width < 1 || height < 1) && text) {
    const framed = textFrame(layer, text, walk.dpi);
    const anchorMissing = Math.abs(left) < 0.5 && Math.abs(top) < 0.5;
    if (framed && anchorMissing) {
      left = framed.left;
      top = framed.top;
      width = framed.width;
      height = framed.height;
    } else if (framed) {
      if (width < 1) width = framed.width;
      if (height < 1) height = framed.height;
    } else {
      const fontPx = text.fontSize * (walk.dpi / 72);
      const lines = text.content.split("\n");
      const longest = lines.reduce((m, line) => Math.max(m, line.length), 1);
      if (width < 1) width = Math.max(fontPx * 0.62 * longest, fontPx * 2);
      if (height < 1) height = Math.max(fontPx * text.lineHeight * lines.length, fontPx * 1.15);
    }
    boundsEstimated = true;
    issues.push("إطار النص غير مخزّن في الملف، قُدّر من حجم الخط ومصفوفة التحويل");
  }

  const node: PsdNode = {
    id,
    name,
    kind: "empty",
    hidden: !!layer.hidden,
    opacity: Math.min(1, Math.max(0, typeof layer.opacity === "number" ? layer.opacity : 1)) *
      (typeof layer.fillOpacity === "number" ? Math.min(1, Math.max(0, layer.fillOpacity)) : 1),
    blendMode: blend,
    cssBlend,
    clipping: !!layer.clipping,
    left,
    top,
    width: Math.max(0, width),
    height: Math.max(0, height),
    boundsEstimated,
    rotation: textMatrix(layer.text?.transform)?.rotation ?? 0,
    effects,
    issues,
    children: [],
  };

  if (layer.children?.length) {
    node.kind = "group";
    if (layer.artboard?.rect) {
      const rect = layer.artboard.rect;
      node.left = rect.left;
      node.top = rect.top;
      node.width = Math.max(0, rect.right - rect.left);
      node.height = Math.max(0, rect.bottom - rect.top);
      node.artboard = true;
    }
    for (const child of layer.children) node.children.push(await toNode(child, walk));
    return node;
  }

  if (layer.adjustment) {
    node.kind = "adjustment";
    issues.push(`طبقة ضبط (${layer.adjustment.type}) ليس لها عنصر مقابل في نَسَق`);
    return node;
  }

  if (text) {
    if (layer.vectorMask && !layer.vectorMask.disable && layer.vectorMask.paths?.length) {
      issues.push("القناع المتجهي للنص غير مطبق؛ بقي النص قابلاً للتحرير");
    }
    node.kind = "text";
    node.text = text;
    return node;
  }

  const vectorArtwork = vectorMaskSvg(layer, effects);
  if (vectorArtwork && !hasActiveRasterMask) {
    node.kind = "vector";
    node.vector = { content: vectorArtwork.content };
    node.left = vectorArtwork.left;
    node.top = vectorArtwork.top;
    node.width = vectorArtwork.width;
    node.height = vectorArtwork.height;
    if (vectorArtwork.approximations.length) {
      issues.push(`مسارات متجهية ممثلة تقريبياً: ${vectorArtwork.approximations.join("، ")}`);
    }
    return node;
  }
  if (vectorArtwork && hasActiveRasterMask) {
    issues.push("قناع الطبقة النقطي طُبّق على معاينة بكسلية للشكل المتجهي");
  }
  if (layer.vectorMask && !layer.vectorMask.disable && layer.vectorMask.paths?.length) {
    issues.push("بيانات القناع المتجهي غير مدعومة بالكامل؛ حُفظت البكسلات أو الشكل الممكن");
  }

  const fill = layer.vectorFill;
  if (fill?.type === "color" && "color" in fill && fill.color && "r" in fill.color && node.width >= 1 && node.height >= 1) {
    node.kind = "shape";
    node.shape = {
      fill: rgbHex(fill.color),
      radiusPx: vector?.radius ?? 0,
      kind: vector?.kind ?? "rect",
    };
    if (!hasActiveRasterMask) return node;
  }
  if (fill?.type === "solid" && node.width >= 1 && node.height >= 1) {
    const gradient = gradientOf(fill as GradientSource);
    if (gradient) {
      node.kind = "shape";
      node.shape = {
        fill: gradient.stops[0]?.color || "#172033",
        radiusPx: vector?.radius ?? 0,
        kind: vector?.kind ?? "rect",
        gradient,
      };
      if (!hasActiveRasterMask) return node;
    } else {
      issues.push("تعبئة متجهية بتدرج/ضجيج غير مدعوم بالكامل؛ ستُستخدم البكسلات إن وُجدت");
    }
  }
  if (fill && fill.type !== "color" && fill.type !== "solid") {
    issues.push("تعبئة متجهية بنقش أو نوع آخر — ستُستخدم البكسلات إن وُجدت");
  }

  const pixels = await readPixels(layer);
  if (pixels) {
    if (pixels.data.every((v, i) => i % 4 !== 3 || v === 0)) {
      node.kind = "empty";
      issues.push("طبقة شفافة بالكامل");
      return node;
    }
    const solid = uniformColor(pixels.data, pixels.width, pixels.height);
    if (solid && solid.a > 0) {
      node.kind = "shape";
      node.shape = {
        fill: rgbHex(solid),
        radiusPx: 0,
        kind: "rect",
      };
      node.opacity = Math.min(1, node.opacity * (solid.a / 255));
      node.width = pixels.width;
      node.height = pixels.height;
      return node;
    }
    const encoded = await pngDataUrl(pixels.width, pixels.height, pixels.data);
    if (!encoded) {
      node.kind = "empty";
      issues.push("الصورة أكبر من حد الاستخراج الآمن ولم تُحوَّل");
      return node;
    }
    node.kind = "pixels";
    node.image = {
      dataUrl: encoded.dataUrl,
      width: pixels.width,
      height: pixels.height,
      hash: await sha256Hex(encoded.bytes),
    };
    const boundsW = Math.max(0, (layer.right ?? left) - (layer.left ?? left));
    const boundsH = Math.max(0, (layer.bottom ?? top) - (layer.top ?? top));
    const mismatch =
      boundsW > 1 &&
      boundsH > 1 &&
      (Math.abs(pixels.width - boundsW) > 2 || Math.abs(pixels.height - boundsH) > 2);
    if (mismatch) {
      // Pixel buffer is the untransformed asset. Keep the placed frame and
      // mirror it the way the smart-object corners say.
      const flip = placedFlip(layer.placedLayer?.transform);
      node.left = layer.left ?? left;
      node.top = layer.top ?? top;
      node.width = boundsW;
      node.height = boundsH;
      node.flipX = flip.flipX || undefined;
      node.flipY = flip.flipY || undefined;
      if (flip.flipX || flip.flipY) issues.push("انعكاس الكائن الذكي طُبّق ليطابق اتجاهه في الملف");
    } else {
      // The buffer already is the on-canvas appearance, including any flip
      // Photoshop baked into the layer. Do not flip or rotate it again.
      node.width = pixels.width;
      node.height = pixels.height;
    }
    if (layer.placedLayer) issues.push("كائن ذكي حُوّل من نسخته النقطية داخل الملف");
    return node;
  }

  if (layer.placedLayer) {
    node.kind = "empty";
    issues.push("كائن ذكي بلا بكسلات مضمّنة");
    return node;
  }
  node.kind = "empty";
  if (!issues.length) issues.push("طبقة بلا محتوى قابل للاستخراج");
  return node;
}

function artboardPages(children: PsdNode[], docW: number, docH: number): PsdPage[] | null {
  const boards = children.filter((node) => node.artboard && node.width >= 8 && node.height >= 8);
  if (!boards.length) return null;
  if (boards.length === 1 && children.length === 1 && boards[0]!.width === docW && boards[0]!.height === docH) {
    return null;
  }
  const pages: PsdPage[] = boards.map((board) => ({
    name: board.name,
    widthPx: Math.round(board.width),
    heightPx: Math.round(board.height),
    nodes: shiftNodes(board.children, board.left, board.top),
  }));
  const loose = children.filter((node) => !node.artboard);
  if (loose.length) {
    pages.push({ name: "طبقات إضافية", widthPx: docW, heightPx: docH, nodes: loose });
  }
  return pages;
}

function shiftNodes(nodes: PsdNode[], dx: number, dy: number): PsdNode[] {
  return nodes.map((node) => ({
    ...node,
    left: node.left - dx,
    top: node.top - dy,
    children: shiftNodes(node.children, dx, dy),
  }));
}

export async function parsePsd(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
  onProgress?: PsdProgress,
): Promise<PsdDocument> {
  const view = asUint8(bytes);
  assertPsdBytes(view);
  ensureImageDataFactory();
  onProgress?.("قراءة PSD", 8, sanitizeFileName(fileName));
  const psd = readPsd(view, {
    skipThumbnail: true,
    skipCompositeImageData: false,
    skipLinkedFilesData: true,
    useImageData: true,
    throwForMissingFeatures: false,
    logMissingFeatures: false,
  });
  const dpiRaw = psd.imageResources?.resolutionInfo?.horizontalResolution;
  const unit = psd.imageResources?.resolutionInfo?.horizontalResolutionUnit;
  const dpi = !dpiRaw || dpiRaw < 1 ? 72 : unit === "PPCM" ? dpiRaw * 2.54 : dpiRaw;
  const walk: Walk = { id: 1, dpi, onProgress, seen: 0, total: countLayers(psd.children) };
  onProgress?.("استخراج الطبقات", 12);
  const nodes: PsdNode[] = [];
  for (const layer of psd.children || []) nodes.push(await toNode(layer, walk));

  let compositeDataUrl: string | undefined;
  const composite = psd.imageData;
  if (composite?.data && composite.width * composite.height <= 2_000_000) {
    onProgress?.("معاينة الأصل", 62);
    const data = composite.data instanceof Uint8Array ? composite.data : new Uint8Array(composite.data.buffer);
    const encoded = await pngDataUrl(composite.width, composite.height, data);
    compositeDataUrl = encoded?.dataUrl;
  }

  const pages = artboardPages(nodes, psd.width, psd.height) || [
    { name: "الصفحة 1", widthPx: psd.width, heightPx: psd.height, nodes },
  ];
  return {
    fileName: sanitizeFileName(fileName),
    widthPx: psd.width,
    heightPx: psd.height,
    dpi,
    compositeDataUrl,
    pages,
  };
}
