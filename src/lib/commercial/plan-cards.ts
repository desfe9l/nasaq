/**
 * The homepage pricing section's view model — pure, catalog-driven, and
 * unit-tested without a DOM (`plan-cards.test.ts`).
 *
 * Why a module and not inline JSX: the section has to be *correct*, not just
 * pretty. Three things can silently go wrong in a component that writes prices
 * by hand, and all three are decisions this file makes once:
 *
 * 1. **A price can drift from the invoice.** Every amount, duration and saving
 *    below is read from `CENTRAL_PLANS` — the same catalog `/purchase` sells
 *    from and the payment gateway charges. A card can therefore never quote a
 *    number the buyer is not actually billed (the catalog test enforces the
 *    same rule server-side).
 * 2. **A period switch can leave a stale duration behind.** Switching between
 *    «شهري» and «3 أشهر» rebuilds the whole card set, so the amount *and* the
 *    term line ("30 يومًا" ↔ "90 يومًا") always move together.
 * 3. **A "free" plan can acquire an expiry.** `FREE_PLAN.permanent` is
 *    permanent by contract, so the free card is rendered from that constant
 *    rather than from a discounted paid plan.
 *
 * Presentation choices that are *not* catalog facts (the homepage card names,
 * the three-bullet feature summaries, which card wears the «الأكثر شعبية»
 * ribbon) live here as named constants, clearly separated from the pricing.
 */

import {
  CENTRAL_PLANS,
  FREE_PLAN,
  planKeyFor,
  planSavings,
  type CatalogPlan,
  type PlanFamily,
  type PlanKey,
} from "./catalog.ts";

/**
 * The two periods the homepage switcher offers. `annual` exists in the catalog
 * but has no Gumroad tier, so offering it here would quote a plan the buyer
 * cannot check out — the same availability rule `/purchase` follows.
 */
export type SwitchablePeriod = "monthly" | "quarterly";

export const HOME_BILLING_PERIODS: readonly SwitchablePeriod[] = [
  "monthly",
  "quarterly",
];

/** Only expose a billing period when checkout is live for a tier, or the user
 * already holds that exact plan and needs its account-management shortcut. */
export function billingPeriodsWithCheckout(
  planKeys: Iterable<string>,
  currentPlanKey?: string | null,
): SwitchablePeriod[] {
  const available = new Set(planKeys);
  if (currentPlanKey) available.add(currentPlanKey);
  return HOME_BILLING_PERIODS.filter((period) =>
    (["individual", "team"] as const).some((family) =>
      available.has(planKeyFor(family, period)),
    ),
  );
}

/** Unsupported/legacy deep links never select a plan with no live checkout. */
export function purchasePeriodFromQuery(value: string | null): SwitchablePeriod {
  return HOME_BILLING_PERIODS.find((period) => period === value) ?? "monthly";
}

/** Switcher button labels — the two words a buyer scans for. */
export const PERIOD_LABELS: Record<SwitchablePeriod, string> = {
  monthly: "شهري",
  quarterly: "3 أشهر",
};

/** The small note under each switcher option. */
export const PERIOD_HINTS: Record<SwitchablePeriod, string> = {
  monthly: "تجديد شهري",
  quarterly: "أفضل قيمة",
};

/** The `/ شهرياً` suffix printed next to the amount. */
export const PERIOD_PRICE_LABELS: Record<SwitchablePeriod, string> = {
  monthly: "شهرياً",
  quarterly: "كل 3 أشهر",
};

export const PERIOD_RENEWAL_LABELS: Record<SwitchablePeriod, string> = {
  monthly: "تجديد شهري",
  quarterly: "تجديد كل 3 أشهر",
};

/**
 * The flagship plan of this section: the Pro card wears the «الأكثر شعبية»
 * ribbon and the brand border. This is a *presentation* decision about the
 * homepage summary — the catalog's own `popular` flag stays the authority for
 * the badge on `/purchase`, and neither one rewrites the other's data.
 */
const FEATURED_FAMILY: PlanFamily = "individual";

