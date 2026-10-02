/**
 * Turn a parsed PSD document into a native NASAQ project.
 *
 * Coordinates are millimetres. Text stays text. Uniform bitmaps become
 * shapes. Photographs stay images, linked by content hash when the library
 * already has those bytes. Unsupported layers are skipped or rasterised and
 * always listed — the conversion does not pretend they were native.
 */

import { uid } from "../../utils";
import type { CanvasEl, ElStyle, Page, Project } from "../model";
import { resolvePsdFont } from "./fonts";
import type {
  AssetFinding,
  ConversionReport,
  FallbackFinding,
  FontFinding,
  PsdDocument,
  PsdLibraryRef,
  PsdNode,
  PsdPage,
} from "./types";

export interface ConvertOptions {
  library?: PsdLibraryRef[];
  ids?: () => string;
  now?: number;
}

export interface Conversion {
  project: Project;
  report: ConversionReport;
}

const pxToMm = (px: number, dpi: number) => Math.round(((px * 25.4) / dpi) * 100) / 100;

function safeMm(px: number, dpi: number, floor = 0.4): number {
  return Math.max(floor, pxToMm(Math.max(0, px), dpi));
}

interface Acc {
  dpi: number;
  ids: () => string;
  library: Map<string, PsdLibraryRef>;
  fonts: Map<string, FontFinding>;
  assets: AssetFinding[];
  fallbacks: FallbackFinding[];
  native: number;
  layerCount: number;
  groupCount: number;
  imageCount: number;
  textCount: number;
  shapeCount: number;
}

function rememberFont(acc: Acc, node: PsdNode, layerId: string): { family: string; weight: number; italic: boolean } {
  const text = node.text!;
  const resolved = resolvePsdFont(text.fontName, text.fauxBold, text.fauxItalic);
  const prev = acc.fonts.get(resolved.fontName);
  if (prev) prev.layerIds.push(layerId);
  else {
    acc.fonts.set(resolved.fontName, {
      fontName: resolved.fontName,
      family: resolved.family,
      weight: resolved.weight,
      italic: resolved.italic,
      status: resolved.status,
      layerIds: [layerId],
    });
  }
  return resolved;
}

function noteFallback(acc: Acc, node: PsdNode, mode: FallbackFinding["mode"], reason: string) {
  acc.fallbacks.push({ layerId: node.id, layerName: node.name, mode, reason });
}

function elementBase(acc: Acc, node: PsdNode, type: CanvasEl["type"], partial: boolean): CanvasEl {
  const reason = node.issues[0];
  return {
    id: acc.ids(),
    type,
    name: node.name,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: node.rotation || 0,
    opacity: node.opacity,
    z: 1,
    hidden: node.hidden || undefined,
    style: {},
    source: {
      kind: "psd",
      layerId: node.id,
      layerName: node.name,
      ...(partial ? { fallback: "partial" as const, reason } : {}),
    },
  };
}

function applyCommonStyle(el: CanvasEl, node: PsdNode): void {
  if (node.cssBlend && node.cssBlend !== "normal") {
    el.style.blendMode = node.cssBlend as ElStyle["blendMode"];
  }
  if (node.effects.shadow) el.style.shadow = node.effects.shadow;
}

function placeBox(node: PsdNode, dpi: number): { x: number; y: number; w: number; h: number } {
  return {
    x: pxToMm(node.left, dpi),
    y: pxToMm(node.top, dpi),
    w: safeMm(node.width, dpi),
    h: safeMm(node.height, dpi),
  };
}

