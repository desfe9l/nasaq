import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminSettingsSection } from "@/components/site/AdminPage";
import { AdminCommercialSection } from "@/components/admin/ContentSettingsSections";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "settings")!;

/** `/admin/settings` — system settings: payment instructions and commerce. */
export const Route = createFileRoute("/admin/settings")({
  component: SettingsSection,
});

function SettingsSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminSettingsSection />
      </AdminGate>
      <AdminGate need="content">
        <AdminCommercialSection />
      </AdminGate>
    </AdminSection>
  );
}
