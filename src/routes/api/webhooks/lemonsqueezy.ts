import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { applyLemonWebhook } from "@/lib/license/server";

function webhookSecret(): string | null {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  return secret || null;
}

function signatureMatches(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature.trim(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function statusForEvent(event: string): "ACTIVE" | "EXPIRED" | "REVOKED" {
  if (event.includes("disabled") || event.includes("deactivated")) return "REVOKED";
  if (event.includes("expired") || event.includes("refund")) return "EXPIRED";
  if (event.includes("cancel") && !event.includes("resum")) return "ACTIVE";
  return "ACTIVE";
}

export const Route = createFileRoute("/api/webhooks/lemonsqueezy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const secret = webhookSecret();
        if (!secret) return Response.json({ error: "Webhook signing secret is not configured" }, { status: 503 });
        if (!signatureMatches(raw, request.headers.get("x-signature"), secret)) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }
        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const event = String(payload?.meta?.event_name || "").toLowerCase();
        const attributes = payload?.data?.attributes || {};
        const dataId = String(payload?.data?.id || "");
        const eventId = String(payload?.meta?.webhook_id || payload?.meta?.event_id || `${event}:${payload?.data?.type || ""}:${dataId}:${attributes.updated_at || ""}`);
        const orderId = String(attributes.order_id || "");
        const expiresAt = attributes.renews_at || attributes.ends_at || attributes.expires_at || null;
        const applied = await applyLemonWebhook({ eventId, orderId, expiresAt, status: statusForEvent(event) });
        return Response.json({ received: true, applied }, { status: 200 });
      },
    },
  },
});
