import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminPlansSection } from "@/components/site/AdminPage";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "plans")!;

/** `/admin/plans` — plans, prices, subscriptions and their limits. */
export const Route = createFileRoute("/admin/plans")({
  component: PlansSection,
});

function PlansSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminPlansSection />
      </AdminGate>
    </AdminSection>
  );
}
