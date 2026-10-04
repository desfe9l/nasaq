/**
 * Header-only image dimensions for imported assets.
 *
 * The repair engine needs an image's intrinsic aspect ratio to catch a
 * stretched frame, but decoding the bitmap would cost a full data-URL parse
 * (and a canvas) per asset. Every common raster format stores its dimensions
 * in the first few hundred bytes, so a prefix read is enough — no dependency,
 * no decode, safe inside a worker.
 *
 * Supported: PNG, JPEG, GIF and WebP (VP8 / VP8L / VP8X). SVG has no intrinsic
 * pixel size and returns null; the caller treats null as «unknown, skip».
 */

const PREFIX_CHARS = 131_072; // ~96 KB of bytes once base64-decoded.

function base64ToBytes(text: string, from: number, to: number): Uint8Array {
  // Strip whitespace so a wrapped data URL still decodes.
  const slice = text.slice(from, to).replace(/[^A-Za-z0-9+/]/g, "");
  if (!slice) return new Uint8Array(0);
  // Pad the tail so atob never throws on a cut quantum.
  const usable = slice.slice(0, slice.length - (slice.length % 4));
  if (!usable) return new Uint8Array(0);
  let binary: string;
  try {
    binary = atob(usable);
  } catch {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function readUint16BE(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  // Signature (8) + length (4) + "IHDR" (4), then width and height, big-endian.
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }
  const w =
    ((bytes[16] ?? 0) << 24) |
    ((bytes[17] ?? 0) << 16) |
    ((bytes[18] ?? 0) << 8) |
    (bytes[19] ?? 0);
  const h =
    ((bytes[20] ?? 0) << 24) |
    ((bytes[21] ?? 0) << 16) |
    ((bytes[22] ?? 0) << 8) |
    (bytes[23] ?? 0);
  if (w <= 0 || h <= 0) return null;
  return { w, h };
}

function gifSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 10) return null;
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  const w = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const h = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  if (w <= 0 || h <= 0) return null;
  return { w, h };
}

function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  // Walk the marker segments to SOF0..SOF15 (skipping the standalone markers).
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    // TEM, RSTn and standalone markers carry no length.
    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd9)
    ) {
      at += 2;
      continue;
    }
    const length = readUint16BE(bytes, at + 2);
    // SOF0–SOF15 except DHT (0xc4), DAC (0xcc) and JPG (0xc8): height then width.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const h = readUint16BE(bytes, at + 5);
      const w = readUint16BE(bytes, at + 7);
      if (w > 0 && h > 0) return { w, h };
      return null;
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 30) return null;
  const tag4 = (at: number) =>
    String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (tag4(0) !== "RIFF" || tag4(8) !== "WEBP") return null;
  const tag = tag4(12);
  if (tag === "VP8 ") {
    // Lossy: 3-byte frame tag, then sync code 0x9d 0x01 0x2a, then 14 bits × 14 bits.
    const at = 20;
    if ((bytes[at] ?? 0) !== 0x9d || (bytes[at + 1] ?? 0) !== 0x01 || (bytes[at + 2] ?? 0) !== 0x2a) {
      return null;
    }
    const w = ((bytes[at + 4] ?? 0) | ((bytes[at + 5] ?? 0) << 8)) & 0x3fff;
    const h = ((bytes[at + 6] ?? 0) | ((bytes[at + 7] ?? 0) << 8)) & 0x3fff;
    if (w > 0 && h > 0) return { w, h };
    return null;
  }
  if (tag === "VP8L") {
    // Lossless: signature 0x2f, then 14 bits width−1 / 14 bits height−1.
    const at = 21;
    if ((bytes[20] ?? 0) !== 0x2f) return null;
    const bits = (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 3] ?? 0) << 24);
    const w = (bits & 0x3fff) + 1;
    const h = ((bits >> 14) & 0x3fff) + 1;
    if (w > 0 && h > 0) return { w, h };
    return null;
  }
  if (tag === "VP8X") {
    // Extended: 24-bit canvas width−1 / height−1, little-endian, at offset 24.
    const w = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const h = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    if (w > 0 && h > 0) return { w, h };
    return null;
  }
  return null;
}

/** Dimensions of a `data:image/…;base64,…` URL, read from its header only. */
export function imageSizeFromDataUrl(src: string | undefined): { w: number; h: number } | null {
  if (!src || !src.startsWith("data:image/")) return null;
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const head = src.slice(5, comma); // e.g. "image/png;base64"
  const body = src.slice(comma + 1);
  const bytes = base64ToBytes(body, 0, PREFIX_CHARS);
  if (!bytes.length) return null;
  if (head.startsWith("image/png")) return pngSize(bytes);
  if (head.startsWith("image/gif")) return gifSize(bytes);
  if (head.startsWith("image/jpeg") || head.startsWith("image/jpg")) return jpegSize(bytes);
  if (head.startsWith("image/webp")) return webpSize(bytes);
  return null;
}

/** Dimensions of raw encoded bytes, read from their header only. */
export function imageSizeFromBytes(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 12) return null;
  return pngSize(bytes) ?? gifSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes);
}
