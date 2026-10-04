import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminContentSection } from "@/components/admin/ContentSettingsSections";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "content")!;

/** `/admin/content` — the public site's messaging, announcement and texts. */
export const Route = createFileRoute("/admin/content")({
  component: ContentSection,
});

function ContentSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="content">
        <AdminContentSection />
      </AdminGate>
    </AdminSection>
  );
}
