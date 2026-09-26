/**
 * Server-side ownership checks for object storage — the isolation core.
 *
 * NASAQ is multi-user on one bucket, so "who may touch this object" can never
 * be answered by the key, by the file name, or by anything the client sent.
 * It is answered here, against the database, on EVERY upload, read and delete:
 *
 *   1. the caller's identity comes from the verified session (`authMiddleware`),
 *      never from the request body;
 *   2. a project id must be owned by that caller (first claim wins, recorded in
 *      `storage_projects`);
 *   3. an asset id must resolve to a row whose `user_id` is that caller;
 *   4. the resolved object key must still sit under the caller's own prefix.
 *
 * Steps 3 and 4 are redundant by design: the SQL filter already prevents
 * cross-tenant reads, and the prefix assertion catches any future row that
 * disagrees with it.
 */
import type { Sql } from "@/lib/db";
import { isKeyOwnedBy, isSafeKeySegment, LIBRARY_PROJECT_SLOT } from "./provider.ts";

export type OwnershipDenial = "invalid_project" | "project_forbidden" | "not_found";

/**
 * Resolve the storage project slot for a caller, claiming it on first use.
 *
 * Returns the slot to use in the key, or a denial reason. A project id already
 * claimed by a different account is refused — it is never silently re-pointed
 * at the caller, which is exactly the IDOR this table exists to stop.
 */
export async function resolveOwnedProjectSlot(
  sql: Sql,
  userId: string,
  projectId: string | null,
): Promise<{ ok: true; slot: string } | { ok: false; reason: OwnershipDenial }> {
  if (!projectId) return { ok: true, slot: LIBRARY_PROJECT_SLOT };
  if (!isSafeKeySegment(projectId) || projectId === LIBRARY_PROJECT_SLOT) {
    return { ok: false, reason: "invalid_project" };
  }

  // Atomic first claim: concurrent uploads from two accounts cannot both win.
  // `do nothing` + a follow-up read means the loser observes the real owner.
  await sql`
    insert into storage_projects (project_id, user_id)
    values (${projectId}, ${userId})
    on conflict (project_id) do nothing
  `;
  const rows = await sql<{ user_id: string }>`
    select user_id from storage_projects where project_id = ${projectId} limit 1
  `;
  const owner = rows[0]?.user_id;
  if (owner !== userId) return { ok: false, reason: "project_forbidden" };
  return { ok: true, slot: projectId };
}

export type OwnedAsset = { id: string; objectKey: string };

/**
 * Load one asset the caller actually owns.
 *
 * The lookup is `id AND user_id` — an attacker who guesses or enumerates
 * another account's asset id gets the same `not_found` as for an id that does
 * not exist, so the response leaks nothing about other tenants' data. The
 * prefix assertion afterwards refuses any row whose key escaped the caller's
 * own namespace.
 */
export async function findOwnedAsset(
  sql: Sql,
  userId: string,
  assetId: string,
): Promise<{ ok: true; asset: OwnedAsset } | { ok: false; reason: OwnershipDenial }> {
  const rows = await sql<{ id: string; object_key: string }>`
    select id, object_key from storage_assets
    where id = ${assetId} and user_id = ${userId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (!isKeyOwnedBy(row.object_key, userId)) return { ok: false, reason: "not_found" };
  return { ok: true, asset: { id: row.id, objectKey: row.object_key } };
}