export type HomePlanCard = {
  /** `free` for the permanent plan, otherwise the catalog key being quoted. */
  id: "free" | PlanKey;
  name: string;
  description: string;
  /** Catalog amount in SAR; 0 for the free plan. */
  amount: number;
  /** Amount with the Latin thousands separator, e.g. `1,799`. */
  formattedAmount: string;
  /** The `/ شهرياً` suffix next to the amount. */
  priceSuffix: string;
  /** The term line under the amount, e.g. `مدة الترخيص 90 يومًا (3 أشهر)`. */
  termLabel: string;
  /** The renewal line, or null when the plan never renews (free). */
  renewalLabel: string | null;
  /** SAR saved against paying the same plan month by month; 0 for monthly. */
  savings: number;
  /** True when the saving is worth printing. */
  hasSavings: boolean;
  features: readonly string[];
  /** Wears the «الأكثر شعبية» ribbon. */
  featured: boolean;
  kind: "free" | "paid";
  /** Label of the card's action button. */
  ctaLabel: string;
  /** The line under the action button. */
  ctaHint: string;
};

/** Homepage copy for the two paid families (the catalog owns the numbers). */
const FAMILY_COPY: Record<
  PlanFamily,
  { name: string; description: string; features: readonly string[] }
> = {
  individual: {
    name: "فردي — Pro",
    description: "للمصممين والأفراد",
    features: [
      "تصدير حتى 384 DPI",
      "القوالب الكاملة",
      "هوية مؤسسية كاملة",
    ],
  },
  team: {
    name: "فريق — Team",
    description: "للفرق ومجموعات العمل",
    features: [
      "كل مزايا Pro",
      "مساحة عمل مشتركة",
      "دعم بأولوية",
    ],
  },
};

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US");
}

function termLabelFor(plan: CatalogPlan, period: SwitchablePeriod): string {
  return period === "quarterly"
    ? `مدة الترخيص ${plan.durationDays} يومًا (3 أشهر)`
    : `مدة الترخيص ${plan.durationDays} يومًا`;
}

function paidCard(
  family: PlanFamily,
  period: SwitchablePeriod,
): HomePlanCard {
  const planKey = planKeyFor(family, period);
  const plan = CENTRAL_PLANS[planKey];
  const copy = FAMILY_COPY[family];
  const savings = planSavings(plan);
  return {
    id: planKey,
    name: copy.name,
    description: copy.description,
    amount: plan.amount,
    formattedAmount: formatAmount(plan.amount),
    priceSuffix: PERIOD_PRICE_LABELS[period],
    termLabel: termLabelFor(plan, period),
    renewalLabel: PERIOD_RENEWAL_LABELS[period],
    savings,
    hasSavings: period !== "monthly" && savings > 0,
    features: copy.features,
    featured: family === FEATURED_FAMILY,
    kind: "paid",
    ctaLabel: "اشترك الآن",
    ctaHint: "الدفع عبر Gumroad · ترخيص بعد التحقق"
  };
}

function freeCard(): HomePlanCard {
  // Priced from the catalog's free tier, never derived from a discounted paid
  // plan: `permanent` is exactly what makes the card's "دائمًا" claim true, and
  // it is a catalog contract, not a marketing line.
  return {
    id: "free",
    name: "مجاني",
    description: "للتقييم والبدء",
    amount: FREE_PLAN.prices.monthly,
    formattedAmount: formatAmount(FREE_PLAN.prices.monthly),
    priceSuffix: FREE_PLAN.permanent ? "دائمًا" : "شهريًا",
    termLabel: FREE_PLAN.permanent
      ? "مجانية دائمة — بلا تاريخ انتهاء"
      : "مجانية بحدود المزايا الأساسية",
    renewalLabel: null,
    savings: 0,
    hasSavings: false,
    features: ["أدوات أساسية", "حفظ محلي", "تصدير 72 DPI"],
    featured: false,
    kind: "free",
    ctaLabel: "ابدأ مجانًا",
    ctaHint: "بلا بطاقة بنكية",
  };
}

/**
 * The three homepage cards for a billing period: Free, Pro, Team — always in
 * that order, with Free first because it is the plan every visitor can take.
 */
export function homePlanCards(period: SwitchablePeriod): HomePlanCard[] {
  return [freeCard(), paidCard("individual", period), paidCard("team", period)];
}

/** The plan key a card's «اشترك الآن» button checks out, or null for Free. */
export function checkoutKeyFor(card: HomePlanCard): PlanKey | null {
  return card.kind === "paid" ? (card.id as PlanKey) : null;
}

/**
 * The saving the *switcher* can advertise for a period: what the buyer keeps
 * by paying `period` up front instead of month by month, on the Pro plan.
 */
export function periodSaving(period: SwitchablePeriod): number {
  if (period === "monthly") return 0;
  return planSavings(CENTRAL_PLANS[planKeyFor(FEATURED_FAMILY, period)]);
}
