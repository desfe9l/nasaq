import { ArrowLeft, Crown, LayoutTemplate, Sparkles } from "lucide-react";
import { PACKS } from "@/lib/editor/templates";
import { CARD_W, CARD_WRAP, SITE_CARD } from "@/components/site/cards";
import { LicenseBadge } from "@/components/site/LicenseBadge";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import { publishedTemplatePath, templateDisplaySlug } from "@/lib/templates/published";
import { cn } from "@/lib/utils";

/**
 * Premium Templates — the paid shelf, in one component.
 *
 * Two real sources, one visual treatment:
 *
 *   1. The licensed starter packs (`PACKS` minus the blank page) — always
 *      present, so the section never collapses to nothing on a fresh install.
 *   2. The published licensed templates from the admin dashboard, shown with
 *      their real thumbnails and stable public links when the catalogue has
 *      any. They come first because they are the newest paid work.
 *
 * Nothing here claims an entitlement: every card links to the catalogue
 * (`/templates`) where the licence check already lives, and the badge only
 * states whether the item is inside the current licence.
 */
export function PremiumTemplates({
  className,
  showHeading = true,
}: {
  className?: string;
  showHeading?: boolean;
}) {
  const published = usePublishedTemplates().filter(
    (item) => item.tier === "licensed",
  );

  const packs = PACKS.filter((pack) => pack.id !== "blank");

  return (
    <section className={cn("mx-auto w-full max-w-6xl px-4 py-12 sm:px-6", className)}>
      {showHeading && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/12 px-2.5 py-1 text-[11px] font-extrabold text-ink">
              <Crown className="size-3.5" aria-hidden />
              Premium Templates
            </span>
            <h2 className="mt-3 text-[20px] font-extrabold text-ink">
              قوالب مميزة — تُفتح كاملة مع الترخيص
            </h2>
            <p className="mt-1 text-[13px] leading-6 text-muted">
              حزم جاهزة بأغلفة وفصول وجداول ومؤشرات، تُنسخ إلى مشروعك لتعدّلها
              بحرية. القوالب المميزة تُفعّل تلقائيًا وفق ترخيصك الحالي.
            </p>
          </div>
          <a
            href="/templates"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[12px] font-extrabold text-ink transition hover:border-brand/40"
          >
            تصفح الكتالوج كاملًا
            <ArrowLeft className="size-4" aria-hidden />
          </a>
        </div>
      )}

      <div className={cn("mt-6", CARD_WRAP)}>
        {published.map((template) => {
          const slug = templateDisplaySlug(template);
          return (
            <a
              key={template.id}
              href={publishedTemplatePath(slug)}
              className={cn(
                "group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4 text-right transition hover:-translate-y-1 hover:border-brand/40",
                CARD_W,
                SITE_CARD,
              )}
              aria-label={`معاينة القالب المميز ${template.title}`}
            >
              <span className="relative grid aspect-[210/297] w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface-2">
                {template.thumbnail ? (
                  <img
                    src={template.thumbnail}
                    alt=""
                    className="h-full w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <LayoutTemplate className="size-8 text-muted" aria-hidden />
                )}
                <span className="absolute top-2 left-2">
                  <LicenseBadge
                    state="locked"
                    size="sm"
                    label="ترخيص"
                    title="قالب مميز — يُفتح ضمن النسخة الكاملة"
                  />
                </span>
              </span>
              <strong className="mt-3 line-clamp-2 text-[14px] font-extrabold text-ink">
                {template.title}
              </strong>
              {template.description ? (
                <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted">
                  {template.description}
                </span>
              ) : null}
            </a>
          );
        })}

        {packs.map((pack) => (
          <a
            key={pack.id}
            href="/templates"
            className={cn(
              "group flex flex-col rounded-2xl border border-line bg-surface p-5 text-right transition hover:-translate-y-1 hover:border-brand/40",
              CARD_W,
              SITE_CARD,
            )}
            aria-label={`قوالب ${pack.title} المميزة`}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="grid size-9 place-items-center rounded-xl bg-gold/15 text-ink">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <span className="text-[11px] font-bold text-muted">
                {pack.pages} صفحة
              </span>
            </div>
            <strong className="block text-[15px] font-extrabold text-ink">
              {pack.title}
            </strong>
            <span className="mt-1 block text-[12px] leading-6 text-muted">
              {pack.desc}
            </span>
            <span className="mt-auto pt-4">
              <LicenseBadge
                state="locked"
                size="sm"
                label="نسخة كاملة"
                title="يُفتح هذا القالب كاملًا مع الترخيص"
              />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
