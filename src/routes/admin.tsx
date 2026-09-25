import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "@/components/site/AdminPage";
import { RequireAdmin } from "@/lib/auth/gates";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "لوحة الإدارة | نَسَق NASAQ" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <RequireAdmin>
      <AdminPage />
    </RequireAdmin>
  ),
});
