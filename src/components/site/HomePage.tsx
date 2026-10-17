import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Briefcase,
  FileText,
  LayoutTemplate,
  FileDown,
  Palette,
  ShieldCheck,
  Workflow,
  Files,
  Building2,
  Megaphone,
  PenTool,
  FolderOpen,
  Layers,
  Shapes,
  BadgeCheck,
  CheckCircle2,
  FileUp,
  Type,
} from "lucide-react";
import { PACKS, createProject } from "@/lib/editor/templates";
import { useEditor } from "@/lib/editor/store";
import { CREATE_ROUTE, editorPathFor } from "@/lib/site-routes";
import { SemanticDocCard, SEMANTIC_DOC_ITEMS } from "@/components/site/SemanticDocCards";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ProjectCard } from "@/components/site/ProjectCard";
import { PRODUCT_COPY } from "@/lib/product/copy";
import { CARD_PREVIEW_H, CARD_W, CARD_WRAP, SITE_CARD } from "@/components/site/cards";
import { LiveEditorPreview } from "@/components/site/LiveEditorPreview";
import { TemplateSheetPreview } from "@/components/site/TemplatePreview";
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
import { Badge } from "@/components/ui/Badge";
import { useReveal } from "@/components/ui/useReveal";
import { cn } from "@/lib/utils";

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

const AUDIENCE = [
  { icon: Building2, title: "الشركات والمؤسسات", desc: "تقارير أداء وإحصائيات وخطابات رسمية بهوية موحدة." },
  { icon: Briefcase, title: "الإدارات التنفيذية", desc: "عروض تنفيذية وملفات تعريفية وتقارير دورية." },
  { icon: Megaphone, title: "إدارات الإعلام والاتصال", desc: "إنتاج يومي منظم للمخرجات الإعلامية والمؤسسية." },
  { icon: PenTool, title: "المصممون وصناع التقارير", desc: "تحكم دقيق بالعناصر والخطوط والتصدير دون تعقيد." },
];

/**
 * Three working principles, folded out of the retired «ماذا تقدم» card row.
 *
 * The three bordered cards repeated what the hero, the walkthrough and the
 * feature list already say; as one compact hairline list inside the audience
 * section the same three points stay on the page without a third identical
 * card grid in the first two screens.
 */
const FOUNDATIONS = [
  { icon: Briefcase, title: "للفرق المؤسسية", copy: "إنتاج منظم للمخرجات المتكررة مع حفظ الهوية." },
  { icon: Workflow, title: "لسير العمل الحقيقي", copy: "من البيانات والهيكل إلى ملف جاهز للعرض والطباعة." },
  { icon: ShieldCheck, title: "لعمل آمن ومنظم", copy: "تخزين محلي أولًا ومسار واضح للترخيص والتصدير." },
];

/**
 * One starter-pack card, painted from the pack's OWN pages.
 *
 * The card used to be an icon-and-text tile with no preview at all — five
 * identical text boxes under a «قوالب البداية» heading, the same shape as the
 * feature cards one section below. It now shows the first real page of the
 * pack through the shared `TemplateSheetPreview` stage, so «6 صفحات» is
 * visible, not just written, and the shelf reads as documents rather than as
 * more cards.
 */
