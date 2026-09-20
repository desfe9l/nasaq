import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { planForVariant, verifyLemonMetadata } from "./lemonsqueezy.server.ts";

const names = [
  "LEMONSQUEEZY_STORE_ID",
  "LEMONSQUEEZY_PRODUCT_ID",
  "LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID",
  "LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID",
  "LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID",
  "LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID",
] as const;
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = previous[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configure() {
  process.env.LEMONSQUEEZY_STORE_ID = "store-1";
  process.env.LEMONSQUEEZY_PRODUCT_ID = "1372880";
  process.env.LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID = "2145099";
  process.env.LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID = "2145142";
  process.env.LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID = "2147936";
  process.env.LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID = "2147937";
}

describe("Lemon Squeezy NASAQ variant verification", () => {
  it("maps all configured variants to the correct plan and billing", () => {
    configure();
    assert.deepEqual(planForVariant("2145099"), { plan: "individual-monthly", id: "2145099" });
    assert.deepEqual(planForVariant("2145142"), { plan: "individual-quarterly", id: "2145142" });
    assert.deepEqual(planForVariant("2147936"), { plan: "team-monthly", id: "2147936" });
    assert.deepEqual(planForVariant("2147937"), { plan: "team-quarterly", id: "2147937" });
  });

  it("rejects wrong store, product, and unsupported variants", () => {
    configure();
    assert.equal(verifyLemonMetadata({ store_id: "other", product_id: "1372880", variant_id: "2145099" }), null);
    assert.equal(verifyLemonMetadata({ store_id: "store-1", product_id: "other", variant_id: "2145099" }), null);
    assert.equal(verifyLemonMetadata({ store_id: "store-1", product_id: "1372880", variant_id: "9999999" }), null);
  });
});