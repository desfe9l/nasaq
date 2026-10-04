import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminTemplatesPanel } from "@/components/admin/AdminTemplatesPanel";
import { ADMIN_SECTIONS, ADMIN_ROUTES, TEMPLATES_ROUTE } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "templates")!;

/**
 * `/admin/templates` — template records.
 *
 * The full lifecycle lives here: create, edit, duplicate, delete (with
 * confirmation), preview, publish/unpublish, category, title/description,
 * preview image, content, copy/share URL, open in the editor, and paid/free
 * status. This is the address the old `/admin-dashboard` redirects to.
 */
export const Route = createFileRoute("/admin/templates")({
  component: TemplatesSection,
});

function TemplatesSection() {
  return (
    <AdminSection
      title={section.label}
      description={section.description}
      actions={
        <>
          <a
            href={ADMIN_ROUTES.import}
            className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand"
          >
            استيراد قالب
          </a>
          <a
            href={TEMPLATES_ROUTE}
            className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand"
          >
            عرض الكتالوج العام
          </a>
        </>
      }
    >
      <AdminGate need="content">
        <AdminTemplatesPanel />
      </AdminGate>
    </AdminSection>
  );
}
