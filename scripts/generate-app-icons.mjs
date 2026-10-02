#!/usr/bin/env node
/**
 * App-icon pass: derives the PWA icon set (192 / 512 / maskable 512) from the
 * existing 180px brand tile — no browser, no image dependency.
 *
 * The tile (`public/__grok/icon-180.png`, RGB8) is decoded by hand (zlib
 * inflate + PNG unfiltering), resampled with bilinear interpolation, and
 * re-encoded. The maskable variant re-centres the tile inside the brand
 * emerald at 80% so launcher masks never clip the glyph.
 *
 * Run: node scripts/generate-app-icons.mjs
 */
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "public/__grok/icon-180.png");
const OUT = join(ROOT, "public/icons");
mkdirSync(OUT, { recursive: true });

/* ── PNG decode (8-bit, non-interlaced, any colour type we ship) ────────── */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG unsupported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`colour type ${colorType} unsupported`);
  const raw = Buffer.concat(idat);
  const inflated = inflateSync(raw);
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const line = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    unfilter(filter, line, prev, cur, channels);
    prev = cur;
  }
  return { width, height, channels, pixels: out };
}

function unfilter(filter, line, prev, cur, channels) {
  for (let x = 0; x < line.length; x++) {
    const a = x >= channels ? cur[x - channels] : 0;
    const b = prev[x];
    const c = x >= channels ? prev[x - channels] : 0;
    let value = line[x];
    switch (filter) {
      case 1:
        value += a;
        break;
      case 2:
        value += b;
        break;
      case 3:
        value += (a + b) >> 1;
        break;
      case 4: {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        break;
      }
      default:
        break;
    }
    cur[x] = value & 0xff;
  }
}

/* ── resample + encode ──────────────────────────────────────────────────── */
function sample(pixels, width, height, channels, x, y) {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const i = (cy * width + cx) * channels;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

function resize(src, target) {
  const { width, height, channels, pixels } = src;
  const out = Buffer.alloc(target * target * 3);
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      const sx = ((x + 0.5) * width) / target - 0.5;
      const sy = ((y + 0.5) * height) / target - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const p00 = sample(pixels, width, height, channels, x0, y0);
      const p10 = sample(pixels, width, height, channels, x0 + 1, y0);
      const p01 = sample(pixels, width, height, channels, x0, y0 + 1);
      const p11 = sample(pixels, width, height, channels, x0 + 1, y0 + 1);
      const o = (y * target + x) * 3;
      for (let c = 0; c < 3; c++) {
        const top = p00[c] + (p10[c] - p00[c]) * fx;
        const bottom = p01[c] + (p11[c] - p01[c]) * fx;
        out[o + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return out;
}

/** Maskable: brand emerald field, tile centred at 80% (safe zone). */
function maskable(rgb, size) {
  const field = Buffer.alloc(size * size * 3);
  const inner = Math.round(size * 0.8);
  const offset = Math.round((size - inner) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 3;
      field[o] = 0x00;
      field[o + 1] = 0x6c;
      field[o + 2] = 0x35;
      const ix = x - offset;
      const iy = y - offset;
      if (ix >= 0 && iy >= 0 && ix < inner && iy < inner) {
        const s = (iy * inner + ix) * 3;
        field[o] = rgb[s];
        field[o + 1] = rgb[s + 1];
        field[o + 2] = rgb[s + 2];
      }
    }
  }
  return field;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++)
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // no filter
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const source = decodePng(readFileSync(SOURCE));
for (const size of [192, 512]) {
  const rgb = resize(source, size);
  writeFileSync(join(OUT, `nasaq-${size}.png`), encodePng(rgb, size));
}
const mask = maskable(resize(source, 512), 512);
writeFileSync(join(OUT, "nasaq-maskable-512.png"), encodePng(mask, 512));
console.log("icons written to public/icons");
