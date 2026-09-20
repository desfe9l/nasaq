import { createFileRoute } from "@tanstack/react-router";
import { activateLicenseFn } from "@/lib/license/functions";

export const Route = createFileRoute("/api/license/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        const userId = typeof body?.userId === "string" ? body.userId : undefined;
        const email = typeof body?.email === "string" ? body.email : undefined;
        const result = await activateLicenseFn({ data: { key, userId, email } });
        return Response.json(result, { status: result.success ? 200 : 400 });
      },
    },
  },
});
