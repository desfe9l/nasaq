import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { checkRateLimit } from "@/lib/license/rate-limit";
import {
  gumroadApiConfigured,
  gumroadProductPermalink,
  gumroadStoreBaseUrl,
} from "@/lib/gumroad/config.server";
import {
  GUMROAD_PING_PATH,
} from "@/lib/gumroad/mapping";
import {
  handleGumroadNotification,
  parseGumroadPingBody,
  productionGumroadPipelineDeps,
} from "@/lib/gumroad/ping.server";

/**
 * Gumroad Ping / Resource-subscription endpoint (post-sale notifications).
 *
 * Register in Gumroad (Settings → Advanced → Pings, or API resource
 * subscriptions) as:
 *
 *     POST https://nasaq-sa.vercel.app/api/webhooks/gumroad
 *
 * - POST  — what Gumroad sends. Form-encoded (classic ping) or JSON.
 * - GET   — human/browser health probe; returns 200 with non-secret status so
 *           "is the endpoint live?" never 404s again.
 *
 * Every notification is acknowledged 2xx once recorded. Money is only ever
 * fulfilled after server-side verification against the Gumroad API (or the
 * tokenless license-verify call), never from the ping body alone. Replays are
 * deduplicated; secrets are never logged.
 */
export const Route = createFileRoute("/api/webhooks/gumroad")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          endpoint: "gumroad-ping",
          methods: ["POST"],
          productPermalink: gumroadProductPermalink(),
          storeBaseUrl: gumroadStoreBaseUrl(),
          apiVerification: gumroadApiConfigured() ? "configured" : "needs_setup",
          time: new Date().toISOString(),
        }),
      POST: async ({ request }) => {
        let ip = "";
        try {
          const url = new URL(request.url);
          ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || url.hostname;
        } catch {
          ip = "unknown";
        }
        // Light abuse guard; the real gate is server-side sale verification.
        if (!checkRateLimit("gumroad:ping", ip || "unknown", 120, 60_000)) {
          return Response.json({ received: false, error: "rate_limited" }, { status: 429 });
        }

        const raw = await request.text();
        const fields = parseGumroadPingBody(raw, request.headers.get("content-type"));
        if (!fields) {
          return Response.json({ received: false, error: "invalid_ping" }, { status: 400 });
        }

        const sql = await getSql();
        try {
          const outcome = await handleGumroadNotification(sql, fields, productionGumroadPipelineDeps);
          return Response.json(outcome.body, { status: outcome.status });
        } catch (error) {
          // Transient failure: 5xx so Gumroad retries; the ping was recorded
          // and dedupe makes the retry safe. Never leak internals.
          console.error(`[${GUMROAD_PING_PATH}] processing failed`, error instanceof Error ? error.message : "unknown");
          return Response.json({ received: true, applied: false, error: "processing_failed" }, { status: 500 });
        }
      },
    },
  },
});
