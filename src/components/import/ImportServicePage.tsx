/**
 * خدمة استيراد القوالب — NASAQ template-import service (/import).
 *
 * Upload → Inspect → إصلاح العناصر → Review → Open in the editor.
 *
 * A dedicated product surface for template managers: PSD, Word, PowerPoint,
 * PDF and images become real editable NASAQ documents, the smart inspector
 * shows what the conversion produced, and the repair engine fixes conversion
 * damage against the source file's own geometry — conservatively, reversibly,
 * and always showing what changed. The original import is never destroyed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBrandIdentity, type BrandIdentityState } from "@/lib/product/use-brand-identity";
import {
  ArrowLeftRight,
  ClipboardCheck,
  FileUp,
  FolderOpen,
  Layers,
  Palette,
  Loader2,
  SquareArrowOutUpRight,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { adminTemplatesAccessFn } from "@/lib/admin/functions";
import { authorizeTemplateImportFn } from "@/lib/psd/functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { Project } from "@/lib/editor/model";
import { classifyImport } from "@/lib/editor/import/detect";
import type { TemplateImport } from "@/lib/editor/import/run";
import { inspectProject } from "@/lib/editor/import/inspect";
import {
  repairProject,
  type RepairFix,
  type RepairCounts,
} from "@/lib/editor/import/repair";
import type { PsdImportResult } from "@/lib/editor/psd/pipeline";
import { magicHexOf } from "@/lib/editor/psd/security";
import { getProject, listProjects } from "@/lib/editor/storage";
import type { ProjectMeta } from "@/lib/editor/model";
import { BRAND } from "@/lib/brand";
import { generateTemplateName, resolveTemplateName } from "@/lib/templates/naming";
import { cn } from "@/lib/utils";
import { WORKSPACE_ROUTE } from "@/lib/site-routes";
import { DocumentPreview } from "./PagePreview";
import { RepairCard } from "./RepairCard";
import { btn, ghost } from "./buttons";
import { ImportInspector } from "./ImportInspector";
import {
  buildFinalProject,
  openSavedInEditor,
  saveImportedDocument,
  saveImportedTemplate,
  updateImportedDocument,
  IMPORT_HISTORY_KEY,
  type AttachedFonts,
  type ImportHistoryEntry,
} from "./commit";

const ACCEPT = ".psd,.psb,.docx,.pptx,.xlsx,.pdf,.png,.jpg,.jpeg,.svg";
const MAX_HINT = "PSD حتى ٢٠٠ ميغابايت · ملفات Office وPDF حتى ٨٠ ميغابايت";


type Access = "checking" | "ok" | "signin" | "forbidden";

/**
 * One converted-document shape for every format — the canonical import
 * service's `TemplateImport` — plus the «already saved document» case used by
 * the repair flow. The PSD report, when present, lives on `result.psd`.
 */
type ImportedDoc =
  | { kind: "converted"; result: TemplateImport }
  | { kind: "saved"; project: Project; id: string };

interface RepairState {
  fixes: RepairFix[];
  counts: RepairCounts;
  /** The document the repair ran on (the untouched original). */
  base: Project;
}

export function ImportServicePage() {
  const brand = useBrandIdentity();
  const { user, isPending } = useCurrentUserState();
  const [access, setAccess] = useState<Access>("checking");

  useEffect(() => {
    if (isPending) return;
    if (!user) {
      setAccess("signin");
      return;
    }
    let alive = true;
    void adminTemplatesAccessFn()
      .then((result) => {
        if (!alive) return;
        setAccess(result.ok ? "ok" : result.reason === "signin" ? "signin" : "forbidden");
      })
      .catch(() => alive && setAccess("signin"));
    return () => {
      alive = false;
    };
  }, [user, isPending]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader current="/import" />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <ServiceMasthead brand={brand} />
        {access === "checking" && (
          <p className="mt-10 flex items-center gap-2 text-[13px] font-bold text-muted">
            <Loader2 className="size-4 animate-spin" /> جارٍ التحقق من الصلاحية…
          </p>
        )}
        {access === "signin" && <AccessDenied kind="signin" />}
        {access === "forbidden" && <AccessDenied kind="forbidden" />}
        {access === "ok" && <ServiceWorkspace brand={brand} />}
      </main>
      <SiteFooter />
    </div>
  );
}

/* ── masthead & gate ──────────────────────────────────────────────────────── */

