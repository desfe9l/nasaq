/**
 * PNG encoding and content identity for extracted PSD pixels.
 *
 * Hashes are SHA-256 of the exact PNG bytes stored in the document, so a
 * second import of the same file matches the library copy without using the
 * layer name.
 */

const MAX_ENCODE_PIXELS = 24_000_000;

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc);
  return out;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const cs = new CompressionStream("deflate");
  const stream = new Blob([copy]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<Uint8Array | null> {
  if (width < 1 || height < 1) return null;
  if (width * height > MAX_ENCODE_PIXELS) return null;
  if (rgba.length < width * height * 4) return null;
  const raw = new Uint8Array((width * 4 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    const start = y * width * 4;
    raw.set(rgba.subarray(start, start + width * 4), o);
    o += width * 4;
  }
  const idat = await zlibDeflate(raw);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const size = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, i + step);
    bin += String.fromCharCode(...slice);
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function pngDataUrl(
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<{ dataUrl: string; bytes: Uint8Array } | null> {
  const png = await encodePng(width, height, rgba);
  if (!png) return null;
  return { dataUrl: bytesToDataUrl(png, "image/png"), bytes: png };
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function dataUrlToBytes(src: string): Uint8Array | null {
  const comma = src.indexOf(",");
  if (comma < 0 || !src.startsWith("data:")) return null;
  if (src.length > 18_000_000) return null;
  const meta = src.slice(0, comma);
  const body = src.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      const bin = atob(body);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  } catch {
    return null;
  }
}

/** True when sampled pixels share one colour (a rectangle, not a photograph). */
export function uniformColor(
  rgba: Uint8Array,
  width: number,
  height: number,
): { r: number; g: number; b: number; a: number } | null {
  const count = width * height;
  if (count < 1 || rgba.length < count * 4) return null;
  const step = Math.max(1, Math.floor(count / 4000));
  const r0 = rgba[0] ?? 0;
  const g0 = rgba[1] ?? 0;
  const b0 = rgba[2] ?? 0;
  const a0 = rgba[3] ?? 0;
  for (let i = 0; i < count; i += step) {
    const o = i * 4;
    if (
      Math.abs((rgba[o] ?? 0) - r0) > 2 ||
      Math.abs((rgba[o + 1] ?? 0) - g0) > 2 ||
      Math.abs((rgba[o + 2] ?? 0) - b0) > 2 ||
      Math.abs((rgba[o + 3] ?? 0) - a0) > 2
    ) {
      return null;
    }
  }
  return { r: r0, g: g0, b: b0, a: a0 };
}
