/**
 * خدمة الاستيراد الموحّدة — the ONE NASAQ import service.
 *
 * Every entry point that turns a foreign file into a native NASAQ document
 * calls `importTemplateBytes`: the editor's «استيراد ملف» picker, the /import
 * service page, the admin console's import panel, and any surface that needs a
 * conversion. There is no second dispatcher and no format-specific entry
 * point — PSD/PSB runs the full Photoshop pipeline (layer tree, text, shapes,
 * effects, library matching, off-thread parsing with a main-thread fallback)
 * and every other format runs its own converter, all behind one result shape,
 * one size policy, one progress stream and one error vocabulary.
 *
 * The result (`TemplateImport`) carries the converted `project` plus the
 * conversion notes, stats and preview every surface renders — and, for
 * PSD/PSB, the full `psd` report (assets for library routing, fonts,
 * validation) so the owner UI keeps the capabilities the dedicated PSD path
 * had without a second importer.
 */

import { countProjectElements, normalizeProjectFile } from "../../nsq/normalize";
import type { Asset } from "../storage";
import type { PsdImportResult } from "../psd/pipeline";
import { assertPsdBytes, asUint8 } from "../psd/security";
import type { PsdLibraryRef, PsdProgress } from "../psd/types";
import { classifyImport } from "./detect";
import { importDocxBytes } from "./docx";
import { importImageBytes } from "./raster";
import { importPdfBytes } from "./pdf";
import { importPptxBytes } from "./pptx";
import { importXlsxBytes } from "./xlsx";
import { type BuiltImport, type ImportKind, type ImportNote } from "./shared";

export interface TemplateImport extends BuiltImport {
  /** Present for PSD/PSB only: conversion report, validation and asset findings. */
  psd?: PsdImportResult;
}

export interface ImportOptions {
  /** Deterministic id source (tests, reproducible conversions). */
  ids?: () => string;
  /**
   * Library rows (usually `listAssets()`) whose bytes are fingerprinted so a
   * PSD bitmap links to the asset the account already owns instead of being
   * embedded twice. Ignored when `library` is given.
   */
  assets?: Pick<Asset, "id" | "name" | "src" | "contentHash">[];
  /** Pre-fingerprinted library references, when the caller already hashed them. */
  library?: PsdLibraryRef[];
  /** One progress stream for every format. */
  onProgress?: PsdProgress;
  /** Allow PSD/PSB parsing in a module worker (falls back to this thread). */
  worker?: boolean;
}

/** Office/PDF/raster ceiling (the same limit the server gate enforces). */
const OFFICE_MAX = 80 * 1024 * 1024;
/** Photoshop ceiling — the service's own guard, matching the UI copy. */
const PSD_MAX = 200 * 1024 * 1024;
const WORKER_TIMEOUT = 180_000;

function mapNormalized(
  format: "nsq" | "json",
  fileName: string,
  normalized: Awaited<ReturnType<typeof normalizeProjectFile>>,
): TemplateImport {
  const counts = countProjectElements(normalized.project.pages);
  const notes: ImportNote[] = normalized.warnings.map((reason) => ({
    name: fileName,
    mode: "partial",
    reason,
  }));
  return {
    format,
    project: normalized.project,
    notes,
    stats: {
      pages: normalized.project.pages.length,
      texts: counts.texts,
      images: counts.images,
      shapes: counts.shapes,
      tables: counts.tables,
      editable: counts.total,
      partial: notes.length,
      flattened: 0,
      skipped: 0,
    },
    previewDataUrl: normalized.thumbnail || null,
  };
}

function mapPsd(fileName: string, result: PsdImportResult): TemplateImport {
  const notes: ImportNote[] = result.report.fallbacks.map((item) => ({
    name: item.layerName,
    mode: item.mode === "skipped" ? "skipped" : item.mode === "raster" ? "flattened" : "partial",
    reason: item.reason,
  }));
  return {
    format: fileName.toLowerCase().endsWith(".psb") ? "psb" : "psd",
    project: result.project,
    notes,
    stats: {
      pages: result.project.pages.length,
      texts: result.report.textCount,
      images: result.report.imageCount,
      shapes: result.report.shapeCount,
      tables: 0,
      editable: result.report.nativeCount,
      partial: result.report.fallbacks.filter((item) => item.mode === "partial").length,
      flattened: result.report.fallbacks.filter((item) => item.mode === "raster").length,
      skipped: result.report.fallbacks.filter((item) => item.mode === "skipped").length,
    },
    previewDataUrl: result.project.thumbnail || result.compositeDataUrl || null,
    psd: result,
  };
}

