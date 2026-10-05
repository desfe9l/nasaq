/**
 * PDF → editable NASAQ pages, where the file actually contains text or images.
 *
 * PDF has no layer tree. Extracted text becomes text elements and decoded
 * images become image elements. A scanned page with neither is kept at its
 * real size and reported — it is not replaced by a pretended reconstruction.
 */

import type { OPS as OpsNs } from "pdfjs-dist";
import { type Box, ImportBuilder, dataUrlFrom, ptToMm, round2 } from "./shared";
import { encodeRgbaPng } from "./png-encode";

interface PdfText {
  str: string;
  width: number;
  height: number;
  transform: number[];
  hasEOL?: boolean;
  dir?: string;
}

interface PdfImage {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray;
}

interface PdfPage {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  getTextContent: () => Promise<{ items: unknown[] }>;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  render?: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> };
  objs: { get: (id: string, callback: (value: PdfImage) => void) => void };
}

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void> | void;
}

interface PdfjsApi {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
  OPS: typeof OpsNs;
  VerbosityLevel: { ERRORS: number };
}

const paintCodes = { save: 10, restore: 11, transform: 12 };

function isText(item: unknown): item is PdfText {
  if (!item || typeof item !== "object") return false;
  const row = item as Partial<PdfText>;
  return typeof row.str === "string" && Array.isArray(row.transform);
}

async function loadPdfjs(): Promise<PdfjsApi> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsApi;
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    if (typeof window === "undefined") {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        import.meta.url,
      ).href;
    } else {
      const mod = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")) as { default: string };
      pdfjs.GlobalWorkerOptions.workerSrc = mod.default;
    }
  }
  return pdfjs;
}

function mul(m: number[], n: number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

function imagesFromOps(ops: { fnArray: number[]; argsArray: unknown[][] }, paint: number, pageH: number): { box: Box; name: string; index: number }[] {
  const stack: number[][] = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const found: { box: Box; name: string; index: number }[] = [];
  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const raw = ops.argsArray[i];
    const args = Array.isArray(raw) ? raw : [];
    if (fn === paintCodes.save) stack.push(ctm.slice());
    else if (fn === paintCodes.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === paintCodes.transform) {
      const matrix = Array.isArray(args[0]) || ArrayBuffer.isView(args[0])
        ? Array.from(args[0] as ArrayLike<unknown>)
        : args;
      if (matrix.length >= 6) ctm = mul(ctm, matrix.slice(0, 6).map((n) => Number(n)));
    } else if (fn === paint && typeof args[0] === "string") {
      const [a, , , d, e, f] = ctm;
      const w = Math.abs(a);
      const h = Math.abs(d);
      if (w < 1 || h < 1) continue;
      const bottom = d >= 0 ? f : f + d;
      found.push({
        index: i,
        name: args[0],
        box: {
          x: round2(ptToMm(e)),
          y: round2(ptToMm(pageH - (bottom + h))),
          w: round2(ptToMm(w)),
          h: round2(ptToMm(h)),
        },
      });
    }
  }
  return found;
}

interface PdfVectorPath {
  box: Box;
  markup: string;
  name: string;
  index: number;
}

interface PdfVectorExtraction {
  paths: PdfVectorPath[];
  skipped: number;
  unsupported: number;
}

interface PdfGraphicsState {
  ctm: number[];
  fill: string | null;
  stroke: string | null;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  dash: string;
  blendMode: string;
}

