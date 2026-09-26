/**
 * Editor asset upload/read/delete — the only door between the browser and
 * object storage.
 *
 * Shape of the flow: the browser sends base64 bytes + metadata, the server
 * validates ownership, kind, content type and size, writes the object to the
 * configured provider (R2), and records ONLY metadata + the object key in the
 * database. Reads hand back a short-lived signed URL, so objects stay private
 * in a bucket that needs no public access, and no credential ever leaves the
 * server.
 *
 * Storage is optional. With the R2 variables unset every call returns
 * `{ ok: false, reason: "not_configured" }` — never an exception and never a
 * change in editor behaviour, which keeps its existing local IndexedDB path.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { uid } from "@/lib/utils";
import {
  buildStorageObjectKey,
  isAllowedStorageContentType,
  isSafeKeySegment,
  sanitizeFileName,
  STORAGE_ASSET_KINDS,
  STORAGE_MAX_OBJECT_BYTES,
  type StorageAssetKind,
  type StoredAsset,
} from "./provider";

export type StorageFailureReason =
  | "not_configured"
  | "rejected"
  | "too_large"
  | "not_found"
  | "forbidden"
  | "upload_failed";

export type UploadAssetResult =
  | { ok: true; asset: StoredAsset }
  | { ok: false; reason: StorageFailureReason };

type AssetRow = {
  id: string;
  kind: string;
  object_key: string;
  file_name: string;
  content_type: string;
  byte_size: string | number;
  width: number | null;
  height: number | null;
  project_id: string | null;
  created_at: string | Date;
};

function toStoredAsset(row: AssetRow): StoredAsset {
  return {
    id: row.id,
    kind: row.kind as StorageAssetKind,
    objectKey: row.object_key,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    width: row.width,
    height: row.height,
    projectId: row.project_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isKind(value: unknown): value is StorageAssetKind {
  return STORAGE_ASSET_KINDS.includes(value as StorageAssetKind);
}

/** Upload one editor asset (image / SVG / project file) to object storage. */
export const uploadEditorAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (
      input: unknown,
    ): {
      kind: StorageAssetKind;
      fileName: string;
      contentType: string;
      base64: string;
      width: number | null;
      height: number | null;
      projectId: string | null;
    } => {
      const data = input as Record<string, unknown> | null;
      const kind = data?.kind;
      if (!isKind(kind)) throw new Error("نوع الأصل غير مدعوم");

      const contentType =
        typeof data?.contentType === "string" ? data.contentType.trim().toLowerCase() : "";
      if (!isAllowedStorageContentType(kind, contentType)) {
        throw new Error("نوع الملف غير مسموح للرفع");
      }

      const base64 = typeof data?.base64 === "string" ? data.base64.trim() : "";
      if (!base64) throw new Error("محتوى الملف مفقود");
      // Base64 inflates by 4/3; reject obviously oversized payloads before
      // allocating a buffer for them.
      if (base64.length > Math.ceil((STORAGE_MAX_OBJECT_BYTES * 4) / 3) + 1024) {
        throw new Error("حجم الملف يتجاوز الحد المسموح");
      }

      const fileName = sanitizeFileName(
        typeof data?.fileName === "string" ? data.fileName : "asset",
      );
      const dimension = (value: unknown): number | null => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
      };
      // A project id becomes a path segment, so it must be a plain identifier.
      // Anything else (a slash, `..`, an encoded separator) is refused here
      // rather than sanitised into a different — possibly someone else's — id.
      const rawProjectId =
        typeof data?.projectId === "string" ? data.projectId.trim() : "";
      if (rawProjectId && !isSafeKeySegment(rawProjectId)) {
        throw new Error("معرّف المشروع غير صالح");
      }
      const projectId = rawProjectId || null;

      return {
        kind,
        fileName,
        contentType,
        base64,
        width: dimension(data?.width),
        height: dimension(data?.height),
        projectId,
      };
    },
  )
  .handler(async ({ context, data }): Promise<UploadAssetResult> => {
    const { getObjectStorage } = await import("./r2.server");
    const storage = getObjectStorage();
    if (!storage) return { ok: false, reason: "not_configured" };

    const bytes = new Uint8Array(Buffer.from(data.base64, "base64"));
    if (!bytes.byteLength) return { ok: false, reason: "rejected" };
    if (bytes.byteLength > STORAGE_MAX_OBJECT_BYTES) {
      return { ok: false, reason: "too_large" };
    }

    const sql = await getSql();
    // The caller may only write under a project it owns. First use claims the
    // id; a project already owned by another account is refused outright.
    const { resolveOwnedProjectSlot } = await import("./ownership.server");
    const owned = await resolveOwnedProjectSlot(sql, context.userId, data.projectId);
    if (!owned.ok) {
      return { ok: false, reason: owned.reason === "invalid_project" ? "rejected" : "forbidden" };
    }

    // The asset id is minted server-side: a client can neither choose where its
    // object lands nor overwrite an existing one.
    const id = uid("obj").replace(/[^A-Za-z0-9_-]/g, "");
    const objectKey = buildStorageObjectKey({
      userId: context.userId,
      projectId: owned.slot,
      assetId: id,
    });

    try {
      await storage.put(objectKey, bytes, data.contentType);
    } catch {
      // The provider message can name buckets, keys and endpoints. Callers get
      // a stable reason code instead, and nothing is logged.
      return { ok: false, reason: "upload_failed" };
    }

    const rows = await sql<AssetRow>`
      insert into storage_assets
        (id, user_id, kind, object_key, file_name, content_type, byte_size, width, height, project_id)
      values
        (${id}, ${context.userId}, ${data.kind}, ${objectKey}, ${data.fileName},
         ${data.contentType}, ${bytes.byteLength}, ${data.width}, ${data.height}, ${data.projectId})
      returning id, kind, object_key, file_name, content_type, byte_size, width, height, project_id, created_at
    `;
    const row = rows[0];
    if (!row) return { ok: false, reason: "upload_failed" };
    return { ok: true, asset: toStoredAsset(row) };
  });

