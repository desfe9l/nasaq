/**
 * PNG, JPEG and SVG become a one-page editable NASAQ document.
 *
 * The bitmap stays the image element — the page is only the frame — so this
 * is not a flattened substitute for a design that had layers.
 */

import { sanitizeSvgContent } from "../svg";
import { ImportBuilder, dataUrlFrom, round2 } from "./shared";

function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.byteLength < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < bytes.byteLength) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) + bytes[i + 3];
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { w: (bytes[i + 7] << 8) + bytes[i + 8], h: (bytes[i + 5] << 8) + bytes[i + 6] };
    }
    i += 2 + len;
  }
  return null;
}

function fitMm(w: number, h: number): { w: number; h: number } {
  let width = w;
  let height = h;
  const long = Math.max(width, height);
  if (long > 420) {
    const scale = 420 / long;
    width *= scale;
    height *= scale;
  }
  const short = Math.min(width, height);
  if (short < 12) {
    const scale = 12 / Math.max(short, 0.1);
    width *= scale;
    height *= scale;
  }
  return { w: round2(width), h: round2(height) };
}

function frame(pxW: number, pxH: number): { w: number; h: number } {
  return fitMm((pxW * 25.4) / 96, (pxH * 25.4) / 96);
}

function lengthToMm(raw: string | undefined, fallbackPx: number): number {
  if (!raw) return (fallbackPx * 25.4) / 96;
  const match = /^([\d.]+)\s*(mm|cm|in|px)?$/i.exec(raw.trim());
  if (!match) return (fallbackPx * 25.4) / 96;
  const n = Number(match[1]);
  const unit = (match[2] || "px").toLowerCase();
  if (unit === "mm") return n;
  if (unit === "cm") return n * 10;
  if (unit === "in") return n * 25.4;
  return (n * 25.4) / 96;
}

function svgFrame(text: string): { w: number; h: number } {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] || "";
  const view = /viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i.exec(tag);
  const wAttr = /(?:^|\s)width=["']([^"']+)["']/i.exec(tag)?.[1];
  const hAttr = /(?:^|\s)height=["']([^"']+)["']/i.exec(tag)?.[1];
  const fallbackW = view ? Number(view[1]) : 800;
  const fallbackH = view ? Number(view[2]) : 500;
  const w = wAttr ? lengthToMm(wAttr, fallbackW) : (fallbackW * 25.4) / 96;
  const h = hAttr ? lengthToMm(hAttr, fallbackH) : (fallbackH * 25.4) / 96;
  return fitMm(w, h);
}

/**
 * Sanitise an imported SVG file.
 *
 * `sanitizeSvgContent` is the editor's single allow-list walk. It used to be
 * browser-only, so this function carried a regex fallback for the server path —
 * and that fallback only removed a `<script>` BLOCK and a WHITESPACE-preceded
 * `on…` attribute, so `<svg/onload=…>`, `<foreignObject>` and `<style>` all
 * survived an import that ran without a DOM. The allow-list now has a DOM-free
 * tokenizer behind it (`./svg-scrub`), so there is exactly one rule set and no
 * weaker path to fall through to.
 */
function safeSvg(raw: string): string {
  const clean = sanitizeSvgContent(raw);
  if (!clean || !/<svg[\s>]/i.test(clean)) throw new Error("ملف SVG غير صالح.");
  return clean;
}

export async function importImageBytes(
  bytes: Uint8Array,
  fileName: string,
  format: "png" | "jpg" | "svg",
  ids?: () => string,
): Promise<ReturnType<ImportBuilder["finish"]>> {
  const builder = new ImportBuilder(format, fileName, ids);
  if (format === "svg") {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const markup = safeSvg(text);
    const size = svgFrame(text);
    const page = builder.addPage("صورة", size.w, size.h);
    builder.svg(page, { x: 0, y: 0, w: size.w, h: size.h }, markup, "SVG");
    builder.note("SVG", "editable", "الرسم متجه قابل للتحرير. النصوص داخله تبقى جزءًا من الرسم لا فقرات مستقلة.");
    return builder.finish();
  }
  const sizePx = format === "png" ? pngSize(bytes) : jpegSize(bytes);
  if (!sizePx || sizePx.w < 1 || sizePx.h < 1) {
    throw new Error(format === "png" ? "ملف PNG غير صالح أو تالف." : "ملف JPG غير صالح أو تالف.");
  }
  const size = frame(sizePx.w, sizePx.h);
  const page = builder.addPage("صورة", size.w, size.h);
  const mime = format === "png" ? "image/png" : "image/jpeg";
  builder.image(page, { x: 0, y: 0, w: size.w, h: size.h }, dataUrlFrom(mime, bytes), "صورة");
  builder.note(
    "صورة",
    "editable",
    `أصل ${sizePx.w}×${sizePx.h}px كعنصر صورة واحد. الصفحة إطار للطباعة وليست طبقة مسطحة بديلة.`,
  );
  return builder.finish();
}
