/**
 * Better Auth catch-all route: `/api/auth/*`.
 *
 * This is what makes sign-in work at all — without it every `/api/auth/*` request
 * (including `get-session`) falls through to the SPA and 404s, which is exactly
 * what `authClient.useSession()` would report as "always signed out".
 *
 * `auth.handler` is the whole Better Auth HTTP surface: sign-in, sign-out, the
 * OAuth callback, and session reads. We forward the incoming Request unchanged so
 * cookies and headers (including the preview's bearer token) reach it intact.
 *
 * Server-only by construction: `server.ts` imports `pg`, the preview secret and
 * Better Auth's Node internals, none of which may reach the browser.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      // One handler for every method: Better Auth dispatches internally on
      // method + path, so listing them individually would only add drift.
      ANY: async ({ request }: { request: Request }) => {
        const { auth } = await import("@/lib/auth/server");
        return auth.handler(request);
      },
    },
  },
});