function PackCard({
  pack,
  badge,
  href,
  onClick,
  revealed,
}: {
  pack: { id: string; title: string; desc: string; pages: string; page: ReturnType<typeof createProject>["pages"][number] };
  badge: React.ReactNode;
  href?: string;
  onClick?: () => void;
  revealed: boolean;
}) {
  const body = (
    <>
      <div className="shrink-0 border-b border-line/70 bg-paper/70">
        <TemplateSheetPreview
          page={pack.page}
          height={CARD_PREVIEW_H - 56}
          className="p-3"
          paperClassName="rounded-[3px] shadow-sm transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
        />
      </div>
      <div className="flex flex-1 flex-col p-4 text-right">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-[14px] font-extrabold text-ink">
            {pack.title}
          </strong>
          <span className="shrink-0 rounded-full bg-line-2 px-2 py-0.5 text-[10px] font-bold text-muted">
            {pack.pages}
          </span>
        </div>
        <p className="nsq-wrap mt-1.5 flex-1 text-[12px] leading-6 text-muted">
          {pack.desc}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/70 pt-3">
          {badge}
          <ArrowLeft className="size-3.5 shrink-0 text-brand" aria-hidden />
        </div>
      </div>
    </>
  );
  const className = cn(
    "group flex flex-col overflow-hidden rounded-2xl bg-surface",
    SITE_CARD,
    CARD_W,
    revealed && "is-revealed",
  );
  if (href) {
    return (
      <a
        href={href}
        className={className}
        data-animate
        aria-label={`استعراض قوالب ${pack.title}`}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(className, "text-start")}
      data-animate
      aria-label="فتح صفحة فارغة"
    >
      {body}
    </button>
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
  const [audienceRef, audienceVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [projectsRef, projectsVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [packsRef, packsVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [highlightsRef, highlightsVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [importRef, importVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [brandRef, brandVisible] = useReveal<HTMLElement>({ delay: 120 });
  const [aboutRef, aboutVisible] = useReveal<HTMLElement>({ delay: 120 });

  return (
    <div className="min-h-full bg-page pb-20 md:pb-0">
      <SiteHeader current="/" />
      <main>
        {/* ── Hero ── */}
        <section
          ref={heroRef}
          className={cn("border-b border-line/70 bg-page", heroVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container grid gap-10 py-[3rem] sm:py-[3.75rem] lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:py-20">
            <div className="flex flex-col">
              <p className="nsq-eyebrow self-start">
                {texts.heroEyebrow.trim() || PRODUCT_COPY.hero.eyebrow}
              </p>
              <h1 className="nsq-title mt-3 max-w-2xl text-[1.9rem] leading-[1.28] sm:text-[2.35rem] md:text-[2.6rem]">
                {texts.heroTitle.trim() || PRODUCT_COPY.hero.title}
              </h1>
              <p className="nsq-lede mt-4">
                {texts.heroDescription.trim() || PRODUCT_COPY.hero.description}
              </p>
              <p className="nsq-wrap mt-2 max-w-xl text-[0.875rem] leading-[1.7] text-muted">
                منصة واحدة تُعدّ التقارير السنوية ولوحات المؤشرات والخطابات
                الرسمية والعروض التنفيذية بجودة طباعة 300 DPI.
              </p>

              {/* Two doors only: the primary entry and the plans. The project
                  link lives with the projects it opens (see below). */}
              {/* Dual primary hero actions: New Document and Import & Convert */}
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
                  إنشاء مستند جديد
                </PremiumButton>
                <PremiumButton
                  variant="outline"
                  size="lg"
                  onClick={() => window.location.assign("/services/import")}
                  icon={FileUp}
                >
                  استيراد ملف وتحويله فوراً
                </PremiumButton>
                <a
                  href="/purchase"
                  className="inline-flex items-center gap-1 text-[13px] font-bold text-muted hover:text-ink px-2 py-1 transition"
                >
                  استعراض الخطط والأسعار ←
                </a>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="emerald" dot>تخزين محلي أولًا</Badge>
                <Badge variant="gold" dot>جاهز للطباعة 300 DPI</Badge>
                <Badge variant="brand" dot>دعم الخطوط العربية الرسمية</Badge>
              </div>

              {/* Secondary utility row: opening an existing project file. */}
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line/60 pt-4">
                <ProjectFileButton />
                <p className="nsq-wrap max-w-md text-[0.78rem] leading-6 text-muted">
                  {PRODUCT_COPY.demoNote}
                </p>
              </div>
            </div>

            <LiveEditorPreview
              document={featuredDocument}
              pending={templatesLoading}
            />
          </div>
        </section>

        {/* ── Document Studio Quick Starts (Anti-Icon Ambiguity) ── */}
        <section className="border-b border-line/60 bg-surface py-12 sm:py-16">
          <div className="nsq-container">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <p className="nsq-section-eyebrow">نماذج ومخرجات نَسَق</p>
                <h2 className="nsq-section-title mt-1.5 text-[1.45rem] sm:text-[1.75rem]">
                  ابدأ بإنشاء مستندك المؤسسي بدقة
                </h2>
                <p className="nsq-wrap mt-1 text-[0.85rem] text-muted">
                  هياكل مسبقة الإعداد تحاكي مخرجاتك الواقعية — تقارير، خطابات، عروض، ولوحات مؤشرات.
                </p>
              </div>
              <a
                href="/create"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3.5 text-[0.75rem] font-bold text-ink transition hover:border-brand"
              >
                شاشة الإنشاء المتقدمة
                <ArrowLeft className="size-3.5" aria-hidden />
              </a>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {SEMANTIC_DOC_ITEMS.map((item) => (
                <SemanticDocCard
                  key={item.id}
                  item={item}
                  href={item.id === "import" ? "/services/import" : `/create?start=${item.id === "report" ? "blank" : "template"}`}
                />
              ))}
            </div>
          </div>
        </section>

        <ProductWalkthrough />

        {/* ── Import & Convert service ── */}
        <section
          ref={importRef}
          className={cn("border-b border-line/60 bg-surface-2 py-12 sm:py-16", importVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <h2 className="mt-1 text-[1.5rem] sm:text-[1.75rem] font-black text-ink">
                  استورد ملفاتك وحوّلها إلى مستندات نَسَق
                </h2>
                <p className="mt-3 max-w-lg text-[13px] leading-6 text-muted">
                  ارفع ملف فوتوشوب أو وورد أو بوربوينت أو PDF أو صورة، وسيتحول إلى
                  مستند قابل للتحرير في نَسَق مع الحفاظ على النصوص والصور والأبعاد.
                  افحص النتيجة، أصلح العناصر، وافتح الملف مباشرة في المحرر.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <PremiumButton
                    variant="primary"
                    size="md"
                    onClick={() => window.location.assign("/services/import")}
                    icon={Layers}
                  >
                    ابدأ الاستيراد
                  </PremiumButton>
                  <PremiumButton
                    variant="outline"
                    size="md"
                    onClick={() => window.location.assign("/services/import")}
                  >
                    التعرّف على الصيغ المدعومة
                  </PremiumButton>
                </div>
              </div>
              <div className="hidden lg:block">
                <div className="grid gap-y-3 text-[12px]">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand" aria-hidden>●</span>
                    <span>PSD، PSB، DOCX، PPTX، PDF، PNG، JPG، WEBP، SVG، .nsq</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand" aria-hidden>●</span>
                    <span>فحص بالتوقيع وليس بالامتداد فقط</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand" aria-hidden>●</span>
                    <span>معاينة وإصلاح العناصر قبل الفتح في المحرر</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-brand" aria-hidden>●</span>
                    <span>استعراض مفتوح للجميع · التحويل للمشتركين</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Who it's for (+ the three working principles) ── */}
        <section
          ref={audienceRef}
          className={cn("border-b border-line/60 bg-page py-12 sm:py-16", audienceVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <div>
              <p className="nsq-section-eyebrow">لمن تناسب</p>
              <h2 className="nsq-section-title mt-2.5 text-[1.45rem] sm:text-[1.75rem]">
                مصممة للجهات والمؤسسات والفرق المحترفة
              </h2>
              <p className="nsq-wrap mt-2 text-[0.9rem] leading-[1.7] text-muted">
                توفر نَسَق بيئة عمل تناسب المتطلبات الرسمية، مع التزام بالهوية البصرية والجودة الطباعية وسهولة إعادة الاستخدام عبر القوالب.
              </p>
              <ul className="mt-6 space-y-4 border-t border-line/60 pt-5">
                {FOUNDATIONS.map(({ icon: Icon, title, copy }) => (
                  <li key={title} className="flex items-start gap-3">
                    <Icon className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-ink">{title}</p>
                      <p className="nsq-wrap mt-0.5 text-[12px] leading-6 text-muted">{copy}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <ul className="divide-y divide-line/60 border-y border-line/60">
              {AUDIENCE.map((c) => (
                <li key={c.title} className="flex items-start gap-4 py-5">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-brand shadow-xs">
                    <c.icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14.5px] font-extrabold text-ink">{c.title}</h3>
                    <p className="nsq-wrap mt-1 text-[12px] leading-6 text-muted">{c.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Recent projects ── */}
        <section
          ref={projectsRef}
          className={cn("border-b border-line/60 bg-surface-2 py-12 sm:py-16", projectsVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[1.125rem] font-extrabold text-ink">
                  أحدث المشاريع
                </h2>
                {!recentHidden && (
                  <p className="nsq-wrap mt-1 text-[0.85rem] text-muted">
                    الصفحات تُحفظ محليًا في متصفحك، مع اتصال عند الحاجة للترخيص أو الذكاء الاصطناعي.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="/projects"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.75rem] font-bold text-ink transition hover:bg-line-2"
                >
                  كل مشاريعي
                  <ArrowLeft className="size-3.5" aria-hidden />
                </a>
                <button
                  type="button"
                  onClick={toggleRecent}
                  aria-expanded={!recentHidden}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.75rem] font-bold text-muted transition hover:text-ink"
                >
                  {recentHidden ? "إظهار" : "إخفاء"}
                  <ChevronDown
                    className={`size-3.5 transition-transform ${recentHidden ? "" : "rotate-180"}`}
                    aria-hidden
                  />
                </button>
              </div>
            </div>
            {recentHidden ? null : projectsLoading ? (
              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-[148px] animate-pulse rounded-[12px] border border-line bg-surface"
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
              <div className="shadow-card mt-6 flex flex-col items-start gap-4 rounded-[14px] border border-line bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[14px] font-bold text-ink">
                    لا توجد مشاريع بعد
                  </p>
                  <p className="nsq-wrap mt-1 text-[12px] text-muted">
                    ابدأ بتقرير رسمي جاهز أو بصفحة فارغة.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <PremiumButton
                    size="sm"
                    variant="primary"
                    onClick={() => window.location.assign("/templates")}
                    icon={ArrowLeft}
                    iconPosition="end"
                  >
                    استعراض القوالب
                  </PremiumButton>
                  <PremiumButton
                    size="sm"
                    variant="outline"
                    onClick={startBlank}
                  >
                    صفحة فارغة
                  </PremiumButton>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Starter packs, painted from their own pages ── */}
        <section
          ref={packsRef}
          className={cn("border-b border-line/60 bg-page py-12 sm:py-16", packsVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[1.125rem] font-extrabold text-ink">
                  قوالب البداية
                </h2>
                <p className="nsq-wrap mt-1 text-[0.85rem] text-muted">
                  كل قالب ينشئ نسخة جديدة داخل مشروعك؛ والمعاينة أعلاه مرسومة من صفحات القالب نفسها.
                </p>
              </div>
              <a
                href="/templates"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.75rem] font-bold text-ink transition hover:bg-line-2"
              >
                كل القوالب
                <ArrowLeft className="size-3.5" aria-hidden />
              </a>
            </div>
            <div className={`mt-6 ${CARD_WRAP}`}>
              {PACKS.map((pack) =>
                pack.id === "blank" ? (
                  <PackCard
                    key={pack.id}
                    pack={{ ...pack, page: createProject("blank").pages[0] }}
                    revealed={packsVisible}
                    onClick={startBlank}
                    badge={
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
                    }
                  />
                ) : (
                  <PackCard
                    key={pack.id}
                    pack={{ ...pack, page: createProject(pack.id).pages[0] }}
                    revealed={packsVisible}
                    href="/templates"
                    badge={
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
                    }
                  />
                ),
              )}
            </div>
          </div>
        </section>

        {/* ── Premium templates ── */}
        <PremiumTemplates />

        {/* ── هوية مستندك — Brand Identity Section ── */}
        <section
          ref={brandRef}
          className={cn("border-t border-line/60 bg-surface-2 py-12 sm:py-16", brandVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="nsq-section-eyebrow">هوية مستندك الموحدة</p>
                <h2 className="nsq-section-title mt-2.5 text-[1.5rem] sm:text-[1.85rem]">
                  هوية جهتك مطبقة على كل تقرير ومستند بلمسة واحدة
                </h2>
                <p className="nsq-wrap mt-3 text-[0.925rem] leading-7 text-muted">
                  لا داعي لإعادة إدخال رموز الألوان والخطوط والشعارات يدويًا في كل ملف. عرّف «هوية مستندك»
                  مرة واحدة؛ لتسري مباشرة على التقارير السنوية، الخطابات الرسمية، العروض التقديمية، ولوحات المؤشرات.
                </p>

                <div className="mt-6 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                      <CheckCircle2 className="size-3.5" />
                    </div>
                    <div>
                      <strong className="text-[13px] font-bold text-ink">لوحات ألوان متزنة ومقيسة</strong>
                      <p className="text-[12px] text-muted">تحقق تلقائي لنسب التباين والوضوح الطباعي طبقًا للمعايير المؤسسية.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                      <CheckCircle2 className="size-3.5" />
                    </div>
                    <div>
                      <strong className="text-[13px] font-bold text-ink">الشعار المؤسسي والترويسات الرسمية</strong>
                      <p className="text-[12px] text-muted">تثبيت وتوزيع دقيق لشعار جهتك وأرقام المستند على الهوامش والترويسات.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                      <CheckCircle2 className="size-3.5" />
                    </div>
                    <div>
                      <strong className="text-[13px] font-bold text-ink">حزم هوية قابلة للتصدير والاستيراد</strong>
                      <p className="text-[12px] text-muted">تبادل ملفات الهوية المعتمدة بين فرق العمل لضمان اتساق المخرجات بين الإدارات.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <PremiumButton
                    variant="primary"
                    size="md"
                    onClick={() => window.location.assign("/الهوية")}
                    icon={ArrowLeft}
                    iconPosition="end"
                  >
                    إعداد هوية مستندك
                  </PremiumButton>
                  <PremiumButton
                    variant="outline"
                    size="md"
                    onClick={() => window.location.assign("/templates")}
                  >
                    استعراض القوالب المتوافقة
                  </PremiumButton>
                </div>
              </div>

              {/* Visual showcase card for Identity */}
              <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-line/60 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="size-3 rounded-full" style={{ backgroundColor: "#006C35" }} />
                    <div className="size-3 rounded-full" style={{ backgroundColor: "#0F1E33" }} />
                    <div className="size-3 rounded-full" style={{ backgroundColor: "#C9A86A" }} />
                    <span className="text-[12px] font-bold text-ink">لوحة الهوية المؤسسية</span>
                  </div>
                  <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-extrabold text-brand">
                    معتمدة
                  </span>
                </div>
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border border-line/70 bg-surface-2 p-3.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-bold text-ink">اللون الأساسي (Primary)</span>
                      <span className="font-mono text-muted" dir="ltr">#006C35</span>
                    </div>
                    <div className="mt-2 h-2.5 w-full rounded-full" style={{ backgroundColor: "#006C35" }} />
                  </div>
                  <div className="rounded-xl border border-line/70 bg-surface-2 p-3.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-bold text-ink">اللون الداكن (Navy / Ink)</span>
                      <span className="font-mono text-muted" dir="ltr">#0F1E33</span>
                    </div>
                    <div className="mt-2 h-2.5 w-full rounded-full" style={{ backgroundColor: "#0F1E33" }} />
                  </div>
                  <div className="rounded-xl border border-line/70 bg-surface-2 p-3.5">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-bold text-ink">لون التمييز (Accent Gold)</span>
                      <span className="font-mono text-muted" dir="ltr">#C9A86A</span>
                    </div>
                    <div className="mt-2 h-2.5 w-full rounded-full" style={{ backgroundColor: "#C9A86A" }} />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-line/70 bg-surface-2 p-3.5">
                    <span className="text-[12px] font-bold text-ink">خط العناوين والطباعة</span>
                    <span className="text-[12px] text-muted">IBM Plex Sans Arabic / Amiri</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features — one hairline list, no card wall ── */}
        <section
          ref={highlightsRef}
          className={cn("border-t border-line/60 bg-page py-12 sm:py-16", highlightsVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl">
                <p className="nsq-section-eyebrow">الميزات والخدمات الأساسية</p>
                <h2 className="nsq-section-title mt-2.5 text-[1.5rem] sm:text-[1.75rem]">
                  أدوات متخصصة لإنتاج المستند المؤسسي
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
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
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HIGHLIGHTS.map((h) => (
                <div
                  key={h.title}
                  className="group rounded-2xl border border-line bg-surface p-4.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card"
                >
                  <span className="grid size-11 place-items-center rounded-xl border border-line/70 bg-surface-2 text-brand shadow-xs transition-colors group-hover:bg-brand/10">
                    <h.icon className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <h3 className="mt-3.5 text-[13.5px] font-extrabold leading-5 text-ink">
                    {h.title}
                  </h3>
                  <p className="nsq-wrap mt-1.5 text-[11.5px] leading-5 text-muted">
                    {h.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── عن نَسَق — Institutional Editorial Guarantees ── */}
        <section
          ref={aboutRef}
          className={cn("border-t border-line/60 bg-surface-2 py-12 sm:py-16", aboutVisible && "is-revealed")}
          data-animate
        >
          <div className="nsq-container">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-2xl">
                <p className="nsq-section-eyebrow">عن نَسَق والضمانات التحريرية</p>
                <h2 className="nsq-section-title mt-2.5 text-[1.5rem] sm:text-[1.85rem]">
                  معايير هندسية صارمة للوثائق والتقارير المؤسسية
                </h2>
                <p className="nsq-wrap mt-2 text-[0.875rem] text-muted">
                  بُنيت منصة نَسَق لتجاوز عيوب المحررات العامة: هندسة عربية أصيلة، مخرجات طباعية نقية، وخصوصية حقيقية للبيانات.
                </p>
              </div>
              <PremiumButton
                variant="outline"
                size="md"
                onClick={() => window.location.assign("/about")}
                icon={ArrowLeft}
                iconPosition="end"
              >
                تفاصيل المنصة والضمانات
              </PremiumButton>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center gap-2.5 text-brand">
                  <BadgeCheck className="size-5" />
                  <h3 className="text-[13.5px] font-bold text-ink">طباعة رسمية بدقة 300 DPI</h3>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-muted">
                  تصدير PDF متجهي نقي وصور عالية الوضوح مهيأة مباشرة للمطابع وجلسات مجالس الإدارة دون تشوه.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center gap-2.5 text-brand">
                  <ShieldCheck className="size-5" />
                  <h3 className="text-[13.5px] font-bold text-ink">تخزين محلي أولًا (Local-First)</h3>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-muted">
                  مشاريعك ومستنداتك تُحفظ بأمان داخل متصفحك. لا تُرسل بيانات تقاريرك الحساسة إلى خوادم خارجية دون إذنك.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center gap-2.5 text-brand">
                  <Type className="size-5" />
                  <h3 className="text-[13.5px] font-bold text-ink">محاذاة عربية دقيقة وطباعة متقدمة</h3>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-muted">
                  معالجة أصيلة للنصوص ثنائية الاتجاه، وعلامات الترقيم العربية، وتباعد الفقرات والهوامش دون انكسار.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center gap-2.5 text-brand">
                  <FileDown className="size-5" />
                  <h3 className="text-[13.5px] font-bold text-ink">تعدد صيغ التصدير والتسليم</h3>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-muted">
                  تصدير بصيغ PDF، Word، PowerPoint، وحزم .nsq المستقلة مع استعراض ومطابقة قبل الإخراج.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center gap-2.5 text-brand">
                  <Workflow className="size-5" />
                  <h3 className="text-[13.5px] font-bold text-ink">إدارة الصفحات والهيكلة المؤسسية</h3>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-muted">
                  تنسيق صفحات متعددة المقاسات (A4، A3، وشرائح 16:9)، مع تحديث آلي لأرقام الصفحات وفهارس المحتوى.
                </p>
              </div>

              <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-center gap-2.5 text-brand">
                  <Building2 className="size-5" />
                  <h3 className="text-[13.5px] font-bold text-ink">مصممة للشركات والمؤسسات</h3>
                </div>
                <p className="mt-2 text-[12px] leading-6 text-muted">
                  مبنية لفرق العمل والإدارات التنفيذية التي تتطلب احترافية وموثوقية في تقاريرها دون تعقيد الأدوات الأجنبية.
                </p>
              </div>
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
