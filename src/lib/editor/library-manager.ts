/**
 * LibraryManager — the import-side normalizer for `nasaq-library` JSON files.
 *
 * A library file carries `{kind, version, folders, assets}` between devices,
 * but files written by hand (or by older builds) often arrive incomplete:
 * no folder list, assets without `folderId`, assets without dimensions or
 * names. Historically those gaps made items render nowhere — an asset whose
 * `folderId` pointed at nothing matched no folder chip and never satisfied
 * the grid filter, so the shelf looked empty even though the import had
 * written rows to storage.
 *
 * `normalizeNasaqLibrary` repairs a parsed file *before* it is planned into
 * the store:
 *   - guarantees the default «غير مصنّف» folder (`folder-uncategorized`),
 *   - classifies every asset into a folder that actually exists in the file,
 *   - fills in missing `id` / `name` / `w` / `h` / `addedAt` so no row is
 *     dropped downstream for lacking dimensions.
 *
 * Keeping this module free of runtime imports means it loads under
 * `node --experimental-strip-types` for the unit tests, exactly like the
 * other pure editor helpers.
 */
import type { AssetFolder } from "./storage";

/** Stable id of the default folder — survives export → import round-trips. */
export const DEFAULT_FOLDER_ID = "folder-uncategorized";
/** Display name of the default folder (Arabic: "uncategorised"). */
export const DEFAULT_FOLDER_NAME = "غير مصنّف";
/**
 * Fallback box for imported assets that arrive without dimensions. The shelf
 * only needs finite positive numbers here — `placedBox` clamps on insert.
 */
const DEFAULT_ASSET_SIZE = 100;

/** One asset after normalization: every field the shelf relies on is present. */
export interface NasaqLibraryAsset {
  id: string;
  name: string;
  src: string;
  /** Always a folder id that exists in the sibling `folders` list. */
  folderId: string;
  w: number;
  h: number;
  addedAt: number;
}

/** Canonical shape returned by {@link normalizeNasaqLibrary}. */
export interface NormalizedNasaqLibrary {
  kind: "nasaq-library";
  version: 1;
  folders: AssetFolder[];
  assets: NasaqLibraryAsset[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Normalise a parsed `nasaq-library` document into the canonical shape the
 * import planner consumes.
 *
 * Guarantees (the three import bugs this repairs):
 *  1. The default «غير مصنّف» folder is first in `folders` when the file
 *     does not already define `folder-uncategorized`.
 *  2. Every asset's `folderId` is non-empty AND present in `folders` —
 *     missing, blank, or dangling references fall back to the default id.
 *  3. `id`, `name`, `src`, `w`, `h`, `addedAt` are always usable, so
 *     `planLibraryImport` can no longer skip dimension-less rows and lose
 *     the asset entirely.
 *  4. Folder `parentId` (nested shelves) is preserved across the round-trip
 *     and re-validated against real ids — missing parents fall back to root.
 *
 * Unknown extra fields on folders/assets are intentionally dropped: the
 * canonical file format is `{kind, version, folders, assets}` only.
 */
export function normalizeNasaqLibrary(
  jsonData: unknown,
): NormalizedNasaqLibrary {
  const data: Record<string, unknown> = isObject(jsonData) ? jsonData : {};

  // Folders pass through (spec) with just enough coercion to stay typed:
  // non-object entries are dropped, missing ids/timestamps are filled in.
  const rawFolders = Array.isArray(data.folders) ? data.folders : [];
  const folders: AssetFolder[] = rawFolders.filter(isObject).map((folder) => ({
    id:
      typeof folder.id === "string" && folder.id
        ? folder.id
        : `folder-${Math.random().toString(36).slice(2, 11)}`,
    name: typeof folder.name === "string" ? folder.name : "",
    createdAt: finiteOr(folder.createdAt, Date.now()),
    // Nested shelves survive export → import: the raw parentId is carried
    // through here and only re-validated (parent exists, not itself) below,
    // after every folder id is known.
    parentId:
      typeof folder.parentId === "string" && folder.parentId
        ? folder.parentId
        : null,
  }));

  // Spec: ensure the default Uncategorized folder exists (unshift if absent).
  const existingDefault = folders.find(
    (folder) => folder.id === DEFAULT_FOLDER_ID,
  );
  if (!existingDefault) {
    folders.unshift({
      id: DEFAULT_FOLDER_ID,
      name: DEFAULT_FOLDER_NAME,
      createdAt: Date.now(),
    });
  } else if (!existingDefault.name.trim()) {
    // Present by id but blanked by hand — restore the label the chips show.
    existingDefault.name = DEFAULT_FOLDER_NAME;
  }

  const knownFolderIds = new Set(folders.map((folder) => folder.id));

  // Re-wire hierarchy now that every id is known: a parent that vanished
  // from the file (or points at the folder itself) degrades to root, never
  // a dangling reference or a cycle. Duplicate ids collapse to the first
  // occurrence, so a child always resolves against a real folder.
  {
    const seenIds = new Set<string>();
    for (const folder of folders) {
      if (seenIds.has(folder.id)) {
        folder.id = `folder-${Math.random().toString(36).slice(2, 11)}`;
        folder.parentId = null;
      }
      seenIds.add(folder.id);
    }
    for (const folder of folders) {
      if (
        folder.parentId &&
        (!knownFolderIds.has(folder.parentId) ||
          folder.parentId === folder.id)
      ) {
        folder.parentId = null;
      }
    }
    // Cycle guard (a↔b hand-edits): walk up; any loop lands at root.
    for (const folder of folders) {
      const seen = new Set<string>([folder.id]);
      let cursor = folder.parentId;
      while (cursor) {
        if (seen.has(cursor)) {
          folder.parentId = null;
          break;
        }
        seen.add(cursor);
        cursor =
          folders.find((candidate) => candidate.id === cursor)?.parentId ??
          null;
      }
    }
  }

  const rawAssets = Array.isArray(data.assets) ? data.assets : [];
  const assets: NasaqLibraryAsset[] = rawAssets
    .filter(isObject)
    .map((asset) => {
      // Spec fallbacks: id, name, folderId. We additionally keep (or supply)
      // w/h/addedAt — without finite dimensions the planner drops the row and
      // the asset never reaches the shelf, which is the original bug.
      const rawFolderId =
        typeof asset.folderId === "string" && asset.folderId
          ? asset.folderId
          : null;
      return {
        id:
          typeof asset.id === "string" && asset.id
            ? asset.id
            : // Spec: `asset-${random}` (substr(2, 9) ≡ slice(2, 11)).
              `asset-${Math.random().toString(36).slice(2, 11)}`,
        name:
          typeof asset.name === "string" && asset.name
            ? asset.name
            : "عنصر بدون عنوان",
        src: typeof asset.src === "string" ? asset.src : "",
        // Missing, blank, OR dangling folder links → default folder, never
        // a value the grid filter cannot resolve.
        folderId:
          rawFolderId && knownFolderIds.has(rawFolderId)
            ? rawFolderId
            : DEFAULT_FOLDER_ID,
        w: Math.max(1, finiteOr(asset.w, DEFAULT_ASSET_SIZE)),
        h: Math.max(1, finiteOr(asset.h, DEFAULT_ASSET_SIZE)),
        addedAt: finiteOr(asset.addedAt, Date.now()),
      };
    });

  return {
    kind: "nasaq-library",
    version: 1,
    folders,
    assets,
  };
}
