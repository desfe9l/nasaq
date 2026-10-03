import { createFileRoute } from "@tanstack/react-router";
import { deactivateLicenseFn } from "@/lib/license/functions";
import { respondLicense } from "@/lib/license/api.server";

export const Route = createFileRoute("/api/license/deactivate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        return respondLicense(deactivateLicenseFn({ data: { key } }), (r) => (r.success ? 200 : 400));
      },
    },
  },
});
