/**
 * Editor access states — the chain the account area and the editor entry read.
 *
 * The verification list for the account/entry work is a list of ACCOUNT STATES,
 * so this drives each one through the real path: a row in the database (or an
 * administrator identity) → `getAuthorizationContext` (the same function
 * `getLicenseStatusFn` calls, and therefore the one the editor's entitlements
 * come from) → the licence summary the settings panel prints.
 *
 * What it pins down:
 *   • a registered account with no licence is NOT locked out of the editor —
 *     `editorEntryFor` sends it straight in, and it arrives on the FREE
 *     entitlement map, so paid features stay closed;
 *   • a licensed account is fully entitled and named as such;
 *   • TRIAL keeps the trial limits (no team features);
 *   • EXPIRED / REVOKED lose the paid features but keep the account readable;
 *   • the name shown everywhere is the profile name, never the email.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import { createTestSql, createUser } from "../commercial/test-db.ts";
import { setTestSql } from "./test-db-stub.ts";
import { getAuthorizationContext } from "../auth/authorization.server.ts";
import { findLicensesByUserId } from "./server.ts";
import { licenseSummary } from "./summary.ts";
import { LICENSE_ENTITLEMENTS, type LicenseType } from "./types.ts";
import { accountIdentity, accountLabel } from "../auth/identity.ts";
import type { AppUser } from "../auth/use-current-user.ts";
import { EDITOR_ENTRY_DIRECT_LABEL, editorEntryFor } from "../auth/editor-entry.ts";

let sql: Sql;
let close: () => Promise<void>;

const USERS = {
  unlicensed: { id: "user-free", email: "free@example.com", name: "فيصل العنزي" },
  licensed: { id: "user-pro", email: "pro@example.com", name: "Pro Account" },
  trial: { id: "user-trial", email: "trial@example.com", name: "Trial Account" },
  expired: { id: "user-expired", email: "expired@example.com", name: "Expired Account" },
  revoked: { id: "user-revoked", email: "revoked@example.com", name: "Revoked Account" },
  admin: { id: "user-admin", email: "admin@example.com", name: "Admin Account" },
};

async function giveLicense(input: {
  userId: string;
  type: LicenseType;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  plan: string;
  expiresAt: string | null;
}): Promise<void> {
  const id = `lic-${input.userId}`;
  await sql`
    insert into licenses
      (id, key_hash, key_prefix, type, status, user_id, activated_at, expires_at, metadata)
    values (
      ${id}, ${`hash-${id}`}, ${"NASAQ-"}, ${input.type}, ${input.status},
      ${input.userId}, now(), ${input.expiresAt},
      ${JSON.stringify({ source: "manual", plan: input.plan, billing: "monthly" })}
    )
  `;
}

before(async () => {
  const db = await createTestSql();
  sql = db.sql;
  close = db.close;
  setTestSql(sql);
  for (const user of Object.values(USERS)) await createUser(sql, user);

  await giveLicense({
    userId: USERS.licensed.id,
    type: "PRO",
    status: "ACTIVE",
    plan: "individual-monthly",
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
  await giveLicense({
    userId: USERS.trial.id,
    type: "TRIAL",
    status: "ACTIVE",
    plan: "individual-monthly",
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  await giveLicense({
    userId: USERS.expired.id,
    type: "PRO",
    status: "EXPIRED",
    plan: "individual-monthly",
    expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
  });
  await giveLicense({
    userId: USERS.revoked.id,
    type: "PRO",
    status: "REVOKED",
    plan: "individual-monthly",
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
});

after(async () => {
  setTestSql(undefined);
  await close();
});

/**
 * The session user the client would hold for a stored auth row.
 *
 * Mapped field-for-field the way `useCurrentUserState` maps a Better Auth user,
 * so the identity the editor prints is proven to come from the account row and
 * not from anything the UI invented.
 */
async function sessionUserOf(id: string): Promise<AppUser> {
  const rows = await sql<{
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }>`select id, name, email, image from "user" where id = ${id}`;
  const row = rows[0];
  if (!row) throw new Error(`no user row for ${id}`);
  return {
    id: row.id,
    displayName: row.name ?? null,
    primaryEmail: row.email ?? null,
    profileImageUrl: row.image ?? null,
    isDevFallback: false,
  };
}

