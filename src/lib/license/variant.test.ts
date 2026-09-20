import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NASAQ_VARIANT_IDS, billingForPlan, planForVariantId } from "./variant.ts";

describe("NASAQ Lemon Squeezy variant mapping", () => {
  it("maps all four production variants", () => {
    assert.deepEqual(planForVariantId("2145099", NASAQ_VARIANT_IDS), { plan: "individual-monthly", id: "2145099" });
    assert.deepEqual(planForVariantId("2145142", NASAQ_VARIANT_IDS), { plan: "individual-quarterly", id: "2145142" });
    assert.deepEqual(planForVariantId("2147936", NASAQ_VARIANT_IDS), { plan: "team-monthly", id: "2147936" });
    assert.deepEqual(planForVariantId("2147937", NASAQ_VARIANT_IDS), { plan: "team-quarterly", id: "2147937" });
  });

  it("derives billing and rejects unsupported variants", () => {
    assert.equal(billingForPlan("individual-monthly"), "monthly");
    assert.equal(billingForPlan("individual-quarterly"), "quarterly");
    assert.equal(billingForPlan("team-monthly"), "monthly");
    assert.equal(billingForPlan("team-quarterly"), "quarterly");
    assert.equal(planForVariantId("9999999", NASAQ_VARIANT_IDS), null);
  });
});