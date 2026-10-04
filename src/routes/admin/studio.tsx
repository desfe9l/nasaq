import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { TemplateStudio } from "@/components/admin/TemplateStudio";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "studio")!;

/** `/admin/studio` — build a template from NASAQ's own real pages. */
export const Route = createFileRoute("/admin/studio")({
  component: StudioSection,
});

function StudioSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="content">
        <TemplateStudio />
      </AdminGate>
    </AdminSection>
  );
}
