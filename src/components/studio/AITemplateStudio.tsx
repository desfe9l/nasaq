import { useState, useTransition } from "react";
import {
  Sparkles,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Layers,
  Wand2,
  SlidersHorizontal,
  RotateCcw,
  ExternalLink,
  CheckCircle2,
  Palette,
  FileText,
  Layout,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { saveProject, setSetting } from "@/lib/editor/storage";
import { editorPathFor } from "@/lib/site-routes";
import { uid, cn } from "@/lib/utils";
import { saveCustomTemplate } from "@/lib/templates/custom-templates";
import { resolveTemplateName } from "@/lib/templates/naming";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import {
  generateDesignFromPrompt,
  type StudioGenerationResult,
} from "@/lib/intelligence/pipeline";
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

export function AITemplateStudio({ initialPrompt }: { initialPrompt?: string }) {
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

  // Visual scale
  const [zoom, setZoom] = useState(1);

  // Active variation project
  const currentVariation: DesignVariation | undefined =
    result?.variations.find((v) => v.id === selectedVariationId) || result?.variations[0];
  const activeProject = currentVariation?.project || result?.primaryResult.project;
  const activePage = activeProject?.pages[activePageIndex] || activeProject?.pages[0];

  const handleGenerate = async (targetPrompt?: string) => {
    const text = (targetPrompt || prompt).trim();
    if (!text) {
      toast.error("يرجى كتابة وصف التصميم المطلوب");
      return;
    }

    setBusy(true);
    setStepLabel("تحليل الموجه واستخلاص متطلبات الهوية...");

    try {
      await new Promise((r) => setTimeout(r, 120));
      setStepLabel("بناء الهيكل والشبكة التصميمية واختيار الألوان...");

      await new Promise((r) => setTimeout(r, 150));
      setStepLabel("توليد المكونات، المؤشرات، والجداول وتوزيع العناصر...");

      await new Promise((r) => setTimeout(r, 150));
      setStepLabel("ضبط التوازن البصري والطباعة العربية RTL...");

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

      const gen = generateDesignFromPrompt(text, overrides);
      setResult(gen);
      setSelectedVariationId("sovereign");
      setActivePageIndex(0);
      toast.success("تم توليد التصميم والبدائل بنجاح");
    } catch (err) {
      toast.error("حدث خطأ أثناء التوليد، يرجى المحاولة مرة أخرى");
      console.error(err);
    } finally {
      setBusy(false);
      setStepLabel("");
    }
  };

  const openInEditor = async () => {
    if (!activeProject) return;
    try {
      const name = resolveTemplateName({
        title: activeProject.name || result?.intent.title || "",
        category: result?.intent.docType === "presentation" ? "slides" : "reports",
        kind: "json",
        content: activeProject,
      });
      const saved = await saveProject({
        ...activeProject,
        id: uid("proj"),
        name,
      });
      await setSetting("activeProjectId", saved.id);
      await saveCustomTemplate(
        {
          title: saved.name.slice(0, 80),
          desc: `تصميم مولد بواسطة الذكاء الاصطناعي · نمط ${currentVariation?.name || "مؤسسي"}`,
          category: result?.intent.docType === "presentation" ? "slides" : "reports",
          tags: ["ai-generation", result?.intent.topic || "institutional"],
          pages: saved.pages,
        },
        { premium_templates: true, unlimited_projects: true, unlimited_pages: true },
      );
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
    <div className="grid gap-6 text-ink" dir="rtl">
      {/* ----------------- Header & Prompt Box ----------------- */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid size-10 place-items-center rounded-xl bg-navy text-on-brand shadow-sm">
              <Sparkles className="size-5 text-gold" />
            </div>
            <div>
              <h1 className="text-[18px] font-black sm:text-[20px]">
                استوديو التصميم والتوليد بالذكاء الاصطناعي
              </h1>
              <p className="text-[12px] font-semibold text-muted">
                حول فكرتك إلى تصميم مؤسسي متكامل وقابل للتحرير بالكامل في محرر نَسَق
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowTuning(!showTuning)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold text-muted transition hover:border-brand hover:text-brand"
          >
            <SlidersHorizontal className="size-3.5" />
            <span>خيارات التخصيص</span>
          </button>
        </div>

        {/* Primary Prompt Input */}
        <div className="mt-5 grid gap-3">
          <div className="relative flex flex-col gap-2 sm:flex-row">
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
                className="h-12 w-full rounded-xl border-2 border-line bg-page px-4 text-[14px] font-bold placeholder:text-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 sm:text-[15px]"
              />
            </div>

            <button
              type="button"
              disabled={busy || !prompt.trim()}
              onClick={() => void handleGenerate()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-navy px-6 text-[14px] font-black text-on-brand shadow-md transition hover:bg-navy-2 active:scale-[0.99] disabled:opacity-50"
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
            <div className="mt-3 grid gap-3 rounded-xl border border-line/80 bg-surface-2/40 p-4 sm:grid-cols-3">
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
                onClick={() => void handleGenerate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[12px] font-bold text-ink transition hover:border-brand hover:text-brand"
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
