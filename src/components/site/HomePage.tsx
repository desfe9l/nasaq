import { useState, useEffect } from "react";
import { ArrowLeft, ChevronDown, Briefcase, FileText, LayoutTemplate, FileDown, Palette, ShieldCheck, Workflow, Files, Building2, Megaphone, PenTool, FolderOpen, Layers, Shapes } from "lucide-react";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { PRODUCT_COPY } from "@/lib/product/copy";
import { CARD_W, CARD_WRAP, SITE_CARD } from "@/components/site/cards";
import { LiveEditorPreview } from "@/components/site/LiveEditorPreview";
import {
  useSiteSettings,
  usePublishedTemplates,
} from "@/lib/admin/use-site-settings";
import { useEditorEntry } from "@/lib/auth/use-editor-entry";
import { WORKSPACE_HOME_PATH, openNewDocumentFlow, useWorkspaceEntry } from "@/lib/auth/use-workspace-entry";
import { ProjectFileButton } from "@/components/site/ProjectFileButton";
import { LicenseBadge } from "@/components/site/LicenseBadge";
import { PricingSection } from "@/components/site/PricingSection";
import { PremiumTemplates } from "@/components/site/PremiumTemplates";
import { ProductEcosystem, ProductWalkthrough } from "@/components/site/ProductWalkthrough";

const HIGHLIGHTS: { icon: typeof FileText; title: string; desc: string }[] = [
  { icon: FileText, title: "تصميم التقارير والوثائق المؤسسية", desc: "مستندات عربية قابلة للتحرير مع صفحات بمقاسات متعددة." },
  { icon: LayoutTemplate, title: "قوالب جاهزة للاستخدام", desc: "ابدأ من تكوينات المستند والقوالب المتاحة داخل المحرر." },
  { icon: FolderOpen, title: "مكتبة عناصر وملفات", desc: "احفظ الأصول المرئية وأعد استخدامها في مشاريعك." },
  { icon: Layers, title: "إدارة الصفحات والعناصر", desc: "أضف الصفحات ونظّم العناصر والطبقات ضمن المستند." },
  { icon: Shapes, title: "أدوات تحرير متقدمة", desc: "حرّر النصوص والصور والأشكال والجداول والمؤشرات." },
  { icon: Palette, title: "دعم الهوية البصرية", desc: "اضبط الألوان والخطوط والشعار وعناصر المستند." },
  { icon: FileDown, title: "تصدير الملفات بصيغ متعددة", desc: "أخرج ملفات PDF وPNG وJPG وWord وPowerPoint وغيرها حسب الصلاحية." },
  { icon: Files, title: "مشاريع محفوظة محليًا", desc: "واصل العمل على ملفاتك ومشاريعك المحفوظة في المتصفح." },
];