/**
 * Hash library bytes so a PSD image can match an asset that is already owned.
 * Kept here so every surface shares one matching implementation.
 */
export async function libraryRefsForImport(
  assets: Pick<Asset, "id" | "name" | "src" | "contentHash">[],
  onProgress?: PsdProgress,
): Promise<PsdLibraryRef[]> {
  const { fingerprintAssets } = await import("../psd/pipeline");
  return fingerprintAssets(assets, onProgress);
}

/** Run the PSD pipeline off-thread when the browser allows a module worker. */
async function convertPsdInWorker(
  bytes: Uint8Array,
  fileName: string,
  library: PsdLibraryRef[],
  onProgress?: PsdProgress,
): Promise<PsdImportResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../psd/psd.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      reject(error);
      return;
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("انتهت مهلة تحليل PSD"));
    }, WORKER_TIMEOUT);
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: "progress"; stage: string; percent: number; detail?: string }
        | { type: "done"; result: PsdImportResult }
        | { type: "error"; message: string };
      if (data.type === "progress") onProgress?.(data.stage, data.percent, data.detail);
      if (data.type === "done") {
        clearTimeout(timer);
        worker.terminate();
        resolve(data.result);
      }
      if (data.type === "error") {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(data.message));
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("تعذر تشغيل تحليل PSD في الخلفية"));
    };
    worker.postMessage({ buffer, fileName, library }, [buffer]);
  });
}

async function convertPsd(
  bytes: Uint8Array,
  fileName: string,
  options: ImportOptions,
  onProgress: PsdProgress,
): Promise<PsdImportResult> {
  const library =
    options.library ??
    (options.assets?.length ? await libraryRefsForImport(options.assets, onProgress) : []);
  const { importPsdBytes } = await import("../psd/pipeline");
  if (options.worker === false || typeof Worker === "undefined") {
    return importPsdBytes(bytes, fileName, library, onProgress);
  }
  try {
    return await convertPsdInWorker(bytes, fileName, library, onProgress);
  } catch {
    onProgress("التحويل على الخيط الرئيسي", 6, "تعذر تشغيل عامل الخلفية");
    return importPsdBytes(bytes, fileName, library, onProgress);
  }
}

/**
 * Convert any supported file into a native NASAQ project.
 *
 * The extension is only a hint: `classifyImport` verifies the first bytes, so
 * a renamed executable never reaches a converter, and the same classification
 * the server gate authorised is the one dispatched here.
 */
export async function importTemplateBytes(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
  options: ImportOptions = {},
): Promise<TemplateImport> {
  const data = asUint8(bytes);
  const classified = classifyImport(fileName, data);
  if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");
  const format: ImportKind = classified.format;
  const onProgress: PsdProgress = options.onProgress ?? (() => {});

  if (format === "psd" || format === "psb") {
    if (data.byteLength > PSD_MAX) throw new Error("حجم ملف PSD/PSB أكبر من ٢٠٠ ميغابايت.");
    assertPsdBytes(data);
    return mapPsd(fileName, await convertPsd(data, fileName, options, onProgress));
  }

  if (data.byteLength > OFFICE_MAX) throw new Error("حجم الملف أكبر من ٨٠ ميغابايت.");
  onProgress("تحويل الملف", 25, format.toUpperCase());

  if (format === "nsq" || format === "json") {
    const built = mapNormalized(format, fileName, await normalizeProjectFile(data, fileName));
    onProgress("اكتمل", 100);
    return built;
  }

  let built: BuiltImport;
  if (format === "docx") built = await importDocxBytes(data, fileName, options.ids);
  else if (format === "pptx") built = await importPptxBytes(data, fileName, options.ids);
  else if (format === "xlsx") built = await importXlsxBytes(data, fileName, options.ids);
  else if (format === "pdf") built = await importPdfBytes(data, fileName, options.ids);
  else built = await importImageBytes(data, fileName, format, options.ids);

  onProgress("اكتمل", 100);
  return built;
}
