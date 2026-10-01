/**
 * `.nsq` reader and writer.
 *
 * Environment-neutral (runs in the browser and under `node --test`): every DOM
 * concern — capturing the thumbnail, fetching remote images, loading fonts —
 * is injected by the caller, so the container logic stays deterministic and
 * testable.
 *
 * Writing is all-or-nothing: the package is fully assembled and then re-read
 * and verified in memory before any byte is handed to a file writer, so a save
 * can never produce a half-written or unreadable project.
 */

import JSZip from "jszip";
import { inspectZip, readZipEntry } from "./zip-container.ts";
import { assertPassiveSvg } from "./passive-svg.ts";
import type { CanvasEl, Page, Project } from "../editor/model.ts";
import {
  ASSET_REF,
  BUNDLED_FONTS,
  DEFAULT_FALLBACK_FONT,
  FONT_MIME_EXT,
  IMAGE_MIME_EXT,
  NSQ_DOCUMENT_SCHEMA,
  NSQ_FORMAT,
  NSQ_FORMAT_VERSION,
  NSQ_LIMITS,
  NSQ_MIME,
  NSQ_PATHS,
  NsqError,
  STORED_EXTS,
  collectFontFamilies,
  documentToProject,
  migrateDocument,
  validateManifest,
  validatePages,
  validateProjectSettings,
  type NsqAssetEntry,
  type NsqDocument,
  type NsqFontEntry,
  type NsqManifest,
  type NsqOrigin,
} from "./format.ts";

// ── Byte helpers ─────────────────────────────────────────────────────────────

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(bin);
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** Decode a `data:` URL into its MIME type and raw bytes. */
export function parseDataUrl(
  src: string,
): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]*)((?:;[^;,]*)*),([\s\S]*)$/i.exec(src);
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").toLowerCase();
  const isBase64 = /;base64/i.test(match[2]);
  try {
    const bytes = isBase64
      ? base64ToBytes(match[3])
      : new TextEncoder().encode(decodeURIComponent(match[3]));
    return { mime, bytes };
  } catch {
    return null;
  }
}

export async function sha256Hex(
  bytes: Uint8Array,
): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const digest = await subtle.digest(
      "SHA-256",
      bytes as unknown as ArrayBuffer,
    );
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return undefined;
  }
}

/** Identify a font file by its magic bytes (data-URL MIME types are unreliable). */
export function sniffFontMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === "wOF2") return "font/woff2";
  if (tag === "wOFF") return "font/woff";
  if (tag === "OTTO") return "font/otf";
  if (
    tag === "true" ||
    (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
  )
    return "font/ttf";
  return null;
}

/** Normalise an image MIME type to one the format accepts. */
function imageMime(mime: string, bytes: Uint8Array): string | null {
  const m = mime === "image/jpg" ? "image/jpeg" : mime;
  // Validate magic rather than trusting a declared image MIME carrying HTML.
  if (
    m === "image/avif" &&
    new TextDecoder().decode(bytes.subarray(4, 32)).includes("ftypavif")
  )
    return m;
  // Sniff when the declared type is missing or generic.
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  const head = new TextDecoder().decode(bytes.subarray(0, 256));
  if (/<svg[\s/>]/i.test(head) || /^\s*<\?xml/i.test(head))
    return "image/svg+xml";
  return null;
}

const utf8 = new TextEncoder();

// ── Writer ───────────────────────────────────────────────────────────────────

export type NsqProjectInput = Project & { nsqOrigin?: NsqOrigin };

export interface NsqWriteInput {
  project: NsqProjectInput;
  activePageIndex?: number;
  /** Project-level editor settings that should travel with the file. */
  settings?: Record<string, unknown>;
  /** First-page PNG preview. Optional: the project is valid without it. */
  thumbnail?: { bytes: Uint8Array; width?: number; height?: number } | null;
  /** Font sources available on this device (uploaded fonts), as data URLs. */
  fontSources?: { family: string; dataUrl: string }[];
  /** Fetch a remote / blob: image so it can be packaged. Browser-only. */
  resolveExternal?: (url: string) => Promise<Blob | null>;
  /** Origin the file was saved from, for attribution and the README. */
  site?: string;
}

export interface NsqWriteResult {
  blob: Blob;
  manifest: NsqManifest;
  warnings: string[];
}

