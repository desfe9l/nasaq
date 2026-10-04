/**
 * NASAQ native project format — `.nsq`.
 *
 * An `.nsq` file is a versioned ZIP container (the same family of formats as
 * OpenDocument, EPUB and iWork): a stored `mimetype` entry first, then a
 * manifest, the editable document, every binary asset the document references,
 * embedded fonts where available, and a first-page preview image.
 *
 *   mimetype                    application/vnd.nasaq.project+zip (stored)
 *   manifest.json               format/version, integrity hashes, fonts, attribution
 *   document.json               the editable project; assets referenced by id
 *   assets/<sha>.<ext>          images and SVG artwork, content-addressed
 *   fonts/<sha>.<ext>           uploaded font files the project uses (optional)
 *   Thumbnails/thumbnail.png    first-page preview (OpenDocument convention)
 *   QuickLook/Thumbnail.png     first-page preview (Apple package convention)
 *   README.txt                  plain-text origin note for anyone who unzips it
 *
 * This module is pure (no DOM, no JSZip) so the node test runner can exercise
 * the schema, the path guards and the migrations directly.
 */

import { normalizeGradient } from "../editor/gradient.ts";
import { normalizeCrop } from "../editor/image-crop.ts";
import type { CanvasEl, ElType, Page, Project } from "../editor/model.ts";

export const NSQ_EXTENSION = ".nsq";
export const NSQ_MIME = "application/vnd.nasaq.project+zip";
export const NSQ_FORMAT = "nasaq.project";
export const NSQ_DOCUMENT_SCHEMA = "nasaq.document";
/** Bump on any breaking change to the container or document, and add a migration. */
export const NSQ_FORMAT_VERSION = 2;
/** File-picker `accept` string: the native format plus legacy JSON backups. */
export const NSQ_ACCEPT = `${NSQ_EXTENSION},${NSQ_MIME},application/json,.json`;

export const NSQ_PATHS = {
  mimetype: "mimetype",
  manifest: "manifest.json",
  document: "document.json",
  thumbnail: "Thumbnails/thumbnail.png",
  quickLook: "QuickLook/Thumbnail.png",
  readme: "README.txt",
} as const;

/** Prefix that marks a document value as a reference into `assets/`. */
export const ASSET_REF = "nsq-asset:";

/** Hard limits — a hostile or broken file must fail fast, not exhaust memory. */
export const NSQ_LIMITS = {
  maxFileBytes: 300 * 1024 * 1024,
  maxUncompressedBytes: 600 * 1024 * 1024,
  maxEntries: 5000,
  maxDocumentBytes: 64 * 1024 * 1024,
  maxManifestBytes: 2 * 1024 * 1024,
  maxAssetBytes: 64 * 1024 * 1024,
  maxFontBytes: 32 * 1024 * 1024,
  maxThumbnailBytes: 4 * 1024 * 1024,
  maxTotalElements: 50000,
  maxPages: 500,
  maxElementsPerPage: 5000,
  maxDepth: 12,
} as const;

/** Asset MIME types an `.nsq` may carry, with their canonical extension. */
export const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export const FONT_MIME_EXT: Record<string, string> = {
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
};

/** Formats that are already compressed — stored, not deflated again. */
export const STORED_EXTS = new Set([
  "png",
  "jpg",
  "webp",
  "gif",
  "avif",
  "woff2",
  "woff",
]);

export const KNOWN_TYPES: readonly ElType[] = [
  "text",
  "box",
  "table",
  "shape",
  "line",
  "divider",
  "image",
  "logo",
  "icon",
  "stamp",
  "qr",
  "stat",
  "progress",
  "svg",
  "group",
];

/** Families the editor ships (see `FONTS` in model.ts) — always resolvable. */
export const BUNDLED_FONTS = new Set([
  "Tajawal",
  "Cairo",
  "IBM Plex Sans Arabic",
  "Noto Sans Arabic",
  "Noto Naskh Arabic",
  "Noto Kufi Arabic",
  "Amiri",
  "Reem Kufi",
]);
export const DEFAULT_FALLBACK_FONT = "Tajawal";

