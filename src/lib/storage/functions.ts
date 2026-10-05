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
  storageMaxBase64Length,
  storageMaxBytesForKind,
  type StorageAssetKind,
  type StoredAsset,
} from "./provider";
import { normalizeCatalog, type LibraryCatalog } from "./library-sync";

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
      // Base64 inflates by 4/3; reject an oversized payload for THIS kind
      // before a buffer is allocated for it.
      if (base64.length > storageMaxBase64Length(kind)) {
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
    // The decoded size is the authoritative one: base64 whitespace or padding
    // tricks cannot make a large object look small to this check.
    if (bytes.byteLength > storageMaxBytesForKind(data.kind)) {
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

/**
 * Download one of the caller's own assets as a `data:` URL so the local
 * IndexedDB library can restore cloud-backed assets across devices/sessions
 * without weakening `safeImageSrc` (which only permits `data:` and `/`).
 *
 * Ownership is verified through `findOwnedAsset` by `context.userId`.
 */
export const downloadStoredAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { id: string } => {
    const id =
      typeof (input as Record<string, unknown> | null)?.id === "string"
        ? String((input as Record<string, unknown>).id).trim()
        : "";
    if (!id || id.length > 120) throw new Error("معرّف الأصل غير صالح");
    return { id };
  })
  .handler(
    async ({
      context,
      data,
    }): Promise<
      | { ok: true; dataUrl: string; asset: StoredAsset }
      | { ok: false; reason: StorageFailureReason }
    > => {
      const { getObjectStorage } = await import("./r2.server");
      const storage = getObjectStorage();
      if (!storage) return { ok: false, reason: "not_configured" };

      const sql = await getSql();
      const { findOwnedAsset } = await import("./ownership.server");
      const owned = await findOwnedAsset(sql, context.userId, data.id);
      if (!owned.ok) return { ok: false, reason: "not_found" };

      const rows = await sql<AssetRow>`
        select id, kind, object_key, file_name, content_type, byte_size, width, height, project_id, created_at
        from storage_assets
        where id = ${owned.asset.id} and user_id = ${context.userId}
        limit 1
      `;
      const row = rows[0];
      if (!row) return { ok: false, reason: "not_found" };

      try {
        const bytes = await storage.get(owned.asset.objectKey);
        if (!bytes || !bytes.byteLength) return { ok: false, reason: "not_found" };
        const base64 = Buffer.from(bytes).toString("base64");
        return {
          ok: true,
          dataUrl: `data:${row.content_type};base64,${base64}`,
          asset: toStoredAsset(row),
        };
      } catch {
        return { ok: false, reason: "not_found" };
      }
    },
  );

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

/** The signed-in account's library metadata. Empty when nothing has been synced. */export const getLibraryCatalog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ payload: LibraryCatalog | null; updatedAt: string | null }> => {
    const sql = await getSql();
    const rows = await sql<{ payload: unknown; updated_at: string | Date }>`
      select payload, updated_at from library_catalog
      where user_id = ${context.userId}
      limit 1
    `;
    const row = rows[0];
    if (!row || row.payload == null) return { payload: null, updatedAt: null };
    return {
      payload: normalizeCatalog(row.payload),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  });

/** Replace the caller's catalog. The user id comes from the session, never the body. */
export const saveLibraryCatalog = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { payload: LibraryCatalog } => {
    const payload = (input as { payload?: unknown } | null)?.payload;
    if (!payload || typeof payload !== "object") throw new Error("بيانات المكتبة غير صالحة");
    return { payload: normalizeCatalog(payload) };
  })
  .handler(async ({ context, data }): Promise<{ ok: true } | { ok: false; reason: "rejected" }> => {
    const sql = await getSql();
    const body = JSON.stringify(data.payload);
    await sql`
      insert into library_catalog (user_id, payload, updated_at)
      values (${context.userId}, ${body}::jsonb, now())
      on conflict (user_id) do update
        set payload = excluded.payload,
            updated_at = now()
    `;
    return { ok: true };
  });

