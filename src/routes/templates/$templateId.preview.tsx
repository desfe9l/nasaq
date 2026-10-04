import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, LayoutTemplate } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TemplatePreviewPage } from "@/components/site/TemplatePreviewPage";
import { useCatalogEntries } from "@/components/site/useCatalog";
import { useEditor } from "@/lib/editor/store";
import { findEntryBySlug } from "@/lib/templates/entry-slug";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { templateDisplaySlug } from "@/lib/templates/published";
import type { AdminTemplateSummary } from "@/lib/admin/types";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { TEMPLATES_ROUTE, templatePathFor } from "@/lib/site-routes";

/**
 * `/templates/<idOrSlug>/preview` — the full-page preview.
 *
 * A preview is something people link to, so it has an address of its own: the
 * template's real pages at reading size. Viewing never creates a document, and
 * the editor is reached only from «استخدام القالب» on the template's page.
 */
export const Route = createFileRoute("/templates/$templateId/preview")({
  ssr: false,
  head: () => ({ meta: [{ title: "معاينة قالب | نَسَق" }] }),
  component: PreviewRoute,
});

function PreviewRoute() {
  const { templateId } = Route.useParams();
  const hydrate = useEditor((s) => s.hydrate);
  const orgName = useEditor((s) => s.orgName);
  const entries = useCatalogEntries("official", orgName);
  const [fallback, setFallback] = useState<AdminTemplateSummary | null | "pending">("pending");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const entry = useMemo(() => findEntryBySlug(entries, templateId), [entries, templateId]);

  /* A published record has no local pages: its own preview is its page. */
  useEffect(() => {
    if (entry) return;
    let alive = true;
    void getPublishedTemplateMetaFn({ data: { idOrSlug: templateId } })
      .then((result) => {
        if (alive) setFallback(result.ok && result.template ? result.template : null);
      })
      .catch(() => {
        if (alive) setFallback(null);
      });
    return () => {
      alive = false;
    };
  }, [entry, templateId]);

  if (entry) return <TemplatePreviewPage slug={templateId} />;

  if (fallback === "pending") {
    return (
      <div className="min-h-screen bg-paper">
        <PageSkeleton />
      </div>
    );
  }

  if (fallback) {
    const slug = templateDisplaySlug(fallback);
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/templates" />
        <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
          <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <a href={TEMPLATES_ROUTE} className="font-bold hover:text-brand-hover">
              القوالب
            </a>
            <span aria-hidden>/</span>
            <a href={templatePathFor(slug)} className="font-bold hover:text-brand-hover">
              {fallback.title}
            </a>
            <span aria-hidden>/</span>
            <span className="font-bold text-ink">معاينة</span>
          </nav>
          <h1 className="mt-4 text-[22px] font-extrabold text-ink">{fallback.title}</h1>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {fallback.description?.trim() ||
              "قالب منشور في المنصة — المعاينة الكاملة متاحة من صفحة القالب."}
          </p>
          <div className="mt-5 grid place-items-center rounded-2xl border border-line bg-surface-2 p-6">
            {fallback.thumbnail ? (
              <img
                src={fallback.thumbnail}
                alt={`معاينة ${fallback.title}`}
                className="max-h-[70vh] w-full max-w-3xl rounded-lg border border-line bg-white object-contain"
              />
            ) : (
              <p className="py-20 text-[13px] text-muted">لا تتوفر معاينة لهذا القالب.</p>
            )}
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/templates" />
      <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <div className="rounded-full bg-line-2 p-6">
          <LayoutTemplate className="size-10 text-muted" aria-hidden />
        </div>
        <h1 className="mt-6 text-2xl font-black text-ink">القالب غير متاح</h1>
        <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
          قد يكون القالب محذوفًا أو غير منشور — تصفّح الكتالوج لاختيار قالب آخر.
        </p>
        <a
          href={TEMPLATES_ROUTE}
          className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-6 text-[14px] font-bold text-on-brand"
        >
          <ArrowRight className="size-4" aria-hidden />
          تصفح القوالب
        </a>
      </main>
      <SiteFooter />
    </div>
  );
}
