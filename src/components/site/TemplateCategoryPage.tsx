/*
 * A public category page — `/templates/category/<id>`.
 *
 * WHAT IT IS
 * ----------
 * A real page for one template family: what it is for, who starts there, and the
 * actual templates in it — each one rendered by the same `TemplateCard` and
 * driven by the same `entry-actions.ts` the gallery and every template page use.
 * Nothing here is a second catalogue: the entries come from `useCatalogEntries`,
 * the categories from the generator's own `TEMPLATE_CATEGORIES`, and the six
 * public surfaces from `category-pages.ts`.
 *
 * The page also answers the "why" a bare filtered grid cannot: it states the
 * purpose, the audience, an honest starting hint, and the sibling categories —
 * so a visitor who lands here from search has somewhere to go next.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, LayoutTemplate, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TemplateCard } from "@/components/site/TemplateCard";
import { QuickViewDialog } from "@/components/site/TemplateDialogs";
import { useCatalogEntries } from "@/components/site/useCatalog";
import { useEditor } from "@/lib/editor/store";
import { useLicense } from "@/lib/license/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useBrandIdentity } from "@/lib/product/use-brand-identity";
import {
  categorySurface,
  TEMPLATE_CATEGORY_SURFACES,
} from "@/lib/templates/category-pages";
import {
  duplicateTemplateEntry,
  entryRequiresLicense,
  startFromTemplateEntry,
  type TemplateActionContext,
} from "@/lib/templates/entry-actions";
import {
  LICENSE_ROUTE,
  STUDIO_ROUTE,
  TEMPLATES_ROUTE,
  categoryPathFor,
  createPathFor,
  editorPathFor,
  templatePathFor,
  templatesFilterPathFor,
} from "@/lib/site-routes";
import { entrySlug } from "@/lib/templates/entry-slug";
import { TEMPLATE_CATEGORIES } from "@/lib/editor/templates";
import { cn } from "@/lib/utils";
import type { CatalogEntry } from "@/lib/templates/catalog";

export function TemplateCategoryPage({ categoryId }: { categoryId: string }) {
  const theme = useEditor((s) => s.theme);
  const orgName = useEditor((s) => s.orgName);
  const hydrate = useEditor((s) => s.hydrate);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);
  const brand = useBrandIdentity();
  const [quickViewId, setQuickViewId] = useState<string | null>(null);

  const surface = useMemo(() => categorySurface(categoryId), [categoryId]);
  const entries = useCatalogEntries("official", orgName);

  const inFamily = useMemo(() => {
    if (!surface) return [];
    const allowed = new Set(surface.categories);
    return entries.filter((entry) => allowed.has(entry.category));
  }, [surface, entries]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  /** One action layer, shared with `/templates` and every template page. */
  const context: TemplateActionContext = {
    theme,
    orgName,
    entitlements,
    identity: brand.kit,
  };

  const run = async (entry: CatalogEntry, action: "use" | "duplicate") => {
    const result =
      action === "use"
        ? await startFromTemplateEntry(entry, context)
        : await duplicateTemplateEntry(entry, context);
    if (result.status === "opened") {
      window.location.assign(editorPathFor(result.projectId));
      return;
    }
    if (result.status === "duplicated") {
      toast.success(`تم تكرار «${result.title}» في قوالبي الخاصة`);
      setQuickViewId(null);
      return;
    }
    if (result.reason === "license") {
      window.location.assign(LICENSE_ROUTE);
      return;
    }
    toast.error(result.message || "تعذر تنفيذ الإجراء");
  };

  if (!surface) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current={TEMPLATES_ROUTE} />
        <main className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
          <h1 className="text-[22px] font-extrabold text-ink">فئة غير معروفة</h1>
          <p className="mt-2 text-[13px] leading-7 text-muted">
            هذه الفئة غير موجودة في مكتبة نَسَق. تفضّل بالعودة إلى مكتبة القوالب.
          </p>
          <a
            href={TEMPLATES_ROUTE}
            className="mt-6 inline-flex h-10 items-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand"
          >
            مكتبة القوالب
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const quickEntry = quickViewId ? entries.find((entry) => entry.id === quickViewId) ?? null : null;
  const categoryLabels = surface.categories
    .map((id) => TEMPLATE_CATEGORIES.find((category) => category.id === id)?.title)
    .filter(Boolean) as string[];

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current={TEMPLATES_ROUTE} />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 md:py-10">
        <nav className="text-[11px] font-bold text-muted">
          <a href={TEMPLATES_ROUTE} className="hover:text-brand">
            القوالب
          </a>
          <span className="mx-1.5">/</span>
          <span className="text-ink">{surface.title}</span>
        </nav>

        <header className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
              NASAQ · TEMPLATES
            </p>
            <h1 className="mt-1.5 text-[26px] font-extrabold text-ink">{surface.title}</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-7 text-muted">{surface.purpose}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {surface.audience.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[10.5px] font-bold text-muted"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={createPathFor({ start: "blank" })}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              مستند فارغ
            </a>
            <a
              href={STUDIO_ROUTE}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-navy px-3.5 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2"
            >
              <Sparkles className="size-4 text-gold" aria-hidden />
              توليد بالذكاء الاصطناعي
            </a>
          </div>
        </header>

        <p className="mt-5 rounded-xl border border-line bg-surface px-4 py-3 text-[12px] leading-6 text-muted">
          <span className="font-extrabold text-ink">من أين تبدأ: </span>
          {surface.startHere}
          {categoryLabels.length > 0 && (
            <span className="text-muted"> (فئات المكتبة: {categoryLabels.join(" · ")})</span>
          )}
        </p>

        {/* Sibling surfaces — the six public doors, not the internal taxonomy. */}
        <div className="mt-5 flex flex-wrap gap-1.5">
          {TEMPLATE_CATEGORY_SURFACES.map((item) => (
            <a
              key={item.id}
              href={categoryPathFor(item.id)}
              title={item.purpose}
              className={cn(
                "rounded-full border px-3 py-1 text-[11.5px] font-bold transition",
                item.id === surface.id
                  ? "border-brand bg-navy/5 text-brand"
                  : "border-line bg-surface text-muted hover:border-brand hover:text-ink",
              )}
            >
              {item.title}
            </a>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11.5px] font-semibold text-muted">
            {inFamily.length ? `${inFamily.length} قالبًا في هذه العائلة` : "لا قوالب في هذه العائلة بعد"}
          </p>
          <a
            href={templatesFilterPathFor(
              surface.galleryPill ? { pill: surface.galleryPill } : {},
            )}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-[12px] font-bold text-ink transition hover:border-brand"
          >
            <LayoutTemplate className="size-3.5" aria-hidden />
            عرض القوالب بكل الفلاتر
          </a>
        </div>

        {inFamily.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {inFamily.map((entry) => {
              const locked = entryRequiresLicense(entry, entitlements);
              return (
                <TemplateCard
                  key={entry.id}
                  entry={entry}
                  href={templatePathFor(entrySlug(entry))}
                  locked={locked}
                  available={!locked}
                  actions={{
                    onUse: () => void run(entry, "use"),
                    onQuickView: () => setQuickViewId(entry.id),
                    onDuplicate: () => void run(entry, "duplicate"),
                  }}
                />
              );
            })}
          </div>
        )}

        <p className="mt-8 flex items-start gap-2 text-[12px] leading-6 text-muted">
          <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden />
          كل قالب يفتح في صفحته الخاصة أولًا (معاينة، تفاصيل، وزر «استخدام القالب») — ولا
          يفتح المحرر إلا بعد اختيارك.
        </p>
      </main>

      <SiteFooter />

      {quickEntry && (
        <QuickViewDialog
          entry={quickEntry}
          themeId={theme}
          onClose={() => setQuickViewId(null)}
          onUse={() => {
            setQuickViewId(null);
            void run(quickEntry, "use");
          }}
          onDuplicate={() => void run(quickEntry, "duplicate")}
        />
      )}
    </div>
  );
}