const THEME_IDS = ["official", "eid", "ministry", "slate", "sand"] as const;
const PACK_IDS = ["official", "eid", "briefing", "blank", "slides"] as const;
const SIZE_IDS = [
  "a4-portrait",
  "a4-landscape",
  "slide-16-9",
  "a3-portrait",
  "custom",
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

export interface NsqAssetEntry {
  id: string;
  path: string;
  mime: string;
  size: number;
  sha256?: string;
}

export interface NsqFontEntry {
  family: string;
  /** Ships with NASAQ — resolvable on every device. */
  bundled: boolean;
  /** Package path of the embedded font file, when one was available. */
  path?: string;
  mime?: string;
  sha256?: string;
  /** Family the editor substitutes when this one cannot be loaded. */
  fallback: string;
}

export interface NsqOrigin {
  /** Always "NASAQ": the platform the design was first made with. */
  createdWith: string;
  /** When the design was first saved as `.nsq` (epoch ms). */
  firstSavedAt: number;
  /** Site the first save happened on, when known. */
  site?: string;
}

export interface NsqManifest {
  format: typeof NSQ_FORMAT;
  formatVersion: number;
  /** Oldest reader that can open this file without losing data. */
  minReaderVersion: number;
  mimetype: string;
  generator: {
    name: string;
    nameAr: string;
    site?: string;
    formatVersion: number;
  };
  title: string;
  createdAt: number;
  modifiedAt: number;
  pageCount: number;
  firstPage?: { w: number; h: number };
  document: { path: string; size: number; sha256?: string };
  thumbnail?: {
    path: string;
    mime: string;
    width?: number;
    height?: number;
  } | null;
  assets: NsqAssetEntry[];
  fonts: NsqFontEntry[];
  /** Remote URLs the document still points at (could not be embedded). */
  external: string[];
  attribution: NsqOrigin;
}

export interface NsqDocument {
  schema: typeof NSQ_DOCUMENT_SCHEMA;
  /** `Project.version` of the editor model the pages were written with. */
  modelVersion: number;
  project: {
    name: string;
    theme: string;
    orgName: string;
    transactionNo?: string;
    defaultSize?: string;
    pack?: string;
    licensedTemplateId?: string;
    sourceProjectId?: string;
    createdAt?: number;
    updatedAt?: number;
  };
  pages: Page[];
  /** Workspace hints: the page the author was on. Never overrides preferences. */
  view?: { activePageIndex?: number };
  /** Print / editor settings that travel with the project (informational). */
  settings?: Record<string, unknown>;
}

export type NsqErrorCode =
  | "empty"
  | "too-large"
  | "not-nsq"
  | "corrupt"
  | "invalid"
  | "too-new"
  | "missing-asset"
  | "integrity"
  | "unsupported-env"
  | "access-denied"
  | "storage"
  | "pending";

/** Author-facing Arabic messages, one per failure class. */
export const NSQ_ERROR_MESSAGES: Record<NsqErrorCode, string> = {
  storage:
    "تعذر حفظ الملف بأمان في المتصفح. أتح التخزين أو حرّر مساحة ثم أعد المحاولة؛ لم يبدأ تسجيل الدخول.",
  pending: "يوجد ملف نَسَق بانتظار الفتح. افتحه أو أزله قبل استقبال ملف آخر.",
  empty: "الملف فارغ — لا يحتوي على أي بيانات.",
  "too-large": "حجم الملف أكبر من الحد المسموح لملفات نَسَق.",
  "not-nsq": "هذا ليس ملف مشروع نَسَق (.nsq).",
  corrupt: "الملف تالف أو لم يكتمل تنزيله — تعذّر فتحه.",
  invalid: "بنية ملف المشروع غير صالحة — لم يُستورد أي شيء.",
  "too-new":
    "أُنشئ هذا الملف بإصدار أحدث من نَسَق. حدّث الصفحة ثم حاول مرة أخرى.",
  "missing-asset": "بعض صور المشروع مفقودة داخل الملف — الملف غير مكتمل.",
  integrity: "فشل التحقق من سلامة محتوى الملف — قد يكون تالفًا.",
  "unsupported-env": "المتصفح الحالي لا يدعم فتح ملفات نَسَق.",
  "access-denied": "يتطلب حفظ هذا الملف ترخيصًا مناسبًا وحدّ صفحات لا يتجاوزه.",
};

export class NsqError extends Error {
  code: NsqErrorCode;
  detail?: string;
  constructor(code: NsqErrorCode, detail?: string) {
    super(NSQ_ERROR_MESSAGES[code]);
    this.name = "NsqError";
    this.code = code;
    this.detail = detail;
  }
}

export function nsqErrorMessage(err: unknown): string {
  if (err instanceof NsqError) return err.message;
  return NSQ_ERROR_MESSAGES.corrupt;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** True for a name the picker/drop handler should route to the `.nsq` reader. */
export function isNsqFileName(name: string | undefined | null): boolean {
  return /\.nsq$/i.test(String(name ?? "").trim());
}

/** True for names the project importer accepts (native + legacy JSON). */
export function isProjectFileName(name: string | undefined | null): boolean {
  return isNsqFileName(name) || /\.json$/i.test(String(name ?? "").trim());
}

/** Relative, normalised, inside the package — never absolute or escaping. */
export function isSafeEntryPath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.length > 240) return false;
  if (path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path))
    return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  return path
    .split("/")
    .every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** File name for a project, safe on every OS, always ending in `.nsq`. */
