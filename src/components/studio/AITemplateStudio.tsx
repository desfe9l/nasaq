import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Layers,
  Wand2,
  SlidersHorizontal,
  RotateCcw,
  ExternalLink,
  CheckCircle2,
  Palette,
} from "lucide-react";
import { toast } from "sonner";
import { getProject, setSetting } from "@/lib/editor/storage";
import { BRAND_ROUTE, editorPathFor } from "@/lib/site-routes";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import {
  DEMO_MAX_PAGES,
  exceedsProjectPageLimit,
  exceedsSavedProjectLimit,
  projectAccessBlock,
} from "@/lib/editor/access-limits";
import { useEditor } from "@/lib/editor/store";
import { readBrandKit } from "@/lib/product/brand-kit";
import {
  brandIsConfigured,
  describeBrandApplication,
} from "@/lib/editor/brand-design";
import type { BrandKit } from "@/lib/product/product";
import { cn } from "@/lib/utils";
import { saveCustomTemplate } from "@/lib/templates/custom-templates";
import { resolveTemplateName } from "@/lib/templates/naming";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import {
  generateDesignFromPrompt,
  type StudioGenerationResult,
} from "@/lib/intelligence/pipeline";
import { generateDesignBriefFn } from "@/lib/ai/functions";
import type { CoverStyle, DesignGenerationMode } from "@/lib/ai/design-contract";
import type { DesignVariation } from "@/lib/intelligence/variations";
import { DESIGN_STYLES, type DesignFormat, type DesignStyle } from "@/lib/intelligence/schema";
import { pageSize } from "@/lib/editor/model";

const PROMPT_SUGGESTIONS = [
  "صمم تقريرًا رسميًا عن الأمن السيبراني",
  "صمم غلاف تقرير سنوي لجهة حكومية",
  "صمم عرضًا قياديًا من 8 صفحات",
  "صمم صفحة تعريفية احترافية لشركة",
  "صمم ملخصًا تنفيذيًا لمؤشرات الأداء الاستراتيجي",
  "صمم خطة تشغيلية ومبادرات التحول المؤسسي",
];

const STYLE_LABELS: Record<DesignStyle, string> = {
  institutional: "مؤسسي سيادي",
  government: "حكومي رسمي",
  corporate: "شركات وأعمال",
  executive: "تنفيذي قيادي",
  editorial: "تحريري معاصر",
  presentation: "عرض مرئي",
  report: "تقرير شامل",
  infographic: "بيانات وإنفوجرافيك",
  auction: "مزادات واستثمار",
};

const FORMAT_OPTIONS: Array<{ id: DesignFormat; label: string; desc: string }> = [
  { id: "a4-book", label: "A4 عمودي", desc: "تقارير، خطابات، كتيبات (210×297 مم)" },
  { id: "wide-slide", label: "شريحة عرض 16:9", desc: "عروض تقديمية قيادية (338×190 مم)" },
  { id: "tall-story", label: "إنفوجرافيك طولي", desc: "سلسلة بيانات ورسوم بيانية" },
];

/**
 * One generation entry point for the studio.
 *
 * It exists so the page-load preview, the manual generate and the
 * identity-repaint all obey the SAME rules: the page ceiling of the account's
 * plan, and the institutional identity when it is licensed. `generateFromIntent`
 * would happily build a six-page document for a plan that opens three; the
 * studio is not allowed to promise more than the editor will honour.
 */
function buildGeneration(
  text: string,
  overrides: Record<string, unknown>,
  entitlements: { unlimited_pages?: boolean },
  brand: BrandKit | null,
): StudioGenerationResult {
  const bounded = { ...overrides };
  if (
    !entitlements.unlimited_pages &&
    typeof bounded.pages === "number" &&
    bounded.pages > DEMO_MAX_PAGES
  ) {
    bounded.pages = DEMO_MAX_PAGES;
  }
  return generateDesignFromPrompt(text, bounded, brand);
}

