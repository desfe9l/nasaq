import type { Project, Page, CanvasEl } from "../editor/model";
import {
  NSQ_DOCUMENT_SCHEMA,
  NSQ_FORMAT_VERSION,
  NsqError,
  validatePages,
  documentToProject,
} from "./format";
import { readNsq, type NsqReadResult } from "./package";

export interface NormalizedProject {
  project: Project;
  warnings: string[];
  source: "nsq" | "json";
  activePageIndex: number;
  thumbnail?: string;
  read?: NsqReadResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function projectFromJson(raw: unknown): NormalizedProject {
  if (!isRecord(raw)) throw new NsqError("invalid", "JSON root");
  const canonical = raw.schema === NSQ_DOCUMENT_SCHEMA;
  const pagesValue = raw.pages ?? (isRecord(raw.project) ? raw.project.pages : undefined);
  const { pages, warnings } = validatePages(pagesValue, { allowAssetRefs: false });
  const doc = canonical
    ? raw
    : {
        schema: NSQ_DOCUMENT_SCHEMA,
        modelVersion: Number(raw.version) || 2,
        project: raw,
        pages,
        settings: raw.editorSettings,
      };
  const project = documentToProject(doc, pages) as Project;
  const metadata = isRecord(raw.project) ? raw.project : raw;
  if (typeof metadata.name === "string") project.name = metadata.name.slice(0, 300);
  if (typeof raw.embeddedFonts !== "undefined" && Array.isArray(raw.embeddedFonts)) {
    project.embeddedFonts = raw.embeddedFonts as Project["embeddedFonts"];
  }
  return {
    project,
    warnings,
    source: "json",
    activePageIndex: isRecord(raw.view) && Number.isInteger(raw.view.activePageIndex)
      ? Number(raw.view.activePageIndex)
      : 0,
  };
}

/**
 * Canonical intake for every project-like JSON value. It deliberately uses the
 * same tolerant validator as legacy JSON import: malformed elements are
 * isolated and reported while the remaining pages stay editable.
 */
export function normalizeProjectJson(raw: unknown): NormalizedProject {
  return projectFromJson(raw);
}

/** Canonical intake for a file. NSQ is decoded first; JSON is recovery-normalized. */
export async function normalizeProjectFile(
  input: Uint8Array | Blob,
  fileName = "project.nsq",
): Promise<NormalizedProject> {
  const isJson = /\.json$/i.test(fileName);
  const read = await readNsq(input, { allowLegacy: true, includeThumbnail: true });
  if (read.legacy || isJson) {
    return { ...projectFromJson(read.project), read, source: "json" };
  }
  return {
    project: read.project as Project,
    warnings: read.warnings,
    source: "nsq",
    activePageIndex: read.activePageIndex,
    thumbnail: read.thumbnail,
    read,
  };
}

export function countProjectElements(pages: Page[]): { texts: number; images: number; shapes: number; tables: number; total: number } {
  const counts = { texts: 0, images: 0, shapes: 0, tables: 0, total: 0 };
  const visit = (elements: CanvasEl[]) => {
    for (const element of elements) {
      counts.total += 1;
      if (element.type === "text") counts.texts += 1;
      if (element.type === "image" || element.type === "svg") counts.images += 1;
      if (["shape", "box", "line", "divider"].includes(element.type)) counts.shapes += 1;
      if (element.type === "table") counts.tables += 1;
      if (element.children) visit(element.children);
    }
  };
  pages.forEach((page) => visit(page.elements));
  return counts;
}

export const NSQ_CANONICAL_VERSION = NSQ_FORMAT_VERSION;