/**
 * Copy objects the caller already owns into new objects.
 *
 * The source row is not updated and the new key is minted server-side under
 * the same user, so a copy cannot alias the original or another account.
 */
export const copyStoredAssets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { sourceIds: string[] } => {
    const raw = (input as { sourceIds?: unknown } | null)?.sourceIds;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) {
      throw new Error("دفعة النسخ غير صالحة");
    }
    const sourceIds = raw.map((id) => (typeof id === "string" ? id.trim() : ""));
    if (sourceIds.some((id) => !id || id.length > 120)) throw new Error("معرّف الأصل غير صالح");
    return { sourceIds };
  })
  .handler(async ({ context, data }): Promise<{
    copies: Array<{ sourceId: string; asset: StoredAsset }>;
  }> => {
    const { getObjectStorage } = await import("./r2.server");
    const storage = getObjectStorage();
    if (!storage) return { copies: [] };
    const sql = await getSql();
    const { findOwnedAsset } = await import("./ownership.server");
    const { resolveOwnedProjectSlot } = await import("./ownership.server");
    const ownedSlot = await resolveOwnedProjectSlot(sql, context.userId, null);
    if (!ownedSlot.ok) return { copies: [] };
    const copies: Array<{ sourceId: string; asset: StoredAsset }> = [];
    for (const sourceId of data.sourceIds) {
      const owned = await findOwnedAsset(sql, context.userId, sourceId);
      if (!owned.ok) continue;
      const rows = await sql<AssetRow>`
        select id, kind, object_key, file_name, content_type, byte_size, width, height, project_id, created_at
        from storage_assets
        where id = ${owned.asset.id} and user_id = ${context.userId}
        limit 1
      `;
      const row = rows[0];
      if (!row) continue;
      try {
        const bytes = await storage.get(owned.asset.objectKey);
        if (!bytes?.byteLength) continue;
        const id = uid("obj").replace(/[^A-Za-z0-9_-]/g, "");
        const objectKey = buildStorageObjectKey({
          userId: context.userId,
          projectId: ownedSlot.slot,
          assetId: id,
        });
        await storage.put(objectKey, bytes, row.content_type);
        const inserted = await sql<AssetRow>`
          insert into storage_assets
            (id, user_id, kind, object_key, file_name, content_type, byte_size, width, height, project_id)
          values
            (${id}, ${context.userId}, ${row.kind}, ${objectKey}, ${row.file_name},
             ${row.content_type}, ${bytes.byteLength}, ${row.width}, ${row.height}, ${null})
          returning id, kind, object_key, file_name, content_type, byte_size, width, height, project_id, created_at
        `;
        const created = inserted[0];
        if (created) copies.push({ sourceId, asset: toStoredAsset(created) });
      } catch {
        /* one failed object must not abort the rest of the batch */
      }
    }
    return { copies };
  });

/** Download up to eight of the caller's own objects in one request. */
export const downloadStoredAssets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { ids: string[] } => {
    const raw = (input as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) {
      throw new Error("دفعة التنزيل غير صالحة");
    }
    const ids = raw.map((id) => (typeof id === "string" ? id.trim() : ""));
    if (ids.some((id) => !id || id.length > 120)) throw new Error("معرّف الأصل غير صالح");
    return { ids };
  })
  .handler(async ({ context, data }): Promise<{
    files: Array<{ id: string; dataUrl: string; asset: StoredAsset }>;
  }> => {
    const { getObjectStorage } = await import("./r2.server");
    const storage = getObjectStorage();
    if (!storage) return { files: [] };
    const sql = await getSql();
    const { findOwnedAsset } = await import("./ownership.server");
    const files: Array<{ id: string; dataUrl: string; asset: StoredAsset }> = [];
    for (const id of data.ids) {
      const owned = await findOwnedAsset(sql, context.userId, id);
      if (!owned.ok) continue;
      const rows = await sql<AssetRow>`
        select id, kind, object_key, file_name, content_type, byte_size, width, height, project_id, created_at
        from storage_assets
        where id = ${owned.asset.id} and user_id = ${context.userId}
        limit 1
      `;
      const row = rows[0];
      if (!row) continue;
      try {
        const bytes = await storage.get(owned.asset.objectKey);
        if (!bytes?.byteLength) continue;
        files.push({
          id: row.id,
          dataUrl: `data:${row.content_type};base64,${Buffer.from(bytes).toString("base64")}`,
          asset: toStoredAsset(row),
        });
      } catch {
        /* skip a single missing object */
      }
    }
    return { files };
  });


