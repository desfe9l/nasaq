/*
 * Template detail — `/templates/<slug>` for a catalogue entry.
 *
 * The gallery's cards used to be buttons: nothing about a template was an
 * address. This page is that address. It shows the real pages, the facts
 * (kind, category, size, page count, licence tier), and the actions — with
 * «استخدام القالب» as the one that opens the editor, and only after the author
 * has chosen it.
 *
 * Managed (published) template records keep their own page
 * (`PublicTemplatePage`), which the same route renders when the slug resolves
 * server-side; this component is the local-catalogue counterpart.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Copy,
  Eye,
  Lock,
  Pencil,
  Share2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import { useCatalogEntries } from "@/components/site/useCatalog";
import { useEditor } from "@/lib/editor/store";
import { pageSize } from "@/lib/editor/model";
import { pagesLabel } from "@/lib/templates/catalog";
import { entrySlug, findEntryBySlug } from "@/lib/templates/entry-slug";
import {
  duplicateTemplateEntry,
  editTemplateEntry,
  entryRequiresLicense,
  startFromTemplateEntry,
  type TemplateActionResult,
} from "@/lib/templates/entry-actions";
import { useLicense } from "@/lib/license/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  LICENSE_ROUTE,
  TEMPLATES_ROUTE,
  createPathFor,
  editorPathFor,
  templatePathFor,
  templatePreviewPathFor,
  templateSharePathFor,
} from "@/lib/site-routes";
import { cn } from "@/lib/utils";

export function TemplateDetailPage({ slug }: { slug: string }) {
  const hydrate = useEditor((s) => s.hydrate);
  const orgName = useEditor((s) => s.orgName);
  const storeTheme = useEditor((s) => s.theme);
  const entries = useCatalogEntries("official", orgName);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);
  const [busy, setBusy] = useState<"use" | "edit" | "duplicate" | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const entry = useMemo(() => findEntryBySlug(entries, slug), [entries, slug]);

  const context = useMemo(
    () => ({ theme: storeTheme ?? "official", orgName, entitlements }),
    [storeTheme, orgName, entitlements],
  );

  /**
   * One place that turns an action result into either an address or a reason.
   * A licence block sends the author to the licence page — never into the
   * editor, and never into a silent nothing.
   */
  const handleResult = useCallback((result: TemplateActionResult) => {
    if (result.status === "opened") {
      window.location.assign(editorPathFor(result.projectId));
      return;
    }
    if (result.status === "duplicated") {
      toast.success(`تم حفظ «${result.title}» في قوالبي الخاصة`);
      window.location.assign(templatePathFor(`custom-${result.templateId}`));
      return;
    }
    if (result.status === "blocked") {
      if (result.reason === "license") {
        toast.error("هذا القالب متاح في النسخة الكاملة", {
          description: "اطلب الترخيص ثم استخدم القالب من صفحته.",
        });
        window.location.assign(LICENSE_ROUTE);
        return;
      }
      toast.error(result.message ?? "تعذر تنفيذ العملية");
    }
  }, []);

  const run = useCallback(
    async (kind: "use" | "edit" | "duplicate") => {
      if (!entry || busy) return;
      setBusy(kind);
      try {
        const result =
          kind === "use"
            ? await startFromTemplateEntry(entry, context)
            : kind === "edit"
              ? await editTemplateEntry(entry, context)
              : await duplicateTemplateEntry(entry, context);
        handleResult(result);
      } finally {
        setBusy(null);
      }
    },
    [entry, busy, context, handleResult],
  );

  if (!entry) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/templates" />
        <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <div className="rounded-full bg-line-2 p-6">
            <Sparkles className="size-10 text-muted" aria-hidden />
          </div>
          <h1 className="mt-6 text-2xl font-black text-ink">القالب غير متاح</h1>
          <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
            قد يكون القالب محذوفًا أو ينتمي إلى حساب آخر على هذا المتصفح — تصفّح
            الكتالوج لاختيار قالب آخر.
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

  const locked = entryRequiresLicense(entry, entitlements);
  const index = Math.min(pageIndex, entry.pages.length - 1);
  const page = entry.pages[index];
  const size = pageSize(entry.pages[0]);
  const slugForEntry = entrySlug(entry);
  const isManaged = Boolean(entry.managedTemplate);

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/templates" />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <nav aria-label="مسار التنقل" className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <a href={TEMPLATES_ROUTE} className="font-bold hover:text-brand-hover">
            القوالب
          </a>
          <span aria-hidden>/</span>
          <span className="font-bold text-ink">{entry.title}</span>
        </nav>

        <div className="mt-4 grid gap-7 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* Real pages — the template itself, not a mock-up. */}
          <aside className="grid content-start gap-3">
            <div
              className={cn(
                "grid place-items-center rounded-2xl border border-line bg-surface-2 p-4 shadow-card",
                locked && "relative",
              )}
            >
              <div className="w-full" style={{ maxWidth: size.w > size.h ? "100%" : "86%" }}>
                <TemplatePreview
                  page={page}
                  className="rounded-[3px] border border-line shadow-lg"
                />
              </div>
              {locked && (
                <span className="absolute inset-x-4 bottom-4 inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy/90 px-3 py-2 text-[11px] font-extrabold text-on-brand">
                  <Lock className="size-3.5" aria-hidden />
                  متاح في النسخة الكاملة
                </span>
              )}
            </div>
            {entry.pages.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {entry.pages.slice(0, 8).map((thumb, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPageIndex(i)}
                    aria-label={`الصفحة ${i + 1}`}
                    aria-pressed={i === index}
                    className={cn(
                      "overflow-hidden rounded-lg border bg-white p-0.5 transition",
                      i === index
                        ? "border-brand ring-2 ring-navy/20"
                        : "border-line hover:border-brand",
                    )}
                  >
                    <TemplatePreview page={thumb} className="rounded-[2px]" />
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">
              NASAQ · TEMPLATE
            </p>
            <h1 className="mt-1.5 text-[27px] font-extrabold text-ink">{entry.title}</h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-7 text-muted">
              {entry.desc ||
                "قالب نَسَق احترافي جاهز للتحرير — استخدمه لإنشاء نسخة مستقلة في مشاريعك، أو عاينه وشاركه قبل ذلك."}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge>{entry.kindLabel}</Badge>
              <Badge>{entry.categoryLabel}</Badge>
              <Badge>{pagesLabel(entry.pages.length)}</Badge>
              <Badge ltr>
                {Math.round(size.w)} × {Math.round(size.h)} مم
              </Badge>
              <Badge>{locked ? "يتطلب ترخيصًا" : "متاح الآن"}</Badge>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void run("use")}
                disabled={busy !== null}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-5 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-60"
              >
                <Sparkles className="size-4" aria-hidden />
                {busy === "use" ? "جارٍ الإنشاء…" : "استخدام القالب"}
              </button>
              <button
                type="button"
                onClick={() => void run("edit")}
                disabled={busy !== null}
                className={GHOST}
              >
                <Pencil className="size-4" aria-hidden />
                {busy === "edit" ? "جارٍ الفتح…" : "تعديل القالب"}
              </button>
              <button
                type="button"
                onClick={() => void run("duplicate")}
                disabled={busy !== null}
                className={GHOST}
              >
                <Copy className="size-4" aria-hidden />
                تكرار إلى قوالبي
              </button>
              <a href={templatePreviewPathFor(slugForEntry)} className={GHOST}>
                <Eye className="size-4" aria-hidden />
                معاينة كاملة
              </a>
              <a href={templateSharePathFor(slugForEntry)} className={GHOST}>
                <Share2 className="size-4" aria-hidden />
                مشاركة
              </a>
            </div>

            {locked && (
              <div className="mt-5 rounded-xl border border-gold/50 bg-gold/10 p-4">
                <p className="text-[13px] font-extrabold text-ink">
                  هذا القالب ضمن القوالب المميزة
                </p>
                <p className="mt-1 text-[12px] leading-6 text-muted">
                  يمكنك معاينته ودراسته الآن. لاستخدامه أو تعديله، فعّل الترخيص
                  المناسب لجهتك.
                </p>
                <a
                  href={LICENSE_ROUTE}
                  className="mt-3 inline-flex h-9 items-center rounded-lg bg-navy px-3 text-[12px] font-extrabold text-on-brand"
                >
                  عرض التراخيص
                </a>
              </div>
            )}

            <dl className="mt-6 grid gap-3 sm:grid-cols-2">
              <Fact label="الرابط الثابت">
                <code dir="ltr" className="text-[11px] font-bold">
                  {templatePathFor(slugForEntry)}
                </code>
              </Fact>
              <Fact label="المصدر">
                {isManaged
                  ? "سجل قالب منشور في المنصة"
                  : entry.kind === "custom"
                    ? "قالب من قوالبي الخاصة"
                    : entry.kind === "pack"
                      ? "حزمة نَسَق جاهزة"
                      : "صفحة نَسَق جاهزة"}
              </Fact>
            </dl>

            <p className="mt-5 text-[12px] leading-6 text-muted">
              «استخدام القالب» ينشئ مستندًا جديدًا في مشاريعك ويفتحه في المحرر
              على رابطه الخاص؛ أما المعاينة فهذه الصفحة وصفحة «مشاركة» — لا يفتح
              المحرر إلا بعد أن تختار.
            </p>

            <a
              href={createPathFor()}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              بدء تصميم فارغ بمقاس تختاره
            </a>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

const GHOST =
  "inline-flex h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[13px] font-bold text-ink transition hover:border-brand disabled:opacity-60";

function Badge({ children, ltr }: { children: React.ReactNode; ltr?: boolean }) {
  return (
    <span
      className="rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-bold text-muted"
      dir={ltr ? "ltr" : undefined}
    >
      {children}
    </span>
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
