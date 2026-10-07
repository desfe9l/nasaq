/**
 * The durable owner binding — and the guard that keeps it from being a backdoor.
 *
 * The regression this pins: administrator authority is stored against an ACCOUNT
 * ID. The first-party auth migration minted new ids, so an owner's `admin_users`
 * row, `NASAQ_OWNER_ID` and every licence stayed behind on an id nobody can sign
 * in as. The console then answered «لا تملك صلاحية الوصول» for the real owner
 * with no recovery path at all.
 *
 * These tests assert both halves of the repair:
 *   · the accounts that ARE the owner's get their authority back;
 *   · nobody else does — not a customer, not a squatter, not a caller with an
 *     unverified address the deployment never named, and never while any
 *     account that can still sign in holds administrator authority.
 */
import { describe, it, before, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import {
  OWNER_BINDING_KEY,
  configuredOwnerEmails,
  isBoundAdmin,
  isBoundOwner,
  parseOwnerBinding,
  readOwnerBinding,
  recoverOwnerAuthority,
  recoveryMessage,
  EMPTY_DIRECTORY,
  type IdentityDirectory,
} from "./owner-binding.server.ts";
import {
  isAdminCaller,
  isAdminIdentity,
  type AdminIdentityConfig,
} from "./admin-identity.server.ts";
import { isSuperAdminIdentity, SUPER_ADMIN_ROLE, ADMIN_ROLE } from "./super-admin.server.ts";
import { getAuthorizationContext } from "./authorization.server.ts";
import { createTestSql } from "../commercial/test-db.ts";
import { setTestSql } from "../license/test-db-stub.ts";

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

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

before(async () => {
  ({ sql, close } = await createTestSql());
  // `getAuthorizationContext` reaches the database through `@/lib/db`, which
  // the test loader swaps for the stub — install the real PGlite instance so
  // the assertions exercise the production query, not a fake.
  setTestSql(sql);
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await sql`delete from admin_users`;
  await sql`delete from site_settings where key = ${OWNER_BINDING_KEY}`;
  await sql`delete from "user" where id like 'test-%'`;
});

after(async () => {
  setTestSql(undefined);
  await close();
});

/** A directory with exactly these accounts and no notion of anything else. */
function directoryOf(accounts: Array<{ id: string; email: string }>, ready = true): IdentityDirectory {
  return {
    ready,
    lookup: async (id) => accounts.find((account) => account.id === id) ?? null,
    byEmail: async (email) =>
      accounts.find((account) => account.email.toLowerCase() === email.toLowerCase()) ?? null,
  };
}

/** An `admin_users` row, optionally with an explicit role. */
async function adminRow(userId: string, role?: string): Promise<void> {
  if (role) {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (${userId}, 'test', 'test', ${role})
      on conflict (user_id) do nothing
    `;
    return;
  }
  await sql`
    insert into admin_users (user_id, created_by, note)
    values (${userId}, 'test', 'test')
    on conflict (user_id) do nothing
  `;
}

/** A legacy `\"user\"` projection row — the table pre-migration ids lived in. */
async function legacyProjection(userId: string, email: string): Promise<void> {
  await sql`
    insert into "user" (id, name, email, "emailVerified")
    values (${userId}, ${userId}, ${email}, true)
    on conflict (id) do nothing
  `;
}

describe("parseOwnerBinding", () => {
  it("rejects junk and accepts a stored binding", () => {
    assert.equal(parseOwnerBinding(null), null);
    assert.equal(parseOwnerBinding("{}"), null);
    assert.equal(parseOwnerBinding({ userId: "  " }), null);
    assert.equal(parseOwnerBinding([{ userId: "a" }]), null);
    const parsed = parseOwnerBinding({
      userId: "abc",
      email: "Owner@Example.COM",
      boundAt: "2026-01-01T00:00:00.000Z",
      source: "legacy_role_transfer",
      previousUserId: "old",
    });
    assert.equal(parsed?.userId, "abc");
    assert.equal(parsed?.email, "owner@example.com");
    assert.equal(parsed?.source, "legacy_role_transfer");
    assert.equal(parsed?.previousUserId, "old");
  });

  it("matches on the verified session id and nothing else", () => {
    const binding = parseOwnerBinding({ userId: "abc", email: "owner@example.com" })!;
    assert.equal(binding.role, ADMIN_ROLE, "an unlabelled binding defaults to the staff level");
    assert.equal(isBoundAdmin(binding, { id: "abc", email: "x@y.z", emailVerified: false }), true);
    assert.equal(isBoundAdmin(binding, { id: "other", email: "owner@example.com", emailVerified: true }), false);
    assert.equal(isBoundAdmin(null, { id: "abc", email: null, emailVerified: false }), false);
  });

  it("only a SUPER_ADMIN binding carries owner authority", () => {
    const owner = parseOwnerBinding({ userId: "abc", role: SUPER_ADMIN_ROLE })!;
    const staff = parseOwnerBinding({ userId: "abc", role: ADMIN_ROLE })!;
    const identity = { id: "abc", email: null, emailVerified: false };
    assert.equal(isBoundAdmin(owner, identity), true);
    assert.equal(isBoundOwner(owner, identity), true);
    assert.equal(isBoundAdmin(staff, identity), true);
    assert.equal(isBoundOwner(staff, identity), false, "staff stay staff — no promotion by repair");
  });
});

describe("configuredOwnerEmails", () => {
  it("collects the owner and super-admin address configuration", () => {
    setEnv({ NASAQ_OWNER_EMAIL: "Owner@Example.com", NASAQ_SUPER_ADMIN_EMAILS: "second@example.com" });
    const emails = configuredOwnerEmails();
    assert.ok(emails.has("owner@example.com"));
    assert.ok(emails.has("second@example.com"));
  });

  it("is empty when the deployment names no address", () => {
    setEnv({});
    assert.equal(configuredOwnerEmails().size, 0);
  });
});

describe("recoverOwnerAuthority — the accounts that get their authority back", () => {
  it("transfers an ORPHANED SUPER_ADMIN row whose legacy address is the caller's", async () => {
    setEnv({});
    await adminRow("legacy-owner-id", SUPER_ADMIN_ROLE);
    await legacyProjection("legacy-owner-id", "owner@example.com");

    const result = await recoverOwnerAuthority(
      sql,
      { id: "new-owner-id", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "new-owner-id", email: "owner@example.com" }]),
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.ok && result.reason, "bound");
    assert.equal(result.ok && result.role, SUPER_ADMIN_ROLE);
    assert.equal(result.ok && result.previousUserId, "legacy-owner-id");
    // The authority is now readable by every existing gate.
    assert.equal(
      await isSuperAdminIdentity(sql, { id: "new-owner-id", email: "owner@example.com", emailVerified: false }),
      true,
    );
  });

  it("preserves a staff ADMIN role instead of promoting it", async () => {
    setEnv({});
    await adminRow("legacy-staff-id", ADMIN_ROLE);
    await legacyProjection("legacy-staff-id", "staff@example.com");

    const result = await recoverOwnerAuthority(
      sql,
      { id: "new-staff-id", email: "staff@example.com", emailVerified: false },
      directoryOf([{ id: "new-staff-id", email: "staff@example.com" }]),
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.ok && result.role, ADMIN_ROLE);
    // Staff stays staff: the vault keeps redacting secrets for them.
    const context = await getAuthorizationContext({
      id: "new-staff-id",
      email: "staff@example.com",
      emailVerified: false,
    });
    assert.equal(context.isAdmin, true);
    assert.equal(context.isOwner, false, "a transferred ADMIN row must not become the owner");
  });

  it("binds the deployment's named owner address when no administrator row exists", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });

    const result = await recoverOwnerAuthority(
      sql,
      { id: "post-migration-owner", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "post-migration-owner", email: "owner@example.com" }]),
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.ok && result.reason, "bound");
    assert.equal(result.ok && result.role, SUPER_ADMIN_ROLE);
    assert.equal(result.ok && result.source, "owner_email_binding");

    const binding = await readOwnerBinding(sql);
    assert.equal(binding?.userId, "post-migration-owner");
    assert.equal(binding?.source, "owner_email_binding");

    // The owner is the OWNER, not merely an admin — the vault reveals secrets.
    const context = await getAuthorizationContext({
      id: "post-migration-owner",
      email: "owner@example.com",
      emailVerified: false,
    });
    assert.equal(context.isOwner, true);
    assert.equal(context.isAdmin, true);
  });

  it("reports already_authorized instead of a silent no-op", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    await adminRow("live-owner", SUPER_ADMIN_ROLE);

    const result = await recoverOwnerAuthority(
      sql,
      { id: "live-owner", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "live-owner", email: "owner@example.com" }]),
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.reason, "already_authorized");
    assert.equal(await readOwnerBinding(sql), null, "nothing is written when nothing was broken");
  });

  it("is idempotent — a second attempt reports the existing binding", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    const directory = directoryOf([{ id: "owner-1", email: "owner@example.com" }]);
    const first = await recoverOwnerAuthority(
      sql,
      { id: "owner-1", email: "owner@example.com", emailVerified: false },
      directory,
    );
    assert.equal(first.ok, true);
    const second = await recoverOwnerAuthority(
      sql,
      { id: "owner-1", email: "owner@example.com", emailVerified: false },
      directory,
    );
    assert.equal(second.ok, true);
    assert.equal(second.ok && second.reason, "already_authorized");
  });
});

