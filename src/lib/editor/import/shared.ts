/**
 * Shared geometry and project assembly for template import.
 *
 * Office and PDF files do not share Photoshop's layer tree. Callers build
 * real NASAQ elements (text, tables, images, shapes) and an honest note for
 * anything that had to be approximated, flattened or skipped.
 */

import type { CanvasEl, ElStyle, ElementSourceKind, Page, Project, SizeId } from "../model";
import { sizeIdOf } from "../model";
import { serializeTable } from "../tables";
import { uid } from "../../utils";
import { intrinsicPxOf, stampImportOrigins } from "./origin";

export type ImportKind = "nsq" | "json" | "psd" | "psb" | "docx" | "pptx" | "xlsx" | "pdf" | "png" | "jpg" | "svg";

export interface ImportNote {
  name: string;
  mode: "editable" | "partial" | "flattened" | "skipped";
  reason: string;
}

export interface ImportStats {
  pages: number;
  texts: number;
  images: number;
  shapes: number;
  tables: number;
  editable: number;
  partial: number;
  flattened: number;
  skipped: number;
}

export interface BuiltImport {
  format: ImportKind;
  project: Project;
  notes: ImportNote[];
  stats: ImportStats;
  previewDataUrl: string | null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function emuToMm(emu: number): number {
  return (emu / 914400) * 25.4;
}

export function twipToMm(twip: number): number {
  return (twip / 1440) * 25.4;
}

export function ptToMm(pt: number): number {
  return pt * (25.4 / 72);
}

export function decodeXml(input: string): string {
  return String(input ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED[body] ?? match;
  });
}

export function xmlAttr(source: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[\\s])${escaped}="([^"]*)"`).exec(source);
  return match ? decodeXml(match[1]) : undefined;
}

export function fileStem(name: string): string {
  const base = String(name || "مستند").split(/[/\\]/).pop() || "مستند";
  const stem = base.replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim();
  return stem.slice(0, 80) || "مستند";
}

