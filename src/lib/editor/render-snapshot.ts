/**
 * One browser renderer for preview, web and fidelity Office output.
 * Snapshot the non-interactive ElementNode tree at 96 CSS DPI, with computed
 * CSS, embedded images and fonts. Browser SVG/foreignObject rendering preserves
 * Arabic shaping, object-fit, clip paths, filters and nested transforms instead
 * of reimplementing CSS in html2canvas or an Office text-layout engine.
 */
import { getFontEmbedCSS, toSvg } from "html-to-image";
import { uploadedFontSources } from "../nsq/fonts";
import { mmToPx, pxToMm } from "./render-units";
import type { SceneImage, ScenePage } from "./scene";

export interface RenderTarget {
  node: HTMLElement;
  w: number;
  h: number;
}
export interface RenderSnapshot {
  svg: string;
  w: number;
  h: number;
}
let snapshotSequence = 0;
const CHROME =
  ".handle,.rotate-handle,.selection-layer,.overflow-badge,.print-guides,.guide-v,.guide-h,.snap-feedback,.crop-overlay,.crop-actions,.marquee";

export async function snapshotPage({
  node,
  w,
  h,
}: RenderTarget): Promise<RenderSnapshot> {
  // Trigger font loading with the actual text (important for unicode-range).
  await Promise.all(
    [node, ...node.querySelectorAll<HTMLElement>("*")].map(async (el) => {
      const cs = getComputedStyle(el);
      if (cs.fontFamily)
        await document.fonts.load(
          `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
          el.textContent || "نَسَق",
        );
    }),
  );
  await document.fonts.ready;
  await Promise.all(
    [...node.querySelectorAll("img")].map(async (img) => {
      if (!img.getAttribute("src")) return;
      try {
        await img.decode();
      } catch {
        throw new Error("تعذر تحميل إحدى الصور. تحقق من مصدرها قبل التصدير.");
      }
    }),
  );
  const uploaded = uploadedFontSources();
  const uploadedCSS = uploaded
    .map(
      ({ family, dataUrl }) =>
        `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(dataUrl)})}`,
    )
    .join("\n");
  const uploadedNames = new Set(uploaded.map((font) => font.family));
  const hasStylesheetFonts = [...document.fonts].some(
    (face) =>
      face.status === "loaded" &&
      !uploadedNames.has(face.family.replace(/^["']|["']$/g, "")),
  );
  // No registered CSS faces means the live artboard is already using local
  // system fonts. Do not retry an unavailable external stylesheet indefinitely.
  const fontEmbedCSS =
    (hasStylesheetFonts
      ? await getFontEmbedCSS(node, {
          includeQueryParams: true,
          imagePlaceholder: "FONT_EMBED_FAILED",
        })
      : "") + uploadedCSS;
  if (fontEmbedCSS.includes("FONT_EMBED_FAILED"))
    throw new Error(
      "تعذر تضمين الخطوط المستخدمة؛ تحقق من الاتصال وأعد المحاولة.",
    );
  // html-to-image 1.11 rounds every font size DOWN (and subtracts 0.1px).
  // That changes wrapping even though the copied CSS looks otherwise exact.
  // Carry original metrics through inert temporary attributes, then restore
  // them in the detached SVG; never resize the live artboard.
  const metricAttr = `data-nasaq-font-${++snapshotSequence}`;
  const elements = [node, ...node.querySelectorAll<HTMLElement>("*")];
  elements.forEach((el) =>
    el.setAttribute(metricAttr, getComputedStyle(el).fontSize),
  );
  let data: string;
  try {
    data = await toSvg(node, {
      width: mmToPx(w),
      height: mmToPx(h),
      fontEmbedCSS,
      includeQueryParams: true,
      // A missing image must fail, not silently become a hole in the document.
      imagePlaceholder: "data:image/png;base64,INVALID",
      filter: (el) => !el.matches?.(CHROME),
      style: {
        transform: "none",
        transformOrigin: "0 0",
        margin: "0",
        border: "0",
        borderRadius: "0",
        boxShadow: "none",
        overflow: "hidden",
        position: "relative",
        left: "0",
        top: "0",
      },
    });
  } finally {
    elements.forEach((el) => el.removeAttribute(metricAttr));
  }
  const doc = new DOMParser().parseFromString(
    decodeURIComponent(data.slice(data.indexOf(",") + 1)),
    "image/svg+xml",
  );
  const root = doc.documentElement;
  root.querySelectorAll<HTMLElement>(`[${metricAttr}]`).forEach((el) => {
    el.style.fontSize = el.getAttribute(metricAttr)!;
    el.removeAttribute(metricAttr);
  });
  root.setAttribute("viewBox", `0 0 ${mmToPx(w)} ${mmToPx(h)}`);
  // Computed clip-path URLs can be absolute to the editor document. Make every
  // local reference portable, including when this SVG is opened offline.
  root.querySelectorAll("[style]").forEach((el) => {
    el.setAttribute(
      "style",
      (el.getAttribute("style") || "").replace(
        /url\(["']?[^)"']*#([^\s)"']+)["']?\)/g,
        "url(#$1)",
      ),
    );
  });
  return { svg: new XMLSerializer().serializeToString(root), w, h };
}

export function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Explicit dimensions and scale: independent of devicePixelRatio/editor zoom. */
export async function paintSnapshot(
  snapshot: RenderSnapshot,
  scale: number,
): Promise<HTMLCanvasElement> {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("مقياس تصدير غير صالح");
  const width = Math.ceil(mmToPx(snapshot.w) * scale);
  const height = Math.ceil(mmToPx(snapshot.h) * scale);
  if (width * height > 64_000_000 || width > 16384 || height > 16384) {
    throw new Error("حجم الصورة كبير جدًا. قلّل دقة التصدير أو مقاس الصفحة.");
  }
  const image = new Image();
  image.src = svgDataUrl(snapshot.svg);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذر تجهيز محرّك الرسم");
  // Keep the requested scale even at fractional A4 pixel boundaries.
  ctx.drawImage(
    image,
    0,
    0,
    mmToPx(snapshot.w) * scale,
    mmToPx(snapshot.h) * scale,
  );
  return canvas;
}

/** Trim transparent padding only — never crop artwork to its unrotated box. */
export function trimLayer(
  canvas: HTMLCanvasElement,
  scale: number,
  name: string,
): SceneImage | null {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < left) return null;
  const crop = document.createElement("canvas");
  crop.width = right - left + 1;
  crop.height = bottom - top + 1;
  crop
    .getContext("2d")!
    .drawImage(
      canvas,
      left,
      top,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
  return {
    kind: "image",
    name,
    src: crop.toDataURL("image/png"),
    x: pxToMm(left / scale),
    y: pxToMm(top / scale),
    w: pxToMm(crop.width / scale),
    h: pxToMm(crop.height / scale),
    rotation: 0,
    fit: "fill",
    posX: 50,
    posY: 50,
    radius: 0,
  };
}

/** Render one isolated object, or the page paint when elementId is omitted.
 * Native Office reuses this renderer for paint/crop it cannot express, without
 * flattening unrelated text, tables or shapes or maintaining a second renderer. */
export async function snapshotLayer(
  snapshot: RenderSnapshot,
  elementId?: string,
  scale = 3,
  name = elementId ? "عنصر" : "خلفية الصفحة",
): Promise<SceneImage | null> {
  const doc = new DOMParser().parseFromString(snapshot.svg, "image/svg+xml");
  const page = doc.querySelector("[data-export-page]") as HTMLElement | null;
  if (!page) throw new Error("تعذر العثور على لوحة التصدير");
  const layers = [...page.children].filter((el) =>
    el.hasAttribute("data-el-id"),
  ) as HTMLElement[];
  const active = elementId
    ? layers.find((el) => el.getAttribute("data-el-id") === elementId)
    : undefined;
  if (elementId && !active) throw new Error("تعذر العثور على عنصر التصدير");
  for (const layer of layers)
    if (layer !== active) {
      for (const node of [layer, ...layer.querySelectorAll<HTMLElement>("*")])
        node.style.visibility = "hidden";
    }
  if (active) page.style.background = "transparent";
  const svg = new XMLSerializer().serializeToString(doc.documentElement);
  const canvas = await paintSnapshot({ ...snapshot, svg }, scale);
  try {
    return trimLayer(canvas, scale, name);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/**
 * Top-level objects stay separate and in paint order; groups remain atomic to
 * preserve group opacity/transform compositing. All text is shaped by the same
 * browser as the artboard, then stored as transparent lossless PNG, not retyped
 * by Office with a substitute font. The native editable writers remain opt-in.
 */
export async function snapshotLayers(
  snapshot: RenderSnapshot,
  scale = 3,
): Promise<ScenePage> {
  const doc = new DOMParser().parseFromString(snapshot.svg, "image/svg+xml");
  const page = doc.querySelector("[data-export-page]");
  if (!page) throw new Error("تعذر العثور على لوحة التصدير");
  const items: SceneImage[] = [];
  const background = await snapshotLayer(snapshot, undefined, scale);
  if (background) items.push(background);
  const layers = [...page.children].filter((el) =>
    el.hasAttribute("data-el-id"),
  );
  for (const [index, layer] of layers.entries()) {
    const item = await snapshotLayer(
      snapshot,
      layer.getAttribute("data-el-id")!,
      scale,
      `عنصر ${index + 1}`,
    );
    if (item) items.push(item);
  }
  return {
    w: snapshot.w,
    h: snapshot.h,
    background: "#ffffff",
    name: "",
    items,
  };
}

/** Self-contained HTML: identical fixed-position CSS, fonts and images. */
export function snapshotsHtml(
  snapshots: RenderSnapshot[],
  title: string,
): string {
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const styles = snapshots
    .map((p, i) => `@page page${i}{size:${p.w}mm ${p.h}mm;margin:0}`)
    .join("\n");
  const pages = snapshots
    .map((p, i) => {
      const doc = new DOMParser().parseFromString(p.svg, "image/svg+xml");
      const root = doc.querySelector("foreignObject")?.firstElementChild;
      if (!root) throw new Error("تعذر تجهيز HTML");
      // Import into the HTML document before serialization: XML's self-closing
      // div/span syntax would otherwise corrupt the standalone HTML tree.
      const clone = document.importNode(root, true) as HTMLElement;
      clone.querySelectorAll("style").forEach((style) => {
        style.textContent = (style.textContent || "").replace(/</g, "\\3c ");
      });
      const html = clone.outerHTML;
      return `<section style="position:relative;width:${mmToPx(p.w)}px;height:${mmToPx(p.h)}px;page:page${i}">${html}</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${styles}\nbody{margin:0;background:#e8eaef}section{margin:24px auto;overflow:hidden;break-after:page}section:last-child{break-after:auto}@media print{body{background:transparent}section{margin:0}}</style></head><body>${pages}</body></html>`;
}
