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
        try {
          return await auth.handler(request);
        } catch (error) {
          console.error("[auth] handler error:", error);
          const message = error instanceof Error ? error.message : String(error);
          const isQuota = /53000|quota/i.test(message);
          const isConn = /53300|too many/i.test(message);
          const status = isQuota || isConn ? 503 : 500;
          return new Response(
            JSON.stringify({
              code: isQuota
                ? "DATABASE_QUOTA_EXCEEDED"
                : isConn
                ? "DATABASE_TOO_MANY_CONNECTIONS"
                : "AUTH_INTERNAL_ERROR",
              message: isQuota
                ? "قاعدة البيانات تجاوزت الحصة المتاحة (Neon Quota Exceeded)."
                : isConn
                ? "قاعدة البيانات تشهد ضغط اتصالات مرتفع."
                : "خطأ غير متوقع في خدمة المصادقة.",
            }),
            {
              status,
              headers: { "content-type": "application/json" },
            },
          );
        }
      },
    },
  },
});
