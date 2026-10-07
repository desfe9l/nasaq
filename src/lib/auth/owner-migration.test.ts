/**
 * Owner migration — the FULL record graph and its verification.
 *
 * `owner-entitlement.test.ts` pins the authority/entitlement half (licences,
 * subscriptions, claims, enforcement). This suite pins the REST of the
 * owner's record graph plus the production-verification module
 * (`owner-migration-verify.server.ts`), against the real migrated schema
 * (PGlite), through the real functions:
 *
 *   A. binding written → the canonical id is the ONLY authority
 *   B. licence on the old id            → owner      (owner-entitlement #1)
 *   C. subscription on the old id       → owner      (owner-entitlement #2)
 *   D. payment/trial/library/template/client-request rows on the old id → owner
 *   E. cloud project + storage rows on the old id → owner, and the moved
 *      storage objects stay READABLE (prefix rebound) while strangers stay out
 *   F. Keygen licence scope follows the owner (verified by the report)
 *   I. owner entitlement after reconciliation is green end-to-end (report ok)
 *   J. a normal customer inherits NOTHING (report flags nothing for them)
 *   K. a live unrelated customer's rows are untouched — and unreported
 *   L. no session / unresolved identity → nothing reconciles, nothing passes
 *
 * …plus the structural-integrity alarms the operator runs in production
 * (STEP 11): duplicate live subscriptions, duplicate licence keys, unknown
 * plans, owner scope mismatch, a rebound marker that dares name a live
 * account, and the absolute rule that a report never leaks a raw user id.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import { createTestSql } from "../commercial/test-db.ts";
import { setTestSql } from "../license/test-db-stub.ts";
import {
  OWNER_BINDING_KEY,
  readOwnerBinding,
  type IdentityDirectory,
} from "./owner-binding.server.ts";
import {
  OWNER_RECONCILIATION_KEY,
  reconcileOwnerForSession,
  readReconciliationMarker,
} from "./owner-reconciliation.server.ts";
import {
  collectOwnerMigrationReport,
  fingerprint,
  type OwnerMigrationReport,
} from "./owner-migration-verify.server.ts";
import { findOwnedAsset } from "../storage/ownership.server.ts";
import { buildStorageObjectKey } from "../storage/provider.ts";

let sql: Sql;
let close: () => Promise<void>;

const LEGACY = "legacy-owner";
const OWNER = "owner-current";
const OWNER_EMAIL = "owner@example.com";
const STRANGER = "stranger-live";
const STRANGER_EMAIL = "stranger@example.com";

before(async () => {
  ({ sql, close } = await createTestSql());
  setTestSql(sql);
});

afterEach(async () => {
  delete process.env.NASAQ_OWNER_BINDING;
  for (const table of [
    "admin_users",
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
  await sql`delete from site_settings where key in (${OWNER_BINDING_KEY}, ${OWNER_RECONCILIATION_KEY})`;
  await sql`delete from "user"`;
});

after(async () => {
  setTestSql(undefined);
  await close();
});

/** The directory the migration ran against: live accounts only. */
const directory = (extra: Array<{ id: string; email: string }> = []): IdentityDirectory => {
  const accounts = [{ id: OWNER, email: OWNER_EMAIL }, { id: STRANGER, email: STRANGER_EMAIL }, ...extra];
  return {
    ready: true,
    lookup: async (id) => accounts.find((a) => a.id === id) ?? null,
    byEmail: async (email) =>
      accounts.find((a) => a.email.toLowerCase() === email.toLowerCase()) ?? null,
  };
};