const MAX_VECTOR_PATHS = 512;
const MAX_VECTOR_SEGMENTS = 20_000;
const MAX_VECTOR_MARKUP = 2_000_000;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function pdfColor(values: unknown[], mode: "rgb" | "gray" | "cmyk"): string {
  const raw = values.length === 1 && (Array.isArray(values[0]) || ArrayBuffer.isView(values[0]))
    ? Array.from(values[0] as ArrayLike<unknown>)
    : values;
  const nums = raw.map((value) => Number(value));
  const byte = (n: number) => Math.round(clamp01(n) * 255);
  let rgb: number[];
  if (mode === "gray") {
    const value = nums[0] ?? 0;
    const gray = byte(value > 1 ? value / 255 : value);
    rgb = [gray, gray, gray];
  } else if (mode === "cmyk") {
    const [c = 0, m = 0, y = 0, k = 0] = nums.map((value) => clamp01(value > 1 ? value / 255 : value));
    rgb = [byte(1 - Math.min(1, c + k)), byte(1 - Math.min(1, m + k)), byte(1 - Math.min(1, y + k))];
  } else {
    rgb = nums.slice(0, 3).map((value) => byte(value > 1 ? value / 255 : value));
  }
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function vectorPathsFromOps(
  ops: { fnArray: number[]; argsArray: unknown[][] },
  OPS: PdfjsApi["OPS"],
  pageH: number,
): PdfVectorExtraction {
  const state: PdfGraphicsState = {
    ctm: [1, 0, 0, 1, 0, 0],
    fill: "#000000",
    stroke: "#000000",
    fillAlpha: 1,
    strokeAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    dash: "",
    blendMode: "normal",
  };
  const stack: PdfGraphicsState[] = [];
  const paths: PdfVectorPath[] = [];
  const pathParts: string[] = [];
  const bounds: [number, number][] = [];
  const result: PdfVectorExtraction = { paths, skipped: 0, unsupported: 0 };
  let currentX = 0;
  let currentY = 0;
  let segments = 0;
  let clipped = false;
  let pendingClip: { d: string; bounds: [number, number][]; ctm: number[]; evenOdd: boolean } | null = null;

  const argsAt = (index: number): unknown[] => {
    const value = ops.argsArray[index] as unknown;
    if (Array.isArray(value)) return value;
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<unknown>);
    return [];
  };
  const addPoint = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 1_000_000 && Math.abs(y) <= 1_000_000) {
      bounds.push([x, y]);
    }
  };
  const clearPath = () => {
    pathParts.length = 0;
    bounds.length = 0;
    currentX = 0;
    currentY = 0;
  };
  const closePath = () => {
    if (pathParts.length) pathParts.push("Z");
  };
  const svgNumber = (value: number) => Number(value.toFixed(3)).toString();
  const emitPath = (index: number, doFill: boolean, doStroke: boolean, evenOdd: boolean) => {
    if (!pathParts.length || !bounds.length || paths.length >= MAX_VECTOR_PATHS || segments > MAX_VECTOR_SEGMENTS) {
      if (pathParts.length && (paths.length >= MAX_VECTOR_PATHS || segments > MAX_VECTOR_SEGMENTS)) result.skipped += 1;
      clearPath();
      return;
    }
    const d = pathParts.join(" ");
    const corners = bounds.flatMap(([x, y]) => {
      const [a, b, c, d, e, f] = state.ctm;
      return [[a * x + c * y + e, b * x + d * y + f] as [number, number]];
    });
    const xs = corners.map((point) => point[0]);
    const ys = corners.map((point) => point[1]);
    const minX = Math.max(-1_000_000, Math.min(...xs));
    const maxX = Math.min(1_000_000, Math.max(...xs));
    const minY = Math.max(-1_000_000, Math.min(...ys));
    const maxY = Math.min(1_000_000, Math.max(...ys));
    if (!(maxX >= minX && maxY >= minY)) {
      result.skipped += 1;
      clearPath();
      return;
    }
    const minRegionPt = 0.4 * (72 / 25.4);
    const widthPt = Math.max(minRegionPt, maxX - minX);
    const heightPt = Math.max(minRegionPt, maxY - minY);
    const [a, b, c, dMatrix, e, f] = state.ctm;
    const translateX = e - minX;
    const translateY = maxY - f;
    const transform = `matrix(${svgNumber(a)} ${svgNumber(-b)} ${svgNumber(c)} ${svgNumber(-dMatrix)} ${svgNumber(translateX)} ${svgNumber(translateY)})`;
    const fill = doFill && state.fill && state.fillAlpha > 0 ? state.fill : "none";
    const stroke = doStroke && state.stroke && state.strokeAlpha > 0 ? state.stroke : "none";
    const strokeAttrs = stroke === "none" ? "" : ` stroke="${stroke}" stroke-width="${svgNumber(Math.max(0.01, state.lineWidth))}" stroke-linecap="${state.lineCap}" stroke-linejoin="${state.lineJoin}"${state.dash ? ` stroke-dasharray="${state.dash}"` : ""}${state.strokeAlpha < 1 ? ` stroke-opacity="${svgNumber(state.strokeAlpha)}"` : ""}`;
    const fillAttrs = fill === "none" ? "" : ` fill="${fill}" fill-rule="${evenOdd ? "evenodd" : "nonzero"}"${state.fillAlpha < 1 ? ` fill-opacity="${svgNumber(state.fillAlpha)}"` : ""}`;
    const blend = state.blendMode !== "normal" ? ` style="mix-blend-mode:${state.blendMode}"` : "";
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgNumber(widthPt)} ${svgNumber(heightPt)}"><path d="${d}" transform="${transform}"${fillAttrs}${strokeAttrs}${blend}/></svg>`;
    if (markup.length > MAX_VECTOR_MARKUP) result.skipped += 1;
    else {
      const w = ptToMm(widthPt);
      const h = ptToMm(heightPt);
      paths.push({
        index,
        name: `رسم PDF ${paths.length + 1}`,
        box: {
          x: round2(ptToMm(minX)),
          y: round2(ptToMm(pageH - maxY)),
          w: round2(Math.max(0.4, w)),
          h: round2(Math.max(0.4, h)),
        },
        markup,
      });
    }
    clearPath();
  };

  for (let i = 0; i < ops.fnArray.length; i += 1) {
    const fn = ops.fnArray[i];
    const args = argsAt(i);
    if (fn === OPS.save) {
      stack.push({ ...state, ctm: state.ctm.slice() });
    } else if (fn === OPS.restore) {
      const previous = stack.pop();
      if (previous) Object.assign(state, previous);
    } else if (fn === OPS.transform) {
      const matrix = Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? Array.from(args[0] as ArrayLike<number>) : args.map(Number);
      if (matrix.length >= 6 && matrix.slice(0, 6).every(Number.isFinite)) state.ctm = mul(state.ctm, matrix.slice(0, 6));
    } else if (fn === OPS.setLineWidth) {
      state.lineWidth = Math.max(0.01, Math.min(10_000, Number(args[0]) || 1));
    } else if (fn === OPS.setLineCap) {
      state.lineCap = ["butt", "round", "square"][Math.max(0, Math.min(2, Number(args[0]) || 0))] || "butt";
    } else if (fn === OPS.setLineJoin) {
      state.lineJoin = ["miter", "round", "bevel"][Math.max(0, Math.min(2, Number(args[0]) || 0))] || "miter";
    } else if (fn === OPS.setDash) {
      const dash = Array.isArray(args[0]) || ArrayBuffer.isView(args[0]) ? Array.from(args[0] as ArrayLike<number>).map(Number) : [];
      state.dash = dash.length && dash.length <= 16 && dash.every((value) => Number.isFinite(value) && value >= 0) ? dash.map(svgNumber).join(" ") : "";
    } else if (fn === OPS.setFillRGBColor) state.fill = pdfColor(args, "rgb");
    else if (fn === OPS.setStrokeRGBColor) state.stroke = pdfColor(args, "rgb");
    else if (fn === OPS.setFillGray) state.fill = pdfColor(args, "gray");
    else if (fn === OPS.setStrokeGray) state.stroke = pdfColor(args, "gray");
    else if (fn === OPS.setFillCMYKColor) state.fill = pdfColor(args, "cmyk");
    else if (fn === OPS.setStrokeCMYKColor) state.stroke = pdfColor(args, "cmyk");
    else if (fn === OPS.setFillTransparent) state.fill = null;
    else if (fn === OPS.setStrokeTransparent) state.stroke = null;
    else if (fn === OPS.setFillColorN || fn === OPS.setStrokeColorN) {
      result.unsupported += 1;
      // Pattern/color-space paint is approximated with a visible neutral
      // fallback instead of making the affected path disappear.
      if (fn === OPS.setFillColorN) state.fill = "#aeb8c4";
      if (fn === OPS.setStrokeColorN) state.stroke = "#aeb8c4";
    } else if (fn === OPS.shadingFill) {
      result.unsupported += 1;
      if (pendingClip) {
        const previous = { ...state, ctm: state.ctm.slice() };
        clearPath();
        pathParts.push(pendingClip.d);
        bounds.push(...pendingClip.bounds);
        state.ctm = pendingClip.ctm;
        state.fill = "#aeb8c4";
        state.fillAlpha = 0.7;
        state.stroke = null;
        emitPath(i, true, false, pendingClip.evenOdd);
        Object.assign(state, previous);
        pendingClip = null;
      }
    } else if (fn === OPS.setGState) {
      const entries = Array.isArray(args[0]) ? args[0] as unknown[] : args;
      for (const entry of entries) {
        const row = Array.isArray(entry) ? entry : entry && typeof entry === "object" ? Object.entries(entry as Record<string, unknown>)[0] : null;
        if (!Array.isArray(row) || row.length < 2) continue;
        const [key, value] = row;
        if (key === "ca") state.fillAlpha = clamp01(Number(value));
        else if (key === "CA") state.strokeAlpha = clamp01(Number(value));
        else if (key === "BM" && typeof value === "string") {
          const blendNames: Record<string, string> = { Multiply: "multiply", Screen: "screen", Overlay: "overlay", Darken: "darken", Lighten: "lighten" };
          state.blendMode = blendNames[value] || "normal";
          if (!blendNames[value] && value !== "Normal") result.unsupported += 1;
        }
      }
    } else if (fn === OPS.constructPath) {
      const pathOps = args[0] as ArrayLike<number> | undefined;
      const pathValues = args[1] as ArrayLike<number> | undefined;
      if (!pathOps || !pathValues || pathOps.length > MAX_VECTOR_SEGMENTS || pathValues.length > MAX_VECTOR_SEGMENTS * 6) {
        result.skipped += 1;
        clearPath();
        continue;
      }
      let cursor = 0;
      for (let p = 0; p < pathOps.length; p += 1) {
        const code = Number(pathOps[p]);
        const read = (offset: number) => Number(pathValues[cursor + offset]);
        if (code === OPS.moveTo || code === OPS.lineTo) {
          const x = read(0);
          const y = read(1);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { result.skipped += 1; break; }
          pathParts.push(`${code === OPS.moveTo ? "M" : "L"}${svgNumber(x)} ${svgNumber(y)}`);
          addPoint(x, y);
          currentX = x;
          currentY = y;
          cursor += 2;
          segments += 1;
        } else if (code === OPS.curveTo) {
          const values = [read(0), read(1), read(2), read(3), read(4), read(5)];
          if (!values.every(Number.isFinite)) { result.skipped += 1; break; }
          pathParts.push(`C${values.map(svgNumber).join(" ")}`);
          addPoint(currentX, currentY); addPoint(values[0]!, values[1]!); addPoint(values[2]!, values[3]!); addPoint(values[4]!, values[5]!);
          currentX = values[4]!; currentY = values[5]!;
          cursor += 6;
          segments += 1;
        } else if (code === OPS.curveTo2 || code === OPS.curveTo3) {
          const values = [read(0), read(1), read(2), read(3)];
          if (!values.every(Number.isFinite)) { result.skipped += 1; break; }
          const c1x = code === OPS.curveTo2 ? currentX : values[0]!;
          const c1y = code === OPS.curveTo2 ? currentY : values[1]!;
          const c2x = code === OPS.curveTo2 ? values[0]! : values[2]!;
          const c2y = code === OPS.curveTo2 ? values[1]! : values[3]!;
          const endX = values[2]!;
          const endY = values[3]!;
          pathParts.push(`C${svgNumber(c1x)} ${svgNumber(c1y)} ${svgNumber(c2x)} ${svgNumber(c2y)} ${svgNumber(endX)} ${svgNumber(endY)}`);
          addPoint(currentX, currentY); addPoint(c1x, c1y); addPoint(c2x, c2y); addPoint(endX, endY);
          currentX = endX; currentY = endY;
          cursor += 4;
          segments += 1;
        } else if (code === OPS.closePath) {
          closePath();
          segments += 1;
        } else if (code === OPS.rectangle) {
          const [x, y, width, height] = [read(0), read(1), read(2), read(3)];
          if (![x, y, width, height].every(Number.isFinite)) { result.skipped += 1; break; }
          pathParts.push(`M${svgNumber(x)} ${svgNumber(y)} L${svgNumber(x + width)} ${svgNumber(y)} L${svgNumber(x + width)} ${svgNumber(y + height)} L${svgNumber(x)} ${svgNumber(y + height)} Z`);
          addPoint(x, y); addPoint(x + width, y + height); addPoint(x + width, y); addPoint(x, y + height);
          currentX = x; currentY = y;
          cursor += 4;
          segments += 1;
        } else {
          result.skipped += 1;
          break;
        }
        if (segments > MAX_VECTOR_SEGMENTS || pathParts.join(" ").length > MAX_VECTOR_MARKUP) {
          result.skipped += 1;
          clearPath();
          break;
        }
      }
    } else if (fn === OPS.clip || fn === OPS.eoClip) {
      clipped = true;
      result.unsupported += 1;
      pendingClip = pathParts.length ? {
        d: pathParts.join(" "),
        bounds: bounds.slice(),
        ctm: state.ctm.slice(),
        evenOdd: fn === OPS.eoClip,
      } : null;
      clearPath();
    } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
      pendingClip = null;
      if (fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) closePath();
      const fill = fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
      const stroke = fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fillStroke || fn === OPS.eoFillStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke;
      emitPath(i, fill, stroke, fn === OPS.eoFill || fn === OPS.eoFillStroke || fn === OPS.closeEOFillStroke);
    } else if (fn === OPS.endPath) {
      clearPath();
    }
  }
  if (clipped) result.unsupported += 1;
  return result;
}

