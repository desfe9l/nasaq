import { createFileRoute } from "@tanstack/react-router";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { RequireAdmin } from "@/lib/auth/gates";

export const Route = createFileRoute("/admin-dashboard")({
  ssr: false,
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
