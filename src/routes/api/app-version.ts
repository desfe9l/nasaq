import { createFileRoute } from "@tanstack/react-router";
import { APP_BUILD_ID } from "@/lib/app-build";

/**
 * Which build this deployment serves.
 *
 * The document is the only unversioned URL in the chain, so a page that is
 * still open — or replayed from the back/forward cache — can be running an
 * older bundle than the deployment it is talking to. `AppUpdateNotice` asks
 * this endpoint and replaces the page when the two disagree
 * (`src/lib/app-update.ts`).
 *
 * `no-store` is deliberate: a cached answer would be exactly as stale as the
 * document it is meant to correct.
 */
export const Route = createFileRoute("/api/app-version")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ buildId: APP_BUILD_ID }), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        }),
    },
  },
});
