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
  // Report pages render at A4 print scale, so ~1600px on the long edge stays
  // sharp at 300dpi for a half-page figure while keeping stored projects small.
  maxEdge: 1600,
  maxBytes: 400_000,
};

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
