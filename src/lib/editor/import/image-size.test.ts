import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { imageSizeFromBytes, imageSizeFromDataUrl } from "./image-size.ts";

/** Minimal PNG with a known IHDR. */
function png(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const dv = new DataView(bytes.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return bytes;
}

/** Minimal JPEG with an APP0 segment, then one SOF0 carrying the dimensions. */
function jpeg(w: number, h: number): Uint8Array {
  const payload = new Uint8Array(15); // length(2) + precision(1) + h(2) + w(2) + rest(8)
  const dv = new DataView(payload.buffer);
  dv.setUint16(0, 17);
  payload[2] = 8;
  dv.setUint16(3, h);
  dv.setUint16(5, w);
  const bytes = new Uint8Array(2 + 2 + 4 + 2 + payload.length);
  bytes.set([0xff, 0xd8], 0);
  bytes.set([0xff, 0xe0], 2); // APP0 marker
  bytes.set([0x00, 0x04, 0x4a, 0x46], 4); // length 4 + "JF"
  bytes.set([0xff, 0xc0], 8); // SOF0 marker
  bytes.set(payload, 10);
  return bytes;
}

function gif(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  const dv = new DataView(bytes.buffer);
  dv.setUint16(6, w, true);
  dv.setUint16(8, h, true);
  return bytes;
}

function webpLossless(w: number, h: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  bytes[20] = 0x2f; // lossless signature
  // 14 bits width-1, then 14 bits height-1, little-endian bit packing.
  const bits = (w - 1) | ((h - 1) << 14);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(21, bits, true);
  return bytes;
}

const toDataUrl = (mime: string, bytes: Uint8Array) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

describe("image-size — header-only reads", () => {
  it("reads PNG dimensions", () => {
    assert.deepEqual(imageSizeFromBytes(png(1240, 1754)), { w: 1240, h: 1754 });
  });

  it("reads JPEG dimensions past the APP0 segment", () => {
    assert.deepEqual(imageSizeFromBytes(jpeg(1920, 1080)), { w: 1920, h: 1080 });
  });

  it("reads GIF dimensions", () => {
    assert.deepEqual(imageSizeFromBytes(gif(320, 240)), { w: 320, h: 240 });
  });

  it("reads lossless WebP dimensions", () => {
    assert.deepEqual(imageSizeFromBytes(webpLossless(550, 368)), { w: 550, h: 368 });
  });

  it("reads a data URL without decoding the whole bitmap", () => {
    const url = toDataUrl("image/png", png(800, 600));
    assert.deepEqual(imageSizeFromDataUrl(url), { w: 800, h: 600 });
  });

  it("returns null for unknown bytes and SVG", () => {
    assert.equal(imageSizeFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), null);
    assert.equal(imageSizeFromDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), null);
    assert.equal(imageSizeFromDataUrl(undefined), null);
    assert.equal(imageSizeFromDataUrl("not-a-data-url"), null);
  });

  it("tolerates a truncated base64 tail", () => {
    const url = toDataUrl("image/png", png(640, 480));
    const cut = `${url.slice(0, 100)}A`; // broken quantum at the end
    assert.deepEqual(imageSizeFromDataUrl(cut), { w: 640, h: 480 });
  });
});
