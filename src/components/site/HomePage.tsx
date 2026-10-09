import { useState, useEffect } from "react";
import { ArrowLeft, ChevronDown, Briefcase, FileText, LayoutTemplate, FileDown, Palette, ShieldCheck, Workflow, Files, Building2, Megaphone, PenTool, FolderOpen, Layers, Shapes } from "lucide-react";
import { PACKS } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { CREATE_ROUTE, editorPathFor } from "@/lib/site-routes";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { PRODUCT_COPY } from "@/lib/product/copy";
import { CARD_W, CARD_WRAP, SITE_CARD } from "@/components/site/cards";
import { LiveEditorPreview } from "@/components/site/LiveEditorPreview";
import {
  useSiteSettings,
  usePublishedTemplatesState,
} from "@/lib/admin/use-site-settings";
import { useEditorEntry } from "@/lib/auth/use-editor-entry";
import { WORKSPACE_HOME_PATH, openNewDocumentFlow, useWorkspaceEntry } from "@/lib/auth/use-workspace-entry";
import { ProjectFileButton } from "@/components/site/ProjectFileButton";
import { LicenseBadge } from "@/components/site/LicenseBadge";
import { PricingSection } from "@/components/site/PricingSection";
import { PremiumTemplates } from "@/components/site/PremiumTemplates";
import { ProductEcosystem, ProductWalkthrough } from "@/components/site/ProductWalkthrough";
import { PremiumButton } from "@/components/ui/PremiumButton";
import { useReveal } from "@/components/ui/useReveal";
import { cn } from "@/lib/utils";

const HIGHLIGHTS: { icon: typeof FileText; title: string; desc: string }[] = [
  { icon: FileText, title: "تصميم التقارير والوثائق المؤسسية", desc: "مستندات عربية قابلة للتحرير مع صفحات بمقاسات متعددة." },
  { icon: LayoutTemplate, title: "قوالب جاهزة للاستخدام", desc: "ابدأ من تكوينات المستند والقوالب المتاحة داخل المحرر." },
  { icon: FolderOpen, title: "مكتبة عناصار وملفات", desc: "احفظ الأصول المرئية وأعد استخدامها في مشاريعك." },
  { icon: Layers, title: "إدارة الصفحات والعناصر", desc: "أضف الصفحات ونظّم العناصر والطبقات ضمن المستند." },
  { icon: Shapes, title: "أدوات تحرير متقدمة", desc: "حرّر النصوص والصور والأشكال والجداول والمؤشرات." },
  { icon: Palette, title: "دعم الهوية البصرية", desc: "اضبط الألوان والخطوط والشعار وعناصر المستند." },
  { icon: FileDown, title: "تصدير الملفات بصيغ متعددة", desc: "أخرج ملفات PDF وPNG وJPG وWord وPowerPoint وغيرها حسب الصلاحية." },
  { icon: Files, title: "مشاريع محفوظة محليًا", desc: "واصل العمل على ملفاتك ومشاريعك المحفوظة في المتصفح." },
];

const AUDIENCE = [
  { icon: Building2, title: "الشركات والمؤسسات", desc: "تقارير أداء وإحصائيات وخطابات رسمية بهوية موحدة." },
  { icon: Briefcase, title: "الإدارات التنفيذية", desc: "عروض تنفيذية وملفات تعريفية وتقارير دورية." },
  { icon: Megaphone, title: "إدارات الإعلام والاتصال", desc: "إنتاج يومي منظم للمخرجات الإعلامية والمؤسسية." },
  { icon: PenTool, title: "المصممون وصناع التقارير", desc: "تحكم دقيق بالعناصر والخطوط والتصدير دون تعقيد." },
];