export function nsqFileName(name: string | undefined): string {
  const base =
    String(name || "مشروع نَسَق")
      // eslint-disable-next-line no-control-regex -- strip control characters from file names
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
      .replace(/\.nsq$/i, "")
      .trim()
      .slice(0, 120) || "مشروع نَسَق";
  return `${base}${NSQ_EXTENSION}`;
}

/** Every font family the pages use, in first-use order. */
export function collectFontFamilies(pages: Page[]): string[] {
  const seen = new Set<string>();
  const walk = (list: CanvasEl[] | undefined) => {
    for (const el of list || []) {
      const family =
        el.style?.fontFamily ||
        (["text", "box", "stat", "table", "progress", "stamp"].includes(el.type)
          ? el.type === "stamp"
            ? "Amiri"
            : "Tajawal"
          : undefined);
      if (typeof family === "string" && family.trim()) seen.add(family.trim());
      if (el.children?.length) walk(el.children);
    }
  };
  for (const page of pages) walk(page.elements);
  return [...seen];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Validate a parsed manifest. Throws `NsqError("invalid")` with a reason; never
 * trusts a field it has not checked.
 */
export function validateManifest(raw: unknown): NsqManifest {
  if (!isRecord(raw))
    throw new NsqError("invalid", "manifest is not an object");
  if (raw.format !== NSQ_FORMAT)
    throw new NsqError("not-nsq", "unknown format id");
  if (!Number.isInteger(raw.formatVersion) || (raw.formatVersion as number) < 1)
    throw new NsqError("invalid", "formatVersion");
  const minReader = Number.isInteger(raw.minReaderVersion)
    ? (raw.minReaderVersion as number)
    : (raw.formatVersion as number);
  if (
    (raw.formatVersion as number) > NSQ_FORMAT_VERSION ||
    minReader > NSQ_FORMAT_VERSION
  )
    throw new NsqError("too-new");
  if (minReader < 1 || minReader > (raw.formatVersion as number))
    throw new NsqError("invalid", "reader version");
  const doc = raw.document;
  if (!isRecord(doc) || !isSafeEntryPath(doc.path))
    throw new NsqError("invalid", "document entry");
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  if (assets.length > NSQ_LIMITS.maxEntries)
    throw new NsqError("invalid", "too many assets");
  const assetIds = new Set<string>(),
    assetPaths = new Set<string>();
  const cleanAssets: NsqAssetEntry[] = assets.map((a) => {
    if (
      !isRecord(a) ||
      typeof a.id !== "string" ||
      !a.id ||
      !isSafeEntryPath(a.path)
    )
      throw new NsqError("invalid", "asset entry");
    if (
      a.id.length > 128 ||
      assetIds.has(a.id) ||
      assetPaths.has(a.path) ||
      !a.path.startsWith("assets/")
    )
      throw new NsqError("invalid", "duplicate/invalid asset");
    assetIds.add(a.id);
    assetPaths.add(a.path);
    const mime = String(a.mime || "");
    if (!IMAGE_MIME_EXT[mime])
      throw new NsqError("invalid", `asset mime ${mime}`);
    return {
      id: a.id,
      path: a.path,
      mime,
      size: finite(a.size) ? a.size : 0,
      sha256: typeof a.sha256 === "string" ? a.sha256 : undefined,
    };
  });
  const fonts: NsqFontEntry[] = (Array.isArray(raw.fonts) ? raw.fonts : [])
    .filter(isRecord)
    .filter((f) => typeof f.family === "string" && f.family.trim())
    .map((f) => ({
      family: String(f.family).trim().slice(0, 120),
      bundled: f.bundled === true,
      path:
        isSafeEntryPath(f.path) && FONT_MIME_EXT[String(f.mime)]
          ? f.path
          : undefined,
      mime: FONT_MIME_EXT[String(f.mime)] ? String(f.mime) : undefined,
      sha256: typeof f.sha256 === "string" ? f.sha256 : undefined,
      fallback:
        typeof f.fallback === "string" && BUNDLED_FONTS.has(f.fallback)
          ? f.fallback
          : DEFAULT_FALLBACK_FONT,
    }));
  const thumb = raw.thumbnail;
  const gen = isRecord(raw.generator) ? raw.generator : {};
  const attr = isRecord(raw.attribution) ? raw.attribution : {};
  return {
    format: NSQ_FORMAT,
    formatVersion: raw.formatVersion as number,
    minReaderVersion: minReader,
    mimetype: NSQ_MIME,
    generator: {
      name: String(gen.name || "NASAQ").slice(0, 60),
      nameAr: String(gen.nameAr || "نَسَق").slice(0, 60),
      site: typeof gen.site === "string" ? gen.site.slice(0, 200) : undefined,
      formatVersion: Number(gen.formatVersion) || (raw.formatVersion as number),
    },
    title: String(raw.title || "").slice(0, 200),
    createdAt: finite(raw.createdAt) ? raw.createdAt : Date.now(),
    modifiedAt: finite(raw.modifiedAt) ? raw.modifiedAt : Date.now(),
    pageCount: finite(raw.pageCount) ? raw.pageCount : 0,
    firstPage:
      isRecord(raw.firstPage) &&
      finite(raw.firstPage.w) &&
      finite(raw.firstPage.h)
        ? { w: raw.firstPage.w, h: raw.firstPage.h }
        : undefined,
    document: {
      path: doc.path,
      size: finite(doc.size) ? doc.size : 0,
      sha256: typeof doc.sha256 === "string" ? doc.sha256 : undefined,
    },
    thumbnail:
      isRecord(thumb) && isSafeEntryPath(thumb.path)
        ? {
            path: thumb.path,
            mime: "image/png",
            width: finite(thumb.width) ? thumb.width : undefined,
            height: finite(thumb.height) ? thumb.height : undefined,
          }
        : null,
    assets: cleanAssets,
    fonts,
    external: (Array.isArray(raw.external) ? raw.external : [])
      .filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u),
      )
      .slice(0, 500),
    attribution: {
      createdWith: String(attr.createdWith || "NASAQ").slice(0, 60),
      firstSavedAt: finite(attr.firstSavedAt) ? attr.firstSavedAt : Date.now(),
      site: typeof attr.site === "string" ? attr.site.slice(0, 200) : undefined,
    },
  };
}

