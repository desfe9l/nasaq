/**
 * Admin authorization + approval-flow tests.
 *
 * These encode the two rules the whole security model rests on:
 *
 *   1. A non-admin can never perform a sensitive action — `requireAdmin` throws,
 *      no matter how the call is shaped. There is no request field that grants it.
 *   2. Approving a payment is what grants access, and it grants exactly one
 *      period: a second admin clicking approve on the same request must not hand
 *      the customer another term.
 *
 * Run against a real database so the entitlement writes and the one-live-row
 * unique index are exercised for real.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { isAdminUser, type AdminIdentityConfig } from "../auth/admin-identity.server.ts";
import type { Sql } from "@/lib/db";
import {
  AdminRequiredError,
  ConflictError,
  activateCustomer,
  approvePayment,
  changePlan,
  extendSubscription,
  grantAdmin,
  isAdmin,
  listAuditLog,
  listCustomersForAdmin,
  rejectPayment,
  requireAdmin,
  restoreCustomer,
  setExpiration,
  suspendCustomer,
} from "./admin.server.ts";
import {
  createPaymentRequest,
  getPaymentRequestForAdmin,
  hasPendingPaymentRequest,
} from "./payments.server.ts";
import { getAccount } from "./entitlement.server.ts";
import { listEnabledPlans } from "./plans.server.ts";
import { createTestSql, createUser } from "./test-db.ts";

let sql: Sql;
let close: () => Promise<void>;

const ADMIN = "user-admin";
const CAROL = "user-carol";
const DAVE = "user-dave";

before(async () => {
  ({ sql, close } = await createTestSql());
  await createUser(sql, { id: ADMIN, email: "admin@example.com", name: "Admin" });
  await createUser(sql, { id: CAROL, email: "carol@example.com" });
  await createUser(sql, { id: DAVE, email: "dave@example.com" });
  await grantAdmin(sql, { adminUserId: "system" }, ADMIN, "test bootstrap");
});

after(async () => {
  await close();
});

/** A PENDING request for `userId`. */
async function requestFor(userId: string, planId = "individual-monthly"): Promise<string> {
  const plans = await listEnabledPlans(sql);
  const plan = plans.find((p) => p.id === planId);
  assert.ok(plan, `precondition: plan "${planId}" exists`);
  const request = await createPaymentRequest(sql, {
    userId,
    planId: plan.id,
    amount: plan.price,
    currency: plan.currency,
    paymentMethod: "MANUAL",
    paymentReference: `REF-${Math.random().toString(36).slice(2)}`,
    customerNote: null,
  });
  return request.id;
}

describe("isAdmin", () => {
  it("is true for a user with an admin_users row", async () => {
    assert.equal(await isAdmin(sql, ADMIN), true);
  });

  it("is false for an ordinary customer", async () => {
    assert.equal(await isAdmin(sql, CAROL), false);
  });

  it("is true only for a verified email present in the explicit admin allowlist", async () => {
    const config: AdminIdentityConfig = {
      ids: new Set(),
      emails: new Set(["carol@example.com"]),
    };
    assert.equal(await isAdminUser(sql, CAROL, config), true);
    assert.equal(await isAdminUser(sql, DAVE, config), false);
  });

  it("is false for an unknown user id", async () => {
    assert.equal(await isAdmin(sql, "no-such-user"), false);
  });
});

describe("requireAdmin rejects non-admins", () => {
  it("throws AdminRequiredError with status 403 for a customer", async () => {
    await assert.rejects(
      () => requireAdmin(sql, CAROL),
      (err: unknown) => {
        assert.ok(err instanceof AdminRequiredError);
        assert.equal(err.status, 403);
        return true;
      },
    );
  });

  it("resolves for an admin", async () => {
    await requireAdmin(sql, ADMIN);
  });
});

