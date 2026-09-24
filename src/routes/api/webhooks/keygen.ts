import { createFileRoute } from "@tanstack/react-router";
import { applyKeygenWebhook } from "@/lib/license/server";
import { hashLicenseKey, keyPrefix } from "@/lib/license/key";
import {
  planForKeygenPolicy,
  typeForKeygenPolicy,
  verifyKeygenWebhookSignature,
} from "@/lib/license/keygen";
import type { LicenseStatus } from "@/lib/license/types";

function statusForEvent(event: string, suspended: unknown): LicenseStatus {
  if (suspended === true || event.includes("suspended") || event.includes("revoked") || event.includes("deleted")) {
    return "REVOKED";
  }
  if (event.includes("expired")) return "EXPIRED";
  return "ACTIVE";
}

export const Route = createFileRoute("/api/webhooks/keygen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!verifyKeygenWebhookSignature(raw, request)) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let event: any;
        try {
          event = JSON.parse(raw);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const eventId = String(event?.data?.id || "");
        const attributes = event?.data?.attributes || {};
        const eventName = String(attributes.event || "").toLowerCase();
        if (!eventId || !eventName) return Response.json({ received: true, applied: false });

        let payload: any;
        try {
          payload = typeof attributes.payload === "string" ? JSON.parse(attributes.payload) : attributes.payload;
        } catch {
          return Response.json({ error: "Invalid event payload" }, { status: 400 });
        }

        const resource = payload?.data;
        if (resource?.type !== "licenses" || !resource.id) {
          return Response.json({ received: true, applied: false });
        }

        const licenseAttributes = resource.attributes || {};
        const policyId = String(resource.relationships?.policy?.data?.id || "");
        const key = typeof licenseAttributes.key === "string" ? licenseAttributes.key : undefined;
        const plan = planForKeygenPolicy(policyId);
        const metadata = {
          source: "keygen",
          keygenLicenseId: String(resource.id),
          keygenPolicyId: policyId,
          keygenProductId: String(resource.relationships?.product?.data?.id || ""),
          plan: plan || "",
          billing: plan?.endsWith("quarterly") ? "quarterly" : plan?.endsWith("annual") ? "annual" : "monthly",
        };
        const applied = await applyKeygenWebhook({
          eventId,
          licenseId: String(resource.id),
          key,
          keyHash: key ? hashLicenseKey(key) : undefined,
          keyPrefix: key ? keyPrefix(key) : undefined,
          type: typeForKeygenPolicy(policyId),
          status: statusForEvent(eventName, licenseAttributes.suspended),
          expiresAt: typeof licenseAttributes.expiry === "string" ? licenseAttributes.expiry : null,
          metadata,
        });
        return Response.json({ received: true, applied }, { status: 200 });
      },
    },
  },
});
