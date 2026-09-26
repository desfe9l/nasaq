/**
 * Gumroad ⇄ NASAQ ⇄ Keygen pipeline tests.
 *
 * End-to-end state machine coverage on a REAL database (PGlite + the real
 * migrations) with INJECTED verification and Keygen operations (fixtures).
 * Fixtures exist so no real purchase or network call is needed; production
 * always binds `productionGumroadPipelineDeps`, which talks to the real APIs —
 * the fixture deps are never referenced by server runtime code paths.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestSql, createUser } from "../commercial/test-db.ts";
import { setTestSql } from "../license/test-db-stub.ts";
import type { Sql } from "../db.ts";
import {
  DEFAULT_GUMROAD_PUBLIC_CONFIG,
  GUMROAD_PLAN_PRICE_CENTS,
  gumroadCheckoutUrl,
  gumroadPriceMatches,
  matchGumroadTierFamily,
  resolveGumroadPlanKey,
} from "./mapping.ts";
import {
  classifyGumroadPing,
  gumroadDedupeKey,
  handleGumroadNotification,
  parseGumroadPingBody,
  type GumroadPipelineDeps,
  type GumroadPingFields,
} from "./ping.server.ts";
import { claimGumroadSubscriptionsForUser } from "./claim.server.ts";
import {
  resetGumroadProductIdCache,
  resolveGumroadProductId,
} from "./config.server.ts";
import { verifyGumroadLicense, verifyGumroadSale } from "./api.server.ts";

// ── Fixture helpers ──────────────────────────────────────────────────────────

let userSeq = 0;
async function createNamedUser(sql: Sql, email: string): Promise<{ id: string }> {
  const id = `gumroad-user-${++userSeq}`;
  await createUser(sql, { id, email });
  return { id };
}

const TIERS = {
  individual: DEFAULT_GUMROAD_PUBLIC_CONFIG.tierNames.individual,
  team: DEFAULT_GUMROAD_PUBLIC_CONFIG.tierNames.team,
};

function pingFields(overrides: Partial<GumroadPingFields> = {}): GumroadPingFields {
  return {
    raw: {},
    variants: { Tier: TIERS.individual },
    resourceName: "sale",
    saleId: "SALE-1",
    subscriptionId: "SUB-1",
    productId: "PRODUCT-1",
    productPermalink: null,
    email: "buyer@example.com",
    licenseKey: null,
    recurrence: "monthly",
    isRecurringCharge: false,
    refunded: false,
    disputed: false,
    disputeWon: false,
    chargebacked: false,
    cancelledAt: null,
    endedAt: null,
    endedReason: null,
    restartedAt: null,
    effectiveAsOf: null,
    priceCents: GUMROAD_PLAN_PRICE_CENTS["individual-monthly"],
    currency: "sar",
    test: false,
    ...overrides,
  };
}

/** Fixture verifier: accepts exactly the sale ids registered here. */
function fixtureDeps(sql: Sql, options: {
  sales?: Record<string, { email: string; subscriptionId?: string; recurrence?: string; variants?: Record<string, string>; priceCents?: number; currency?: string; refunded?: boolean; disputed?: boolean; disputeWon?: boolean; chargedback?: boolean; recurring?: boolean }>;
  failIssue?: boolean;
  log?: string[];
}): { deps: GumroadPipelineDeps; issued: string[]; renewed: string[]; revoked: string[] } {
  const issued: string[] = [];
  const renewed: string[] = [];
  const revoked: string[] = [];
  const deps: GumroadPipelineDeps = {
    verify: async ({ saleId, licenseKey }) => {
      if (licenseKey && options.sales?.[licenseKey]) {
        const sale = options.sales[licenseKey];
        return {
          via: "license",
          sale: {
            saleId: saleId ?? licenseKey,
            productId: "PRODUCT-1",
            productPermalink: null,
            email: sale.email,
            priceCents: sale.priceCents ?? GUMROAD_PLAN_PRICE_CENTS["individual-monthly"],
            currency: sale.currency ?? "sar",
            refunded: sale.refunded ?? false,
            chargedback: sale.chargedback ?? false,
            disputed: sale.disputed ?? false,
            disputeWon: sale.disputeWon ?? false,
            paid: true,
            subscriptionId: sale.subscriptionId ?? "SUB-1",
            recurringCharge: sale.recurring ?? false,
            recurrence: sale.recurrence ?? "monthly",
            variants: sale.variants ?? { Tier: TIERS.individual },
            licenseKey,
          },
        };
      }
      const sale = saleId ? options.sales?.[saleId] : undefined;
      if (!sale) return { via: "none", reason: "sale_not_found" };
      return {
        via: "api",
        sale: {
          saleId: saleId!,
          productId: "PRODUCT-1",
          productPermalink: null,
          email: sale.email,
          priceCents: sale.priceCents ?? GUMROAD_PLAN_PRICE_CENTS["individual-monthly"],
          currency: sale.currency ?? "sar",
          refunded: sale.refunded ?? false,
          chargedback: sale.chargedback ?? false,
          disputed: sale.disputed ?? false,
          disputeWon: sale.disputeWon ?? false,
          paid: true,
          subscriptionId: sale.subscriptionId ?? "SUB-1",
          recurringCharge: sale.recurring ?? false,
          recurrence: sale.recurrence ?? "monthly",
          variants: sale.variants ?? { Tier: TIERS.individual },
          licenseKey: null,
        },
      };
    },
    issue: async (input) => {
      if (options.failIssue) throw new Error("keygen unavailable (fixture)");
      const id = `lic-${issued.length + 1}`;
      issued.push(`${input.subscriptionId}:${input.plan}`);
      // Mirror what production's issueGumroadKeygenLicense does via
      // activateKeygenForSession → upsertExternalLicense: persist the local
      // license (with gumroadSubscriptionId metadata) after a successful mint.
      await sql`
        insert into licenses (id, key_hash, key_prefix, type, status, user_id, expires_at, activation_count, metadata)
        values (${id}, ${`hash-${id}-${input.subscriptionId}`}, ${`lic-${id.slice(0, 8)}`}, 'PRO', 'ACTIVE',
                ${input.userId}, ${input.expiresAt}, 0,
                ${JSON.stringify({ source: "gumroad", gumroadSubscriptionId: input.subscriptionId, keygenLicenseId: id, gumroadSaleId: input.saleId, userScopeVerified: input.userId })}::jsonb)
        on conflict (key_hash) do nothing
      `;
      return { id, expiresAt: input.expiresAt };
    },
    renew: async (input) => {
      renewed.push(`${input.subscriptionId}:${input.expiresAt}`);
      return { id: `lic-${issued.length || 1}`, expiresAt: input.expiresAt };
    },
    revoke: async (input) => {
      revoked.push(input.subscriptionId);
      return true;
    },
    restore: async () => true,
  };
  return { deps, issued, renewed, revoked };
}

