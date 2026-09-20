import { createFileRoute } from "@tanstack/react-router";
import { validateLicenseFn } from "@/lib/license/functions";

export const Route = createFileRoute("/api/license/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        const result = await validateLicenseFn({ data: { key } });
        return Response.json(result, { status: result.valid ? 200 : 400 });
      },
    },
  },
});
