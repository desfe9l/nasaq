import { useEffect, useRef, useState } from "react";
import { LayoutTemplate, Share2, Lock, Crown, FileText, ArrowLeft, Copy, Check, Sparkles, Eye } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { getPublishedTemplateFn, getPublishedTemplateMetaFn } from "@/lib/admin/functions";
import { publishedTemplatePath, templateDisplaySlug, publishedTemplateAbsoluteUrl } from "@/lib/templates/published";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import { useEditor } from "@/lib/editor/store";
import { DEMO_LICENSE, canCreateDemoProject } from "@/lib/product/product";
import { publishedTemplateSeed } from "@/lib/templates/published";
import type { AdminTemplateSummary } from "@/lib/admin/types";

interface Props {
  initialTemplate?: AdminTemplateSummary | null;
  templateId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  general: "عام",
  annual: "تقارير سنوية",
  letters: "خطابات رسمية",
  minutes: "محاضر",
  presentations: "عروض",
  plans: "خطط تشغيلية",
  certificates: "شهادات",
  infographic: "إنفوجرافيك",
  reports: "تقارير",
  editorial: "تحريرية",
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat || "قالب";
}

export function PublicTemplatePage({ initialTemplate, templateId }: Props) {
  const [template, setTemplate] = useState<AdminTemplateSummary | null>(initialTemplate ?? null);
  const [loadingMeta, setLoadingMeta] = useState(initialTemplate === undefined);
  const [notFound, setNotFound] = useState(initialTemplate === null);
  const [using, setUsing] = useState(false);
  const [copied, setCopied] = useState(false);
  const { isPending: userPending } = useCurrentUserState();
  const { entitlements, isLoading: licenseLoading } = useLicense();
  const opened = useRef<string | null>(null);

  // Fetch meta if not provided (client fallback, SSR should provide)
  useEffect(() => {
    if (initialTemplate !== undefined) return;
    let alive = true;
    setLoadingMeta(true);
    void (async () => {
      try {
        const res = await getPublishedTemplateMetaFn({ data: { idOrSlug: templateId } });
        if (!alive) return;
        if (res.ok && res.template) {
          setTemplate(res.template);
        } else {
          setNotFound(true);
        }
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [templateId, initialTemplate]);

  const handleCopy = async () => {
    const slug = template ? templateDisplaySlug(template) : templateId;
    const url = publishedTemplateAbsoluteUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("تم نسخ رابط القالب");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذر نسخ الرابط");
    }
  };

  const handleUse = async () => {
    if (!template) return;
    if (using || opened.current === template.id) return;
    setUsing(true);
    try {
      // Re-check entitlement for licensed templates via server payload endpoint
      const result = await getPublishedTemplateFn({ data: { id: templateDisplaySlug(template) } });
      if (!result.ok) {
        if ("locked" in result && result.locked) {
          toast.error("هذا القالب متاح في النسخة الكاملة", {
            description: "يمكنك طلب الترخيص للوصول إلى جميع القوالب المميزة.",
          });
          window.location.assign("/license");
          return;
        }
        toast.error(result.error || "القالب غير متاح");
        setNotFound(true);
        return;
      }
      const seed = publishedTemplateSeed(result.template);
      const editor = useEditor.getState();
      await editor.hydrate();
      const current = useEditor.getState();
      if (!entitlements.unlimited_projects && !canCreateDemoProject(current.projects.length)) {
        toast.error("اكتملت مساحة تجربة المحرر", {
          description: "يتضمن العرض مشروعًا واحدًا. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
        });
        window.location.assign("/license");
        return;
      }
      const maxPages = DEMO_LICENSE.entitlements.maxPagesPerProject ?? Infinity;
      if (!entitlements.unlimited_pages && seed.pages.length > maxPages) {
        toast.error("وصلت إلى حد صفحات تجربة المحرر", {
          description: "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        window.location.assign("/license");
        return;
      }
      const imported = await current.importProject(seed, { successMessage: null });
      if (imported) {
        opened.current = template.id;
        toast.success(`تم إنشاء نسخة من «${template.title}»`);
        window.location.assign("/editor");
      } else {
        toast.error("تعذر فتح القالب في المحرر");
      }
    } catch (e) {
      console.error(e);
      toast.error("حدث خطأ أثناء فتح القالب");
    } finally {
      setUsing(false);
    }
  };

  const isLicensed = template?.tier === "licensed";
  const canAccessLicensed = entitlements.premium_templates || false;
  const needsLicense = isLicensed && !canAccessLicensed && !licenseLoading;

  if (loadingMeta) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/templates" />
        <main className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <div className="animate-pulse grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="aspect-[210/297] rounded-2xl bg-line-2" />
            <div className="grid gap-4">
              <div className="h-8 w-2/3 rounded bg-line-2" />
              <div className="h-4 w-full rounded bg-line-2" />
              <div className="h-4 w-5/6 rounded bg-line-2" />
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (notFound || !template) {
    return (
      <div className="min-h-full bg-paper">
        <SiteHeader current="/templates" />
        <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6">
          <div className="rounded-full bg-line-2 p-6">
            <LayoutTemplate className="size-10 text-muted" />
          </div>
          <h1 className="mt-6 text-2xl font-black text-ink">القالب غير متاح</h1>
          <p className="mt-3 max-w-md text-[14px] leading-7 text-muted">
            قد يكون هذا القالب غير منشور، أو تمت أرشفته، أو الرابط غير صحيح. تصفح القوالب المنشورة لاكتشاف تصاميم جاهزة.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="/templates" className="inline-flex h-11 items-center gap-2 rounded-xl bg-navy px-6 text-[14px] font-bold text-on-brand">
              <ArrowLeft className="size-4" />
              تصفح القوالب
            </a>
            <a href="/" className="inline-flex h-11 items-center rounded-xl border border-line px-6 text-[14px] font-bold">
              الصفحة الرئيسية
            </a>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const displaySlug = templateDisplaySlug(template);
  const canonical = publishedTemplateAbsoluteUrl(displaySlug);
  const ogImage = template.thumbnail && template.thumbnail.startsWith("data:") ? undefined : template.thumbnail || undefined;

  return (
    <div className="min-h-full bg-paper" dir="rtl">
      <SiteHeader current="/templates" />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-[12px] text-muted">
          <a href="/" className="hover:text-ink">الرئيسية</a>
          <span>/</span>
          <a href="/templates" className="hover:text-ink">القوالب</a>
          <span>/</span>
          <span className="font-bold text-ink truncate">{template.title}</span>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          {/* Preview */}
          <div className="order-1">
            <div className="group relative overflow-hidden rounded-[20px] border border-line bg-surface shadow-card">
              <div className="absolute right-4 top-4 z-10 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/90 px-3 py-1 text-[11px] font-extrabold text-ink shadow-sm backdrop-blur">
                  <FileText className="size-3.5" />
                  {categoryLabel(template.category)}
                </span>
                {isLicensed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-3 py-1 text-[11px] font-extrabold text-warning shadow-sm">
                    <Crown className="size-3.5" />
                    النسخة الكاملة
                  </span>
                )}
              </div>

              <div className="grid place-items-center bg-gradient-to-br from-paper via-surface-2 to-line-2/50 p-6 sm:p-10">
                {template.thumbnail ? (
                  <div className="relative w-full max-w-[420px]">
                    <div className="absolute -inset-3 rounded-[18px] bg-navy/5 blur-xl" aria-hidden />
                    <img
                      src={template.thumbnail}
                      alt={template.title}
                      className="relative aspect-[210/297] w-full rounded-[14px] border border-line bg-white object-contain shadow-xl"
                      loading="eager"
                    />
                  </div>
                ) : (
                  <div className="grid aspect-[210/297] w-full max-w-[420px] place-items-center rounded-[14px] border border-dashed border-line bg-white p-8 text-center shadow-sm">
                    <div>
                      <LayoutTemplate className="mx-auto size-12 text-muted" />
                      <p className="mt-3 text-[13px] font-bold text-muted">معاينة القالب</p>
                      <p className="mt-1 text-[11px] text-muted">{template.title}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 bg-surface-2/60 px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <Eye className="size-3.5" />
                  <span>معاينة حقيقية — ما تراه هو ما يفتح في المحرر</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[11px] font-bold transition hover:border-brand"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "تم النسخ" : "نسخ الرابط"}
                </button>
              </div>
            </div>

            {/* Social proof / SEO text */}
            <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
              <h2 className="text-[14px] font-black text-ink">عن هذا القالب</h2>
              <p className="mt-2 text-[13px] leading-7 text-muted">
                {template.description?.trim() ||
                  `قالب ${template.title} من نَسَق — جاهز للتحرير والطباعة، مع دعم كامل للهوية المؤسسية والخطوط العربية الرسمية.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full border border-line px-3 py-1 text-[11px] font-bold text-muted">
                  {template.kind === "svg" ? "SVG متجهي" : "مشروع نَسَق"}
                </span>
                <span className="rounded-full border border-line px-3 py-1 text-[11px] font-bold text-muted">
                  {categoryLabel(template.category)}
                </span>
                <span className="rounded-full border border-line px-3 py-1 text-[11px] font-bold text-muted">
                  {isLicensed ? "مرخص" : "مجاني"}
                </span>
              </div>
            </div>
          </div>

          {/* Details & CTA */}
          <div className="order-2 grid gap-5 lg:sticky lg:top-24">
            <div className="rounded-[20px] border border-line bg-surface p-6 shadow-card sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="grid size-9 place-items-center rounded-xl bg-navy text-on-brand">
                      <Sparkles className="size-5" />
                    </span>
                    <span className="text-[11px] font-extrabold tracking-widest text-muted">NASAQ TEMPLATE</span>
                  </div>
                  <h1 className="mt-4 text-[26px] font-black leading-tight text-ink sm:text-[30px]">{template.title}</h1>
                  {template.description && (
                    <p className="mt-3 text-[14px] leading-7 text-muted">{template.description}</p>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                <button
                  type="button"
                  onClick={handleUse}
                  disabled={using || userPending || licenseLoading}
                  className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-navy px-6 text-[15px] font-black text-on-brand shadow-sm transition hover:bg-navy-2 disabled:opacity-60"
                >
                  {using ? (
                    "جارٍ فتح القالب…"
                  ) : (
                    <>
                      <span>استخدام هذا القالب</span>
                      <ArrowLeft className="size-4" />
                    </>
                  )}
                </button>

                {needsLicense ? (
                  <div className="rounded-xl border border-gold/30 bg-gold/10 p-4">
                    <div className="flex items-start gap-3">
                      <Lock className="mt-0.5 size-4 text-warning" />
                      <div>
                        <p className="text-[13px] font-bold text-ink">هذا القالب ضمن النسخة الكاملة</p>
                        <p className="mt-1 text-[12px] leading-6 text-muted">
                          يمكنك معاينته مجانًا، وعند الاستخدام سيُطلب ترخيص ساري للوصول إلى المحتوى الكامل.
                        </p>
                        <a
                          href="/license"
                          className="mt-3 inline-flex h-9 items-center rounded-lg bg-inverse px-4 text-[12px] font-bold text-on-inverse"
                        >
                          ترقية إلى النسخة الكاملة
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-[11px] leading-5 text-muted">
                    يفتح كنسخة مستقلة في مساحتك — القالب الأصلي يبقى محفوظًا بدون تعديل. التخزين محلي أولًا.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[13px] font-bold transition hover:bg-line-2"
                  >
                    <Share2 className="size-4" />
                    مشاركة القالب
                  </button>
                  <a
                    href="/templates"
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface text-[13px] font-bold transition hover:bg-line-2"
                  >
                    تصفح القوالب
                  </a>
                </div>
              </div>

              <div className="mt-6 border-t border-line/70 pt-5">
                <h3 className="text-[12px] font-extrabold text-muted">ماذا يحدث بعد الضغط؟</h3>
                <ol className="mt-3 grid gap-2 text-[12px] leading-6 text-muted">
                  <li className="flex gap-2">
                    <span className="font-black text-ink">1.</span>
                    <span>يُنشئ نَسَق نسخة مستقلة من القالب في مساحتك الخاصة.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-black text-ink">2.</span>
                    <span>تفتح النسخة في المحرر — تعديل كامل للعناصر والخطوط والألوان.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-black text-ink">3.</span>
                    <span>عند الحاجة لميزة مرخصة، يظهر خيار الترقية الحالي في نَسَق.</span>
                  </li>
                </ol>
              </div>

              <div className="mt-5 flex items-center gap-2 rounded-xl bg-paper p-3 text-[11px] text-muted">
                <div className="size-2 rounded-full bg-success animate-pulse" />
                <span>رابط عام مستقر — صالح للمشاركة على واتساب، تيليجرام، X، وكل أنظمة معاينة الروابط</span>
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-surface p-5">
              <h3 className="text-[13px] font-bold text-ink">رابط المشاركة التسويقي</h3>
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-muted" dir="ltr">
                  {canonical}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-navy px-3 text-[11px] font-bold text-on-brand"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  نسخ
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                الرابط يعتمد على معرّف ثابت <span className="font-mono" dir="ltr">{displaySlug}</span> ومقاوم للتصادم، ويمكن تعطيله بإلغاء نشر القالب.
              </p>
            </div>

            <div className="rounded-2xl bg-navy p-5 text-on-brand">
              <h3 className="text-[14px] font-black">نَسَق — منصة التقارير المؤسسية</h3>
              <p className="mt-2 text-[12px] leading-6 text-white/80">
                محرر احترافي لإعداد التقارير السنوية، الخطابات الرسمية، العروض التنفيذية ولوحات المؤشرات بجودة طباعية 300 DPI ودعم كامل للعربية.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="/purchase" className="inline-flex h-9 items-center rounded-lg bg-white px-4 text-[12px] font-bold text-navy">
                  الخطط والأسعار
                </a>
                <a href="/editor" className="inline-flex h-9 items-center rounded-lg border border-white/20 px-4 text-[12px] font-bold">
                  فتح المحرر
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Hidden SEO helpers for crawlers */}
        <div className="sr-only">
          <span>{template.title}</span>
          <span>{template.description}</span>
          <span>{categoryLabel(template.category)}</span>
          {ogImage && <img src={ogImage} alt="" />}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