/** First strong letter decides direction when the file does not say. */
export function directionOf(text: string, explicit?: "rtl" | "ltr"): "rtl" | "ltr" {
  if (explicit) return explicit;
  const strong = String(text ?? "").match(/[A-Za-z\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/);
  if (!strong) return "rtl";
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(strong[0]) ? "rtl" : "ltr";
}

export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function dataUrlFrom(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

export function sourceKindOf(kind: ImportKind): ElementSourceKind {
  if (kind === "psd" || kind === "psb") return "psd";
  if (kind === "png" || kind === "jpg" || kind === "svg") return "image";
  if (kind === "nsq" || kind === "json") return "image";
  return kind;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

export class ImportBuilder {
  readonly notes: ImportNote[] = [];
  readonly pages: Page[] = [];
  texts = 0;
  images = 0;
  shapes = 0;
  tables = 0;
  readonly format: ImportKind;
  readonly fileName: string;
  private readonly ids: () => string;
  private readonly provenance: ElementSourceKind;
  private z = 1;

  constructor(format: ImportKind, fileName: string, ids?: () => string) {
    this.format = format;
    this.fileName = fileName;
    this.ids = ids ?? (() => uid("el"));
    this.provenance = sourceKindOf(format);
  }

  note(name: string, mode: ImportNote["mode"], reason: string): void {
    this.notes.push({
      name: name.slice(0, 80) || "عنصر",
      mode,
      reason: reason.slice(0, 280),
    });
  }

  addPage(name: string, w: number, h: number, bg = "#ffffff"): Page {
    const page: Page = {
      id: this.ids(),
      name: name.slice(0, 80) || `صفحة ${this.pages.length + 1}`,
      w: round2(Math.max(12, w)),
      h: round2(Math.max(12, h)),
      bg,
      elements: [],
    };
    this.pages.push(page);
    this.z = 1;
    return page;
  }

  private base(type: CanvasEl["type"], name: string, box: Box, partial?: string): CanvasEl {
    const el: CanvasEl = {
      id: this.ids(),
      type,
      name: name.slice(0, 80) || type,
      x: round2(box.x),
      y: round2(box.y),
      w: round2(Math.max(type === "svg" || type === "line" ? 0.4 : 4, box.w)),
      h: round2(Math.max(type === "svg" || type === "line" ? 0.4 : 4, box.h)),
      rotation: 0,
      opacity: 1,
      z: this.z,
      style: {},
      source: {
        kind: this.provenance,
        layerId: `${this.format}-${this.z}`,
        layerName: name.slice(0, 80) || type,
        ...(partial ? { fallback: "partial" as const, reason: partial } : {}),
      },
    };
    this.z += 1;
    return el;
  }

  text(
    page: Page,
    box: Box,
    content: string,
    style: Partial<ElStyle>,
    name: string,
    partial?: string,
  ): CanvasEl | null {
    const value = [...content].filter((ch) => ch.charCodeAt(0) !== 0).join("").replace(/\r\n/g, "\n");
    if (!value.trim()) return null;
    const direction = style.direction ?? directionOf(value);
    const el = this.base("text", name, box, partial);
    el.content = value;
    el.style = {
      fontFamily: style.fontFamily || "Tajawal",
      fontSize: style.fontSize && style.fontSize > 0 ? style.fontSize : 12,
      fontWeight: style.fontWeight ?? 400,
      fontStyle: style.fontStyle || "normal",
      underline: style.underline,
      color: style.color || "#172033",
      textAlign: style.textAlign || (direction === "ltr" ? "left" : "right"),
      lineHeight: style.lineHeight || 1.45,
      direction,
      textBoxMode: "autoHeight",
      overflowVisible: true,
      verticalAlign: "top",
    };
    page.elements.push(el);
    this.texts += 1;
    return el;
  }

  shape(
    page: Page,
    box: Box,
    fill: string,
    name: string,
    shape: "rect" | "circle" | "rounded" = "rect",
    radius = 0,
    style: Partial<ElStyle> = {},
    partial?: string,
  ): CanvasEl {
    const el = this.base("shape", name, box, partial);
    el.style = {
      ...style,
      fill: fill || "transparent",
      shape,
      radius: radius > 0 ? round2(radius) : undefined,
    };
    page.elements.push(el);
    this.shapes += 1;
    return el;
  }

  line(page: Page, box: Box, color: string, width: number, name: string, partial?: string): CanvasEl {
    const el = this.base("line", name, box, partial);
    el.style = { color: color || "#172033", stroke: Math.max(0.1, width) };
    page.elements.push(el);
    this.shapes += 1;
    return el;
  }

  group(page: Page, box: Box, children: CanvasEl[], name: string, partial?: string): CanvasEl {
    const el = this.base("group", name, box, partial);
    el.children = children;
    page.elements.push(el);
    return el;
  }

  image(page: Page, box: Box, src: string, name: string, partial?: string): CanvasEl | null {
    if (!src.startsWith("data:image/")) return null;
    const el = this.base("image", name, box, partial);
    el.src = src;
    el.style = { objectFit: "fill" };
    page.elements.push(el);
    this.images += 1;
    return el;
  }

  svg(page: Page, box: Box, markup: string, name: string): CanvasEl | null {
    if (!/<svg[\s>]/i.test(markup)) return null;
    const el = this.base("svg", name, box);
    el.content = markup;
    page.elements.push(el);
    this.images += 1;
    return el;
  }

  table(page: Page, box: Box, rows: string[][], name: string, direction?: "rtl" | "ltr"): CanvasEl | null {
    const matrix = rows
      .map((row) => row.map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim()))
      .filter((row) => row.some((cell) => cell !== ""));
    if (!matrix.length) return null;
    const cols = Math.max(...matrix.map((row) => row.length));
    const padded = matrix.map((row) => {
      const next = row.slice(0, 60);
      while (next.length < cols) next.push("");
      return next;
    });
    const text = padded.flat().join(" ");
    const dir = direction ?? directionOf(text);
    const el = this.base("table", name, { ...box, h: Math.max(box.h, padded.length * 8) });
    el.content = serializeTable(padded);
    el.style = {
      cols,
      rows: padded.length,
      cellAlign: dir === "ltr" ? "left" : "right",
      direction: dir,
      fontFamily: "Tajawal",
      fontSize: 11,
      headerBg: "#071d3d",
      headerColor: "#f7f6f3",
      borderColor: "#d6dbe4",
      borderWidth: 0.25,
      color: "#172033",
    };
    page.elements.push(el);
    this.tables += 1;
    return el;
  }

  finish(): BuiltImport {
    if (!this.pages.length) {
      throw new Error("لم يُنتج التحويل أي صفحة.");
    }
    let partial = 0;
    const walk = (els: CanvasEl[]) => {
      for (const el of els) {
        if (el.source?.fallback) partial += 1;
        if (el.children) walk(el.children);
      }
    };
    for (const page of this.pages) walk(page.elements);
    const skipped = this.notes.filter((note) => note.mode === "skipped").length;
    const flattened = this.notes.filter((note) => note.mode === "flattened").length;
    const notedPartial = this.notes.filter((note) => note.mode === "partial").length;
    const placed = this.texts + this.images + this.shapes + this.tables;
    const preview = previewDataUrl(this.pages[0]);
    const project: Project = {
      version: 2,
      // Imported geometry is already expressed in document millimetres. Mark it
      // native so the editor's legacy safety constraints never resize or move
      // source-authored objects while opening the file.
      nativeFormat: 1,
      name: fileStem(this.fileName),
      theme: "official",
      orgName: "",
      defaultSize: sizeIdOf(this.pages[0]) as SizeId,
      pack: "blank",
      pages: this.pages,
      ...(preview ? { thumbnail: preview } : {}),
    };
    // Stamp the as-converted geometry so «إصلاح العناصر» can compare against
    // it; image pixel sizes are read from the data-URL header, never decoded.
    stampImportOrigins(project, intrinsicPxOf);
    return {
      format: this.format,
      project,
      notes: this.notes,
      stats: {
        pages: this.pages.length,
        texts: this.texts,
        images: this.images,
        shapes: this.shapes,
        tables: this.tables,
        editable: Math.max(0, placed - partial),
        partial: partial + notedPartial,
        flattened,
        skipped,
      },
      previewDataUrl: preview,
    };
  }
}

export function previewSvg(page: Page | undefined): string {
  const w = page?.w && page.w > 10 ? page.w : 210;
  const h = page?.h && page.h > 10 ? page.h : 297;
  const parts = [`<rect width="${w}" height="${h}" fill="${page?.bg || "#ffffff"}"/>`];
  const paint = (els: CanvasEl[], ox: number, oy: number) => {
    for (const el of els) {
      if (el.hidden) continue;
      const x = round2(el.x + ox);
      const y = round2(el.y + oy);
      if (el.type === "text") {
        const size = Math.max(2.2, (el.style.fontSize || 12) * 0.3528);
        const align = el.style.textAlign || "right";
        const anchor = align === "center" ? "middle" : align === "left" ? "start" : "end";
        const tx = align === "center" ? x + el.w / 2 : align === "left" ? x : x + el.w;
        const line = escapeXml((el.content || "").split("\n")[0]?.slice(0, 80) || "");
        if (line) {
          parts.push(
            `<text x="${round2(tx)}" y="${round2(y + size)}" font-size="${round2(size)}" fill="${el.style.color || "#172033"}" text-anchor="${anchor}" font-family="Tajawal">${line}</text>`,
          );
        }
      } else if (el.type === "shape" || el.type === "box") {
        parts.push(
          `<rect x="${x}" y="${y}" width="${round2(el.w)}" height="${round2(el.h)}" fill="${el.style.fill || el.style.background || "#e7e2d8"}"/>`,
        );
      } else if (el.type === "table") {
        parts.push(
          `<rect x="${x}" y="${y}" width="${round2(el.w)}" height="${round2(el.h)}" fill="#f7f6f3" stroke="#c6a05a" stroke-width="0.4"/>`,
        );
      } else if (el.type === "image" || el.type === "svg") {
        parts.push(
          `<rect x="${x}" y="${y}" width="${round2(el.w)}" height="${round2(el.h)}" fill="#e7e2d8" stroke="#071d3d" stroke-width="0.3"/>`,
        );
      }
      if (el.children?.length) paint(el.children, x, y);
    }
  };
  if (page) paint(page.elements, 0, 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round2(w)}" height="${round2(h)}" viewBox="0 0 ${round2(w)} ${round2(h)}">${parts.join("")}</svg>`;
}

export function previewDataUrl(page: Page | undefined): string | null {
  const svg = previewSvg(page);
  const url = `data:image/svg+xml;base64,${toBase64(new TextEncoder().encode(svg))}`;
  return url.length < 1_800_000 ? url : null;
}

/** Short stable token so a replaced preview is a different cache URL. */
export function previewCacheKey(thumbnail: string): string {
  let hash = 2166136261;
  const n = Math.min(thumbnail.length, 8000);
  for (let i = 0; i < n; i += 1) hash = Math.imul(hash ^ thumbnail.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
