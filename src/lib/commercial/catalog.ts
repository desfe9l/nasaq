/**
 * NASAQ Central Plans Catalog — The Single Source of Truth for Pricing & Fulfillment.
 *
 * All pricing, product metadata, Keygen policy mappings, durations, and invoice
 * line items derive solely from this file. No client input or component may override
 * these prices or durations.
 */

import type { KeygenPlan } from "../license/keygen.ts";

export const PAYLINK_PLAN_KEYS = [
  "individual-monthly",
  "individual-quarterly",
  "team-monthly",
  "team-quarterly",
  "individual-annual",
  "team-annual",
] as const;

export type PaylinkPlanKey = (typeof PAYLINK_PLAN_KEYS)[number];
export type PaylinkPlanFamily = "individual" | "team";
export type PaylinkPeriod = "monthly" | "quarterly" | "annual";

export interface CatalogPlan {
  readonly key: PaylinkPlanKey;
  readonly productId: string;
  readonly priceId: string;
  readonly family: PaylinkPlanFamily;
  readonly period: PaylinkPeriod;
  readonly name: string;
  readonly arabicName: string;
  readonly title: string;
  readonly description: string;
  readonly amount: number;
  readonly currency: "SAR";
  readonly durationDays: number;
  readonly isDigital: true;
  readonly keygenPolicyKey: KeygenPlan;
  readonly features: readonly string[];
  readonly sortOrder: number;
  readonly popular?: boolean;
}

export const CENTRAL_PLANS: Record<PaylinkPlanKey, CatalogPlan> = {
  "individual-monthly": {
    key: "individual-monthly",
    productId: "nasaq-individual-monthly",
    priceId: "nasaq-individual-monthly-sar-v1",
    family: "individual",
    period: "monthly",
    name: "NASAQ Individual Monthly",
    arabicName: "ترخيص فردي - شهري",
    title: "ترخيص نَسَق فردي شهري (Digital License)",
    description: "ترخيص رقمي فردي لمنصة نَسَق - وصول كامل لمدة 30 يومًا",
    amount: 79,
    currency: "SAR",
    durationDays: 30,
    isDigital: true,
    keygenPolicyKey: "individual-monthly",
    features: [
      "القوالب الكاملة المتميزة",
      "تصدير حتى 300 DPI بلا علامة مائية",
      "عدة تطبيقات هوية (Brand Kit) كاملة",
      "قفل العناصر وحماية التصميم",
      "تحديثات النسخة المرخصة",
    ],
    sortOrder: 10,
  },
  "individual-quarterly": {
    key: "individual-quarterly",
    productId: "nasaq-individual-quarterly",
    priceId: "nasaq-individual-quarterly-sar-v1",
    family: "individual",
    period: "quarterly",
    name: "NASAQ Individual Quarterly",
    arabicName: "ترخيص فردي - ربع سنوي (3 أشهر)",
    title: "ترخيص نَسَق فردي ربع سنوي (Digital License)",
    description:
      "ترخيص رقمي فردي لمنصة نَسَق - وصول كامل لمدة 90 يومًا (3 أشهر)",
    amount: 199,
    currency: "SAR",
    durationDays: 90,
    isDigital: true,
    keygenPolicyKey: "individual-quarterly",
    features: [
      "القوالب الكاملة المتميزة",
      "تصدير حتى 300 DPI بلا علامة مائية",
      "عدة تطبيقات هوية (Brand Kit) كاملة",
      "قفل العناصر وحماية التصميم",
      "تحديثات النسخة المرخصة طوال المدة",
      "توفير مقارنة بالاشتراك الشهري",
    ],
    sortOrder: 20,
  },
  "team-monthly": {
    key: "team-monthly",
    productId: "nasaq-team-monthly",
    priceId: "nasaq-team-monthly-sar-v1",
    family: "team",
    period: "monthly",
    name: "NASAQ Team Monthly",
    arabicName: "ترخيص فريق - شهري",
    title: "ترخيص نَسَق فريق عمل شهري (Digital License)",
    description: "ترخيص رقمي لفرق العمل لمنصة نَسَق - وصول كامل لمدة 30 يومًا",
    amount: 199,
    currency: "SAR",
    durationDays: 30,
    isDigital: true,
    keygenPolicyKey: "team-monthly",
    features: [
      "جميع مزايا النسخة المتقدمة",
      "ميزات الفريق ومساحة العمل المشتركة",
      "تفعيل التراخيص عبر أكواد سريعة",
      "استيراد وتصدير حزمة الهوية الموحدة",
      "تصدير PDF عالي الدقة 300 DPI بدون علامة مائية",
      "أولوية الدعم الفني",
    ],
    sortOrder: 30,
  },
  "team-quarterly": {
    key: "team-quarterly",
    productId: "nasaq-team-quarterly",
    priceId: "nasaq-team-quarterly-sar-v1",
    family: "team",
    period: "quarterly",
    name: "NASAQ Team Quarterly",
    arabicName: "ترخيص فريق - ربع سنوي (3 أشهر)",
    title: "ترخيص نَسَق فريق عمل ربع سنوي (Digital License)",
    description:
      "ترخيص رقمي لفرق العمل لمنصة نَسَق - وصول كامل لمدة 90 يومًا (3 أشهر)",
    amount: 499,
    currency: "SAR",
    durationDays: 90,
    isDigital: true,
    keygenPolicyKey: "team-quarterly",
    popular: true,
    features: [
      "جميع مزايا ترخيص الفريق",
      "ميزات الفريق ومساحة العمل المشتركة",
      "تفعيل التراخيص عبر أكواد سريعة",
      "استيراد وتصدير حزمة الهوية الموحدة",
      "تصدير عالي الدقة 300 DPI بدون علامة مائية",
      "أولوية قصوى للدعم الفني",
      "أفضل قيمة وتوفير لفرق العمل",
    ],
    sortOrder: 40,
  },
  "individual-annual": {
    key: "individual-annual",
    productId: "nasaq-individual-annual",
    priceId: "nasaq-individual-annual-sar-v1",
    family: "individual",
    period: "annual",
    name: "NASAQ Individual Annual",
    arabicName: "Pro — فردي — سنوي",
    title: "ترخيص Pro — فردي سنوي",
    description: "ترخيص رقمي لمدة 365 يومًا",
    amount: 699,
    currency: "SAR",
    durationDays: 365,
    isDigital: true,
    keygenPolicyKey: "individual-annual",
    features: [
      "القوالب الكاملة المتميزة",
      "تصدير حتى 300 DPI بلا علامة مائية",
      "تحديثات النسخة المرخصة طوال المدة",
    ],
    sortOrder: 50,
  },
  "team-annual": {
    key: "team-annual",
    productId: "nasaq-team-annual",
    priceId: "nasaq-team-annual-sar-v1",
    family: "team",
    period: "annual",
    name: "NASAQ Team Annual",
    arabicName: "Team — فريق — سنوي",
    title: "ترخيص Team — فريق سنوي",
    description: "ترخيص رقمي لمدة 365 يومًا",
    amount: 1799,
    currency: "SAR",
    durationDays: 365,
    isDigital: true,
    keygenPolicyKey: "team-annual",
    features: [
      "القوالب الكاملة المتميزة",
      "تصدير حتى 300 DPI بلا علامة مائية",
      "تحديثات النسخة المرخصة طوال المدة",
    ],
    sortOrder: 60,
  },
};

