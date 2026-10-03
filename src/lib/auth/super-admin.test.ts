/**
 * Super-administrator (owner bypass) tests.
 *
 * The failure this file exists to prevent: the platform owner, signed in and
 * looking at their own product, being told they may not manage licences because
 * a fresh database has no `admin_users` row for them. Three behaviours pin the
 * fix down — the owner is recognised from configuration alone, the missing row
 * is self-healed on demand, and nobody who is not the declared owner can use
 * that repair to promote themselves.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  SUPER_ADMIN_ROLE,
  ensureOwnerSuperAdmin,
  isConfiguredSuperAdminIdentity,
  isSuperAdminIdentity,
  readSuperAdminConfig,
  superAdminDiagnostics,
} from "./super-admin.server.ts";
import { createTestSql, createUser } from "../commercial/test-db.ts";
import type { Sql } from "../db.ts";

const OWNER = { id: "usr-owner", email: "Owner@Example.com" };
const STAFF = { id: "usr-staff", email: "staff@example.com" };
const STRANGER = { id: "usr-stranger", email: "someone@example.com" };

describe("Super admin owner bypass", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  const saved = { ...process.env };

  before(async () => {
    ({ sql, close } = await createTestSql());
    await createUser(sql, { id: OWNER.id, email: OWNER.email });
    await createUser(sql, { id: STAFF.id, email: STAFF.email });
  });

  after(async () => {
    for (const key of [
      "NASAQ_OWNER_ID",
      "NASAQ_OWNER_EMAIL",
      "NASAQ_SUPER_ADMIN_IDS",
      "NASAQ_SUPER_ADMIN_EMAILS",
    ]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await close();
  });

  it("recognises the owner by id and by email, case-insensitively", () => {
    process.env.NASAQ_OWNER_ID = OWNER.id;
    delete process.env.NASAQ_OWNER_EMAIL;
    assert.equal(isConfiguredSuperAdminIdentity(OWNER), true);

    delete process.env.NASAQ_OWNER_ID;
    // Deliberately different case: a session may hand back "Owner@..." while
    // the operator typed "owner@..." into the dashboard.
    process.env.NASAQ_OWNER_EMAIL = "owner@example.com";
    assert.equal(isConfiguredSuperAdminIdentity(OWNER), true);
    assert.equal(isConfiguredSuperAdminIdentity(STRANGER), false);
  });

  it("accepts a comma-separated super-admin allowlist of ids and emails", () => {
    process.env.NASAQ_SUPER_ADMIN_IDS = "someone-else, usr-owner";
    process.env.NASAQ_SUPER_ADMIN_EMAILS = "AnOther@Example.com";
    delete process.env.NASAQ_OWNER_ID;
    delete process.env.NASAQ_OWNER_EMAIL;
    const config = readSuperAdminConfig();
    assert.ok(config.ids.has("usr-owner"));
    assert.ok(config.emails.has("another@example.com"));
    assert.equal(isConfiguredSuperAdminIdentity(OWNER), true);
    assert.equal(isConfiguredSuperAdminIdentity(STRANGER), false);
  });

  it("treats a configured owner as a super admin with no row present", async () => {
    process.env.NASAQ_OWNER_ID = OWNER.id;
    delete process.env.NASAQ_OWNER_EMAIL;
    await sql`delete from admin_users where user_id = ${OWNER.id}`;
    assert.equal(await isSuperAdminIdentity(sql, OWNER), true);
  });

  it("self-heals the missing SUPER_ADMIN row for the configured owner", async () => {
    process.env.NASAQ_OWNER_ID = OWNER.id;
    delete process.env.NASAQ_OWNER_EMAIL;
    await sql`delete from admin_users where user_id = ${OWNER.id}`;

    const first = await ensureOwnerSuperAdmin(sql, OWNER);
    assert.equal(first.ok, true);
    assert.equal(first.created, true);

    const rows = await sql<{ role: string }>`
      select role from admin_users where user_id = ${OWNER.id}
    `;
    assert.equal(rows[0]?.role, SUPER_ADMIN_ROLE);

    // Idempotent: the second call must not fail or duplicate the row.
    const second = await ensureOwnerSuperAdmin(sql, OWNER);
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    const after = await sql<{ role: string }>`
      select role from admin_users where user_id = ${OWNER.id}
    `;
    assert.equal(after.length, 1);
  });

  it("refuses to promote an identity the deployment never declared", async () => {
    process.env.NASAQ_OWNER_ID = OWNER.id;
    delete process.env.NASAQ_OWNER_EMAIL;
    const result = await ensureOwnerSuperAdmin(sql, STRANGER);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_owner");
    const rows = await sql<{ role: string }>`
      select role from admin_users where user_id = ${STRANGER.id}
    `;
    assert.equal(rows.length, 0);
  });

  it("promotes a plain ADMIN row belonging to the declared owner", async () => {
    process.env.NASAQ_OWNER_EMAIL = OWNER.email.toLowerCase();
    delete process.env.NASAQ_OWNER_ID;
    await sql`delete from admin_users where user_id = ${OWNER.id}`;
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${OWNER.id}, 'system', 'promoted staff', 'ADMIN')
    `;
    const result = await ensureOwnerSuperAdmin(sql, OWNER);
    assert.equal(result.ok, true);
    assert.equal(result.reason, "promoted");
    assert.equal(await isSuperAdminIdentity(sql, OWNER), true);
  });

  it("never reports a plain administrator as a super admin", async () => {
    delete process.env.NASAQ_OWNER_ID;
    delete process.env.NASAQ_OWNER_EMAIL;
    delete process.env.NASAQ_SUPER_ADMIN_IDS;
    delete process.env.NASAQ_SUPER_ADMIN_EMAILS;
    await sql`delete from admin_users where user_id = ${STAFF.id}`;
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${STAFF.id}, 'system', 'staff', 'ADMIN')
    `;
    assert.equal(await isSuperAdminIdentity(sql, STAFF), false);
    assert.equal(await isSuperAdminIdentity(sql, STRANGER), false);
  });

  it("diagnoses WHY an identity is not a super admin, without leaking config", async () => {
    delete process.env.NASAQ_OWNER_ID;
    delete process.env.NASAQ_OWNER_EMAIL;
    delete process.env.NASAQ_SUPER_ADMIN_IDS;
    delete process.env.NASAQ_SUPER_ADMIN_EMAILS;
    await sql`delete from admin_users where user_id = ${STRANGER.id}`;

    const report = await superAdminDiagnostics(sql, STRANGER);
    assert.equal(report.isSuperAdmin, false);
    assert.equal(report.isAdmin, false);
    assert.equal(report.ownerConfigured, false);
    assert.equal(report.hasRow, false);
    // The report is booleans only — never the configured ids or emails, which
    // would turn a diagnostics screen into a target list.
    const json = JSON.stringify(report);
    assert.ok(!json.includes("usr-"));
    assert.ok(!json.includes("@example.com"));
  });
});
