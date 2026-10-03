/**
 * Editable template payload.
 *
 * A template is the document itself — pages, geometry, layers, backgrounds
 * and embedded assets — never a flattened preview. The preview image is stored
 * beside this JSON, not instead of it.
 */

import { freshPages } from "@/lib/templates/custom-templates";
import { pageSize, type PackId, type Page, type SizeId, type ThemeId } from "@/lib/editor/model";

export const TEMPLATE_DOCUMENT_FORMAT = "nasaq.template";
export const TEMPLATE_DOCUMENT_VERSION = 1;
export const MAX_TEMPLATE_DOCUMENT_BYTES = 4 * 1024 * 1024;

export interface TemplateFont {
  family: string;
  dataUrl: string;
}

export interface TemplateDocument {
  format: typeof TEMPLATE_DOCUMENT_FORMAT;
  version: typeof TEMPLATE_DOCUMENT_VERSION;
  name: string;
  theme: string;
  orgName: string;
  defaultSize: string;
  transactionNo?: string;
  /** Kept so a premium-catalog derivative stays gated after it is shared. */
  licensedTemplateId?: string;
  pack?: string;
  rtl: true;
  pages: Page[];
  embeddedFonts?: TemplateFont[];
}

export interface TemplateDocumentInput {
  name: string;
  theme?: string;
  orgName?: string;
  defaultSize?: string;
  transactionNo?: string;
  licensedTemplateId?: string | null;
  pack?: string | null;
  pages: Page[];
  embeddedFonts?: TemplateFont[] | null;
}

const PRIVATE_KEYS = new Set([
  "userId",
  "userEmail",
  "email",
  "licenseKey",
  "keyHash",
  "payment",
  "provider",
  "secret",
]);

export function buildTemplateDocument(input: TemplateDocumentInput): TemplateDocument {
  const pages = sanitizePages(input.pages);
  const doc: TemplateDocument = {
    format: TEMPLATE_DOCUMENT_FORMAT,
    version: TEMPLATE_DOCUMENT_VERSION,
    name: String(input.name || "قالب").slice(0, 120),
    theme: String(input.theme || "official").slice(0, 40),
    orgName: String(input.orgName || "").slice(0, 160),
    defaultSize: String(input.defaultSize || "a4-portrait").slice(0, 40),
    rtl: true,
    pages,
  };
  const transactionNo = String(input.transactionNo || "").trim();
  if (transactionNo) doc.transactionNo = transactionNo.slice(0, 80);
  const licensed = String(input.licensedTemplateId || "").trim();
  if (licensed) doc.licensedTemplateId = licensed.slice(0, 120);
  const pack = String(input.pack || "").trim();
  if (pack) doc.pack = pack.slice(0, 40);
  const fonts = (input.embeddedFonts || []).filter(
    (font) =>
      font &&
      typeof font.family === "string" &&
      typeof font.dataUrl === "string" &&
      font.dataUrl.startsWith("data:"),
  );
  if (fonts.length) {
    doc.embeddedFonts = fonts.slice(0, 24).map((font) => ({
      family: font.family.slice(0, 80),
      dataUrl: font.dataUrl,
    }));
  }
  return doc;
}

export function serializeTemplateDocument(doc: TemplateDocument): string {
  return JSON.stringify(doc);
}

export function validateTemplateDocument(raw: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "المحتوى فارغ";
  if (raw.length > MAX_TEMPLATE_DOCUMENT_BYTES) return "حجم القالب يتجاوز 4 ميغابايت";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "ملف القالب لا يحتوي على مستند نَسَق صالح";
    }
    const pages = (parsed as { pages?: unknown }).pages;
    if (!Array.isArray(pages) || pages.length === 0) {
      return "ملف القالب لا يحتوي على صفحات قابلة للتعديل";
    }
    for (const page of pages) {
      if (!page || typeof page !== "object" || Array.isArray(page)) {
        return "إحدى صفحات القالب غير صالحة";
      }
      const record = page as { elements?: unknown; w?: unknown; h?: unknown };
      if (!Array.isArray(record.elements)) return "طبقات الصفحة غير صالحة";
      if (record.w != null && typeof record.w !== "number") return "أبعاد الصفحة غير صالحة";
      if (record.h != null && typeof record.h !== "number") return "أبعاد الصفحة غير صالحة";
    }
    return null;
  } catch {
    return "تعذر قراءة القالب — الملف تالف";
  }
}