function convertNode(node: PsdNode, acc: Acc): CanvasEl | null {
  acc.layerCount += 1;
  if (node.kind === "group") {
    acc.groupCount += 1;
    const children = node.children
      .map((child) => convertNode(child, acc))
      .filter((el): el is CanvasEl => !!el);
    if (!children.length) {
      noteFallback(acc, node, "skipped", "مجموعة فارغة بعد التحويل");
      return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of children) {
      minX = Math.min(minX, child.x);
      minY = Math.min(minY, child.y);
      maxX = Math.max(maxX, child.x + child.w);
      maxY = Math.max(maxY, child.y + child.h);
    }
    for (const child of children) {
      child.x = Math.round((child.x - minX) * 100) / 100;
      child.y = Math.round((child.y - minY) * 100) / 100;
    }
    const el = elementBase(acc, node, "group", node.issues.length > 0);
    el.x = Math.round(minX * 100) / 100;
    el.y = Math.round(minY * 100) / 100;
    el.w = Math.max(0.4, Math.round((maxX - minX) * 100) / 100);
    el.h = Math.max(0.4, Math.round((maxY - minY) * 100) / 100);
    el.children = children;
    applyCommonStyle(el, node);
    if (node.blendMode === "pass through") {
      el.source = { ...el.source!, reason: el.source?.reason };
    }
    acc.native += 1;
    if (node.issues.length) noteFallback(acc, node, "partial", node.issues.join(" · "));
    return el;
  }

  if (node.kind === "adjustment" || node.kind === "empty") {
    noteFallback(
      acc,
      node,
      "skipped",
      node.issues[0] || "لا يوجد مقابل أصلي لهذه الطبقة",
    );
    return null;
  }

  if (node.kind === "text" && node.text) {
    const box = placeBox(node, acc.dpi);
    const font = rememberFont(acc, node, node.id);
    const el = elementBase(acc, node, "text", node.issues.length > 0 || node.boundsEstimated);
    el.x = box.x;
    el.y = box.y;
    el.w = box.w;
    el.h = box.h;
    el.content = node.text.content;
    el.style = {
      fontFamily: font.family,
      fontSize: node.text.fontSize,
      fontWeight: font.weight,
      fontStyle: font.italic ? "italic" : "normal",
      underline: node.text.underline || undefined,
      color: node.text.color,
      textAlign: node.text.align,
      lineHeight: node.text.lineHeight,
      letterSpacing: node.text.letterSpacingMm ? Math.round(node.text.letterSpacingMm * 100) / 100 : undefined,
      direction: node.text.direction,
      textBoxMode: "fixed",
    };
    if (node.effects.strokeColor && node.effects.strokeWidthMm) {
      el.style.textShadow = `0 0 ${node.effects.strokeWidthMm}mm ${node.effects.strokeColor}`;
    }
    applyCommonStyle(el, node);
    acc.textCount += 1;
    acc.native += 1;
    if (node.issues.length) noteFallback(acc, node, "partial", node.issues.join(" · "));
    return el;
  }

  if (node.kind === "shape" && node.shape) {
    const box = placeBox(node, acc.dpi);
    const el = elementBase(acc, node, "shape", node.issues.length > 0);
    el.x = box.x;
    el.y = box.y;
    el.w = box.w;
    el.h = box.h;
    const radiusMm = pxToMm(node.shape.radiusPx, acc.dpi);
    el.style = {
      fill: node.shape.fill,
      borderColor: node.effects.strokeColor || node.shape.fill,
      borderWidth: node.effects.strokeWidthMm || 0,
      radius: node.shape.kind === "circle" ? Math.min(el.w, el.h) / 2 : radiusMm,
      shape: node.shape.kind === "circle" ? "circle" : node.shape.kind === "rounded" ? "rounded" : "rect",
      shapeId: node.shape.kind === "circle" ? "circle" : node.shape.kind === "rounded" ? "rounded" : "rect",
    };
    applyCommonStyle(el, node);
    acc.shapeCount += 1;
    acc.native += 1;
    if (node.issues.length) noteFallback(acc, node, "partial", node.issues.join(" · "));
    return el;
  }

  if (node.kind === "pixels" && node.image) {
    const box = placeBox(node, acc.dpi);
    const match = acc.library.get(node.image.hash) || null;
    const el = elementBase(acc, node, "image", node.issues.length > 0);
    el.x = box.x;
    el.y = box.y;
    el.w = box.w;
    el.h = box.h;
    el.src = node.image.dataUrl;
    el.style = {
      objectFit: "fill",
      radius: 0,
      borderColor: node.effects.strokeColor,
      borderWidth: node.effects.strokeWidthMm || 0,
    };
    applyCommonStyle(el, node);
    acc.imageCount += 1;
    acc.assets.push({
      hash: node.image.hash,
      name: node.name,
      layerId: node.id,
      elementId: el.id,
      dataUrl: node.image.dataUrl,
      width: node.image.width,
      height: node.image.height,
      match: match ? { assetId: match.assetId, name: match.name } : null,
    });
    const raster = node.issues.some((issue) => issue.includes("ذكي") || issue.includes("حد الاستخراج"));
    if (raster) {
      noteFallback(acc, node, "raster", node.issues.join(" · "));
      el.source = { ...el.source!, fallback: "raster", reason: node.issues[0] };
    } else if (node.issues.length) {
      noteFallback(acc, node, "partial", node.issues.join(" · "));
      el.source = { ...el.source!, fallback: "partial", reason: node.issues[0] };
      acc.native += 1;
    } else {
      acc.native += 1;
    }
    return el;
  }

  noteFallback(acc, node, "skipped", node.issues[0] || "طبقة غير مدعومة");
  return null;
}

