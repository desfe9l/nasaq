import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminPaymentsSection } from "@/components/site/AdminPage";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "payments")!;

/** `/admin/payments` — manual payment requests, approvals and the gateway. */
export const Route = createFileRoute("/admin/payments")({
  component: PaymentsSection,
});

function PaymentsSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminPaymentsSection />
      </AdminGate>
    </AdminSection>
  );
}
