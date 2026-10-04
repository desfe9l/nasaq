import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { SiteImagesPanel } from "@/components/admin/SiteImagesPanel";
import { InstitutionalBackgroundsPanel } from "@/components/admin/InstitutionalBackgroundsPanel";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "assets")!;

/** `/admin/assets` — site imagery, institutional backgrounds and marks. */
export const Route = createFileRoute("/admin/assets")({
  component: AssetsSection,
});

function AssetsSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="content">
        <div className="grid gap-6">
          <SiteImagesPanel />
          <InstitutionalBackgroundsPanel />
        </div>
      </AdminGate>
    </AdminSection>
  );
}