function linkClipping(nodes: PsdNode[], elements: CanvasEl[], acc: Acc) {
  const byLayer = new Map<string, CanvasEl>();
  const walk = (els: CanvasEl[]) => {
    for (const el of els) {
      if (el.source?.layerId) byLayer.set(el.source.layerId, el);
      if (el.children) walk(el.children);
    }
  };
  walk(elements);
  const visit = (list: PsdNode[]) => {
    let base: PsdNode | null = null;
    for (const node of list) {
      if (node.kind === "group") {
        visit(node.children);
        base = null;
        continue;
      }
      if (!node.clipping) {
        base = node;
        continue;
      }
      const el = byLayer.get(node.id);
      const mask = base ? byLayer.get(base.id) : undefined;
      if (el && mask && (mask.type === "shape" || mask.type === "svg") && mask.children === undefined) {
        // Same sibling list: the mask must be a direct sibling, which it is
        // when both were converted inside this list.
        const siblings = elementsContain(elements, el.id);
        if (siblings?.some((s) => s.id === mask.id)) el.clippedBy = mask.id;
        else {
          // recorded below
        }
      } else if (el) {
        const reason = "علاقة القص لا تشير إلى شكل نَسَق في نفس المجموعة";
        el.source = {
          ...el.source!,
          fallback: el.source?.fallback || "partial",
          reason,
        };
        if (!acc.fallbacks.some((item) => item.layerId === node.id && item.reason === reason)) {
          acc.fallbacks.push({ layerId: node.id, layerName: node.name, mode: "partial", reason });
        }
      }
      // Clipped layers still clip to the same base in Photoshop.
    }
  };
  visit(nodes);
}

function elementsContain(roots: CanvasEl[], id: string): CanvasEl[] | null {
  if (roots.some((el) => el.id === id)) return roots;
  for (const el of roots) {
    if (el.children) {
      const found = elementsContain(el.children, id);
      if (found) return found;
    }
  }
  return null;
}

function assignZ(els: CanvasEl[], start = 1): number {
  let z = start;
  for (const el of els) {
    el.z = z++;
    if (el.children?.length) z = assignZ(el.children, z);
  }
  return z;
}

function convertPage(page: PsdPage, acc: Acc, index: number): Page {
  const elements = page.nodes
    .map((node) => convertNode(node, acc))
    .filter((el): el is CanvasEl => !!el);
  linkClipping(page.nodes, elements, acc);
  assignZ(elements);
  let w = pxToMm(page.widthPx, acc.dpi);
  let h = pxToMm(page.heightPx, acc.dpi);
  // `pageSize` treats anything ≤ 10mm as "missing" and snaps back to A4.
  if (w <= 10 || h <= 10) {
    const boost = 12 / Math.max(0.1, Math.min(w, h));
    w = Math.round(w * boost * 100) / 100;
    h = Math.round(h * boost * 100) / 100;
    const scaleTree = (els: CanvasEl[]) => {
      for (const el of els) {
        el.x = Math.round(el.x * boost * 100) / 100;
        el.y = Math.round(el.y * boost * 100) / 100;
        el.w = Math.round(el.w * boost * 100) / 100;
        el.h = Math.round(el.h * boost * 100) / 100;
        if (el.children) scaleTree(el.children);
      }
    };
    scaleTree(elements);
    acc.fallbacks.push({
      layerId: `page-${index}`,
      layerName: page.name,
      mode: "partial",
      reason: "أبعاد الصفحة كانت أصغر من حد نَسَق (10مم) فكُبّرت مع الحفاظ على النسبة",
    });
  }
  return {
    id: acc.ids(),
    name: page.name || `صفحة ${index + 1}`,
    bg: "#ffffff",
    w,
    h,
    elements,
  };
}

export function convertPsdDocument(doc: PsdDocument, options: ConvertOptions = {}): Conversion {
  const acc: Acc = {
    dpi: doc.dpi || 72,
    ids: options.ids || (() => uid("psd")),
    library: new Map((options.library || []).map((row) => [row.hash, row])),
    fonts: new Map(),
    assets: [],
    fallbacks: [],
    native: 0,
    layerCount: 0,
    groupCount: 0,
    imageCount: 0,
    textCount: 0,
    shapeCount: 0,
  };
  const pages = doc.pages.map((page, index) => convertPage(page, acc, index));
  const title = doc.fileName.replace(/\.ps[db]$/i, "") || "مستند PSD";
  const project: Project = {
    version: 2,
    nativeFormat: 1,
    name: title,
    theme: "official",
    orgName: "",
    transactionNo: "",
    pages,
    createdAt: options.now || Date.now(),
    defaultSize: "custom",
    pack: "blank",
    nsqOrigin: {
      createdWith: "nasaq-psd",
      firstSavedAt: options.now || Date.now(),
    },
  };
  const completion = Math.round((acc.native / Math.max(1, acc.layerCount)) * 100);
  const first = pages[0];
  const report: ConversionReport = {
    fileName: doc.fileName,
    dpi: acc.dpi,
    widthPx: doc.widthPx,
    heightPx: doc.heightPx,
    widthMm: first?.w || 0,
    heightMm: first?.h || 0,
    pageCount: pages.length,
    layerCount: acc.layerCount,
    groupCount: acc.groupCount,
    imageCount: acc.imageCount,
    textCount: acc.textCount,
    shapeCount: acc.shapeCount,
    nativeCount: acc.native,
    fallbackCount: acc.fallbacks.filter((f) => f.mode !== "partial").length,
    fonts: [...acc.fonts.values()],
    assets: acc.assets,
    fallbacks: acc.fallbacks,
    completion,
  };
  return { project, report };
}
