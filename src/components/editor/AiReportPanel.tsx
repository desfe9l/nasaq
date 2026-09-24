import { useState, useMemo } from "react";
import { FileText, Loader2, Plus, RefreshCw, Sparkles, AlertCircle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { generateReportDraftFn } from "@/lib/ai/functions";
import {
  type AiLanguage,
  type AiTone,
  type ReportDetail,
  type ReportDraft,
  type ReportType,
} from "@/lib/ai/contract";
import { useEditor } from "@/lib/editor/store";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

/** User-triggered AI intake. It never edits the page until the author inserts it. */
export function AiReportPanel() {
  const insertReportDraft = useEditor((s) => s.insertReportDraft);
  const entitlements = useEditor((s) => s.entitlements);
  const user = useCurrentUser();
  const isOwner = user?.id === "dev-user" || user?.isDevFallback; // simplified check, real owner check is server-side
  const hasAiEntitlement = entitlements.ai_report;

  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("الإدارة العليا");
  const [tone, setTone] = useState<AiTone>("official");
  const [language, setLanguage] = useState<AiLanguage>("ar");
  const [maxSections, setMaxSections] = useState(4);
  const [reportType, setReportType] = useState<ReportType>("executive");
  const [detailLevel, setDetailLevel] = useState<ReportDetail>("standard");
  const [pageTarget, setPageTarget] = useState(1);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [draftElementId, setDraftElementId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerError, setProviderError] = useState<"not_configured" | null>(null);

  const generate = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setProviderError(null);
    try {
      const result = await generateReportDraftFn({
        data: {
          brief,
          audience,
          tone,
          language,
          maxSections,
          reportType,
          detailLevel,
          pageTarget,
        },
      });
      if (!result.ok) {
        if (result.code === "not_configured") {
          setProviderError("not_configured");
          // Don't toast for config errors - show inline
        } else {
          toast.error(result.message);
        }
        return;
      }
      setDraft(result.draft);
      toast.success("تم توليد مسودة قابلة للمراجعة");
    } catch {
      toast.error("تعذر الاتصال بخدمة الذكاء الاصطناعي. لم يتغير المستند.");
    } finally {
      setBusy(false);
    }
  };

  const insertDraft = () => {
    if (!draft) return;
    const id = insertReportDraft(draft, draftElementId || undefined);
    if (id) {
      setDraftElementId(id);
    }
  };

  // Render different UI based on entitlement and provider status
  if (!hasAiEntitlement) {
    return (
      <div className="editor-subgroup ai-report-panel">
        <h4 className="editor-subgroup-title">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-navy-2 dark:text-gold-2" />
            مسودة تقرير بالذكاء الاصطناعي
          </span>
        </h4>
        <div className="rounded-[8px] border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-amber-700 dark:text-amber-400" />
            <div>
              <p className="text-[11px] font-extrabold text-amber-800 dark:text-amber-300">
                ميزة الذكاء الاصطناعي تتطلب ترخيصًا نشطًا
              </p>
              <p className="text-[10px] leading-4 text-amber-700/80 dark:text-amber-400/80">
                هذه الميزة متاحة لحاملي تراخيص PRO و LIFETIME والتراخيص التجريبية.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-subgroup ai-report-panel">
      <h4 className="editor-subgroup-title">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-navy-2 dark:text-gold-2" />
          مسودة تقرير بالذكاء الاصطناعي
        </span>
      </h4>
      <p className="text-[10px] leading-4 text-muted">
        اكتب الحقائق أو النقاط المتاحة فقط. لن تُضاف أي نتيجة إلى الصفحة قبل الضغط على «إدراج».
      </p>

      {providerError === "not_configured" && (
        <div className="mb-2 rounded-[8px] border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold text-amber-800 dark:text-amber-300">
                مزود الذكاء الاصطناعي غير مهيأ
              </p>
              <p className="text-[10px] leading-4 text-amber-700/80 dark:text-amber-400/80">
                لديك الصلاحية، لكن بيئة النشر لم تُضبط بمزود ذكاء اصطناعي (OpenAI / Azure / أخرى).
              </p>
              {isOwner && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-700/80 dark:text-amber-400/80">
                  <ExternalLink className="size-3.5" />
                  <span>راجع متغيرات البيئة: <code className="font-mono">AI_PROVIDER</code>, <code className="font-mono">AI_API_KEY</code>, <code className="font-mono">AI_MODEL</code></span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <label className="grid gap-1 text-[11px] font-extrabold text-muted">
        موجز التقرير
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          maxLength={8000}
          rows={4}
          placeholder="مثال: تقرير أداء الربع الثاني، مؤشرات الإنجاز، التحديات، والقرارات المطلوبة…"
          className="w-full resize-y rounded-[8px] border border-line bg-white px-2.5 py-2 text-[12px] font-semibold leading-5 text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          الجمهور
          <input
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          الأقسام
          <select
            value={maxSections}
            onChange={(event) => setMaxSections(Number(event.target.value))}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            {[3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          نوع التقرير
          <select
            value={reportType}
            onChange={(event) => setReportType(event.target.value as ReportType)}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="executive">ملخص تنفيذي</option>
            <option value="performance">أداء ومؤشرات</option>
            <option value="project">حالة مشروع</option>
            <option value="policy">سياسة أو قرار</option>
            <option value="briefing">إحاطة قيادية</option>
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          مستوى التفصيل
          <select
            value={detailLevel}
            onChange={(event) => setDetailLevel(event.target.value as ReportDetail)}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="concise">موجز</option>
            <option value="standard">قياسي</option>
            <option value="detailed">مفصل</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          طول التقرير المستهدف
          <select
            value={pageTarget}
            onChange={(event) => setPageTarget(Number(event.target.value))}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value={1}>صفحة واحدة</option>
            <option value={2}>صفحتان</option>
            <option value={3}>ثلاث صفحات</option>
            <option value={4}>أربع صفحات</option>
          </select>
        </label>
        <p className="self-end text-[10px] leading-4 text-muted">
          تُستخدم هذه الاختيارات لتحديد بنية المسودة وكثافتها. الإدراج يضعها ككتلة منظمة قابلة للتعديل.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          اللغة
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as AiLanguage)}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          النبرة
          <select
            value={tone}
            onChange={(event) => setTone(event.target.value as AiTone)}
            className="h-9 w-full rounded-[8px] border border-line bg-white px-2.5 text-[12px] font-semibold text-ink dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="official">رسمية</option>
            <option value="executive">تنفيذية</option>
            <option value="plain">مباشرة</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !brief.trim()}
        onClick={() => void generate()}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-navy px-2 text-[11px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {busy ? "جارٍ إعداد المسودة…" : draft ? "توليد نسخة جديدة" : "توليد مسودة"}
      </button>
      {draft && (
        <div className="grid gap-2 rounded-[8px] border border-line bg-white/60 p-2 dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-extrabold text-ink dark:text-white">
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">{draft.title}</span>
            </span>
            <span className="shrink-0 text-[9px] font-bold text-muted">{draft.sections.length} أقسام</span>
          </div>
          <p className="line-clamp-3 text-[10px] leading-4 text-muted">{draft.summary}</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={insertDraft}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-[7px] bg-navy text-[10px] font-extrabold text-white"
            >
              <Plus className="size-3" />
              {draftElementId ? "تحديث الإدراج" : "إدراج في الصفحة"}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-[7px] border border-line text-[10px] font-extrabold dark:border-white/10"
            >
              <RefreshCw className="size-3" />
              إعادة التوليد
            </button>
          </div>
        </div>
      )}
    </div>
  );
}