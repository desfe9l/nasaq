import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import {
  FileDown,
  FileText,
  Image as ImageIcon,
  Presentation,
  FileCode2,
  FileJson,
  FileArchive,
  Eye,
  X,
  TriangleAlert,
  Loader2,
  ShieldCheck,
  Lock,
  LogIn,
} from "lucide-react";
import { capturePages, runExport, safeFileName, type CapturedPage, type ExportFormat } from "@/lib/editor/export";
import { pageSize } from "@/lib/editor/model";
import {
  runPreflight,
  preflightSummary,
  SEVERITY_LABEL,
  type PreflightIssue,
} from "@/lib/editor/preflight";
import { GUTTER_MARGIN_MM, type PrintGuideSettings } from "@/lib/editor/print-guides";
import { domImageSize } from "@/lib/editor/images";
import { useEditor } from "@/lib/editor/store";
import { downloadCurrentNsq } from "@/lib/nsq/editor-io";
import { cn } from "@/lib/utils";
import {
  canUseDemoExport,
  effectiveExportScale,
  scaleForDpi,
  DEMO_EXPORT_DPI,
  PRINT_EXPORT_DPI,
} from "@/lib/product/product";
import { FullVersionModal } from "@/components/site/FullVersionModal";
const SignInRequiredModalLazy = lazy(() =>
  import("@/components/site/SignInRequiredModal").then((m) => ({
    default: m.SignInRequiredModal,
  })),
);
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const FORMATS: { id: ExportFormat; title: string; desc: string; icon: typeof FileDown }[] = [
  { id: "pdf", title: "PDF", desc: "طباعة وأرشفة رسمية · 300 DPI", icon: FileDown },
  { id: "png", title: "PNG", desc: "دقة عالية بلا فقدان", icon: ImageIcon },
  { id: "jpg", title: "JPG", desc: "حجم أصغر للصور", icon: ImageIcon },
  { id: "pptx", title: "PowerPoint", desc: "طبقات مطابقة أو عناصر قابلة للتحرير", icon: Presentation },
  { id: "docx", title: "Word", desc: "طبقات مطابقة أو نصوص قابلة للتحرير", icon: FileText },
  { id: "svg", title: "SVG للويب", desc: "خطوط وصور مضمنة · محرك المتصفح", icon: FileCode2 },
  { id: "html", title: "HTML مستقل", desc: "ملف واحد قابل للطباعة", icon: FileCode2 },
  { id: "nsq", title: "ملف نَسَق (.nsq)", desc: "مشروع قابل للتحرير على أي جهاز", icon: FileArchive },
  { id: "json", title: "JSON احتياطي", desc: "نسخة احتياطية بالصيغة القديمة", icon: FileJson },
];

const FIX_LABEL: Record<NonNullable<PreflightIssue["fix"]>, string> = {
 "fit-text": "ملاءمة الإطار",
 "move-inward": "إبعادها عن الهامش",
 "delete-page": "حذف الصفحة",
 "delete-element": "حذف العناصر",
};

const GUIDE_LABELS: {
  key: keyof PrintGuideSettings;
  label: string;
}[] = [
  { key: "safe", label: "إظهار المنطقة الآمنة" },
  { key: "gutter", label: "هامش التجليد" },
  { key: "bleed", label: "القصّ والقص الزائد" },
];

