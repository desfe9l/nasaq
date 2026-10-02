/**
 * Account library merge — folders, asset metadata and custom vectors.
 *
 * Bytes stay in object storage. This module only decides which metadata rows
 * survive a sync between two devices of the SAME account. It never reads
 * another user's catalog. Parent ids that dangle or cycle are lifted to the
 * root, matching the editor's "delete a folder lifts its children" rule.
 */

export interface SyncFolder {
  id: string;
  name: string;
  createdAt: number;
  parentId?: string | null;
}

export interface SyncAssetRef {
  id: string;
  remoteId?: string | null;
  name: string;
  folderId?: string | null;
  w: number;
  h: number;
  addedAt: number;
}

export interface SyncCustomItem {
  id: string;
  name: string;
  kind: "icon" | "divider";
  svg: string;
  createdAt: number;
}

export interface SyncTombstone {
  id: string;
  at: number;
}

export interface LibraryCatalog {
  folders: SyncFolder[];
  assets: SyncAssetRef[];
  customItems: SyncCustomItem[];
  removedAssets: SyncTombstone[];
  removedFolders: SyncTombstone[];
  updatedAt: number;
}

export const EMPTY_CATALOG: LibraryCatalog = {
  folders: [],
  assets: [],
  customItems: [],
  removedAssets: [],
  removedFolders: [],
  updatedAt: 0,
};

const LIMITS = {
  folders: 500,
  assets: 2000,
  custom: 200,
  svg: 100_000,
  name: 180,
  tombstones: 800,
};

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, LIMITS.name) : "";
  return name || fallback;
}

function tombstones(value: unknown): SyncTombstone[] {
  if (!Array.isArray(value)) return [];
  const out: SyncTombstone[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const at = Number(item.at);
    if (!id || !Number.isFinite(at)) continue;
    out.push({ id, at });
    if (out.length >= LIMITS.tombstones) break;
  }
  return out;
}

/** Drop anything that is not a plain catalog the server is willing to store. */
export function normalizeCatalog(value: unknown): LibraryCatalog {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const folders: SyncFolder[] = [];
  if (Array.isArray(raw.folders)) {
    for (const row of raw.folders) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) continue;
      folders.push({
        id,
        name: cleanName(item.name, "مجلد"),
        createdAt: Number(item.createdAt) || 0,
        parentId: typeof item.parentId === "string" ? item.parentId : null,
      });
      if (folders.length >= LIMITS.folders) break;
    }
  }
  const assets: SyncAssetRef[] = [];
  if (Array.isArray(raw.assets)) {
    for (const row of raw.assets) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) continue;
      assets.push({
        id,
        remoteId: typeof item.remoteId === "string" ? item.remoteId : null,
        name: cleanName(item.name, "ملف"),
        folderId: typeof item.folderId === "string" ? item.folderId : null,
        w: Number(item.w) || 0,
        h: Number(item.h) || 0,
        addedAt: Number(item.addedAt) || 0,
      });
      if (assets.length >= LIMITS.assets) break;
    }
  }
  const customItems: SyncCustomItem[] = [];
  if (Array.isArray(raw.customItems)) {
    for (const row of raw.customItems) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const svg = typeof item.svg === "string" ? item.svg : "";
      if (!id || !svg.includes("<svg") || svg.length > LIMITS.svg) continue;
      customItems.push({
        id,
        name: cleanName(item.name, "رمز"),
        kind: item.kind === "divider" ? "divider" : "icon",
        svg,
        createdAt: Number(item.createdAt) || 0,
      });
      if (customItems.length >= LIMITS.custom) break;
    }
  }
  return repairParents({
    folders,
    assets,
    customItems,
    removedAssets: tombstones(raw.removedAssets),
    removedFolders: tombstones(raw.removedFolders),
    updatedAt: Number(raw.updatedAt) || 0,
  });
}

function newestTombstone(rows: SyncTombstone[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const prev = map.get(row.id) ?? 0;
    if (row.at >= prev) map.set(row.id, row.at);
  }
  return map;
}

/**
 * Lift a parent that does not exist, and break cycles by moving the looping
 * folder to the root. Children of a missing folder are not deleted.
 */
export function repairParents(catalog: LibraryCatalog): LibraryCatalog {
  const folders = catalog.folders.map((folder) => ({ ...folder }));
  const ids = new Set(folders.map((folder) => folder.id));
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folder of folders) {
    if (!folder.parentId || !ids.has(folder.parentId) || folder.parentId === folder.id) {
      folder.parentId = null;
    }
  }
  for (const folder of folders) {
    const seen = new Set<string>([folder.id]);
    let cursor = folder.parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        folder.parentId = null;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  const liveFolders = new Set(folders.map((folder) => folder.id));
  return {
    ...catalog,
    folders,
    assets: catalog.assets.map((asset) => ({
      ...asset,
      folderId: asset.folderId && liveFolders.has(asset.folderId) ? asset.folderId : null,
    })),
  };
}

