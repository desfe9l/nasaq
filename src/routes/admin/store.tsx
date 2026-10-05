import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { GumroadGatewayCard } from "@/components/admin/GumroadGatewayCard";
import { ADMIN_ROUTES, ADMIN_SECTIONS } from "@/lib/site-routes";
import { Coins, LayoutTemplate, ReceiptText } from "lucide-react";

const section = ADMIN_SECTIONS.find((item) => item.id === "store")!;

/**
 * `/admin/store` — المتجر والمنتجات: the platform's commercial front in ONE
 * place: the Gumroad gateway that owns paid products, the plans that price
 * them, and the payments that settle them. Nothing here duplicates those
 * sections; it collects the store's doors under one address.
 */
export const Route = createFileRoute("/admin/store")({
  component: StoreSection,
});

function StoreSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <div className="grid gap-4">
          <GumroadGatewayCard visible />
          <div className="grid gap-2 sm:grid-cols-3">
            <Link
              to={ADMIN_ROUTES.plans}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12px] font-bold transition hover:border-brand"
            >
              <Coins className="size-4 text-brand" aria-hidden />
              الباقات والأسعار
            </Link>
            <Link
              to={ADMIN_ROUTES.payments}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12px] font-bold transition hover:border-brand"
            >
              <ReceiptText className="size-4 text-brand" aria-hidden />
              المدفوعات والموافقات
            </Link>
            <Link
              to={ADMIN_ROUTES.templates}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12px] font-bold transition hover:border-brand"
            >
              <LayoutTemplate className="size-4 text-brand" aria-hidden />
              القوالب المدفوعة
            </Link>
          </div>
        </div>
      </AdminGate>
    </AdminSection>
  );
}
