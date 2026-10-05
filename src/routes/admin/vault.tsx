import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import OwnerVaultPage from "@/components/admin/OwnerVaultPage";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "vault")!;

/**
 * `/admin/vault` — the owner vault INSIDE the admin console.
 *
 * Provider keys were the one admin power that lived on a separate page of
 * its own. It is now a section like any other (the legacy /owner-vault
 * address keeps working and lands on the same component); the authority — the
 * verified owner — is still enforced by every server call behind it.
 */
export const Route = createFileRoute("/admin/vault")({
  component: VaultSection,
});

function VaultSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <OwnerVaultPage />
      </AdminGate>
    </AdminSection>
  );
}
