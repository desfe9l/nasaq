import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { applyLemonWebhook } from "@/lib/license/server";

function signatureMatches(body: string, signature: string | null): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature.trim(), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function statusForEvent(event: string): "ACTIVE" | "EXPIRED" | "REVOKED" {
  if (event.includes("expired") || event.includes("refund") || event.includes("deactivated")) return "EXPIRED";
  if (event.includes("cancel") && !event.includes("resum")) return "ACTIVE";
  return "ACTIVE";
}

export const Route = createFileRoute("/api/webhooks/lemonsqueezy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (!signatureMatches(raw, request.headers.get("x-signature"))) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }
        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const eventId = String(payload?.meta?.event_id || payload?.meta?.webhook_id || "");
        const event = String(payload?.meta?.event_name || "").toLowerCase();
        const attributes = payload?.data?.attributes || {};
        const orderId = String(attributes.order_id || attributes.order_item_id || "");
        const expiresAt = attributes.renews_at || attributes.ends_at || attributes.expires_at || null;
        const applied = await applyLemonWebhook({ eventId, orderId, expiresAt, status: statusForEvent(event) });
        return Response.json({ received: true, applied }, { status: 200 });
      },
    },
  },
});