async function subscriptionRow(sql: Sql, subscriptionId: string) {
  const rows = await sql<Record<string, unknown>>`select * from gumroad_subscriptions where subscription_id = ${subscriptionId} limit 1`;
  return rows[0] ?? null;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

describe("Gumroad tier mapping", () => {
  it("maps the four published tiers to the four NASAQ plans", () => {
    assert.equal(resolveGumroadPlanKey({ variants: { Tier: TIERS.individual }, recurrence: "monthly" }), "individual-monthly");
    assert.equal(resolveGumroadPlanKey({ variants: { Tier: TIERS.individual }, recurrence: "quarterly" }), "individual-quarterly");
    assert.equal(resolveGumroadPlanKey({ variants: { Tier: TIERS.team }, recurrence: "monthly" }), "team-monthly");
    assert.equal(resolveGumroadPlanKey({ variants: { Tier: TIERS.team }, recurrence: "quarterly" }), "team-quarterly");
  });

  it("maps the checkout deep links to the right tier + recurrence", () => {
    const monthly = gumroadCheckoutUrl("individual-monthly");
    assert.ok(monthly.includes(`tier=${encodeURIComponent(TIERS.individual)}`));
    assert.ok(monthly.includes("monthly=true") && monthly.includes("wanted=true"));
    const teamQuarterly = gumroadCheckoutUrl("team-quarterly");
    assert.ok(teamQuarterly.includes(`tier=${encodeURIComponent(TIERS.team)}`));
    assert.ok(teamQuarterly.includes("quarterly=true"));
    assert.ok(teamQuarterly.startsWith("https://nasaqar.gumroad.com/l/auaewk"));
  });

  it("matches tier names tolerantly and rejects unknown tiers", () => {
    assert.equal(matchGumroadTierFamily("نَسَق | فردي"), "individual");
    assert.equal(matchGumroadTierFamily("  نَسَق | فريق  "), "team");
    assert.equal(matchGumroadTierFamily("Something else"), null);
    assert.equal(resolveGumroadPlanKey({ variants: { Tier: "Unknown" }, recurrence: "monthly" }), null);
    assert.equal(resolveGumroadPlanKey({ variants: { Tier: TIERS.individual }, recurrence: "yearly" }), null);
  });

  it("enforces the catalog price only in the seller currency", () => {
    assert.equal(gumroadPriceMatches("individual-monthly", 7900, "sar"), true);
    assert.equal(gumroadPriceMatches("individual-monthly", 12345, "sar"), false);
    // Re-denominated buyer currency is not the seller price — do not reject.
    assert.equal(gumroadPriceMatches("individual-monthly", 2107, "usd"), true);
  });
});

// ── Ping parsing + classification ────────────────────────────────────────────

describe("Gumroad ping parsing", () => {
  it("parses form-encoded pings including bracketed variants", () => {
    const body = new URLSearchParams({
      resource_name: "sale",
      sale_id: "S1",
      subscription_id: "SUB1",
      product_id: "P1",
      email: "Buyer@Example.com",
      price: "7900",
      currency: "sar",
      recurrence: "monthly",
      "variants[Tier]": TIERS.individual,
      test: "false",
    }).toString();
    const fields = parseGumroadPingBody(body, "application/x-www-form-urlencoded");
    assert.ok(fields);
    assert.equal(fields.saleId, "S1");
    assert.equal(fields.variants.Tier, TIERS.individual);
    assert.equal(fields.priceCents, 7900);
    assert.equal(fields.test, false);
  });

  it("parses JSON resource-subscription payloads", () => {
    const fields = parseGumroadPingBody(
      JSON.stringify({ resource_name: "cancellation", subscription_id: "SUB1", cancelled: "true", cancelled_at: "2026-01-01T00:00:00Z", user_email: "a@b.com" }),
      "application/json",
    );
    assert.ok(fields);
    assert.equal(classifyGumroadPing(fields), "cancellation");
  });

  it("classifies money-back signals ahead of the sale resource name", () => {
    assert.equal(classifyGumroadPing(pingFields({ resourceName: "sale", refunded: true })), "refund");
    assert.equal(classifyGumroadPing(pingFields({ resourceName: "sale", disputed: true, disputeWon: false })), "dispute");
    assert.equal(classifyGumroadPing(pingFields({ resourceName: "sale" })), "sale");
    assert.equal(classifyGumroadPing(pingFields({ resourceName: "subscription_ended", endedAt: "2026-01-01T00:00:00Z", saleId: null })), "subscription_ended");
  });

  it("dedupes sale pings by sale id and tests never dedupe", () => {
    assert.equal(gumroadDedupeKey("sale", pingFields()), "sale:SALE-1");
    assert.equal(gumroadDedupeKey("refund", pingFields()), "refund:SALE-1");
    const testKey = gumroadDedupeKey("sale", pingFields({ test: true }));
    assert.ok(testKey?.startsWith("test:"));
  });
});

// ── End-to-end state machine (fixtures + real SQL) ──────────────────────────

describe("Gumroad pipeline end-to-end", () => {
  // The licensing chain resolves the DB through getSql(); the alias loader
  // substitutes a stub that hands back THIS test's real PGlite instance.

  it("fulfills a first Individual Monthly sale: binds the account, issues Keygen license, grants entitlement", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const user = await createNamedUser(sql, "buyer@example.com");
      const { deps, issued } = fixtureDeps(sql, { sales: { "SALE-1": { email: "buyer@example.com" } } });
      const outcome = await handleGumroadNotification(sql, pingFields(), deps);
      assert.equal(outcome.status, 200);
      assert.equal(outcome.body.applied, true);
      assert.equal(issued.length, 1);
      assert.ok(issued[0].startsWith("SUB-1:individual-monthly"));

      const sub = await subscriptionRow(sql, "SUB-1");
      assert.equal(sub?.status, "ACTIVE");
      assert.equal(sub?.bound_user_id, user.id);
      assert.equal(sub?.plan_key, "individual-monthly");

      const entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} and status = 'ACTIVE' limit 1`;
      assert.ok(entitlement[0], "entitlement granted");
      assert.equal(entitlement[0]?.source_transaction_id, "gumroad:SALE-1");
      assert.equal(entitlement[0]?.plan_id, "individual-monthly");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("replays are idempotent: a redelivered sale neither duplicates entitlements nor mints a license", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      await createNamedUser(sql, "buyer@example.com");
      const { deps, issued } = fixtureDeps(sql, { sales: { "SALE-1": { email: "buyer@example.com" } } });
      await handleGumroadNotification(sql, pingFields(), deps);
      const replay = await handleGumroadNotification(sql, pingFields(), deps);
      assert.equal(replay.body.duplicate, true);
      assert.equal(issued.length, 1);
      const entitlements = await sql<Record<string, unknown>>`select * from subscriptions`;
      assert.equal(entitlements.length, 1);
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("extends the SAME license on renewal instead of minting a second one", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      await createNamedUser(sql, "buyer@example.com");
      const { deps, issued, renewed } = fixtureDeps(sql, {
        sales: {
          "SALE-1": { email: "buyer@example.com" },
          "SALE-2": { email: "buyer@example.com", recurring: true },
        },
      });
      await handleGumroadNotification(sql, pingFields(), deps);
      const renewal = await handleGumroadNotification(sql, pingFields({ saleId: "SALE-2", isRecurringCharge: true }), deps);
      assert.equal(renewal.body.applied, true);
      assert.equal(issued.length, 1, "no second license minted");
      assert.equal(renewed.length, 1, "renewal extended the existing license");
      const entitlements = await sql<Record<string, unknown>>`select * from subscriptions where status = 'ACTIVE'`;
      assert.equal(entitlements.length, 1);
      assert.equal(entitlements[0]?.source_transaction_id, "gumroad:SALE-2");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("revokes access on refund", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const user = await createNamedUser(sql, "buyer@example.com");
      const { deps, revoked } = fixtureDeps(sql, {
        sales: {
          "SALE-1": { email: "buyer@example.com" },
        },
      });
      await handleGumroadNotification(sql, pingFields(), deps);
      const refund = await handleGumroadNotification(sql, pingFields({ resourceName: "refund" }), deps);
      assert.equal(refund.body.applied, true);
      assert.equal(revoked.includes("SUB-1"), true);
      const sub = await subscriptionRow(sql, "SUB-1");
      assert.equal(sub?.status, "REFUNDED");
      const entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} limit 1`;
      assert.equal(entitlement[0]?.status, "EXPIRED");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("suspends on a lost dispute and does not rebind to another account", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const user = await createNamedUser(sql, "buyer@example.com");
      const other = await createNamedUser(sql, "other@example.com");
      const { deps } = fixtureDeps(sql, {
        sales: {
          "SALE-1": { email: "buyer@example.com" },
          "SALE-2": { email: "attacker@example.com", disputed: true },
        },
      });
      await handleGumroadNotification(sql, pingFields(), deps);

      // An attacker's ping for the SAME subscription must not take it over.
      const hijack = await handleGumroadNotification(sql, pingFields({ saleId: "SALE-2", email: "attacker@example.com", disputed: true }), deps);
      assert.equal(hijack.body.applied, true);
      const sub = await subscriptionRow(sql, "SUB-1");
      assert.equal(sub?.bound_user_id, user.id, "binding is immutable");
      assert.notEqual(sub?.bound_user_id, other.id);

      const entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} limit 1`;
      assert.equal(entitlement[0]?.status, "SUSPENDED");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("cancellation keeps paid access but blocks nothing; ended ends access now", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const user = await createNamedUser(sql, "buyer@example.com");
      const { deps } = fixtureDeps(sql, { sales: { "SALE-1": { email: "buyer@example.com" } } });
      await handleGumroadNotification(sql, pingFields(), deps);

      const cancel = await handleGumroadNotification(
        sql,
        pingFields({ resourceName: "cancellation", saleId: null, cancelledAt: "2026-01-02T00:00:00Z" }),
        deps,
      );
      assert.equal(cancel.body.applied, true);
      let entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} limit 1`;
      assert.equal(entitlement[0]?.status, "ACTIVE", "paid period survives cancellation");
      assert.equal((await subscriptionRow(sql, "SUB-1"))?.status, "CANCELLED");

      const ended = await handleGumroadNotification(
        sql,
        pingFields({ resourceName: "subscription_ended", saleId: null, endedAt: "2026-01-31T00:00:00Z", endedReason: "cancelled" }),
        deps,
      );
      assert.equal(ended.body.applied, true);
      entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} limit 1`;
      assert.equal(entitlement[0]?.status, "EXPIRED");
      assert.equal((await subscriptionRow(sql, "SUB-1"))?.status, "ENDED");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("failed payment keeps the paid period but records PAYMENT_FAILED on sync", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const user = await createNamedUser(sql, "buyer@example.com");
      const { deps } = fixtureDeps(sql, { sales: { "SALE-1": { email: "buyer@example.com" } } });
      await handleGumroadNotification(sql, pingFields(), deps);
      await sql`update gumroad_subscriptions set status = 'PAYMENT_FAILED', updated_at = now() where subscription_id = 'SUB-1'`;
      const entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} limit 1`;
      assert.equal(entitlement[0]?.status, "ACTIVE", "paid period continues through failed renewal");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("rejects sales whose verified amount does not match the catalog price", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      await createNamedUser(sql, "buyer@example.com");
      const { deps, issued } = fixtureDeps(sql, { sales: { "SALE-1": { email: "buyer@example.com", priceCents: 100 } } });
      const outcome = await handleGumroadNotification(sql, pingFields(), deps);
      assert.equal(outcome.body.applied, false);
      assert.equal(outcome.body.reason, "amount_mismatch");
      assert.equal(issued.length, 0);
      const entitlements = await sql<Record<string, unknown>>`select * from subscriptions`;
      assert.equal(entitlements.length, 0);
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("answers test pings with 2xx and fulfills nothing", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const { deps, issued } = fixtureDeps(sql, {});
      const outcome = await handleGumroadNotification(sql, pingFields({ test: true, saleId: "gumroad-test", email: "test@example.com" }), deps);
      assert.equal(outcome.status, 200);
      assert.equal(outcome.body.test, true);
      assert.equal(issued.length, 0);
      const subs = await sql<Record<string, unknown>>`select * from gumroad_subscriptions`;
      assert.equal(subs.length, 0);
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("records unverified sales but never fulfills them", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const { deps } = fixtureDeps(sql, { sales: {} });
      const outcome = await handleGumroadNotification(sql, pingFields(), deps);
      assert.equal(outcome.body.applied, false);
      assert.equal(outcome.body.verified, false);
      const entitlements = await sql<Record<string, unknown>>`select * from subscriptions`;
      assert.equal(entitlements.length, 0);
      const sale = await sql<Record<string, unknown>>`select * from gumroad_sales where sale_id = 'SALE-1' limit 1`;
      assert.equal(sale[0]?.verified, false);
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("claims a membership for a buyer who registered AFTER purchasing (same verified email)", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      const { deps, issued } = fixtureDeps(sql, { sales: { "SALE-1": { email: "late-buyer@example.com" } } });
      // No NASAQ account exists yet: payment recorded, nothing granted.
      await handleGumroadNotification(sql, pingFields({ email: "late-buyer@example.com" }), deps);
      assert.equal(issued.length, 0);
      const unbound = await subscriptionRow(sql, "SUB-1");
      assert.equal(unbound?.bound_user_id, null);
      assert.equal(unbound?.bound_email, "late-buyer@example.com");

      // The buyer signs in with that exact email → claim + fulfillment.
      const user = await createNamedUser(sql, "late-buyer@example.com");
      const claim = await claimGumroadSubscriptionsForUser(sql, { userId: user.id, userEmail: "late-buyer@example.com" }, deps);
      assert.equal(claim.claimed, 1);
      assert.equal(claim.active, 1);
      const sub = await subscriptionRow(sql, "SUB-1");
      assert.equal(sub?.bound_user_id, user.id);
      assert.equal(sub?.status, "ACTIVE");
      const entitlement = await sql<Record<string, unknown>>`select * from subscriptions where user_id = ${user.id} limit 1`;
      assert.equal(entitlement[0]?.status, "ACTIVE");

      // Another account can never claim it afterwards.
      const other = await createNamedUser(sql, "other@example.com");
      const second = await claimGumroadSubscriptionsForUser(sql, { userId: other.id, userEmail: "other@example.com" });
      assert.equal(second.claimed, 0);
      const reread = await subscriptionRow(sql, "SUB-1");
      assert.equal(reread?.bound_user_id, user.id);
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("Team Quarterly maps to the team Keygen policy through the catalog", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      await createNamedUser(sql, "team@example.com");
      const { deps, issued } = fixtureDeps(sql, {
        sales: { "SALE-T": { email: "team@example.com", subscriptionId: "SUB-T", recurrence: "quarterly", variants: { Tier: TIERS.team }, priceCents: GUMROAD_PLAN_PRICE_CENTS["team-quarterly"] } },
      });
      const outcome = await handleGumroadNotification(sql, pingFields({ saleId: "SALE-T", subscriptionId: "SUB-T", recurrence: "quarterly", variants: { Tier: TIERS.team }, priceCents: GUMROAD_PLAN_PRICE_CENTS["team-quarterly"] }), deps);
      assert.equal(outcome.body.applied, true);
      assert.equal(issued[0], "SUB-T:team-quarterly");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });

  it("stores a safe ping audit trail (status + note, no secrets to leak)", async () => {
    const { sql, close } = await createTestSql();
    setTestSql(sql);
    try {
      await createNamedUser(sql, "buyer@example.com");
      const { deps } = fixtureDeps(sql, { sales: { "SALE-1": { email: "buyer@example.com" } } });
      await handleGumroadNotification(sql, pingFields(), deps);
      const pings = await sql<Record<string, unknown>>`select * from gumroad_pings`;
      assert.equal(pings.length, 1);
      assert.equal(pings[0]?.status, "APPLIED");
      const payload = JSON.stringify(pings[0]?.payload ?? {});
      assert.ok(!payload.includes("license_key"), "license keys are not persisted in ping payloads");
    } finally {
      setTestSql(undefined);
      await close();
    }
  });
});

// ── Product-id resolution (never assume the permalink IS the product id) ─────

const GUMROAD_ENV_KEYS = ["GUMROAD_ACCESS_TOKEN", "GUMROAD_PRODUCT_ID"] as const;

/** Snapshot/restore the Gumroad env so tests never leak into each other. */
function withGumroadEnv<T>(values: Partial<Record<(typeof GUMROAD_ENV_KEYS)[number], string>>, run: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const key of GUMROAD_ENV_KEYS) saved.set(key, process.env[key]);
  for (const key of GUMROAD_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
  resetGumroadProductIdCache();
  return run().finally(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetGumroadProductIdCache();
  });
}

/** Stub globalThis.fetch for the duration of one call; returns what was sent. */
async function withStubbedFetch<T>(
  handler: (url: string) => { status: number; payload: unknown },
  run: () => Promise<T>,
): Promise<{ result: T; urls: string[]; bodies: string[] }> {
  const original = globalThis.fetch;
  const urls: string[] = [];
  const bodies: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    // `apiFetch` sends a URLSearchParams instance for POST, so stringify either.
    const raw = init?.body;
    bodies.push(
      typeof raw === "string"
        ? raw
        : raw instanceof URLSearchParams
          ? raw.toString()
          : raw
            ? String(raw)
            : "",
    );
    const { status, payload } = handler(url);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const result = await run();
    return { result, urls, bodies };
  } finally {
    globalThis.fetch = original;
  }
}

describe("Gumroad product id resolution", () => {
  it("prefers the explicitly configured GUMROAD_PRODUCT_ID over the API", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok", GUMROAD_PRODUCT_ID: "PINNED_ID" }, async () => {
      const { result, urls } = await withStubbedFetch(
        () => ({ status: 200, payload: { products: [{ id: "API_ID", permalink: "auaewk" }] } }),
        () => resolveGumroadProductId(),
      );
      assert.deepEqual(result, { id: "PINNED_ID", source: "env" });
      assert.equal(urls.length, 0, "an explicit id must not cost an API round trip");
    });
  });

  it("derives the real product id from the API by permalink when unset", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok" }, async () => {
      const { result, urls } = await withStubbedFetch(
        () => ({
          status: 200,
          payload: {
            products: [
              { id: "OTHER_ID", permalink: "something-else", published: true },
              { id: "32-nPainqpLj1B_WIwVlMw==", permalink: "auaewk", published: true },
            ],
          },
        }),
        () => resolveGumroadProductId(),
      );
      assert.deepEqual(result, { id: "32-nPainqpLj1B_WIwVlMw==", source: "api" });
      assert.ok(urls[0]?.includes("/v2/products"), "looked the product up on the Gumroad API");
      assert.ok(urls[0]?.includes("access_token=tok"), "the lookup is authenticated");
    });
  });

  it("matches a product by custom_permalink and by its URL segment too", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok" }, async () => {
      const { result } = await withStubbedFetch(
        () => ({
          status: 200,
          payload: {
            products: [
              { id: "BY_CUSTOM", custom_permalink: "auaewk" },
              { id: "BY_URL", url: "https://nasaqar.gumroad.com/l/auaewk?wanted=true" },
            ],
          },
        }),
        () => resolveGumroadProductId(),
      );
      assert.equal(result.id, "BY_CUSTOM");
    });
  });

  it("stays unresolved without a token, so license verify falls back to the permalink", async () => {
    await withGumroadEnv({}, async () => {
      const { result, urls } = await withStubbedFetch(
        () => ({ status: 200, payload: { products: [] } }),
        () => resolveGumroadProductId(),
      );
      assert.deepEqual(result, { id: null, source: "unresolved" });
      assert.equal(urls.length, 0, "no token means no API call is attempted");
    });
  });

  it("does not cache a failed lookup, so a transient Gumroad error cannot poison the process", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok" }, async () => {
      await withStubbedFetch(
        () => ({ status: 500, payload: {} }),
        () => resolveGumroadProductId(),
      );
      const second = await withStubbedFetch(
        () => ({ status: 200, payload: { products: [{ id: "RECOVERED", permalink: "auaewk" }] } }),
        () => resolveGumroadProductId(),
      );
      assert.deepEqual(second.result, { id: "RECOVERED", source: "api" });
      assert.equal(second.urls.length, 1, "the failure was not memoised");
    });
  });

  it("rejects a verified sale that belongs to a DIFFERENT Gumroad product", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok", GUMROAD_PRODUCT_ID: "OUR_PRODUCT" }, async () => {
      const { result, urls } = await withStubbedFetch(
        (url) =>
          url.includes("/sales/")
            ? { status: 200, payload: { sale: { id: "SALE-X", product_id: "SOMEONE_ELSES", email: "b@example.com" } } }
            : { status: 404, payload: {} },
        () => verifyGumroadSale({ saleId: "SALE-X", licenseKey: null }),
      );
      assert.equal(result.via, "none");
      if (result.via === "none") assert.equal(result.reason, "product_mismatch");
      assert.equal(urls.length, 1, "one authenticated sale lookup, then rejected locally");
    });
  });

  it("rejects a license-verified sale from a different product", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok", GUMROAD_PRODUCT_ID: "OUR_PRODUCT" }, async () => {
      const { result } = await withStubbedFetch(
        () => ({
          status: 200,
          payload: {
            success: true,
            purchase: { id: "SALE-Y", product_id: "SOMEONE_ELSES", email: "b@example.com" },
          },
        }),
        () => verifyGumroadSale({ saleId: null, licenseKey: "LICENSE-KEY" }),
      );
      assert.equal(result.via, "none");
      if (result.via === "none") assert.equal(result.reason, "product_mismatch");
    });
  });

  it("verifies by product_id (not permalink) once the id is known", async () => {
    await withGumroadEnv({ GUMROAD_ACCESS_TOKEN: "tok", GUMROAD_PRODUCT_ID: "OUR_PRODUCT" }, async () => {
      const { result, urls, bodies } = await withStubbedFetch(
        () => ({
          status: 200,
          payload: {
            success: true,
            uses: 1,
            purchase: { id: "SALE-Z", product_id: "OUR_PRODUCT", email: "b@example.com" },
          },
        }),
        () => verifyGumroadLicense("LICENSE-KEY"),
      );
      assert.ok(result, "a sale on our own product verifies");
      assert.equal(urls.length, 1);
      // A POST carries its params in the form-encoded body, not the query string.
      const body = bodies[0] ?? "";
      assert.ok(body.includes("product_id=OUR_PRODUCT"), "bound by the real product id");
      assert.ok(!body.includes("product_permalink"), "never falls back to the permalink when the id is known");
      assert.ok(body.includes("increment_uses_count=false"), "verification never burns a license use");
    });
  });
});
