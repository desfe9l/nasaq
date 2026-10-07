/**
 * Owner entitlement after the first-party auth migration — the licence half of
 * the identity mismatch.
 *
 * #156 re-bound ADMINISTRATOR AUTHORITY to the account the owner signs in with.
 * Authority is not entitlement: the owner's licences, subscriptions, licence
 * claims, trial, templates and cloud data were still keyed to the orphaned
 * pre-migration id, so the account view said FREE and every ownership lookup
 * said "no licence" while the console said "owner".
 *
 * These tests pin the whole rule set against a real database, through the REAL
 * decision functions (`getAuthorizationContext`, `getAccount`,
 * `findLicensesByUserId`, `getSubscription`, `recoverOwnerAuthority`,
 * `reconcileOwnerForSession`):
 *
 *   1. recovered owner + licence on the old id        → ACCESS, licence follows
 *   2. recovered owner + subscription on the old id   → ACCESS, entitlement follows
 *   3. owner with NO commercial licence               → ACCESS (owner policy)
 *   4. normal customer with no licence                → DENIED
 *   5. a customer cannot use the owner's orphaned licence → DENIED
 *   6. ADMIN / STAFF keep their own level             → policy, not promotion
 *   7. unauthenticated                                → DENIED
 *   8. an orphaned id nobody can sign in as           → cannot claim entitlement
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import { createTestSql, createUser } from "../commercial/test-db.ts";
import { setTestSql } from "../license/test-db-stub.ts";
import { getAuthorizationContext, requireFeature, ForbiddenError } from "./authorization.server.ts";
import {
  OWNER_BINDING_KEY,
  recoverOwnerAuthority,
  readOwnerBinding,
  type IdentityDirectory,
} from "./owner-binding.server.ts";
import {
  OWNER_RECONCILIATION_KEY,
  reconcileOwnerForSession,
  reconcileBoundOwner,
  provenOwnerOrphanIds,
  rebindOwnerOwnership,
} from "./owner-reconciliation.server.ts";
import { LICENSE_ENTITLEMENTS } from "../license/types.ts";
import { findLicensesByUserId, reserveKeygenClaim } from "../license/server.ts";
import { getAccount, getSubscription } from "../commercial/entitlement.server.ts";
import { boundToAnotherOwner, keygenScopeSatisfied } from "../license/scope.ts";

let sql: Sql;
let close: () => Promise<void>;

const ENV_KEYS = [
  "NASAQ_OWNER_ID",
  "NASAQ_OWNER_EMAIL",
  "NASAQ_ADMIN_USER_IDS",
  "NASAQ_SUPER_ADMIN_IDS",
  "NASAQ_SUPER_ADMIN_EMAILS",
  "NASAQ_OWNER_BINDING",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

before(async () => {
  ({ sql, close } = await createTestSql());
  setTestSql(sql);
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await sql`delete from admin_users`;
  await sql`delete from site_settings where key in (${OWNER_BINDING_KEY}, ${OWNER_RECONCILIATION_KEY})`;
  await sql`delete from licenses`;
  await sql`delete from license_claims`;
  await sql`delete from subscriptions`;
  await sql`delete from account_trials`;
  await sql`delete from "user"`;
});

after(async () => {
  setTestSql(undefined);
  await close();
});

/** A directory that knows exactly these accounts — everything else is an orphan. */
function directoryOf(accounts: Array<{ id: string; email: string }>, ready = true): IdentityDirectory {
  return {
    ready,
    lookup: async (id) => accounts.find((account) => account.id === id) ?? null,
    byEmail: async (email) =>
      accounts.find((account) => account.email.toLowerCase() === email.toLowerCase()) ?? null,
  };
}

async function adminRow(userId: string, role: string): Promise<void> {
  await sql`
    insert into admin_users (user_id, created_by, note, role)
    values (${userId}, 'test', 'test', ${role})
    on conflict (user_id) do nothing
  `;
}

/** The legacy `"user"` projection row a pre-migration id lived in. */
async function legacyProjection(userId: string, email: string): Promise<void> {
  await sql`
    insert into "user" (id, name, email, "emailVerified")
    values (${userId}, ${userId}, ${email}, true)
    on conflict (id) do nothing
  `;
}