function mergeTombstones(a: SyncTombstone[], b: SyncTombstone[]): SyncTombstone[] {
  const map = newestTombstone([...a, ...b]);
  return [...map.entries()]
    .map(([id, at]) => ({ id, at }))
    .slice(0, LIMITS.tombstones);
}

/**
 * Union two catalogs of one account.
 *
 * An item deleted on either side stays deleted when the tombstone is at least
 * as new as the item. Everything else is kept, so a folder created offline is
 * not wiped by an older cloud snapshot. Same-id metadata prefers the later
 * `addedAt` / `createdAt`.
 */
export function mergeLibraryCatalog(
  local: LibraryCatalog,
  remote: LibraryCatalog,
): LibraryCatalog {
  const removedAssets = mergeTombstones(local.removedAssets, remote.removedAssets);
  const removedFolders = mergeTombstones(local.removedFolders, remote.removedFolders);
  const assetGone = newestTombstone(removedAssets);
  const folderGone = newestTombstone(removedFolders);

  const folders = new Map<string, SyncFolder>();
  for (const folder of [...remote.folders, ...local.folders]) {
    const killed = folderGone.get(folder.id);
    if (killed != null && killed >= (folder.createdAt || 0)) continue;
    const prev = folders.get(folder.id);
    if (!prev || (folder.createdAt || 0) >= (prev.createdAt || 0)) folders.set(folder.id, { ...folder });
  }

  const assets = new Map<string, SyncAssetRef>();
  for (const asset of [...remote.assets, ...local.assets]) {
    const killed = assetGone.get(asset.id) ?? assetGone.get(asset.remoteId || "");
    if (killed != null && killed >= (asset.addedAt || 0)) continue;
    const prev = assets.get(asset.id);
    if (!prev || (asset.addedAt || 0) >= (prev.addedAt || 0)) {
      assets.set(asset.id, {
        ...prev,
        ...asset,
        remoteId: asset.remoteId || prev?.remoteId || null,
      });
    }
  }

  const customItems = new Map<string, SyncCustomItem>();
  for (const item of [...remote.customItems, ...local.customItems]) {
    const prev = customItems.get(item.id);
    if (!prev || item.createdAt >= prev.createdAt) customItems.set(item.id, item);
  }

  return repairParents({
    folders: [...folders.values()],
    assets: [...assets.values()],
    customItems: [...customItems.values()],
    removedAssets,
    removedFolders,
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0, Date.now()),
  });
}

export interface DuplicatePlan {
  folders: SyncFolder[];
  assets: Array<SyncAssetRef & { sourceId: string; sourceRemoteId: string | null }>;
}

/**
 * Independent copies. New ids, remapped folder links, no shared remote id.
 * The original rows are not part of the result.
 */
export function planLibraryDuplicate(input: {
  folders: SyncFolder[];
  assets: SyncAssetRef[];
  assetIds: string[];
  folderIds: string[];
  now?: number;
  mint?: () => string;
}): DuplicatePlan {
  const now = input.now ?? Date.now();
  let n = 0;
  const mint = input.mint ?? (() => `copy-${now.toString(36)}-${(n += 1)}`);
  const byId = new Map(input.folders.map((folder) => [folder.id, folder]));
  const selected = new Set(input.folderIds.filter((id) => byId.has(id)));
  const children = new Map<string, string[]>();
  for (const folder of input.folders) {
    const parent = folder.parentId ?? "";
    const list = children.get(parent) ?? [];
    list.push(folder.id);
    children.set(parent, list);
  }
  const stack = [...selected];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of children.get(id) ?? []) {
      if (selected.has(child)) continue;
      selected.add(child);
      stack.push(child);
    }
  }
  const idMap = new Map<string, string>();
  for (const id of selected) idMap.set(id, mint());
  const folders: SyncFolder[] = [];
  for (const id of selected) {
    const folder = byId.get(id);
    if (!folder) continue;
    const parent = folder.parentId && idMap.has(folder.parentId)
      ? idMap.get(folder.parentId)!
      : folder.parentId ?? null;
    folders.push({
      id: idMap.get(id)!,
      name: `${folder.name} نسخة`.slice(0, LIMITS.name),
      createdAt: now,
      parentId: parent,
    });
  }
  const wantedAssets = new Set(input.assetIds);
  const assets: DuplicatePlan["assets"] = [];
  for (const asset of input.assets) {
    const inFolder = asset.folderId && selected.has(asset.folderId);
    if (!wantedAssets.has(asset.id) && !inFolder) continue;
    const folderId = asset.folderId && idMap.has(asset.folderId)
      ? idMap.get(asset.folderId)!
      : asset.folderId ?? null;
    assets.push({
      id: mint(),
      sourceId: asset.id,
      sourceRemoteId: asset.remoteId ?? null,
      remoteId: null,
      name: `${asset.name} نسخة`.slice(0, LIMITS.name),
      folderId,
      w: asset.w,
      h: asset.h,
      addedAt: now,
    });
  }
  return { folders, assets };
}