// ── Document validation ──────────────────────────────────────────────────────

const STYLE_UNSAFE =
  /url\s*\(|expression\s*\(|javascript:|@import|<\s*\/?\s*[a-z]/i;

export interface DocumentValidation {
  pages: Page[];
  warnings: string[];
}

/**
 * Structurally validate and clean the pages of a document.
 *
 * Unknown element types are dropped (and reported) rather than handed to a
 * renderer that cannot draw them; geometry is coerced to finite numbers; style
 * values that could pull remote resources or inject markup are removed. The
 * result is plain data — nothing in it is ever evaluated.
 */
export function validatePages(
  rawPages: unknown,
  opts: { strict?: boolean; allowAssetRefs?: boolean } = {},
): DocumentValidation {
  if (!Array.isArray(rawPages) || !rawPages.length)
    throw new NsqError("invalid", "document has no pages");
  if (rawPages.length > NSQ_LIMITS.maxPages)
    throw new NsqError("invalid", "too many pages");
  const warnings = new Set<string>();
  const ids = new Set<string>();
  let counter = 0,
    totalElements = 0;
  const freshId = (prefix: string) =>
    `${prefix}-nsq${Date.now().toString(36)}${(counter++).toString(36)}`;

  const cleanStyle = (raw: unknown): Record<string, unknown> => {
    if (!isRecord(raw)) {
      if (opts.strict && raw !== undefined)
        throw new NsqError("invalid", "element style");
      return {};
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype")
        continue;
      if (typeof value === "string") {
        if (STYLE_UNSAFE.test(value)) {
          if (opts.strict) throw new NsqError("invalid", "unsafe style");
          warnings.add("أُزيلت قيم تنسيق غير آمنة من الملف.");
          continue;
        }
        if (opts.strict && value.length > 2000)
          throw new NsqError("too-large", "style value");
        out[key] = value.slice(0, 2000);
      } else if (typeof value === "number") {
        if (Number.isFinite(value)) out[key] = value;
      } else if (typeof value === "boolean") {
        out[key] = value;
      } else if (isRecord(value) || Array.isArray(value)) {
        // Structured style values (e.g. the fade overlay) — plain data only.
        const json = JSON.stringify(value);
        if (json.length < 20_000 && !STYLE_UNSAFE.test(json))
          out[key] = JSON.parse(json);
      }
    }
    if (out.gradient !== undefined)
      out.gradient = normalizeGradient(out.gradient);
    if (out.crop !== undefined) out.crop = normalizeCrop(out.crop);
    return out;
  };

  const cleanEl = (raw: unknown, depth: number): CanvasEl | null => {
    if (++totalElements > NSQ_LIMITS.maxTotalElements)
      throw new NsqError("too-large", "element count");
    if (!isRecord(raw)) {
      if (opts.strict)
        throw new NsqError("invalid", "element must be an object");
      return null;
    }
    if (depth > NSQ_LIMITS.maxDepth) {
      if (opts.strict) throw new NsqError("invalid", "group depth");
      warnings.add("تم تجاهل مجموعات متداخلة بعمق غير مدعوم.");
      return null;
    }
    const type = raw.type as ElType;
    if (!KNOWN_TYPES.includes(type)) {
      if (opts.strict)
        throw new NsqError("too-new", "unsupported element type");
      warnings.add("تم تجاهل عناصر من نوع لا يدعمه هذا الإصدار من نَسَق.");
      return null;
    }
    let id =
      typeof raw.id === "string" && raw.id.trim() ? raw.id.slice(0, 120) : "";
    if ((!id || ids.has(id)) && opts.strict)
      throw new NsqError("invalid", "duplicate/missing element id");
    if (!id || ids.has(id)) id = freshId("el");
    ids.add(id);
    const num = (v: unknown, fallback: number) => {
      if (opts.strict && v !== undefined && (!finite(v) || Math.abs(v) > 1e6))
        throw new NsqError("invalid", "element geometry");
      if (v === undefined) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    if (
      opts.strict &&
      ((finite(raw.w) && raw.w < 0) ||
        (finite(raw.h) && raw.h < 0) ||
        (finite(raw.opacity) && (raw.opacity < 0 || raw.opacity > 1)))
    )
      throw new NsqError("invalid", "element bounds");
    const el: CanvasEl = {
      id,
      type,
      name: typeof raw.name === "string" ? raw.name.slice(0, 200) : "",
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      w: Math.max(opts.strict ? 0 : 0.1, num(raw.w, 20)),
      h: Math.max(opts.strict ? 0 : 0.1, num(raw.h, 20)),
      rotation: num(raw.rotation, 0),
      opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
      z: num(raw.z, 1),
      style: cleanStyle(raw.style) as CanvasEl["style"],
    };
    for (const flag of [
      "locked",
      "resizeLocked",
      "widthLocked",
      "heightLocked",
      "hidden",
    ] as const) {
      if (raw[flag] === true) el[flag] = true;
    }
    for (const key of ["linkId", "clippedBy", "icon"] as const) {
      if (typeof raw[key] === "string")
        el[key] = (raw[key] as string).slice(0, 200);
    }
    if (raw.hfRole === "header" || raw.hfRole === "footer")
      el.hfRole = raw.hfRole;
    if (
      isRecord(raw.source) &&
      (raw.source.kind === "psd" ||
        raw.source.kind === "docx" ||
        raw.source.kind === "pptx" ||
        raw.source.kind === "pdf" ||
        raw.source.kind === "image") &&
      typeof raw.source.layerId === "string" &&
      raw.source.layerId
    ) {
      el.source = {
        kind: raw.source.kind,
        layerId: raw.source.layerId.slice(0, 80),
        layerName:
          typeof raw.source.layerName === "string"
            ? raw.source.layerName.slice(0, 80)
            : "",
        ...(raw.source.fallback === "raster" || raw.source.fallback === "partial"
          ? { fallback: raw.source.fallback }
          : {}),
        ...(typeof raw.source.reason === "string"
          ? { reason: raw.source.reason.slice(0, 240) }
          : {}),
      };
    }
    if (typeof raw.content === "string") el.content = raw.content;
    if (typeof raw.src === "string") el.src = raw.src;
    if (type === "table") {
      if (Number(el.style.rows) > 1000 || Number(el.style.cols) > 100)
        throw new NsqError("too-large", "table dimensions");
      if (el.content) {
        let cells: unknown;
        try {
          cells = JSON.parse(el.content);
        } catch {
          if (opts.strict) throw new NsqError("invalid", "table JSON");
        }
        if (
          Array.isArray(cells) &&
          (cells.length > 1000 ||
            cells.some((row) => Array.isArray(row) && row.length > 100))
        )
          throw new NsqError("too-large", "table cells");
      }
    }
    if (type === "group") {
      if (opts.strict && !Array.isArray(raw.children))
        throw new NsqError("invalid", "group children");
      const kids = Array.isArray(raw.children) ? raw.children : [];
      if (kids.length > NSQ_LIMITS.maxElementsPerPage)
        throw new NsqError("too-large", "group count");
      el.children = kids
        .map((k) => cleanEl(k, depth + 1))
        .filter((k): k is CanvasEl => k !== null);
    }
    return el;
  };

  const pageIds = new Set<string>();
  const pages: Page[] = rawPages.map((rawPage, index) => {
    if (!isRecord(rawPage))
      throw new NsqError("invalid", `page ${index} is not an object`);
    if (opts.strict && !Array.isArray(rawPage.elements))
      throw new NsqError("invalid", "page elements");
    const rawEls = Array.isArray(rawPage.elements) ? rawPage.elements : [];
    if (rawEls.length > NSQ_LIMITS.maxElementsPerPage)
      throw new NsqError("invalid", `page ${index} has too many elements`);
    let id =
      typeof rawPage.id === "string" && rawPage.id.trim()
        ? rawPage.id.slice(0, 120)
        : "";
    if ((!id || pageIds.has(id)) && opts.strict)
      throw new NsqError("invalid", "duplicate/missing page id");
    if (!id || pageIds.has(id)) id = freshId("page");
    pageIds.add(id);
    const page: Page = {
      id,
      name:
        typeof rawPage.name === "string"
          ? rawPage.name.slice(0, 200)
          : `صفحة ${index + 1}`,
      clipContent: rawPage.clipContent !== false,
      elements: rawEls
        .map((e) => cleanEl(e, 0))
        .filter((e): e is CanvasEl => e !== null),
    };
    if (
      opts.strict &&
      typeof rawPage.bg === "string" &&
      STYLE_UNSAFE.test(rawPage.bg)
    )
      throw new NsqError("invalid", "page background");
    if (typeof rawPage.bg === "string" && !STYLE_UNSAFE.test(rawPage.bg))
      page.bg = rawPage.bg.slice(0, 400);
    if (typeof rawPage.bgImage === "string") {
      const image = rawPage.bgImage;
      const assetRef = opts.allowAssetRefs && image.startsWith(ASSET_REF);
      const safeImage =
        image.length <= 6_000_000 &&
        /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(image) &&
        !/javascript:|expression\s*\(|@import/i.test(image);
      if (assetRef || safeImage) page.bgImage = image;
      else if (opts.strict) throw new NsqError("invalid", "page background image");
    }
    if (rawPage.bgImageFit === "cover" || rawPage.bgImageFit === "contain")
      page.bgImageFit = rawPage.bgImageFit;
    for (const key of ["bgImageX", "bgImageY"] as const) {
      const value = rawPage[key];
      if (finite(value) && value >= 0 && value <= 100) page[key] = value;
      else if (opts.strict && value !== undefined)
        throw new NsqError("invalid", `page ${key}`);
    }
    if (typeof rawPage.clipContent === "boolean")
      page.clipContent = rawPage.clipContent;
    if (rawPage.bgGradient !== undefined) {
      page.bgGradient = normalizeGradient(rawPage.bgGradient);
      if (opts.strict && !page.bgGradient)
        throw new NsqError("invalid", "page gradient");
    }
    for (const key of ["w", "h"])
      if (
        opts.strict &&
        rawPage[key] !== undefined &&
        (!finite(rawPage[key]) ||
          (rawPage[key] as number) <= 0 ||
          (rawPage[key] as number) > 10000)
      )
        throw new NsqError("invalid", "page dimensions");
    if (finite(rawPage.w)) page.w = rawPage.w;
    if (finite(rawPage.h)) page.h = rawPage.h;
    if (typeof rawPage.locked === "boolean") page.locked = rawPage.locked;
    if (typeof rawPage.hidden === "boolean") page.hidden = rawPage.hidden;
    return page;
  });
  if (opts.strict) {
    const checkMasks = (elements: CanvasEl[]) => {
      for (const el of elements) {
        if (
          el.clippedBy &&
          !elements.some(
            (mask) =>
              mask.id === el.clippedBy &&
              mask.id !== el.id &&
              (mask.type === "shape" || mask.type === "svg"),
          )
        )
          throw new NsqError("invalid", "clipping reference");
        if (el.children) checkMasks(el.children);
      }
    };
    pages.forEach((p) => checkMasks(p.elements));
  }
  return { pages, warnings: [...warnings] };
}

// ── Migrations ───────────────────────────────────────────────────────────────

/**
 * Upgrade steps, keyed by the version they upgrade FROM. Each step receives
 * the raw parsed document of version N and returns version N + 1. Version 0
 * is the legacy plain-JSON project backup (`exportJson`), so every file NASAQ
 * ever wrote enters through the same validated path.
 */
export const DOCUMENT_MIGRATIONS: Record<
  number,
  (doc: Record<string, unknown>) => Record<string, unknown>
> = {
  // v2 makes self-contained assets mandatory and persists project settings.
  // v1 geometry is unchanged; missing settings default safely.
  1: (doc) => ({ ...doc, settings: validateProjectSettings(doc.settings) }),
  0: (legacy) => ({
    schema: NSQ_DOCUMENT_SCHEMA,
    modelVersion: Number(legacy.version) || 2,
    project: {
      name: legacy.name,
      theme: legacy.theme,
      orgName: legacy.orgName,
      transactionNo: legacy.transactionNo,
      defaultSize: legacy.defaultSize,
      pack: legacy.pack,
      licensedTemplateId: legacy.licensedTemplateId,
      sourceProjectId: legacy.id,
      createdAt: legacy.createdAt,
      updatedAt: legacy.updatedAt,
    },
    pages: legacy.pages,
  }),
};

/** Run every migration from `fromVersion` up to the current format version. */
export function migrateDocument(
  raw: unknown,
  fromVersion: number,
): Record<string, unknown> {
  if (!Number.isInteger(fromVersion) || fromVersion < 0)
    throw new NsqError("invalid", "migration version");
  if (fromVersion > NSQ_FORMAT_VERSION) throw new NsqError("too-new");
  if (!isRecord(raw))
    throw new NsqError("invalid", "document is not an object");
  let doc = raw;
  for (let v = fromVersion; v < NSQ_FORMAT_VERSION; v++) {
    const step = DOCUMENT_MIGRATIONS[v];
    if (!step) throw new NsqError("invalid", `no migration from v${v}`);
    doc = step(doc);
  }
  return doc;
}

/** Map a validated document to the project shape `importProject` consumes. */
export function documentToProject(
  doc: Record<string, unknown>,
  pages: Page[],
): Partial<Project> {
  const meta = isRecord(doc.project) ? doc.project : {};
  const str = (v: unknown) =>
    typeof v === "string" ? v.slice(0, 300) : undefined;
  const oneOf = <T extends string>(
    v: unknown,
    allowed: readonly T[],
  ): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
  return {
    version: Number(doc.modelVersion) || 2,
    nativeFormat: NSQ_FORMAT_VERSION,
    nativeSourceProjectId: str(meta.sourceProjectId),
    createdAt: finite(meta.createdAt) ? meta.createdAt : undefined,
    updatedAt: finite(meta.updatedAt) ? meta.updatedAt : undefined,
    editorSettings: validateProjectSettings(doc.settings),
    name: str(meta.name) || "مشروع نَسَق",
    theme: oneOf(meta.theme, THEME_IDS) || "official",
    orgName: str(meta.orgName) || "",
    transactionNo: str(meta.transactionNo) || "",
    defaultSize: oneOf(meta.defaultSize, SIZE_IDS),
    pack: oneOf(meta.pack, PACK_IDS),
    licensedTemplateId: str(meta.licensedTemplateId),
    pages,
  };
}

/**
 * Best guess, DURING a drag, that the payload is an `.nsq` file. Browsers
 * hide file names until drop, but they expose each item's MIME type: images
 * report `image/*`, while `.nsq` reports our MIME type or nothing at all.
 */
export function likelyNsqDrag(
  dt: {
    types?: readonly string[];
    items?: ArrayLike<{ kind: string; type: string }>;
  } | null,
): boolean {
  if (!dt?.types || !Array.from(dt.types).includes("Files") || !dt.items)
    return false;
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  return (
    items.length > 0 && items.every((i) => i.type === "" || i.type === NSQ_MIME)
  );
}

/** Only document settings travel; never import auth, licenses or device paths. */
export function validateProjectSettings(
  raw: unknown,
): NonNullable<Project["editorSettings"]> {
  if (!isRecord(raw)) return {};
  const settings: NonNullable<Project["editorSettings"]> = {};
  if (isRecord(raw.printGuides))
    settings.printGuides = {
      safe: raw.printGuides.safe === true,
      gutter: raw.printGuides.gutter === true,
      bleed: raw.printGuides.bleed === true,
    };
  for (const key of ["showGrid", "snapGrid", "snapElements", "clipExport"] as const)
    if (typeof raw[key] === "boolean") settings[key] = raw[key];
  return settings;
}
