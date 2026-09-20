import { createFileRoute } from "@tanstack/react-router";
import AdminLicensePanel from "@/components/license/AdminLicensePanel";

export const Route = createFileRoute("/admin-licenses")({
  ssr: false,
  component: AdminLicensePanel,
});
