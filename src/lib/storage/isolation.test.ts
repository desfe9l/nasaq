/**
 * Cross-tenant isolation tests for object storage.
 *
 * These drive the real ownership functions against an in-memory stand-in for
 * the two tables, so the guarantees under test are the ones production runs:
 * a project id belongs to its first claimant, and an asset is only ever
 * resolvable by the account that owns its row.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Sql } from "@/lib/db";
import { findOwnedAsset, resolveOwnedProjectSlot } from "./ownership.server.ts";
import { buildStorageObjectKey } from "./provider.ts";

type ProjectRow = { project_id: string; user_id: string };
type AssetRow = { id: string; user_id: string; object_key: string };

/**
 * Minimal Postgres stand-in: enough of the template-tag surface to run the two
 * statements the ownership layer issues, with real `on conflict do nothing`
 * semantics so the first-claim race is exercised rather than assumed.
 */
function fakeSql(seed: { projects?: ProjectRow[]; assets?: AssetRow[] } = {}): Sql {
  const projects = [...(seed.projects ?? [])];
  const assets = [...(seed.assets ?? [])];

  const run = async (strings: TemplateStringsArray, values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").toLowerCase();
    if (text.includes("insert into storage_projects")) {
      const [projectId, userId] = values as [string, string];
      if (!projects.some((row) => row.project_id === projectId)) {
        projects.push({ project_id: projectId, user_id: userId });
      }
      return [];
    }
    if (text.includes("from storage_projects")) {
      const [projectId] = values as [string];
      return projects.filter((row) => row.project_id === projectId).map((row) => ({ ...row }));
    }
    if (text.includes("from storage_assets")) {
      const [id, userId] = values as [string, string];
      return assets
        .filter((row) => row.id === id && row.user_id === userId)
        .map((row) => ({ id: row.id, object_key: row.object_key }));
    }
    throw new Error(`unexpected query: ${text}`);
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    run(strings, values)) as unknown as Sql;
  return sql;
}

const keyA = buildStorageObjectKey({ userId: "userA", projectId: "proj1", assetId: "obj1" });

test("the first account to use a project id owns it", async () => {
  const sql = fakeSql();
  const first = await resolveOwnedProjectSlot(sql, "userA", "proj1");
  assert.deepEqual(first, { ok: true, slot: "proj1" });
  // The same owner keeps writing to it.
  assert.deepEqual(await resolveOwnedProjectSlot(sql, "userA", "proj1"), {
    ok: true,
    slot: "proj1",
  });
});

test("a second account cannot upload into someone else's project id", async () => {
  const sql = fakeSql({ projects: [{ project_id: "proj1", user_id: "userA" }] });
  assert.deepEqual(await resolveOwnedProjectSlot(sql, "userB", "proj1"), {
    ok: false,
    reason: "project_forbidden",
  });
});

test("malformed project ids never reach a key", async () => {
  const sql = fakeSql();
  for (const bad of ["../userA", "a/b", "_library"]) {
    const result = await resolveOwnedProjectSlot(sql, "userB", bad);
    assert.deepEqual(result, { ok: false, reason: "invalid_project" });
  }
});

test("assets resolve only for their owner (IDOR)", async () => {
  const sql = fakeSql({
    assets: [{ id: "obj1", user_id: "userA", object_key: keyA }],
  });
  const owner = await findOwnedAsset(sql, "userA", "obj1");
  assert.equal(owner.ok, true);

  // User B holds a valid, existing asset id — and still gets nothing, with the
  // same answer as for an id that does not exist at all.
  assert.deepEqual(await findOwnedAsset(sql, "userB", "obj1"), {
    ok: false,
    reason: "not_found",
  });
  assert.deepEqual(await findOwnedAsset(sql, "userB", "does-not-exist"), {
    ok: false,
    reason: "not_found",
  });
});

test("a row whose key escaped the caller's prefix is refused", async () => {
  // Defence in depth: even if a row claimed user B's object for user A, the
  // prefix assertion keeps it unreadable and undeletable.
  const sql = fakeSql({
    assets: [
      {
        id: "obj9",
        user_id: "userA",
        object_key: "users/userB/projects/proj1/assets/obj9",
      },
    ],
  });
  assert.deepEqual(await findOwnedAsset(sql, "userA", "obj9"), {
    ok: false,
    reason: "not_found",
  });
});
