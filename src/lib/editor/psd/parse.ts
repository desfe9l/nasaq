/**
 * Read a PSD/PSB into a `PsdDocument`.
 *
 * Pixel layers stay as PNG bytes (hashed). Text, vector fills, groups,
 * opacity, blend and the effects we can describe are lifted out of ag-psd.
 * Anything we cannot represent is recorded on the node instead of throwing.
 */

import { initializeCanvas, readPsd, type Layer } from "ag-psd";

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

function rotationOf(transform?: number[]): number {
  if (!transform || transform.length < 4) return 0;
  const deg = (Math.atan2(transform[1] ?? 0, transform[0] ?? 1) * 180) / Math.PI;
  if (!Number.isFinite(deg) || Math.abs(deg) < 0.4) return 0;
  return Math.round(deg * 100) / 100;
}

function effectsOf(layer: Layer, dpi: number): PsdEffectNotes {
  const notes: PsdEffectNotes = { mapped: [], unsupported: [] };
  const fx = layer.effects;
  if (!fx || fx.disabled) return notes;
  const shadow = fx.dropShadow?.find((s) => s.enabled !== false && s.present !== false);
  if (shadow) {
    const distance = unitPx(shadow.distance, dpi);
    const blur = unitPx(shadow.size, dpi);
    const angle = typeof shadow.angle === "number" ? shadow.angle : 120;
    const rad = ((180 - angle) * Math.PI) / 180;
    const mm = (px: number) => (px * 25.4) / dpi;
    const color = rgbHex(
      shadow.color && "r" in shadow.color ? shadow.color : undefined,
      "#000000",
    );
    notes.shadow = buildShadow({
      x: Math.cos(rad) * mm(distance),
      y: Math.sin(rad) * mm(distance),
      blur: mm(blur),
      color,
      alpha: typeof shadow.opacity === "number" ? shadow.opacity : 0.75,
    });
    if (notes.shadow) notes.mapped.push("ظل خارجي");
  }
  const stroke = fx.stroke?.find((s) => s.enabled !== false);
  if (stroke) {
    const width = unitPx(stroke.size, dpi);
    const color =
      stroke.color && "r" in stroke.color ? rgbHex(stroke.color, "#172033") : undefined;
    if (width > 0 && color) {
      notes.strokeWidthMm = (width * 25.4) / dpi;
      notes.strokeColor = color;
      notes.mapped.push("حد الطبقة");
    }
  }
  if (fx.innerShadow?.some((s) => s.enabled !== false)) notes.unsupported.push("ظل داخلي");
  if (fx.outerGlow?.enabled) notes.unsupported.push("توهج خارجي");
  if (fx.innerGlow?.enabled) notes.unsupported.push("توهج داخلي");
  if (fx.bevel?.enabled) notes.unsupported.push("Bevel / Emboss");
  if (fx.satin?.enabled) notes.unsupported.push("Satin");
  if (fx.gradientOverlay?.some((g) => g.enabled !== false)) notes.unsupported.push("تدرج لوني فوق الطبقة");
  if (fx.patternOverlay?.enabled) notes.unsupported.push("نقش Pattern");
  if (fx.solidFill?.some((f) => f.enabled !== false)) notes.unsupported.push("تعبئة لون فوق الطبقة");
  return notes;
}

function textOf(layer: Layer): PsdTextRun | null {
  const text = layer.text;
  if (!text || typeof text.text !== "string" || !text.text) return null;
  const style = text.style || {};
  const fontName = style.font?.name || "Unknown";
  const fontSize = typeof style.fontSize === "number" && style.fontSize > 0 ? style.fontSize : 16;
  const resolved = resolvePsdFont(fontName, !!style.fauxBold, !!style.fauxItalic);
  const justification = text.paragraphStyle?.justification || "left";
  const align = justification.startsWith("justify")
    ? "justify"
    : justification === "center" || justification === "right" || justification === "left"
      ? justification
      : "left";
  const leading = typeof style.leading === "number" && style.leading > 0 ? style.leading : fontSize * 1.2;
  const tracking = typeof style.tracking === "number" ? style.tracking : 0;
  const emMm = fontSize * 0.3528;
  return {
    content: text.text.replace(/\r\n?/g, "\n"),
    fontName: resolved.fontName,
    fontSize,
    fauxBold: !!style.fauxBold,
    fauxItalic: !!style.fauxItalic,
    underline: !!style.underline,
    color: rgbHex(style.fillColor && "r" in style.fillColor ? style.fillColor : undefined),
    align,
    lineHeight: Math.min(4, Math.max(0.8, leading / fontSize)),
    letterSpacingMm: (tracking / 1000) * emMm,
    direction: textDirection(text.text),
  };
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

async function readPixels(
  layer: Layer,
): Promise<{ width: number; height: number; data: Uint8Array } | null> {
  const image = layer.imageData;
  if (!image || image.width < 1 || image.height < 1 || !image.data) return null;
  const data = image.data instanceof Uint8Array ? image.data : new Uint8Array(image.data.buffer);
  if (data.length < image.width * image.height * 4) return null;
  return { width: image.width, height: image.height, data };
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
    issues.push(`مؤثرات غير محوّلة: ${effects.unsupported.join("، ")}`);
  }
  const blend = layer.blendMode || "normal";
  const cssBlend = CSS_BLEND[blend];
  if (blend !== "normal" && blend !== "pass through" && !cssBlend) {
    issues.push(`وضع المزج «${blend}» ليس له معادل في المحرر`);
  }
  if (layer.mask && !layer.mask.disabled) {
    issues.push("قناع الطبقة (Mask) لا يتحول إلى قناع نَسَق — أُبقيت البكسلات كما هي");
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
    const lines = text.content.split("\n");
    const longest = lines.reduce((m, line) => Math.max(m, line.length), 1);
    width = Math.max(text.fontSize * 0.55 * longest, text.fontSize * 2);
    height = Math.max(text.fontSize * text.lineHeight * lines.length, text.fontSize * 1.2);
    boundsEstimated = true;
    issues.push("إطار النص غير مخزّن في الملف، قُدّر من حجم الخط");
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
    rotation: rotationOf(layer.text?.transform || layer.placedLayer?.transform),
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
    node.kind = "text";
    node.text = text;
    return node;
  }

  const fill = layer.vectorFill;
  if (fill?.type === "color" && "color" in fill && fill.color && "r" in fill.color && node.width >= 1 && node.height >= 1) {
    node.kind = "shape";
    node.shape = {
      fill: rgbHex(fill.color),
      radiusPx: vector?.radius ?? 0,
      kind: vector?.kind ?? "rect",
    };
    if (fill.type === "color") return node;
  }
  if (fill && fill.type !== "color") {
    issues.push("تعبئة متجهية غير لون سادة — ستُستخدم البكسلات إن وُجدت");
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
    if (layer.placedLayer) issues.push("كائن ذكي حُوّل من نسخته النقطية داخل الملف");
    node.width = pixels.width;
    node.height = pixels.height;
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