async function giveLicense(input: {
  id: string;
  userId: string;
  type?: "PRO" | "TRIAL" | "LIFETIME" | "FREE";
  status?: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt?: string | null;
  metadata?: Record<string, string>;
}): Promise<void> {
  await sql`
    insert into licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, expires_at, metadata)
    values (
      ${input.id}, ${`hash-${input.id}`}, ${"NASAQ-"}, ${input.type ?? "PRO"},
      ${input.status ?? "ACTIVE"}, ${input.userId}, now(), ${input.expiresAt ?? null},
      ${JSON.stringify(input.metadata ?? { source: "manual", plan: "individual-monthly" })}
    )
  `;
}

async function giveSubscription(userId: string, input: { id?: string; status?: string } = {}): Promise<void> {
  await sql`
    insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
    values (
      ${input.id ?? `sub-${userId}`}, ${userId}, 'monthly', ${input.status ?? "ACTIVE"},
      now(), now() + interval '30 days'
    )
  `;
}

/**
 * End the automatic 3-day trial so "no licence" means exactly that. The trial
 * is existing product policy (start-once, server-owned), not part of the owner
 * exemption, so a plain customer is tested after it lapses.
 */
async function expireTrial(userId: string): Promise<void> {
  await sql`
    insert into account_trials (user_id, started_at, expires_at)
    values (${userId}, now() - interval '10 days', now() - interval '7 days')
    on conflict (user_id) do update
      set started_at = excluded.started_at, expires_at = excluded.expires_at
  `;
}

/**
 * The production shape: an owner whose account id changed in the first-party
 * auth migration. The orphaned pre-migration id holds the (SUPER_ADMIN) row and
 * their commercial records; the directory only knows the new account.
 */
async function recoveredOwner(input: {
  legacyId: string;
  ownerId: string;
  email: string;
  role?: string;
  directory?: IdentityDirectory;
}) {
  const directory =
    input.directory ?? directoryOf([{ id: input.ownerId, email: input.email }]);
  await legacyProjection(input.legacyId, input.email);
  await adminRow(input.legacyId, input.role ?? "SUPER_ADMIN");
  const recovery = await recoverOwnerAuthority(
    sql,
    { id: input.ownerId, email: input.email, emailVerified: false },
    directory,
  );
  assert.equal(recovery.ok, true, JSON.stringify(recovery));
  return { directory, recovery };
}

describe("1–3. the recovered owner keeps the entitlement they already had", () => {
  it("1. owner + licence on the ORPHANED id → ACCESS, and the licence follows the account", async () => {
    await recoveredOwner({ legacyId: "legacy-owner", ownerId: "owner-new", email: "owner@example.com" });
    // The licence existed before the migration; it belongs to the owner.
    await sql`delete from licenses`;
    await giveLicense({ id: "lic-owner", userId: "legacy-owner", type: "LIFETIME", expiresAt: null });

    // The reconciliation is what the owner's next licence-status call runs.
    const result = await reconcileOwnerForSession(
      sql,
      { id: "owner-new", email: "owner@example.com" },
      directoryOf([{ id: "owner-new", email: "owner@example.com" }]),
    );
    assert.ok(result, "the owner's records are reconciled");
    assert.equal(result?.moved.licenses, 1);

    const owned = await findLicensesByUserId("owner-new");
    assert.equal(owned.length, 1, "the owner's licence is theirs again");
    assert.equal(owned[0].type, "LIFETIME");
    assert.equal((await findLicensesByUserId("legacy-owner")).length, 0, "nothing is left behind");

    const access = await getAuthorizationContext({
      id: "owner-new",
      email: "owner@example.com",
      emailVerified: false,
    });
    assert.equal(access.isOwner, true);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.LIFETIME);
    assert.equal(access.entitlements.advanced_export, true);
  });

  it("2. owner + subscription on the ORPHANED id → the account view derives ACTIVE, not FREE", async () => {
    await recoveredOwner({ legacyId: "legacy-sub", ownerId: "owner-sub", email: "sub@example.com" });
    await sql`delete from subscriptions`;
    await giveSubscription("legacy-sub", { id: "sub-owner" });

    await reconcileOwnerForSession(
      sql,
      { id: "owner-sub", email: "sub@example.com" },
      directoryOf([{ id: "owner-sub", email: "sub@example.com" }]),
    );

    const subscription = await getSubscription(sql, "owner-sub");
    assert.equal(subscription?.id, "sub-owner");
    const account = await getAccount(
      sql,
      "owner-sub",
      new Date(),
      { id: "owner-sub", email: "sub@example.com", emailVerified: false },
    );
    assert.equal(account.status, "ACTIVE", "the owner's paid plan is their own again");
    assert.equal(account.isAdmin, true);
    assert.ok(account.daysRemaining !== null && account.daysRemaining > 0);
  });

  it("3. owner with NO commercial licence → full administrative entitlement", async () => {
    await recoveredOwner({ legacyId: "legacy-bare", ownerId: "owner-bare", email: "bare@example.com" });
    const access = await getAuthorizationContext({
      id: "owner-bare",
      email: "bare@example.com",
      emailVerified: false,
    });
    assert.equal(access.isOwner, true);
    assert.equal(access.isAdmin, true);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.LIFETIME);
  });

  it("the healthy state is untouched: no orphan, no rows moved", async () => {
    await adminRow("owner-clean", "SUPER_ADMIN");
    await giveLicense({ id: "lic-clean", userId: "owner-clean" });
    const result = await reconcileOwnerForSession(
      sql,
      { id: "owner-clean", email: "clean@example.com" },
      directoryOf([{ id: "owner-clean", email: "clean@example.com" }]),
    );
    assert.equal(result, null, "a live account without a binding reconciles nothing");
    assert.equal((await findLicensesByUserId("owner-clean")).length, 1);
  });
});