/** List the caller's own stored assets. Metadata only — no URLs, no bytes. */
export const listStoredAssets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StoredAsset[]> => {
    const { objectStorageConfigured } = await import("./r2.server");
    if (!objectStorageConfigured()) return [];
    const sql = await getSql();
    const rows = await sql<AssetRow>`
      select id, kind, object_key, file_name, content_type, byte_size, width, height, project_id, created_at
      from storage_assets
      where user_id = ${context.userId}
      order by created_at desc
      limit 500
    `;
    return rows.map(toStoredAsset);
  });

/**
 * A short-lived read URL for one of the caller's own assets.
 *
 * Ownership is resolved from the database by id — the client never supplies an
 * object key, so no caller can sign a URL for someone else's object.
 */
export const getStoredAssetUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown> | null)?.id === "string"
      ? String((input as Record<string, unknown>).id).trim()
      : "";
    if (!id || id.length > 120) throw new Error("معرّف الأصل غير صالح");
    return { id };
  })
  .handler(async ({ context, data }): Promise<
    { ok: true; url: string; expiresInSeconds: number } | { ok: false; reason: StorageFailureReason }
  > => {
    const { getObjectStorage } = await import("./r2.server");
    const storage = getObjectStorage();
    if (!storage) return { ok: false, reason: "not_configured" };

    const sql = await getSql();
    const { findOwnedAsset } = await import("./ownership.server");
    const owned = await findOwnedAsset(sql, context.userId, data.id);
    // Someone else's id and a non-existent id are indistinguishable in the
    // response: no enumeration signal, no leak that the object exists.
    if (!owned.ok) return { ok: false, reason: "not_found" };

    // Short-lived, single-object, read-only. The URL grants no listing and no
    // write, and it expires long before it could be shared usefully.
    const expiresInSeconds = 900;
    return {
      ok: true,
      url: await storage.signedGetUrl(owned.asset.objectKey, expiresInSeconds),
      expiresInSeconds,
    };
  });

/** Delete one of the caller's own assets: object first, then the metadata row. */
export const deleteStoredAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id = typeof (input as Record<string, unknown> | null)?.id === "string"
      ? String((input as Record<string, unknown>).id).trim()
      : "";
    if (!id || id.length > 120) throw new Error("معرّف الأصل غير صالح");
    return { id };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const { getObjectStorage } = await import("./r2.server");
    const storage = getObjectStorage();
    if (!storage) return { ok: false };

    const sql = await getSql();
    const { findOwnedAsset } = await import("./ownership.server");
    const owned = await findOwnedAsset(sql, context.userId, data.id);
    if (!owned.ok) return { ok: false };

    try {
      await storage.delete(owned.asset.objectKey);
    } catch {
      // Leave the row in place: a metadata row without its object is a leak of
      // storage, but deleting it would orphan the object permanently.
      return { ok: false };
    }
    await sql`delete from storage_assets where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true };
  });
