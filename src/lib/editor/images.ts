/** Formats accepted by the image intake path. */
const ACCEPTED = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i;

import type { CanvasEl, Page, Project } from "./model";

export interface PreparedImage {
  src: string;
  /** Intrinsic size in px, used to pick a sensible element box on drop. */
  width: number;
  height: number;
  /** True when the source was re-encoded rather than passed through. */
  resized: boolean;
}

export interface ImageLimits {
  /** Longest edge, in px, of the stored image. */
  maxEdge: number;
  /** Files at or below this size (bytes) are passed through untouched. */
  maxBytes: number;
}

export const IMAGE_LIMITS: ImageLimits = {
  // No intake ceiling: the original file is stored as picked.
  maxEdge: Number.POSITIVE_INFINITY,
  maxBytes: Number.POSITIVE_INFINITY,
};

export const IMAGE_ADJUSTMENT_PRESETS = {
  original: {
    label: "الأصلية",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    sharpness: 0,
  },
  natural: {
    label: "طبيعي",
    brightness: 104,
    contrast: 104,
    saturation: 96,
    sharpness: 12,
  },
  vivid: {
    label: "حيوي",
    brightness: 103,
    contrast: 112,
    saturation: 128,
    sharpness: 24,
  },
  document: {
    label: "مستند",
    brightness: 108,
    contrast: 128,
    saturation: 0,
    sharpness: 20,
  },
} as const;

export function isAcceptedImage(file: File): boolean {
  return ACCEPTED.test(file.type);
}

/** Keep every distinct selected file while removing browser duplicate entries. */
export function uniqueImageFiles(files: readonly File[]): File[] {
  return files.filter(
    (file, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.name === file.name &&
          candidate.size === file.size &&
          candidate.lastModified === file.lastModified,
      ) === index,
  );
}

/**
 * Allow only image sources that cannot execute script.
 */
export function safeImageSrc(src: unknown): string {
  const value = String(src ?? "").trim();
  if (!value) return "";
  if (
    /^data:image\/[a-z0-9.+-]+(;[a-z0-9-]+=[a-z0-9-]+)*(;base64)?,[\s\S]*$/i.test(
      value,
    )
  )
    return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^blob:/i.test(value)) return value;
  return "";
}

/**
 * True when a source is a PNG/JPEG/GIF/BMP data URL, the only raster shapes
 * `docx-writer` (`imageOptions`) and `pptxgenjs` embed verbatim. Every other
 * accepted source — `webp`, a remote `https://` URL, a `blob:` — has to be
 * rasterised to PNG before an Office export or the writers drop it.
 */
export function isOfficeEmbeddableRaster(src: unknown): boolean {
  return /^data:image\/(png|jpe?g|gif|bmp);base64,/i.test(String(src ?? ""));
}

/**
 * Draw any accepted raster image source to a PNG data URL.
 *
 * The Office writers embed raster bytes and only understand PNG/JPEG/GIF/BMP, so
 * a `webp` picture, a remote URL, or a legacy `blob:` source has to be painted
 * to a canvas first — otherwise it is silently missing from the exported
 * `.docx`/`.pptx`. Remote sources are requested CORS-anonymously so the canvas
 * stays untainted; an unreadable source returns "" so the caller keeps the
 * original element unchanged rather than losing it.
 */
export async function rasterSourceToPng(src: unknown): Promise<string> {
  const value = typeof src === "string" ? src.trim() : "";
  if (!value || value.startsWith("data:image/svg")) return "";
  const img = new Image();
  if (/^https?:\/\//i.test(value)) img.crossOrigin = "anonymous";
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image_load"));
      img.src = value;
    });
    if (!img.naturalWidth || !img.naturalHeight) return "";
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(img, 0, 0);
    const png = canvas.toDataURL("image/png");
    canvas.width = 0;
    canvas.height = 0;
    return png;
  } catch {
    return "";
  }
}

