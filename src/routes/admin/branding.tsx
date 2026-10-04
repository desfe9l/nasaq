import { createFileRoute } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { AdminBrandingSection } from "@/components/admin/ContentSettingsSections";
import { ADMIN_SECTIONS, BRAND_ROUTE } from "@/lib/site-routes";

const section = ADMIN_SECTIONS.find((item) => item.id === "branding")!;

/** `/admin/branding` — the identity palettes offered across the product. */
export const Route = createFileRoute("/admin/branding")({
  component: BrandingSection,
});

function BrandingSection() {
  return (
    <AdminSection
      title={section.label}
      description={section.description}
      actions={
        <a
          href={BRAND_ROUTE}
          className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-[12px] font-bold transition hover:border-brand"
        >
          صفحة الهوية
        </a>
      }
    >
      <AdminGate need="content">
        <AdminBrandingSection />
      </AdminGate>
    </AdminSection>
  );
}
