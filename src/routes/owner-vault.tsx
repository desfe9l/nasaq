import { createFileRoute } from "@tanstack/react-router";
import OwnerVaultPage from "@/components/admin/OwnerVaultPage";
import { RequireSignedIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/owner-vault")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "NASAQ Owner Vault" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <RequireSignedIn>
      <OwnerVaultPage />
    </RequireSignedIn>
  ),
});