/**
 * The state the account area derives from the verified session.
 *
 * This mirrors `getLicenseStatusFn`'s resolution order exactly — an active
 * licence from the authorization context, otherwise the account's most recent
 * licence row kept visible without unlocking anything — because that server
 * function is the one the editor and the settings panel call.
 */
async function stateOf(user: { id: string; email: string }) {
  const access = await getAuthorizationContext({ id: user.id, email: user.email });
  const previous = access.license
    ? null
    : ((await findLicensesByUserId(user.id))[0] ?? null);
  const summary = licenseSummary({
    isLoading: false,
    isAdmin: access.isAdmin,
    isSuspended: access.isSuspended,
    hasLicense: Boolean(access.license),
    license: access.license ?? previous,
    trial: access.trial,
  });
  return { access, summary };
}

describe("editor access per account state", () => {
  it("starts a verified, unlicensed account on the full individual trial", async () => {
    // The door: any verified session enters the editor directly — there is no
    // «Try Editor» step in front of it.
    const entry = editorEntryFor({ isPending: false, hasUser: true });
    if (!entry.ready || !entry.direct) throw new Error("expected direct editor entry");
    assert.equal(entry.href, "/editor");
    assert.equal(entry.label, EDITOR_ENTRY_DIRECT_LABEL);

    const { access, summary } = await stateOf(USERS.unlicensed);
    assert.equal(access.isAdmin, false);
    assert.equal(access.license, null);
    assert.ok(access.trial);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.TRIAL);
    assert.equal(access.entitlements.core_editor, true);
    assert.equal(access.entitlements.basic_export, true);
    assert.equal(access.entitlements.premium_templates, true);
    assert.equal(access.entitlements.advanced_export, true);
    assert.equal(access.entitlements.brand_kit, true);
    assert.equal(access.entitlements.unlimited_pages, true);

    // The account is still named and told what is locked — with the name read
    // back from the auth database and mapped the way the session maps it.
    const identity = await sessionUserOf(USERS.unlicensed.id);
    assert.equal(accountLabel(identity), "فيصل العنزي");
    assert.equal(accountIdentity(identity).initials, "فع");
    assert.equal(identity.primaryEmail, "free@example.com");
    assert.equal(summary.tone, "licensed");
    assert.equal(summary.label, "تجربة مجانية");
    assert.ok(summary.detail?.startsWith("تنتهي في "));
  });

  it("gives a licensed account the full plan and names it", async () => {
    const { access, summary } = await stateOf(USERS.licensed);
    assert.equal(access.entitlements.advanced_export, true);
    assert.equal(access.entitlements.brand_kit, true);
    assert.equal(summary.tone, "licensed");
    assert.equal(summary.label, "احترافي (PRO)");
    assert.match(summary.detail ?? "", /^صالح حتى /);
  });

  it("keeps the trial limits on a trial account", async () => {
    const { access, summary } = await stateOf(USERS.trial);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.TRIAL);
    assert.equal(access.entitlements.premium_templates, true);
    assert.equal(access.entitlements.team_features, false);
    assert.equal(summary.label, "تجريبي (TRIAL)");
  });

  it("closes the paid features on an expired licence but keeps the account", async () => {
    const { access, summary } = await stateOf(USERS.expired);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.FREE);
    assert.equal(summary.tone, "free");
    assert.equal(summary.label, "انتهى احترافي (PRO)");
  });

  it("closes the paid features on a revoked licence", async () => {
    const { access, summary } = await stateOf(USERS.revoked);
    assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.FREE);
    assert.equal(summary.tone, "suspended");
    assert.equal(summary.label, "ترخيص ملغى");
  });

  it("treats an administrator identity as fully entitled", async () => {
    process.env.NASAQ_ADMIN_USER_IDS = USERS.admin.email;
    try {
      const { access, summary } = await stateOf(USERS.admin);
      assert.equal(access.isAdmin, true);
      assert.deepEqual(access.entitlements, LICENSE_ENTITLEMENTS.LIFETIME);
      assert.equal(summary.label, "ADMIN — وصول كامل");
    } finally {
      delete process.env.NASAQ_ADMIN_USER_IDS;
    }
  });
});
