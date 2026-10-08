/**
 * Owner storage ownership — the authoritative usage figure and the re-key.
 *
 * ## Why this module exists
 *
 * Two things were missing after the identity migration, and both of them show
 * up to the owner as "my storage is wrong".
 *
 * 1. **There was no server-side usage figure at all.** Both storage meters in
 *    the product read `navigator.storage.estimate()` — the BROWSER's quota for
 *    the origin (IndexedDB + caches on that one device). That number has
 *    nothing to do with the account: it does not change when the owner's rows
 *    move, it is not shared between devices, and when the local database has
 *    filled up with cached projects it reads "full" no matter what the
 *    account actually holds. Reconciling the database could never move it,
 *    which is exactly why patching the display would have been a lie.
 *    `ownerStorageUsage` is the account's real figure, read from the rows that
 *    own the objects.
 *
 * 2. **The objects kept the old prefix.** `storage_assets.user_id` moves to
 *    the canonical owner, but the object key still reads
 *    `users/<orphan>/projects/…`. The isolation rule (`isKeyOwnedBy`) then
 *    disagrees with the row, and the gap is bridged by an acceptance list of
 *    "prefixes this caller is allowed to reach" — a permanent fallback, and
 *    the thing the owner explicitly did not want. `rekeyOwnerStorageObjects`
 *    makes the authoritative state true instead: the bytes are copied to the
 *    canonical prefix, verified, the row is re-pointed, and only then is the
 *    old object removed.
 *
 * ## Safety rules of the re-key
 *
 *   · copy → VERIFY (byte length at the destination) → update the row →
 *     delete the source. A failure at any step leaves the previous state
 *     intact and the row untouched; nothing is deleted before its replacement
 *     is proven readable.
 *   · it only ever touches rows ALREADY owned by the canonical account, whose
 *     key sits under a PROVEN orphan prefix of that same account. A stranger's
 *     object cannot be named by this path, and a key that matches no proven
 *     prefix is skipped, not guessed at.
 *   · it is bounded (objects and bytes per call) and resumable: progress is
 *     the state of the rows themselves, so calling it again continues where it
 *     stopped. A serverless timeout costs a retry, never an inconsistency.
 *   · the acceptance fallback stays in place. It is what keeps the owner's
 *     library readable WHILE the re-key runs, and the backstop for an object
 *     whose bytes cannot be copied (too large for the runtime) — the row is
 *     still authoritative in both cases.
 */
import type { Sql } from "@/lib/db";
import {
  buildStorageObjectKey,
  isKeyOwnedBy,
  userKeyPrefix,
  type ObjectStorageProvider,
} from "./provider.ts";

/** The account's authoritative storage figure. */
export type OwnerStorageUsage = {
  /** Objects the account owns, per `storage_assets`. */
  assets: number;
  /** Sum of the stored byte sizes. The account's real usage. */
  bytes: number;
  /** Project slots claimed in `storage_projects`. */
  projects: number;
  /** Cloud documents in `cloud_projects`. */
  cloudProjects: number;
  /**
   * Rows whose object key does NOT sit under this account's own prefix —
   * assets inherited from a pre-migration identity that have not been re-keyed
   * yet. Target: 0.
   */
  foreignPrefixAssets: number;
  /** Bytes held by those rows. */
  foreignPrefixBytes: number;
};

const EMPTY_USAGE: OwnerStorageUsage = {
  assets: 0,
  bytes: 0,
  projects: 0,
  cloudProjects: 0,
  foreignPrefixAssets: 0,
  foreignPrefixBytes: 0,
};

