/**
 * PSD intake checks. Names from the file are display text, never paths.
 */

export const PSD_MAX_BYTES = Number.POSITIVE_INFINITY;

const MAGIC = [0x38, 0x42, 0x50, 0x53]; // "8BPS"

function stripControls(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

export function asUint8(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

export function psdMagicOk(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 26) return false;
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) return false;
  const version = (bytes[4]! << 8) | bytes[5]!;
  return version === 1 || version === 2;
}

export function assertPsdBytes(bytes: Uint8Array): void {
  if (bytes.byteLength < 26 || !psdMagicOk(bytes)) {
    throw new Error("الملف ليس PSD أو PSB صالحًا.");
  }
  if (bytes.byteLength > PSD_MAX_BYTES) {
    throw new Error("حجم الملف يتجاوز الحد المسموح.");
  }
}

/** Drop path separators, control bytes and parent-directory segments. */
export function sanitizeLayerName(name: string, fallback: string): string {
  const cleaned = stripControls(String(name || ""))
    .replace(/\.\.+/g, " ")
    .replace(/[\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function sanitizeFileName(name: string): string {
  const base = stripControls(String(name || "design.psd")).split(/[/\\]/).pop() || "design.psd";
  const cleaned = base
    .replace(/[\\/]/g, "")
    .replace(/\.\.+/g, ".")
    .trim()
    .slice(0, 120);
  return cleaned || "design.psd";
}

export function magicHexOf(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function magicHexOk(hex: string): boolean {
  if (!/^[0-9a-f]{12,16}$/i.test(hex)) return false;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // Header version lives in bytes 4–5; accept the magic even if the probe is short of 26.
  return bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}
