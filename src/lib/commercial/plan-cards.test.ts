/**
 * The homepage pricing cards are a *sales* surface: a number that disagrees
 * with the invoice is worse than no number at all. These tests pin the two
 * properties that matter — every amount comes from the catalog, and switching
 * the period moves the amount AND the duration together.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOME_BILLING_PERIODS,
  PERIOD_HINTS,
  PERIOD_LABELS,
  PERIOD_PRICE_LABELS,
  billingPeriodsWithCheckout,
  checkoutKeyFor,
  homePlanCards,
  periodSaving,
  purchasePeriodFromQuery,
} from "./plan-cards.ts";
import { CENTRAL_PLANS, planKeyFor } from "./catalog.ts";

const byName = (cards: ReturnType<typeof homePlanCards>, name: string) => {
  const card = cards.find((c) => c.name === name);
  assert.ok(card, `بطاقة «${name}» مفقودة`);
  return card;
};

describe("Homepage pricing cards", () => {
  it("offers exactly the two purchasable periods Gumroad sells", () => {
    assert.deepEqual([...HOME_BILLING_PERIODS], ["monthly", "quarterly"]);
    assert.deepEqual(PERIOD_LABELS, { monthly: "شهري", quarterly: "3 أشهر" });
    assert.equal(PERIOD_HINTS.quarterly, "أفضل قيمة");
    for (const period of HOME_BILLING_PERIODS) {
      for (const family of ["individual", "team"] as const) {
        // Throws if the period has no purchasable catalog entry.
        assert.ok(CENTRAL_PLANS[planKeyFor(family, period)]);
      }
    }
  });

  it("shows only periods with a live checkout or the exact current membership", () => {
    assert.deepEqual(
      billingPeriodsWithCheckout(["individual-monthly", "team-monthly"]),
      ["monthly"],
    );
    assert.deepEqual(
      billingPeriodsWithCheckout(["team-quarterly"]),
      ["quarterly"],
    );
    assert.deepEqual(
      billingPeriodsWithCheckout([], "individual-quarterly"),
      ["quarterly"],
    );
    assert.deepEqual(
      billingPeriodsWithCheckout(["individual-annual"]),
      [],
    );
  });

  it("ignores unsupported purchase deep links such as annual Gumroad checkout", () => {
    assert.equal(purchasePeriodFromQuery("monthly"), "monthly");
    assert.equal(purchasePeriodFromQuery("quarterly"), "quarterly");
    assert.equal(purchasePeriodFromQuery("annual"), "monthly");
    assert.equal(purchasePeriodFromQuery("yearly"), "monthly");
    assert.equal(purchasePeriodFromQuery(null), "monthly");
  });

  it("quotes the catalog prices for the monthly period", () => {
    const [free, pro, team] = homePlanCards("monthly");
    assert.equal(free.amount, 0);
    assert.equal(free.formattedAmount, "0");
    assert.equal(free.ctaLabel, "ابدأ مجانًا");
    // Permanent Free: the card says so instead of printing a renewal period.
    assert.equal(free.priceSuffix, "دائمًا");
    assert.equal(free.renewalLabel, null);
    assert.equal(free.termLabel.includes("دائمة"), true);
    assert.equal(pro.amount, 79);
    assert.equal(pro.formattedAmount, "79");
    assert.equal(pro.priceSuffix, PERIOD_PRICE_LABELS.monthly);
    assert.equal(team.amount, 199);
    assert.equal(team.formattedAmount, "199");
    // Nothing is discounted from month to month, so no saving is advertised.
    assert.equal(pro.hasSavings, false);
    assert.equal(team.hasSavings, false);
    assert.equal(periodSaving("monthly"), 0);
  });

  it("switches amount, duration and saving together for 3 months", () => {
    const [free, pro, team] = homePlanCards("quarterly");
    assert.equal(free.amount, 0, "الخطة المجانية لا تتأثر بالفترة");
    assert.equal(pro.amount, 199);
    assert.equal(team.amount, 499);
    assert.equal(pro.priceSuffix, PERIOD_PRICE_LABELS.quarterly);
    // The term line follows the price: 30 days never stays under a 90-day price.
    assert.equal(pro.termLabel, "مدة الترخيص 90 يومًا (3 أشهر)");
    assert.equal(team.termLabel, "مدة الترخيص 90 يومًا (3 أشهر)");
    assert.equal(pro.savings, 38);
    assert.equal(team.savings, 98);
    assert.equal(pro.hasSavings, true);
    assert.equal(team.hasSavings, true);
    assert.equal(periodSaving("quarterly"), 38);
    assert.match(homePlanCards("monthly")[1].termLabel, /30 يومًا/);
  });

  it("never re-prices a plan: every card equals its catalog entry", () => {
    for (const period of HOME_BILLING_PERIODS) {
      for (const card of homePlanCards(period)) {
        if (card.kind === "free") continue;
        const plan = CENTRAL_PLANS[card.id as keyof typeof CENTRAL_PLANS];
        assert.equal(card.amount, plan.amount);
        assert.equal(card.formattedAmount, plan.amount.toLocaleString("en-US"));
      }
    }
  });

  it("ribbons the Pro card and checks out only the paid cards", () => {
    const cards = homePlanCards("monthly");
    assert.deepEqual(
      cards.map((c) => c.featured),
      [false, true, false],
    );
    assert.deepEqual(
      cards.map((c) => c.ctaLabel),
      ["ابدأ مجانًا", "اشترك الآن", "اشترك الآن"],
    );
    assert.equal(checkoutKeyFor(cards[0]), null);
    assert.equal(checkoutKeyFor(cards[1]), "individual-monthly");
    assert.equal(checkoutKeyFor(cards[2]), "team-monthly");
    // The ribbon follows the plan family, not the period: it never jumps cards
    // when the buyer switches «شهري» ↔ «3 أشهر».
    assert.equal(byName(homePlanCards("quarterly"), "فريق — Team").featured, false);
    assert.equal(byName(homePlanCards("quarterly"), "فردي — Pro").featured, true);
  });

  it("never exposes an unsupported annual billing period", () => {
    assert.equal(HOME_BILLING_PERIODS.includes("annual" as never), false);
    assert.deepEqual(billingPeriodsWithCheckout(["individual-annual", "team-annual"]), []);
    assert.deepEqual(homePlanCards("monthly").map((card) => card.id), [
      "free",
      "individual-monthly",
      "team-monthly",
    ]);
  });
});