/**
 * Convert an ephemeral blob: URL into a durable data URL.
 *
 * AI image generation and canvas rasterisation both produce `blob:` URLs that
 * are invalidated the moment the owning Blob is revoked (which happens on page
 * reload, navigation, or garbage collection). If such a URL is persisted into
 * the document model and then the project is saved and reloaded, the image
 * silently disappears — the element survives but its pixels are gone.
 *
 * This reads the blob's bytes and re-encodes as a `data:` URL so the asset
 * is self-contained in the serialized project. Remote URLs are returned as-is
 * (they are server-durable and may already be cached as a platform asset);
 * already-durable data URLs are returned unchanged. Anything that looks like a
 * blob but fails to fetch is rejected with a clear error so the caller can
 * surface an actionable message instead of silently dropping the image.
 */
export async function durableImageSrc(src: string): Promise<string> {
  if (!src) return "";
  if (src.startsWith("data:")) return src;
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  if (src.startsWith("blob:")) {
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`blob_fetch_failed:${response.status}`);
      const blob = await response.blob();
      if (!ACCEPTED.test(blob.type)) {
        throw new Error(`blob_unsupported:${blob.type}`);
      }
      return await readAsDataUrl(blob);
    } catch (error) {
      throw new Error(
        `تعذر تحويل رابط الصورة المؤقت إلى بيانات دائمة: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return "";
}

/**
 * Recursively walk a project tree and convert any ephemeral `blob:` image
 * sources to durable `data:` URLs.
 *
 * Used by the `generate_document` / `generate_design` AI commands, which receive
 * a full `Project` object from the model. Those projects may carry blob URLs
 * produced by canvas rasterisation; without conversion, opening the document
 * after the blob has been revoked shows broken images.
 *
 * Non-blob sources (data:, http:, https:) are left untouched; elements without
 * a `src` (text, shape, etc.) are skipped.
 */
export async function sanitizeProjectImages(project: Project): Promise<Project> {
  async function walkElements(elements: CanvasEl[]): Promise<CanvasEl[]> {
    return Promise.all(
      elements.map(async (el) => {
        const next = { ...el };
        if (next.src) next.src = await durableImageSrc(next.src).catch(() => next.src);
        if (next.children?.length) next.children = await walkElements(next.children);
        return next;
      }),
    );
  }
  async function walkPage(page: Page): Promise<Page> {
    if (page.bgImage) {
      try {
        page.bgImage = await durableImageSrc(page.bgImage);
      } catch {
        /* keep original — the recovery in normalizeProject will clear it */
      }
    }
    if (page.elements?.length) page.elements = await walkElements(page.elements);
    return page;
  }
  const next = { ...project, pages: project.pages };
  next.pages = await Promise.all(next.pages.map(walkPage));
  return next;
}

function readAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر قراءة ملف الصورة"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("صيغة الصورة غير مدعومة"));
    img.src = src;
  });
}

/**
 * Turn a picked/dropped file into a data URL sized for a print page.
 */
export async function prepareImage(
  file: File,
  limits: ImageLimits = IMAGE_LIMITS,
): Promise<PreparedImage> {
  if (!isAcceptedImage(file)) throw new Error("نوع الملف ليس صورة مدعومة");

  const raw = await readAsDataUrl(file);
  if (file.type === "image/svg+xml") {
    const img = await loadImage(raw);
    return {
      src: raw,
      width: img.naturalWidth,
      height: img.naturalHeight,
      resized: false,
    };
  }

  const img = await loadImage(raw);
  const { naturalWidth: w, naturalHeight: h } = img;
  const longEdge = Math.max(w, h);
  const tooBig = longEdge > limits.maxEdge || file.size > limits.maxBytes;
  if (!tooBig) return { src: raw, width: w, height: h, resized: false };

  const scale = Math.min(1, limits.maxEdge / longEdge);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { src: raw, width: w, height: h, resized: false };

  // التحقق مما إذا كانت الصورة شفافة (PNG أو WebP) للحفاظ على الشفافية وعدم ملء الخلفية باللون الأبيض
  const isTransparent =
    file.type === "image/png" ||
    file.type === "image/webp" ||
    file.type === "image/gif";

  if (!isTransparent) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);
  }

  ctx.drawImage(img, 0, 0, tw, th);

  // الحفاظ على صيغة PNG إذا كانت الصورة الأصلية شفافة لضمان عدم ضياع القنوات الشفافة
  const mimeType = isTransparent ? "image/png" : "image/jpeg";
  const quality = isTransparent ? undefined : 0.92;

  return {
    src: canvas.toDataURL(mimeType, quality),
    width: tw,
    height: th,
    resized: true,
  };
}

/** CSS image adjustments. Defaults are identity values. */
export function imageAdjustCss(
  style: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    sharpness?: number;
  },
  sharpFilterId?: string,
): string | undefined {
  const parts: string[] = [];
  const sharpRaw = Number(style.sharpness);
  const sharp = Number.isFinite(sharpRaw)
    ? Math.max(0, Math.min(100, sharpRaw))
    : 0;
  if (sharp > 0 && sharpFilterId) parts.push(`url(#${sharpFilterId})`);
  else if (sharp > 0)
    parts.push(`contrast(${(1 + (sharp / 100) * 0.55).toFixed(3)})`);
  const contrast = Number(style.contrast);
  if (Number.isFinite(contrast) && Math.abs(contrast - 100) > 0.01) {
    parts.push(
      `contrast(${(Math.max(0, Math.min(200, contrast)) / 100).toFixed(3)})`,
    );
  }
  const saturation = Number(style.saturation);
  if (Number.isFinite(saturation) && Math.abs(saturation - 100) > 0.01) {
    parts.push(
      `saturate(${(Math.max(0, Math.min(200, saturation)) / 100).toFixed(3)})`,
    );
  }
  const brightness = Number(style.brightness);
  if (Number.isFinite(brightness) && Math.abs(brightness - 100) > 0.01) {
    parts.push(
      `brightness(${(Math.max(0, Math.min(200, brightness)) / 100).toFixed(3)})`,
    );
  }
  return parts.length ? parts.join(" ") : undefined;
}

/** 3×3 unsharp kernel. `amount` is 0–100; 0 is the identity kernel. */
export function sharpnessKernel(amount: number): string {
  const k = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  const n = (-k).toFixed(3);
  const c = (1 + 4 * k).toFixed(3);
  return `0 ${n} 0 ${n} ${c} ${n} 0 ${n} 0`;
}

/**
 * Fit an image's box to the page: keep the aspect ratio, cap the longest edge at
 * `maxMm`, and never exceed the page.
 */
export function fitImageBox(
  image: { width: number; height: number },
  maxMm: { w: number; h: number },
): { w: number; h: number } {
  const ratio =
    image.width > 0 && image.height > 0 ? image.width / image.height : 1.5;
  let w = maxMm.w;
  let h = w / ratio;
  if (h > maxMm.h) {
    h = maxMm.h;
    w = h * ratio;
  }
  return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
}

export interface ImagePlacementPage {
  w: number;
  h: number;
}

export interface ImagePlacementOptions {
  /** Insertion order on this page; zero is centered and later items are spread out. */
  sequence?: number;
  /** Exact page-space centre for a drop. Drop placement does not receive an offset. */
  at?: { x: number; y: number };
  /** Logo intent uses the smaller 40mm cap instead of the normal 80mm cap. */
  intent?: "image" | "logo";
}

export interface PlacedImageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function halton(index: number, base: number): number {
  let fraction = 1 / base;
  let result = 0;
  let value = index;
  while (value > 0) {
    result += fraction * (value % base);
    value = Math.floor(value / base);
    fraction /= base;
  }
  return result;
}

/** Pick a professional initial frame while keeping the whole image inside its page. */
export function placeImageBox(
  image: { width: number; height: number },
  page: ImagePlacementPage,
  options: ImagePlacementOptions = {},
): PlacedImageBox {
  const pageW = Math.max(1, Number(page.w) || 1);
  const pageH = Math.max(1, Number(page.h) || 1);
  const maxEdge = options.intent === "logo" ? 40 : 80;
  const box = fitImageBox(image, {
    w: Math.min(pageW, maxEdge),
    h: Math.min(pageH, maxEdge),
  });
  const rawSequence = Number(options.sequence);
  const sequence = Number.isFinite(rawSequence)
    ? Math.max(0, Math.floor(rawSequence))
    : 0;
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const maxX = Math.max(0, pageW - box.w);
  const maxY = Math.max(0, pageH - box.h);
  const pickerCentres = [
    { x: pageW / 2, y: pageH / 2 },
    { x: halfW, y: halfH },
    { x: pageW - halfW, y: halfH },
    { x: halfW, y: pageH - halfH },
    { x: pageW - halfW, y: pageH - halfH },
    { x: pageW / 2, y: halfH },
    { x: pageW / 2, y: pageH - halfH },
  ];
  const centre = options.at ??
    pickerCentres[sequence] ?? {
      x: halfW + halton(sequence - pickerCentres.length + 1, 2) * maxX,
      y: halfH + halton(sequence - pickerCentres.length + 1, 3) * maxY,
    };
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  return {
    x: Math.round(clamp(centre.x - halfW, 0, maxX) * 100) / 100,
    y: Math.round(clamp(centre.y - halfH, 0, maxY) * 100) / 100,
    w: box.w,
    h: box.h,
  };
}

/**
 * Natural pixel size of an image the document ALREADY painted.
 *
 * The pre-flight's DPI check needs pixels per placed millimetre, and the only
 * honest source is the decoded image itself. Rather than keep a second registry
 * that can fall behind the model, this reads the size straight off the rendered
 * `<img>` the editor (or the hidden export page) has already loaded — so the
 * check costs nothing and cannot disagree with what the author sees.
 *
 * Returns null when the source is not on screen, and the caller then SKIPS the
 * check rather than guessing a resolution.
 */
export function domImageSize(
  src: string,
  root: ParentNode | null = typeof document === "undefined" ? null : document,
): { w: number; h: number } | null {
  if (!root) return null;
  const target = safeImageSrc(src);
  if (!target) return null;
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const candidate = img.getAttribute("src") || img.src;
    if (candidate !== target && img.src !== target) continue;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { w: img.naturalWidth, h: img.naturalHeight };
    }
  }
  return null;
}

