import { createFileRoute } from "@tanstack/react-router";
import { deactivateLicenseFn } from "@/lib/license/functions";

export const Route = createFileRoute("/api/license/deactivate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        const result = await deactivateLicenseFn({ data: { key } });
        return Response.json(result, { status: result.success ? 200 : 400 });
      },
    },
  },
});
