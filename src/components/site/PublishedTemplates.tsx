import { useState } from "react";
import { LayoutTemplate, Lock, Share2 } from "lucide-react";
import { toast } from "sonner";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import { publishedTemplatePath } from "@/lib/templates/published";

/** Published templates have stable, public links. The destination rechecks
 * publication and entitlement before importing a private working copy. */
export function PublishedTemplates() {
  const items = usePublishedTemplates();
  const [copied, setCopied] = useState<string | null>(null);
  if (!items.length) return null;

  const share = async (id: string) => {
    try {
      await navigator.clipboard.writeText(new URL(publishedTemplatePath(id), window.location.origin).href);
      setCopied(id);
      toast.success("تم نسخ رابط القالب");
    } catch {
      toast.error("تعذر نسخ الرابط");
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-[18px] font-extrabold">قوالب منشورة من إدارة المنصة</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((t) => (
          <div key={t.id} className="group flex flex-col rounded-xl border border-line bg-white p-3 text-right transition hover:-translate-y-0.5 hover:border-emerald-500/50 dark:border-white/10 dark:bg-white/5">
            <a href={publishedTemplatePath(t.id)} className="flex flex-1 flex-col" aria-label={`فتح القالب ${t.title}`}>
              <span className="relative grid aspect-[210/297] w-full place-items-center overflow-hidden rounded-lg border border-line bg-white dark:border-white/10">
                {t.thumbnail ? <img src={t.thumbnail} alt="" className="h-full w-full object-contain" /> : <LayoutTemplate className="size-8 text-slate-300" />}
                {t.tier === "licensed" && (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-extrabold text-white">
                    <Lock className="size-3" /> النسخة الكاملة
                  </span>
                )}
              </span>
              <strong className="mt-2 block truncate text-[13px]">{t.title}</strong>
              {t.description && <span className="line-clamp-2 text-[11px] text-muted">{t.description}</span>}
            </a>
            <button type="button" onClick={() => void share(t.id)} className="mt-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line text-xs font-bold dark:border-white/10" aria-label={`نسخ رابط ${t.title}`}>
              <Share2 className="size-4" /> {copied === t.id ? "تم نسخ الرابط" : "نسخ الرابط"}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