function ServiceMasthead({ brand }: { brand: BrandIdentityState }) {
  return (
    <header className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-xl bg-navy/10 text-brand">
            <Layers className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-[10px] font-extrabold tracking-[0.18em] text-muted">
              {BRAND.platformEn} · IMPORT STUDIO
            </p>
            <h1 className="mt-0.5 text-[22px] font-black text-ink">استيراد القوالب وتحويلها</h1>
            {brand.kit && (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-navy/5 px-2.5 py-0.5 text-[10.5px] font-bold text-brand">
                <Palette className="size-3" aria-hidden />
                تُطبَّق {brand.kit.organizationName?.trim() || "الهوية المؤسسية"} على المستند المحوَّل
              </p>
            )}
            <p className="mt-1 max-w-2xl text-[12.5px] font-semibold leading-6 text-muted">
              ارفع ملف Photoshop أو Word أو PowerPoint أو PDF أو صورة، واحصل على مستند {BRAND.platform} قابل
              للتحرير بالكامل — مع فحص ذكي للمشكلات وإصلاح تلقائي يحافظ على التكوين الأصلي.
            </p>
          </div>
        </div>
        <ol className="flex flex-wrap items-center gap-2 text-[11px] font-extrabold text-muted">
          {["رفع الملف", "الفحص", "إصلاح العناصر", "المراجعة", "فتح في المحرر"].map((step, index, all) => (
            <li key={step} className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1">
                <span className="grid size-4 place-items-center rounded-full bg-navy/10 text-[9px] text-brand">
                  {index + 1}
                </span>
                {step}
              </span>
              {index < all.length - 1 && <span aria-hidden>←</span>}
            </li>
          ))}
        </ol>
      </div>
    </header>
  );
}

