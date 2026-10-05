/**
 * Dispatch a supported template file to the converter that can actually read it.
 * PSD stays on the existing pipeline. Nothing here invents a format.
 */

import type { PsdImportResult } from "../psd/pipeline";
import { classifyImport } from "./detect";
import { importDocxBytes } from "./docx";
import { importImageBytes } from "./raster";
import { importPdfBytes } from "./pdf";
import { importPptxBytes } from "./pptx";
import { importXlsxBytes } from "./xlsx";
import { type BuiltImport, type ImportKind, type ImportNote } from "./shared";
import { countProjectElements, normalizeProjectFile } from "../../nsq/normalize";

export interface TemplateImport extends BuiltImport {
  psd?: PsdImportResult;
}

const OFFICE_MAX = 80 * 1024 * 1024;

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
  const preview = result.project.thumbnail || null;
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
    previewDataUrl: preview,
    psd: result,
  };
}

export async function importTemplateBytes(
  bytes: Uint8Array,
  fileName: string,
  ids?: () => string,
): Promise<TemplateImport> {
  const classified = classifyImport(fileName, bytes);
  if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");
  const format: ImportKind = classified.format;
  if (format !== "psd" && format !== "psb" && bytes.byteLength > OFFICE_MAX) {
    throw new Error("حجم الملف أكبر من ٨٠ ميغابايت.");
  }
  if (format === "psd" || format === "psb") {
    const { importPsdBytes } = await import("../psd/pipeline");
    return mapPsd(fileName, await importPsdBytes(bytes, fileName));
  }
  if (format === "nsq" || format === "json") {
    return mapNormalized(format, fileName, await normalizeProjectFile(bytes, fileName));
  }
  if (format === "docx") return importDocxBytes(bytes, fileName, ids);
  if (format === "pptx") return importPptxBytes(bytes, fileName, ids);
  if (format === "xlsx") return importXlsxBytes(bytes, fileName, ids);
  if (format === "pdf") return importPdfBytes(bytes, fileName, ids);
  return importImageBytes(bytes, fileName, format, ids);
}
