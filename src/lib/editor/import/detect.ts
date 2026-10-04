/**
 * Which template-import formats this page can actually read.
 *
 * The extension is a hint. The first bytes have to agree, so a renamed
 * executable is rejected before any converter runs.
 */

import type { ImportKind } from "./shared";

const ZIP = "504b0304";
const OLE = "d0cf11e0";

export interface ClassifiedFile {
  format?: ImportKind;
  error?: string;
}

function hex(bytes: Uint8Array, n = 8): string {
  return Array.from(bytes.subarray(0, Math.min(n, bytes.byteLength)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ext(name: string): string {
  return (name.split(/[/\\]/).pop() || "").toLowerCase().split(".").pop() || "";
}

function looksSvg(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 240));
  if (head.includes(0)) return false;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head).trimStart();
  return text.startsWith("<") || text.startsWith("\uFEFF<");
}

export function magicMatches(format: ImportKind, magicHex: string): boolean {
  const h = magicHex.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (h.length < 4) return false;
  if (format === "psd" || format === "psb") return h.startsWith("38425053");
  if (format === "docx" || format === "pptx") return h.startsWith(ZIP);
  if (format === "pdf") return h.startsWith("25504446");
  if (format === "png") return h.startsWith("89504e47");
  if (format === "jpg") return h.startsWith("ffd8ff");
  if (format === "svg") {
    try {
      const bytes = new Uint8Array(h.length / 2);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
      return looksSvg(bytes) || h.startsWith("3c") || h.startsWith("efbbbf3c");
    } catch {
      return false;
    }
  }
  return false;
}

export function classifyImport(fileName: string, bytes: Uint8Array): ClassifiedFile {
  if (!bytes.byteLength) return { error: "الملف فارغ." };
  const kind = ext(fileName);
  const signature = hex(bytes);
  if (kind === "nsq") {
    if (!signature.startsWith(ZIP)) return { error: "الملف ليس حزمة نَسَق (.nsq) صالحة." };
    return { format: "nsq" };
  }
  if (kind === "json" || signature.startsWith("7b") || signature.startsWith("5b")) {
    return { format: "json" };
  }
  if (kind === "doc" || (signature.startsWith(OLE) && kind !== "ppt")) {
    if (kind === "doc" || kind === "xls") {
      return { error: "صيغة Office القديمة غير مدعومة. احفظ الملف كـ DOCX أو PPTX ثم أعد المحاولة." };
    }
  }
  if (kind === "ppt" || kind === "xls") {
    return { error: "صيغة Office القديمة غير مدعومة. احفظ الملف كـ DOCX أو PPTX ثم أعد المحاولة." };
  }
  if (kind === "xlsx" || kind === "csv") {
    return { error: "جداول Excel تُستورد من محرر الجدول، وليست قالب صفحة في هذا المسار." };
  }
  if (signature.startsWith("38425053") || kind === "psd" || kind === "psb") {
    if (!signature.startsWith("38425053")) return { error: "الملف ليس PSD أو PSB صالحًا." };
    return { format: kind === "psb" ? "psb" : "psd" };
  }
  if (signature.startsWith("25504446") || kind === "pdf") {
    if (!signature.startsWith("25504446")) return { error: "الملف ليس PDF صالحًا." };
    return { format: "pdf" };
  }
  if (signature.startsWith("89504e47") || kind === "png") {
    if (!signature.startsWith("89504e47")) return { error: "الملف ليس PNG صالحًا." };
    return { format: "png" };
  }
  if (signature.startsWith("ffd8ff") || kind === "jpg" || kind === "jpeg") {
    if (!signature.startsWith("ffd8ff")) return { error: "الملف ليس JPG صالحًا." };
    return { format: "jpg" };
  }
  if (kind === "svg" || (looksSvg(bytes) && !signature.startsWith(ZIP))) {
    if (!looksSvg(bytes)) return { error: "ملف SVG غير صالح." };
    return { format: "svg" };
  }
  if (signature.startsWith(ZIP) || kind === "docx" || kind === "pptx") {
    if (!signature.startsWith(ZIP)) return { error: "الملف ليس حزمة Office صالحة (DOCX أو PPTX)." };
    if (kind === "pptx") return { format: "pptx" };
    if (kind === "docx") return { format: "docx" };
    return { format: "docx" };
  }
  return { error: "صيغة غير مدعومة. المقبول: PSD وDOCX وPPTX وPDF وPNG وJPG وSVG." };
}
