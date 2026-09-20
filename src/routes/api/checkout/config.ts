import { createFileRoute } from "@tanstack/react-router";

function value(name: string): string | null {
  const result = process.env[name]?.trim();
  return result || null;
}

function checkoutUrl(name: string): string | null {
  const candidate = value(name);
  if (!candidate) return null;
  try {
    return new URL(candidate).protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/checkout/config")({
  server: {
    handlers: {
      GET: async () => Response.json({
        individual: {
          monthly: {
            variantId: value("LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID"),
            checkoutUrl: checkoutUrl("LEMONSQUEEZY_INDIVIDUAL_MONTHLY_CHECKOUT_URL"),
          },
          quarterly: {
            variantId: value("LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID"),
            checkoutUrl: checkoutUrl("LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_CHECKOUT_URL"),
          },
        },
        team: {
          monthly: {
            variantId: value("LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID"),
            checkoutUrl: checkoutUrl("LEMONSQUEEZY_TEAM_MONTHLY_CHECKOUT_URL"),
          },
          quarterly: {
            variantId: value("LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID"),
            checkoutUrl: checkoutUrl("LEMONSQUEEZY_TEAM_QUARTERLY_CHECKOUT_URL"),
          },
        },
      }),
    },
  },
});