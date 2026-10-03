import { createFileRoute } from "@tanstack/react-router";
import LicensePage from "@/components/license/LicensePage";
import { RequireSignedIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/license")({
  ssr: false,
  component: () => (
    <RequireSignedIn>
      <LicensePage />
    </RequireSignedIn>
  ),
});
