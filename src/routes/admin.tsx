import { createFileRoute } from "@tanstack/react-router";
import AdminDashboard from "@/components/admin/AdminDashboard";
import { RequireSignedIn } from "@/lib/auth/gates";

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
      <AdminDashboard />
    </RequireSignedIn>
  ),
});