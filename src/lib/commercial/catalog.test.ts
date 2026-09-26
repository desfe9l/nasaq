import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_PLAN,
  listCatalogPlans,
  planKeyFor,
  requireCatalogPlan,
  planSavings,
} from "./catalog.ts";
import {
  GUMROAD_PLAN_PRICE_CENTS,
  gumroadCheckoutUrl,
  listGumroadPlanKeys,
  resolveGumroadPlanKey,
} from "../gumroad/mapping.ts";
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
      assert.equal(planKeyFor(p.family, p.period), p.key);
      // The catalog is the only price source: no component may re-price a plan.
      assert.equal(requireCatalogPlan(p.key).amount, p.amount);
    }
    assert.equal(planSavings(requireCatalogPlan("individual-quarterly")), 38);
    assert.equal(planSavings(requireCatalogPlan("team-quarterly")), 98);
    assert.throws(() => requireCatalogPlan("free"));
    assert.throws(() => requireCatalogPlan("monthly"));
  });

  it("maps the four Gumroad tiers to the exact catalog prices", () => {
    assert.deepEqual(listGumroadPlanKeys(), [
      "individual-monthly",
      "individual-quarterly",
      "team-monthly",
      "team-quarterly",
    ]);
    for (const key of listGumroadPlanKeys()) {
      assert.equal(GUMROAD_PLAN_PRICE_CENTS[key], requireCatalogPlan(key).amount * 100);
    }
    // Tier + recurrence (never display text alone) decides the NASAQ plan.
    assert.equal(
      resolveGumroadPlanKey({ variants: { Tier: "نَسَق | فردي" }, recurrence: "quarterly" }),
      "individual-quarterly",
    );
    assert.equal(
      resolveGumroadPlanKey({ variants: { Tier: "نَسَق | فريق" }, recurrence: "monthly" }),
      "team-monthly",
    );
    // Checkout deep links carry the tier AND the recurrence, monthly by default.
    const monthly = gumroadCheckoutUrl("individual-monthly");
    assert.ok(monthly.includes("monthly=true"));
    assert.ok(monthly.includes("tier="));
    assert.ok(!gumroadCheckoutUrl("team-quarterly").includes("monthly=true"));
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
