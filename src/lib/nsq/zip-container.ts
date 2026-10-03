/** ZIP preflight BEFORE decompression. ZIP64/encrypted/multidisk files are not NSQ. */
import type JSZip from "jszip";
import { isSafeEntryPath, NSQ_LIMITS, NsqError } from "./format.ts";

export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
  crc: number;
}
export function inspectZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (n: number) => view.getUint16(n, true);
  const u32 = (n: number) => view.getUint32(n, true);
  const fail = (reason: string): never => {
    throw new NsqError("corrupt", reason);
  };
  if (bytes.length < 22) fail("zip header");
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)
      break;
  }
  if (end < Math.max(0, bytes.length - 65557)) fail("zip directory missing");
  const count = u16(end + 10),
    length = u32(end + 12),
    start = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || count !== u16(end + 8))
    fail("multidisk zip");
  if (count > NSQ_LIMITS.maxEntries)
    throw new NsqError("too-large", "entry count");
  if (!count || start + length !== end) fail("zip directory bounds");
  const entries = new Map<string, ZipEntry>();
  const ranges: [number, number][] = [];
  let at = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail("zip entry");
    const flags = u16(at + 8),
      method = u16(at + 10);
    const compressed = u32(at + 20),
      size = u32(at + 24);
    const n = u16(at + 28),
      extra = u16(at + 30),
      comment = u16(at + 32);
    const offset = u32(at + 42);
    if (flags & 1 || (method !== 0 && method !== 8) || u16(at + 34))
      fail("zip encoding");
    if (!n || at + 46 + n + extra + comment > end) fail("zip name bounds");
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(at + 46, at + 46 + n),
      );
    } catch {
      return fail("zip filename encoding");
    }
    const path = name.endsWith("/") ? name.slice(0, -1) : name;
    if (!isSafeEntryPath(path) || entries.has(name))
      throw new NsqError("invalid", "unsafe or duplicate zip path");
    total += size;
    if (total > NSQ_LIMITS.maxUncompressedBytes)
      throw new NsqError("too-large", "expanded zip");
    if (offset + 30 > start || u32(offset) !== 0x04034b50) fail("local entry");
    const localNameLength = u16(offset + 26),
      localExtra = u16(offset + 28);
    const dataStart = offset + 30 + localNameLength + localExtra;
    if (
      dataStart + compressed > start ||
      u16(offset + 8) !== method ||
      u16(offset + 6) !== flags
    )
      fail("local bounds/encoding");
    if (
      new TextDecoder().decode(
        bytes.subarray(offset + 30, offset + 30 + localNameLength),
      ) !== name
    )
      fail("local name mismatch");
    ranges.push([offset, dataStart + compressed]);
    entries.set(name, { name, size, compressed, crc: u32(at + 16) });
    at += 46 + n + extra + comment;
  }
  if (at !== end) fail("directory size mismatch");
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((r, i) => i && r[0] < ranges[i - 1][1]))
    fail("overlapping entries");
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** Bounded inflation with CRC verification; never use file.async on untrusted data. */
export function readZipEntry(
  zip: JSZip,
  entries: Map<string, ZipEntry>,
  name: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const meta = entries.get(name),
    file = zip.file(name);
  if (!meta || !file)
    return Promise.reject(new NsqError("missing-asset", name));
  if (meta.size > maxBytes)
    return Promise.reject(new NsqError("too-large", name));
  return new Promise((resolve, reject) => {
    const output = new Uint8Array(meta.size);
    let offset = 0,
      crc = 0xffffffff,
      failed = false;
    // JSZip exposes file.internalStream at runtime; its published object
    // typings omit it (the zip-level StreamHelper typings are not generic).
    const stream = (
      file as unknown as {
        internalStream(type: "uint8array"): {
          on(event: "data", callback: (chunk: Uint8Array) => void): void;
          on(event: "error" | "end", callback: () => void): void;
          pause(): void;
          resume(): void;
        };
      }
    ).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (failed) return;
      if (
        offset + chunk.length > meta.size ||
        offset + chunk.length > maxBytes
      ) {
        failed = true;
        stream.pause();
        reject(new NsqError("too-large", `inflated ${name}`));
        return;
      }
      output.set(chunk, offset);
      offset += chunk.length;
      for (const byte of chunk)
        crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    });
    stream.on("error", () => {
      if (!failed) reject(new NsqError("corrupt", name));
    });
    stream.on("end", () => {
      if (failed) return;
      if (offset !== meta.size || (crc ^ 0xffffffff) >>> 0 !== meta.crc)
        reject(new NsqError("corrupt", `CRC/size ${name}`));
      else resolve(output);
    });
    stream.resume();
  });
}
