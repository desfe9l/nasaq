import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { RequireSignedIn } from "@/lib/auth/gates";

/**
 * The admin console LAYOUT.
 *
 * `/admin` is now a real nested route tree: this route owns the shell (access
 * resolution, the navigation of real links, the masthead) and every management
 * function is a child route with its own address — `/admin/templates`,
 * `/admin/users`, `/admin/licenses`, … A section can therefore be linked,
 * bookmarked, refreshed and shared, and the browser's Back moves between
 * sections instead of being swallowed by a tab switch.
 *
 * Both authorities are resolved inside `AdminConsole` (platform administrator
 * and content owner). Signing in is required before any of it renders, and
 * every server function behind a section re-verifies its own authority.
 */
export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "لوحة الإدارة | نَسَق NASAQ" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <RequireSignedIn>
      <AdminConsole>
        <Outlet />
      </AdminConsole>
    </RequireSignedIn>
  ),
});
