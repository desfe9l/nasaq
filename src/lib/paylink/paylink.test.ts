import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CENTRAL_PLANS,
  getCatalogPlan,
  isValidPlanKey,
  listCatalogPlans,
  type PaylinkPlanKey,
} from "../commercial/catalog.ts";
import {
  buildPaylinkInvoicePayload,
  verifyPaylinkWebhookAuthorization,
} from "./server.ts";
import {
  claimPaylinkTransaction,
  completePaylinkTransaction,
  findPaylinkTransactionByNumber,
  recordPaylinkLicense,
  recordPaylinkWebhook,
} from "./transactions.server.ts";
import {
  PAYLINK_WEBHOOK_API_VERSION,
  PAYLINK_WEBHOOK_PATH,
  paylinkWebhookUrl,
} from "./server.ts";
import { createTestSql, createUser } from "../commercial/test-db.ts";
import type { Sql } from "../db.ts";
import { keygenPolicyId } from "../license/keygen.ts";

describe("Paylink Central Catalog", () => {
  it("defines exactly the 6 required paid plans", () => {
    const plans = listCatalogPlans();
    assert.equal(plans.length, 6);

    const keys = plans.map((p) => p.key);
    assert.deepEqual(keys, [
      "individual-monthly",
      "individual-quarterly",
      "team-monthly",
      "team-quarterly",
      "individual-annual",
      "team-annual",
    ]);
  });

  it("has exact prices and durations matching business requirements", () => {
    const indMonthly = getCatalogPlan("individual-monthly");
    assert.ok(indMonthly);
    assert.equal(indMonthly.amount, 79);
    assert.equal(indMonthly.durationDays, 30);
    assert.equal(indMonthly.currency, "SAR");
    assert.equal(indMonthly.isDigital, true);

    const indQuarterly = getCatalogPlan("individual-quarterly");
    assert.ok(indQuarterly);
    assert.equal(indQuarterly.amount, 199);
    assert.equal(indQuarterly.durationDays, 90);
    assert.equal(indQuarterly.currency, "SAR");
    assert.equal(indQuarterly.isDigital, true);

    const teamMonthly = getCatalogPlan("team-monthly");
    assert.ok(teamMonthly);
    assert.equal(teamMonthly.amount, 199);
    assert.equal(teamMonthly.durationDays, 30);
    assert.equal(teamMonthly.currency, "SAR");
    assert.equal(teamMonthly.isDigital, true);

    const teamQuarterly = getCatalogPlan("team-quarterly");
    assert.ok(teamQuarterly);
    assert.equal(teamQuarterly.amount, 499);
    assert.equal(teamQuarterly.durationDays, 90);
    assert.equal(teamQuarterly.currency, "SAR");
    assert.equal(teamQuarterly.isDigital, true);
  });

  it("links each plan to configured Keygen policies", () => {
    for (const key of [
      "individual-monthly",
      "individual-quarterly",
      "team-monthly",
      "team-quarterly",
    ] as PaylinkPlanKey[]) {
      const plan = CENTRAL_PLANS[key];
      assert.ok(plan.keygenPolicyKey);
      const policyId = keygenPolicyId(plan.keygenPolicyKey);
      assert.ok(policyId, `Keygen policy for ${key} must not be empty`);
    }
  });

  it("rejects unknown plan keys", () => {
    assert.equal(isValidPlanKey("enterprise"), false);
    assert.equal(isValidPlanKey("trial"), false);
    assert.equal(isValidPlanKey("annual"), false);
    assert.equal(isValidPlanKey("individual-annual"), true);
    assert.equal(getCatalogPlan("invalid"), null);
  });
});

describe("Paylink Invoice Payload Builder", () => {
  it("builds compliant payloads for all 4 plans with digital product line items", () => {
    const publicUrl = "https://nasaq-sa.vercel.app";
    const clientMobile = "0552017111";
    const clientName = "فهد المطيري";
    const clientEmail = "fahad@example.com";

    for (const key of [
      "individual-monthly",
      "individual-quarterly",
      "team-monthly",
      "team-quarterly",
    ] as PaylinkPlanKey[]) {
      const plan = CENTRAL_PLANS[key];
      const orderNumber = `TEST-${key}-${Date.now()}`;
      const payload = buildPaylinkInvoicePayload({
        plan,
        orderNumber,
        publicUrl,
        clientName,
        clientEmail,
        clientMobile,
      });

      assert.equal(payload.orderNumber, orderNumber);
      assert.equal(payload.amount, plan.amount);
      assert.equal(payload.currency, "SAR");
      assert.equal(payload.clientName, clientName);
      assert.equal(payload.clientEmail, clientEmail);
      assert.equal(payload.clientMobile, clientMobile);
      assert.equal(payload.callBackUrl, `${publicUrl}/payment/success`);
      assert.equal(payload.cancelUrl, `${publicUrl}/payment/cancel`);

      assert.equal(payload.products.length, 1);
      const product = payload.products[0];
      assert.equal(product.title, plan.title);
      assert.equal(product.price, plan.amount);
      assert.equal(product.qty, 1);
      assert.equal(product.description, plan.description);
      assert.equal(product.isDigital, true);
    }
  });
});

