import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminAuditSection } from "@/components/site/AdminPage";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "audit")!;

/** `/admin/audit` — every privileged action, by whom and when. */
export const Route = createFileRoute("/admin/audit")({
  component: AuditSection,
});

function AuditSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminAuditSection />
      </AdminGate>
    </AdminSection>
  );
}
