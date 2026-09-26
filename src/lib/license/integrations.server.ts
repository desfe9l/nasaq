import { listCatalogPlans } from "@/lib/commercial/catalog";
import { keygenPolicyId } from "./keygen.ts";

/** Configuration presence only. Never send credentials or provider responses to a browser. */
export function licensingIntegrationReadiness() {
  const configured = (name: string) => Boolean(process.env[name]?.trim());
  const missingPolicies = listCatalogPlans()
    .filter((plan) => !keygenPolicyId(plan.keygenPolicyKey))
    .map((plan) => plan.key);
  const keygen = {
    token: configured("KEYGEN_API_TOKEN"),
    webhookSignature: configured("KEYGEN_PUBLIC_KEY"),
    missingPolicies,
  };
  // Gumroad is the payment gateway. Only presence flags are reported; the
  // access token itself never leaves the server.
  const gumroad = {
    accessToken: configured("GUMROAD_ACCESS_TOKEN"),
    productId: configured("GUMROAD_PRODUCT_ID"),
    pingEndpoint: "/api/webhooks/gumroad",
  };
  return {
    keygen,
    gumroad,
    checkoutConfigured: keygen.token && keygen.webhookSignature && !missingPolicies.length &&
      gumroad.accessToken && gumroad.productId,
    // Registration of webhooks in the providers' own portals is NOT knowable
    // from env presence or an API ping. The UI says so explicitly.
  };
}
