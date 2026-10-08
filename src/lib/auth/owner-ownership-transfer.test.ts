/**
 * The ownership TRANSFER — the half that compatibility fallbacks never did.
 *
 * `owner-migration.test.ts` pins the record move and the report. This suite
 * pins the three things that were still split after it, against the real
 * migrated schema (PGlite) and the real functions:
 *
 *   A. **Authority** — the orphaned `admin_users` row is carried onto the
 *      canonical account and RETIRED, atomically, so exactly one
 *      administrator identity survives and the legacy id is not an admin.
 *   B. **Coverage** — the tables that move are discovered from the live
 *      schema, not from a hand-written list, with audit/identity tables
 *      explicitly preserved.
 *   C. **Storage** — the account's usage is a server figure derived from the
 *      rows that own the objects, and the objects themselves are re-keyed
 *      onto the canonical prefix (copy → verify → re-point → delete), never
 *      deleted before their replacement is proven readable.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import { createTestSql } from "../commercial/test-db.ts";
import { setTestSql } from "../license/test-db-stub.ts";
import { OWNER_BINDING_KEY, type IdentityDirectory } from "./owner-binding.server.ts";
import {
  OWNER_RECONCILIATION_KEY,
  reconcileOwnerForSession,
  resolveOwnershipTargets,
} from "./owner-reconciliation.server.ts";
import {
  RETIRED_ADMIN_ROWS_KEY,
  adminRowsFor,
  migrateAdminAuthority,
  readRetiredAdminRows,
} from "./owner-admin-rebind.server.ts";
import {
  classifyOwnershipColumn,
  discoverMovableOwnership,
  discoverOwnershipColumns,
  PRESERVED_TABLES,
} from "./owner-schema-sweep.server.ts";
import { isAdminCaller } from "./admin-identity.server.ts";
import { isSuperAdminIdentity } from "./super-admin.server.ts";
import {
  ownerStorageSplit,
  ownerStorageUsage,
  rekeyOwnerStorageObjects,
  strandedBucketObjects,
} from "../storage/owner-storage.server.ts";
import { buildStorageObjectKey, type ObjectStorageProvider } from "../storage/provider.ts";

let sql: Sql;
let close: () => Promise<void>;

const LEGACY = "legacy-owner";
const OWNER = "owner-current";
const OWNER_EMAIL = "owner@example.com";
const STRANGER = "stranger-live";

before(async () => {
  ({ sql, close } = await createTestSql());
  setTestSql(sql);
});

afterEach(async () => {
  for (const table of [
    "admin_users",
    "admin_audit_log",
    "licenses",
    "license_claims",
    "subscriptions",
    "payment_requests",
    "account_trials",
    "library_catalog",
    "user_templates",
    "cloud_projects",
    "storage_assets",
    "storage_projects",
    "client_requests",
  ]) {
    await sql.query(`delete from ${table}`);
  }
  await sql`delete from site_settings where key in (${OWNER_BINDING_KEY}, ${OWNER_RECONCILIATION_KEY}, ${RETIRED_ADMIN_ROWS_KEY})`;
  await sql`delete from "user"`;
});

after(async () => {
  setTestSql(undefined);
  await close();
});

const directory = (): IdentityDirectory => {
  const accounts = [
    { id: OWNER, email: OWNER_EMAIL },
    { id: STRANGER, email: "stranger@example.com" },
  ];
  return {
    ready: true,
    lookup: async (id) => accounts.find((a) => a.id === id) ?? null,
    byEmail: async (email) =>
      accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null,
  };
};

async function writeBinding(): Promise<void> {
  await sql`
    insert into "user" (id, name, email, "emailVerified")
    values (${LEGACY}, 'legacy', ${OWNER_EMAIL}, true)
    on conflict (id) do nothing
  `;
  await sql`
    insert into site_settings (key, value, updated_at)
    values (
      ${OWNER_BINDING_KEY},
      ${JSON.stringify({
        userId: OWNER,
        email: OWNER_EMAIL,
        boundAt: new Date().toISOString(),
        source: "legacy_role_transfer",
        previousUserId: LEGACY,
        role: "SUPER_ADMIN",
      })}::jsonb,
      now()
    )
  `;
}

// ── A. Administrator authority ──────────────────────────────────────────────

describe("administrator authority is MOVED, not duplicated", () => {
  it("carries SUPER_ADMIN onto the canonical account and retires the orphan row", async () => {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${LEGACY}, 'test', 'pre-migration', 'SUPER_ADMIN')
    `;

    const result = await migrateAdminAuthority(sql, { userId: OWNER, orphanIds: [LEGACY] });

    assert.equal(result.role, "SUPER_ADMIN");
    assert.equal(result.promoted, true);
    assert.equal(result.retired.length, 1);
    assert.equal(result.retired[0]?.userId, LEGACY);

    const rows = await sql<{ user_id: string; role: string }>`select user_id, role from admin_users`;
    assert.deepEqual(
      rows.map((row) => [row.user_id, row.role]),
      [[OWNER, "SUPER_ADMIN"]],
      "exactly one administrator identity survives",
    );
    assert.equal(await adminRowsFor(sql, [LEGACY]), 0, "the legacy id is NOT an admin");

    // Both production resolvers now answer for the canonical account.
    const identity = { id: OWNER, email: OWNER_EMAIL, emailVerified: false };
    assert.equal(await isAdminCaller(sql, identity), true);
    assert.equal(await isSuperAdminIdentity(sql, identity), true);
    assert.equal(await isAdminCaller(sql, { id: LEGACY, email: OWNER_EMAIL, emailVerified: false }), false);
  });

  it("keeps the retired row as durable evidence (audit history stays readable)", async () => {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${LEGACY}, 'test', 'pre-migration', 'SUPER_ADMIN')
    `;
    await sql`
      insert into admin_audit_log (id, admin_user_id, action, target_type, target_id, detail)
      values ('audit-1', ${LEGACY}, 'license.create', 'license', 'lic-1', '{}'::jsonb)
    `;

    await migrateAdminAuthority(sql, { userId: OWNER, orphanIds: [LEGACY] });

    const retired = await readRetiredAdminRows(sql);
    assert.equal(retired.length, 1);
    assert.equal(retired[0]?.role, "SUPER_ADMIN");
    const history = await sql<{ n: number }>`
      select count(*)::int as n from admin_audit_log where admin_user_id = ${LEGACY}
    `;
    assert.equal(Number(history[0]?.n), 1, "what the legacy identity did is never erased");
  });

  it("never demotes a canonical SUPER_ADMIN to a plain ADMIN orphan's role", async () => {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${OWNER}, 'test', 'canonical', 'SUPER_ADMIN'),
             (${LEGACY}, 'test', 'pre-migration', 'ADMIN')
    `;
    const result = await migrateAdminAuthority(sql, { userId: OWNER, orphanIds: [LEGACY] });
    assert.equal(result.role, "SUPER_ADMIN");
    const rows = await sql<{ role: string }>`select role from admin_users where user_id = ${OWNER}`;
    assert.equal(rows[0]?.role, "SUPER_ADMIN");
  });

  it("is idempotent and touches nothing when there is no orphan row", async () => {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${OWNER}, 'test', 'canonical', 'SUPER_ADMIN')
    `;
    const first = await migrateAdminAuthority(sql, { userId: OWNER, orphanIds: [LEGACY] });
    const second = await migrateAdminAuthority(sql, { userId: OWNER, orphanIds: [LEGACY] });
    assert.equal(first.retired.length, 0);
    assert.equal(second.retired.length, 0);
    const rows = await sql<{ n: number }>`select count(*)::int as n from admin_users`;
    assert.equal(Number(rows[0]?.n), 1);
  });

  it("refuses to retire a row the caller did not prove is their own orphan", async () => {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${STRANGER}, 'test', 'another administrator', 'ADMIN')
    `;
    await migrateAdminAuthority(sql, { userId: OWNER, orphanIds: [LEGACY] });
    assert.equal(await adminRowsFor(sql, [STRANGER]), 1, "a stranger's authority is untouchable");
  });
});

// ── B. Coverage: the schema decides, not a hand-written list ────────────────

describe("ownership coverage comes from the live schema", () => {
  it("classifies audit and identity tables as preserved, everything else as movable", () => {
    // `admin_audit_log` is protected twice over: its column name is not in the
    // ownership set at all, AND the table is explicitly preserved.
    assert.equal(classifyOwnershipColumn("admin_audit_log", "user_id").disposition, "preserve");
    for (const table of Object.keys(PRESERVED_TABLES)) {
      assert.equal(classifyOwnershipColumn(table, "user_id").disposition, "preserve", table);
    }
    assert.equal(classifyOwnershipColumn("admin_users", "created_by").disposition, "ignore");
    assert.equal(classifyOwnershipColumn("licenses", "user_id").disposition, "move");
  });

  it("discovers every ownership column the real migrations define", async () => {
    const discovered = await discoverOwnershipColumns(sql);
    const names = new Set(discovered.map((entry) => `${entry.table}.${entry.column}`));
    for (const expected of [
      "licenses.user_id",
      "subscriptions.user_id",
      "storage_assets.user_id",
      "cloud_projects.user_id",
      "client_requests.user_id",
      "admin_users.user_id",
      "auth_sessions.user_id",
    ]) {
      assert.equal(names.has(expected), true, `${expected} is discovered`);
    }
    const preserved = discovered.filter((entry) => entry.disposition === "preserve");
    assert.equal(
      preserved.some((entry) => entry.table === "admin_users"),
      true,
      "authority is never rewritten by the generic sweep",
    );
    assert.equal(
      preserved.some((entry) => entry.table === "auth_sessions"),
      true,
      "sessions are never rewritten",
    );
  });

  it("marks primary-key ownership columns as keyed, so two accounts cannot collapse", async () => {
    const movable = await discoverMovableOwnership(sql);
    const byName = new Map(movable.map((entry) => [`${entry.table}.${entry.column}`, entry]));
    assert.equal(byName.get("account_trials.user_id")?.keyed, true);
    assert.equal(byName.get("library_catalog.user_id")?.keyed, true);
    assert.equal(byName.get("licenses.user_id")?.keyed, false);
  });

  it("never offers a preserved table as a reconciliation target", async () => {
    const targets = await resolveOwnershipTargets(sql);
    for (const preserved of Object.keys(PRESERVED_TABLES)) {
      assert.equal(
        targets.some((target) => target.table === preserved),
        false,
        `${preserved} must not be a move target`,
      );
    }
    assert.equal(targets.some((target) => target.table === "licenses"), true);
  });
});

// ── C. Storage ──────────────────────────────────────────────────────────────

/** An in-memory bucket with the provider's exact surface. */
function fakeStorage(initial: Record<string, Uint8Array> = {}) {
  const objects = new Map<string, Uint8Array>(Object.entries(initial));
  const provider: ObjectStorageProvider & { objects: Map<string, Uint8Array> } = {
    name: "fake",
    objects,
    put: async (key, body) => {
      objects.set(key, body);
    },
    get: async (key) => objects.get(key) ?? null,
    delete: async (key) => {
      objects.delete(key);
    },
    signedGetUrl: async (key) => `https://example.invalid/${key}`,
    list: async (prefix, limit) =>
      [...objects.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit),
  };
  return provider;
}

