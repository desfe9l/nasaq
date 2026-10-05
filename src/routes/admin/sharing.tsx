import { createFileRoute, Link } from "@tanstack/react-router";
import { Globe, Image as ImageIcon, Megaphone, Share2 } from "lucide-react";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { ADMIN_ROUTES, ADMIN_SECTIONS } from "@/lib/site-routes";
import { SITE_ORIGIN } from "@/lib/og/share";
import { BRAND } from "@/lib/brand";

const section = ADMIN_SECTIONS.find((item) => item.id === "sharing")!;

/**
 * `/admin/sharing` — المشاركة والنشر.
 *
 * The platform's social surface is ONE identity: the origin, the mark and the
 * copy that link previews show. This section is its control room — the honest
 * preview of what a shared nasaq.app link renders as, with direct jumps to the
 * places that actually edit each part (announcements, site content, imagery),
 * while template share links themselves stay owned by the templates section.
 */
export const Route = createFileRoute("/admin/sharing")({
  component: SharingSection,
});

function SharingSection() {
  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="content">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <article className="overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="aspect-[1.91/1] w-full bg-surface-2">
              <img
                src="/og.jpg"
                alt="معاينة صورة المشاركة og.jpg"
                className="size-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="grid gap-1 p-3.5">
              <p className="flex items-center gap-1.5 text-[9px] font-black tracking-[0.14em] text-muted">
                <Share2 className="size-3 text-brand" aria-hidden /> معاينة المشاركة — ما يراه المشارك
              </p>
              <h3 className="text-[14px] font-black leading-5">
                {BRAND.name}
              </h3>
              <p className="line-clamp-2 text-[11.5px] leading-5 text-muted">
                {BRAND.tagline}
              </p>
              <p className="mt-1 text-[10.5px] font-bold text-muted" dir="ltr">
                {SITE_ORIGIN}
              </p>
            </div>
          </article>
          <nav className="grid h-max gap-2">
            <Link
              to={ADMIN_ROUTES.content}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12px] font-bold transition hover:border-brand"
            >
              <Megaphone className="size-4 text-brand" aria-hidden />
              نصوص الموقع والإعلان
            </Link>
            <Link
              to={ADMIN_ROUTES.assets}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12px] font-bold transition hover:border-brand"
            >
              <ImageIcon className="size-4 text-brand" aria-hidden />
              صور الموقع والشعار
            </Link>
            <Link
              to={ADMIN_ROUTES.templates}
              className="flex items-center gap-2 rounded-[10px] border border-line bg-surface p-3 text-[12px] font-bold transition hover:border-brand"
            >
              <Globe className="size-4 text-brand" aria-hidden />
              روابط القوالب المختصرة /t/…
            </Link>
          </nav>
        </div>
      </AdminGate>
    </AdminSection>
  );
}
