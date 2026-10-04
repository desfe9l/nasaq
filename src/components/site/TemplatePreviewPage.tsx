/*
 * «معاينة القالب» — `/templates/<slug>/preview`.
 *
 * The full-page preview: the template's real pages, at the width of the screen,
 * page by page, with the template's own facts beside them. It exists as its own
 * address because a preview is a thing people link to ("look at this one") and
 * because opening a document should never be the price of looking at it.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, LayoutTemplate } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import { useCatalogEntries } from "@/components/site/useCatalog";
import { useEditor } from "@/lib/editor/store";
import { pageSize } from "@/lib/editor/model";
import { pagesLabel } from "@/lib/templates/catalog";
import { entrySlug, findEntryBySlug } from "@/lib/templates/entry-slug";
import {
  TEMPLATES_ROUTE,
  createPathFor,
  templatePathFor,
  templateSharePathFor,
} from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export function TemplatePreviewPage({ slug }: { slug: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const orgName = useEditor((s) => s.orgName);
  const entries = useCatalogEntries("official", orgName);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const entry = useMemo(() => findEntryBySlug(entries, slug), [entries, slug]);

  useEffect(() => {
    setIndex(0);
  }, [slug]);

  if (!entry) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/templates" />
        <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <div className="rounded-full bg-line-2 p-6">
            <LayoutTemplate className="size-10 text-muted" aria-hidden />
          </div>
          <h1 className="mt-6 text-2xl font-black text-ink">القالب غير متاح</h1>
          <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
            قد يكون القالب محذوفًا أو ينتمي إلى حساب آخر على هذا المتصفح.
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

  const page = entry.pages[Math.min(index, entry.pages.length - 1)];
  const size = pageSize(page);
  const landscape = size.w > size.h;

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/templates" />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <a href={TEMPLATES_ROUTE} className="font-bold hover:text-brand-hover">
            القوالب
          </a>
          <span aria-hidden>/</span>
          <a href={templatePathFor(entrySlug(entry))} className="font-bold hover:text-brand-hover">
            {entry.title}
          </a>
          <span aria-hidden>/</span>
          <span className="font-bold text-ink">معاينة</span>
        </nav>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-extrabold text-ink">{entry.title}</h1>
            <p className="mt-1 text-[12px] text-muted">
              {entry.kindLabel} · {entry.categoryLabel} · {pagesLabel(entry.pages.length)} ·{" "}
              <span dir="ltr" className="tabular-nums">
                {Math.round(size.w)} × {Math.round(size.h)} مم
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={templateSharePathFor(entrySlug(entry))}
              className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              مشاركة القالب
            </a>
            <a
              href={createPathFor()}
              className="inline-flex h-10 items-center rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2"
            >
              إنشاء تصميم فارغ
            </a>
          </div>
        </div>

        {/* The page canvas: real pages, at reading size. */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="grid place-items-center rounded-2xl border border-line bg-surface-2 p-4 sm:p-8">
            <div
              className="w-full"
              style={{ maxWidth: landscape ? "100%" : "620px" }}
            >
              <TemplatePreview
                page={page}
                className="rounded-[4px] border border-line shadow-xl"
              />
            </div>
          </div>

          <aside className="grid content-start gap-3">
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="text-[11px] font-extrabold text-muted">
                الصفحة {index + 1} من {entry.pages.length}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  aria-label="الصفحة السابقة"
                  className="grid size-9 place-items-center rounded-lg border border-line text-ink transition hover:bg-line-2 disabled:opacity-40"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setIndex((i) => Math.min(entry.pages.length - 1, i + 1))
                  }
                  disabled={index >= entry.pages.length - 1}
                  aria-label="الصفحة التالية"
                  className="grid size-9 place-items-center rounded-lg border border-line text-ink transition hover:bg-line-2 disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {entry.pages.slice(0, 6).map((thumb, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`الصفحة ${i + 1}`}
                  aria-pressed={i === index}
                  className={cn(
                    "overflow-hidden rounded-lg border bg-white p-0.5 transition",
                    i === index ? "border-brand ring-2 ring-navy/20" : "border-line hover:border-brand",
                  )}
                >
                  <TemplatePreview page={thumb} className="rounded-[2px]" />
                </button>
              ))}
            </div>

            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.slice(0, 8).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-line px-2.5 py-1 text-[10px] font-bold text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