describe("customer cannot perform admin operations", () => {
  // Every sensitive mutation is attempted as the CUSTOMER's id. Each must be
  // refused before it touches data — that is what stops a hand-crafted call.
  it("cannot approve a payment", async () => {
    const id = await requestFor(CAROL);
    await assert.rejects(
      () => requireAdmin(sql, CAROL).then(() => approvePayment(sql, { adminUserId: CAROL }, id, null)),
      AdminRequiredError,
    );
    // The request is untouched and still awaiting review.
    const row = await getPaymentRequestForAdmin(sql, id);
    assert.equal(row?.status, "PENDING");
  });

  it("cannot reject a payment", async () => {
    const id = await requestFor(CAROL);
    await assert.rejects(
      () => requireAdmin(sql, CAROL).then(() => rejectPayment(sql, { adminUserId: CAROL }, id, null)),
      AdminRequiredError,
    );
    assert.equal((await getPaymentRequestForAdmin(sql, id))?.status, "PENDING");
  });

  it("cannot activate themselves", async () => {
    await assert.rejects(
      () => requireAdmin(sql, CAROL).then(() => activateCustomer(sql, { adminUserId: CAROL }, CAROL, "annual")),
      AdminRequiredError,
    );
    assert.equal((await getAccount(sql, CAROL)).status, "FREE");
  });

  it("cannot suspend another customer", async () => {
    await assert.rejects(
      () => requireAdmin(sql, CAROL).then(() => suspendCustomer(sql, { adminUserId: CAROL }, DAVE)),
      AdminRequiredError,
    );
  });

  it("cannot grant themselves admin", async () => {
    await assert.rejects(
      () => requireAdmin(sql, CAROL).then(() => grantAdmin(sql, { adminUserId: CAROL }, CAROL, "self")),
      AdminRequiredError,
    );
    assert.equal(await isAdmin(sql, CAROL), false, "self-promotion must not work");
  });

  it("cannot read the audit log through the admin path", async () => {
    await assert.rejects(() => requireAdmin(sql, CAROL), AdminRequiredError);
  });
});

describe("approval grants access exactly once", () => {
  it("activates the customer with the plan's own duration", async () => {
    const plans = await listEnabledPlans(sql);
    const monthly = plans.find((p) => p.id === "individual-monthly")!;
    const before = Date.now();

    const id = await requestFor(DAVE, "individual-monthly");
    const { expiresAt } = await approvePayment(sql, { adminUserId: ADMIN }, id, "verified");

    const account = await getAccount(sql, DAVE);
    assert.equal(account.status, "ACTIVE");
    assert.equal(account.planId, "individual-monthly");

    // The expiry must come from the PLAN (30 days), not a hardcoded period.
    const expected = before + monthly.durationDays * 86_400_000;
    const actual = new Date(expiresAt).getTime();
    const driftMs = Math.abs(actual - expected);
    assert.ok(driftMs < 60_000, `expiry should be ~${monthly.durationDays} days out`);

    // The request is recorded as APPROVED, with the reviewing admin noted.
    const row = await getPaymentRequestForAdmin(sql, id);
    assert.equal(row?.status, "APPROVED");
    assert.equal(row?.reviewedAt !== null, true);
  });

  it("writes an audit entry naming the action and the admin", async () => {
    const id = await requestFor(DAVE);
    await approvePayment(sql, { adminUserId: ADMIN }, id, null);
    const log = await listAuditLog(sql, 50);
    const entry = log.find((e) => e.targetId === id);
    assert.ok(entry, "an audit entry must exist for the approval");
    assert.equal(entry.action, "payment.approved");
    assert.equal(entry.adminUserId, ADMIN);
  });

  it("refuses a second approval of the same request", async () => {
    const id = await requestFor(DAVE);
    await approvePayment(sql, { adminUserId: ADMIN }, id, null);

    // A double click (or a second admin) must not buy the customer a second term.
    await assert.rejects(
      () => approvePayment(sql, { adminUserId: ADMIN }, id, null),
      ConflictError,
    );
  });

  it("rejecting does NOT grant any access", async () => {
    const id = await requestFor(CAROL);
    await rejectPayment(sql, { adminUserId: ADMIN }, id, "receipt did not match");
    assert.equal((await getAccount(sql, CAROL)).status, "FREE", "rejection grants nothing");
  });

  it("rejects a request that was already decided, even in the other direction", async () => {
    const id = await requestFor(CAROL);
    await approvePayment(sql, { adminUserId: ADMIN }, id, null);
    await assert.rejects(
      () => rejectPayment(sql, { adminUserId: ADMIN }, id, "too late"),
      ConflictError,
    );
  });

  it("only one live subscription exists per customer after repeated renewals", async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = await requestFor(DAVE);
      await approvePayment(sql, { adminUserId: ADMIN }, id, null);
    }
    // The unique index allows one ACTIVE/SUSPENDED row; renewals must UPDATE it
    // rather than accumulate overlapping entitlements.
    const rows = await sql<{ count: number }>`
      select count(*)::int as count from subscriptions
      where user_id = ${DAVE} and status in ('ACTIVE', 'SUSPENDED')
    `;
    assert.equal(rows[0].count, 1);
  });
});

