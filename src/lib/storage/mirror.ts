/**
 * Best-effort mirror of a newly saved editor asset into object storage.
 *
 * The editor stays local-first: IndexedDB remains the source of truth for the
 * asset library, and this mirror runs AFTER the local save has already
 * succeeded. Every failure — storage not configured, signed out, offline,
 * provider error — is swallowed, so an author never sees a new failure mode
 * that did not exist before R2 was wired in.
 *
 * Client-safe: it only posts bytes to a server function. No credential, no
 * endpoint and no bucket name is referenced here.
 */
import { hasSignedInOwner } from "@/lib/editor/storage-owner";
import { getSetting, setSetting } from "@/lib/editor/storage";
import type { LibraryCatalog } from "./library-sync";
import type { StorageAssetKind, StoredAsset } from "./provider";
import { normalizeCloudStoragePreference, type CloudStoragePreference } from "./cloud-policy";

export async function getCloudStoragePreference(): Promise<CloudStoragePreference> {
  return normalizeCloudStoragePreference(await getSetting("cloudStorageMode"));
}

export async function setCloudStoragePreference(preference: CloudStoragePreference): Promise<void> {
  await setSetting("cloudStorageMode", preference);
}

async function cloudEnabled(): Promise<boolean> {
  return (await getCloudStoragePreference()) === "cloud";
}

/** Split a `data:` URL into its content type and raw base64 payload. */
export function parseDataUrl(
  src: string,
): { contentType: string; base64: string } | null {
  const match = /^data:([a-z0-9.+/-]+)(;[^,]*)?;base64,([\s\S]+)$/i.exec(src.trim());
  if (!match) return null;
  return { contentType: match[1].toLowerCase(), base64: match[3] };
}

function kindFor(contentType: string): StorageAssetKind | null {
  if (contentType === "image/svg+xml") return "svg";
  if (contentType.startsWith("image/")) return "image";
  return null;
}

/**
 * Upload an asset's bytes to object storage, returning the stored remote asset
 * id on success and null whenever the mirror could not (or should not) run.
 */
export async function mirrorAssetToStorage(asset: {
  name: string;
  src: string;
  w: number;
  h: number;
  projectId?: string | null;
}): Promise<string | null> {
  try {
    if (!hasSignedInOwner()) return null;
    if (!(await cloudEnabled())) return null;
    const parsed = parseDataUrl(asset.src);
    if (!parsed) return null;
    const kind = kindFor(parsed.contentType);
    if (!kind) return null;

    const { uploadEditorAsset } = await import("./functions");
    const result = await uploadEditorAsset({
      data: {
        kind,
        fileName: asset.name,
        contentType: parsed.contentType,
        base64: parsed.base64,
        width: asset.w,
        height: asset.h,
        projectId: asset.projectId ?? null,
      },
    });
    return result.ok ? result.asset.id : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the signed-in user's own stored assets from R2 / object storage.
 * Never runs for guest sessions.
 */
export async function pullRemoteAssets(): Promise<StoredAsset[]> {
  try {
    if (!hasSignedInOwner()) return [];
    if (!(await cloudEnabled())) return [];
    const { listStoredAssets } = await import("./functions");
    const list = await listStoredAssets();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Download a signed-in user's stored asset as a `data:` URL so it can be
 * hydrated into the local owner-scoped IndexedDB library.
 */
export async function fetchRemoteAssetDataUrl(
  id: string,
): Promise<{ dataUrl: string; asset: StoredAsset } | null> {
  try {
    if (!hasSignedInOwner() || !id) return null;
    if (!(await cloudEnabled())) return null;
    const { downloadStoredAsset } = await import("./functions");
    const result = await downloadStoredAsset({ data: { id } });
    return result.ok ? { dataUrl: result.dataUrl, asset: result.asset } : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort deletion of a remote R2 asset owned by the signed-in user.
 */
export async function removeRemoteAsset(id: string): Promise<boolean> {
  try {
    if (!hasSignedInOwner() || !id) return false;
    const { deleteStoredAsset } = await import("./functions");
    const result = await deleteStoredAsset({ data: { id } });
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

/** Read the signed-in account's library catalog. `ok: false` means do not overwrite it. */
export async function pullLibraryCatalog(): Promise<
  { ok: true; payload: LibraryCatalog | null } | { ok: false }
> {
  try {
    if (!hasSignedInOwner()) return { ok: false };
    if (!(await cloudEnabled())) return { ok: false };
    const { getLibraryCatalog } = await import("./functions");
    const result = await getLibraryCatalog();
    return { ok: true, payload: result?.payload ?? null };
  } catch {
    return { ok: false };
  }
}

/** Persist the signed-in account's catalog. Failures stay local. */
export async function pushLibraryCatalog(payload: LibraryCatalog): Promise<boolean> {
  try {
    if (!hasSignedInOwner()) return false;
    if (!(await cloudEnabled())) return false;
    const { saveLibraryCatalog } = await import("./functions");
    const result = await saveLibraryCatalog({ data: { payload } });
    return Boolean(result?.ok);
  } catch {
    return false;
  }
}

/**
 * Server-side copies of objects the account already owns.
 * One request covers up to eight sources so a folder copy is not N round-trips.
 */
export async function copyRemoteAssets(
  sourceIds: string[],
): Promise<Array<{ sourceId: string; remoteId: string }>> {
  const unique = [...new Set(sourceIds.filter(Boolean))];
  if (!hasSignedInOwner() || !unique.length) return [];
  if (!(await cloudEnabled())) return [];
  const copied: Array<{ sourceId: string; remoteId: string }> = [];
  try {
    const { copyStoredAssets } = await import("./functions");
    for (let index = 0; index < unique.length; index += 8) {
      const chunk = unique.slice(index, index + 8);
      const result = await copyStoredAssets({ data: { sourceIds: chunk } });
      for (const row of result?.copies ?? []) {
        if (row?.asset?.id) copied.push({ sourceId: row.sourceId, remoteId: row.asset.id });
      }
    }
  } catch {
    return copied;
  }
  return copied;
}

/** Download up to eight objects per request. Partial results are kept. */
export async function fetchRemoteAssetDataUrls(
  ids: string[],
): Promise<Array<{ id: string; dataUrl: string; asset: StoredAsset }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!hasSignedInOwner() || !unique.length) return [];
  if (!(await cloudEnabled())) return [];
  const files: Array<{ id: string; dataUrl: string; asset: StoredAsset }> = [];
  try {
    const { downloadStoredAssets } = await import("./functions");
    for (let index = 0; index < unique.length; index += 8) {
      const chunk = unique.slice(index, index + 8);
      const result = await downloadStoredAssets({ data: { ids: chunk } });
      for (const file of result?.files ?? []) {
        if (file?.id && file.dataUrl) files.push(file);
      }
    }
  } catch {
    return files;
  }
  return files;
}
