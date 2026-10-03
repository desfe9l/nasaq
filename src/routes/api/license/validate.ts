import { createFileRoute } from "@tanstack/react-router";
import { validateLicenseFn } from "@/lib/license/functions";
import { respondLicense } from "@/lib/license/api.server";

export const Route = createFileRoute("/api/license/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const key = typeof body?.key === "string" ? body.key : "";
        return respondLicense(validateLicenseFn({ data: { key } }), (r) => (r.valid ? 200 : 400));
      },
    },
  },
});