/** The production post-migration shape, written the way the recovery writes it. */
async function recoveredBinding(): Promise<void> {
  await sql`
    insert into "user" (id, name, email, "emailVerified")
    values (${LEGACY}, 'legacy', ${OWNER_EMAIL}, true)
    on conflict (id) do nothing
  `;
  await sql`
    insert into admin_users (user_id, created_by, note, role)
    values (${LEGACY}, 'test', 'pre-migration row', 'SUPER_ADMIN'),
           (${OWNER}, ${"system:owner-binding:legacy_role_transfer"}, 'test', 'SUPER_ADMIN')
    on conflict (user_id) do nothing
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

/** A raw binding with no admin row — the drift alarm must catch this. */
async function bindingWithoutAdminRow(): Promise<void> {
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

async function reconcile() {
  return reconcileOwnerForSession(sql, { id: OWNER, email: OWNER_EMAIL }, directory());
}

function findCheck(report: OwnerMigrationReport, name: string) {
  const found = report.checks.find((c) => c.name === name);
  assert.ok(found, `check ${name} exists`);
  return found!;
}

// ── Seed helpers (one per table, timestamps/status preserved by the move) ───

const FIXED_PAST = "2025-06-01T10:00:00.000Z";

async function seedFullGraph(userId: string): Promise<void> {
  await sql`
    insert into payment_requests (id, user_id, plan_id, amount, currency, payment_reference, status, created_at)
    values ('pr-1', ${userId}, 'individual-monthly', 25.00, 'SAR', 'ref-1', 'APPROVED', ${FIXED_PAST})
  `;
  await sql`
    insert into account_trials (user_id, started_at, expires_at)
    values (${userId}, ${FIXED_PAST}, ${FIXED_PAST})
    on conflict (user_id) do nothing
  `;
  await sql`
    insert into library_catalog (user_id, payload, updated_at)
    values (${userId}, ${JSON.stringify({ folders: ["work"] })}::jsonb, ${FIXED_PAST})
    on conflict (user_id) do nothing
  `;
  await sql`
    insert into user_templates (id, user_id, title, content, created_at, updated_at)
    values ('tpl-1', ${userId}, 'my template', '{}', ${FIXED_PAST}, ${FIXED_PAST})
  `;
  await sql`
    insert into cloud_projects (id, user_id, payload, created_at, updated_at)
    values ('proj-1', ${userId}, '{}'::jsonb, ${FIXED_PAST}, ${FIXED_PAST})
  `;
  await sql`
    insert into storage_projects (project_id, user_id, created_at)
    values ('proj-1', ${userId}, ${FIXED_PAST})
    on conflict (project_id) do nothing
  `;
  await sql`
    insert into storage_assets (id, user_id, kind, object_key, file_name, content_type, byte_size, project_id, created_at)
    values (
      'asset-1', ${userId}, 'image',
      ${buildStorageObjectKey({ userId, projectId: "proj-1", assetId: "asset-1" })},
      'logo.png', 'image/png', 1234, 'proj-1', ${FIXED_PAST}
    )
  `;
  await sql`
    insert into client_requests (id, kind, status, name, contact, details, user_id, created_at, updated_at)
    values ('req-1', 'design', 'new', 'المالك', 'owner@example.com', 'طلب تصميم', ${userId}, ${FIXED_PAST}, ${FIXED_PAST})
  `;
}

// ── D. the whole commercial graph follows the owner ─────────────────────────

describe("A + D. binding becomes the only authority and the whole graph moves", () => {
  it("A. the binding states the canonical id; reconciliation moves every remaining owned table, preserving rows verbatim", async () => {
    await recoveredBinding();
    await seedFullGraph(LEGACY);
    const binding = await readOwnerBinding(sql);
    assert.equal(binding?.userId, OWNER, "the durable binding names the account the owner signs in with");
    assert.equal(binding?.previousUserId, LEGACY);

    const result = await reconcile();
    assert.ok(result, "reconciliation runs for the bound owner");
    assert.deepEqual(result?.moved, {
      payment_requests: 1,
      account_trials: 1,
      library_catalog: 1,
      user_templates: 1,
      cloud_projects: 1,
      storage_assets: 1,
      storage_projects: 1,
      client_requests: 1,
    });
    assert.equal(result?.movedTotal, 8);

    // Rows are moved, not rewritten: primary keys, timestamps and status survive.
    const payment = await sql<{ id: string; user_id: string; status: string; created_at: Date }>`
      select id, user_id, status, created_at from payment_requests
    `;
    assert.equal(payment[0]?.id, "pr-1");
    assert.equal(payment[0]?.user_id, OWNER);
    assert.equal(payment[0]?.status, "APPROVED");
    assert.equal(new Date(payment[0]!.created_at).toISOString(), FIXED_PAST);

    const request = await sql<{ user_id: string; status: string }>`select user_id, status from client_requests`;
    assert.equal(request[0]?.user_id, OWNER);
    assert.equal(request[0]?.status, "new");

    for (const table of ["user_templates", "cloud_projects"]) {
      const rows = await sql.query<{ user_id: string }>(`select user_id from ${table}`);
      assert.equal(rows[0]?.user_id, OWNER, `${table} moved`);
    }

    // Nothing is left behind on the orphaned id.
    for (const table of [
      "payment_requests", "account_trials", "library_catalog", "user_templates",
      "cloud_projects", "storage_assets", "storage_projects", "client_requests",
    ]) {
      const left = await sql.query<{ n: number }>(
        `select count(*)::int as n from ${table} where user_id = $1`,
        [LEGACY],
      );
      assert.equal(Number(left[0]?.n), 0, `nothing remains on the orphan in ${table}`);
    }

    // The marker records what moved — the operator's receipt.
    const marker = await readReconciliationMarker(sql);
    assert.equal(marker?.userId, OWNER);
    assert.deepEqual(marker?.orphans, [LEGACY]);
    assert.equal(marker?.movedTotal, 8);

    // A fresh session reconciles nothing more: the move is idempotent.
    assert.equal(await reconcile(), null, "a second pass is a stable no-op");
  });

  it("keyed tables never overwrite the destination's own row", async () => {
    await recoveredBinding();
    await sql`
      insert into account_trials (user_id, started_at, expires_at)
      values (${LEGACY}, now(), now() + interval '1 day')
    `;
    await sql`
      insert into account_trials (user_id, started_at, expires_at)
      values (${OWNER}, now() - interval '3 days', now() - interval '1 day')
    `;
    await sql`
      insert into library_catalog (user_id, payload)
      values (${LEGACY}, '{"legacy":true}'::jsonb), (${OWNER}, '{"current":true}'::jsonb)
    `;
    const result = await reconcile();
    // Both keyed rows stay put — two accounts must never collapse into one row.
    assert.equal((result?.moved.account_trials ?? 0) + (result?.moved.library_catalog ?? 0), 0);
    const trials = await sql<{ user_id: string }>`select user_id from account_trials order by user_id`;
    assert.deepEqual(trials.map((r) => r.user_id), [LEGACY, OWNER]);
    const catalogs = await sql<{ payload: Record<string, boolean> }>`select payload from library_catalog order by user_id`;
    assert.equal(catalogs.length, 2);
  });
});

// ── E. storage rows move AND stay readable; strangers stay out ──────────────

describe("E. storage ownership follows the owner without breaking the object relationship", () => {
  async function seedMigratedAsset() {
    await recoveredBinding();
    await seedFullGraph(LEGACY);
    await reconcile();
  }

  it("the moved asset object (still under the orphan's prefix) reads as the rebound owner's", async () => {
    await seedMigratedAsset();
    const owned = await findOwnedAsset(sql, OWNER, "asset-1");
    assert.equal(owned.ok, true, "the migrated asset answers to the canonical owner");
    if (owned.ok) {
      assert.ok(
        owned.asset.objectKey.startsWith(`users/`),
        "the stored object key is preserved verbatim",
      );
      assert.ok(
        owned.asset.objectKey.includes("proj-1/assets/asset-1"),
        "the object relationship survives the move",
      );
    }
  });

  it("a stranger is still refused — the rebound acceptance list comes from the binding only", async () => {
    await seedMigratedAsset();
    assert.deepEqual(await findOwnedAsset(sql, STRANGER, "asset-1"), {
      ok: false,
      reason: "not_found",
    });
    // The owner cannot reach the stranger's own asset through the rebound either.
    await sql`
      insert into storage_projects (project_id, user_id) values ('s-proj', ${STRANGER})
    `;
    await sql`
      insert into storage_assets (id, user_id, kind, object_key, file_name, content_type, byte_size, project_id)
      values (
        'asset-stranger', ${STRANGER}, 'image',
        ${buildStorageObjectKey({ userId: STRANGER, projectId: "s-proj", assetId: "asset-stranger" })},
        's.png', 'image/png', 10, 's-proj'
      )
    `;
    assert.deepEqual(await findOwnedAsset(sql, OWNER, "asset-stranger"), {
      ok: false,
      reason: "not_found",
    });
    // And a row whose key lives under some unrelated prefix is refused even for the owner.
    await sql`
      insert into storage_assets (id, user_id, kind, object_key, file_name, content_type, byte_size)
      values ('asset-alien', ${OWNER}, 'image', 'users/someone-else/projects/p/assets/x', 'x.png', 'image/png', 10)
    `;
    assert.deepEqual(await findOwnedAsset(sql, OWNER, "asset-alien"), {
      ok: false,
      reason: "not_found",
    });
    // The stranger's own asset resolves normally — the primary path is untouched.
    const own = await findOwnedAsset(sql, STRANGER, "asset-stranger");
    assert.equal(own.ok, true);
  });

  it("the storage project slot answers to the canonical owner after the move", async () => {
    await seedMigratedAsset();
    const { resolveOwnedProjectSlot } = await import("../storage/ownership.server.ts");
    assert.deepEqual(await resolveOwnedProjectSlot(sql, OWNER, "proj-1"), { ok: true, slot: "proj-1" });
    assert.deepEqual(await resolveOwnedProjectSlot(sql, STRANGER, "proj-1"), {
      ok: false,
      reason: "project_forbidden",
    });
  });
});

// ── I/K: the verification report a production operator reads ────────────────

describe("I + K. the production verification report certifies the migrated state", () => {
  it("before the move it rings the alarm; after the move it is green; a live customer's rows are neither moved nor flagged", async () => {
    await recoveredBinding();
    await seedFullGraph(LEGACY);
    // A live, unrelated customer with their own healthy records.
    await sql`
      insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
      values ('sub-stranger', ${STRANGER}, 'individual-monthly', 'ACTIVE', now(), now() + interval '20 days')
    `;
    await sql`
      insert into payment_requests (id, user_id, plan_id, amount, currency, payment_reference)
      values ('pr-stranger', ${STRANGER}, 'individual-monthly', 25, 'SAR', 'ref-s')
    `;

    const beforeReport = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(beforeReport.ok, false, "an unmigrated state must not certify");
    const orphanCheck = findCheck(beforeReport, "orphan_rows");
    assert.equal(orphanCheck.ok, false);
    assert.equal(orphanCheck.count, 8, "all eight seeded rows still sit on the orphan");

    const result = await reconcile();
    assert.equal(result?.movedTotal, 8);
    // The live customer's rows are untouched by the owner's reconciliation.
    const strangerPayment = await sql<{ user_id: string }>`
      select user_id from payment_requests where id = 'pr-stranger'
    `;
    assert.equal(strangerPayment[0]?.user_id, STRANGER, "K. a live customer's rows never move");

    const afterReport = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(afterReport.ok, true, JSON.stringify(afterReport.checks, null, 2));
    assert.equal(findCheck(afterReport, "orphan_rows").count, 0);
    assert.equal(afterReport.canonicalRows.payment_requests, 1);
    assert.equal(afterReport.canonicalRows.cloud_projects, 1);
    assert.equal(afterReport.canonicalRows.storage_assets, 1);
    assert.equal(afterReport.canonicalRows.client_requests, 1);
    assert.equal(afterReport.warnings, 0, "a live customer's records raise no warning");
  });

  it("refuses to certify when the owner binding is missing or authority drifted from it", async () => {
    const noBinding = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(noBinding.ok, false);
    assert.equal(findCheck(noBinding, "owner_binding").ok, false);

    await bindingWithoutAdminRow();
    const drifted = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(drifted.ok, false);
    assert.equal(findCheck(drifted, "binding_admin_row").ok, false);
  });

  it("fails closed while the identity store cannot answer", async () => {
    await recoveredBinding();
    await seedFullGraph(LEGACY);
    const unready: IdentityDirectory = { ready: false, lookup: async () => null, byEmail: async () => null };
    const report = await collectOwnerMigrationReport(sql, { directory: unready });
    assert.equal(report.ok, false, "an unreadable store is 'cannot certify', never 'clean'");
    assert.equal(findCheck(report, "identity_store").ok, false);
    // And the reconciliation itself shares that property.
    assert.equal(
      await reconcileOwnerForSession(sql, { id: OWNER, email: OWNER_EMAIL }, unready),
      null,
      "L/J: nothing moves while orphan and live cannot be told apart",
    );
  });

  it("J + L: a stranger session reconciles nothing and sees no binding", async () => {
    await recoveredBinding();
    await seedFullGraph(LEGACY);
    assert.equal(
      await reconcileOwnerForSession(sql, { id: STRANGER, email: STRANGER_EMAIL }, directory()),
      null,
    );
    assert.equal(
      await reconcileOwnerForSession(sql, { id: "ghost", email: null }, directory()),
      null,
      "an unauthenticated/unresolved identity reconciles nothing",
    );
    const left = await sql.query<{ n: number }>(
      `select count(*)::int as n from payment_requests where user_id = $1`,
      [LEGACY],
    );
    assert.equal(Number(left[0]?.n), 1, "nothing moved");
  });
});

// ── F + structural alarms ────────────────────────────────────────────────────

describe("structural integrity alarms (STEP 11)", () => {
  async function cleanMigration() {
    await recoveredBinding();
    await seedFullGraph(LEGACY);
    await reconcile();
  }

  it("F. detects a Keygen scope mismatch on the canonical owner's row", async () => {
    await cleanMigration();
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, metadata)
      values (
        'lic-scoped', 'hash-scoped', 'NASAQ-', 'PRO', 'ACTIVE', ${OWNER}, now(),
        ${JSON.stringify({ source: "keygen", keygenLicenseId: "k-9", userScopeVerified: "some-third-party" })}
      )
    `;
    const report = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(report.ok, false);
    assert.equal(findCheck(report, "owner_license_scope").ok, false);
    assert.equal(findCheck(report, "owner_license_scope").count, 1);
  });

  it("certifies a rebound Keygen scope written by the reconciliation", async () => {
    await recoveredBinding();
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, metadata)
      values (
        'lic-rebound', 'hash-rebound', 'NASAQ-', 'PRO', 'ACTIVE', ${LEGACY}, now(),
        ${JSON.stringify({ source: "keygen", keygenLicenseId: "k-8", userScopeVerified: LEGACY, nasaqUserId: LEGACY })}
      )
    `;
    const result = await reconcile();
    assert.equal(result?.moved.licenses, 1);
    const report = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 2));
    assert.equal(findCheck(report, "owner_license_scope").ok, true);
    assert.equal(findCheck(report, "rebound_marker_live").ok, true);
    assert.equal(report.canonicalRows.licenses, 1);
  });

  it("alarms when a rebound marker names a LIVE account", async () => {
    await cleanMigration();
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, metadata)
      values (
        'lic-bad-marker', 'hash-bad-marker', 'NASAQ-', 'PRO', 'ACTIVE', ${OWNER}, now(),
        ${JSON.stringify({ source: "keygen", keygenLicenseId: "k-7", ownerReboundFrom: STRANGER })}
      )
    `;
    const report = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(report.ok, false);
    assert.equal(findCheck(report, "rebound_marker_live").ok, false);
  });

  it("detects duplicate live subscriptions, duplicate licence keys and unknown plans", async () => {
    await cleanMigration();
    // Two live rows for one account and two rows for one key (both forbidden
    // by constraints on fresh writes; simulate the corrupted at-rest state the
    // report exists to catch, then restore the guards in `finally`).
    await sql.query(`drop index if exists subscriptions_one_live_per_user`);
    await sql.query(`alter table licenses drop constraint licenses_key_hash_key`);
    await sql`
      insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
      values ('s1', ${OWNER}, 'individual-monthly', 'ACTIVE', now(), now() + interval '5 days'),
             ('s2', ${OWNER}, 'individual-monthly', 'ACTIVE', now(), now() + interval '6 days')
    `;
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status)
      values ('a', 'dup-hash', 'NASAQ-', 'PRO', 'ACTIVE'), ('b', 'dup-hash', 'NASAQ-', 'PRO', 'REVOKED')
    `;
    await sql`
      insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
      values ('s3', ${STRANGER}, 'plan-that-never-existed', 'EXPIRED', now() - interval '9 days', now() - interval '1 days')
    `;
    try {
      const report = await collectOwnerMigrationReport(sql, { directory: directory() });
      assert.equal(report.ok, false);
      assert.equal(findCheck(report, "duplicate_live_subscriptions").count, 1);
      assert.equal(findCheck(report, "duplicate_license_keys").count, 1);
      assert.equal(findCheck(report, "subscription_plan").count, 1);
    } finally {
      // Restore the structural guards this test dropped to simulate corruption.
      await sql`delete from subscriptions where id in ('s1', 's2', 's3')`;
      await sql`delete from licenses where id in ('a', 'b')`;
      await sql.query(
        `create unique index if not exists subscriptions_one_live_per_user
           on subscriptions (user_id) where status in ('ACTIVE', 'SUSPENDED')`,
      );
      await sql.query(`alter table licenses add constraint licenses_key_hash_key unique (key_hash)`);
    }
  });

  it("reports — but never fails on — legitimate unowned inventory and retired legacy authority", async () => {
    await cleanMigration();
    await sql`
      insert into licenses (id, key_hash, key_prefix, type, status)
      values ('lic-inventory', 'hash-inventory', 'NASAQ-', 'PRO', 'ACTIVE')
    `;
    const report = await collectOwnerMigrationReport(sql, { directory: directory() });
    assert.equal(report.ok, true);
    assert.equal(findCheck(report, "unowned_active_license").count, 1, "inventory is reported");
    assert.equal(findCheck(report, "orphan_admin_rows").count, 1, "the retired pre-migration admin row is visible");
    assert.equal(report.warnings >= 1, true);
  });

  it("NEVER leaks a raw user id or address — ids are fingerprints, emails are absent", async () => {
    await cleanMigration();
    const report = await collectOwnerMigrationReport(sql, { directory: directory() });
    const serialized = JSON.stringify(report);
    for (const raw of [LEGACY, OWNER, STRANGER, OWNER_EMAIL, STRANGER_EMAIL]) {
      assert.equal(
        serialized.includes(raw),
        false,
        `the report must not contain ${raw.slice(0, 4)}…`,
      );
    }
    // The proven orphan id stays proven (identity-store absence is what proves
    // it) — but it is only ever a fingerprint, and it now holds zero rows.
    assert.deepEqual(report.orphans, [fingerprint(LEGACY)]);
    assert.equal(findCheck(report, "orphan_rows").count, 0);
    assert.equal(report.binding.ownerFingerprint, fingerprint(OWNER));
    assert.notEqual(report.binding.ownerFingerprint, OWNER);
  });
});
