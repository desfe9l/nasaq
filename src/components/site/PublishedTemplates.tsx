import { useState } from "react";
import { LayoutTemplate, Share2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import { publishedTemplatePath, templateDisplaySlug } from "@/lib/templates/published";
import { LicenseBadgeIcon } from "./LicenseBadge";

/** Published templates have stable, public links. The destination rechecks
 * publication and entitlement before importing a private working copy. */
export function PublishedTemplates() {
  const items = usePublishedTemplates();
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
    <section className="mt-10">
      <h2 className="text-[18px] font-extrabold">قوالب مدفوعة</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((t) => {
          const slug = templateDisplaySlug(t);
          return (
            <div key={t.id} className="group flex flex-col rounded-xl border border-line bg-surface p-3 text-right transition hover:-translate-y-0.5 hover:border-brand/50 ">
              <a href={publishedTemplatePath(slug)} className="flex flex-1 flex-col" aria-label={`فتح القالب ${t.title}`}>
                <span className="relative grid aspect-[210/297] w-full place-items-center overflow-hidden rounded-lg border border-line bg-surface ">
                  {t.thumbnail ? <img src={t.thumbnail} alt="" className="h-full w-full object-contain" /> : <LayoutTemplate className="size-8 text-muted" />}
                  {t.tier === "licensed" && (
                    <span className="absolute top-2 left-2">
                      <LicenseBadgeIcon state="locked" title="النسخة الكاملة — يتطلب ترخيصًا" />
                    </span>
                  )}
                </span>
                <strong className="mt-2 block truncate text-[13px]">{t.title}</strong>
                {t.description && <span className="line-clamp-2 text-[11px] text-muted">{t.description}</span>}
              </a>
              <button type="button" onClick={() => void share(t)} className="mt-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line text-xs font-bold " aria-label={`نسخ رابط ${t.title}`}>
                <Share2 className="size-4" /> {copied === t.id ? "تم نسخ الرابط" : "نسخ رابط القالب"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
