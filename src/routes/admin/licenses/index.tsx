import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import AdminLicensePanel from "@/components/license/AdminLicensePanel";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "licenses")!;

/** `/admin/licenses` — إصدار التراخيص ومفاتيح التفعيل وربطها بالحسابات. */
export const Route = createFileRoute("/admin/licenses/")({
  component: LicensesSection,
});

function LicensesSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminLicensePanel />
      </AdminGate>
    </AdminSection>
  );
}
