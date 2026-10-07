/**
 * One administrator decision for every admin surface.
 *
 * The regression: after the first-party auth migration the commercial console
 * (customers, payments, plans, settings, requests) decided "admin?" from the
 * legacy `"user"` table ONLY, while the template console and the owner vault
 * used the verified session. An owner who signed in after the migration — whose
 * account is not (or not correctly) projected into `"user"` — was let into one
 * half of the console and answered "Forbidden" by the other.
 *
 * These tests pin, against a real database:
 *   · the commercial gate and the template gate AGREE for every identity shape;
 *   · configuration answers without the database (owner never locked out by an
 *     unreachable database), and an unverified address never matches an email
 *     allowlist;
 *   · id-only callers read the identity store, never a caller-supplied address;
 *   · the customer list includes accounts that only exist in the identity store;
 *   · staff administrators see the vault inventory without secret values.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Sql } from "@/lib/db";
import { isAdminCaller, isAdminUser, type AdminIdentityConfig } from "../auth/admin-identity.server.ts";
import { verifyTemplateManager } from "../admin/owner-gate.server.ts";
import { grantAdmin, isAdmin, listCustomersForAdmin, mergeCustomerIdentities, requireAdmin, AdminRequiredError } from "./admin.server.ts";
import { redactVaultForStaff, type OwnerVaultInventory } from "../owner/vault.ts";
import { createTestSql, createUser } from "./test-db.ts";

let sql: Sql;
let close: () => Promise<void>;

/** A database that is down: every query rejects. */
const downSql = (async () => {
  throw new Error("database unavailable");
}) as unknown as Sql;

