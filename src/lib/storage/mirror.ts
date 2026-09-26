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
import type { StorageAssetKind } from "./provider";

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
 * Upload an asset's bytes to object storage, returning the stored object key
 * on success and null whenever the mirror could not (or should not) run.
 */
export async function mirrorAssetToStorage(asset: {
  name: string;
  src: string;
  w: number;
  h: number;
  projectId?: string | null;
}): Promise<string | null> {
  try {
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
    return result.ok ? result.asset.objectKey : null;
  } catch {
    return null;
  }
}
