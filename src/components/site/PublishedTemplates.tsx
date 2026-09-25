import { useState } from "react";
import { LayoutTemplate, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { getPublishedTemplateFn } from "@/lib/admin/functions";
import { usePublishedTemplates } from "@/lib/admin/use-site-settings";
import { useEditor } from "@/lib/editor/store";
import type { Page } from "@/lib/editor/model";

/**
 * Templates published from /admin. Licensed templates are unlocked by the
 * SERVER using the signed-in account's verified entitlements — not a cached key.
 */
export function PublishedTemplates({
  hasPremium,
  onLocked,
  beforeOpen,
}: {
  hasPremium: boolean;
  onLocked: () => void;
  /** Returns true when the demo limits block creating another project. */
  beforeOpen: (pageCount: number) => boolean | Promise<boolean>;
}) {
  const items = usePublishedTemplates();
  const importProject = useEditor((s) => s.importProject);
  const addSvg = async (title: string, svg: string) => {
    const page: Page = {
      id: `page_${Date.now().toString(36)}`,
      name: "صفحة 1",
      w: 210,
      h: 297,
      elements: [
        {
          id: `el_${Date.now().toString(36)}`,
          type: "svg",
          name: title,
          x: 15,
          y: 15,
          w: 180,
          h: 267,
          rotation: 0,
          opacity: 1,
          z: 1,
          content: svg,
          style: { overflowVisible: false },
        },
      ],
    } as Page;
    await importProject({ name: title, pages: [page] });
  };
  const [busy, setBusy] = useState<string | null>(null);

  if (!items.length) return null;

  const open = async (id: string, title: string, tier: string) => {
    if (tier === "licensed" && !hasPremium) {
      onLocked();
      return;
    }
    setBusy(id);
    try {
      const res = await getPublishedTemplateFn({ data: { id } });
      if (!res.ok) {
        if ("locked" in res && res.locked) onLocked();
        else toast.error(res.error);
        return;
      }
      const tpl = res.template;
      if (tpl.kind === "json") {
        const project = JSON.parse(tpl.content) as { pages: Page[]; name?: string };
        if (await beforeOpen(project.pages.length)) return;
        await importProject({ ...project, name: project.name || title });
      } else {
        if (await beforeOpen(1)) return;
        await addSvg(title, tpl.content);
      }
      window.location.assign("/editor");
    } catch {
      toast.error("تعذر فتح القالب");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-[18px] font-extrabold">قوالب منشورة من إدارة المنصة</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((t) => {
          const locked = t.tier === "licensed" && !hasPremium;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => void open(t.id, t.title, t.tier)}
              disabled={busy !== null}
              className="group flex flex-col rounded-xl border border-line bg-white p-3 text-right transition hover:-translate-y-0.5 hover:border-emerald-500/50 disabled:opacity-60 dark:border-white/10 dark:bg-white/5"
            >
              <span className="relative grid aspect-[210/297] w-full place-items-center overflow-hidden rounded-lg border border-line bg-white dark:border-white/10">
                {t.thumbnail ? <img src={t.thumbnail} alt="" className="h-full w-full object-contain" /> : <LayoutTemplate className="size-8 text-slate-300" />}
                {locked && (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-extrabold text-white">
                    <Lock className="size-3" /> النسخة الكاملة
                  </span>
                )}
                {busy === t.id && <Loader2 className="absolute size-6 animate-spin text-emerald-600" />}
              </span>
              <strong className="mt-2 block truncate text-[13px]">{t.title}</strong>
              {t.description && <span className="line-clamp-2 text-[11px] text-muted">{t.description}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