export async function writeNsq(input: NsqWriteInput): Promise<NsqWriteResult> {
  const { project } = input;
  if (!project || !Array.isArray(project.pages) || !project.pages.length) {
    throw new NsqError("invalid", "project has no pages");
  }
  validatePages(project.pages, { strict: true });
  if (project.version > 2) throw new NsqError("too-new", "editor model");
  const warnings = new Set<string>();
  let assetBytes = 0;
  const zip = new JSZip();
  const now = Date.now();
  // `mimetype` first and uncompressed, so the type is readable at a fixed offset.
  zip.file(NSQ_PATHS.mimetype, NSQ_MIME, {
    compression: "STORE",
    date: new Date(now),
  });

  const assets: NsqAssetEntry[] = [];
  const bySource = new Map<string, string>();
  const byHash = new Map<string, string>();

  const addAsset = async (bytes: Uint8Array, mime: string): Promise<string> => {
    if (!bytes.length || bytes.length > NSQ_LIMITS.maxAssetBytes)
      throw new NsqError("too-large", "asset");
    if (mime === "image/svg+xml")
      assertPassiveSvg(new TextDecoder().decode(bytes));
    const sha = await sha256Hex(bytes);
    if (sha && byHash.has(sha)) return byHash.get(sha)!;
    assetBytes += bytes.length;
    if (assetBytes > NSQ_LIMITS.maxUncompressedBytes)
      throw new NsqError("too-large");
    const id = sha ? sha.slice(0, 32) : `a${assets.length + 1}`;
    const ext = IMAGE_MIME_EXT[mime];
    const path = `assets/${id}.${ext}`;
    zip.file(path, bytes, {
      binary: true,
      compression: STORED_EXTS.has(ext) ? "STORE" : "DEFLATE",
      date: new Date(now),
    });
    assets.push({ id, path, mime, size: bytes.length, sha256: sha });
    if (sha) byHash.set(sha, id);
    return id;
  };

  /** Package an image source; returns the replacement value for `src`. */
  const packImage = async (src: string): Promise<string | undefined> => {
    if (bySource.has(src)) return ASSET_REF + bySource.get(src);
    let bytes: Uint8Array | null = null;
    let mime: string | null = null;
    if (/^data:/i.test(src)) {
      if (src.length > NSQ_LIMITS.maxAssetBytes * 1.4 + 1024)
        throw new NsqError("too-large", "inline asset");
      const parsed = parseDataUrl(src);
      if (parsed) {
        bytes = parsed.bytes;
        mime = imageMime(parsed.mime, parsed.bytes);
      }
    } else if (/^(https?:|blob:|\/[^/]|\.\.?\/)/i.test(src)) {
      const blob = input.resolveExternal
        ? await input.resolveExternal(src).catch(() => null)
        : null;
      if (blob && blob.size) {
        if (blob.size > NSQ_LIMITS.maxAssetBytes)
          throw new NsqError("too-large", "remote asset");
        bytes = new Uint8Array(await blob.arrayBuffer());
        mime = imageMime((blob.type || "").toLowerCase(), bytes);
      }
      if (!bytes || !mime) throw new NsqError("missing-asset", src);
    } else {
      // Never silently drop paths/temporary images or ship an external link.
      throw new NsqError("missing-asset", "image is not portable");
    }
    if (!bytes || !mime) throw new NsqError("invalid", "unsupported image");
    const id = await addAsset(bytes, mime);
    bySource.set(src, id);
    return ASSET_REF + id;
  };

  const packEl = async (el: CanvasEl): Promise<CanvasEl> => {
    const out: CanvasEl = { ...el, style: { ...(el.style || {}) } };
    if (typeof el.src === "string" && el.src) {
      const next = await packImage(el.src);
      if (next) out.src = next;
      else delete out.src;
    }
    if (
      el.type === "svg" &&
      typeof el.content === "string" &&
      el.content.includes("<svg")
    ) {
      const key = `svg:${el.content}`;
      let id = bySource.get(key);
      if (!id) {
        id = await addAsset(utf8.encode(el.content), "image/svg+xml");
        bySource.set(key, id);
      }
      out.content = ASSET_REF + id;
    }
    if (el.children?.length) {
      out.children = [];
      for (const child of el.children) out.children.push(await packEl(child));
    }
    return out;
  };

  const pages: Page[] = [];
  for (const page of project.pages) {
    const elements: CanvasEl[] = [];
    for (const el of page.elements || []) elements.push(await packEl(el));
    pages.push({ ...page, elements });
  }

  // Fonts: record every family, embed uploaded files where this device has them.
  const fontSources = new Map(
    [...(project.embeddedFonts || []), ...(input.fontSources || [])].map(
      (f) => [f.family, f.dataUrl],
    ),
  );
  const fonts: NsqFontEntry[] = [];
  for (const family of collectFontFamilies(project.pages)) {
    const bundled = BUNDLED_FONTS.has(family);
    const entry: NsqFontEntry = {
      family,
      bundled,
      fallback: DEFAULT_FALLBACK_FONT,
    };
    const source = fontSources.get(family);
    if (source) {
      const parsed = parseDataUrl(source);
      const mime = parsed ? sniffFontMime(parsed.bytes) : null;
      if (parsed && mime) {
        if (parsed.bytes.length > NSQ_LIMITS.maxFontBytes)
          throw new NsqError("too-large", "font");
        const sha = await sha256Hex(parsed.bytes);
        const ext = FONT_MIME_EXT[mime];
        const path = `fonts/${(sha || `f${fonts.length + 1}`).slice(0, 32)}.${ext}`;
        zip.file(path, parsed.bytes, {
          binary: true,
          compression: STORED_EXTS.has(ext) ? "STORE" : "DEFLATE",
          date: new Date(now),
        });
        Object.assign(entry, { path, mime, sha256: sha });
      }
    }
    fonts.push(entry);
  }

  const doc: NsqDocument = {
    schema: NSQ_DOCUMENT_SCHEMA,
    modelVersion: project.version || 2,
    project: {
      name: project.name || "مشروع نَسَق",
      theme: project.theme || "official",
      orgName: project.orgName || "",
      transactionNo: project.transactionNo || "",
      defaultSize: project.defaultSize,
      pack: project.pack,
      licensedTemplateId: project.licensedTemplateId,
      sourceProjectId: project.nativeSourceProjectId || project.id,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt || now,
    },
    pages,
    view: { activePageIndex: Math.max(0, input.activePageIndex ?? 0) },
    settings: validateProjectSettings(input.settings || project.editorSettings),
  };
  const docBytes = utf8.encode(JSON.stringify(doc));
  if (docBytes.length > NSQ_LIMITS.maxDocumentBytes)
    throw new NsqError("too-large", "document");
  zip.file(NSQ_PATHS.document, docBytes, {
    binary: true,
    compression: "DEFLATE",
    date: new Date(now),
  });

  let thumbnail: NsqManifest["thumbnail"] = null;
  if (
    input.thumbnail?.bytes?.length &&
    input.thumbnail.bytes.length <= NSQ_LIMITS.maxThumbnailBytes &&
    input.thumbnail.bytes[0] === 0x89 &&
    input.thumbnail.bytes[1] === 0x50
  ) {
    const opts = {
      binary: true,
      compression: "STORE" as const,
      date: new Date(now),
    };
    zip.file(NSQ_PATHS.thumbnail, input.thumbnail.bytes, opts);
    zip.file(NSQ_PATHS.quickLook, input.thumbnail.bytes, opts);
    thumbnail = {
      path: NSQ_PATHS.thumbnail,
      mime: "image/png",
      width: input.thumbnail.width,
      height: input.thumbnail.height,
    };
  }

  const first = project.pages[0];
  const origin: NsqOrigin = project.nsqOrigin?.firstSavedAt
    ? project.nsqOrigin
    : { createdWith: "NASAQ", firstSavedAt: now, site: input.site };
  const manifest: NsqManifest = {
    format: NSQ_FORMAT,
    formatVersion: NSQ_FORMAT_VERSION,
    minReaderVersion: NSQ_FORMAT_VERSION,
    mimetype: NSQ_MIME,
    generator: {
      name: "NASAQ",
      nameAr: "نَسَق",
      site: input.site,
      formatVersion: NSQ_FORMAT_VERSION,
    },
    title: project.name || "مشروع نَسَق",
    createdAt: project.createdAt || now,
    modifiedAt: now,
    pageCount: project.pages.length,
    firstPage: first
      ? { w: Number(first.w) || 210, h: Number(first.h) || 297 }
      : undefined,
    document: {
      path: NSQ_PATHS.document,
      size: docBytes.length,
      sha256: await sha256Hex(docBytes),
    },
    thumbnail,
    assets,
    fonts,
    external: [],
    attribution: origin,
  };
  zip.file(NSQ_PATHS.manifest, JSON.stringify(manifest, null, 2), {
    compression: "DEFLATE",
    date: new Date(now),
  });
  const openAt = input.site ? `${input.site.replace(/\/$/, "")}/open` : "NASAQ";
  zip.file(
    NSQ_PATHS.readme,
    [
      `«${manifest.title}» — ملف مشروع نَسَق (NASAQ) قابل للتحرير.`,
      `افتح الملف في نَسَق لمتابعة التعديل: ${openAt}`,
      "",
      `"${manifest.title}" is an editable NASAQ project file (.nsq).`,
      `Open it in NASAQ to keep editing: ${openAt}`,
      "",
    ].join("\r\n"),
    { compression: "DEFLATE", date: new Date(now) },
  );

  if (assets.length + fonts.length + 10 > NSQ_LIMITS.maxEntries)
    throw new NsqError("too-large", "entries");
  const type = JSZip.support.blob ? "blob" : "uint8array";
  const generated = await zip.generateAsync({
    type,
    mimeType: NSQ_MIME,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const blob =
    generated instanceof Blob
      ? generated
      : new Blob([generated as Uint8Array<ArrayBuffer>], { type: NSQ_MIME });

  // Verify before anything is written anywhere: the package must re-open.
  await readNsq(blob, { verifyOnly: true });

  return { blob, manifest, warnings: [...warnings] };
}

// ── Reader ───────────────────────────────────────────────────────────────────

export interface NsqReadResult {
  project: Partial<Project>;
  manifest: NsqManifest | null;
  /** First-page preview as a PNG data URL, when the file carries one. */
  thumbnail?: string;
  /** Embedded font files, ready for `new FontFace(family, url(dataUrl))`. */
  embeddedFonts: { family: string; dataUrl: string }[];
  fontEntries: NsqFontEntry[];
  activePageIndex: number;
  origin?: NsqOrigin;
  warnings: string[];
  /** True for a pre-`.nsq` JSON project backup. */
  legacy: boolean;
}

type ReadInput = Blob | ArrayBuffer | Uint8Array;

async function toBytes(input: ReadInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

function byteSize(input: ReadInput): number {
  return input instanceof Blob ? input.size : input.byteLength;
}

async function head(input: ReadInput, n: number): Promise<Uint8Array> {
  if (input instanceof Blob)
    return new Uint8Array(await input.slice(0, n).arrayBuffer());
  return (await toBytes(input)).subarray(0, n);
}

/**
 * Read, validate and fully resolve an `.nsq` (or a legacy JSON backup).
 *
 * Throws `NsqError` for every failure; on success the returned project is
 * plain, validated data with every asset inlined back into the data-URL form
 * the editor stores — nothing from the file is ever executed.
 */
export async function readNsq(
  input: ReadInput,
  opts: {
    verifyOnly?: boolean;
    allowLegacy?: boolean;
    includeThumbnail?: boolean;
  } = {},
): Promise<NsqReadResult> {
  const size = byteSize(input);
  if (!size) throw new NsqError("empty");
  if (size > NSQ_LIMITS.maxFileBytes) throw new NsqError("too-large");

  const magic = await head(input, 4);
  const isZip =
    magic[0] === 0x50 &&
    magic[1] === 0x4b &&
    magic[2] === 0x03 &&
    magic[3] === 0x04;
  if (!isZip) {
    if (opts.allowLegacy === false) throw new NsqError("not-nsq");
    return readLegacyJson(input);
  }
  const archiveBytes = await toBytes(input);
  const directory = inspectZip(archiveBytes);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: false });
  } catch (err) {
    throw new NsqError(
      "corrupt",
      err instanceof Error ? err.message : undefined,
    );
  }

  // JSZip can interpret Unicode-name extra fields. They must not remap an
  // entry around the raw-directory checks or collapse two files into one.
  const decodedNames = Object.keys(zip.files);
  if (
    decodedNames.length !== directory.size ||
    decodedNames.some((name) => !directory.has(name))
  )
    throw new NsqError("invalid", "zip filename remapping");

  const readEntry = (name: string, limit: number) =>
    readZipEntry(zip, directory, name, limit);
  const textEntry = async (name: string, limit: number) =>
    new TextDecoder().decode(await readEntry(name, limit));
  const mimeEntry = zip.file(NSQ_PATHS.mimetype);
  if (!mimeEntry) throw new NsqError("not-nsq", "mimetype missing");
  if ((await textEntry(NSQ_PATHS.mimetype, 128)).trim() !== NSQ_MIME)
    throw new NsqError("not-nsq", "mimetype");
  const manifestEntry = zip.file(NSQ_PATHS.manifest);
  if (!manifestEntry) throw new NsqError("not-nsq", "no manifest");
  let manifest: NsqManifest;
  try {
    manifest = validateManifest(
      JSON.parse(
        await textEntry(NSQ_PATHS.manifest, NSQ_LIMITS.maxManifestBytes),
      ),
    );
  } catch (err) {
    if (err instanceof NsqError) throw err;
    throw new NsqError("corrupt", "manifest unreadable");
  }

  const warnings: string[] = [];
  const docEntry = zip.file(manifest.document.path);
  if (!docEntry) throw new NsqError("invalid", "document missing");
  const docBytes = await readEntry(
    manifest.document.path,
    NSQ_LIMITS.maxDocumentBytes,
  );
  if (manifest.document.sha256) {
    const sha = await sha256Hex(docBytes);
    if (sha && sha !== manifest.document.sha256)
      throw new NsqError("integrity", "document hash");
  }
  let rawDoc: unknown;
  try {
    rawDoc = JSON.parse(new TextDecoder().decode(docBytes));
  } catch {
    throw new NsqError("corrupt", "document json");
  }
  if (manifest.document.size !== docBytes.length)
    throw new NsqError("integrity", "document size");
  const doc = migrateDocument(rawDoc, manifest.formatVersion);
  if (
    !Number.isInteger(doc.modelVersion) ||
    Number(doc.modelVersion) < 1 ||
    Number(doc.modelVersion) > 2
  )
    throw new NsqError("too-new", "editor model");
  if (doc.schema !== NSQ_DOCUMENT_SCHEMA)
    throw new NsqError("invalid", "document schema");
  const { pages, warnings: pageWarnings } = validatePages(doc.pages, {
    strict: true,
  });
  warnings.push(...pageWarnings);

  // Resolve asset references back into data URLs / markup.
  const assetById = new Map(manifest.assets.map((a) => [a.id, a]));
  const resolved = new Map<string, { dataUrl: string; text?: string }>();
  const loadAsset = async (id: string, wantText: boolean) => {
    const key = id;
    const hit = resolved.get(key);
    if (hit) {
      if (wantText && hit.text === undefined)
        throw new NsqError("invalid", "svg asset mime");
      return hit;
    }
    const entry = assetById.get(id);
    const file = entry ? zip.file(entry.path) : null;
    if (!entry || !file) throw new NsqError("missing-asset", id);
    const bytes = await readEntry(entry.path, NSQ_LIMITS.maxAssetBytes);
    if (entry.sha256) {
      const sha = await sha256Hex(bytes);
      if (sha && sha !== entry.sha256)
        throw new NsqError("integrity", `asset ${id}`);
    }
    if (entry.size !== bytes.length)
      throw new NsqError("integrity", `asset size ${id}`);
    if (imageMime(entry.mime, bytes) !== entry.mime)
      throw new NsqError("invalid", "asset content type");
    if (wantText && entry.mime !== "image/svg+xml")
      throw new NsqError("invalid", "svg asset mime");
    const text =
      entry.mime === "image/svg+xml"
        ? new TextDecoder().decode(bytes)
        : undefined;
    if (text !== undefined) assertPassiveSvg(text);
    const value = {
      dataUrl: opts.verifyOnly ? "" : bytesToDataUrl(bytes, entry.mime),
      text,
    };
    resolved.set(key, value);
    return value;
  };

  const resolveEl = async (el: CanvasEl): Promise<void> => {
    if (typeof el.src === "string" && el.src) {
      if (el.src.startsWith(ASSET_REF)) {
        el.src = (
          await loadAsset(el.src.slice(ASSET_REF.length), false)
        ).dataUrl;
      } else if (/^data:image\//i.test(el.src)) {
        const data = parseDataUrl(el.src);
        if (!data || !imageMime(data.mime, data.bytes))
          throw new NsqError("invalid", "inline image");
        if (data.mime === "image/svg+xml")
          assertPassiveSvg(new TextDecoder().decode(data.bytes));
      } else {
        throw new NsqError("missing-asset", "external or local reference");
      }
    }
    if (
      el.type === "svg" &&
      typeof el.content === "string" &&
      el.content.startsWith(ASSET_REF)
    ) {
      el.content =
        (await loadAsset(el.content.slice(ASSET_REF.length), true)).text || "";
    }
    if (el.type === "svg" && el.content) assertPassiveSvg(el.content);
    for (const child of el.children || []) await resolveEl(child);
  };
  for (const page of pages) for (const el of page.elements) await resolveEl(el);

  const embeddedFonts: { family: string; dataUrl: string }[] = [];
  for (const font of manifest.fonts) {
    if (!font.path || !font.mime) continue;
    const file = zip.file(font.path);
    if (!file) {
      warnings.push(`ملف الخط «${font.family}» مفقود — سيُستخدم خط بديل.`);
      continue;
    }
    const bytes = await readEntry(font.path, NSQ_LIMITS.maxFontBytes);
    if (!bytes || !sniffFontMime(bytes)) {
      warnings.push(`تعذر تحميل الخط «${font.family}» — سيُستخدم خط بديل.`);
      continue;
    }
    if (font.sha256) {
      const sha = await sha256Hex(bytes);
      if (sha && sha !== font.sha256) {
        warnings.push(`ملف الخط «${font.family}» تالف — سيُستخدم خط بديل.`);
        continue;
      }
    }
    if (!opts.verifyOnly)
      embeddedFonts.push({
        family: font.family,
        dataUrl: bytesToDataUrl(bytes, font.mime),
      });
  }

  let thumbnail: string | undefined;
  if (manifest.thumbnail && (!opts.verifyOnly || opts.includeThumbnail)) {
    const bytes = await readEntry(
      manifest.thumbnail.path,
      NSQ_LIMITS.maxThumbnailBytes,
    ).catch(() => null);
    if (bytes && bytes[0] === 0x89 && bytes[1] === 0x50)
      thumbnail = bytesToDataUrl(bytes, "image/png");
  }

  const view = (doc.view && typeof doc.view === "object" ? doc.view : {}) as {
    activePageIndex?: unknown;
  };
  const activePageIndex = Number.isInteger(view.activePageIndex)
    ? Math.min(pages.length - 1, Math.max(0, view.activePageIndex as number))
    : 0;

  return {
    project: { ...documentToProject(doc, pages), embeddedFonts },
    manifest,
    thumbnail,
    embeddedFonts,
    fontEntries: manifest.fonts,
    activePageIndex,
    origin: manifest.attribution,
    warnings: [...new Set(warnings)],
    legacy: false,
  };
}

