import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { ServiceControlPanel } from "@/components/admin/ServiceControlPanel";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "services")!;

/** `/admin/services` — owner control of NASAQ's own service policy. */
export const Route = createFileRoute("/admin/services")({
  component: ServicesSection,
});

function ServicesSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <ServiceControlPanel />
      </AdminGate>
    </AdminSection>
  );
}
