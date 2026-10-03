/**
 * Small OOXML helpers shared by the Word and PowerPoint readers.
 * No spreadsheet dependency — jszip is already in the export pipeline.
 */

import JSZip from "jszip";
import { dataUrlFrom, decodeXml } from "./shared";

export async function readZip(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("تعذر فتح الملف. قد يكون تالفًا أو ليس DOCX/PPTX.");
  }
}

export async function zipText(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path);
  return file ? file.async("string") : undefined;
}

export async function zipBytes(zip: JSZip, path: string): Promise<Uint8Array | undefined> {
  const file = zip.file(path);
  return file ? file.async("uint8array") : undefined;
}

export function readRels(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const rel of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = rel[1];
    const id = /Id="([^"]+)"/.exec(attrs)?.[1];
    const target = /Target="([^"]+)"/.exec(attrs)?.[1];
    if (id && target) map.set(id, decodeXml(target));
  }
  return map;
}

export function resolveTarget(baseFile: string, target: string): string {
  if (target.startsWith("/")) return target.replace(/^\/+/, "");
  const dir = baseFile.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") dir.pop();
    else if (part && part !== ".") dir.push(part);
  }
  return dir.join("/");
}

export function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "";
}

export async function embeddedImage(zip: JSZip, path: string): Promise<string | null> {
  const mime = mimeFor(path);
  if (!mime) return null;
  const bytes = await zipBytes(zip, path);
  if (!bytes?.byteLength) return null;
  return dataUrlFrom(mime, bytes);
}

const OPEN_BOUNDARY = new Set([">", "/", " ", "\n", "\r", "\t"]);

export function elementEnd(xml: string, start: number, tag: string): number {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const gt = xml.indexOf(">", start);
  if (gt < 0) return xml.length;
  if (xml[gt - 1] === "/") return gt + 1;
  let depth = 1;
  let i = gt + 1;
  while (depth > 0 && i < xml.length) {
    const nextClose = xml.indexOf(close, i);
    if (nextClose < 0) return xml.length;
    let nextOpen = xml.indexOf(open, i);
    while (nextOpen >= 0 && nextOpen < nextClose && !OPEN_BOUNDARY.has(xml[nextOpen + open.length] || "")) {
      nextOpen = xml.indexOf(open, nextOpen + open.length);
    }
    if (nextOpen >= 0 && nextOpen < nextClose) {
      const end = xml.indexOf(">", nextOpen);
      if (end < 0) return xml.length;
      if (xml[end - 1] !== "/") depth += 1;
      i = end + 1;
    } else {
      depth -= 1;
      i = nextClose + close.length;
    }
  }
  return i;
}

export interface XmlBlock {
  tag: "w:p" | "w:tbl" | "w:sectPr";
  xml: string;
}

function tagAt(xml: string, index: number): XmlBlock["tag"] | "w:sdt" | null {
  if (xml[index] !== "<" || xml[index + 1] === "/") return null;
  const tags = ["w:sectPr", "w:tbl", "w:sdt", "w:p"] as const;
  for (const tag of tags) {
    if (!xml.startsWith(tag, index + 1)) continue;
    if (OPEN_BOUNDARY.has(xml[index + 1 + tag.length] || "")) return tag;
  }
  return null;
}

/** Top-level body blocks. Tables keep their own paragraphs; content controls unwrap. */
export function bodyBlocks(bodyXml: string): XmlBlock[] {
  const out: XmlBlock[] = [];
  const walk = (xml: string) => {
    for (let i = 0; i < xml.length; i += 1) {
      const tag = tagAt(xml, i);
      if (!tag) continue;
      const end = elementEnd(xml, i, tag);
      const chunk = xml.slice(i, end);
      if (tag === "w:sdt") {
        const inner = /<w:sdtContent\b[^>]*>([\s\S]*)<\/w:sdtContent>/.exec(chunk)?.[1] ?? chunk.slice(chunk.indexOf(">") + 1);
        walk(inner);
      } else {
        out.push({ tag, xml: chunk });
      }
      i = Math.max(i, end - 1);
    }
  };
  walk(bodyXml);
  return out;
}

export function stripAlternateFallback(xml: string): string {
  return xml.replace(/<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>/g, "");
}
