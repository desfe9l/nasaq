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
import type { StorageAssetKind, StoredAsset } from "./provider";

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
