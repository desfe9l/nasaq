import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminUsersSection } from "@/components/site/AdminPage";
import { ADMIN_SECTIONS } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "users")!;

/** `/admin/users` — accounts: status, plan, subscription dates. */
export const Route = createFileRoute("/admin/users")({
  component: UsersSection,
});

function UsersSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <AdminUsersSection />
      </AdminGate>
    </AdminSection>
  );
}