export function HomePage() {
  const projects = useEditor((s) => s.projects);
  const projectsLoading = useEditor((s) => s.projectsLoading);
  const hydrate = useEditor((s) => s.hydrate);
  const openProject = useEditor((s) => s.openProject);
  const [recentHidden, setRecentHidden] = useState(false);
  useEffect(() => {
    try {
      setRecentHidden(localStorage.getItem("nasaq-home-recent-hidden") === "1");
    } catch {
      /* private mode: the section just stays open */
    }
  }, []);
  const toggleRecent = () =>
    setRecentHidden((hidden) => {
      try {
        localStorage.setItem("nasaq-home-recent-hidden", hidden ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !hidden;
    });
  /**
   * «صفحة فارغة» entry.
   *
   * A signed-in account gets a real blank project inside the editor; only a
   * visitor with no session is sent to the limited demo page. Whether the
   * account is licensed is not this component's business — the editor applies
   * the server's entitlements once it opens.
   */
  const { entry, openNewDocument } = useEditorEntry();
  // A licensed account starts from its Home and configures new documents there.
  const workspace = useWorkspaceEntry();
  const startBlank = () => {
    if (!workspace.ready || !entry.ready) return;
    if (workspace.licensed) openNewDocumentFlow();
    else if (entry.direct) void openNewDocument();
    else window.location.assign("/demo");
  };
  /**
   * «ابدأ مجانًا» — the free plan's action button in the pricing section.
   * Same door as the hero call-to-action: a licensed account lands on its Home,
   * anyone else enters the editor (`/demo` for a visitor with no session).
   */
  const startFree = () => {
    if (!workspace.ready || !entry.ready) return;
    if (workspace.licensed) window.location.assign(WORKSPACE_HOME_PATH);
    else window.location.assign(entry.href);
  };
  const { texts } = useSiteSettings();
  const publishedTemplates = usePublishedTemplates();
  const featuredDocument = publishedTemplates.find(
    (item) =>
      item.id === texts.featuredTemplateId &&
      item.status === "published" &&
      item.tier === "free",
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const recent = projects.slice(0, 3);

  const openEditor = async (id: string) => {
    if (await openProject(id)) window.location.assign("/editor");
  };

  return (
    <div className="min-h-full bg-page ">
      <SiteHeader current="/" />
      <main>
        {/* Hero — مؤسسي رسمي هادئ */}
        <section className="border-b border-line/70 bg-page">
          <div
            className={`mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 py-14 sm:px-6 ${
              featuredDocument ? "lg:grid-cols-[1.05fr_0.95fr]" : "lg:grid-cols-1"
            } lg:items-center lg:py-20`}
          >
            <div>
              <div className="mb-5 inline-flex items-center rounded-full border border-brand/15 bg-navy/5 px-3.5 py-1.5 text-[11px] font-bold tracking-wide text-ink">
                {texts.heroEyebrow.trim() || PRODUCT_COPY.hero.eyebrow}
              </div>
              <h1 className="max-w-2xl text-[30px] font-extrabold leading-[1.25] text-ink sm:text-[40px]">
                {texts.heroTitle.trim() || PRODUCT_COPY.hero.title}
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-8 text-muted">
                {texts.heroDescription.trim() || PRODUCT_COPY.hero.description}
              </p>
              <p className="mt-3 max-w-xl text-[13px] leading-6 text-muted">
                منصة واحدة لإعداد التقارير السنوية ولوحات المؤشرات والخطابات الرسمية والعروض التنفيذية، مع التزام كامل بالهوية المؤسسية وجودة طباعة 300 DPI.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a
                  href={entry.ready && workspace.ready ? (workspace.licensed ? WORKSPACE_HOME_PATH : entry.href) : undefined}
                  onClick={(event) => {
                    if (!workspace.ready || !entry.ready) event.preventDefault();
                  }}
                  aria-disabled={!workspace.ready || !entry.ready}
                  className="inline-flex h-12 items-center gap-2.5 rounded-[10px] bg-navy px-7 text-[15px] font-extrabold text-on-brand shadow-sm transition hover:bg-navy-2 aria-disabled:pointer-events-none aria-disabled:opacity-60"
                >
                  <span>ابدأ بالتصميم</span>
                  <ArrowLeft className="size-[18px]" />
                </a>
                <a href="/purchase" className="inline-flex h-11 items-center rounded-[10px] border border-line bg-surface px-5 text-[13px] font-bold text-ink transition hover:bg-surface-2 hover:border-line/80">
                  استعراض الخطط والأسعار
                </a>
                <a href="/projects" className="inline-flex h-11 items-center rounded-[10px] px-3 text-[13px] font-bold text-muted underline-offset-4 transition hover:text-ink hover:underline">
                  كل مشاريعي
                </a>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted">تخزين محلي أولًا</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted">جاهز للطباعة 300 DPI</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] font-semibold text-muted">دعم الخطوط العربية الرسمية</span>
              </div>

              <p className="mt-5 text-[11px] leading-6 text-muted">{PRODUCT_COPY.demoNote}</p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ProjectFileButton />
                <span className="text-[11px] text-muted">افتح ملف ‎.nsq‎ أو نسخة JSON محفوظة سابقًا</span>
              </div>
            </div>

            {featuredDocument && (
              <LiveEditorPreview document={featuredDocument} />
            )}
          </div>
        </section>

        <ProductWalkthrough />

        {/* ماذا تقدم — القدرات الأساسية */}
        <section className="border-b border-line/60 bg-page py-12 sm:py-14">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-[11px] font-bold tracking-[0.14em] text-brand">ماذا تقدم نَسَق</p>
              <h2 className="mt-2 text-[22px] font-extrabold text-ink">إنتاج بصري منظم للمخرجات المتكررة</h2>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                [Briefcase, "للفرق المؤسسية", "إنتاج منظم للمخرجات المتكررة مع حفظ الهوية."],
                [Workflow, "لسير العمل الحقيقي", "من البيانات والهيكل إلى ملف جاهز للعرض والطباعة."],
                [ShieldCheck, "لعمل آمن ومنظم", "تخزين محلي أولًا ومسار واضح للترخيص والتصدير."],
              ].map(([Icon, title, desc]) => (
                <div key={String(title)} className="flex gap-3 rounded-[12px] border border-line/60 bg-surface-2 p-4 transition-all duration-200 hover:border-line/80 hover:shadow-card">
                  <span className="grid size-9 place-items-center rounded-[9px] border border-brand/10 bg-navy/5 text-brand">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <strong className="block text-[13px] font-bold text-ink">{String(title)}</strong>
                    <span className="mt-1 block text-[12px] leading-6 text-muted">{String(desc)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* لمن تناسب — مؤسسي */}
        <section className="border-b border-line/60 bg-surface-2 py-12 sm:py-14">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="text-[11px] font-bold tracking-[0.14em] text-brand">لمن تناسب</p>
                <h2 className="mt-2 text-[22px] font-extrabold text-ink">مصممة للجهات والمؤسسات والفرق المحترفة</h2>
                <p className="mt-2 text-[13px] leading-7 text-muted">توفر نَسَق بيئة عمل تناسب المتطلبات الرسمية، مع التزام بالهوية البصرية والجودة الطباعية وسهولة إعادة الاستخدام عبر القوالب.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Building2, title: "الشركات والمؤسسات", desc: "تقارير أداء وإحصائيات وخطابات رسمية بهوية موحدة." },
                  { icon: Briefcase, title: "الإدارات التنفيذية", desc: "عروض تنفيذية وملفات تعريفية وتقارير دورية." },
                  { icon: Megaphone, title: "إدارات الإعلام والاتصال", desc: "إنتاج يومي منظم للمخرجات الإعلامية والمؤسسية." },
                  { icon: PenTool, title: "المصممون وصناع التقارير", desc: "تحكم دقيق بالعناصر والخطوط والتصدير دون تعقيد." },
                ].map((c) => (
                  <div key={c.title} className="flex gap-3 rounded-[12px] border border-line/60 bg-surface p-4 transition-all duration-200 hover:border-line/80 hover:shadow-card">
                    <c.icon className="mt-0.5 size-4 shrink-0 text-ink" />
                    <div>
                      <h3 className="text-[13px] font-bold text-ink">{c.title}</h3>
                      <p className="mt-1 text-[12px] leading-6 text-muted">{c.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* أحدث المشاريع */}
        <section className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[18px] font-bold text-ink ">أحدث المشاريع</h2>
            <button
              type="button"
              onClick={toggleRecent}
              aria-expanded={!recentHidden}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-[12px] font-bold text-muted hover:text-ink"
            >
              {recentHidden ? "إظهار" : "إخفاء"}
              <ChevronDown className={`size-3.5 transition-transform ${recentHidden ? "" : "rotate-180"}`} aria-hidden />
            </button>
          </div>
          {!recentHidden && (
            <p className="mt-1 text-[13px] text-muted ">المشاريع تُحفظ محليًا في متصفحك، مع اتصال عند الحاجة للترخيص أو الذكاء الاصطناعي.</p>
          )}
          {recentHidden ? null : projectsLoading ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-[120px] animate-pulse rounded-[12px] border border-line bg-surface-2 " />)}
            </div>
          ) : recent.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {recent.map((p) => <ProjectCard key={p.id} project={p} onOpen={openEditor} compact />)}
            </div>
          ) : (
            <div className="mt-6 rounded-[12px] border border-dashed border-line bg-surface-2 p-8 text-center ">
              <p className="text-[13px] font-bold text-ink ">لا توجد مشاريع بعد</p>
              <p className="mt-1 text-[12px] text-muted ">ابدأ بتقرير رسمي جاهز أو بصفحة فارغة.</p>
            </div>
          )}
        </section>

        {/* قوالب البداية */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
          <h2 className="text-[18px] font-bold text-ink ">قوالب البداية</h2>
          <p className="mt-1 text-[13px] text-muted ">كل قالب ينشئ نسخة جديدة داخل مشروعك.</p>
          <div className={`mt-6 ${CARD_WRAP}`}>
            {PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() =>
                  pack.id === "blank"
                    ? startBlank()
                    : window.location.assign("/templates")
                }
                aria-label={pack.id === "blank" ? "فتح صفحة فارغة" : `استعراض قوالب ${pack.title}`}
                className={`flex flex-col rounded-[12px] border border-line/70 bg-surface p-5 text-right hover:border-inverse/20 ${CARD_W} ${SITE_CARD}`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="grid size-8 place-items-center rounded-[8px] bg-surface-2 text-ink">
                    <FileText className="size-4" />
                  </span>
                  <span className="text-[11px] text-muted">{pack.pages}</span>
                </div>
                <strong className="block text-[14px] font-bold text-ink">{pack.title}</strong>
                <span className="mt-1 block text-[12px] leading-5 text-muted">{pack.desc}</span>
                  <span className="mt-auto pt-4">
                    {pack.id === "blank"
                      ? <LicenseBadge state="licensed" size="sm" label={workspace.licensed ? "مساحة العمل" : entry.ready && entry.direct ? "فتح المحرر" : "فتح العرض"} title={workspace.licensed ? "الدخول إلى مساحة العمل" : "فتح المحرر"} />
                      : <LicenseBadge
                          state={workspace.licensed ? "licensed" : "locked"}
                          size="sm"
                          label={workspace.licensed ? "متاح بترخيصك" : "استعراض القوالب"}
                          title="استعراض القوالب الحقيقية ومعاينتها وفق ترخيصك"
                        />
                    }
                  </span>
              </button>
            ))}
          </div>
        </section>

        {/* قوالب مميزة — the paid shelf, always populated (see PremiumTemplates). */}
        <PremiumTemplates />

        {/* ماذا تتضمن المنصة */}
        <section className="border-t border-line/60 bg-surface-2 py-12 sm:py-14">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <p className="text-[11px] font-bold tracking-[0.14em] text-brand">الميزات والخدمات الأساسية</p>
            <h2 className="mt-2 text-[23px] font-extrabold text-ink">أدوات متخصصة لإنتاج المستند المؤسسي</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {HIGHLIGHTS.map((h) => {
                const Icon = h.icon;
                return (
                  <div key={h.title} className="rounded-[14px] border border-line/60 bg-surface p-5 transition-all duration-200 hover:border-line/80 hover:shadow-card">
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 place-items-center rounded-[8px] border border-brand/10 bg-navy/5 text-brand">
                        <Icon className="size-4" />
                      </span>
                      <div>
                        <strong className="block text-[13px] font-bold text-ink">{h.title}</strong>
                        <p className="mt-1 text-[12px] leading-6 text-muted">{h.desc}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/templates" className="inline-flex h-10 items-center rounded-[10px] bg-inverse px-5 text-[13px] font-bold text-on-inverse transition hover:bg-inverse-hover">استعراض القوالب</a>
              <a href="/purchase" className="inline-flex h-10 items-center rounded-[10px] border border-line bg-surface px-5 text-[13px] font-bold text-ink transition hover:bg-surface-2">الخطط والأسعار</a>
            </div>
          </div>
        </section>

        <ProductEcosystem />

        {/* الخطط والأسعار — مفتاح الفوترة وبطاقات قابلة للشراء */}
        <PricingSection onStartFree={startFree} />
      </main>
      <SiteFooter />
    </div>
  );
}
