import { createFileRoute } from "@tanstack/react-router";
import { activateLicenseFn } from "@/lib/license/functions";

export const Route = createFileRoute("/api/license/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        const email = typeof body?.email === "string" ? body.email : undefined;
        const result = await activateLicenseFn({ data: { key, email } });
        return Response.json(result, { status: result.success ? 200 : 400 });
      },
    },
  },
});