async function seedOwnerAsset(userId: string, assetId: string, bytes: number): Promise<string> {
  const key = buildStorageObjectKey({ userId, projectId: "proj-1", assetId });
  await sql`
    insert into storage_assets (id, user_id, kind, object_key, file_name, content_type, byte_size, project_id)
    values (${assetId}, ${userId}, 'image', ${key}, 'logo.png', 'image/png', ${bytes}, 'proj-1')
  `;
  return key;
}

describe("storage usage is a server figure, and the objects actually move", () => {
  it("reports the account's own usage from the rows that own the objects", async () => {
    await seedOwnerAsset(OWNER, "asset-1", 1000);
    await seedOwnerAsset(OWNER, "asset-2", 2500);
    await seedOwnerAsset(STRANGER, "asset-3", 9_000_000);
    await sql`insert into storage_projects (project_id, user_id) values ('proj-1', ${OWNER})`;
    await sql`insert into cloud_projects (id, user_id, payload) values ('cp-1', ${OWNER}, '{}'::jsonb)`;

    const usage = await ownerStorageUsage(sql, OWNER);
    assert.equal(usage.assets, 2);
    assert.equal(usage.bytes, 3500, "a stranger's bytes are never in the owner's figure");
    assert.equal(usage.projects, 1);
    assert.equal(usage.cloudProjects, 1);
    assert.equal(usage.foreignPrefixAssets, 0);
  });

  it("counts rows inherited from a pre-migration prefix as not-yet-re-keyed", async () => {
    const legacyKey = await seedOwnerAsset(LEGACY, "asset-legacy", 4096);
    await sql`update storage_assets set user_id = ${OWNER} where id = 'asset-legacy'`;

    const usage = await ownerStorageUsage(sql, OWNER);
    assert.equal(usage.assets, 1);
    assert.equal(usage.foreignPrefixAssets, 1, "the key still names the old prefix");
    assert.equal(usage.foreignPrefixBytes, 4096);
    assert.ok(legacyKey.includes(LEGACY));
  });

  it("re-keys the owner's objects: copy, verify, re-point, then delete the source", async () => {
    const legacyKey = await seedOwnerAsset(LEGACY, "asset-legacy", 5);
    await sql`update storage_assets set user_id = ${OWNER} where id = 'asset-legacy'`;
    const storage = fakeStorage({ [legacyKey]: new Uint8Array([1, 2, 3, 4, 5]) });

    const outcome = await rekeyOwnerStorageObjects(sql, {
      userId: OWNER,
      orphanIds: [LEGACY],
      storage,
    });

    assert.equal(outcome.moved, 1);
    assert.equal(outcome.failed, 0);
    assert.equal(outcome.complete, true);
    assert.equal(outcome.remaining, 0);

    const destination = buildStorageObjectKey({ userId: OWNER, projectId: "proj-1", assetId: "asset-legacy" });
    assert.equal(storage.objects.has(destination), true, "the bytes are at the canonical prefix");
    assert.equal(storage.objects.has(legacyKey), false, "the source is removed AFTER the copy is verified");
    assert.deepEqual([...(storage.objects.get(destination) ?? [])], [1, 2, 3, 4, 5], "byte-for-byte");

    const rows = await sql<{ object_key: string }>`select object_key from storage_assets where id = 'asset-legacy'`;
    assert.equal(rows[0]?.object_key, destination);
    const usage = await ownerStorageUsage(sql, OWNER);
    assert.equal(usage.foreignPrefixAssets, 0, "nothing is left on the old prefix");
    assert.equal(usage.bytes, 5, "usage is unchanged by the move — no double counting");
  });

  it("keeps the source object when the destination cannot be read back", async () => {
    const legacyKey = await seedOwnerAsset(LEGACY, "asset-legacy", 3);
    await sql`update storage_assets set user_id = ${OWNER} where id = 'asset-legacy'`;
    const storage = fakeStorage({ [legacyKey]: new Uint8Array([7, 7, 7]) });
    // A bucket that accepts the write and loses it: the exact failure that
    // must never cost the owner their file.
    storage.put = async () => {};

    const outcome = await rekeyOwnerStorageObjects(sql, {
      userId: OWNER,
      orphanIds: [LEGACY],
      storage,
    });

    assert.equal(outcome.moved, 0);
    assert.equal(outcome.failed, 1);
    assert.equal(storage.objects.has(legacyKey), true, "the owner's file is still there");
    const rows = await sql<{ object_key: string }>`select object_key from storage_assets where id = 'asset-legacy'`;
    assert.equal(rows[0]?.object_key, legacyKey, "the row still points at the surviving object");
  });

  it("never relocates an object it cannot attribute to a proven orphan", async () => {
    const strangerKey = await seedOwnerAsset(STRANGER, "asset-foreign", 10);
    await sql`update storage_assets set user_id = ${OWNER} where id = 'asset-foreign'`;
    const storage = fakeStorage({ [strangerKey]: new Uint8Array(10) });

    const outcome = await rekeyOwnerStorageObjects(sql, {
      userId: OWNER,
      orphanIds: [LEGACY],
      storage,
    });

    assert.equal(outcome.moved, 0);
    assert.equal(outcome.skipped, 1);
    assert.equal(storage.objects.has(strangerKey), true);
  });

  it("is bounded and resumable: a budget leaves the rest for the next call", async () => {
    const keys: string[] = [];
    for (const assetId of ["a1", "a2", "a3"]) {
      keys.push(await seedOwnerAsset(LEGACY, assetId, 4));
      await sql`update storage_assets set user_id = ${OWNER} where id = ${assetId}`;
    }
    const storage = fakeStorage(Object.fromEntries(keys.map((key) => [key, new Uint8Array(4)])));

    const first = await rekeyOwnerStorageObjects(sql, {
      userId: OWNER,
      orphanIds: [LEGACY],
      storage,
      maxObjects: 2,
    });
    assert.equal(first.moved, 2);
    assert.equal(first.complete, false);
    assert.equal(first.remaining, 1);

    const second = await rekeyOwnerStorageObjects(sql, {
      userId: OWNER,
      orphanIds: [LEGACY],
      storage,
      maxObjects: 2,
    });
    assert.equal(second.moved, 1);
    assert.equal(second.complete, true);
    assert.equal((await ownerStorageUsage(sql, OWNER)).foreignPrefixAssets, 0);
  });

  it("reports bucket objects the database does not know about, and deletes nothing", async () => {
    const legacyKey = await seedOwnerAsset(LEGACY, "asset-known", 4);
    const orphanedBytes = `users/${LEGACY}/projects/_library/assets/lost-1`;
    const storage = fakeStorage({
      [legacyKey]: new Uint8Array(4),
      [orphanedBytes]: new Uint8Array(4),
    });

    const result = await strandedBucketObjects(sql, [LEGACY], { storage });
    assert.equal(result.supported, true);
    assert.equal(result.checked, 2);
    assert.equal(result.stranded, 1);
    assert.equal(storage.objects.has(orphanedBytes), true, "a stranded object is reported, never deleted");
  });
});