function AccessDenied({ kind }: { kind: "signin" | "forbidden" }) {
  return (
    <section className="mt-8 grid place-items-center rounded-2xl border border-line bg-surface px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-navy/10 text-brand">
        <ShieldCheck className="size-7" aria-hidden />
      </span>
      <h2 className="mt-4 text-[18px] font-black text-ink">
        {kind === "signin" ? "هذه الخدمة تتطلب تسجيل الدخول" : "الخدمة متاحة لمديري القوالب"}
      </h2>
      <p className="mt-2 max-w-md text-[13px] font-semibold leading-6 text-muted">
        {kind === "signin"
          ? "سجّل الدخول بحسابك للوصول إلى استوديو الاستيراد."
          : "استيراد القوالب وتحويلها إلى مستندات نَسَق متاح لحسابات إدارة القوالب. تواصل مع الإدارة إن كنت تحتاج صلاحية الوصول."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {kind === "signin" ? (
          <a href="/login" className={cn(btn)}>
            تسجيل الدخول
          </a>
        ) : null}
        <a href={WORKSPACE_ROUTE} className={cn(ghost, "h-10")}>
          العودة إلى مساحة العمل
        </a>
      </div>
    </section>
  );
}

/* ── the workspace ────────────────────────────────────────────────────────── */

function ServiceWorkspace({ brand }: { brand: BrandIdentityState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [progress, setProgress] = useState({ stage: "", percent: 0, detail: "" });
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedDoc | null>(null);
  const [working, setWorking] = useState<Project | null>(null);
  const [repair, setRepair] = useState<RepairState | null>(null);
  const [compare, setCompare] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState<"repair" | "open" | "save" | "template" | "reprocess" | null>(null);
  const [fonts, setFonts] = useState<AttachedFonts>({});
  const [title, setTitle] = useState("");
  const [titleIsManual, setTitleIsManual] = useState(false);
  const [showFixes, setShowFixes] = useState(false);
  const [trustOrigin, setTrustOrigin] = useState(true);

  const take = (next: File | null) => {
    setError(null);
    setFile(null);
    setSourceBytes(null);
    setTitle("");
    setTitleIsManual(false);
    if (!next) return;
    const name = next.name.toLowerCase();
    // Exactly the formats the canonical service converts (`import/run.ts`);
    // the bytes are still classified before any converter runs.
    if (!/\.(psd|psb|docx|pptx|xlsx|pdf|png|jpe?g|svg)$/i.test(name)) {
      setError("صيغة غير مدعومة. المقبول: PSD وDOCX وPPTX وXLSX وPDF وPNG وJPG وSVG.");
      return;
    }
    setFile(next);
    void convert(next);
  };

  const convert = useCallback(async (input: File) => {
    setPhase("working");
    setImported(null);
    setWorking(null);
    setRepair(null);
    setCompare(false);
    setPageIndex(0);
    setFonts({});
    setError(null);
    setProgress({ stage: "قراءة الملف", percent: 2, detail: input.name });
    try {
      const bytes = new Uint8Array(await input.arrayBuffer());
      const classified = classifyImport(input.name, bytes);
      if (!classified.format) throw new Error(classified.error || "صيغة غير مدعومة.");
      setProgress({ stage: "التحقق من الصلاحية", percent: 4, detail: "" });
      const gate = await authorizeTemplateImportFn({
        data: {
          fileName: input.name,
          byteLength: bytes.byteLength,
          magicHex: magicHexOf(bytes),
          format: classified.format,
        },
      });
      if (!gate.ok) throw new Error(gate.error);
      setSourceBytes(bytes);
      // One canonical service for every format — PSD/PSB included.
      const [{ listAssets }, { importTemplateBytes }] = await Promise.all([
        import("@/lib/editor/storage"),
        import("@/lib/editor/import/run"),
      ]);
      const assets = await listAssets();
      const result = await importTemplateBytes(bytes, gate.fileName, {
        assets,
        onProgress: (stage, percent, detail) => setProgress({ stage, percent, detail: detail || "" }),
      });
      setImported({ kind: "converted", result });
      setWorking(result.project);
      setTitle(generateTemplateName({
        title: result.project.name,
        titleIsManual: false,
        sourceName: gate.fileName,
        format: result.format,
        category: result.format === "pptx" ? "slides" : result.psd ? "psd" : "import",
        kind: "json",
        content: result.project,
      }));
      setTitleIsManual(false);
      setTrustOrigin(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحويل الملف");
      setFile(null);
      setSourceBytes(null);
    } finally {
      setPhase("idle");
    }
  }, []);

  const loadSaved = async (id: string) => {
    setError(null);
    setFile(null);
    setSourceBytes(null);
    try {
      const project = await getProject(id);
      if (!project) throw new Error("لم يُعثر على المستند");
      setImported({ kind: "saved", project, id });
      setWorking(project);
      setTitle(project.name);
      setTitleIsManual(true);
      setRepair(null);
      setCompare(false);
      setPageIndex(0);
      setFonts({});
      setTrustOrigin(false); // the author may have edited it since the import
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر فتح المستند");
    }
  };

  const repairOptions = useMemo(() => {
    const pageSizes =
      imported?.kind === "converted" ? imported.result.psd?.report.pageSizesMm : undefined;
    return { pageSizes, trustOrigin };
  }, [imported, trustOrigin]);

  const runRepair = async () => {
    if (!working || !imported) return;
    setBusy("repair");
    try {
      const base = imported.kind === "saved" ? working : imported.result.project;
      const result = await repairProject(base, repairOptions);
      setRepair({ fixes: result.fixes, counts: result.counts, base });
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

  const reprocess = async () => {
    if (imported?.kind === "saved") {
      await runRepair();
      return;
    }
    if (!file || !sourceBytes) {
      toast.error("الملف الأصلي لم يبقَ في هذه الجلسة — ارفعه من جديد");
      return;
    }
    await convert(file);
  };

  const commitProject = async (): Promise<Project> => {
    if (!imported || !working) throw new Error("لا توجد نتيجة تحويل");
    if (imported.kind === "saved") {
      return {
        ...working,
        name: resolveTemplateName({ title, titleIsManual, kind: "json", content: working }),
      };
    }
    const converted = imported.result;
    const psd = converted.psd ? { project: working, assets: converted.psd.report.assets } : null;
    const officeThumb = converted.psd ? null : converted.previewDataUrl;
    const composite = converted.psd?.compositeDataUrl ?? null;
    const format = converted.format;
    const final = await buildFinalProject({
      title,
      titleIsManual,
      sourceName: file?.name,
      format,
      project: working,
      psd,
      fonts,
      // The identity the account licensed, if any: a converted file arrives in
      // the organisation's colours. The «saved» repair path above is untouched —
      // an existing document is repaired, never repainted.
      brand: brand.kit,
    });
    const thumb =
      (composite && composite.length < 1_800_000 ? composite : null) ||
      officeThumb ||
      final.thumbnail ||
      null;
    return { ...final, thumbnail: thumb ?? final.thumbnail };
  };

  const openInEditor = async () => {
    setBusy("open");
    try {
      const project = await commitProject();
      const saved = await saveImportedDocument(project, imported?.kind === "converted" ? imported.result.format : "saved");
      if (!saved.ok || !saved.id) throw new Error(saved.error);
      await openSavedInEditor(saved.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر فتح المستند");
      setBusy(null);
    }
  };

  const saveDocument = async () => {
    setBusy("save");
    try {
      const project = await commitProject();
      if (imported?.kind === "saved") {
        const outcome = await updateImportedDocument(project);
        if (!outcome.ok) throw new Error(outcome.error);
        toast.success("حُدّث المستند بالإصلاحات");
      } else {
        const outcome = await saveImportedDocument(project, imported?.kind === "converted" ? imported.result.format : "import");
        if (!outcome.ok) throw new Error(outcome.error);
        toast.success("حُفظ المستند في المشاريع، ويمكن فتحه من المحرر لاحقًا");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ المستند");
    } finally {
      setBusy(null);
    }
  };

  const saveAsTemplate = async () => {
    setBusy("template");
    try {
      const project = await commitProject();
      const stats = inspectProject(project).fonts;
      const format = imported?.kind === "converted" ? imported.result.format : "import";
      const description = `محوّل عبر استوديو الاستيراد إلى عناصر ${BRAND.platform} قابلة للتحرير. ${stats.length} خط.`;
      const thumb = project.thumbnail || null;
      const outcome = await saveImportedTemplate(project, format, description, thumb, file?.name || "", titleIsManual);
      if (!outcome.ok) throw new Error(outcome.error);
      toast.success("حُفظ كقالب مسودة. يمكن تعديله لاحقًا من إدارة القوالب");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر حفظ القالب");
    } finally {
      setBusy(null);
    }
  };

  const inspection = useMemo(
    () => (working ? inspectProject(working, repairOptions) : null),
    [working, repairOptions],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => take(event.target.files?.[0] || null)}
      />

      {!working && phase !== "working" && (
        <section className="mt-6 grid gap-6">
          <div
            role="button"
            tabIndex={0}
            aria-label="رفع ملف قالب"
            className="grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-brand/50 bg-surface px-4 py-14 text-center transition hover:border-brand hover:bg-surface-2"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              take(event.dataTransfer.files?.[0] || null);
            }}
          >
            <FileUp className="mb-3 size-8 text-brand" aria-hidden />
            <p className="text-[16px] font-black text-ink">أسقط ملف القالب هنا أو انقر للاختيار</p>
            <p className="mt-2 text-[12px] font-bold text-muted">
              PSD · PSB · DOCX · PPTX · PDF · PNG · JPG · SVG — {MAX_HINT}
            </p>
            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] font-bold text-ink">
                {error}
              </p>
            )}
          </div>
          <RecentImports onOpen={loadSaved} />
        </section>
      )}

      {phase === "working" && (
        <section className="mt-6 grid place-items-center rounded-2xl border border-line bg-surface px-6 py-16">
          <Loader2 className="size-8 animate-spin text-brand" aria-hidden />
          <p className="mt-4 text-[14px] font-extrabold text-ink">{progress.stage || "جارٍ التحويل"}</p>
          <div className="mt-4 h-2 w-full max-w-md overflow-hidden rounded-full bg-paper">
            <div className="h-full bg-navy transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-2 text-[11px] font-semibold text-muted">{progress.percent}%{progress.detail ? ` · ${progress.detail}` : ""}</p>
        </section>
      )}

      {working && imported && inspection && phase === "idle" && (
        <section className="mt-6 grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="rounded-full bg-navy px-2.5 py-1 text-[10px] font-black tracking-wide text-on-brand">
                {imported.kind === "converted" ? imported.result.format.toUpperCase() : "مستند محفوظ"}
              </span>
              <p className="truncate text-[13px] font-extrabold text-ink">{working.name}</p>
              {imported.kind === "converted" && imported.result.psd && (
                <span className="text-[11px] font-bold text-muted">
                  اكتمال التحويل {imported.result.psd.report.completion}%
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
                        pageIndex === index ? "border-brand bg-navy text-on-brand" : "border-line bg-surface text-muted",
                      )}
                    >
                      {index + 1}
                    </button>
                  ))}
                </nav>
              )}
              <button type="button" className={ghost} onClick={() => void reprocess()} disabled={busy === "reprocess"}>
                <RotateCcw className="size-3.5" aria-hidden />
                {imported.kind === "saved" ? "إعادة الفحص" : "إعادة المعالجة"}
              </button>
              <button
                type="button"
                className={ghost}
                onClick={() => {
                  setImported(null);
                  setWorking(null);
                  setRepair(null);
                  setFile(null);
                  setSourceBytes(null);
                  setError(null);
                }}
              >
                ملف جديد
              </button>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* preview */}
            <div className="grid content-start gap-4">
              <div className="relative rounded-2xl border border-line bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-ink">
                    <ScanSearch className="size-4 text-brand" aria-hidden />
                    معاينة {compare && repair ? "المقارنة" : "المستند"}
                  </p>
                  {repair && (
                    <button
                      type="button"
                      className={ghost}
                      onClick={() => setCompare((value) => !value)}
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
              <Diagnostics converted={imported.kind === "converted" ? imported.result : null} />
            </div>

            {/* side rail: inspector + repair + actions */}
            <aside className="grid content-start gap-4">
              <section className="rounded-2xl border border-line bg-surface p-4">
                <h2 className="mb-3 flex items-center gap-1.5 text-[13px] font-black text-ink">
                  <ClipboardCheck className="size-4 text-brand" aria-hidden />
                  الفاحص الذكي
                </h2>
                <ImportInspector inspection={inspection} />
              </section>

              <RepairCard
                repair={repair}
                busy={busy === "repair"}
                problemsCount={inspection.problems.length}
                isSavedDoc={imported.kind === "saved"}
                trustOrigin={trustOrigin}
                onTrustOriginChange={setTrustOrigin}
                onRepair={() => void runRepair()}
                onUndo={undoRepair}
                showFixes={showFixes}
                onToggleFixes={() => setShowFixes((value) => !value)}
              />

              <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
                <h2 className="flex items-center gap-1.5 text-[13px] font-black text-ink">
                  <Sparkles className="size-4 text-brand" aria-hidden />
                  الخطوة التالية
                </h2>
                <input
                  className="h-10 rounded-lg border border-line bg-paper px-3 text-[13px] font-bold text-ink"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setTitleIsManual(true);
                  }}
                  aria-label="اسم المشروع أو القالب"
                  placeholder="اسم المستند"
                />
                <div className="grid gap-2">
                  <button type="button" className={btn} disabled={!!busy} onClick={() => void openInEditor()}>
                    {busy === "open" ? <Loader2 className="size-4 animate-spin" /> : <SquareArrowOutUpRight className="size-4" aria-hidden />}
                    فتح في المحرر
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className={ghost} disabled={!!busy} onClick={() => void saveDocument()}>
                      {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" aria-hidden />}
                      {imported.kind === "saved" ? "تحديث المستند" : "حفظ كمستند"}
                    </button>
                    <button type="button" className={ghost} disabled={!!busy} onClick={() => void saveAsTemplate()}>
                      {busy === "template" ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" aria-hidden />}
                      حفظ كقالب
                    </button>
                  </div>
                </div>
                <FontsCard psd={imported.kind === "converted" ? imported.result.psd ?? null : null} fonts={fonts} setFonts={setFonts} />
              </section>
            </aside>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] font-bold text-ink">
              {error}
            </p>
          )}
        </section>
      )}
    </>
  );
}

