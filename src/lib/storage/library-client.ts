/**
 * Client side of the account library.
 *
 * IndexedDB stays the working copy so the editor opens without waiting on the
 * network. When a session exists, this reconciles that copy with the account
 * catalog and object storage, then pushes the union back. Guests never call it.
 */
import type { Asset, AssetFolder } from "@/lib/editor/storage";
import { saveAsset } from "@/lib/editor/storage";
import {
  EMPTY_CATALOG,
  mergeLibraryCatalog,
  normalizeCatalog,
  repairParents,
  type LibraryCatalog,
  type SyncCustomItem,
  type SyncTombstone,
} from "./library-sync";

export interface LocalLibrary {
  folders: AssetFolder[];
  assets: Asset[];
  customItems: SyncCustomItem[];
  removedAssets: SyncTombstone[];
  removedFolders: SyncTombstone[];
}

export function toCatalog(local: LocalLibrary): LibraryCatalog {
  return repairParents({
    folders: local.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      createdAt: folder.createdAt,
      parentId: folder.parentId ?? null,
    })),
    assets: local.assets.map((asset) => ({
      id: asset.id,
      remoteId: asset.remoteId ?? null,
      name: asset.name,
      folderId: asset.folderId ?? null,
      w: asset.w,
      h: asset.h,
      addedAt: asset.addedAt,
    })),
    customItems: local.customItems,
    removedAssets: local.removedAssets,
    removedFolders: local.removedFolders,
    updatedAt: Date.now(),
  });
}

/**
 * Pull the account catalog, union it with the device, and fill in any files
 * this device does not have yet. Returns null when the account cannot be read,
 * so a network failure never replaces the local shelf.
 */
export async function reconcileAccountLibrary(local: LocalLibrary): Promise<LocalLibrary | null> {
  const { pullLibraryCatalog, pullRemoteAssets, fetchRemoteAssetDataUrls, pushLibraryCatalog } =
    await import("./mirror");
  const remote = await pullLibraryCatalog();
  if (!remote.ok) return null;

  let merged = mergeLibraryCatalog(
    toCatalog(local),
    remote.payload ? normalizeCatalog(remote.payload) : EMPTY_CATALOG,
  );

  const stored = await pullRemoteAssets();
  if (stored.length) {
    const known = new Set(
      merged.assets.flatMap((asset) => [asset.id, asset.remoteId].filter((id): id is string => Boolean(id))),
    );
    const removed = new Set(merged.removedAssets.map((row) => row.id));
    for (const row of stored) {
      if (known.has(row.id) || removed.has(row.id)) continue;
      merged.assets.push({
        id: row.id,
        remoteId: row.id,
        name: row.fileName || "ملف",
        folderId: null,
        w: row.width || 0,
        h: row.height || 0,
        addedAt: Date.parse(row.createdAt) || Date.now(),
      });
    }
    merged = repairParents(merged);
  }

  const localIds = new Set(
    local.assets.flatMap((asset) => [asset.id, asset.remoteId].filter((id): id is string => Boolean(id))),
  );
  const missing = merged.assets
    .map((asset) => asset.remoteId || asset.id)
    .filter((id) => id && !localIds.has(id));
  const downloaded = missing.length ? await fetchRemoteAssetDataUrls(missing) : [];
  const byRemote = new Map(downloaded.map((file) => [file.id, file]));

  const removedAssets = new Set(merged.removedAssets.map((row) => row.id));
  const nextAssets: Asset[] = [];
  for (const asset of local.assets) {
    if (removedAssets.has(asset.id) || (asset.remoteId && removedAssets.has(asset.remoteId))) continue;
    const meta = merged.assets.find(
      (row) => row.id === asset.id || (asset.remoteId && row.remoteId === asset.remoteId),
    );
    const folderId = meta?.folderId ?? asset.folderId ?? null;
    const remoteId = asset.remoteId || meta?.remoteId || undefined;
    if ((asset.folderId ?? null) !== folderId || asset.remoteId !== remoteId) {
      const updated = { ...asset, folderId, remoteId };
      await saveAsset(updated);
      nextAssets.push(updated);
    } else {
      nextAssets.push(asset);
    }
  }
  for (const file of byRemote.values()) {
    if (nextAssets.some((asset) => asset.id === file.id || asset.remoteId === file.id)) continue;
    const meta = merged.assets.find((row) => row.remoteId === file.id || row.id === file.id);
    const created: Asset = {
      id: file.id,
      remoteId: file.id,
      name: meta?.name || file.asset.fileName || "ملف",
      src: file.dataUrl,
      w: meta?.w || file.asset.width || 600,
      h: meta?.h || file.asset.height || 600,
      addedAt: meta?.addedAt || Date.parse(file.asset.createdAt) || Date.now(),
      folderId: meta?.folderId ?? null,
    };
    await saveAsset(created);
    nextAssets.push(created);
  }

  const removedFolders = new Set(merged.removedFolders.map((row) => row.id));
  const folders = merged.folders.filter((folder) => !removedFolders.has(folder.id));
  await pushLibraryCatalog({
    ...merged,
    folders,
    assets: nextAssets.map((asset) => ({
      id: asset.id,
      remoteId: asset.remoteId ?? null,
      name: asset.name,
      folderId: asset.folderId ?? null,
      w: asset.w,
      h: asset.h,
      addedAt: asset.addedAt,
    })),
  });

  return {
    folders,
    assets: nextAssets,
    customItems: merged.customItems,
    removedAssets: merged.removedAssets,
    removedFolders: merged.removedFolders,
  };
}
