import { createFileRoute, redirect } from "@tanstack/react-router";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { RequireAdmin } from "@/lib/auth/gates";

/**
 * /admin-dashboard — content and PAID-TEMPLATE administration.
 *
 * Two gates, because a direct URL must not reach the panel:
 *
 *   · `beforeLoad` asks the server (`adminTemplatesAccessFn`) BEFORE the route
 *     renders a single node and redirects a caller without an owner session to
 *     sign-in. That is what closes the "paid-template management without
 *     login" hole for someone who simply types the address.
 *   · `RequireAdmin` keeps the client-side wrapper, and every template server
 *     function re-verifies the same thing server-side, so a caller who skips
 *     the UI (or replays a request) still gets `غير مصرح`.
 *
 * The redirect is a convenience, never the boundary: the server check is the
 * boundary.
 */
export const Route = createFileRoute("/admin-dashboard")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const { adminTemplatesAccessFn } = await import("@/lib/admin/functions");
      const access = await adminTemplatesAccessFn();
      if (access.ok) return;
    } catch {
      // Signed out (401) or the database is unreachable — either way the
      // caller must not see the panel; send them to sign-in.
    }
    throw redirect({ to: "/login" });
  },
  head: () => ({
    meta: [
      { title: "لوحة إدارة المحتوى والقوالب | نَسَق NASAQ" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <RequireAdmin>
      <AdminDashboard />
    </RequireAdmin>
  ),
});
