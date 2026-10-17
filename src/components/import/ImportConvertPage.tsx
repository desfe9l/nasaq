/**
 * خدمة «استورد ونسّق» — الصفحة العامة لاستيراد الملفات وتحويلها (/services/import).
 *
 * معمارية تدريجية ثلاثية المراحل (Progressive Disclosure Architecture):
 * 1. Stage 1 (Hero Dropzone): منطقة إسقاط رحبة ومرحبة بالصيغ المؤسسية.
 * 2. Stage 2 (Pathways): مسارات استيراد متخصصة (تقارير، جداول، مشاريع نَسَق).
 * 3. Stage 3 (Contextual Options): تهيئة الملف المختار، تسميته، وضبط الوثوق قبل التحويل الفوري.
 *
 * المحرك يحافظ بالكامل على خط المعالجة المعتمد:
 * classifyImport → importTemplateBytes → repairProject → commitProject → openSavedInEditor.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
  Layers,
  Loader2,
  LogIn,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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

const ACCEPT_ALL = ".psd,.psb,.docx,.pptx,.pdf,.png,.jpg,.jpeg,.webp,.svg,.nsq,.xlsx,.json";

type Phase = "idle" | "configuring" | "working" | "ready" | "blocked";

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
    label: "نَسَق (.nsq / JSON)",
    cap: "حتى ٣٠٠ ميغابايت",
    preserves: "المستند الأصلي بجميع صفحاته وعناصره وخطوطه المضمّنة وهياكل التخطيط",
    tier: "أصلي",
  },
  {
    id: "psd",
    label: "فوتوشوب (PSD / PSB)",
    cap: "حتى ٢٠٠ ميغابايت",
    preserves: "الطبقات، والنصوص القابلة للتحرير، والأشكال، والتأثيرات، والأصول المرتبطة",
    tier: "متقدم",
  },
  {
    id: "pdf",
    label: "بي دي إف (PDF)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "النصوص القابلة للتحديد، والصور، والمسارات المتجهة، وأبعاد الصفحات القياسية",
    tier: "أساسي",
  },
  {
    id: "docx",
    label: "وورد (DOCX)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "النصوص، والعناوين، والهياكل، والجداول، والصور، مع اتجاه RTL العربي الأصلي",
    tier: "أساسي",
  },
  {
    id: "xlsx",
    label: "إكسل (XLSX)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "مصفوفات الجداول والبيانات الرقمية مع تحويلها لقوالب تقارير نَسَق",
    tier: "أساسي",
  },
  {
    id: "pptx",
    label: "بوربوينت (PPTX)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الشرائح، والنصوص، والجداول، والصور بترتيبها وسماتها البصرية الأصلية",
    tier: "أساسي",
  },
  {
    id: "svg",
    label: "فيكتور (SVG)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الرسم المتجه كأصول دقيقة قابلة للتعديل والتحجيم بدون فقدان للجودة",
    tier: "أساسي",
  },
  {
    id: "img",
    label: "صور (PNG / JPG / WEBP)",
    cap: "حتى ٨٠ ميغابايت",
    preserves: "الصور بالأبعاد الحقيقية مدمجة داخل إطارات صفحات مهيأة للطباعة والإخراج",
    tier: "أساسي",
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
}

export function ImportConvertPage() {
  const { user, isPending: sessionPending } = useCurrentUserState();
  const license = useLicense();
  const entitled = Boolean(user && license.entitlements?.data_import);
  const licenseReady = !sessionPending && license.isLoading === false;

  const inputRef = useRef<HTMLInputElement>(null);
  const [currentAccept, setCurrentAccept] = useState(ACCEPT_ALL);

  // File and state pipeline
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ stage: "", percent: 0, detail: "" });
  const [error, setError] = useState<string | null>(null);

  // Converted result
  const [imported, setImported] = useState<TemplateImport | null>(null);
  const [working, setWorking] = useState<Project | null>(null);
  const [repair, setRepair] = useState<{ fixes: any[]; counts: any; base: Project } | null>(null);
  const [compare, setCompare] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [fonts] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [titleIsManual, setTitleIsManual] = useState(false);
  const [showFixes, setShowFixes] = useState(false);
  const [trustOrigin, setTrustOrigin] = useState(true);
  const [busy, setBusy] = useState<"repair" | "open" | "save" | "template" | null>(null);

  // 1. Stage: Select file (enters "configuring" state)
  const take = (next: File | null) => {
    setError(null);
    if (!next) return;

    const name = next.name.toLowerCase();
    if (!/(\.psd|\.psb|\.docx|\.pptx|\.pdf|\.png|\.jpe?g|\.webp|\.svg|\.nsq|\.xlsx|\.json)$/i.test(name)) {
      setError("صيغة غير مدعومة. يدعم النظام: Word, PDF, Excel, PowerPoint, Photoshop, JSON, NSQ, والصور.");
      return;
    }

    setPendingFile(next);
    // Pre-populate document title with clean base name
    const cleanBaseName = next.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ");
    setTitle(cleanBaseName);
    setTitleIsManual(false);
    setPhase("configuring");
  };

  const triggerPicker = (acceptTypes: string = ACCEPT_ALL) => {
    setCurrentAccept(acceptTypes);
    setTimeout(() => {
      inputRef.current?.click();
    }, 10);
  };

  const cancelPendingFile = () => {
    setPendingFile(null);
    setError(null);
    setPhase("idle");
  };

  // 2. Stage: Convert selected file
  const convert = useCallback(
    async (input: File, customTitle?: string) => {
      if (!user) {
        setError("يرجى تسجيل الدخول لبدء استيراد الملف وحفظه في مساحة العمل الخاصة بك.");
        setPhase("blocked");
        return;
      }
      if (!entitled) {
        setError("ميزة الاستيراد المتقدم تتطلب خطة تشمل «استيراد البيانات». يرجى مراجعة الخطط المتاحة.");
        setPhase("blocked");
        return;
      }

      setPhase("working");
      setError(null);
      setProgress({ stage: "قراءة وتحليل الملف", percent: 5, detail: input.name });

      try {
        const bytes = new Uint8Array(await input.arrayBuffer());
        const classified = classifyImport(input.name, bytes);
        if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة أو ملف تالف.");

        setFile(input);
        setProgress({ stage: "معالجة البنية والطبقات", percent: 35, detail: classified.format.toUpperCase() });

        const assets = await listAssets();
        const result = await importTemplateBytes(bytes, input.name, {
          assets,
          onProgress: ((stage: string, percent: number, detail?: string) =>
            setProgress({ stage, percent, detail: detail || "" })) as PsdProgress,
        });

        setImported(result);
        setWorking(result.project);

        const assignedTitle = customTitle?.trim()
          ? customTitle.trim()
          : generateTemplateName({
              title: result.project.name,
              titleIsManual: false,
              sourceName: input.name,
              format: result.format,
              kind: "json",
              content: result.project,
              category: result.format === "pptx" ? "slides" : result.psd ? "psd" : "import",
            });

        setTitle(assignedTitle);
        setTitleIsManual(Boolean(customTitle?.trim()));
        setPhase("ready");
        setProgress({ stage: "اكتمل التحويل بنجاح", percent: 100, detail: "" });
        toast.success("تم استيراد المستند بنجاح — يمكنك مراجعته وإصلاحه وفتحه في المحرر");
      } catch (err) {
        setError(err instanceof Error ? err.message : "تعذر استيراد الملف");
        setFile(null);
        setPhase("blocked");
      }
    },
    [user, entitled],
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
        toast.success("تم فحص المستند — جميع العناصر متوافقة ولا تحتاج إلى إصلاح");
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
      toast.success("حُفظ المستند في مساحة العمل بنجاح");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ المستند");
    } finally {
      setBusy(null);
    }
  };

  const resetAll = () => {
    setPendingFile(null);
    setFile(null);
    setImported(null);
    setWorking(null);
    setRepair(null);
    setCompare(false);
    setPhase("idle");
    setError(null);
  };

  const inspection = useMemo(() => (working ? inspectProject(working, repairOptions) : null), [
    working,
    repairOptions,
  ]);

  return (
    <div className="min-h-screen bg-page">
      <SiteHeader current="/services/import" />

      {/* Main Content with bottom padding for mobile dock */}
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pb-24 md:pb-12">
        {/* Hidden Master File Input */}
        <input
          ref={inputRef}
          type="file"
          accept={currentAccept}
          className="sr-only"
          onChange={(e) => {
            take(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />

        {/* ── Masthead ── */}
        <header className="overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-7 mb-8 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-4 sm:gap-6">
            <div className="flex items-center gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-navy text-on-brand shadow-sm">
                <FileUp className="size-6" aria-hidden />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-extrabold tracking-[0.16em] text-brand">
                    {BRAND.platformEn} · SMART CONVERSION ENGINE
                  </p>
                  <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted border border-line">
                    الجيل الثاني
                  </span>
                </div>
                <h1 className="mt-0.5 text-xl sm:text-2xl font-black text-ink">
                  الاستيراد الذكي والتحويل الفوري
                </h1>
                <p className="mt-1 max-w-2xl text-xs sm:text-sm font-semibold leading-6 text-muted">
                  حوّل مستندات العمل (Word, PDF, Excel, PowerPoint, Photoshop, JSON) إلى تصاميم
                  مؤسسية قابلة للتحرير الفوري على منصة {BRAND.platform} مع مطابقة الأبعاد والخطوط.
                </p>
              </div>
            </div>

            {/* Stage Indicator */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-muted">
              {[
                { num: "١", label: "اختيار الملف" },
                { num: "٢", label: "التهيئة والخيارات" },
                { num: "٣", label: "المعاينة والإصلاح" },
                { num: "٤", label: "التحرير المباشر" },
              ].map((step, idx, arr) => {
                const isCurrent =
                  (idx === 0 && (phase === "idle" || phase === "blocked")) ||
                  (idx === 1 && phase === "configuring") ||
                  (idx === 2 && (phase === "working" || (phase === "ready" && working))) ||
                  (idx === 3 && working);
                return (
                  <div key={step.label} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
                        isCurrent
                          ? "border-brand bg-navy text-on-brand font-extrabold"
                          : "border-line bg-surface-2 text-muted",
                      )}
                    >
                      <span className="font-sans font-bold">{step.num}</span>
                      <span>{step.label}</span>
                    </span>
                    {idx < arr.length - 1 && <span className="text-muted/60" aria-hidden>←</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        {/* ── STAGE 1 & 2: IDLE STATE (Hero Dropzone + 3 Pathways) ── */}
        {(phase === "idle" || (phase === "blocked" && !pendingFile)) && !working && (
          <div className="grid gap-8">
            {/* Stage 1: Central Hero Dropzone */}
            <section aria-labelledby="dropzone-heading">
              <h2 id="dropzone-heading" className="sr-only">رفع المستند</h2>
              <div
                role="button"
                tabIndex={0}
                aria-label="اسحب ملفك هنا أو انقر للاختيار"
                className={cn(
                  "group relative grid cursor-pointer place-items-center rounded-3xl border-2 border-dashed px-6 py-12 sm:py-16 text-center transition shadow-sm",
                  "border-brand/40 bg-surface hover:border-brand hover:bg-surface-2 active:scale-[0.995]",
                )}
                onClick={() => triggerPicker(ACCEPT_ALL)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") triggerPicker(ACCEPT_ALL);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  take(e.dataTransfer.files?.[0] || null);
                }}
              >
                <div className="grid size-16 sm:size-20 place-items-center rounded-2xl bg-brand/10 text-brand transition duration-300 group-hover:scale-105 group-hover:bg-brand/15">
                  <FileUp className="size-8 sm:size-10" aria-hidden />
                </div>

                <p className="mt-5 text-lg sm:text-xl font-black text-ink">
                  اسحب ملفك هنا لتحويله إلى نسق احترافي خلال ثوانٍ
                </p>
                <p className="mt-2 text-xs sm:text-sm font-semibold text-muted max-w-lg">
                  أو انقر في أي مكان داخل الإطار لاختيار الملف من جهازك ومباشرة التهيئة الفورية.
                </p>

                {/* Clean Format Badges */}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {[
                    { label: "Word (.docx)", dot: "bg-brand" },
                    { label: "PDF (.pdf)", dot: "bg-ink" },
                    { label: "Excel (.xlsx)", dot: "bg-brand" },
                    { label: "PowerPoint (.pptx)", dot: "bg-brand" },
                    { label: "Photoshop (PSD/PSB)", dot: "bg-ink" },
                    { label: "نَسَق (JSON / .nsq)", dot: "bg-brand" },
                  ].map((badge) => (
                    <span
                      key={badge.label}
                      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-bold text-muted"
                    >
                      <span className={cn("size-1.5 rounded-full", badge.dot)} aria-hidden />
                      {badge.label}
                    </span>
                  ))}
                </div>

                <div className="mt-6">
                  <span className="inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-xs font-black text-on-brand shadow-sm transition hover:bg-navy-2">
                    <FolderOpen className="size-4" />
                    <span>تصفح ملفات الجهاز</span>
                  </span>
                </div>

                {error && (
                  <p role="alert" className="mt-5 max-w-md rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-xs font-bold text-ink shadow-sm">
                    {error}
                  </p>
                )}
              </div>
            </section>

            {/* Stage 2: 3 Clean Import Pathways */}
            <section aria-labelledby="pathways-heading">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold tracking-[0.14em] text-brand">
                    مسارات مخصصة
                  </p>
                  <h2 id="pathways-heading" className="mt-0.5 text-lg font-black text-ink">
                    اختر نوع المستند لبدء التحويل المباشر
                  </h2>
                </div>
                <p className="text-xs font-bold text-muted">
                  تحسين تلقائي لكل صيغة وفق المعايير المؤسسية
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Pathway 1: Report / Letter */}
                <article
                  role="button"
                  tabIndex={0}
                  onClick={() => triggerPicker(".docx,.pdf")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") triggerPicker(".docx,.pdf");
                  }}
                  className="group relative flex cursor-pointer flex-col justify-between rounded-2xl border border-line bg-surface p-5 transition hover:border-brand hover:shadow-card active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
                        <FileText className="size-5" />
                      </span>
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-bold text-muted">
                        Word · PDF
                      </span>
                    </div>
                    <h3 className="mt-4 text-sm font-extrabold text-ink group-hover:text-brand">
                      استيراد تقرير أو خطاب رسمي
                    </h3>
                    <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
                      تفريغ النصوص واستخراج الجداول وإعادة توزيعها تلقائيًا داخل قوالب A4 مؤسسية رسمية مع الحفاظ على الهيكل العام.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-line text-xs font-extrabold text-brand">
                    <span>اختر ملف تقرير</span>
                    <ArrowLeft className="size-3.5 transition group-hover:-translate-x-1" />
                  </div>
                </article>

                {/* Pathway 2: Sheets / Statistics */}
                <article
                  role="button"
                  tabIndex={0}
                  onClick={() => triggerPicker(".xlsx,.csv")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") triggerPicker(".xlsx,.csv");
                  }}
                  className="group relative flex cursor-pointer flex-col justify-between rounded-2xl border border-line bg-surface p-5 transition hover:border-brand hover:shadow-card active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
                        <FileSpreadsheet className="size-5" />
                      </span>
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-bold text-muted">
                        Excel · Data
                      </span>
                    </div>
                    <h3 className="mt-4 text-sm font-extrabold text-ink group-hover:text-brand">
                      استيراد جداول وإحصائيات رقمية
                    </h3>
                    <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
                      تحويل جداول البيانات ومصفوفات الأرقام المعقدة إلى جداول تصميمية مهيأة للطباعة والعرض التنفيذي الفوري.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-line text-xs font-extrabold text-brand">
                    <span>اختر ملف إكسل</span>
                    <ArrowLeft className="size-3.5 transition group-hover:-translate-x-1" />
                  </div>
                </article>

                {/* Pathway 3: NASAQ Project / Backup */}
                <article
                  role="button"
                  tabIndex={0}
                  onClick={() => triggerPicker(".nsq,.json")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") triggerPicker(".nsq,.json");
                  }}
                  className="group relative flex cursor-pointer flex-col justify-between rounded-2xl border border-line bg-surface p-5 transition hover:border-brand hover:shadow-card active:scale-[0.99]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="grid size-10 place-items-center rounded-xl bg-navy text-on-brand">
                        <FileArchive className="size-5" />
                      </span>
                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-bold text-muted">
                        .nsq · JSON
                      </span>
                    </div>
                    <h3 className="mt-4 text-sm font-extrabold text-ink group-hover:text-brand">
                      استيراد نسخة نَسَق احتياطية
                    </h3>
                    <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
                      استعادة فورية لكامل طبقات التصميم، الخطوط، والألوان لمتابعة التحرير من أي جهاز دون فقدان أي عنصر.
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between pt-3 border-t border-line text-xs font-extrabold text-brand">
                    <span>اختر مشروع نَسَق</span>
                    <ArrowLeft className="size-3.5 transition group-hover:-translate-x-1" />
                  </div>
                </article>
              </div>
            </section>

            {/* Format Reference Guide Table */}
            <section aria-labelledby="formats-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6 shadow-sm">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="formats-heading" className="text-sm font-black text-ink">
                    دليل فحص الصيغ والمحتويات
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    يُفحص كل ملف وفق بنيته الداخلية الفعلية (File Signature) وليس بالامتداد فقط
                  </p>
                </div>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {FORMATS.map((row) => (
                  <li key={row.id} className="rounded-xl border border-line bg-surface-2/60 p-3">
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="font-extrabold text-xs text-ink">{row.label}</span>
                      <span className="text-[10px] font-bold text-muted">{row.cap}</span>
                    </div>
                    <p className="text-[11px] font-semibold leading-4 text-muted line-clamp-2">
                      {row.preserves}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        {/* ── STAGE 3: CONTEXTUAL OPTIONS (File Selected, Configuring) ── */}
        {(phase === "configuring" || (phase === "blocked" && pendingFile)) && pendingFile && (
          <section aria-labelledby="config-heading" className="mx-auto max-w-3xl">
            <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8 shadow-card">
              <div className="flex items-center justify-between border-b border-line pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-navy text-on-brand">
                    <Sparkles className="size-5" />
                  </span>
                  <div>
                    <h2 id="config-heading" className="text-base font-black text-ink">
                      تهيئة مستند الاستيراد
                    </h2>
                    <p className="text-xs font-semibold text-muted">
                      راجع إعدادات الملف قبل توليد المستند التحريري
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={cancelPendingFile}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-muted hover:text-ink hover:bg-surface-2"
                >
                  إلغاء واختيار ملف آخر
                </button>
              </div>

              {/* Selected File Card */}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-surface border border-line text-brand">
                    <FileText className="size-6" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-ink">{pendingFile.name}</p>
                    <p className="text-xs font-semibold text-muted">
                      الحجم: {formatBytes(pendingFile.size)} · الصيغة: {pendingFile.name.split(".").pop()?.toUpperCase() || "ملف"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 border border-brand/20 px-2.5 py-1 text-xs font-bold text-brand">
                    <Check className="size-3.5" /> جاهز للتحويل
                  </span>
                  <button
                    type="button"
                    onClick={() => triggerPicker(ACCEPT_ALL)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-muted hover:text-brand"
                  >
                    <RefreshCw className="size-3" /> استبدال
                  </button>
                </div>
              </div>

              {/* Document Name Field */}
              <div className="mt-6 grid gap-2">
                <label htmlFor="import-doc-title" className="text-xs font-black text-ink">
                  اسم المستند في منصة نَسَق
                </label>
                <input
                  id="import-doc-title"
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleIsManual(true);
                  }}
                  placeholder="أدخل عنواناً واضحاً للمستند..."
                  className="h-11 rounded-xl border border-line bg-page px-3.5 text-sm font-bold text-ink outline-none transition focus:border-brand focus:ring-1 focus:ring-brand"
                />
                <p className="text-[11px] font-semibold text-muted">
                  سيُعتمد هذا الاسم في فهرس مشاريعك ويمكن تغييره لاحقًا في أي وقت.
                </p>
              </div>

              {/* Trust Origin Toggle */}
              <div className="mt-5 rounded-2xl border border-line bg-surface-2/60 p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={trustOrigin}
                    onChange={(e) => setTrustOrigin(e.target.checked)}
                    className="mt-1 size-4 rounded border-line text-navy accent-navy"
                  />
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-black text-ink">
                      <ShieldCheck className="size-4 text-brand" />
                      الوثوق في أصل الملف ومعايير الأبعاد (Trust Origin)
                    </span>
                    <p className="mt-0.5 text-xs font-semibold leading-5 text-muted">
                      الحفاظ على مقاييس الصفحات، مواقع الطبقات، وهوامش الأمان كما وردت تمامًا في الملف المصدري دون إعادة تحجيم إجبارية.
                    </p>
                  </div>
                </label>
              </div>

              {/* Gate Checks (Auth / Entitlement) */}
              {!user && licenseReady && (
                <div className="mt-6 rounded-2xl border border-line bg-surface-2 p-4">
                  <div className="flex items-start gap-3">
                    <LogIn className="mt-0.5 size-4 text-brand" />
                    <div>
                      <h3 className="text-xs font-black text-ink">تسجيل الدخول مطلوب للمتابعة</h3>
                      <p className="mt-1 text-xs font-semibold text-muted leading-5">
                        لإتمام تحويل الملف وحفظه بأمان في مساحة العمل الخاصة بك، يرجى تسجيل الدخول إلى حسابك أولاً.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <a href={LOGIN_ROUTE} className={cn(btn, "px-4")}>
                      <LogIn className="size-3.5" /> تسجيل الدخول الآن
                    </a>
                  </div>
                </div>
              )}

              {user && licenseReady && !entitled && (
                <div className="mt-6 rounded-2xl border border-line bg-surface-2 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 size-4 text-brand" />
                    <div>
                      <h3 className="text-xs font-black text-ink">ميزة الاستيراد تتطلب خطة سارية</h3>
                      <p className="mt-1 text-xs font-semibold text-muted leading-5">
                        التحويل التلقائي يتطلب اشتراكًا يتضمن «استيراد البيانات» (متاح في الخطة التجريبية، الاحترافية، ومدى الحياة).
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <a href={PRICING_ROUTE} className={cn(goldBtn, "px-4")}>
                      عرض الخطط والاشتراك
                    </a>
                  </div>
                </div>
              )}

              {error && (
                <p role="alert" className="mt-5 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-xs font-bold text-ink">
                  {error}
                </p>
              )}

              {/* Action Buttons */}
              <div className="mt-7 flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={cancelPendingFile}
                  className="rounded-xl border border-line bg-surface px-4 py-2.5 text-xs font-extrabold text-muted hover:text-ink hover:bg-surface-2 transition"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={!licenseReady || !user || !entitled}
                  onClick={() => void convert(pendingFile, title)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-black shadow-sm transition active:scale-[0.98]",
                    !licenseReady || !user || !entitled
                      ? "opacity-50 cursor-not-allowed bg-surface-2 text-muted border border-line"
                      : "bg-navy text-on-brand hover:bg-navy-2",
                  )}
                >
                  <Sparkles className="size-4" />
                  <span>ابدأ التحويل الآن</span>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── CONVERSION PROGRESS ── */}
        {phase === "working" && (
          <section aria-labelledby="progress-heading" className="mx-auto max-w-xl text-center rounded-3xl border border-line bg-surface px-6 py-16 shadow-card">
            <h2 id="progress-heading" className="sr-only">جارٍ معالجة المستند</h2>
            <Loader2 className="size-10 animate-spin text-brand mx-auto" aria-hidden />
            <p className="mt-5 text-base font-black text-ink">{progress.stage || "جارٍ تحويل الملف..."}</p>
            <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-2 border border-line">
              <div
                className="h-full bg-navy transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="mt-2.5 text-xs font-bold text-muted">
              {progress.percent}%{progress.detail ? ` · ${progress.detail}` : ""}
            </p>
          </section>
        )}

        {/* ── STAGE 4: READY / CONVERTED RESULT INSPECTION & EDITOR ACTION ── */}
        {working && imported && inspection && (phase === "ready" || phase === "idle") && (
          <section aria-labelledby="result-heading" className="grid gap-6">
            <h2 id="result-heading" className="sr-only">معاينة ونتائج التحويل</h2>

            {/* Document Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 shadow-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span className="rounded-lg bg-navy px-2.5 py-1 text-xs font-black tracking-wide text-on-brand">
                  {imported.format.toUpperCase()}
                </span>
                <p className="truncate text-sm sm:text-base font-black text-ink">{working.name}</p>
                {imported.psd && (
                  <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-muted border border-line">
                    نسبة المطابقة: {imported.psd.report.completion}%
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
                          "h-8 rounded-lg border px-3 text-xs font-black transition",
                          pageIndex === index
                            ? "border-brand bg-navy text-on-brand"
                            : "border-line bg-surface-2 text-muted hover:text-ink",
                        )}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </nav>
                )}
                <button
                  type="button"
                  className={cn(ghost, "h-9 px-3 text-xs")}
                  onClick={resetAll}
                >
                  <RefreshCw className="size-3.5" />
                  <span>تحويل ملف آخر</span>
                </button>
              </div>
            </div>

            {/* Preview and Controls Grid */}
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="grid content-start gap-5">
                <div className="relative rounded-2xl border border-line bg-surface p-5 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-xs font-black text-ink">
                      <Layers className="size-4 text-brand" aria-hidden /> معاينة المستند التفاعلي
                    </p>
                    {repair && (
                      <button
                        type="button"
                        className={cn(ghost, "h-8 px-2.5 text-xs")}
                        onClick={() => setCompare((v) => !v)}
                        aria-pressed={compare}
                      >
                        <ArrowLeftRight className="size-3.5" aria-hidden />
                        {compare ? "إظهار النتيجة بعد الإصلاح" : "مقارنة قبل وبعد"}
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

              {/* Sidebar: Repair & Next Actions */}
              <aside className="grid content-start gap-5">
                <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-ink">
                    <Wrench className="size-4 text-brand" aria-hidden /> الفحص والمعالجة الذكية
                  </h3>
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

                <section className="grid gap-3 rounded-2xl border border-line bg-surface p-5 shadow-sm">
                  <h3 className="flex items-center gap-2 text-sm font-black text-ink">
                    <SquareArrowOutUpRight className="size-4 text-brand" aria-hidden />
                    الإجراء التالي
                  </h3>
                  <div className="grid gap-2.5">
                    <button
                      type="button"
                      className={cn(goldBtn, "w-full h-11 text-xs font-black")}
                      disabled={busy === "open"}
                      onClick={() => void openInEditor()}
                    >
                      {busy === "open" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          <Play className="size-4" aria-hidden /> فتح المستند في المحرر مباشرة
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className={cn(ghost, "w-full h-10 text-xs font-bold")}
                      disabled={busy === "save"}
                      onClick={() => void saveDocument()}
                    >
                      {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null}
                      حفظ في مساحة العمل
                    </button>
                    <a
                      href={WORKSPACE_ROUTE}
                      className={cn(ghost, "w-full h-10 text-xs font-bold text-center")}
                      title="فتح مساحة العمل"
                    >
                      الذهاب إلى مساحة العمل
                    </a>
                  </div>
                </section>
              </aside>
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