describe("Paylink Webhook Authorization & Verification", () => {
  const originalEnv = process.env.PAYLINK_WEBHOOK_TOKEN;

  before(() => {
    process.env.PAYLINK_WEBHOOK_TOKEN = "secret_webhook_token_12345";
  });

  after(() => {
    if (originalEnv !== undefined) {
      process.env.PAYLINK_WEBHOOK_TOKEN = originalEnv;
    } else {
      delete process.env.PAYLINK_WEBHOOK_TOKEN;
    }
  });

  it("accepts valid Bearer authorization header", () => {
    const req = new Request("https://nasaq-sa.vercel.app/api/webhooks/paylink", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret_webhook_token_12345",
      },
    });
    assert.equal(verifyPaylinkWebhookAuthorization(req), true);
  });

  it("rejects invalid or missing authorization header", () => {
    const wrong = new Request("https://nasaq-sa.vercel.app/api/webhooks/paylink", {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong_token",
      },
    });
    assert.equal(verifyPaylinkWebhookAuthorization(wrong), false);

    const missing = new Request("https://nasaq-sa.vercel.app/api/webhooks/paylink", {
      method: "POST",
    });
    assert.equal(verifyPaylinkWebhookAuthorization(missing), false);
  });
});

describe("Paylink Transaction Claims & Idempotency in Database", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  const USER_ID = "usr_test_paylink";

  before(async () => {
    ({ sql, close } = await createTestSql());
    await createUser(sql, { id: USER_ID, email: "paylink_user@example.com" });
  });

  after(async () => {
    await close();
  });

  it("claims a PENDING transaction and prevents duplicate fulfillment", async () => {
    const transactionNo = `tx_${Date.now()}`;
    const orderNumber = `ORD-${Date.now()}`;
    const plan = CENTRAL_PLANS["individual-monthly"];

    await sql`
      insert into paylink_transactions
        (id, user_id, order_number, transaction_no, plan_key, plan_id, amount, currency, status)
      values
        (${`pay_${randomUUID()}`}, ${USER_ID}, ${orderNumber}, ${transactionNo},
         ${plan.key}, ${plan.key}, ${plan.amount}, 'SAR', 'PENDING')
    `;

    // 1. Initial lookup
    const initial = await findPaylinkTransactionByNumber(sql, transactionNo);
    assert.ok(initial);
    assert.equal(initial.status, "PENDING");
    assert.equal(initial.amount, "79.00");

    // 2. First claim succeeds
    const claimed = await claimPaylinkTransaction(sql, transactionNo);
    assert.ok(claimed);
    assert.equal(claimed.status, "PROCESSING");

    // 3. Concurrent/duplicate claim returns null
    const secondClaim = await claimPaylinkTransaction(sql, transactionNo);
    assert.equal(secondClaim, null);

    // 4. Mark completed with license record
    await recordPaylinkLicense(sql, {
      transactionNo,
      licenseId: "lic_123",
      keygenLicenseId: "kg_456",
      licenseKeyPrefix: "NASAQ-INDIVIDU",
      entitlementExpiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    await completePaylinkTransaction(sql, transactionNo);

    // 5. Subsequent claim on PAID transaction fails (idempotent)
    const claimAfterPaid = await claimPaylinkTransaction(sql, transactionNo);
    assert.equal(claimAfterPaid, null);

    const finalState = await findPaylinkTransactionByNumber(sql, transactionNo);
    assert.ok(finalState);
    assert.equal(finalState.status, "PAID");
    assert.equal(finalState.licenseId, "lic_123");
    assert.equal(finalState.keygenLicenseId, "kg_456");
  });
});

describe("Paylink Webhook V2 contract", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  const USER_ID = "usr_test_paylink_v2";

  before(async () => {
    ({ sql, close } = await createTestSql());
    await createUser(sql, { id: USER_ID, email: "paylink_v2@example.com" });
  });

  after(async () => {
    await close();
  });

  it("publishes the V2 endpoint the merchant registers in My Paylink", () => {
    assert.equal(PAYLINK_WEBHOOK_API_VERSION, "v2");
    assert.equal(PAYLINK_WEBHOOK_PATH, "/api/webhooks/paylink");
    assert.match(paylinkWebhookUrl(), /\/api\/webhooks\/paylink$/);
  });

  it("stores the V2 callback envelope (paymentType, merchant block, paidAt)", async () => {
    const transactionNo = `tx_v2_${Date.now()}`;
    const orderNumber = `ORD-V2-${Date.now()}`;
    const plan = CENTRAL_PLANS["team-quarterly"];

    await sql`
      insert into paylink_transactions
        (id, user_id, order_number, transaction_no, plan_key, plan_id, amount, currency, status)
      values
        (${`pay_${randomUUID()}`}, ${USER_ID}, ${orderNumber}, ${transactionNo},
         ${plan.key}, ${plan.key}, ${plan.amount}, 'SAR', 'PENDING')
    `;

    await recordPaylinkWebhook(sql, {
      transactionNo,
      apiVersion: "v2",
      paymentType: "mada",
      merchantOrderNumber: orderNumber,
      merchantMobile: "966555123456",
      paid: true,
    });

    const row = await findPaylinkTransactionByNumber(sql, transactionNo);
    assert.ok(row);
    assert.equal(row.apiVersion, "v2");
    assert.equal(row.paymentType, "mada");
    assert.equal(row.merchantOrderNumber, orderNumber);
    assert.equal(row.merchantMobile, "966555123456");
    assert.ok(row.paidAt, "paidAt is stamped once Paylink confirms settlement");
    // The envelope write must not itself fulfil anything.
    assert.equal(row.status, "PENDING");
  });

  it("is a no-op for an unknown transaction number", async () => {
    await recordPaylinkWebhook(sql, {
      transactionNo: "tx-does-not-exist",
      apiVersion: "v2",
      paymentType: null,
      merchantOrderNumber: null,
      merchantMobile: null,
      paid: false,
    });
    const row = await findPaylinkTransactionByNumber(sql, "tx-does-not-exist");
    assert.equal(row, null);
  });
});