async function readLegacyJson(input: ReadInput): Promise<NsqReadResult> {
  if (byteSize(input) > NSQ_LIMITS.maxDocumentBytes)
    throw new NsqError("too-large");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(await toBytes(input)));
  } catch {
    throw new NsqError("not-nsq");
  }
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { pages?: unknown }).pages)
  ) {
    throw new NsqError("not-nsq");
  }
  const doc = migrateDocument(raw, 0);
  const { pages, warnings } = validatePages(doc.pages);
  for (const page of pages) {
    const walk = (list: CanvasEl[]) => {
      for (const el of list) {
        if (el.src && !/^(data:image\/|https?:\/\/)/i.test(el.src))
          delete el.src;
        if (el.type === "svg" && el.content) assertPassiveSvg(el.content);
        if (el.src?.startsWith("data:image/svg+xml")) {
          const parsed = parseDataUrl(el.src);
          if (!parsed) throw new NsqError("invalid", "inline SVG");
          assertPassiveSvg(new TextDecoder().decode(parsed.bytes));
        }
        if (el.children) walk(el.children);
      }
    };
    walk(page.elements);
  }
  return {
    project: { ...documentToProject(doc, pages), nativeFormat: undefined },
    manifest: null,
    embeddedFonts: [],
    fontEntries: collectFontFamilies(pages).map((family) => ({
      family,
      bundled: BUNDLED_FONTS.has(family),
      fallback: DEFAULT_FALLBACK_FONT,
    })),
    activePageIndex: 0,
    warnings,
    legacy: true,
  };
}