describe("recoverOwnerAuthority — what it must refuse", () => {
  it("refuses while any administrator can still sign in", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    await adminRow("live-admin");
    const directory = directoryOf([
      { id: "live-admin", email: "admin@example.com" },
      { id: "attacker", email: "owner@example.com" },
    ]);

    const result = await recoverOwnerAuthority(
      sql,
      { id: "attacker", email: "owner@example.com", emailVerified: false },
      directory,
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "live_admin_exists");
    assert.equal(await readOwnerBinding(sql), null);
    assert.equal(await isAdminCaller(sql, { id: "attacker", email: "owner@example.com", emailVerified: false }), false);
  });

  it("refuses when a configured owner id belongs to a live account other than the caller", async () => {
    setEnv({ NASAQ_OWNER_ID: "real-owner", NASAQ_OWNER_EMAIL: "owner@example.com" });
    const directory = directoryOf([
      { id: "real-owner", email: "owner@example.com" },
      { id: "someone-else", email: "other@example.com" },
    ]);
    const result = await recoverOwnerAuthority(
      sql,
      { id: "someone-else", email: "other@example.com", emailVerified: true },
      directory,
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "live_admin_exists");
  });

  it("refuses an address the deployment never named", async () => {
    setEnv({});
    await adminRow("legacy-owner-id", SUPER_ADMIN_ROLE);
    await legacyProjection("legacy-owner-id", "owner@example.com");

    // `legacy-owner-id` is an ORPHAN: it is deliberately absent from the
    // directory, which is what makes it transferable at all.
    const result = await recoverOwnerAuthority(
      sql,
      { id: "customer-1", email: "customer@example.com", emailVerified: true },
      directoryOf([{ id: "customer-1", email: "customer@example.com" }]),
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "not_named");
    assert.equal(await readOwnerBinding(sql), null);
  });

  it("refuses when the caller is not the store's unique holder of the address", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    // Unverified on purpose: a VERIFIED holder of the owner address is already
    // an administrator by the pre-existing configuration rule, so the address
    // has to be unverified for the uniqueness guard to be the thing deciding.
    const result = await recoverOwnerAuthority(
      sql,
      { id: "impostor", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "real-owner", email: "owner@example.com" }]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "address_not_unique");
  });

  it("refuses an orphaned row whose legacy address is not the caller's", async () => {
    setEnv({});
    await adminRow("legacy-owner-id", SUPER_ADMIN_ROLE);
    await legacyProjection("legacy-owner-id", "owner@example.com");

    const result = await recoverOwnerAuthority(
      sql,
      { id: "someone-else", email: "someone@example.com", emailVerified: true },
      directoryOf([{ id: "someone-else", email: "someone@example.com" }]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "not_named");
  });

  it("refuses when the binding already names another account", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    await sql`
      insert into site_settings (key, value, updated_at)
      values (${OWNER_BINDING_KEY}, ${JSON.stringify({ userId: "the-real-owner", email: "owner@example.com" })}::jsonb, now())
    `;
    const result = await recoverOwnerAuthority(
      sql,
      { id: "latecomer", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "latecomer", email: "owner@example.com" }]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "binding_owned_by_other");
    assert.equal((await readOwnerBinding(sql))?.userId, "the-real-owner", "the stored binding is untouched");
  });

  it("fails CLOSED when the identity store is not answering", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    await adminRow("legacy-owner-id", SUPER_ADMIN_ROLE);
    await legacyProjection("legacy-owner-id", "owner@example.com");

    const result = await recoverOwnerAuthority(
      sql,
      { id: "new-owner", email: "owner@example.com", emailVerified: false },
      { ...EMPTY_DIRECTORY, ready: false },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "store_unavailable");
  });

  it("refuses the shared anonymous dev user", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    const result = await recoverOwnerAuthority(
      sql,
      { id: "dev-user", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "dev-user", email: "owner@example.com" }]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "no_session");
  });

  it("honours the NASAQ_OWNER_BINDING=off kill switch", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com", NASAQ_OWNER_BINDING: "off" });
    const result = await recoverOwnerAuthority(
      sql,
      { id: "new-owner", email: "owner@example.com", emailVerified: false },
      directoryOf([{ id: "new-owner", email: "owner@example.com" }]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "disabled");
  });

  it("refuses an account with no address", async () => {
    setEnv({});
    const result = await recoverOwnerAuthority(
      sql,
      { id: "no-email", email: null, emailVerified: false },
      directoryOf([{ id: "no-email", email: "" }]),
    );
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "no_address");
  });
});