export function AITemplateStudio({ initialPrompt }: { initialPrompt?: string }) {
  /*
   * The studio judges by the account's REAL entitlements. It used to hand
   * `saveCustomTemplate` a hardcoded all-true map, which meant a free or expired
   * account could persist a template the editor store would then refuse to open.
   * The same map now decides what can be generated and saved here.
   */
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [prompt, setPrompt] = useState(initialPrompt || "صمم تقريرًا رسميًا عن الأمن السيبراني");
  const [busy, setBusy] = useState(false);
  const [stepLabel, setStepLabel] = useState("");
  const [result, setResult] = useState<StudioGenerationResult | null>(() => {
    // Generate an initial high-quality default design on mount
    try {
      return generateDesignFromPrompt("صمم تقريرًا رسميًا عن الأمن السيبراني");
    } catch {
      return null;
    }
  });

  const [selectedVariationId, setSelectedVariationId] = useState("sovereign");
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [showTuning, setShowTuning] = useState(false);

  // Optional manual overrides
  const [overrideStyle, setOverrideStyle] = useState<DesignStyle | "auto">("auto");
  const [overrideFormat, setOverrideFormat] = useState<DesignFormat | "auto">("auto");
  const [overridePages, setOverridePages] = useState<number | "auto">("auto");
  const [generationMode, setGenerationMode] = useState<DesignGenerationMode>("professional");
  const [overrideCover, setOverrideCover] = useState<CoverStyle | "auto">("auto");

  // Active variation project
  const currentVariation: DesignVariation | undefined =
    result?.variations.find((v) => v.id === selectedVariationId) || result?.variations[0];
  const activeProject = currentVariation?.project || result?.primaryResult.project;
  const activePage = activeProject?.pages[activePageIndex] || activeProject?.pages[0];

  /*
   * «الهوية» is read once on mount, and only used when the `brand_kit`
   * entitlement is present. Reading is not applying: without the entitlement the
   * kit is simply not handed to the generator.
   */
  const generatedByHand = useRef(false);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => {
    let alive = true;
    if (!entitlements.brand_kit) {
      setBrandKit(null);
      return () => {
        alive = false;
      };
    }
    void readBrandKit()
      .then((kit) => {
        if (!alive) return;
        // A default kit is not an identity: it must not repaint the studio.
        if (!brandIsConfigured(kit)) return;
        setBrandKit(kit);
        // The preview generated on mount was painted before the kit finished
        // loading. Repaint it in the identity — once, and only if the author has
        // not already generated a design of their own.
        if (!generatedByHand.current) {
          try {
            setResult(buildGeneration(promptRef.current, {}, entitlements, kit));
          } catch {
            /* the un-branded preview stays; generation is still available */
          }
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [entitlements]);

  const handleGenerate = async (targetPrompt?: string) => {
    if (busy) return;
    const text = (targetPrompt || prompt).trim();
    if (!text) {
      toast.error("يرجى كتابة وصف التصميم المطلوب");
      return;
    }

    setBusy(true);
    setStepLabel("تحليل الموجه واستخلاص متطلبات الهوية...");

    try {
      setStepLabel("إرسال وصف التصميم إلى Gemini عبر المسار الآمن...");
      generatedByHand.current = true;
      const overrides: Record<string, unknown> = {};
      if (overrideStyle !== "auto") overrides.style = overrideStyle;
      if (overrideFormat !== "auto") {
        overrides.format = overrideFormat;
        overrides.dimensions =
          overrideFormat === "wide-slide"
            ? { w: 338.7, h: 190.5 }
            : overrideFormat === "tall-story"
              ? { w: 210, h: 560 }
              : { w: 210, h: 297 };
      }
      if (overridePages !== "auto") overrides.pages = overridePages;

      const briefResult = await generateDesignBriefFn({
        data: {
          prompt: text,
          mode: generationMode,
          requestedPages: typeof overridePages === "number" ? overridePages : undefined,
          style: overrideStyle === "auto" ? undefined : overrideStyle,
          format: overrideFormat === "auto" ? undefined : overrideFormat,
          coverStyle: overrideCover === "auto" ? undefined : overrideCover,
          bilingual: /ثنائي|لغتين|عربي.*إنجليزي|إنجليزي.*عربي/i.test(text),
        },
      });
      if (!briefResult.ok) throw new Error(briefResult.message);
      setStepLabel("تحويل التوجيه المعتمد إلى عناصر NASAQ قابلة للتحرير...");
      const brief = briefResult.brief;
      const aiOverrides: Record<string, unknown> = {
        ...overrides,
        title: brief.title,
        subtitle: brief.subtitle,
        org: brief.org,
        topic: brief.topic,
        style: overrideStyle === "auto" ? brief.style : overrideStyle,
        format: overrideFormat === "auto" ? brief.format : overrideFormat,
        pages: typeof overridePages === "number" ? overridePages : brief.pages,
        coverStyle: overrideCover === "auto" ? brief.coverStyle : overrideCover,
        generationMode,
        contentDensity: brief.contentDensity,
        bilingual: brief.bilingual,
        visualDirection: brief.visualDirection,
      };

      /*
       * The page ceiling is the store's own number, enforced in ONE place
       * (`buildGeneration`, which the mount preview also goes through); here the
       * author is simply told when their request was brought back to the plan.
       */
      const requestedPages = typeof overrides.pages === "number" ? overrides.pages : null;
      const gen = buildGeneration(text, aiOverrides, entitlements, brandKit);
      if (
        requestedPages !== null &&
        !entitlements.unlimited_pages &&
        requestedPages > DEMO_MAX_PAGES
      ) {
        toast.info(`الخطة الحالية تسمح بـ${DEMO_MAX_PAGES} صفحات — وُلّد التصميم ضمنها.`);
      }
      setResult(gen);
      setSelectedVariationId("sovereign");
      setActivePageIndex(0);
      toast.success("تم توليد التصميم والبدائل بنجاح");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء التوليد، يرجى المحاولة مرة أخرى");
      console.error(err);
    } finally {
      setBusy(false);
      setStepLabel("");
    }
  };

  const openInEditor = async () => {
    if (!activeProject) return;
    const category = result?.intent.docType === "presentation" ? "slides" : "reports";
    try {
      const store = useEditor.getState();
      // The project list is counted exactly as the editor counts it, against the
      // account's own entitlements — no hardcoded allowances.
      store.setEntitlements(entitlements);
      await store.hydrate();
      if (exceedsSavedProjectLimit(useEditor.getState().projects.length, entitlements)) {
        toast.error("اكتملت مساحة تجربة المحرر", {
          description: "يتضمن العرض مشروعًا واحدًا. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
        });
        return;
      }
      const name = resolveTemplateName({
        title: activeProject.name || result?.intent.title || "",
        category,
        kind: "json",
        content: activeProject,
      });
      const block = projectAccessBlock(activeProject, entitlements);
      if (block) {
        toast.error(
          block === "premium-template"
            ? "هذا التصميم يعتمد على قالب في النسخة الكاملة — فعّل ترخيصًا مناسبًا."
            : `يتجاوز التصميم حد ${DEMO_MAX_PAGES} صفحات في خطتك الحالية.`,
        );
        return;
      }
      const created = await store.createDocument(
        { ...activeProject, name },
        { autoName: false },
      );
      if (!created) {
        toast.error("تعذر تطبيق التصميم على نموذج المستند؛ لم يتم حفظ أي تغيير.");
        return;
      }
      const savedId = useEditor.getState().id;
      const saved = savedId ? await getProject(savedId) : null;
      if (!saved) {
        toast.error("تعذر التحقق من المستند الناتج؛ لم يتم فتحه.");
        return;
      }
      await setSetting("activeProjectId", saved.id);
      /*
       * Saving the design into the template library is a convenience, not the
       * goal: a plan that cannot hold it (page ceiling) still gets the editable
       * document in the editor, with the reason said out loud.
       */
      try {
        await saveCustomTemplate(
          {
            title: saved.name.slice(0, 80),
            desc: `تصميم مولد بواسطة الذكاء الاصطناعي · نمط ${currentVariation?.name || "مؤسسي"}`,
            category,
            tags: ["ai-generation", result?.intent.topic || "institutional"],
            pages: saved.pages,
          },
          entitlements,
        );
      } catch (templateError) {
        if (exceedsProjectPageLimit(saved.pages.length, entitlements)) {
          toast.info("حُفظ المستند في مشاريعك؛ ولم يُضف إلى مكتبة القوالب ضمن خطتك الحالية.");
        } else {
          console.warn("studio template save failed", templateError);
        }
      }
      toast.success("جارٍ فتح التصميم في محرر نَسَق...");
      if (saved.id) {
        window.location.assign(editorPathFor(saved.id));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر حفظ المشروع في المحرر";
      toast.error(message);
    }
  };

  return (
    <div className="grid gap-4 text-ink" dir="rtl">
      {/* ----------------- Header & Prompt Box ----------------- */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-lg bg-navy text-on-brand shadow-sm">
              <Sparkles className="size-4 text-gold" />
            </div>
            <div>
              <h1 className="text-[16px] font-black sm:text-[18px]">
                استوديو التصميم والتوليد بالذكاء الاصطناعي
              </h1>
              <p className="text-[11px] font-semibold text-muted">
                حول فكرتك إلى تصميم مؤسسي متكامل وقابل للتحرير بالكامل في محرر نَسَق
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
             * The identity is visible, not implied: the author can see WHOSE
             * colours the design is being generated in, and can change them.
             */}
            {brandKit ? (
              <a
                href={BRAND_ROUTE}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand/40 bg-navy/5 px-3 text-[12px] font-bold text-brand transition hover:border-brand"
                title="الهوية المطبقة على التوليد — عدّلها من «هوية مستندك»"
              >
                <Palette className="size-3.5" aria-hidden />
                <span>{describeBrandApplication(brandKit)}</span>
              </a>
            ) : (
              <a
                href={BRAND_ROUTE}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold text-muted transition hover:border-brand hover:text-brand"
                title="اربط التوليد بهوية جهتك"
              >
                <Palette className="size-3.5" aria-hidden />
                <span>هوية مؤسسية</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowTuning(!showTuning)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold text-muted transition hover:border-brand hover:text-brand"
            >
              <SlidersHorizontal className="size-3.5" />
              <span>خيارات التخصيص</span>
            </button>
          </div>
        </div>

        {/* Primary Prompt Input */}
        <div className="mt-4 grid gap-2">
          <div className="relative flex flex-col gap-1.5 sm:flex-row">
            <div className="relative flex-1">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy) void handleGenerate();
                }}
                disabled={busy}
                placeholder="اكتب وصف التصميم المطلوب... مثل: صمم تقريرًا رسميًا عن الأمن السيبراني"
                className="h-11 w-full rounded-lg border-2 border-line bg-page px-3 text-[13px] font-bold placeholder:text-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-[14px]"
              />
            </div>

            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={() => void handleGenerate()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-navy px-5 text-[13px] font-black text-on-brand shadow-md transition hover:bg-navy-2 active:scale-[0.99] disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Wand2 className="size-4 animate-spin text-gold" />
                  <span>جارٍ التوليد…</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-4 text-gold" />
                  <span>توليد التصميم</span>
                </>
              )}
            </button>
          </div>

          {/* Prompt Inspiration Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] font-bold text-muted">أمثلة سريعة:</span>
            {PROMPT_SUGGESTIONS.map((sug) => (
              <button
                key={sug}
                type="button"
                disabled={busy}
                onClick={() => {
                  setPrompt(sug);
                  void handleGenerate(sug);
                }}
                className="rounded-full border border-line bg-surface-2/60 px-2.5 py-1 text-[11px] font-semibold text-muted transition hover:border-brand hover:bg-navy/5 hover:text-brand"
              >
                {sug}
              </button>
            ))}
          </div>

          {/* Quick Tuning Drawer (Optional) */}
          {showTuning && (
              <div className="mt-2 grid gap-2 rounded-lg border border-line/80 bg-surface-2/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-[11px] font-bold text-muted">
                وضع الذكاء الاصطناعي
                <select
                  value={generationMode}
                  onChange={(e) => setGenerationMode(e.target.value as DesignGenerationMode)}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                >
                  <option value="generate">توليد — أفكار وتكوينات جديدة</option>
                  <option value="balance">توازن — ضبط الكثافة والهرمية</option>
                  <option value="professional">احتراف — إخراج مؤسسي صارم</option>
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-bold text-muted">
                اتجاه الغلاف
                <select
                  value={overrideCover}
                  onChange={(e) => setOverrideCover(e.target.value as CoverStyle | "auto")}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                >
                  <option value="auto">تلقائي من Gemini</option>
                  <option value="minimal">Minimal · بسيط</option>
                  <option value="editorial">Editorial · تحريري</option>
                  <option value="premium">Premium · فاخر</option>
                  <option value="gradient">Gradient · تدرج</option>
                  <option value="wave">Wave · منحنيات</option>
                  <option value="geometric">Geometric · هندسي</option>
                  <option value="image-led">Image-led · صورة رئيسية</option>
                  <option value="executive">Executive · قيادي</option>
                  <option value="formal">Formal · رسمي</option>
                  <option value="legal">Legal · قانوني</option>
                  <option value="media">Media · إعلامي</option>
                  <option value="annual-report">Annual report · سنوي</option>
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-bold text-muted">
                نمط التصميم
                <select
                  value={overrideStyle}
                  onChange={(e) => setOverrideStyle(e.target.value as DesignStyle | "auto")}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                >
                  <option value="auto">تلقائي (وفق الموجه)</option>
                  {DESIGN_STYLES.map((st) => (
                    <option key={st} value={st}>
                      {STYLE_LABELS[st]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-[11px] font-bold text-muted">
                تنسيق الصفحة والمقاس
                <select
                  value={overrideFormat}
                  onChange={(e) => setOverrideFormat(e.target.value as DesignFormat | "auto")}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                >
                  <option value="auto">تلقائي (وفق نوع المستند)</option>
                  {FORMAT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-[11px] font-bold text-muted">
                عدد الصفحات
                <select
                  value={overridePages}
                  onChange={(e) =>
                    setOverridePages(e.target.value === "auto" ? "auto" : Number(e.target.value))
                  }
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[12px] font-bold"
                >
                  <option value="auto">تلقائي ذكي</option>
                  <option value={1}>صفحة واحدة (غلاف / وثيقة فردية)</option>
                  <option value={2}>صفحتان (موجز / بروفايل)</option>
                  <option value={4}>٤ صفحات (تقرير متكامل)</option>
                  <option value={6}>٦ صفحات (تقرير سنوي / عرض)</option>
                  <option value={8}>٨ صفحات (عرض قيادي شامل)</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </section>

      {/* ----------------- Visual Generation Progress ----------------- */}
      {busy && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-brand/50 bg-navy/[0.04] p-12 text-center">
          <div className="relative mb-4 grid size-16 place-items-center rounded-2xl bg-navy text-on-brand shadow-lg">
            <Wand2 className="size-8 animate-spin text-gold" />
          </div>
          <h3 className="text-[17px] font-extrabold text-ink">{stepLabel || "جارٍ تصميم المستند…"}</h3>
          <p className="mt-1 text-[12px] font-semibold text-muted">
            نَسَق يطبق قواعد الشبكة المؤسسية، الهرمية البصرية، وتوازن الخطوط العربية
          </p>
        </div>
      )}

      {/* ----------------- Generation Result & Studio Workspace ----------------- */}
      {!busy && result && activeProject && activePage && (
        <div className="grid gap-5">
          {/* Top Actions & Summary Banner */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-md bg-navy px-2.5 py-1 text-[11px] font-extrabold text-on-brand">
                {result.intent.docTypeLabel}
              </span>
              <strong className="text-[14px] font-black sm:text-[15px]">
                {activeProject.name}
              </strong>
              <span className="text-[12px] font-semibold text-muted">
                ({activeProject.pages.length} صفحات · {activePage.w}×{activePage.h}مم)
              </span>
              <span className="flex items-center gap-1 rounded bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
                <CheckCircle2 className="size-3" />
                جودة التصميم: {currentVariation?.score || 95}/100
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGenerate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
                إعادة التوليد
              </button>

              <button
                type="button"
                onClick={() => void openInEditor()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-navy px-5 text-[13px] font-black text-on-brand shadow-md transition hover:bg-navy-2 active:scale-[0.98]"
              >
                <ExternalLink className="size-4 text-gold" />
                فتح في محرر نَسَق
              </button>
            </div>
          </section>

          {/* Variations Selector Tabs */}
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[13px] font-black">
                <Layers className="size-4 text-brand" />
                البدائل والأنماط المعمارية للتصميم (اختر النمط المناسب):
              </h2>
              <span className="text-[11px] font-semibold text-muted">
                جميع البدائل قابلة للتحرير بالكامل
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {result.variations.map((v) => {
                const isSelected = v.id === selectedVariationId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setSelectedVariationId(v.id);
                      setActivePageIndex(0);
                    }}
                    className={cn(
                      "flex flex-col items-start rounded-xl border p-3 text-right transition",
                      isSelected
                        ? "border-brand bg-navy/[0.06] shadow-sm ring-1 ring-brand"
                        : "border-line bg-surface hover:border-line-2 hover:bg-surface-2",
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-1.5">
                      <span className="flex items-center gap-1.5 text-[13px] font-black">
                        <span
                          className="size-3.5 rounded-full border border-black/10"
                          style={{ backgroundColor: v.palette.field }}
                        />
                        {v.name}
                      </span>
                      <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[9px] font-bold text-ink">
                        {v.badge}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">
                      {v.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ----------------- Visual Stage & Preview ----------------- */}
          <section className="grid gap-4 rounded-2xl border border-line bg-surface-2/60 p-4 sm:p-6">
            {/* Preview Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-extrabold">
                  {activePage.name} (صفحة {activePageIndex + 1} من {activeProject.pages.length})
                </span>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={activePageIndex === 0}
                  onClick={() => setActivePageIndex((prev) => Math.max(0, prev - 1))}
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface transition hover:border-brand disabled:opacity-40"
                  title="الصفحة السابقة"
                >
                  <ChevronRight className="size-4" />
                </button>

                <span className="px-2 text-[12px] font-bold text-muted">
                  {activePageIndex + 1} / {activeProject.pages.length}
                </span>

                <button
                  type="button"
                  disabled={activePageIndex === activeProject.pages.length - 1}
                  onClick={() =>
                    setActivePageIndex((prev) => Math.min(activeProject.pages.length - 1, prev + 1))
                  }
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface transition hover:border-brand disabled:opacity-40"
                  title="الصفحة التالية"
                >
                  <ChevronLeft className="size-4" />
                </button>
              </div>
            </div>

            {/* Central Stage Card */}
            <div className="flex items-center justify-center overflow-auto py-2">
              <div
                className="w-full transition-all duration-200"
                style={{
                  maxWidth: pageSize(activePage).w > pageSize(activePage).h ? "780px" : "560px",
                }}
              >
                <div className="overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/10">
                  <TemplatePreview page={activePage} />
                </div>
              </div>
            </div>

            {/* Multi-page Filmstrip Carousel */}
            <div className="border-t border-line pt-3">
              <p className="mb-2 text-[11px] font-extrabold text-muted">
                صفحات المستند الكامل ({activeProject.pages.length} صفحات):
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-2">
                {activeProject.pages.map((p, index) => {
                  const isCurrent = index === activePageIndex;
                  const size = pageSize(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setActivePageIndex(index)}
                      className={cn(
                        "group relative flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 transition",
                        isCurrent
                          ? "border-brand bg-brand/5 ring-1 ring-brand"
                          : "border-line bg-surface hover:border-line-2",
                      )}
                    >
                      <div
                        className="overflow-hidden rounded border border-line/70 bg-white"
                        style={{
                          width: size.w > size.h ? "72px" : "50px",
                          aspectRatio: `${size.w} / ${size.h}`,
                        }}
                      >
                        <TemplatePreview page={p} />
                      </div>
                      <span className="text-[10px] font-bold text-muted group-hover:text-ink">
                        {p.name.replace("صفحة ", "ص ")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Bottom Action Card */}
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
            <div>
              <strong className="text-[13px] font-black">
                هل أنت مستعد لتخصيص هذا التصميم في المحرر؟
              </strong>
              <p className="text-[11px] font-semibold text-muted">
                يفتح التصميم في محرر نَسَق مع الاحتفاظ بكافة الطبقات، النصوص، الصور، والشبكة متجهة
                بالكامل.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void openInEditor()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-navy px-6 text-[14px] font-black text-on-brand shadow-md transition hover:bg-navy-2 active:scale-[0.98]"
            >
              <ExternalLink className="size-4 text-gold" />
              فتح في محرر نَسَق والبدء بالتعديل
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
