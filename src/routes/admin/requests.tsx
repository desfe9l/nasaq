import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminRequestsPanel } from "@/components/admin/AdminRequestsPanel";
import { ADMIN_SECTIONS, CONTACT_ROUTE } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "requests")!;

/**
 * `/admin/requests` — «الطلبات والمراسلات».
 *
 * The address the administration returns to: a request can be linked, the page
 * refreshed, and Back moves between requests and the rest of the console. The
 * server re-verifies the caller's authority on every call the panel makes.
 */
export const Route = createFileRoute("/admin/requests")({
  component: RequestsSection,
});

function RequestsSection() {
  return (
    <AdminSection
      title={section.label}
      description={section.description}
      actions={
        <a
          href={CONTACT_ROUTE}
          className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand"
        >
          صفحة التواصل للعميل
        </a>
      }
    >
      <AdminGate need="commercial">
        <AdminRequestsPanel />
      </AdminGate>
    </AdminSection>
  );
}