const RASTER_FORMATS = new Set<ExportFormat>(["pdf", "png", "jpg"]);
const OFFICE_FORMATS = new Set<ExportFormat>(["pptx", "docx"]);

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  const toggle = useEditor((s) => s.toggle);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const name = useEditor((s) => s.name);
  const orgName = useEditor((s) => s.orgName);
  const theme = useEditor((s) => s.theme);
  const version = useEditor((s) => s.version);
  const printGuides = useEditor((s) => s.printGuides);
  const togglePrintGuide = useEditor((s) => s.togglePrintGuide);
  const fitTextBox = useEditor((s) => s.fitTextBox);
  const updateElement = useEditor((s) => s.updateElement);
  const deletePage = useEditor((s) => s.deletePage);
  const deleteElementsById = useEditor((s) => s.deleteElementsById);
  const entitlements = useEditor((s) => s.entitlements);

  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState<number>(2);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "current">("all");
  const [editableOffice, setEditableOffice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewPages, setPreviewPages] = useState<CapturedPage[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const selected =
    scope === "all" ? pages : pages.filter((p) => p.id === activePageId);

  const report = useMemo(
    () =>
      runPreflight(selected, {
        guides: printGuides,
        imageSize: (src) => domImageSize(src),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, scope, activePageId, printGuides],
  );
  const [riskAccepted, setRiskAccepted] = useState(false);
  const { user, isPending } = useCurrentUserState();
  const [signInOpen, setSignInOpen] = useState(false);
  const guestNeedsSignIn = authEnabled && !isPending && !user;

  // Never show a cached preview after page edits, range or render-mode changes.
  useEffect(() => { setPreviewPages([]); }, [pages, scope, activePageId, format, quality, editableOffice, open]);

  if (!open) return null;

  const needsRaster = RASTER_FORMATS.has(format) || (OFFICE_FORMATS.has(format) && !editableOffice);
  const licensed = entitlements.advanced_export === true;
  const formatAllowed = canUseDemoExport(format, licensed);
  const captureScale = effectiveExportScale(quality, licensed);

  const applyFix = (issue: PreflightIssue) => {
    if (!issue.fix) return;
    if (issue.fix === "fit-text") {
      issue.elementIds.forEach((id) => fitTextBox(id));
    } else if (issue.fix === "move-inward") {
      for (const id of issue.elementIds) {
        const el = selected
          .flatMap((p) => p.elements)
          .find((candidate) => candidate.id === id);
        if (!el) continue;
        const page = selected.find((p) => p.elements.some((c) => c.id === id));
        if (!page) continue;
        const size = pageSize(page);
        const wanted = size.w - (GUTTER_MARGIN_MM + 2);
        updateElement(id, { x: Math.min(el.x, wanted - el.w) });
      }
    } else if (issue.fix === "delete-page") {
      deletePage(issue.pageId);
    } else if (issue.fix === "delete-element") {
      deleteElementsById(issue.elementIds);
    }
    setRiskAccepted(false);
  };

  const run = async () => {
    if (guestNeedsSignIn) {
      setSignInOpen(true);
      return;
    }
    if (!formatAllowed) {
      setUpgradeOpen(true);
      return;
    }
    if (format === "nsq") {
      // The native project file packages the WHOLE editable project (every
      // page, asset and font) — print preflight and page range don't apply.
      setBusy(true);
      setError(null);
      setProgress("تجهيز ملف نَسَق…");
      try {
        if (await downloadCurrentNsq()) toggle("exportOpen");
      } finally {
        setBusy(false);
        setProgress("");
      }
      return;
    }
    if (report.counts.error > 0 && !riskAccepted) {
      setRiskAccepted(true);
      setError(
        `${report.counts.error} خطأ يمنع الطباعة الصحيحة — أصلحه من القائمة أعلاه، أو اضغط «تنزيل الملف» مرة أخرى للتصدير على أي حال.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let captured: CapturedPage[] | null = null;
      if (needsRaster) {
        setProgress("تهيئة الصفحات…");
        const targets = selected.flatMap((p) => {
          const node = document.querySelector(`[data-export-page="${p.id}"]`) as HTMLElement | null;
          if (!node) return [];
          const size = pageSize(p);
          return [{ node, w: size.w, h: size.h }];
        });
        if (targets.length !== selected.length) {
          throw new Error("تعذر العثور على صفحات التصدير — أعد تحميل المحرر ثم حاول مرة أخرى");
        }
        captured = await capturePages(targets, captureScale, (i, n) => {
          setProgress(`التقاط الصفحة ${i + 1} من ${n}…`);
        });
      }
      setProgress("حفظ الملف…");
      await runExport(
        format,
        captured,
        { version, name, theme, orgName, pages, defaultSize: undefined },
        selected,
        editableOffice,
        captureScale,
      );
      toggle("exportOpen");
    } catch (err) {
      const message = err instanceof Error ? err.message : "فشل التصدير";
      setError(message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const preview = async () => {
    setPreviewBusy(true);
    setError(null);
    try {
      const targets = selected.flatMap((p) => {
        const node = document.querySelector(`[data-export-page="${p.id}"]`) as HTMLElement | null;
        if (!node) return [];
        const size = pageSize(p);
        return [{ node, w: size.w, h: size.h }];
      });
      if (targets.length !== selected.length) throw new Error("تعذر تجهيز معاينة التصدير");
      setPreviewPages(await capturePages(targets, captureScale, undefined, 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تجهيز المعاينة");
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-dialog)] grid place-items-center bg-navy/50 p-2 sm:p-4"
      onClick={() => !busy && toggle("exportOpen")}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[14px] border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-label="تصدير المستند"
      >
        {/* Header - fixed */}
        <div className="flex shrink-0 items-start justify-between border-b border-line/70 px-5 py-4">
          <div>
            <h2 className="text-[18px] font-extrabold text-brand">تصدير المستند</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              {selected.length} صفحة · {safeFileName(name)}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || previewBusy}
            className="grid size-9 place-items-center rounded-[8px] border border-line disabled:opacity-40"
            onClick={() => toggle("exportOpen")}
            aria-label="إغلاق"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 editor-pane-scroll">
          {guestNeedsSignIn && (
            <p className="mb-4 flex items-start gap-2 rounded-[10px] border border-navy/20 bg-navy/5 p-3 text-[12px] leading-6">
              <LogIn className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                أنت تتصفح <strong className="font-extrabold">كزائر</strong> — التعديل والمعاينة
                متاحان الآن، ويُطلب تسجيل الدخول عند تنزيل الملف.
              </span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FORMATS.map((f) => {
              const Icon = f.icon;
              const locked = !canUseDemoExport(f.id, licensed);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    if (locked) {
                      setUpgradeOpen(true);
                      return;
                    }
                    setFormat(f.id);
                  }}
                  aria-pressed={format === f.id}
                  aria-disabled={locked || undefined}
                  title={locked ? "متاح في النسخة الكاملة — اضغط لطلب الترخيص" : undefined}
                  className={cn(
 "relative flex min-h-[88px] flex-col rounded-[10px] border p-3 text-right transition",
                    locked
                      ? "border-dashed border-line bg-line-2/40 opacity-80 hover:border-brand hover:opacity-100"
                      : format === f.id
                        ? "border-navy bg-navy text-white"
                        : "border-line hover:border-navy-2",
                  )}
                >
                  <Icon
                    className={cn(
 "mb-2 size-5",
                      format === f.id ? "text-gold-2" : "text-brand-hover",
                    )}
                  />
                  <strong className="block text-[13px]">{f.title}</strong>
                  <span className={cn("mt-0.5 text-[11px] leading-4", format === f.id ? "text-white/70" : "text-muted")}>
                    {f.desc}
                  </span>
                  {locked && (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-brand bg-ok/10 px-1.5 py-0.5 text-[10px] font-extrabold text-success">
                      🔒 النسخة الكاملة
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {OFFICE_FORMATS.has(format) && (
            <div className="mt-4 grid gap-2 rounded-[10px] border border-line p-3">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={editableOffice}
                  onChange={(e) => setEditableOffice(e.target.checked)}
                  className="mt-0.5 size-4 accent-navy"
                />
                <span>
                  <strong className="block text-[12px] text-brand">
                    عناصر قابلة للتعديل
                  </strong>
                  <span className="text-[11px] leading-4 text-muted">
                    النصوص والجداول والأشكال تُصدَّر كعناصر حقيقية يمكن تعديلها داخل البرنامج.
                    قد تختلف الخطوط وتوزيع النص داخل Office. ألغِ التحديد للمطابقة البصرية: طبقات PNG شفافة مستقلة، والنصوص غير قابلة لتحرير الحروف.
                  </span>
                </span>
              </label>
            </div>
          )}

          {needsRaster && (
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-[11px] font-extrabold text-muted">
                الجودة
                {licensed ? (
                  <select
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] font-semibold"
                  >
                    <option value={2}>قياسية — 192 DPI (أسرع)</option>
                    <option value={scaleForDpi(PRINT_EXPORT_DPI)}>طباعة احترافية — 300 DPI</option>
                    <option value={4}>طباعة فائقة — 384 DPI (أبطأ)</option>
                  </select>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-line bg-line-2/40 px-2.5 py-2 text-[12px] font-semibold">
                    <span className="text-ink">قياسية — {DEMO_EXPORT_DPI} DPI (النسخة التجريبية)</span>
                    <button
                      type="button"
                      onClick={() => setUpgradeOpen(true)}
                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-success hover:underline"
                    >
                      <Lock className="size-3" />
                      300 DPI للطباعة — النسخة الكاملة
                    </button>
                  </div>
                )}
              </label>
            </div>
          )}

          {format !== "nsq" && (
            <label className="mt-3 grid gap-1 text-[11px] font-extrabold text-muted">
              النطاق
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "all" | "current")}
                className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] font-semibold"
              >
                <option value="all">كل الصفحات ({pages.length})</option>
                <option value="current">الصفحة الحالية فقط</option>
              </select>
            </label>
          )}

          {format === "nsq" && (
            <p className="mt-3 rounded-[8px] border border-line bg-line-2/60 p-3 text-[11px] leading-5 text-muted">
              ملف نَسَق يضم المشروع كاملًا — كل الصفحات والنصوص والصور والرسوم والخطوط المرفوعة والطبقات والمجموعات —
              في ملف واحد مضغوط يُفتح قابلًا للتعديل على أي جهاز، بما في ذلك معاينة للصفحة الأولى.
            </p>
          )}

          {format === "json" && (
            <p className="mt-3 rounded-[8px] border border-line bg-line-2/60 p-3 text-[11px] leading-5 text-muted">
              ملف المشروع يحفظ الصفحات والعناصر والصور، ويمكن استيراده على أي جهاز من صفحة المشاريع.
            </p>
          )}

          {(format === "png" || format === "jpg") && selected.length > 1 && (
            <p className="mt-3 rounded-[8px] border border-line bg-line-2/60 p-3 text-[11px] leading-5 text-muted">
              عند اختيار أكثر من صفحة يتم تنزيل ملف ZIP يحتوي صورة مستقلة لكل صفحة.
            </p>
          )}

          <div className="mt-4 rounded-[10px] border border-line p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <strong className="inline-flex items-center gap-1.5 text-[12px] text-brand">
                <ShieldCheck className="size-4 text-brand-hover" />
                فحص ما قبل التصدير
              </strong>
              <span
                className={cn(
 "rounded-full px-2 py-0.5 text-[11px] font-extrabold",
                  report.counts.error
                    ? "bg-danger/10 text-error"
                    : report.counts.warning
                      ? "bg-gold/15 text-warning"
                      : "bg-ok/10 text-success",
                )}
              >
                {preflightSummary(report)}
              </span>
            </div>

            {report.clean ? (
              <p className="text-[11px] leading-5 text-muted">
                لا ملاحظات على الصفحات المحددة ({selected.length}) — الترويسة
                والهوامش ودقة الصور والنصوص كلها داخل الحدود الآمنة.
              </p>
            ) : (
              <ul className="grid max-h-[28vh] gap-1.5 overflow-y-auto pe-1 editor-pane-scroll">
                {report.issues.map((issue, index) => (
                  <li
                    key={`${issue.kind}-${issue.pageId}-${index}`}
                    className={cn(
 "rounded-[8px] border p-2",
                      issue.severity === "error"
                        ? "border-danger/30 bg-danger/10"
                        : issue.severity === "warning"
                          ? "border-gold/40 bg-gold/15"
                          : "border-line",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-extrabold leading-5">
                        {issue.title}
                        <span className="ms-1 text-[10px] font-semibold text-muted">
                          · {issue.pageName} · {SEVERITY_LABEL[issue.severity]}
                        </span>
                      </span>
                      {issue.fix && (
                        <button
                          type="button"
                          onClick={() => applyFix(issue)}
                          className="shrink-0 rounded-[6px] border border-line px-2 py-1 text-[10px] font-extrabold hover:border-navy-2"
                        >
                          {FIX_LABEL[issue.fix]}
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-muted">{issue.detail}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 flex flex-wrap gap-3 border-t border-line pt-2">
              {GUIDE_LABELS.map((guide) => (
                <label
                  key={guide.key}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] font-extrabold text-muted"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(printGuides?.[guide.key])}
                    onChange={() => togglePrintGuide(guide.key)}
                    className="size-3.5 accent-navy"
                  />
                  {guide.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer - always visible */}
        <div className="shrink-0 border-t border-line/70 bg-surface px-5 py-3">
          {busy && (
            <p className="mb-2 inline-flex w-full items-center justify-center gap-2 text-center text-[12px] font-bold text-brand-hover">
              <Loader2 className="size-4 animate-spin" />
              {progress || "جاري التصدير…"}
            </p>
          )}

          {error && (
            <p className="mb-2 inline-flex w-full items-start justify-center gap-2 rounded-[8px] border border-danger/30 bg-danger/10 p-3 text-[12px] font-bold leading-5 text-error">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || previewBusy || !formatAllowed}
              onClick={() => void preview()}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[10px] border border-line px-4 text-[13px] font-bold disabled:opacity-40"
            >
              <Eye className="size-4" />
              {previewBusy ? "جاري المعاينة…" : "معاينة"}
            </button>
            <button
              type="button"
              disabled={busy || previewBusy}
              onClick={() => void run()}
              className="h-11 flex-1 rounded-[10px] bg-navy text-[14px] font-extrabold text-white disabled:opacity-50"
            >
              {busy ? "جاري التصدير…" : "تنزيل الملف"}
            </button>
            <button
              type="button"
              disabled={busy || previewBusy}
              onClick={() => toggle("exportOpen")}
              className="h-11 rounded-[10px] border border-line px-4 text-[13px] font-bold disabled:opacity-40"
            >
              إلغاء
            </button>
          </div>
        </div>

        <FullVersionModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

        {signInOpen && (
          <Suspense fallback={null}>
            <SignInRequiredModalLazy
              open={signInOpen}
              onClose={() => setSignInOpen(false)}
              intent="تنزيل الملف"
              callbackURL="/editor"
            />
          </Suspense>
        )}

        {previewPages.length > 0 && (
          <div className="fixed inset-0 z-[calc(var(--z-dialog)+1)] grid place-items-center bg-scrim p-4" role="dialog" aria-modal="true" aria-label="معاينة التصدير">
            <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-[12px] border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div><h3 className="text-[15px] font-extrabold">معاينة التصدير</h3><p className="text-[11px] text-muted">{previewPages.length} صفحة · {OFFICE_FORMATS.has(format) && editableOffice ? "معاينة التصميم؛ قد يختلف توزيع النص في وضع التحرير داخل Office" : "محرك الرسم نفسه · 96 DPI للأبعاد"}</p></div>
                <button type="button" onClick={() => setPreviewPages([])} className="grid size-8 place-items-center rounded-[7px] border border-line" title="إغلاق المعاينة" aria-label="إغلاق المعاينة"><X className="size-4" /></button>
              </div>
              <div className="editor-pane-scroll min-h-0 flex-1 overflow-auto rounded-[8px] bg-[#252627] p-4">
                <div className="grid gap-5 justify-items-center">
                  {previewPages.map((page, index) => <figure key={index} className="grid gap-1 justify-items-center"><img src={page.canvas.toDataURL("image/png")} alt={`معاينة الصفحة ${index + 1}`} className="max-h-[68vh] max-w-full object-contain shadow-2xl" /><figcaption className="text-[10px] text-white/65">صفحة {index + 1}</figcaption></figure>)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
