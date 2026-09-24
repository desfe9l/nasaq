import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_PLAN,
  listCatalogPlans,
  paylinkPlanKey,
  requireCatalogPlan,
  planSavings,
} from "./catalog.ts";
import {
  checkoutAvailability,
  createPaylinkInvoice,
  buildPaylinkInvoicePayload,
} from "../paylink/server.ts";
import { createTestSql } from "./test-db.ts";
import {
  getPurchasablePlan,
  listEnabledPlans,
  updatePlan,
} from "./plans.server.ts";

describe("Final pricing contract", () => {
  it("has permanent Free and exactly six unique paid prices/products", () => {
    assert.equal(FREE_PLAN.permanent, true);
    assert.deepEqual(Object.values(FREE_PLAN.prices), [0, 0, 0]);
    const plans = listCatalogPlans();
    assert.deepEqual(
      plans.map((p) => p.amount),
      [79, 199, 199, 499, 699, 1799],
    );
    assert.equal(new Set(plans.map((p) => p.productId)).size, 6);
    assert.equal(new Set(plans.map((p) => p.priceId)).size, 6);
    for (const p of plans) {
      assert.equal(paylinkPlanKey(p.family, p.period), p.key);
      const payload = buildPaylinkInvoicePayload({
        plan: { ...requireCatalogPlan(p.key), amount: 1 },
        orderNumber: "TEST",
        publicUrl: "https://example.com",
        clientName: "Test",
        clientEmail: null,
        clientMobile: "0501234567",
      });
      assert.equal(payload.amount, p.amount);
    }
    assert.equal(planSavings(requireCatalogPlan("individual-quarterly")), 38);
    assert.equal(planSavings(requireCatalogPlan("team-quarterly")), 98);
    assert.throws(() => requireCatalogPlan("free"));
    assert.throws(() => requireCatalogPlan("monthly"));
  });

  it("does not create a transaction or contact a gateway when unconfigured", async () => {
    const previous = process.env.PAYLINK_API_ID;
    delete process.env.PAYLINK_API_ID;
    try {
      assert.ok(Object.values(checkoutAvailability()).every((v) => !v));
      const sql = (() => {
        throw new Error("must not write");
      }) as never;
      const result = await createPaylinkInvoice({
        sql,
        userId: "test",
        userName: null,
        userEmail: null,
        planKey: "individual-annual",
        clientMobile: "0501234567",
      });
      assert.equal(result.ok, false);
    } finally {
      if (previous === undefined) delete process.env.PAYLINK_API_ID;
      else process.env.PAYLINK_API_ID = previous;
    }
  });

  it("migrates all prices, rejects legacy/free purchases and ignores stale DB prices", async () => {
    const { sql, close } = await createTestSql();
    try {
      assert.equal((await listEnabledPlans(sql)).length, 6);
      assert.equal(await getPurchasablePlan(sql, "monthly"), null);
      assert.equal(await getPurchasablePlan(sql, "free"), null);
      for (const plan of listCatalogPlans()) {
        const rows = await sql<{
          price: string;
        }>`select price from plans where id = ${plan.key}`;
        assert.equal(Number(rows[0].price), plan.amount);
        assert.equal(
          Number((await getPurchasablePlan(sql, plan.key))!.price),
          plan.amount,
        );
      }
      await sql`update plans set price = 1 where id = 'individual-annual'`;
      assert.equal(
        (await getPurchasablePlan(sql, "individual-annual"))!.price,
        "699",
      );
      await assert.rejects(
        updatePlan(sql, "individual-annual", { price: "1" }),
      );
    } finally {
      await close();
    }
  });
});
