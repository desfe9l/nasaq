import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_PLAN,
  getCatalogPlan,
  isValidPlanKey,
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
  getPlan,
  getPurchasablePlan,
  listEnabledPlans,
  updatePlan,
} from "./plans.server.ts";

describe("Final pricing contract", () => {
  it("has permanent Free and exactly four supported paid prices/products", () => {
    assert.equal(FREE_PLAN.permanent, true);
    assert.deepEqual(Object.values(FREE_PLAN.prices), [0, 0]);
    const plans = listCatalogPlans();
    assert.deepEqual(
      plans.map((p) => p.amount),
      [79, 199, 199, 499],
    );
    assert.equal(new Set(plans.map((p) => p.productId)).size, 4);
    assert.equal(new Set(plans.map((p) => p.priceId)).size, 4);
    assert.deepEqual(plans.map((plan) => plan.key), [
      "individual-monthly",
      "individual-quarterly",
      "team-monthly",
      "team-quarterly",
    ]);
    for (const retiredAnnualKey of ["individual-annual", "team-annual"]) {
      assert.equal(isValidPlanKey(retiredAnnualKey), false);
      assert.equal(getCatalogPlan(retiredAnnualKey), null);
    }
    assert.throws(() => planKeyFor("individual", "annual" as never));
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
    // Gumroad reads `variant=` (tier name) — `tier=` is ignored by Gumroad and
    // would silently open the default tier's price.
    const monthly = gumroadCheckoutUrl("individual-monthly");
    assert.ok(monthly.includes("monthly=true"));
    assert.ok(monthly.includes("variant="));
    assert.ok(!monthly.includes("tier="));
    assert.ok(!gumroadCheckoutUrl("team-quarterly").includes("monthly=true"));
  });

  it("migrates only supported prices and rejects stale annual DB rows", async () => {
    const { sql, close } = await createTestSql();
    try {
      assert.equal((await listEnabledPlans(sql)).length, 4);
      assert.equal(await getPurchasablePlan(sql, "monthly"), null);
      assert.equal(await getPurchasablePlan(sql, "annual"), null);
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
      for (const id of ["individual-annual", "team-annual"]) {
        await sql`
          insert into plans (id, name, arabic_name, price, duration_days)
          values (${id}, ${id}, ${id}, 999, 365)
        `;
        assert.equal(await getCatalogPlan(id), null);
        assert.equal(await getPlan(sql, id), null);
        assert.equal(await getPurchasablePlan(sql, id), null);
        await assert.rejects(updatePlan(sql, id, { price: "1" }));
      }
      assert.equal((await listEnabledPlans(sql)).length, 4);
    } finally {
      await close();
    }
  });
});
