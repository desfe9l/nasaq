import { createFileRoute } from "@tanstack/react-router";
import AdminLicensePanel from "@/components/license/AdminLicensePanel";
import { RequireAdmin } from "@/lib/auth/gates";

export const Route = createFileRoute("/admin-licenses")({
  ssr: false,
  component: () => (
    <RequireAdmin>
      <AdminLicensePanel />
    </RequireAdmin>
  ),
});
