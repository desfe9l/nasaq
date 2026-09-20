import type { BillingPeriod, LicensePlan } from "./types";

export type VariantPlanMap = Record<LicensePlan, string>;

export const NASAQ_VARIANT_IDS: VariantPlanMap = {
  "individual-monthly": "2145099",
  "individual-quarterly": "2145142",
  "team-monthly": "2147936",
  "team-quarterly": "2147937",
};

export function billingForPlan(plan: LicensePlan): BillingPeriod {
  return plan.endsWith("quarterly") ? "quarterly" : "monthly";
}

export function planForVariantId(variantId: string, variants: VariantPlanMap): { plan: LicensePlan; id: string } | null {
  const entry = (Object.entries(variants) as [LicensePlan, string][]).find(([, id]) => id === variantId);
  return entry ? { plan: entry[0], id: entry[1] } : null;
}