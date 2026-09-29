import { ChevronDown, Crown } from "lucide-react";
import { PACKS, createProject } from "@/lib/editor/templates";
import { LicenseBadge } from "./LicenseBadge";
import { TemplatePreview } from "./TemplatePreview";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import {
  publishedTemplatePath,
  templateDisplaySlug,
} from "@/lib/templates/published";
import { cn } from "@/lib/utils";

const packs = PACKS.filter((pack) => pack.id !== "blank").map((pack) => ({
  ...pack,
  page: createProject(pack.id).pages[0],
}));

/** Real catalogue data only; native disclosure keeps all content reachable by keyboard. */
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
  const card =
    "flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-right transition-colors hover:border-brand/50";
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
            {published.length + packs.length}
          </span>
          <ChevronDown
            className="ms-auto size-4 transition-transform group-open/premium:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="border-t border-line p-3">
          {showHeading && (
            <p className="mb-3 text-[12px] leading-6 text-muted">
              قوالب مؤسسية قابلة للتحرير — تُفتح وفق ترخيصك الحالي.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {published.map((template) => (
              <a
                key={template.id}
                href={publishedTemplatePath(templateDisplaySlug(template))}
                className={card}
              >
                {template.thumbnail && (
                  <img
                    src={template.thumbnail}
                    alt=""
                    loading="lazy"
                    className="h-36 w-full rounded border border-line object-contain"
                  />
                )}
                <strong className="line-clamp-2 text-[13px]">
                  {template.title}
                </strong>
                {template.description && (
                  <p className="line-clamp-2 text-[11px] leading-5 text-muted">
                    {template.description}
                  </p>
                )}
                <span className="mt-auto">
                  <LicenseBadge state="locked" label="قالب مرخص" />
                </span>
              </a>
            ))}
            {packs.map((pack) => (
              <a
                key={pack.id}
                href="/templates"
                className={card}
                aria-label={`قوالب ${pack.title} المميزة`}
              >
                <div className="flex h-36 justify-center overflow-hidden rounded border border-line bg-surface-2 p-2">
                  <TemplatePreview page={pack.page} className="h-full" />
                </div>
                <strong className="text-[13px]">{pack.title}</strong>
                <p className="line-clamp-2 text-[11px] leading-5 text-muted">
                  {pack.desc}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2">
                  <LicenseBadge state="locked" label="قالب مرخص" />
                  <span className="text-[10px] text-muted">
                    {pack.pages} صفحة
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