async function imageSrc(image: PdfImage): Promise<string | null> {
  const w = image.width || 0;
  const h = image.height || 0;
  const data = image.data;
  if (!w || !h || !data || w * h > 6_000_000) return null;
  let rgba: Uint8Array;
  if (data.length === w * h * 4) rgba = data instanceof Uint8Array ? data : new Uint8Array(data);
  else if (data.length === w * h * 3) {
    rgba = new Uint8Array(w * h * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j] = data[i];
      rgba[j + 1] = data[i + 1];
      rgba[j + 2] = data[i + 2];
      rgba[j + 3] = 255;
    }
  } else return null;
  const png = await encodeRgbaPng(w, h, rgba);
  return dataUrlFrom("image/png", png);
}

export async function rasterPageFallback(page: PdfPage, widthPt: number, heightPt: number): Promise<string | null> {
  if (typeof document === "undefined" || !page.render || widthPt <= 0 || heightPt <= 0) return null;
  const scale = Math.min(2, 2048 / Math.max(widthPt, heightPt), Math.sqrt(4_000_000 / (widthPt * heightPt)));
  if (!Number.isFinite(scale) || scale < 0.01) return null;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function importPdfBytes(bytes: Uint8Array, fileName: string, ids?: () => string): Promise<ReturnType<ImportBuilder["finish"]>> {
  const pdfjs = await loadPdfjs();
  let doc: PdfDoc;
  try {
    doc = await pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      verbosity: pdfjs.VerbosityLevel?.ERRORS ?? 0,
    }).promise;
  } catch {
    throw new Error("تعذر قراءة ملف PDF. قد يكون تالفًا أو محميًا بكلمة مرور.");
  }
  const builder = new ImportBuilder("pdf", fileName, ids);
  builder.note(
    "PDF",
    "partial",
    "PDF بلا طبقات. يُستخرج النص والصور، وتُحوّل مسارات الرسم الشائعة إلى SVG متجهي قابل للتعديل. تدرجات الألوان والقص والأقنعة المعقدة تبقى ضمن التنبيهات.",
  );
  let colorNoted = false;
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const pageH = view.height;
      const sheet = builder.addPage(`صفحة ${n}`, ptToMm(view.width), ptToMm(pageH));
      const content = await page.getTextContent();
      const items = content.items.filter(isText).filter((item) => item.str.trim() || item.hasEOL);
      let line: PdfText[] = [];
      const flush = () => {
        if (!line.length) return;
        const text = line.map((item) => item.str).join("");
        const first = line[0];
        const last = line[line.length - 1];
        const size = Math.max(first.height || 0, Math.hypot(first.transform[0] || 0, first.transform[1] || 0)) || 12;
        const x = Math.min(...line.map((item) => item.transform[4] || 0));
        const baseline = first.transform[5] || 0;
        const width = Math.max(size, (last.transform[4] || 0) + (last.width || 0) - x);
        const dir = first.dir === "rtl" ? "rtl" : first.dir === "ltr" ? "ltr" : undefined;
        builder.text(
          sheet,
          {
            x: ptToMm(x),
            y: ptToMm(pageH - baseline - size * 0.92),
            w: ptToMm(width + size * 0.2),
            h: ptToMm(size * 1.35),
          },
          text,
          { fontSize: round2(size), direction: dir, fontFamily: "Tajawal" },
          "نص",
        );
        line = [];
      };
      for (const item of items) {
        if (line.length) {
          const gap = (item.transform[4] || 0) - ((line[line.length - 1].transform[4] || 0) + (line[line.length - 1].width || 0));
          const same = Math.abs((item.transform[5] || 0) - (line[0].transform[5] || 0)) < 2.5;
          if (!same || gap > Math.max(8, (item.height || 12) * 1.4)) flush();
          else if (gap > (item.height || 12) * 0.25 && !item.str.startsWith(" ")) item.str = ` ${item.str}`;
        }
        line.push(item);
        if (item.hasEOL) flush();
      }
      flush();
      if (!colorNoted && builder.texts) {
        colorNoted = true;
        builder.note("لون النص", "partial", "ملفات PDF لا تحتفظ دائمًا بلون الخط كنص قابل للتحرير؛ استُخدم لون النص الافتراضي عند غيابه.");
      }
      try {
        const ops = await page.getOperatorList();
        const placed = imagesFromOps(ops, pdfjs.OPS.paintImageXObject, pageH);
        const vectors = vectorPathsFromOps(ops, pdfjs.OPS, pageH);
        let missed = 0;
        const draws = [
          ...placed.map((row) => ({ index: row.index, type: "image" as const, row })),
          ...vectors.paths.map((row) => ({ index: row.index, type: "vector" as const, row })),
        ].sort((a, b) => a.index - b.index);
        for (const draw of draws) {
          if (draw.type === "image") {
            const image = await new Promise<PdfImage>((resolve) => page.objs.get(draw.row.name, resolve));
            const src = await imageSrc(image);
            if (!src) {
              missed += 1;
              continue;
            }
            builder.image(sheet, draw.row.box, src, "صورة PDF", "موضع الصورة مأخوذ من مصفوفة الرسم وقد يختلف قليلًا عن الأصل.");
          } else {
            builder.svg(sheet, draw.row.box, draw.row.markup, draw.row.name);
          }
        }
        if (missed) {
          builder.note(`صفحة ${n}`, "partial", `${missed} صورة داخل PDF لم تُفك كعنصر مستقل. النص المستخرج بقي كما هو.`);
        }
        if (vectors.skipped) {
          builder.note(`مسارات صفحة ${n}`, "partial", `${vectors.skipped} مسارات معقدة أو تجاوزت حد الاستخراج الآمن ولم تُحوّل؛ بقية العناصر بقيت قابلة للتحرير.`);
        }
        if (vectors.unsupported) {
          builder.note(`مؤثرات صفحة ${n}`, "partial", `تعذّر تمثيل ${vectors.unsupported} عملية نقش/تدرج/قص/مزج بدقة؛ استُخدم لون محايد تقريبي حيث أمكن.`);
        }
      } catch {
        builder.note(`صفحة ${n}`, "partial", "تعذر قراءة عمليات الرسم. النص المستخرج بقي قابلًا للتحرير.");
      }
      if (!sheet.elements.length) {
        const fallback = await rasterPageFallback(page, view.width, pageH);
        if (fallback) {
          builder.image(
            sheet,
            { x: 0, y: 0, w: ptToMm(view.width), h: ptToMm(pageH) },
            fallback,
            `صفحة PDF ${n} — صورة احتياطية`,
            "تعذر استخراج عناصر قابلة للتحرير؛ أُدرجت صورة الصفحة الأصلية كبديل مرئي.",
          );
          builder.note(`صفحة ${n}`, "flattened", "تعذر استخراج عناصر قابلة للتحرير؛ حُفظت الصفحة كصورة أصلية مرئية بدلاً من إسقاط محتواها.");
        } else {
          builder.note(`صفحة ${n}`, "skipped", "لا نص أو صورة أو مسارات قابلة للاستخراج، وتعذر إنشاء صورة احتياطية لهذه الصفحة.");
        }
      }
    }
  } finally {
    await doc.destroy();
  }
  if (!builder.pages.length) throw new Error("ملف PDF لا يحتوي صفحات.");
  return builder.finish();
}