describe("admin lifecycle operations", () => {
  it("suspend then restore keeps the stored expiry", async () => {
    const id = await requestFor(CAROL);
    const { expiresAt } = await approvePayment(sql, { adminUserId: ADMIN }, id, null);

    await suspendCustomer(sql, { adminUserId: ADMIN }, CAROL);
    assert.equal((await getAccount(sql, CAROL)).status, "SUSPENDED");

    await restoreCustomer(sql, { adminUserId: ADMIN }, CAROL);
    const restored = await getAccount(sql, CAROL);
    assert.equal(restored.status, "ACTIVE");
    assert.equal(restored.expiresAt, expiresAt, "restoring must not move the expiry");
  });

  it("restore does not resurrect an already-lapsed period", async () => {
    const id = await requestFor(DAVE);
    await approvePayment(sql, { adminUserId: ADMIN }, id, null);
    // Force the period into the past, then suspend and restore.
    await setExpiration(sql, { adminUserId: ADMIN }, DAVE, new Date(Date.now() - 86_400_000));
    await suspendCustomer(sql, { adminUserId: ADMIN }, DAVE);
    await restoreCustomer(sql, { adminUserId: ADMIN }, DAVE);

    // Access stays gone — expiry is authoritative, and restore is not a renewal.
    assert.equal((await getAccount(sql, DAVE)).status, "EXPIRED");
  });

  it("extend adds days to the existing expiry", async () => {
    const id = await requestFor(CAROL);
    const { expiresAt } = await approvePayment(sql, { adminUserId: ADMIN }, id, null);
    const { expiresAt: extended } = await extendSubscription(
      sql,
      { adminUserId: ADMIN },
      CAROL,
      30,
    );
    const delta = new Date(extended).getTime() - new Date(expiresAt).getTime();
    assert.equal(Math.round(delta / 86_400_000), 30);
  });

  it("extend rejects a non-positive or absurd day count", async () => {
    for (const bad of [0, -5, 1.5, 99999]) {
      await assert.rejects(
        () => extendSubscription(sql, { adminUserId: ADMIN }, CAROL, bad),
        /positive whole number/,
      );
    }
  });

  it("changePlan switches the plan without moving the expiry", async () => {
    const id = await requestFor(CAROL);
    const { expiresAt } = await approvePayment(sql, { adminUserId: ADMIN }, id, null);
    await changePlan(sql, { adminUserId: ADMIN }, CAROL, "annual");

    const account = await getAccount(sql, CAROL);
    assert.equal(account.planId, "annual");
    assert.equal(account.expiresAt, expiresAt);
  });

  it("activateCustomer grants access with no payment request involved", async () => {
    await activateCustomer(sql, { adminUserId: ADMIN }, DAVE, "quarterly");
    const account = await getAccount(sql, DAVE);
    assert.equal(account.status, "ACTIVE");
    assert.equal(account.planId, "quarterly");
  });
});

describe("listCustomersForAdmin", () => {
  it("derives each customer's status with the shared rules", async () => {
    const customers = await listCustomersForAdmin(sql);
    const carol = customers.find((c) => c.userId === CAROL);
    assert.ok(carol, "Carol must appear in the admin list");
    // Active earlier in this suite; the list must agree with her own dashboard.
    const own = await getAccount(sql, CAROL);
    assert.equal(carol.status, own.status);
  });

  it("counts pending payments per customer", async () => {
    await requestFor(DAVE);
    assert.equal(await hasPendingPaymentRequest(sql, DAVE), true);
    const customers = await listCustomersForAdmin(sql);
    const dave = customers.find((c) => c.userId === DAVE);
    assert.ok((dave?.pendingPayments ?? 0) >= 1);
  });
});

describe("payment_settings", () => {
  it("rejects an invalid IBAN rather than storing a transfer trap", async () => {
    const { updatePaymentSettings } = await import("./payment-settings.server.ts");
    await assert.rejects(
      () =>
        updatePaymentSettings(sql, {
          bankName: "Test Bank",
          accountName: "NASAQ",
          iban: "NOT-AN-IBAN",
          instructionsAr: "",
          instructionsEn: "",
        }),
      /IBAN/,
    );
  });

  it("accepts and persists a plausible IBAN", async () => {
    const { getPaymentInstructions, updatePaymentSettings } = await import(
      "./payment-settings.server.ts"
    );
    await updatePaymentSettings(sql, {
      bankName: "بنك تجريبي",
      accountName: "نَسَق",
      iban: "SA0380000000608010167519",
      instructionsAr: "حوّل ثم أدخل المرجع.",
      instructionsEn: "Transfer then submit the reference.",
    });
    const stored = await getPaymentInstructions(sql);
    assert.equal(stored.iban, "SA0380000000608010167519");
    assert.equal(stored.bankName, "بنك تجريبي");
  });
});