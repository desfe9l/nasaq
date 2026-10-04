import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { PsdImportPanel } from "@/components/admin/PsdImportPanel";
import { InstitutionalBackgroundsPanel } from "@/components/admin/InstitutionalBackgroundsPanel";
import { ADMIN_SECTIONS, IMPORT_ROUTE } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "import")!;

/**
 * `/admin/import` — template import.
 *
 * The dedicated `/import` service is the primary flow (upload, analyse, repair,
 * compare); this console section keeps its library-routing decisions
 * (asset-by-asset dispositions) and the institutional backgrounds.
 */
export const Route = createFileRoute("/admin/import")({
  component: ImportSection,
});

function ImportSection() {
  return (
    <AdminSection
      title={section.label}
      description={section.description}
      actions={
        <a
          href={IMPORT_ROUTE}
          className="inline-flex h-9 items-center rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand"
        >
          فتح خدمة الاستيراد الكاملة
        </a>
      }
    >
      <AdminGate need="content">
        <div className="grid gap-6">
          <PsdImportPanel />
          <InstitutionalBackgroundsPanel />
        </div>
      </AdminGate>
    </AdminSection>
  );
}