/** Two-row subheading used by feature cards: an icon tile + label + desc. */
function FeatureCard({
  icon: Icon,
  title,
  desc,
  revealOrder = 0,
}: {
  icon: typeof FileText;
  title: string;
  desc: string;
  revealOrder?: number;
}) {
  const [ref, visible] = useReveal<HTMLDivElement>({ delay: revealOrder * 60 });
  return (
    <div
      ref={ref}
      className={cn("nsq-card is-interactive", visible && "is-revealed")}
      data-animate
    >
      <div className="nsq-card-content flex items-start gap-4">
        <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-[9px] border border-brand/10 bg-navy/5 text-brand">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-extrabold text-ink">{title}</h3>
          <p className="mt-1 text-[12px] leading-[1.55] text-muted nsq-wrap">
            {desc}
          </p>
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const projects = useEditor((s) => s.projects);
  const projectsLoading = useEditor((s) => s.projectsLoading);
  const hydrate = useEditor((s) => s.hydrate);
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
  const { items: publishedTemplates, loading: templatesLoading } =
    usePublishedTemplatesState();
  /**
   * The hero editor runs the Admin-featured catalog record when there is one.
   * When that selection is empty — or the record stopped being public — the
   * hero falls back to the bundled document instead of disappearing: the live
   * editor is part of the hero's design, not an optional extra.
   */
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

  const openEditor = (id: string) => {
    window.location.assign(editorPathFor(id));
  };

  const heroReady = entry.ready && workspace.ready;
  const heroHref = heroReady
    ? workspace.licensed
      ? WORKSPACE_HOME_PATH
      : CREATE_ROUTE
    : undefined;
  const heroLabel = workspace.licensed
    ? "مساحة العمل"
    : entry.ready && entry.direct
      ? "إنشاء تصميم"
      : entry.ready
        ? entry.label
        : "ابدأ بالتصميم";

  const [heroRef, heroVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [featuresRef, featuresVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [audienceRef, audienceVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [projectsRef, projectsVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [packsRef, packsVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [highlightsRef, highlightsVisible] = useReveal<HTMLElement>({ delay: 120 });

  return (
    <div className="min-h-full bg-page">
      <SiteHeader current="/" />
      <main>
        {/* ── Hero ── */}
        <section
          ref={heroRef}
          className={cn("border-b border-line/70 bg-page", heroVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container grid gap-10 py-[3.5rem] sm:py-[4.5rem] lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-22">
            <div className="flex flex-col">
              <p className="nsq-eyebrow self-start">
                {texts.heroEyebrow.trim() || PRODUCT_COPY.hero.eyebrow}
              </p>
              <h1 className="nsq-title mt-3 max-w-2xl text-[2rem] leading-[1.25] sm:text-[2.5rem] md:text-[2.75rem]">
                {texts.heroTitle.trim() || PRODUCT_COPY.hero.title}
              </h1>
              <p className="nsq-lede mt-4">
                {texts.heroDescription.trim() || PRODUCT_COPY.hero.description}
              </p>
              <p className="nsq-wrap mt-2 max-w-xl text-[0.9rem] leading-[1.55] text-muted">
                منصة واحدة لإعداد التقارير السنوية ولوحات المؤشرات والخطابات الرسمية والعروض التنفيذية، مع التزام كامل بالهوية المؤسسية وجودة طباعة 300 DPI.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <PremiumButton
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    if (heroHref) window.location.assign(heroHref);
                  }}
                  aria-disabled={!heroReady}
                  icon={ArrowLeft}
                  iconPosition="end"
                >
                  {heroLabel}
                </PremiumButton>
                <PremiumButton
                  variant="outline"
                  size="md"
                  onClick={() => window.location.assign("/purchase")}
                >
                  استعراض الخطط والأسعار
                </PremiumButton>
                <PremiumButton
                  variant="ghost"
                  size="md"
                  onClick={() => window.location.assign("/projects")}
                >
                  كل مشاريعي
                </PremiumButton>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="nsq-badge nsq-badge--neutral">تخزين محلي أولًا</span>
                <span className="nsq-badge nsq-badge--neutral">جاهز للطباعة 300 DPI</span>
                <span className="nsq-badge nsq-badge--neutral">دعم الخطوط العربية الرسمية</span>
              </div>

              <p className="nsq-wrap mt-4 text-[0.8rem] leading-[1.5] text-muted">
                {PRODUCT_COPY.demoNote}
              </p>

              <div className="nsq-wrap mt-3 flex flex-wrap items-center gap-3">
                <ProjectFileButton />
                <span className="text-[0.8rem] text-muted">
                  افتح ملف نَسَق ‎.nsq‎ أو نسخة احتياطية محفوظة سابقًا
                </span>
              </div>
            </div>

            <LiveEditorPreview
              document={featuredDocument}
              pending={templatesLoading}
            />
          </div>
        </section>

        <ProductWalkthrough />

        {/* ── What we offer ── */}
        <section
          ref={featuresRef}
          className={cn("border-b border-line/60 bg-page py-[2.5rem] sm:py-[3.5rem]", featuresVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="max-w-2xl">
              <p className="nsq-section-eyebrow">ماذا تقدم نَسَق</p>
              <h2 className="nsq-section-title mt-2.5 text-[1.45rem] sm:text-[1.75rem]">
                إنتاج بصري منظم للمخرجات المتكررة
              </h2>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <FeatureCard
                icon={Briefcase}
                title="للفرق المؤسسية"
                desc="إنتاج منظم للمخرجات المتكررة مع حفظ الهوية."
                revealOrder={0}
              />
              <FeatureCard
                icon={Workflow}
                title="لسير العمل الحقيقي"
                desc="من البيانات والهيكل إلى ملف جاهز للعرض والطباعة."
                revealOrder={1}
              />
              <FeatureCard
                icon={ShieldCheck}
                title="لعمل آمن ومنظم"
                desc="تخزين محلي أولًا ومسار واضح للترخيص والتصدير."
                revealOrder={2}
              />
            </div>
          </div>
        </section>

        {/* ── Who it's for ── */}
        <section
          ref={audienceRef}
          className={cn("border-b border-line/60 bg-surface-2 py-[2.5rem] sm:py-[3.5rem]", audienceVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="nsq-section-eyebrow">لمن تناسب</p>
                <h2 className="nsq-section-title mt-2.5 text-[1.45rem] sm:text-[1.75rem]">
                  مصممة للجهات والمؤسسات والفرق المحترفة
                </h2>
                <p className="nsq-wrap mt-2 text-[0.9rem] leading-[1.55] text-muted">
                  توفر نَسَق بيئة عمل تناسب المتطلبات الرسمية، مع التزام بالهوية البصرية والجودة الطباعية وسهولة إعادة الاستخدام عبر القوالب.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {AUDIENCE.map((c) => (
                  <div
                    key={c.title}
                    className={cn(
                      "nsq-card flex items-start gap-4",
                      audienceVisible && "is-revealed",
                    )}
                    data-animate
                  >
                    <div className="nsq-card-content flex flex-col items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-brand/10 bg-navy/5 text-brand">
                        <c.icon className="size-4" />
                      </span>
                      <div>
                        <h3 className="text-[14px] font-extrabold text-ink">{c.title}</h3>
                        <p className="nsq-wrap mt-1 text-[12px] leading-[1.55] text-muted">
                          {c.desc}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Recent projects ── */}
        <section
          ref={projectsRef}
          className={cn("border-b border-line/60 bg-page py-[2.5rem] sm:py-[3.5rem]", projectsVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[1.125rem] font-extrabold text-ink">
                أحدث المشاريع
              </h2>
              <button
                type="button"
                onClick={toggleRecent}
                aria-expanded={!recentHidden}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-[0.75rem] font-bold text-muted transition hover:text-ink"
              >
                {recentHidden ? "إظهار" : "إخفاء"}
                <ChevronDown
                  className={`size-3.5 transition-transform ${recentHidden ? "" : "rotate-180"}`}
                  aria-hidden
                />
              </button>
            </div>
            {!recentHidden && (
              <p className="nsq-wrap mt-1 text-[0.85rem] text-muted">
                الصفحات تُحفظ محليًا في متصفحك، مع اتصال عند الحاجة للترخيص أو الذكاء الاصطناعي.
              </p>
            )}
            {recentHidden ? null : projectsLoading ? (
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-[148px] animate-pulse rounded-[12px] border border-line bg-surface-2"
                  />
                ))}
              </div>
            ) : recent.length ? (
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {recent.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onOpen={openEditor}
                    compact
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6 rounded-[12px] border border-dashed border-line bg-surface-2 p-8 text-center">
                <p className="text-[14px] font-bold text-ink">
                  لا توجد مشاريع بعد
                </p>
                <p className="nsq-wrap mt-1 text-[12px] text-muted">
                  ابدأ بتقرير رسمي جاهز أو بصفحة فارغة.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── Template packs ── */}
        <section
          ref={packsRef}
          className={cn("border-b border-line/60 bg-surface-2 py-[2.5rem] sm:py-[3.5rem]", packsVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <h2 className="text-[1.125rem] font-extrabold text-ink">
              قوالب البداية
            </h2>
            <p className="nsq-wrap mt-1 text-[0.85rem] text-muted">
              كل قالب ينشئ نسخة جديدة داخل مشروعك.
            </p>
            <div className={`mt-6 ${CARD_WRAP}`}>
              {PACKS.map((pack) => (
                <div
                  key={pack.id}
                  className={cn(
                    "nsq-card p-5 text-right",
                    CARD_W,
                    SITE_CARD,
                    packsVisible && "is-revealed",
                  )}
                  data-animate
                >
                  <div
                    className="flex flex-col p-5 text-right"
                    onClick={() =>
                      pack.id === "blank"
                        ? startBlank()
                        : window.location.assign("/templates")
                    }
                    role={pack.id === "blank" ? undefined : "link"}
                    aria-label={
                      pack.id === "blank"
                        ? "فتح صفحة فارغة"
                        : `استعراض قوالب ${pack.title}`
                    }
                    tabIndex={0}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-ink">
                        <FileText className="size-4" />
                      </span>
                      <span className="text-[0.7rem] font-bold text-muted">
                        {pack.pages}
                      </span>
                    </div>
                    <strong className="block text-[14px] font-bold text-ink">
                      {pack.title}
                    </strong>
                    <span className="nsq-wrap mt-1 block text-[12px] leading-[1.5] text-muted">
                      {pack.desc}
                    </span>
                    <span className="mt-auto pt-4">
                      {pack.id === "blank" ? (
                        <LicenseBadge
                          state="licensed"
                          size="sm"
                          label={
                            workspace.licensed
                              ? "مساحة العمل"
                              : entry.ready && entry.direct
                                ? "فتح المحرر"
                                : "فتح العرض"
                          }
                          title={
                            workspace.licensed
                              ? "الدخول إلى مساحة العمل"
                              : "فتح المحرر"
                          }
                        />
                      ) : (
                        <LicenseBadge
                          state={workspace.licensed ? "licensed" : "locked"}
                          size="sm"
                          label={
                            workspace.licensed
                              ? "متاح بترخيصك"
                              : "استعراض القوالب"
                          }
                          title="استعراض القوالب الحقيقية ومعاينتها وفق ترخيصك"
                        />
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Premium templates ── */}
        <PremiumTemplates />

        {/* ── Features ── */}
        <section
          ref={highlightsRef}
          className={cn("border-t border-line/60 bg-surface-2 py-[2.5rem] sm:py-[3.5rem]", highlightsVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <p className="nsq-section-eyebrow">الميزات والخدمات الأساسية</p>
            <h2 className="nsq-section-title mt-2.5 text-[1.5rem] sm:text-[1.75rem]">
              أدوات متخصصة لإنتاج المستند المؤسسي
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HIGHLIGHTS.map((h, i) => (
                <FeatureCard
                  key={h.title}
                  icon={h.icon}
                  title={h.title}
                  desc={h.desc}
                  revealOrder={i}
                />
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <PremiumButton
                variant="outline"
                size="md"
                onClick={() => window.location.assign("/templates")}
              >
                استعراض القوالب
              </PremiumButton>
              <PremiumButton
                variant="outline"
                size="md"
                onClick={() => window.location.assign("/purchase")}
              >
                الخطط والأسعار
              </PremiumButton>
            </div>
          </div>
        </section>

        <ProductEcosystem />

        {/* ── Pricing ── */}
        <PricingSection onStartFree={startFree} />
      </main>
      <SiteFooter />
    </div>
  );
}