// ── The whole transfer, end to end ──────────────────────────────────────────

describe("the complete transfer leaves ONE canonical owner", () => {
  it("moves records, authority and storage ownership in a single reconciliation", async () => {
    await writeBinding();
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${LEGACY}, 'test', 'pre-migration', 'SUPER_ADMIN')
    `;
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, metadata)
      values ('lic-1', 'hash-1', 'NASAQ-', 'PRO', 'ACTIVE', ${LEGACY}, now(), ${JSON.stringify({ source: "keygen", keygenLicenseId: "k-1" })})
    `;
    await sql`
      insert into cloud_projects (id, user_id, payload) values ('cp-1', ${LEGACY}, '{}'::jsonb)
    `;
    await sql`
      insert into user_templates (id, user_id, title, content) values ('tpl-1', ${LEGACY}, 't', '{}')
    `;
    await seedOwnerAsset(LEGACY, "asset-1", 2048);
    await sql`insert into storage_projects (project_id, user_id) values ('proj-1', ${LEGACY})`;

    const result = await reconcileOwnerForSession(sql, { id: OWNER, email: OWNER_EMAIL }, directory());
    assert.ok(result, "the reconciliation ran");

    const split = await ownerStorageSplit(sql, OWNER, [LEGACY]);
    assert.equal(split.canonical.assets, 1);
    assert.equal(split.canonical.bytes, 2048);
    assert.equal(split.canonical.projects, 1);
    assert.equal(split.legacy.assets, 0, "no storage stays with the legacy identity");
    assert.equal(split.legacy.projects, 0);

    assert.equal(await adminRowsFor(sql, [LEGACY]), 0, "the legacy identity is not an admin");
    assert.equal(result?.adminAuthority?.retired, 1);
    assert.equal(result?.adminAuthority?.role, "SUPER_ADMIN");

    const owned = await sql<{ n: number }>`
      select
        (select count(*) from licenses where user_id = ${OWNER})
      + (select count(*) from cloud_projects where user_id = ${OWNER})
      + (select count(*) from user_templates where user_id = ${OWNER}) as n
    `;
    assert.equal(Number(owned[0]?.n), 3, "every record names the canonical account");

    const left = await sql<{ n: number }>`
      select
        (select count(*) from licenses where user_id = ${LEGACY})
      + (select count(*) from cloud_projects where user_id = ${LEGACY})
      + (select count(*) from user_templates where user_id = ${LEGACY})
      + (select count(*) from storage_assets where user_id = ${LEGACY}) as n
    `;
    assert.equal(Number(left[0]?.n), 0, "nothing is left behind — no split ownership");
  });

  it("reconciles authority even when the records already moved", async () => {
    await writeBinding();
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${LEGACY}, 'test', 'pre-migration', 'SUPER_ADMIN'),
             (${OWNER}, 'test', 'bound', 'SUPER_ADMIN')
    `;
    // No owned rows anywhere: the ONLY thing left split is the authority.
    const result = await reconcileOwnerForSession(sql, { id: OWNER, email: OWNER_EMAIL }, directory());
    assert.ok(result, "an authority-only split is still something to reconcile");
    assert.equal(result?.adminAuthority?.retired, 1);
    assert.equal(await adminRowsFor(sql, [LEGACY]), 0);
  });
});

// ── The final assertion the operator reads ─────────────────────────────────

describe("the production report asserts the end state and leaks nothing", () => {
  it("shows the canonical owner holding everything and the legacy identity holding nothing", async () => {
    await writeBinding();
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${LEGACY}, 'test', 'pre-migration', 'SUPER_ADMIN')
    `;
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status, user_id, activated_at)
      values ('lic-1', 'hash-1', 'NASAQ-', 'PRO', 'ACTIVE', ${LEGACY}, now())
    `;
    await sql`insert into cloud_projects (id, user_id, payload) values ('cp-1', ${LEGACY}, '{}'::jsonb)`;
    await sql`insert into user_templates (id, user_id, title, content) values ('tpl-1', ${LEGACY}, 't', '{}')`;
    await seedOwnerAsset(LEGACY, "asset-1", 777);

    await reconcileOwnerForSession(sql, { id: OWNER, email: OWNER_EMAIL }, directory());

    const { runOwnerOpsStage } = await import("../ops/owner-recovery.server.ts");
    const outcome = await runOwnerOpsStage(sql, "report", {
      userId: OWNER,
      identityEmail: OWNER_EMAIL,
      identityEmailVerified: false,
    });
    const result = outcome.result as {
      canonical: Record<string, unknown>;
      legacy: Record<string, unknown>;
    };

    assert.equal(result.canonical.bound, true);
    assert.equal(result.canonical.admin, true);
    assert.equal(result.canonical.superAdmin, true);
    assert.equal(result.canonical.licenses, 1);
    assert.equal(result.canonical.projects, 1);
    assert.equal(result.canonical.templates, 1);
    assert.equal(result.canonical.storageAssets, 1);
    assert.equal(result.canonical.storageBytes, 777);

    assert.equal(result.legacy.authority, false);
    assert.equal(result.legacy.adminRows, 0);
    assert.equal(result.legacy.retiredAdminRows, 1);
    assert.equal(result.legacy.licenses, 0);
    assert.equal(result.legacy.liveSubscriptions, 0);
    assert.equal(result.legacy.projects, 0);
    assert.equal(result.legacy.templates, 0);
    assert.equal(result.legacy.storageAssets, 0);

    // The whole point of the sanitization: this is safe to paste anywhere.
    const serialized = JSON.stringify(outcome);
    for (const secret of [LEGACY, OWNER, OWNER_EMAIL, STRANGER]) {
      assert.equal(serialized.includes(secret), false, `the report must not contain ${secret}`);
    }
  });
});