async function scalar(sql: Sql, text: string, params: unknown[]): Promise<number> {
  try {
    const rows = await sql.query<{ n: number | string | null }>(text, params);
    return Number(rows[0]?.n ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * The account's storage usage, from the rows that are the source of truth.
 *
 * Deliberately NOT a bucket listing: the database rows are what the product
 * reads, writes, bills and isolates against, so a figure derived from them is
 * the one that can be reconciled. A bucket-side sweep is a separate audit
 * (`strandedBucketObjects`) and is reported as a discrepancy, never silently
 * folded into the number the owner sees.
 */
export async function ownerStorageUsage(sql: Sql, userId: string): Promise<OwnerStorageUsage> {
  const id = String(userId ?? "").trim();
  if (!id) return { ...EMPTY_USAGE };

  let prefix = "";
  try {
    prefix = userKeyPrefix(id);
  } catch {
    prefix = "";
  }

  const [assets, bytes, projects, cloudProjects] = await Promise.all([
    scalar(sql, `select count(*)::int as n from storage_assets where user_id = $1`, [id]),
    scalar(
      sql,
      `select coalesce(sum(byte_size), 0)::bigint as n from storage_assets where user_id = $1`,
      [id],
    ),
    scalar(sql, `select count(*)::int as n from storage_projects where user_id = $1`, [id]),
    scalar(sql, `select count(*)::int as n from cloud_projects where user_id = $1`, [id]),
  ]);

  const foreignPrefixAssets = prefix
    ? await scalar(
        sql,
        `select count(*)::int as n from storage_assets
          where user_id = $1 and object_key not like $2`,
        [id, `${prefix}%`],
      )
    : 0;
  const foreignPrefixBytes = prefix
    ? await scalar(
        sql,
        `select coalesce(sum(byte_size), 0)::bigint as n from storage_assets
          where user_id = $1 and object_key not like $2`,
        [id, `${prefix}%`],
      )
    : 0;

  return { assets, bytes, projects, cloudProjects, foreignPrefixAssets, foreignPrefixBytes };
}

export type StorageOwnershipSplit = {
  canonical: OwnerStorageUsage;
  /** Usage still sitting on the proven pre-migration identities. Target: 0. */
  legacy: OwnerStorageUsage;
};

/** Canonical vs legacy usage, the pair the final assertion reports. */
export async function ownerStorageSplit(
  sql: Sql,
  userId: string,
  orphanIds: readonly string[],
): Promise<StorageOwnershipSplit> {
  const canonical = await ownerStorageUsage(sql, userId);
  const legacy = { ...EMPTY_USAGE };
  for (const orphan of orphanIds) {
    const usage = await ownerStorageUsage(sql, orphan);
    legacy.assets += usage.assets;
    legacy.bytes += usage.bytes;
    legacy.projects += usage.projects;
    legacy.cloudProjects += usage.cloudProjects;
  }
  return { canonical, legacy };
}

export type RekeyOutcome = {
  /** Rows inspected in this call. */
  examined: number;
  /** Objects successfully re-keyed onto the canonical prefix. */
  moved: number;
  /** Bytes moved in this call. */
  bytes: number;
  /** Rows left for a later call (budget exhausted). */
  remaining: number;
  /** Rows whose key matched no proven prefix, or whose bytes were missing. */
  skipped: number;
  /** Rows a step failed on. The row and the source object are both intact. */
  failed: number;
  /** True when no row with a foreign prefix is left. */
  complete: boolean;
  /** Reason the stage could not run at all, if any. */
  reason?: "storage_unconfigured" | "no_orphans";
};

const DEFAULT_OBJECT_BUDGET = 100;
const DEFAULT_BYTE_BUDGET = 96 * 1024 * 1024;

type AssetRow = {
  id: string;
  object_key: string;
  project_id: string | null;
  byte_size: number | string | null;
};

/**
 * Move the owner's objects onto the canonical prefix, bounded and resumable.
 *
 * `orphanIds` must already be PROVEN orphans of this owner (the caller
 * resolves them from the durable binding against a ready identity store). A
 * row whose key is not under one of those prefixes is skipped — this path
 * never relocates an object it cannot attribute.
 */
export async function rekeyOwnerStorageObjects(
  sql: Sql,
  input: {
    userId: string;
    orphanIds: readonly string[];
    storage?: ObjectStorageProvider | null;
    maxObjects?: number;
    maxBytes?: number;
  },
): Promise<RekeyOutcome> {
  const userId = String(input.userId ?? "").trim();
  const orphans = [...new Set(input.orphanIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
    .filter((id) => id !== userId);
  const outcome: RekeyOutcome = {
    examined: 0,
    moved: 0,
    bytes: 0,
    remaining: 0,
    skipped: 0,
    failed: 0,
    complete: true,
  };
  if (!userId || !orphans.length) {
    outcome.reason = "no_orphans";
    return outcome;
  }

  let storage = input.storage;
  if (storage === undefined) {
    const { getObjectStorage } = await import("./r2.server.ts");
    storage = getObjectStorage();
  }
  if (!storage) {
    outcome.complete = false;
    outcome.reason = "storage_unconfigured";
    return outcome;
  }

  let prefix: string;
  try {
    prefix = userKeyPrefix(userId);
  } catch {
    outcome.complete = false;
    return outcome;
  }

  const maxObjects = Math.max(1, input.maxObjects ?? DEFAULT_OBJECT_BUDGET);
  const maxBytes = Math.max(1, input.maxBytes ?? DEFAULT_BYTE_BUDGET);

  const rows = await sql.query<AssetRow>(
    `select id, object_key, project_id, byte_size
       from storage_assets
      where user_id = $1 and object_key not like $2
      order by byte_size asc nulls first
      limit $3`,
    [userId, `${prefix}%`, maxObjects + 1],
  );
  outcome.remaining = Math.max(0, rows.length - maxObjects);
  const batch = rows.slice(0, maxObjects);

  for (const row of batch) {
    if (outcome.bytes >= maxBytes) {
      outcome.remaining += 1;
      outcome.complete = false;
      continue;
    }
    outcome.examined += 1;

    // Attribution: the key must sit under a prefix this owner has PROVEN.
    if (!orphans.some((orphan) => isKeyOwnedBy(row.object_key, orphan))) {
      outcome.skipped += 1;
      continue;
    }

    let destination: string;
    try {
      destination = buildStorageObjectKey({
        userId,
        projectId: row.project_id,
        assetId: row.id,
      });
    } catch {
      outcome.skipped += 1;
      continue;
    }
    if (destination === row.object_key) {
      outcome.skipped += 1;
      continue;
    }

    try {
      const bytes = await storage.get(row.object_key);
      if (!bytes) {
        /*
         * The row claims an object the bucket does not have. Re-pointing it
         * would be inventing data; deleting it would be destroying the owner's
         * metadata. It is reported and left exactly as it is.
         */
        outcome.skipped += 1;
        continue;
      }
      await storage.put(destination, bytes, "application/octet-stream");

      // VERIFY before anything becomes irreversible.
      const written = await storage.get(destination);
      if (!written || written.byteLength !== bytes.byteLength) {
        outcome.failed += 1;
        continue;
      }

      const updated = await sql.query<{ id: string }>(
        `update storage_assets
            set object_key = $3
          where id = $1 and user_id = $2 and object_key = $4
          returning id`,
        [row.id, userId, destination, row.object_key],
      );
      if (!updated.length) {
        // Someone else moved the row first; the copy is harmless and the
        // source stays where it is.
        outcome.skipped += 1;
        continue;
      }

      // Last: remove the source. A failure here costs a stray object, never
      // the owner's data — the row already points at the verified copy.
      try {
        await storage.delete(row.object_key);
      } catch {
        /* reported as moved: the authoritative mapping is already correct */
      }

      outcome.moved += 1;
      outcome.bytes += bytes.byteLength;
    } catch {
      outcome.failed += 1;
    }
  }

  const left = await scalar(
    sql,
    `select count(*)::int as n from storage_assets
      where user_id = $1 and object_key not like $2`,
    [userId, `${prefix}%`],
  );
  outcome.remaining = left;
  outcome.complete = left === 0;
  return outcome;
}

/**
 * Objects sitting under a legacy prefix in the BUCKET with no row pointing at
 * them — the bytes a database-only migration would strand.
 *
 * Reported, never deleted: an object with no row is either a leftover of a
 * completed re-key or data whose metadata was lost, and neither is something
 * an automated recovery should resolve by deleting the owner's files.
 */
export async function strandedBucketObjects(
  sql: Sql,
  orphanIds: readonly string[],
  options: { storage?: ObjectStorageProvider | null; limit?: number } = {},
): Promise<{ checked: number; stranded: number; supported: boolean }> {
  let storage = options.storage;
  if (storage === undefined) {
    const { getObjectStorage } = await import("./r2.server.ts");
    storage = getObjectStorage();
  }
  if (!storage?.list) return { checked: 0, stranded: 0, supported: false };
  const limit = Math.max(1, options.limit ?? 1000);

  let checked = 0;
  let stranded = 0;
  for (const orphan of orphanIds) {
    let prefix: string;
    try {
      prefix = userKeyPrefix(orphan);
    } catch {
      continue;
    }
    let keys: string[] = [];
    try {
      keys = await storage.list(prefix, limit);
    } catch {
      continue;
    }
    checked += keys.length;
    if (!keys.length) continue;
    const rows = await sql.query<{ object_key: string }>(
      `select object_key from storage_assets
        where object_key = any(string_to_array($1, E'\\n'))`,
      [keys.join("\n")],
    );
    const known = new Set(rows.map((row) => row.object_key));
    for (const key of keys) if (!known.has(key)) stranded += 1;
  }
  return { checked, stranded, supported: true };
}