export function isValidPlanKey(key: string): key is PaylinkPlanKey {
  return Object.prototype.hasOwnProperty.call(CENTRAL_PLANS, key);
}

export function getCatalogPlan(key: string): CatalogPlan | null {
  if (isValidPlanKey(key)) {
    return CENTRAL_PLANS[key];
  }
  return null;
}

export function requireCatalogPlan(key: string): CatalogPlan {
  const plan = getCatalogPlan(key);
  if (!plan) {
    throw new Error(`خطة غير صالحة: ${key}`);
  }
  return plan;
}

export function paylinkPlanKey(
  family: PaylinkPlanFamily,
  period: PaylinkPeriod,
): PaylinkPlanKey {
  const key = `${family}-${period}`;
  if (isValidPlanKey(key)) return key;
  throw new Error(`خطة غير معروفة: ${key}`);
}

export function listCatalogPlans(): CatalogPlan[] {
  return Object.values(CENTRAL_PLANS).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Free never enters a payment or license-expiry flow. */
export const FREE_PLAN = {
  name: "Free — مجاني",
  permanent: true,
  prices: { monthly: 0, quarterly: 0, annual: 0 },
  features: [
    "أدوات التحرير الأساسية",
    "حفظ المشاريع محليًا",
    "القيود الحالية للمزايا المتقدمة والتصدير",
  ],
} as const;

export const BILLING_PERIODS = [
  { id: "monthly", label: "شهري", months: 1 },
  { id: "quarterly", label: "3 أشهر — أفضل قيمة", months: 3 },
  { id: "annual", label: "سنوي", months: 12 },
] as const;

export function planSavings(plan: CatalogPlan): number {
  const months = BILLING_PERIODS.find((p) => p.id === plan.period)!.months;
  return (
    CENTRAL_PLANS[paylinkPlanKey(plan.family, "monthly")].amount * months -
    plan.amount
  );
}