/* ── fonts ────────────────────────────────────────────────────────────────── */

function FontsCard({
  psd,
  fonts,
  setFonts,
}: {
  psd: PsdImportResult | null;
  fonts: AttachedFonts;
  setFonts: (next: AttachedFonts) => void;
}) {
  if (!psd) return null;
  const missing = psd.report.fonts.filter((font) => font.status === "missing");
  if (!missing.length) return null;
  return (
    <div className="mt-1 grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
      <p className="text-[11px] font-extrabold text-warning">
        خطوط غير موجودة في مكتبة نَسَق ({missing.length}) — ارفعها لتحافظ على الشكل الأصلي، أو استبدلها لاحقًا في المحرر.
      </p>
      <ul className="grid gap-1.5">
        {missing.map((font) => (
          <li key={font.fontName} className="flex items-center justify-between gap-2 text-[11px] font-bold text-ink">
            <span className="truncate">{font.family}</span>
            <label className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-[10px] font-extrabold text-muted">
              {fonts[font.family] ? "تم الإرفاق ✓" : "إرفاق الخط"}
              <input
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                className="sr-only"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  if (!picked) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const dataUrl = String(reader.result || "");
                    if (dataUrl.startsWith("data:")) {
                      setFonts({ ...fonts, [font.family]: dataUrl });
                    }
                  };
                  reader.readAsDataURL(picked);
                }}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── diagnostics ──────────────────────────────────────────────────────────── */

function Diagnostics({ converted }: { converted: TemplateImport | null }) {
  if (!converted) return null;
  const psd = converted.psd ?? null;
  const rows = psd
    ? [
        ["الأبعاد الأصلية", `${psd.report.widthPx}×${psd.report.heightPx} بكسل`],
        ["الدقة", `${Math.round(psd.report.dpi)} dpi`],
        ["الطبقات", String(psd.report.layerCount)],
        ["نصوص", String(psd.report.textCount)],
        ["صور", String(psd.report.imageCount)],
        ["أشكال", String(psd.report.shapeCount)],
      ]
    : [
        ["الصفحات", String(converted.stats.pages)],
        ["نصوص", String(converted.stats.texts)],
        ["جداول", String(converted.stats.tables)],
        ["صور", String(converted.stats.images)],
        ["أشكال", String(converted.stats.shapes)],
      ];
  const notes: { name: string; reason: string }[] = psd
    ? psd.report.fallbacks.map((item) => ({ name: item.layerName, reason: item.reason }))
    : converted.notes
        .filter((note) => note.mode !== "editable")
        .map((note) => ({ name: note.name, reason: note.reason }));
  const issues = psd ? psd.validation.issues.filter((issue) => issue.severity === "error") : [];
  return (
    <details className="rounded-2xl border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer text-[12px] font-extrabold text-muted">
        تفاصيل التحويل {notes.length > 0 ? `· ${notes.length} ملاحظة` : ""}
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-center">
            <dt className="text-[10px] font-bold text-muted">{label}</dt>
            <dd className="text-[13px] font-black tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {issues.length > 0 && (
        <ul className="mt-3 grid gap-1">
          {issues.slice(0, 8).map((issue, index) => (
            <li key={index} className="text-[11px] font-bold text-danger">
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 grid max-h-40 gap-1 overflow-auto">
          {notes.slice(0, 30).map((note, index) => (
            <li key={index} className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold leading-5 text-muted">
              <span className="font-extrabold text-ink">{note.name}</span>
              {" — "}
              {note.reason}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/* ── recent imports ───────────────────────────────────────────────────────── */

function RecentImports({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<(ImportHistoryEntry & { meta?: ProjectMeta })[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { getSetting } = await import("@/lib/editor/storage");
      const history = (await getSetting<ImportHistoryEntry[]>(IMPORT_HISTORY_KEY)) || [];
      if (!history.length) {
        setRows([]);
        return;
      }
      const projects = await listProjects();
      const byId = new Map(projects.map((project) => [project.id, project]));
      setRows(
        history
          .map((row) => ({ ...row, meta: byId.get(row.id) }))
          .filter((row) => row.meta)
          .slice(0, 12),
      );
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rows.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[13px] font-black text-ink">
          <FolderOpen className="size-4 text-brand" aria-hidden />
          مستوردات سابقة
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" className={ghost} onClick={() => setOpen((value) => !value)}>
            {open ? "إخفاء" : `عرض (${rows.length})`}
          </button>
          <button
            type="button"
            className={ghost}
            aria-label="مسح قائمة المستوردات السابقة"
            title="مسح القائمة — المستندات نفسها لن تُحذف"
            onClick={async () => {
              const { setSetting } = await import("@/lib/editor/storage");
              await setSetting(IMPORT_HISTORY_KEY, []);
              setRows([]);
              toast.success("أُخفيت القائمة — المستندات نفسها لم تُحذف من المشاريع");
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {open && (
        <ul className="mt-3 grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="h-12 w-9 shrink-0 overflow-hidden rounded-[4px] border border-line bg-surface-2">
                  {row.meta?.thumbnail ? (
                    <img src={row.meta.thumbnail} alt="" className="h-full w-full object-contain" loading="lazy" />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-extrabold text-ink">{row.meta?.name || row.name}</p>
                  <p className="text-[10px] font-bold text-muted">
                    {row.format.toUpperCase()} · {row.meta?.pages ?? "?"} صفحات
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className={ghost} onClick={() => onOpen(row.id)}>
                  فحص وإصلاح
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
