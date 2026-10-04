import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminDashboardSection } from "@/components/site/AdminPage";
import { ADMIN_ROUTES, ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "dashboard")!;

/** `/admin` — لوحة القيادة: the state of the platform in one screen. */
export const Route = createFileRoute("/admin/")({
  component: DashboardSection,
});

function DashboardSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminDashboardSection />
      </AdminGate>
      <p className="text-[11.5px] text-muted">
        إدارة القوالب والمحتوى في{" "}
        <a href={ADMIN_ROUTES.templates} className="font-extrabold text-brand hover:underline">
          قسم القوالب
        </a>
        .
      </p>
    </AdminSection>
  );
}