describe("4–5. commercial enforcement is not weakened", () => {
  it("4. a normal customer with no licence is DENIED (after the standard trial lapses)", async () => {
    await createUser(sql, { id: "customer-1", email: "customer@example.com" });
    const identity = { id: "customer-1", email: "customer@example.com", emailVerified: true };
    // Existing product policy gives a brand-new account a 3-day trial; the
    // owner exemption is NOT what grants it, so it is ended before asserting.
    const trial = await getAuthorizationContext(identity);
    assert.equal(trial.license, null);
    assert.equal(trial.trial !== null, true, "the standard trial, not the owner exemption");
    await expireTrial("customer-1");

    const access = await getAuthorizationContext(identity);
    assert.equal(access.isAdmin, false);
    assert.equal(access.isOwner, false);
    assert.equal(access.license, null);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.FREE);
    assert.equal(access.entitlements.advanced_export, false);
    assert.equal(access.entitlements.premium_templates, false);
    assert.throws(() => requireFeature(access, "advanced_export"), ForbiddenError);
    const account = await getAccount(sql, "customer-1", new Date(), identity);
    assert.equal(account.status, "FREE");
    assert.equal(account.isAdmin, false, "the owner exemption is not a customer exemption");
  });

  it("5a. a customer cannot inherit the owner's orphaned licence", async () => {
    await recoveredOwner({ legacyId: "legacy-x", ownerId: "owner-x", email: "x@example.com" });
    await giveLicense({ id: "lic-x", userId: "legacy-x" });
    await createUser(sql, { id: "customer-2", email: "other@example.com" });

    // The customer's own lookups never see it…
    assert.equal((await findLicensesByUserId("customer-2")).length, 0);

    // …and reconciliation refuses anyone the binding does not name.
    const stolen = await reconcileOwnerForSession(
      sql,
      { id: "customer-2", email: "other@example.com" },
      directoryOf([
        { id: "owner-x", email: "x@example.com" },
        { id: "customer-2", email: "other@example.com" },
      ]),
    );
    assert.equal(stolen, null, "no binding names this account");
    assert.equal((await findLicensesByUserId("legacy-x")).length, 1, "the licence did not move");

    await expireTrial("customer-2");
    const access = await getAuthorizationContext({
      id: "customer-2",
      email: "other@example.com",
      emailVerified: true,
    });
    assert.equal(access.license, null, "no licence of the owner's is usable");
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.FREE);
    assert.throws(() => requireFeature(access, "premium_templates"), ForbiddenError);
  });

  it("5b. a customer cannot take the owner's reserved licence claim", async () => {
    await recoveredOwner({ legacyId: "legacy-claim", ownerId: "owner-claim", email: "claim@example.com" });
    await sql`
      insert into license_claims (key_hash, user_id)
      values ('hash-claim', 'legacy-claim')
    `;
    await reconcileOwnerForSession(
      sql,
      { id: "owner-claim", email: "claim@example.com" },
      directoryOf([{ id: "owner-claim", email: "claim@example.com" }]),
    );
    assert.equal(
      (await sql<{ user_id: string }>`select user_id from license_claims where key_hash = 'hash-claim'`)[0]?.user_id,
      "owner-claim",
      "the claim followed the owner",
    );
    assert.equal(await reserveKeygenClaim("hash-claim", "customer-3"), false);
    assert.equal(await reserveKeygenClaim("hash-claim", "owner-claim"), true);
  });

  it("5c. a live account's records are never moved, even for the bound owner", async () => {
    await recoveredOwner({ legacyId: "legacy-live", ownerId: "owner-live", email: "live@example.com" });
    // A second, SIGNED-IN account also holds a licence. Its id resolves in the
    // identity store, so it is nobody's orphan.
    await createUser(sql, { id: "someone-else", email: "else@example.com" });
    await giveLicense({ id: "lic-else", userId: "someone-else" });

    const result = await reconcileOwnerForSession(
      sql,
      { id: "owner-live", email: "live@example.com" },
      directoryOf([
        { id: "owner-live", email: "live@example.com" },
        { id: "someone-else", email: "else@example.com" },
      ]),
    );
    assert.equal(result, null, "nothing of another live account's may move");
    assert.equal((await findLicensesByUserId("someone-else")).length, 1);
  });
});

