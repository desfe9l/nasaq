import { ChevronDown, Crown, LayoutTemplate } from "lucide-react";
import { PremiumAccessNote } from "./TemplateAccess";
import { SmartImage } from "@/components/ui/SmartImage";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import {
  publishedTemplatePath,
  templateDisplaySlug,
} from "@/lib/templates/published";
import { cn } from "@/lib/utils";
import { CARD_PREVIEW_H, CARD_W, CARD_WRAP } from "./cards";

/** Real catalogue data only; native disclosure keeps all content reachable by keyboard. */
export function PremiumTemplates({
  className,
  showHeading = true,
}: {
  className?: string;
  showHeading?: boolean;
}) {
  const published = usePublishedTemplates().filter(
    (item) => item.tier === "licensed" && !item.id.startsWith("builtin_pack_") && !item.id.startsWith("builtin_page_"),
  );
  /*
   * The premium shelf uses the SAME card as the catalog: one shared preview
   * height, one radius, one border, one action row. It used to be a four-up
   * `grid` of `h-36` tiles — a different card, on the same page, one scroll
   * apart from the catalog's — which is why the shelves read as unrelated
   * strips rather than as one library. Only the preview contents differ.
   *
   * The bundled starter packs used to be appended here as well, which put the
   * same four documents on the homepage twice, one screen apart, under two
   * different card designs. They now live only in their own section
   * («قوالب البداية»), and this shelf is purely the published premium
   * catalogue — so it also disappears entirely when that catalogue is empty,
   * instead of painting an empty disclosure box.
   */
  const card =
    "shadow-card group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover";
  const body = "flex flex-1 flex-col p-4 text-right";
  const previewLabel =
    "rounded-[3px] border border-line shadow-sm transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none";
  if (published.length === 0) return null;
  return (
    <section
      className={cn("mx-auto w-full max-w-6xl px-4 py-6 sm:px-6", className)}
      aria-label="قوالب Premium"
    >
      <details
        open
        className="group/premium rounded-xl border border-line bg-surface"
      >
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-bold text-ink">
          <Crown className="size-4 text-muted" aria-hidden />
          <span>قوالب Premium</span>
          <span className="text-[11px] font-normal text-muted">
            {published.length}
          </span>
          <ChevronDown
            className="ms-auto size-4 transition-transform group-open/premium:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="border-t border-line p-3">
          {showHeading && (
            <>
              {/*
               * The price is stated once for the whole shelf, and every card
               * carries its own chip — a premium template is never a lock with
               * no number next to it.
               */}
              <PremiumAccessNote className="mb-3" hideSales />
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
                <span>قوالب مؤسسية قابلة للتحرير — تُفتح وفق ترخيصك الحالي.</span>
                <a href="/contact" className="font-extrabold text-brand underline">
                  تواصل مع المبيعات
                </a>
              </div>
            </>
          )}
          <div className={cn("mt-4", CARD_WRAP)}>
            {published.map((template) => (
              <a
                key={template.id}
                href={publishedTemplatePath(templateDisplaySlug(template))}
                className={cn(card, CARD_W)}
              >
                <div
                  className="grid shrink-0 place-items-center overflow-hidden border-b border-line/70 bg-paper/70 p-3"
                  style={{ height: CARD_PREVIEW_H }}
                >
                  {template.thumbnail ? (
                    <SmartImage
                      src={template.thumbnail}
                      alt=""
                      decorative
                      fit="contain"
                      aspectRatio="210 / 297"
                      className={cn(
                        "max-h-full max-w-full bg-white",
                        previewLabel,
                      )}
                    />
                  ) : (
                    <span className="flex flex-col items-center gap-2 text-muted">
                      <LayoutTemplate className="size-5" aria-hidden />
                      <span className="text-[10.5px] font-bold">
                        معاينة غير متاحة بعد
                      </span>
                    </span>
                  )}
                </div>
                <div className={body}>
                  <strong className="line-clamp-2 text-[14px] font-extrabold leading-6 text-ink">
                    {template.title}
                  </strong>
                  {template.description && (
                    <span className="mt-2 line-clamp-3 flex-1 text-[12px] leading-6 text-muted">
                      {template.description}
                    </span>
                  )}
                  <span className="mt-auto block border-t border-line/70 pt-3">
                    <PremiumAccessNote compact />
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}

