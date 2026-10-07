/**
 * `/api/auth/*` — the first-party authentication endpoints.
 *
 * This route is what makes sign-in work at all: without it every auth request
 * (including `get-session`) falls through to the SPA and 404s, which a session
 * hook reports as "always signed out". The whole surface is one handler
 * (`http.server.ts`), so there is exactly one place that sets cookies, checks
 * the request origin, and decides what a failure looks like.
 *
 * The handler never throws: a storage outage answers 503 with a stable code
 * instead of a 500 stack trace, and a missing configuration answers the same
 * way on every request rather than crashing the module graph at import time.
 *
 * Server-only by construction: it reaches the identity store, the password
 * hasher and server-only environment variables.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      // One handler for every method: the router dispatches on method + path.
      ANY: async ({ request }: { request: Request }) => {
        const { handleAuthRequest } = await import("@/lib/auth/http.server");
        return handleAuthRequest(request);
      },
    },
  },
});