describe("6–7. roles and sessions keep their meaning", () => {
  it("6. ADMIN / STAFF keep their own level — the repair never promotes a customer", async () => {
    await createUser(sql, { id: "staff-1", email: "staff@example.com" });
    await adminRow("staff-1", "ADMIN");
    const staff = await getAuthorizationContext({
      id: "staff-1",
      email: "staff@example.com",
      emailVerified: true,
    });
    assert.equal(staff.isAdmin, true, "staff keep the access the product policy grants admins");
    assert.equal(staff.isOwner, false, "staff are not the owner");
    assert.deepEqual(staff.entitlements, LICENSE_ENTITLEMENTS.LIFETIME);

    // A staff transfer through the binding keeps the ADMIN level too.
    await legacyProjection("legacy-staff", "legacy-staff@example.com");
    await adminRow("legacy-staff", "ADMIN");
    const recovery = await recoverOwnerAuthority(
      sql,
      { id: "staff-new", email: "legacy-staff@example.com", emailVerified: false },
      directoryOf([{ id: "staff-new", email: "legacy-staff@example.com" }]),
    );
    assert.equal(recovery.ok, true);
    assert.equal(recovery.ok && recovery.role, "ADMIN");
    const bound = await readOwnerBinding(sql);
    assert.equal(bound?.role, "ADMIN");
    const transferred = await getAuthorizationContext({
      id: "staff-new",
      email: "legacy-staff@example.com",
      emailVerified: false,
    });
    assert.equal(transferred.isAdmin, true);
    assert.equal(transferred.isOwner, false, "an ADMIN binding is not owner authority");
  });

  it("7. an unauthenticated / unresolved identity is DENIED", async () => {
    const access = await getAuthorizationContext({ id: "stranger", email: null, emailVerified: false });
    assert.equal(access.isAdmin, false);
    assert.equal(access.isOwner, false);
    assert.equal(access.license, null);
    await expireTrial("stranger");
    const denied = await getAuthorizationContext({ id: "stranger", email: null, emailVerified: false });
    assert.deepEqual(denied.entitlements, LICENSE_ENTITLEMENTS.FREE);
    assert.throws(() => requireFeature(denied, "advanced_export"), ForbiddenError);
    const account = await getAccount(sql, "stranger");
    assert.equal(account.status, "FREE");
    assert.equal(account.isAdmin, false);
  });
});

describe("8. the orphaned id itself cannot claim anything", () => {
  it("a pre-migration id that resolves to no live account reconciles nothing and is never a target", async () => {
    await recoveredOwner({ legacyId: "legacy-ghost", ownerId: "owner-real", email: "ghost@example.com" });
    await sql`delete from licenses`;
    await giveLicense({ id: "lic-ghost", userId: "legacy-ghost" });
    const binding = await readOwnerBinding(sql);
    assert.equal(binding?.userId, "owner-real");

    // Reconciliation only ever runs for the account the binding names: the
    // orphaned id is a SOURCE of records, never a caller.
    const directory = directoryOf([{ id: "owner-real", email: "ghost@example.com" }]);
    assert.equal(
      await reconcileOwnerForSession(sql, { id: "legacy-ghost", email: "ghost@example.com" }, directory),
      null,
    );
    assert.equal(await reconcileBoundOwner(sql, binding, directory, { userId: "legacy-ghost" }), null);
    assert.equal((await findLicensesByUserId("legacy-ghost")).length, 1, "nothing moved for the orphan");

    // It IS recognised as the owner's orphan — the destination is the binding.
    assert.deepEqual(await provenOwnerOrphanIds(sql, binding!, directory), ["legacy-ghost"]);
    const moved = await reconcileOwnerForSession(
      sql,
      { id: "owner-real", email: "ghost@example.com" },
      directory,
    );
    assert.equal(moved?.userId, "owner-real");
    assert.equal((await findLicensesByUserId("owner-real")).length, 1);
  });

  it("refuses to move anything while the identity store cannot answer", async () => {
    await legacyProjection("legacy-unready", "unready@example.com");
    await adminRow("legacy-unready", "SUPER_ADMIN");
    await sql`
      insert into site_settings (key, value, updated_at)
      values (
        ${OWNER_BINDING_KEY},
        ${JSON.stringify({
          userId: "owner-unready",
          email: "unready@example.com",
          boundAt: new Date().toISOString(),
          source: "legacy_role_transfer",
          previousUserId: "legacy-unready",
          role: "SUPER_ADMIN",
        })}::jsonb,
        now()
      )
    `;
    await giveLicense({ id: "lic-unready", userId: "legacy-unready" });

    const result = await reconcileOwnerForSession(
      sql,
      { id: "owner-unready", email: "unready@example.com" },
      directoryOf([{ id: "owner-unready", email: "unready@example.com" }], false),
    );
    assert.equal(result, null, "an unready store must never read as 'orphaned'");
    assert.equal((await findLicensesByUserId("legacy-unready")).length, 1);
  });
});