describe("the binding reaches every authority surface", () => {
  const OWNER = { id: "rebound-owner", email: "owner@example.com", emailVerified: false };

  beforeEach(async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    const result = await recoverOwnerAuthority(
      sql,
      OWNER,
      directoryOf([{ id: OWNER.id, email: "owner@example.com" }]),
    );
    assert.equal(result.ok, true, `precondition: the owner must bind (${JSON.stringify(result)})`);
  });

  it("the commercial gate agrees with the template gate", async () => {
    assert.equal(await isAdminCaller(sql, OWNER), true, "isAdminCaller");
    assert.equal(await isAdminIdentity(sql, OWNER), true, "isAdminIdentity");
    const { verifyTemplateManager } = await import("../admin/owner-gate.server.ts");
    const gate = await verifyTemplateManager(
      { userId: OWNER.id, userEmail: OWNER.email, userEmailVerified: OWNER.emailVerified },
      Promise.resolve(sql),
    );
    assert.equal(gate.ok, true, "verifyTemplateManager");
  });

  it("licence administration is restored to the owner", async () => {
    assert.equal(await isSuperAdminIdentity(sql, OWNER), true);
  });

  it("ordinary customers are still refused", async () => {
    const customer = { id: "customer-9", email: "customer@example.com", emailVerified: true };
    assert.equal(await isAdminCaller(sql, customer), false);
    assert.equal(await isSuperAdminIdentity(sql, customer), false);
    const context = await getAuthorizationContext(customer);
    assert.equal(context.isAdmin, false);
    assert.equal(context.isOwner, false);
  });

  it("a customer claiming the owner address without holding it is refused", async () => {
    const impostor = { id: "impostor", email: "owner@example.com", emailVerified: false };
    assert.equal(await isAdminCaller(sql, impostor), false);
    assert.equal(await isSuperAdminIdentity(sql, impostor), false);
  });
});

describe("recovery messages", () => {
  it("every refusal has an operator-facing message", () => {
    for (const reason of [
      "disabled",
      "no_session",
      "store_unavailable",
      "already_authorized",
      "live_admin_exists",
      "binding_owned_by_other",
      "not_named",
      "no_address",
      "address_not_unique",
      "write_failed",
    ] as const) {
      assert.ok(recoveryMessage(reason).length > 0, reason);
    }
  });
});

describe("an explicit admin configuration still wins", () => {
  it("a configured admin id is authorized with no binding written", async () => {
    setEnv({ NASAQ_ADMIN_USER_IDS: "explicit-admin" });
    const config: AdminIdentityConfig | undefined = undefined;
    assert.equal(
      await isAdminCaller(sql, { id: "explicit-admin", email: null, emailVerified: false }, config ? { config } : {}),
      true,
    );
    assert.equal(await readOwnerBinding(sql), null);
  });
});