/**
 * A reusable image-size resolver.
 *
 * `domImageSize` walks EVERY `<img>` in the document for every call, which makes
 * a pre-flight run quadratic: N images × M rendered `<img>` nodes. On a 30-page
 * report with the export dialog open that is tens of thousands of comparisons
 * on each re-render — the dialog stuttered, and the export button felt blocked
 * by work that has nothing to do with exporting.
 *
 * Building the index once per document revision turns the same check into one
 * pass over the DOM plus O(1) lookups, so pre-flight stays instant no matter
 * how long the document is.
 */
export function imageSizeResolver(
  root: ParentNode | null = typeof document === "undefined" ? null : document,
): (src: string) => { w: number; h: number } | null {
  let index: Map<string, { w: number; h: number }> | null = null;
  const build = () => {
    const map = new Map<string, { w: number; h: number }>();
    if (!root) return map;
    for (const img of Array.from(root.querySelectorAll("img"))) {
      if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) continue;
      const size = { w: img.naturalWidth, h: img.naturalHeight };
      const attr = img.getAttribute("src");
      if (attr) map.set(attr, size);
      if (img.src) map.set(img.src, size);
    }
    return map;
  };
  return (src: string) => {
    const target = safeImageSrc(src);
    if (!target) return null;
    index ??= build();
    return index.get(target) ?? null;
  };
}