const ENV_KEYS = [
  "NASAQ_OWNER_ID",
  "NASAQ_OWNER_EMAIL",
  "NASAQ_ADMIN_USER_IDS",
  "NASAQ_SUPER_ADMIN_IDS",
  "NASAQ_SUPER_ADMIN_EMAILS",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

before(async () => {
  ({ sql, close } = await createTestSql());
  // A legacy projection row for the STAFF admin only; the owner has none.
  await createUser(sql, { id: "staff-1", email: "staff@example.com" });
  await grantAdmin(sql, { adminUserId: "system" }, "staff-1", "promoted staff");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

after(async () => {
  await close();
});

const noAccount = async () => null;

describe("commercial and template gates agree", () => {
  const cases: Array<{
    name: string;
    env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
    identity: { userId: string; userEmail: string | null; userEmailVerified: boolean };
    expected: boolean;
  }> = [
    {
      name: "owner by VERIFIED email, no \"user\" row (post-migration account)",
      env: { NASAQ_OWNER_EMAIL: "owner@example.com" },
      identity: { userId: "fresh-uuid-1", userEmail: "owner@example.com", userEmailVerified: true },
      expected: true,
    },
    {
      name: "owner email but UNVERIFIED session",
      env: { NASAQ_OWNER_EMAIL: "owner@example.com" },
      identity: { userId: "fresh-uuid-2", userEmail: "owner@example.com", userEmailVerified: false },
      expected: false,
    },
    {
      name: "owner by id",
      env: { NASAQ_OWNER_ID: "owner-id-1" },
      identity: { userId: "owner-id-1", userEmail: null, userEmailVerified: false },
      expected: true,
    },
    {
      name: "promoted staff (admin_users row)",
      env: { NASAQ_OWNER_EMAIL: "owner@example.com" },
      identity: { userId: "staff-1", userEmail: "staff@example.com", userEmailVerified: false },
      expected: true,
    },
    {
      name: "ordinary customer",
      env: { NASAQ_OWNER_EMAIL: "owner@example.com" },
      identity: { userId: "customer-1", userEmail: "customer@example.com", userEmailVerified: true },
      expected: false,
    },
    {
      name: "customer claiming the owner address without verification",
      env: { NASAQ_SUPER_ADMIN_EMAILS: "owner@example.com" },
      identity: { userId: "customer-2", userEmail: "owner@example.com", userEmailVerified: false },
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      setEnv(testCase.env);
      const commercial = await isAdmin(
        sql,
        testCase.identity.userId,
        testCase.identity.userEmail,
        testCase.identity.userEmailVerified,
      );
      const content = await verifyTemplateManager(testCase.identity, Promise.resolve(sql));
      assert.equal(commercial, testCase.expected, "commercial gate");
      assert.equal(content.ok, testCase.expected, "template gate");
      if (testCase.expected) {
        await requireAdmin(sql, testCase.identity.userId, testCase.identity.userEmail, testCase.identity.userEmailVerified);
      } else {
        await assert.rejects(
          requireAdmin(sql, testCase.identity.userId, testCase.identity.userEmail, testCase.identity.userEmailVerified),
          AdminRequiredError,
        );
      }
    });
  }
});

describe("configuration answers without the database", () => {
  it("a configured owner is an admin while the database is down", async () => {
    const config: AdminIdentityConfig = { ids: new Set(["owner-id-1"]), emails: new Set(["owner@example.com"]) };
    assert.equal(await isAdminCaller(downSql, { id: "owner-id-1" }, { config }), true);
    assert.equal(
      await isAdminCaller(downSql, { id: "x", email: "owner@example.com", emailVerified: true }, { config }),
      true,
    );
  });

  it("the template gate admits the configured owner while the database is down", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    const result = await verifyTemplateManager(
      { userId: "fresh-uuid-3", userEmail: "owner@example.com", userEmailVerified: true },
      Promise.reject(new Error("database unavailable")),
    );
    assert.equal(result.ok, true);
  });

  it("a non-configured caller is refused (never admitted) when the database is down", async () => {
    setEnv({ NASAQ_OWNER_EMAIL: "owner@example.com" });
    const result = await verifyTemplateManager(
      { userId: "customer-3", userEmail: "customer@example.com", userEmailVerified: true },
      Promise.reject(new Error("database unavailable")),
    );
    assert.equal(result.ok, false);
    await assert.rejects(
      isAdminCaller(downSql, { id: "customer-3", email: "customer@example.com", emailVerified: true }, {
        config: { ids: new Set(), emails: new Set(["owner@example.com"]) },
      }),
    );
  });
});

describe("id-only callers", () => {
  const config: AdminIdentityConfig = { ids: new Set(), emails: new Set(["owner@example.com"]) };

  it("read the verified address from the identity store, not the \"user\" projection", async () => {
    const lookup = async (id: string) =>
      id === "fresh-uuid-4" ? { email: "owner@example.com", emailVerified: true } : null;
    assert.equal(await isAdminUser(sql, "fresh-uuid-4", config, undefined, lookup), true);
  });

  it("never accept a caller-supplied address", async () => {
    // The address argument is ignored for id-only checks: no account → no grant.
    assert.equal(await isAdminUser(sql, "nobody", "owner@example.com", config, noAccount), false);
  });

  it("refuse an unverified stored address", async () => {
    const lookup = async () => ({ email: "owner@example.com", emailVerified: false });
    assert.equal(await isAdminUser(sql, "fresh-uuid-5", config, undefined, lookup), false);
  });
});

describe("customer list", () => {
  it("includes identity-store accounts the \"user\" projection never received", async () => {
    const customers = await listCustomersForAdmin(sql, new Date(), [
      { id: "store-only-1", email: "new@example.com", name: "New", createdAt: new Date().toISOString() },
      { id: "staff-1", email: "staff+renamed@example.com", name: null, createdAt: "2020-01-01T00:00:00.000Z" },
    ]);
    const storeOnly = customers.find((customer) => customer.userId === "store-only-1");
    assert.equal(storeOnly?.email, "new@example.com");
    assert.equal(storeOnly?.status, "FREE");
    const staff = customers.filter((customer) => customer.userId === "staff-1");
    assert.equal(staff.length, 1, "one row per account");
    assert.equal(staff[0].email, "staff+renamed@example.com", "identity store is authoritative for the address");
  });

  it("merges newest first without duplicates", () => {
    const merged = mergeCustomerIdentities(
      [{ id: "a", email: "a@x", name: null, createdAt: "2026-01-01T00:00:00.000Z" }],
      [
        { id: "b", email: "b@x", name: null, createdAt: "2026-02-01T00:00:00.000Z" },
        { id: "a", email: "a2@x", name: "A", createdAt: "2026-03-01T00:00:00.000Z" },
      ],
    );
    assert.deepEqual(merged.map((row) => [row.id, row.email]), [["b", "b@x"], ["a", "a2@x"]]);
  });
});

describe("owner vault values", () => {
  it("staff administrators get every row but no secret or sensitive value", () => {
    const inventory = {
      generatedAt: "",
      environment: "test",
      ownerConfigured: true,
      routes: [],
      findings: [],
      entries: [
        { id: "env.A", sensitivity: "secret", value: "s3cr3t", ownerReadable: true },
        { id: "env.B", sensitivity: "sensitive", value: "acct", ownerReadable: true },
        { id: "env.C", sensitivity: "public", value: "https://example.com", ownerReadable: true },
      ],
    } as unknown as OwnerVaultInventory;
    const redacted = redactVaultForStaff(inventory);
    assert.equal(redacted.entries.length, 3);
    assert.deepEqual(
      redacted.entries.map((entry) => [entry.id, entry.value, entry.ownerReadable]),
      [["env.A", null, false], ["env.B", null, false], ["env.C", "https://example.com", true]],
    );
    assert.equal(inventory.entries[0].value, "s3cr3t", "the source inventory is not mutated");
  });

  it("the vault function only returns raw values to the owner / super-administrator", () => {
    const source = readFileSync(new URL("../owner/vault-functions.ts", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("export const getOwnerVaultFn"));
    assert.match(handler, /if \(!authorization\.isAdmin\) await denyForbidden\(\);/);
    assert.match(handler, /if \(authorization\.isOwner\) return inventory;/);
    assert.match(handler, /superAdmin \? inventory : redactVaultForStaff\(inventory\)/);
  });
});

describe("first-admin bootstrap", () => {
  const source = readFileSync(new URL("./admin-functions.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("export const adminBootstrapFirst"));

  it("refuses the anonymous dev user", () => {
    assert.match(handler, /isAnonymousDevUser\(context\.userId\)/);
  });

  it("is limited to the configured owner once an owner/admin is configured", () => {
    assert.match(handler, /if \(adminIdentityConfigPresent\(\)\) \{\s*if \(!isConfiguredAdminIdentity\(identity\)\)/);
  });

  it("is refused on a deployed runtime with no owner configured", () => {
    assert.match(handler, /if \(isDeployedRuntime\(\)\) \{/);
  });

  it("every commercial gate passes the session's verification state", () => {
    const calls = source.match(/requireAdmin\(sql,[^)]*\)/g) ?? [];
    assert.ok(calls.length >= 15, "all commercial handlers are gated");
    for (const call of calls) assert.match(call, /context\.userEmailVerified/);
    const requests = readFileSync(new URL("../requests/functions.ts", import.meta.url), "utf8");
    for (const call of requests.match(/requireAdmin\(sql,[^)]*\)/g) ?? []) {
      assert.match(call, /context\.userEmailVerified/);
    }
  });
});
