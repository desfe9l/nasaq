import { createFileRoute } from "@tanstack/react-router";
import { activateLicenseFn } from "@/lib/license/functions";
import { respondLicense } from "@/lib/license/api.server";

export const Route = createFileRoute("/api/license/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        // Identity is resolved by authMiddleware from the session, never JSON.
        return respondLicense(activateLicenseFn({ data: { key } }), (r) => (r.success ? 200 : 400));
      },
    },
  },
});