/** Public projection: editable pages, no account or payment fields. */
export function publicTemplateContent(raw: string): string | null {
  if (validateTemplateDocument(raw)) return null;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const doc = buildTemplateDocument({
    name: String(parsed.name || "قالب"),
    theme: typeof parsed.theme === "string" ? parsed.theme : "official",
    orgName: typeof parsed.orgName === "string" ? parsed.orgName : "",
    defaultSize: typeof parsed.defaultSize === "string" ? parsed.defaultSize : "a4-portrait",
    transactionNo: typeof parsed.transactionNo === "string" ? parsed.transactionNo : "",
    licensedTemplateId:
      typeof parsed.licensedTemplateId === "string" ? parsed.licensedTemplateId : "",
    pack: typeof parsed.pack === "string" ? parsed.pack : "",
    pages: parsed.pages as Page[],
    embeddedFonts: Array.isArray(parsed.embeddedFonts)
      ? (parsed.embeddedFonts as TemplateFont[])
      : [],
  });
  return serializeTemplateDocument(doc);
}

export function templateDocumentSummary(raw: string): {
  pageCount: number;
  w: number;
  h: number;
  licensedTemplateId?: string;
} | null {
  if (validateTemplateDocument(raw)) return null;
  const parsed = JSON.parse(raw) as { pages: Page[]; licensedTemplateId?: string };
  const size = pageSize(parsed.pages[0]);
  return {
    pageCount: parsed.pages.length,
    w: size.w,
    h: size.h,
    ...(parsed.licensedTemplateId ? { licensedTemplateId: parsed.licensedTemplateId } : {}),
  };
}

/** A new document from a template — fresh ids, same editable structure. */
export function templateToProjectSeed(raw: string, title: string) {
  const error = validateTemplateDocument(raw);
  if (error) throw new Error(error);
  const parsed = JSON.parse(raw) as TemplateDocument;
  const fresh = freshPages(parsed.pages);
  const pack = validPack(parsed.pack);
  return {
    name: title || parsed.name,
    theme: validTheme(parsed.theme),
    orgName: parsed.orgName,
    defaultSize: validSize(parsed.defaultSize),
    transactionNo: parsed.transactionNo,
    ...(pack ? { pack } : {}),
    ...(parsed.licensedTemplateId ? { licensedTemplateId: parsed.licensedTemplateId } : {}),
    ...(parsed.embeddedFonts?.length ? { embeddedFonts: parsed.embeddedFonts } : {}),
    pages: fresh,
  };
}

const PACKS = new Set<PackId>(["official", "eid", "briefing", "blank", "slides"]);
const THEMES = new Set<ThemeId>(["official", "eid", "ministry", "slate", "sand"]);

function validTheme(value: unknown): ThemeId {
  return typeof value === "string" && THEMES.has(value as ThemeId) ? (value as ThemeId) : "official";
}
const SIZES = new Set<SizeId>(["a4-portrait", "a4-landscape", "slide-16-9", "a3-portrait", "custom"]);

function validPack(value: unknown): PackId | undefined {
  return typeof value === "string" && PACKS.has(value as PackId) ? (value as PackId) : undefined;
}

function validSize(value: unknown): SizeId {
  return typeof value === "string" && SIZES.has(value as SizeId) ? (value as SizeId) : "custom";
}

function sanitizePages(pages: Page[]): Page[] {
  return JSON.parse(JSON.stringify(pages ?? [])).map((page: Page) => stripPrivate(page)) as Page[];
}

function stripPrivate<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripPrivate(item)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEYS.has(key)) continue;
    out[key] = stripPrivate(child);
  }
  return out as T;
}
