/*
 * «مشاركة القالب» — `/templates/<slug>/share`.
 *
 * A sharing surface, not a dialog: the link is readable, copyable and openable
 * in one click, with the template's own preview beside it so the person sending
 * it can see what the recipient will see. Every template — from the local
 * catalogue or from the published records — has this page, because a template
 * that cannot be linked cannot be shared with a team.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Copy, Eye, LayoutTemplate, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import { useCatalogEntries } from "@/components/site/useCatalog";
import { useEditor } from "@/lib/editor/store";
import { pageSize } from "@/lib/editor/model";
import { pagesLabel } from "@/lib/templates/catalog";
import { entrySlug, findEntryBySlug } from "@/lib/templates/entry-slug";
import { getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { templateDisplaySlug } from "@/lib/templates/published";
import type { AdminTemplateSummary } from "@/lib/admin/types";
import {
  TEMPLATES_ROUTE,
  templatePathFor,
  templatePreviewPathFor,
  templateShortPathFor,
} from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export function TemplateSharePage({ slug }: { slug: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const orgName = useEditor((s) => s.orgName);
  const entries = useCatalogEntries("official", orgName);
  const [published, setPublished] = useState<AdminTemplateSummary | null>(null);
  const [resolving, setResolving] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const entry = useMemo(() => findEntryBySlug(entries, slug), [entries, slug]);

  /* A published record resolves over the network; a catalogue entry is local. */
  useEffect(() => {
    if (entry) {
      setResolving(false);
      return;
    }
    let alive = true;
    setResolving(true);
    void getPublishedTemplateMetaFn({ data: { idOrSlug: slug } })
      .then((result) => {
        if (!alive) return;
        setPublished(result.ok && result.template ? result.template : null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setResolving(false);
      });
    return () => {
      alive = false;
    };
  }, [slug, entry]);

  const title = entry?.title ?? published?.title ?? null;

  /* The absolute address of the template's own page — never the editor. */
  const canonicalPath = entry
    ? templatePathFor(entrySlug(entry))
    : published
      ? templatePathFor(templateDisplaySlug(published))
      : null;
  const previewPath = entry
    ? templatePreviewPathFor(entrySlug(entry))
    : published
      ? templatePreviewPathFor(templateDisplaySlug(published))
      : null;
  /*
   * What gets copied is the SHORT link (`/t/<code>`) whenever the published row
   * has one: it is the address people paste into a chat, a slide or an email,
   * and it resolves to this very template page. The descriptive
   * `/templates/<slug>` address stays available as «صفحة القالب».
   */
  const shortPath = published?.shortCode ? templateShortPathFor(published.shortCode) : null;
  const sharePath = shortPath || canonicalPath;
  const absolute =
    sharePath && typeof window !== "undefined"
      ? new URL(sharePath, window.location.origin).href
      : sharePath;

  const copy = async () => {
    if (!absolute) return;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      toast.success("تم نسخ رابط القالب");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر نسخ الرابط");
    }
  };

  if (!entry && !published) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/templates" />
        <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <div className="rounded-full bg-line-2 p-6">
            {resolving ? (
              <Sparkles className="size-10 animate-pulse text-muted" aria-hidden />
            ) : (
              <LayoutTemplate className="size-10 text-muted" aria-hidden />
            )}
          </div>
          <h1 className="mt-6 text-2xl font-black text-ink">
            {resolving ? "جارٍ التحقق من القالب…" : "القالب غير متاح"}
          </h1>
          {!resolving && (
            <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
              قد يكون القالب محذوفًا أو غير منشور — يمكنك مشاركة أي قالب من
              صفحته بعد اختياره من الكتالوج.
            </p>
          )}
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

  const page = entry?.pages[0] ?? null;
  const size = page ? pageSize(page) : null;

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/templates" />

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <a href={TEMPLATES_ROUTE} className="font-bold hover:text-brand-hover">
            القوالب
          </a>
          <span aria-hidden>/</span>
          {canonicalPath && (
            <>
              <a href={canonicalPath} className="font-bold hover:text-brand-hover">
                {title}
              </a>
              <span aria-hidden>/</span>
            </>
          )}
          <span className="font-bold text-ink">مشاركة</span>
        </nav>

        <div className="mt-5 grid gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
              NASAQ · SHARE
            </p>
            <h1 className="mt-1.5 text-[26px] font-extrabold text-ink">
              مشاركة «{title}»
            </h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-7 text-muted">
              الرابط التالي يفتح صفحة القالب نفسها — معاينة وتفاصيل وزر «استخدام
              القالب». لا يفتح المحرر، ولا يمنح أي تعديل على نسختك.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <input
                readOnly
                dir="ltr"
                value={absolute ?? ""}
                aria-label="رابط القالب"
                onFocus={(event) => event.currentTarget.select()}
                className="h-11 min-w-[260px] flex-1 rounded-[10px] border border-line bg-surface px-3 text-[12.5px] font-bold text-ink outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2"
              >
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? "تم النسخ" : "نسخ الرابط"}
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {canonicalPath && (
                <a
                  href={canonicalPath}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand"
                >
                  صفحة القالب
                </a>
              )}
              {previewPath && (
                <a
                  href={previewPath}
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand"
                >
                  <Eye className="size-4" aria-hidden />
                  المعاينة الكاملة
                </a>
              )}
            </div>

            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <Fact label="النوع">
                {entry
                  ? `${entry.kindLabel} · ${entry.categoryLabel}`
                  : published?.category || "قالب منشور"}
              </Fact>
              <Fact label="الصفحات">
                {entry
                  ? pagesLabel(entry.pages.length)
                  : published
                    ? "قالب منشور في المنصة"
                    : "—"}
              </Fact>
              <Fact label="المقاس">
                {size ? (
                  <span dir="ltr" className="tabular-nums">
                    {Math.round(size.w)} × {Math.round(size.h)} مم
                  </span>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label="الوصول">
                {entry?.managedTemplate?.tier === "licensed" ||
                published?.tier === "licensed"
                  ? "يتطلب ترخيصًا"
                  : "متاح للجميع"}
              </Fact>
            </dl>
          </section>

          <aside className="grid content-start gap-3">
            <div className="grid place-items-center rounded-2xl border border-line bg-surface-2 p-4 shadow-card">
              {page ? (
                <div className="w-full" style={{ maxWidth: size && size.w > size.h ? "100%" : "80%" }}>
                  <TemplatePreview
                    page={page}
                    className="rounded-[3px] border border-line shadow-lg"
                  />
                </div>
              ) : published?.thumbnail ? (
                <img
                  src={published.thumbnail}
                  alt={`معاينة ${published.title}`}
                  className="max-h-[420px] w-full rounded-lg border border-line object-contain"
                />
              ) : (
                <p className="py-16 text-[12px] text-muted">لا تتوفر معاينة.</p>
              )}
            </div>
            <p className={cn("text-[11px] leading-6 text-muted")}>
              تُشارك القوالب المخصّصة كرابط لهذه الصفحة؛ أما نسخ القوالب الشخصية
              ذات المحتوى الخاص فتُشارك من صفحة «القوالب المشتركة».
            </p>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <dt className="text-[10px] font-bold text-muted">{label}</dt>
      <dd className="mt-1 text-[12.5px] font-extrabold text-ink">{children}</dd>
    </div>
  );
}
