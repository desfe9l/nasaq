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
] as const;

export type PaylinkPlanKey = (typeof PAYLINK_PLAN_KEYS)[number];
export type PaylinkPlanFamily = "individual" | "team";
export type PaylinkPeriod = "monthly" | "quarterly";

export interface CatalogPlan {
  readonly key: PaylinkPlanKey;
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
    family: "individual",
    period: "quarterly",
    name: "NASAQ Individual Quarterly",
    arabicName: "ترخيص فردي - ربع سنوي (3 أشهر)",
    title: "ترخيص نَسَق فردي ربع سنوي (Digital License)",
    description: "ترخيص رقمي فردي لمنصة نَسَق - وصول كامل لمدة 90 يومًا (3 أشهر)",
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
    family: "team",
    period: "quarterly",
    name: "NASAQ Team Quarterly",
    arabicName: "ترخيص فريق - ربع سنوي (3 أشهر)",
    title: "ترخيص نَسَق فريق عمل ربع سنوي (Digital License)",
    description: "ترخيص رقمي لفرق العمل لمنصة نَسَق - وصول كامل لمدة 90 يومًا (3 أشهر)",
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

export function paylinkPlanKey(family: PaylinkPlanFamily, period: PaylinkPeriod): PaylinkPlanKey {
  const key = `${family}-${period}`;
  if (isValidPlanKey(key)) return key;
  throw new Error(`خطة غير معروفة: ${key}`);
}

export function listCatalogPlans(): CatalogPlan[] {
  return Object.values(CENTRAL_PLANS).sort((a, b) => a.sortOrder - b.sortOrder);
}
