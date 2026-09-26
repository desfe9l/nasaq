/**
 * Object-storage boundary — provider-agnostic types shared by client and server.
 *
 * NASAQ stores editor assets (images, SVG, uploaded project files) as objects in
 * a bucket while the database keeps only metadata plus the object key. Swapping
 * Cloudflare R2 for any other S3-compatible provider must therefore be an
 * environment change, not a code change: everything above this file speaks in
 * `StorageObjectKey` + `StoredAsset`, never in provider URLs or SDK types.
 *
 * Nothing here reads credentials — this module is safe to import from browser
 * code. The signing implementation lives in `s3.server.ts`.
 */

/** Asset kinds the editor may persist remotely. */
export const STORAGE_ASSET_KINDS = ["image", "svg", "project-file"] as const;
export type StorageAssetKind = (typeof STORAGE_ASSET_KINDS)[number];

/**
 * Content types accepted by the upload path.
 *
 * Deliberately narrow: an object store reachable by a signed URL must never
 * serve attacker-supplied HTML from the app's own domain, so only bitmap
 * images, SVG and the editor's own document payloads are allowed.
 */
export const STORAGE_ALLOWED_CONTENT_TYPES: Record<StorageAssetKind, readonly string[]> = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"],
  svg: ["image/svg+xml"],
  "project-file": ["application/json", "application/pdf", "application/zip"],
};

/** Hard ceiling per object (bytes). Mirrors the editor's own import guard. */
export const STORAGE_MAX_OBJECT_BYTES = 10 * 1024 * 1024;

export function isAllowedStorageContentType(
  kind: StorageAssetKind,
  contentType: string,
): boolean {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return STORAGE_ALLOWED_CONTENT_TYPES[kind]?.includes(normalized) ?? false;
}

/** Metadata row as the browser is allowed to see it. Never includes credentials. */
export interface StoredAsset {
  id: string;
  kind: StorageAssetKind;
  /** Object key inside the bucket — a path, not a URL. */
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  projectId: string | null;
  createdAt: string;
}

/**
 * Strip a caller-supplied file name down to something safe to DISPLAY and to
 * embed as the tail of a key: no traversal, no separators, no control
 * characters, bounded length. A file name is never an identity — it is not
 * part of the uniqueness or the isolation guarantee.
 */
export function sanitizeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").trim();
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120);
  return cleaned || "asset";
}

/** Project slot for assets that belong to the library rather than one project. */
export const LIBRARY_PROJECT_SLOT = "_library";

/** Ids allowed inside a key path: no dots, no slashes, no empty segments. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,120}$/;

export function isSafeKeySegment(value: string): boolean {
  return SAFE_SEGMENT.test(value);
}

export class UnsafeKeySegmentError extends Error {
  constructor(segment: string) {
    super(`unsafe object key segment: ${segment}`);
    this.name = "UnsafeKeySegmentError";
  }
}

/**
 * Canonical key layout — the isolation contract:
 *
 *   users/<userId>/projects/<projectId>/assets/<assetId>
 *
 * Every segment is a server-known identifier (session user id, owned project
 * id, server-minted asset id) validated against `SAFE_SEGMENT`, so a caller
 * cannot smuggle `..`, `/` or an encoded separator into a path and reach
 * another user's prefix. The display file name is NOT part of the key: two
 * users uploading `logo.png` can never converge on one object, and knowing a
 * name reveals nothing about a path.
 *
 * The path is a layout, not a secret — objects stay private in the bucket and
 * authorization is always re-checked server-side against the database.
 */
/**
 * Stable, path-safe segment for an identity that is not already safe.
 *
 * Better Auth ids are alphanumeric, but an external identity provider could
 * hand over an id containing `@`, `:` or `/`. Rejecting those users outright
 * would be a functional regression, so the id is sanitised and suffixed with a
 * deterministic FNV-1a digest of the ORIGINAL value: two different ids can
 * never collapse onto the same prefix, which is what isolation depends on.
 */
export function storageIdentitySegment(rawId: string): string {
  const id = rawId.trim();
  if (isSafeKeySegment(id)) return id;
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const digest = hash.toString(16).padStart(8, "0");
  const base = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return `${base || "u"}-${digest}`;
}

export function buildStorageObjectKey(input: {
  userId: string;
  projectId?: string | null;
  assetId: string;
}): string {
  const user = storageIdentitySegment(input.userId);
  const projectId = input.projectId?.trim() || LIBRARY_PROJECT_SLOT;
  for (const segment of [user, projectId, input.assetId]) {
    if (!isSafeKeySegment(segment)) throw new UnsafeKeySegmentError(segment);
  }
  return `users/${user}/projects/${projectId}/assets/${input.assetId}`;
}

/** The prefix owning every object of one user. Used for defence-in-depth checks. */
export function userKeyPrefix(userId: string): string {
  const user = storageIdentitySegment(userId);
  if (!isSafeKeySegment(user)) throw new UnsafeKeySegmentError(userId);
  return `users/${user}/`;
}

/**
 * Last line of defence before an object key is signed, read or deleted: the
 * key must literally live under the caller's own prefix. A row that somehow
 * carried another user's key (bad backfill, future bug) is refused here even
 * though the SQL filter already scoped by `user_id`.
 */
export function isKeyOwnedBy(objectKey: string, userId: string): boolean {
  if (!userId.trim()) return false;
  if (objectKey.includes("..") || objectKey.includes("//")) return false;
  return objectKey.startsWith(userKeyPrefix(userId));
}

/**
 * The contract any storage provider must satisfy. R2 is today's implementation;
 * an S3/B2/MinIO swap only has to provide these four operations.
 */
export interface ObjectStorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Time-limited read URL, so objects stay private in the bucket. */
  signedGetUrl(key: string, expiresInSeconds: number): Promise<string>;
}
