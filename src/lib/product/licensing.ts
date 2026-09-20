export type BillingPeriod = "monthly" | "quarterly";
export type PaidPlan = "individual" | "team";

export interface CheckoutConfig {
  variantId?: string;
  checkoutUrl?: string;
}

const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;

function readEnv(key: string): string | undefined {
  return env[key] || env[`VITE_${key}`];
}

export const CHECKOUTS: Record<PaidPlan, Record<BillingPeriod, CheckoutConfig>> = {
  individual: {
    monthly: {
      variantId: readEnv("LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID"),
      checkoutUrl: readEnv("LEMONSQUEEZY_INDIVIDUAL_MONTHLY_CHECKOUT_URL"),
    },
    quarterly: {
      variantId: readEnv("LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID"),
      checkoutUrl: readEnv("LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_CHECKOUT_URL"),
    },
  },
  team: {
    monthly: {
      variantId: readEnv("LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID"),
      checkoutUrl: readEnv("LEMONSQUEEZY_TEAM_MONTHLY_CHECKOUT_URL"),
    },
    quarterly: {
      variantId: readEnv("LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID"),
      checkoutUrl: readEnv("LEMONSQUEEZY_TEAM_QUARTERLY_CHECKOUT_URL"),
    },
  },
};

export const LEMON_SQUEEZY_WHATSAPP_URL = readEnv("LEMONSQUEEZY_WHATSAPP_URL");

export function checkoutFor(plan: PaidPlan, period: BillingPeriod): CheckoutConfig {
  return CHECKOUTS[plan][period];
}

export function isCheckoutConfigured(plan: PaidPlan, period: BillingPeriod): boolean {
  const config = checkoutFor(plan, period);
  return Boolean(config.variantId && config.checkoutUrl);
}
