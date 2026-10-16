/**
 * خدمة «استورد ونسّق» — الصفحة العامة لاستيراد الملفات وتحويلها (/services/import).
 *
 * Upload → تصنيف بفهرس الملف (file signature، وليس الامتداد فقط) → تحويل إلى
 * مستند نَسَق قابل للتحرير → معاينته → فتحه في المحرر.
 *
 * الصفحة مفتوحة للزوار للاستعراض والتعرّف على الصيغ المدعومة. التحويل نفسه
 * يتطلب جلسة موثقة وحق `data_import` الذي يحدّده الخادم (التجربة / الاحترافي /
 * مدى الحياة) — لا نموذج اشتراك جديد ولا حد استخدام يُبتدَع على العميل.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Mail,
  FileUp,
  FolderOpen,
  Layers,
  Loader2,
  LogIn,
  Play,
  ShieldAlert,
  SquareArrowOutUpRight,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import type { Project } from "@/lib/editor/model";
import { classifyImport } from "@/lib/editor/import/detect";
import { importTemplateBytes } from "@/lib/editor/import/run";
import type { TemplateImport } from "@/lib/editor/import/run";
import { inspectProject } from "@/lib/editor/import/inspect";
import { repairProject, type RepairOptions } from "@/lib/editor/import/repair";
import type { PsdProgress } from "@/lib/editor/psd/types";
import { listAssets } from "@/lib/editor/storage";
import { BRAND } from "@/lib/brand";
import { generateTemplateName } from "@/lib/templates/naming";
import { cn } from "@/lib/utils";
import { LOGIN_ROUTE, PRICING_ROUTE, WORKSPACE_ROUTE } from "@/lib/site-routes";
import { DocumentPreview } from "./PagePreview";
import { RepairCard } from "./RepairCard";
import { ImportInspector } from "./ImportInspector";
import { btn, ghost, goldBtn } from "./buttons";
import {
  buildFinalProject,
  openSavedInEditor,
  saveImportedDocument,
} from "./commit";

const ACCEPT = ".psd,.psb,.docx,.pptx,.pdf,.png,.jpg,.jpeg,.webp,.svg,.nsq";

type Phase = "idle" | "working" | "ready" | "blocked";

type FormatGuideRow = {
  id: string;
  label: string;
  cap: string;
  preserves: string;
  tier: "أصلي" | "أساسي" | "متقدم";
};

const FORMATS: FormatGuideRow[] = [
  {
    id: "nsq",
    label: "نَسَق (.nsq)",
    cap: "حتى ٣٠٠ ميغابايت",
    preserves: "المستند الأصلي بجميع صفحاته وعناصره وخطوطه المضمّنة",
    tier: "أصلي",
  },
  {
    id: "psd",
    label: "فوتوشوب (PSD / PSB)",
    cap: "حتى ٢٠٠ ميغابايت",
    preserves: "الطبقات، والنصوص، والأشكال، والتأثيرات، والأصول المرتبطة",
    tier: "متقدم",
  },
  {
    id: "pdf",
    label: "بي دي إف (PDF)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "النصوص القابلة للتحديد، والصور، والمسارات المتجهة، وأبعاد الصفحات",
    tier: "أساسي",
  },
  {
    id: "pptx",
    label: "بوربوينت (PPTX)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الشرائح والنصوص والجداول والصور بترتيبها الأصلي",
    tier: "أساسي",
  },
  {
    id: "docx",
    label: "وورد (DOCX)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "النصوص والعناوين والجداول والصور واتجاه الصفحة (العربي أولًا)",
    tier: "أساسي",
  },
  {
    id: "svg",
    label: "فيكتور (SVG)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الرسم المتجه كأثر قابل للتعديل والأبعاد الحقيقية",
    tier: "أساسي",
  },
  {
    id: "png",
    label: "صورة (PNG)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الصورة كأصل قابل للتعديل داخل إطار صفحة للطباعة",
    tier: "أساسي",
  },
  {
    id: "jpg",
    label: "صورة (JPG / JPEG)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الصورة بأبعادها الحقيقية كأثر صورة واحد في الصفحة",
    tier: "أساسي",
  },
  {
    id: "webp",
    label: "صورة (WEBP)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الصورة بأبعادها الحقيقية كأثر صورة واحد في الصفحة",
    tier: "أساسي",
  },
];

export function ImportConvertPage() {
  const { user, isPending: sessionPending } = useCurrentUserState();
  const license = useLicense();
  const entitled = Boolean(user && license.entitlements?.data_import);
  const licenseReady = !sessionPending && license.isLoading === false;

  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ stage: "", percent: 0, detail: "" });
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<TemplateImport | null>(null);
  const [working, setWorking] = useState<Project | null>(null);
  const [repair, setRepair] = useState<{ fixes: any[]; counts: any; base: Project } | null>(null);
  const [compare, setCompare] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [fonts, setFonts] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [titleIsManual, setTitleIsManual] = useState(false);
  const [showFixes, setShowFixes] = useState(false);
  const [trustOrigin, setTrustOrigin] = useState(true);
  const [busy, setBusy] = useState<"repair" | "open" | "save" | "template" | null>(null);

  const take = (next: File | null) => {
    setError(null);
    setFile(null);
    setSourceBytes(null);
    setImported(null);
    setWorking(null);
    setRepair(null);
    setCompare(false);
    setPageIndex(0);
    setPhase("idle");
    if (!next) return;
    const name = next.name.toLowerCase();
    if (!/(\.psd|\.psb|\.docx|\.pptx|\.pdf|\.png|\.jpe?g|\.webp|\.svg|\.nsq)$/i.test(name)) {
      setError("صيغة غير مدعومة. المقبول: PSD وDOCX وPPTX وPDF وPNG وJPG وWEBP وSVG و .nsq.");
      return;
    }
    setFile(next);
    // الزائر يُطلَع على الخدمة، لكن التحويل يحتاج جلسة وحق استيراد.
    if (!user) {
      setError("سجّل الدخول لبدء استيراد الملف وتحويله إلى مستند قابل للتحرير.");
      setPhase("blocked");
      return;
    }
    if (!entitled) {
      setError("التحويل يتطلب خطة تشمل «استيراد البيانات». راجع الخطط والأسعار للاشتراك.");
      setPhase("blocked");
      return;
    }
    void convert(next);
  };

  const convert = useCallback(
    async (input: File) => {
      setPhase("working");
      setError(null);
      setProgress({ stage: "قراءة الملف", percent: 2, detail: input.name });
      try {
        const bytes = new Uint8Array(await input.arrayBuffer());
        const classified = classifyImport(input.name, bytes);
        if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");
        setSourceBytes(bytes);
        setFile(input);
        setProgress({ stage: "تحويل الملف", percent: 30, detail: classified.format.toUpperCase() });
        const assets = await listAssets();
        const result = await importTemplateBytes(bytes, input.name, {
          assets,
          onProgress: ((stage: string, percent: number, detail?: string) =>
            setProgress({ stage, percent, detail: detail || "" })) as PsdProgress,
        });
        setImported(result);
        setWorking(result.project);
        setTitle(generateTemplateName({
          title: result.project.name,
          titleIsManual: false,
          sourceName: input.name,
          format: result.format,
          kind: "json",
          content: result.project,
          category: result.format === "pptx" ? "slides" : result.psd ? "psd" : "import",
        }));
        setTitleIsManual(false);
        setPhase("ready");
        setProgress({ stage: "اكتمل", percent: 100, detail: "" });
        toast.success("اكتمل التحويل — المستند جاهز للمراجعة والفتح في المحرر");
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر تحويل الملف");
        setFile(null);
        setSourceBytes(null);
        setPhase("blocked");
      } finally {
        setPhase("idle");
      }
    },
    [],
  );

  const repairOptions = useMemo<RepairOptions>(() => {
    const pageSizes = imported?.psd?.report.pageSizesMm;
    return { pageSizes, trustOrigin };
  }, [imported, trustOrigin]);

  const runRepair = async () => {
    if (!working) return;
    setBusy("repair");
    try {
      const result = await repairProject(working, repairOptions);
      setRepair({ fixes: result.fixes, counts: result.counts, base: working });
      setWorking(result.project);
      setCompare(result.fixes.length > 0);
      if (result.fixes.length === 0) {
        toast.success("فحصنا المستند — لا يحتاج إلى أي إصلاح");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر تنفيذ الإصلاح");
    } finally {
      setBusy(null);
    }
  };

  const undoRepair = () => {
    if (!repair) return;
    setWorking(repair.base);
    setRepair(null);
    setCompare(false);
    toast.success("أُلغي الإصلاح وعاد المستند إلى نسخته الأصلية");
  };

  const commitProject = async (): Promise<Project> => {
    if (!working || !imported) throw new Error("لا توجد نتيجة تحويل");
    const converted = imported;
    const psd = converted.psd ? { project: working, assets: converted.psd.report.assets } : null;
    const composite = converted.psd?.compositeDataUrl ?? null;
    const final = await buildFinalProject({
      title,
      titleIsManual,
      sourceName: file?.name,
      format: converted.format,
      project: working,
      psd,
      fonts,
      brand: null,
    });
    const thumb =
      (composite && composite.length < 1_800_000 ? composite : null) ||
      converted.previewDataUrl ||
      null;
    return { ...final, thumbnail: thumb ?? final.thumbnail };
  };

  const openInEditor = async () => {
    setBusy("open");
    try {
      const project = await commitProject();
      const saved = await saveImportedDocument(project, imported!.format);
      if (!saved.ok || !saved.id) throw new Error(saved.error);
      await openSavedInEditor(saved.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر فتح المستند في المحرر");
      setBusy(null);
    }
  };

  const saveDocument = async () => {
    setBusy("save");
    try {
      const project = await commitProject();
      const outcome = await saveImportedDocument(project, imported!.format);
      if (!outcome.ok) throw new Error(outcome.error);
      toast.success("حُفظ المستند في مكتبتك، ويمكن فتحه لاحقًا من المحرر");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ المستند");
    } finally {
      setBusy(null);
    }
  };


  const inspection = useMemo(() => (working ? inspectProject(working, repairOptions) : null), [
    working,
    repairOptions,
  ]);

  return (
    <div className="min-h-screen bg-page">
      <SiteHeader current="/services/import" />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        {/* ── masthead ── */}
        <header className="overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-8 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl bg-navy/10 text-brand">
                <FileUp className="size-6" aria-hidden />
              </span>
              <div>
                <p className="text-[10px] font-extrabold tracking-[0.18em] text-muted">
                  {BRAND.platformEn} · IMPORT & CONVERT
                </p>
                <h1 className="mt-0.5 text-[22px] font-black text-ink">استورد ونسّق</h1>
                <p className="mt-1 max-w-2xl text-[12.5px] font-semibold leading-6 text-muted">
                  حوّل ملفات فوتوشوب وWord وبوربوينت وPDF والصور إلى مستندات
                  {BRAND.platform} قابلة للتحرير بالكامل — افحص النتيجة، أصلح ما يحتاج،
                  وافتحها مباشرة في المحرر.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold text-muted">
              {["رفع الملف", "الفحص والتحويل", "المعاينة", "إصلاح العناصر", "فتح في المحرر"].map(
                (step, index, all) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1">
                      <span className="grid size-4 place-items-center rounded-full bg-navy/10 text-[9px] text-brand">
                        {index + 1}
                      </span>
                      {step}
                    </span>
                    {index < all.length - 1 && <span aria-hidden>←</span>}
                  </li>
                ),
              )}
            </div>
          </div>
        </header>

        {/* ── format guide ── */}
        <section className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
            <div>
              <p className="text-[10px] font-extrabold tracking-[0.18em] text-muted">
                الصيغ المدعومة
              </p>
              <h2 className="mt-0.5 text-[16px] font-black text-ink">ما يمكن استيراده وتحويله</h2>
            </div>
            <p className="text-[12px] font-bold text-muted">
              يُفحص كل ملف بمحتوياته الفعلية (فهرس الملف)، وليس باسمه فقط.
            </p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FORMATS.map((row) => (
              <li key={row.id} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-bold text-ink">{row.label}</span>
                  <span className="text-[10px] font-bold text-muted">{row.cap}</span>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full border border-line/60 bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-muted">
                  {row.tier === "أصلي" ? "أصلي نَسَق" : row.tier === "متقدم" ? "متقدم" : "أساسي"}
                </span>
                <p className="mt-2.5 text-[11.5px] leading-5 text-muted">{row.preserves}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] font-bold text-muted">
            الصيغ القديمة من Office (.doc .xls .ppt) غير مدعومة مباشرة — احفظ الملف كـ
            DOCX أو PPTX ثم ارفعه مجددًا. الملفات التالفة أو غير المطابقة لمحتواها تُعرض
            برسالة خطأ توضح سبب الرفض وكيفية تصحيحه.
          </p>
        </section>

        {/* ── upload / gate ── */}
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="flex items-center gap-1.5 text-[13px] font-black text-ink">
                <FolderOpen className="size-4 text-brand" aria-hidden />
                اختر ملفًا للاستيراد
              </h2>
              {licenseReady && !entitled && (
                <p className="mt-1 text-[11.5px] font-bold text-muted">
                  التحويل يتطلب خطة تشمل «استيراد البيانات»
                </p>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              onChange={(e) => take(e.target.files?.[0] || null)}
            />
            {!file && (
              <button
                type="button"
                className={cn(btn, "px-4")}
                disabled={!licenseReady || !user || !entitled}
                onClick={() => inputRef.current?.click()}
              >
                <FileUp className="size-4" aria-hidden /> اختيار من الجهاز
              </button>
            )}
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="رفع ملف للاستيراد"
            className={cn(
              "grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition",
              !licenseReady || !user || !entitled
                ? "border-line/50 bg-surface-2 text-muted hover:none"
                : "border-brand/50 bg-surface hover:border-brand hover:bg-surface-2",
            )}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              take(e.dataTransfer.files?.[0] || null);
            }}
          >
            <FileUp className="mb-3 size-8" aria-hidden />
            <p className="text-[16px] font-black text-ink">
              {file ? file.name : "أسقط الملف هنا أو انقر للاختيار"}
            </p>
            <p className="mt-2 text-[12px] font-bold text-muted">
              PSD · PSB · DOCX · PPTX · PDF · PNG · JPG · WEBP · SVG · .nsq
            </p>
            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] font-bold text-ink">
                {error}
              </p>
            )}
          </div>

          {/* gate messages */}
          {!working && licenseReady && !user && (
            <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 size-4 text-muted" aria-hidden />
                <div>
                  <h3 className="text-[13px] font-black text-ink">كيف أبدأ؟</h3>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    الخدمة مفتوحة للاستعراض والتعرّف على الصيغ. لتحويل ملف فعليًا
                    وحفظه في مكتبتك، سجّل الدخول إلى حسابك في نَسَق.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={LOGIN_ROUTE} className={cn(btn, "px-4")}>
                  <LogIn className="size-3.5" aria-hidden /> تسجيل الدخول
                </a>
                <a href={WORKSPACE_ROUTE} className={cn(ghost, "h-10 px-3")}>
                  استعراض المنصة
                </a>
              </div>
            </div>
          )}

          {!working && licenseReady && user && !entitled && (
            <div className="mt-5 rounded-xl border border-gold/50 bg-gold/[0.06] p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-4 text-gold" aria-hidden />
                <div>
                  <h3 className="text-[13px] font-black text-ink">الاستيراد للمشتركين</h3>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    استعراض الصيغ والدليل مفتوح للجميع. لتحويل ملف فعليًا وحفظه في
                    مكتبتك، تحتاج إلى خطة سارية تشمل «استيراد البيانات» — متوفرة في
                    الخطة التجريبية والاحترافية ومدى الحياة.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={PRICING_ROUTE} className={cn(goldBtn, "px-4")}>
                  عرض الخطط والاشتراك
                </a>
                <a href={WORKSPACE_ROUTE} className={cn(ghost, "h-10 px-3")}>
                  مساحة العمل
                </a>
              </div>
            </div>
          )}
        </section>

        {/* ── conversion progress ── */}
        {phase === "working" && (
          <section className="mt-6 grid place-items-center rounded-2xl border border-line bg-surface px-6 py-16 mb-8">
            <Loader2 className="size-8 animate-spin text-brand" aria-hidden />
            <p className="mt-4 text-[14px] font-extrabold text-ink">{progress.stage || "جارٍ التحويل"}</p>
            <div className="mt-4 h-2 w-full max-w-md overflow-hidden rounded-full bg-paper">
              <div className="h-full bg-navy transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-2 text-[11px] font-semibold text-muted">
              {progress.percent}%{progress.detail ? ` · ${progress.detail}` : ""}
            </p>
          </section>
        )}

        {/* ── result ── */}
        {working && imported && inspection && phase === "idle" && (
          <>
            <section className="mb-8">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="rounded-full bg-navy px-2.5 py-1 text-[10px] font-black tracking-wide text-on-brand">
                    {imported.format.toUpperCase()}
                  </span>
                  <p className="truncate text-[13px] font-extrabold text-ink">{working.name}</p>
                  {imported.psd && (
                    <span className="text-[11px] font-bold text-muted">
                      اكتمال التحويل {imported.psd.report.completion}%
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {working.pages.length > 1 && (
                    <nav className="flex flex-wrap gap-1" aria-label="اختيار الصفحة">
                      {working.pages.map((page, index) => (
                        <button
                          key={page.id}
                          type="button"
                          onClick={() => setPageIndex(index)}
                          className={cn(
                            "h-8 rounded-lg border px-2.5 text-[11px] font-extrabold",
                            pageIndex === index
                              ? "border-brand bg-navy text-on-brand"
                              : "border-line bg-surface text-muted",
                          )}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </nav>
                  )}
                  <button
                    type="button"
                    className={ghost}
                    onClick={() => {
                      setFile(null);
                      setSourceBytes(null);
                      setImported(null);
                      setWorking(null);
                      setRepair(null);
                      setCompare(false);
                      setPhase("idle");
                      setError(null);
                    }}
                  >
                    ملف جديد
                  </button>
                </div>
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] mt-5">
                <div className="grid content-start gap-4">
                  <div className="relative rounded-2xl border border-line bg-surface p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-ink">
                        <Layers className="size-4 text-brand" aria-hidden /> معاينة المستند
                      </p>
                      {repair && (
                        <button
                          type="button"
                          className={ghost}
                          onClick={() => setCompare((v) => !v)}
                          aria-pressed={compare}
                        >
                          <ArrowLeftRight className="size-3.5" aria-hidden />
                          {compare ? "إظهار النتيجة فقط" : "مقارنة قبل وبعد"}
                        </button>
                      )}
                    </div>
                    <DocumentPreview
                      project={working}
                      pageIndex={pageIndex}
                      compareWith={compare && repair ? repair.base : null}
                      compareLabels={["قبل الإصلاح", "بعد الإصلاح"]}
                    />
                  </div>
                  <ImportInspector inspection={inspection} />
                </div>
                <aside className="grid content-start gap-4">
                  <section className="rounded-2xl border border-line bg-surface p-4">
                    <h2 className="mb-3 flex items-center gap-1.5 text-[13px] font-black text-ink">
                      <Wrench className="size-4 text-brand" aria-hidden /> الفحص والإصلاح
                    </h2>
                    <RepairCard
                      repair={repair ? { counts: repair.counts, fixes: repair.fixes } : null}
                      busy={busy === "repair"}
                      problemsCount={inspection.problems.length}
                      isSavedDoc={false}
                      trustOrigin={trustOrigin}
                      onTrustOriginChange={setTrustOrigin}
                      onRepair={() => void runRepair()}
                      onUndo={undoRepair}
                      showFixes={showFixes}
                      onToggleFixes={() => setShowFixes((v) => !v)}
                    />
                  </section>
                  <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
                    <h2 className="flex items-center gap-1.5 text-[13px] font-black text-ink">
                      <SquareArrowOutUpRight className="size-4 text-brand" aria-hidden />
                      الخطوة التالية
                    </h2>
                    <div className="grid gap-2">
                      <button
                        type="button"
                        className={cn(goldBtn, "w-full")}
                        disabled={busy === "open"}
                        onClick={() => void openInEditor()}
                      >
                        {busy === "open" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <>
                            <Play className="size-4" aria-hidden /> افتح في المحرر
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className={ghost}
                        disabled={busy === "save"}
                        onClick={() => void saveDocument()}
                      >
                        {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} احفظ في مكتبتي
                      </button>                      <a
                        href={WORKSPACE_ROUTE}
                        className={cn(ghost, "h-10 justify-self-stretch")}
                        title="فتح مكتبة المشاريع"
                      >
                        الذهاب إلى مساحة العمل
                      </a>
                    </div>
                  </section>
                </aside>
              </div>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