/**
 * Administrator-only storage verification.
 *
 * Answers the one question the rest of this module cannot answer honestly:
 * "is cloud storage actually working in THIS deployment?" — because a
 * deployment with no R2 variables behaves exactly like a healthy local-first
 * one. The check runs the real provider and the real `storage_assets` flow, in
 * the caller's own namespace, then removes everything it created.
 *
 * Reporting rules: statuses and variable NAMES only. No credential, endpoint,
 * account id or object key is ever returned, and the caller must be an
 * authorized admin (the same gate the owner vault uses) because the check
 * writes — once — to the shared bucket.
 */
export const verifyObjectStorage = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<
    | {
        ok: true;
        configured: boolean;
        report: import("./verify.server").StorageRoundTripReport;
        metadata: { ok: boolean; steps: import("./verify.server").StorageCheckStep[] };
      }
    | { ok: false; reason: StorageFailureReason }
  > => {
    const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
    const { denyForbidden } = await import("@/lib/auth/forbidden.server");
    const authorization = await getAuthorizationContext({
      id: context.userId,
      email: context.userEmail,
    });
    if (!authorization.isAdmin) await denyForbidden();

    const { runStorageRoundTrip, runMetadataRoundTrip } = await import("./verify.server");
    const report = await runStorageRoundTrip();
    if (!report.configured) {
      return { ok: false, reason: "not_configured" };
    }

    // A metadata row is only meaningful next to the object it describes, so
    // this half writes its own object under the ADMIN'S OWN user prefix and
    // removes both again. Nothing outside the caller's namespace is touched.
    const { getObjectStorage } = await import("./r2.server");
    const storage = getObjectStorage();
    const sql = await getSql();
    const assetId = uid("obj").replace(/[^A-Za-z0-9_-]/g, "");
    const objectKey = buildStorageObjectKey({
      userId: context.userId,
      projectId: null,
      assetId,
    });
    const { isKeyOwnedBy } = await import("./provider");
    const payload = new Uint8Array(Buffer.from(`nasaq-metadata-verify-${Date.now()}`, "utf8"));

    let metadata: {
      ok: boolean;
      steps: import("./verify.server").StorageCheckStep[];
    } = { ok: false, steps: [] };
    let objectWritten = false;
    try {
      if (!storage) return { ok: false, reason: "not_configured" };
      if (!isKeyOwnedBy(objectKey, context.userId)) {
        metadata = { ok: false, steps: [{ step: "ownership-prefix", ok: false }] };
      } else {
        await storage.put(objectKey, payload, "text/plain");
        objectWritten = true;
        const result = await runMetadataRoundTrip(
          sql as unknown as import("./verify.server").SqlTag,
          context.userId,
          objectKey,
          payload.byteLength,
        );
        metadata = { ok: result.ok, steps: result.steps };
      }
    } catch {
      metadata = { ok: false, steps: [{ step: "metadata-round-trip", ok: false, detail: "failed" }] };
    } finally {
      if (objectWritten) {
        try {
          await storage?.delete(objectKey);
        } catch {
          /* the object is under a fresh key of the caller's own prefix */
        }
      }
    }

    return { ok: true, configured: true, report, metadata };
  });
