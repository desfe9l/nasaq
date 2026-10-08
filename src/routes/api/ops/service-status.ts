import { createFileRoute } from "@tanstack/react-router";
import { SERVICE_IDS } from "@/lib/control-plane/schema";

/**
 * Safe service health. No quotas, no actor ids, no credentials.
 * A database failure is reported on the database service; it does not 500
 * the rest of the status document.
 */
export const Route = createFileRoute("/api/ops/service-status")({
  server: {
    handlers: {
      GET: async () => {
        const { loadPublicOperational } = await import("@/lib/control-plane/store.server");
        const { deriveServiceHealth } = await import("@/lib/control-plane/decisions");
        const { currentProviderProbes, enforcementPlane } = await import("@/lib/control-plane/snapshot");
        const view = await loadPublicOperational();
        const health = deriveServiceHealth(enforcementPlane(), currentProviderProbes());
        const services = SERVICE_IDS.map((id) => ({
          id,
          enabled: view.services[id].enabled,
          maintenance: view.services[id].maintenance,
          status: health[id].status,
          reason: health[id].reason,
        }));
        return new Response(
          JSON.stringify({ revision: view.revision, services }),
          {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