describe("reconciliation mechanics", () => {
  it("honours the NASAQ_OWNER_BINDING=off kill switch", async () => {
    await recoveredOwner({ legacyId: "legacy-off", ownerId: "owner-off", email: "off@example.com" });
    await giveLicense({ id: "lic-off", userId: "legacy-off" });
    process.env.NASAQ_OWNER_BINDING = "off";
    const result = await reconcileOwnerForSession(
      sql,
      { id: "owner-off", email: "off@example.com" },
      directoryOf([{ id: "owner-off", email: "off@example.com" }]),
    );
    assert.equal(result, null, "the deployment switch stops the repair");
    assert.equal((await findLicensesByUserId("legacy-off")).length, 1, "nothing moved");
  });

  it("moves lapsed history but never expires a live plan to make room", async () => {
    await createUser(sql, { id: "dest", email: "dest@example.com" });
    await sql`
      insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
      values ('live-dest', 'dest', 'monthly', 'ACTIVE', now(), now() + interval '10 days')
    `;
    await sql`
      insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
      values ('live-orphan', 'orphan', 'monthly', 'ACTIVE', now(), now() + interval '40 days')
    `;
    await sql`
      insert into subscriptions (id, user_id, plan_id, status, activated_at, expires_at)
      values ('old-orphan', 'orphan', 'monthly', 'EXPIRED', now() - interval '90 days', now() - interval '60 days')
    `;

    const result = await rebindOwnerOwnership(sql, { userId: "dest", orphanIds: ["orphan"] });
    assert.equal(result.moved.subscriptions, 1, "only the lapsed row moved");
    const live = await getSubscription(sql, "dest");
    assert.equal(live?.id, "live-dest", "the destination's own live plan is untouched");
    const stillThere = await sql<{ user_id: string }>`select user_id from subscriptions where id = 'live-orphan'`;
    assert.equal(stillThere[0]?.user_id, "orphan", "the orphan's live row is left in place, not deleted");
  });

  it("keygen rows keep a truthful scope trail when they move", async () => {
    await giveLicense({
      id: "lic-keygen",
      userId: "orphan",
      type: "LIFETIME",
      metadata: {
        source: "keygen",
        keygenLicenseId: "k-1",
        userScopeVerified: "orphan",
        nasaqUserId: "orphan",
      },
    });
    await rebindOwnerOwnership(sql, { userId: "dest", orphanIds: ["orphan"] });
    const rows = await sql<{ user_id: string; metadata: Record<string, string> }>`
      select user_id, metadata from licenses where id = 'lic-keygen'
    `;
    assert.equal(rows[0]?.user_id, "dest");
    assert.equal(rows[0]?.metadata.ownerReboundFrom, "orphan");
    assert.equal(
      keygenScopeSatisfied(rows[0]?.metadata, "dest"),
      true,
      "the owner's own scope is recognised",
    );
    assert.equal(
      boundToAnotherOwner(rows[0]?.metadata, "dest", "someone-else"),
      true,
      "the row itself is refused to a third party",
    );
    assert.equal(boundToAnotherOwner(rows[0]?.metadata, "dest", "dest"), false);
    // End to end through the SQL gate the ownership lookups actually use.
    assert.equal((await findLicensesByUserId("dest")).length, 1);
    assert.equal((await findLicensesByUserId("someone-else")).length, 0);
  });
});
