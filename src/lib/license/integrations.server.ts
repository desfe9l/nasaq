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
  const paylink = {
    credentials: configured("PAYLINK_API_ID") && configured("PAYLINK_SECRET_KEY"),
    webhookToken: configured("PAYLINK_WEBHOOK_TOKEN"),
    publicUrl: configured("PAYLINK_PUBLIC_URL") || configured("BETTER_AUTH_URL"),
  };
  return {
    keygen,
    paylink,
    checkoutConfigured: keygen.token && keygen.webhookSignature && !missingPolicies.length &&
      paylink.credentials && paylink.webhookToken && paylink.publicUrl,
    // Registration of webhooks in the providers' own portals is NOT knowable
    // from env presence or an API ping. The UI says so explicitly.
  };
}
