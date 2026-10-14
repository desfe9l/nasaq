/*
 * The published shelf — platform templates that live at a stable public link.
 *
 * These cards are the SAME card as the catalog's: one preview box of the shared
 * height, the same radius, border, elevation and lift, the same title/meta/action
 * rhythm. They used to be a four-up `grid` with `aspect-[210/297]` boxes pinned
 * to `lg:grid-cols-4`, which made a 1280px row four ~230px cards with a
 * `truncate`d title and a stray copy-link button underneath — while the row of
 * cards directly above it, in the same page, was three ~352px cards. Two card
 * languages on one page is what "no organisation" looks like, so there is now
 * one: `CARD_WRAP` + `CARD_W`, driven by the shelf's own width.
 */

import { useState } from "react";
import { LayoutTemplate, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import { publishedTemplatePath, templateDisplaySlug } from "@/lib/templates/published";
import { LicenseBadgeIcon } from "./LicenseBadge";
import { SmartImage } from "@/components/ui/SmartImage";
import { CARD_PREVIEW_H, CARD_W, CARD_WRAP } from "./cards";
import { cn } from "@/lib/utils";

/** Published templates have stable, public links. The destination rechecks
 * publication and entitlement before importing a private working copy. */
export function PublishedTemplates() {
  const items = usePublishedTemplates().filter(
    (item) => !item.id.startsWith("builtin_pack_") && !item.id.startsWith("builtin_page_"),
  );
  const [copied, setCopied] = useState<string | null>(null);
  if (!items.length) return null;

  const share = async (template: { id: string; slug: string | null }) => {
    try {
      const slug = templateDisplaySlug(template);
      await navigator.clipboard.writeText(new URL(publishedTemplatePath(slug), window.location.origin).href);
      setCopied(template.id);
      toast.success("تم نسخ رابط القالب");
    } catch {
      toast.error("تعذر نسخ الرابط");
    }
  };

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold text-ink">قوالب مدفوعة</h2>
          <p className="mt-1 text-[12px] leading-6 text-muted">
            {items.length} قالبًا منشورًا من إدارة المنصة، لكل واحد صفحته ورابطه الثابت — ويتطلب ترخيصًا
            لاستخدامه في مشاريعك.
          </p>
        </div>
      </div>

      <div className={cn("mt-6", CARD_WRAP)}>
        {items.map((t) => {
          const slug = templateDisplaySlug(t);
          const href = publishedTemplatePath(slug);
          return (
            <article
              key={t.id}
              className={cn(
                "group shadow-card flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover",
                CARD_W,
              )}
            >
              <a
                href={href}
                aria-label={`فتح القالب ${t.title}`}
                className="relative grid cursor-pointer place-items-center overflow-hidden border-b border-line/70 bg-paper/70 p-4"
                style={{ height: CARD_PREVIEW_H }}
              >
                {t.thumbnail ? (
                  <SmartImage
                    src={t.thumbnail}
                    decorative
                    fit="contain"
                    aspectRatio="210 / 297"
                    className="max-h-full max-w-full rounded-[3px] border border-line bg-white shadow-md transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-xl"
                  />
                ) : (
                  <span className="grid size-16 place-items-center rounded-xl border border-line bg-surface-2 text-muted">
                    <LayoutTemplate className="size-7" aria-hidden />
                  </span>
                )}
                {t.tier === "licensed" && (
                  <span className="absolute right-3 top-3">
                    <LicenseBadgeIcon state="locked" title="النسخة الكاملة — يتطلب ترخيصًا" />
                  </span>
                )}
              </a>

              <div className="flex flex-1 flex-col p-5 text-right">
                <div className="flex items-start justify-between gap-3">
                  {/* Two lines, never clipped: a template's name is the one thing
                      on the card that must never be abbreviated away. */}
                  <h3 className="text-[15px] font-extrabold leading-6 text-ink">
                    <a href={href} className="line-clamp-2 transition hover:text-brand-hover">
                      {t.title}
                    </a>
                  </h3>
                  {t.category && (
                    <span
                      title={t.category}
                      className="max-w-[45%] shrink-0 truncate rounded-full bg-line-2 px-2 py-0.5 text-[10px] font-bold text-muted"
                    >
                      {t.category}
                    </span>
                  )}
                </div>

                <p className="mt-2 line-clamp-3 flex-1 text-[12px] leading-6 text-muted">
                  {t.description || "قالب منشور من إدارة المنصة — يُفتح وفق ترخيصك الحالي."}
                </p>

                <div className="mt-4 border-t border-line/70 pt-4">
                  <a
                    href={href}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-navy px-3 text-[12px] font-extrabold text-on-brand shadow-sm transition hover:bg-navy-2"
                  >
                    <Link2 className="size-4 shrink-0" aria-hidden />
                    فتح صفحة القالب
                  </a>
                  <button
                    type="button"
                    onClick={() => void share(t)}
                    aria-label={`نسخ رابط ${t.title}`}
                    className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-line px-3 text-[12px] font-bold text-ink transition hover:bg-line-2"
                  >
                    <Share2 className="size-4 shrink-0" aria-hidden />
                    {copied === t.id ? "تم نسخ الرابط" : "نسخ رابط القالب"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
