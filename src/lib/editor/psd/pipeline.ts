/**
 * PSD → NASAQ pipeline.
 *
 * Upload checks happen before this runs. Parsing, extraction, native
 * conversion, library matching and validation are one async job so a worker
 * (or the main thread, if a worker cannot start) can report progress without
 * freezing the owner panel.
 */

import type { Project } from "../model";
import { clone } from "../model";
import type { Asset } from "../storage";
import { convertPsdDocument } from "./convert";
import { dataUrlToBytes, sha256Hex } from "./image-codec";
import { parsePsd } from "./parse";
import { asUint8 } from "./security";
import type {
  AssetFinding,
  ConversionReport,
  PsdLibraryRef,
  PsdProgress,
  ValidationResult,
} from "./types";
import { validateConversion } from "./validate";

export interface PsdImportResult {
  project: Project;
  report: ConversionReport;
  validation: ValidationResult;
  compositeDataUrl?: string;
}

export async function importPsdBytes(
  bytes: Uint8Array | ArrayBuffer,
  fileName: string,
  library: PsdLibraryRef[] = [],
  onProgress?: PsdProgress,
): Promise<PsdImportResult> {
  onProgress?.("فحص الملف", 4);
  const doc = await parsePsd(asUint8(bytes), fileName, onProgress);
  onProgress?.("تحويل إلى عناصر نَسَق", 72);
  const { project, report } = convertPsdDocument(doc, { library });
  onProgress?.("التحقق البصري", 90);
  const validation = validateConversion(doc, project);
  onProgress?.("اكتمل", 100);
  return {
    project,
    report,
    validation,
    compositeDataUrl: doc.compositeDataUrl,
  };
}

/** Hash library bytes so a PSD image can match an asset that is already owned. */
export async function fingerprintAssets(
  assets: Pick<Asset, "id" | "name" | "src" | "contentHash">[],
  onProgress?: PsdProgress,
): Promise<PsdLibraryRef[]> {
  const out: PsdLibraryRef[] = [];
  let index = 0;
  for (const asset of assets) {
    index += 1;
    if (index % 8 === 0) {
      onProgress?.("مطابقة المكتبة", Math.min(70, Math.round((index / Math.max(1, assets.length)) * 20)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (asset.contentHash) {
      out.push({ hash: asset.contentHash, assetId: asset.id, name: asset.name });
      continue;
    }
    const bytes = dataUrlToBytes(asset.src);
    if (!bytes) continue;
    out.push({ hash: await sha256Hex(bytes), assetId: asset.id, name: asset.name });
  }
  return out;
}

export type AssetDisposition = "design" | "library" | "replace" | "independent";

export interface AssetDecision {
  hash: string;
  disposition: AssetDisposition;
  replaceAssetId?: string;
  folderId?: string | null;
}

export interface LibrarySave {
  hash: string;
  name: string;
  src: string;
  w: number;
  h: number;
  folderId: string | null;
}

/**
 * Apply the owner's per-asset choice without creating a second copy when the
 * bytes are already in the library.
 */
export function applyAssetDecisions(
  project: Project,
  assets: AssetFinding[],
  decisions: AssetDecision[],
  librarySrc: Map<string, string>,
): { project: Project; saves: LibrarySave[] } {
  const next = clone(project);
  const byHash = new Map(assets.map((asset) => [asset.hash, asset]));
  const decisionOf = new Map(decisions.map((row) => [row.hash, row]));
  const saves: LibrarySave[] = [];
  const saved = new Set<string>();
  const visit = (els: Project["pages"][number]["elements"]) => {
    for (const el of els) {
      const hash = assets.find((asset) => asset.elementId === el.id)?.hash;
      if (hash && el.src) {
        const asset = byHash.get(hash)!;
        const decision = decisionOf.get(hash);
        const disposition = decision?.disposition || (asset.match ? "design" : "design");
        if (disposition === "replace" && decision?.replaceAssetId) {
          const src = librarySrc.get(decision.replaceAssetId);
          if (src) el.src = src;
        } else if (disposition !== "independent" && asset.match) {
          const src = librarySrc.get(asset.match.assetId);
          if (src) el.src = src;
        }
        if (disposition === "library" && !asset.match && !saved.has(hash)) {
          saved.add(hash);
          saves.push({
            hash,
            name: asset.name,
            src: asset.dataUrl,
            w: asset.width,
            h: asset.height,
            folderId: decision?.folderId ?? null,
          });
        }
      }
      if (el.children) visit(el.children);
    }
  };
  for (const page of next.pages) visit(page.elements);
  return { project: next, saves };
}
