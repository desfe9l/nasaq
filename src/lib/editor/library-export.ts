/**
 * Library export / import.
 *
 * The asset shelf is a standalone store: one JSON file carries the whole
 * library (folders + assets) between devices or browsers. Format is versioned
 * so a future schema change can still read today's files:
 *
 *   {"kind":"nasaq-library","version":1,"folders":[...],"assets":[...]}
 *
 * Import MERGES into the existing library: every imported entry gets a fresh
 * id, and entries already present (same name + same bytes) are skipped, so
 * importing the same file twice never duplicates anything. Asset names are
 * de-duplicated with a « (نسخة)» suffix like the editor's own duplication.
 *
 * Only `data:` and same-app image sources are accepted on import — anything
 * that could execute script (see images.ts) is dropped, not sanitised.
 */

import { safeImageSrc } from "./images";
import type { Asset, AssetFolder } from "./storage";

export const LIBRARY_KIND = "nasaq-library";
export const LIBRARY_VERSION = 1;

/** The on-disk shape of an exported library file. */
export interface LibraryFile {
  kind: typeof LIBRARY_KIND;
  version: number;
  folders: Array<{ id: string; name: string; createdAt: number }>;
  assets: Array<{ id: string; name: string; src: string; w: number; h: number; addedAt: number; folderId?: string | null }>;
}

export interface LibraryExportInput {
  folders: AssetFolder[];
  assets: Asset[];
}

/** Build the export document from the current library state. */
export function buildLibraryFile({ folders, assets }: LibraryExportInput): LibraryFile {
  return {
    kind: LIBRARY_KIND,
    version: LIBRARY_VERSION,
    folders: folders.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt })),
    assets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      src: a.src,
      w: a.w,
      h: a.h,
      addedAt: a.addedAt,
      folderId: a.folderId ?? null,
    })),
  };
}

/** Serialise + download the library as a JSON file. Returns the filename. */
export function downloadLibraryFile(input: LibraryExportInput): string {
  const file = buildLibraryFile(input);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const name = `nasaq-library-${new Date().toISOString().slice(0, 10)}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

export interface LibraryImportPlan {
  folders: Array<Pick<AssetFolder, "id" | "name" | "createdAt">>;
  /** Entries to create; ids are fresh, folderIds point into `folders` above. */
  assets: Array<Omit<Asset, "id" | "addedAt"> & { addedAt?: number }>;
  /** Entries skipped because an identical one already exists. */
  skipped: number;
}

const sameBytes = (a: string, b: string) => a.length === b.length && a === b;

/**
 * Validate + plan an import against the existing library.
 *
 * Throws with an Arabic message when the file is not a nasaq-library document;
 * returns the merge plan otherwise. Existing folders are matched by name (no
 * duplicate folders); existing assets are matched by name + bytes.
 */
export function planLibraryImport(
  raw: unknown,
  existing: { folders: AssetFolder[]; assets: Asset[] },
): LibraryImportPlan {
  const file = raw as Partial<LibraryFile> | null;
  if (!file || file.kind !== LIBRARY_KIND || typeof file.version !== "number") {
    throw new Error("الملف ليس ملف مكتبة صالح — اصدّر المكتبة أولاً من الجهاز الآخر.");
  }
  if (file.version > LIBRARY_VERSION) {
    throw new Error("هذا الملف أحدث من نسختك — حدّث المنصة ثم أعد المحاولة.");
  }

  const plan: LibraryImportPlan = { folders: [], assets: [], skipped: 0 };
  const folderIdMap = new Map<string, string>();
  const existingFolderByName = new Map(existing.folders.map((f) => [f.name, f.id]));

  for (const folder of Array.isArray(file.folders) ? file.folders : []) {
    if (!folder || typeof folder.name !== "string" || !folder.name.trim()) continue;
    const name = folder.name.trim().slice(0, 80);
    const known = existingFolderByName.get(name);
    if (known) {
      folderIdMap.set(folder.id, known);
      continue;
    }
    const freshId = `folder_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    folderIdMap.set(folder.id, freshId);
    existingFolderByName.set(name, freshId);
    plan.folders.push({ id: freshId, name, createdAt: Number(folder.createdAt) || Date.now() });
  }

  const existingAssetKeys = new Set(existing.assets.map((a) => `${a.name}\u0000${a.src.length}\u0000${a.src.slice(-64)}`));
  const usedNames = new Set(existing.assets.map((a) => a.name));

  for (const asset of Array.isArray(file.assets) ? file.assets : []) {
    if (!asset || typeof asset.name !== "string" || typeof asset.src !== "string") continue;
    // Safe sources only — the same guard the canvas itself applies.
    if (!safeImageSrc(asset.src)) continue;
    if (typeof asset.w !== "number" || typeof asset.h !== "number" || !Number.isFinite(asset.w) || !Number.isFinite(asset.h)) continue;

    const key = `${asset.name}\u0000${asset.src.length}\u0000${asset.src.slice(-64)}`;
    if (existingAssetKeys.has(key)) {
      plan.skipped += 1;
      continue;
    }
    existingAssetKeys.add(key);

    let name = asset.name.trim().slice(0, 120) || "عنصر";
    if (usedNames.has(name)) name = `${name} (نسخة)`;
    while (usedNames.has(name)) name = `${name} (نسخة)`;
    usedNames.add(name);

    const folderId = asset.folderId ? folderIdMap.get(asset.folderId) ?? null : null;
    plan.assets.push({
      name,
      src: asset.src,
      w: asset.w,
      h: asset.h,
      folderId,
      addedAt: Number(asset.addedAt) || Date.now(),
    });
  }

  return plan;
}
