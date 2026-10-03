/** Formats accepted by the image intake path. */
const ACCEPTED = /^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i;

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
