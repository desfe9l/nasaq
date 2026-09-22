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

import { safeImageSrc } from "./images.ts";
import type { Asset, AssetFolder } from "./storage";
import { DEFAULT_FOLDER_ID, normalizeNasaqLibrary } from "./library-manager.ts";

export const LIBRARY_KIND = "nasaq-library";
export const LIBRARY_VERSION = 1;

/** The on-disk shape of an exported library file. */
export interface LibraryFile {
  kind: typeof LIBRARY_KIND;
  version: number;
  folders: Array<{ id: string; name: string; createdAt: number }>;
  assets: Array<{
    id: string;
    name: string;
    src: string;
    w: number;
    h: number;
    addedAt: number;
    folderId?: string | null;
  }>;
}

export interface LibraryExportInput {
  folders: AssetFolder[];
  assets: Asset[];
}

/** Build the export document from the current library state. */
export function buildLibraryFile({
  folders,
  assets,
}: LibraryExportInput): LibraryFile {
  return {
    kind: LIBRARY_KIND,
    version: LIBRARY_VERSION,
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      createdAt: f.createdAt,
    })),
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
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
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
  /**
   * Entries to create; ids are fresh. Every `folderId` resolves to a folder
   * the store will hold after the plan applies — an id from `folders` above
   * or an id of a folder that already exists (matched by name). Never null.
   */
  assets: Array<Omit<Asset, "id" | "addedAt"> & { addedAt?: number }>;
  /** Entries skipped because an identical one already exists. */
  skipped: number;
}

/**
 * Validate + plan an import against the existing library.
 *
 * Throws with an Arabic message when the file is not a nasaq-library document;
 * returns the merge plan otherwise. The raw document is first repaired through
 * `normalizeNasaqLibrary` (default «غير مصنّف» folder, complete asset fields,
 * folderId always present), then: existing folders are matched by name (no
 * duplicate folders), existing assets are matched by name + bytes.
 */
export function planLibraryImport(
  raw: unknown,
  existing: { folders: AssetFolder[]; assets: Asset[] },
): LibraryImportPlan {
  const file = raw as Partial<LibraryFile> | null;
  if (!file || file.kind !== LIBRARY_KIND || typeof file.version !== "number") {
    throw new Error(
      "الملف ليس ملف مكتبة صالح — اصدّر المكتبة أولاً من الجهاز الآخر.",
    );
  }
  if (file.version > LIBRARY_VERSION) {
    throw new Error("هذا الملف أحدث من نسختك — حدّث المنصة ثم أعد المحاولة.");
  }

  // Repair BEFORE planning: every asset leaving this function carries a
  // folderId that resolves — the old `?? null` fallback was what made
  // imported items match neither a folder chip nor the «الكل» view.
  const doc = normalizeNasaqLibrary(file);

  const plan: LibraryImportPlan = { folders: [], assets: [], skipped: 0 };
  const folderIdMap = new Map<string, string>();
  const existingFolderByName = new Map(
    existing.folders.map((f) => [f.name, f.id]),
  );
  const usedFolderIds = new Set(existing.folders.map((f) => f.id));

  for (const folder of doc.folders) {
    const name = folder.name.trim().slice(0, 80);
    if (!name) continue;
    const known = existingFolderByName.get(name);
    if (known) {
      folderIdMap.set(folder.id, known);
      continue;
    }
    // Prefer the file's own id when it is free, so «folder-uncategorized»
    // keeps its stable identity in the store instead of becoming a random id.
    const targetId =
      folder.id && !usedFolderIds.has(folder.id)
        ? folder.id
        : `folder_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    usedFolderIds.add(targetId);
    folderIdMap.set(folder.id, targetId);
    existingFolderByName.set(name, targetId);
    plan.folders.push({
      id: targetId,
      name,
      createdAt: folder.createdAt || Date.now(),
    });
  }

  // The normalizer always ships the default folder, so this is belt-and-braces
  // against a hand-built plan: assets must still land somewhere real.
  const fallbackFolderId = folderIdMap.get(DEFAULT_FOLDER_ID) ?? null;

  const existingAssetKeys = new Set(
    existing.assets.map(
      (a) => `${a.name}\u0000${a.src.length}\u0000${a.src.slice(-64)}`,
    ),
  );
  const usedNames = new Set(existing.assets.map((a) => a.name));

  for (const asset of doc.assets) {
    // Safe sources only — the same guard the canvas itself applies.
    if (!safeImageSrc(asset.src)) continue;

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

    plan.assets.push({
      name,
      src: asset.src,
      w: asset.w,
      h: asset.h,
      folderId: folderIdMap.get(asset.folderId) ?? fallbackFolderId,
      addedAt: asset.addedAt || Date.now(),
    });
  }

  return plan;
}
