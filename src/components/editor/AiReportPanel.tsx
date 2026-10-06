import { useState } from "react";
import { FileText, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { generateReportDraftFn } from "@/lib/ai/functions";
import { aiCallErrorMessage } from "@/lib/ai/client-errors";
import {
  type AiLanguage,
  type AiTone,
  type ReportDetail,
  type ReportDraft,
  type ReportType,
} from "@/lib/ai/contract";
import { useEditor } from "@/lib/editor/store";
import {
  aiOperationErrorMessage,
  applyAIEditorOperations,
  buildAIEditorContext,
} from "@/lib/ai/editor-bridge";

/** User-triggered AI intake. It never edits the page until the author inserts it. */
export function AiReportPanel() {
  const documentTitle = useEditor((s) => s.name);
  const pages = useEditor((s) => s.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const entitlements = useEditor((s) => s.entitlements);
  const entitlementsResolved = useEditor((s) => s.entitlementsResolved);
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

  const generate = async () => {
    if (!brief.trim() || busy) return;
    if (entitlementsResolved && !entitlements.ai_report) {
      toast.error("تحتاج هذه الميزة إلى ترخيص نشط. لم يتغير المستند.");
      return;
    }
    setBusy(true);
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
          documentTitle,
          documentContext: JSON.stringify(buildAIEditorContext({
            name: documentTitle,
            theme: useEditor.getState().theme,
            pages,
            activePageId,
            selectedIds,
          })).slice(0, 4000),
        },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDraft(result.draft);
      toast.success("تم توليد مسودة قابلة للمراجعة");
    } catch (error) {
      toast.error(aiCallErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const insertDraft = () => {
    if (!draft) return;
    void applyAIEditorOperations(useEditor.getState(), [{
      type: "insert_report_draft",
      draft,
      existingId: draftElementId || undefined,
    }]).then((results) => {
      const result = results[0];
      if (!result?.ok) {
        toast.error(result ? aiOperationErrorMessage(result) : "تعذر إدراج المسودة؛ لم يتغير المستند.");
        return;
      }
      if (result.createdIds?.[0]) setDraftElementId(result.createdIds[0]);
    });
  };

  return (
    <div className="editor-subgroup ai-report-panel">
      <h4 className="editor-subgroup-title">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-brand-hover" />
          مسودة تقرير بالذكاء الاصطناعي
        </span>
      </h4>
      <p className="text-[10px] leading-4 text-muted">
        اكتب الحقائق أو النقاط المتاحة فقط. يُرسل عنوان المستند ونص الصفحات كسياق، ولا يُضاف شيء إلى الصفحة قبل «إدراج».
      </p>
      <label className="grid gap-1 text-[11px] font-extrabold text-muted">
        موجز التقرير
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          maxLength={8000}
          rows={4}
          placeholder="مثال: تقرير أداء الربع الثاني، مؤشرات الإنجاز، التحديات، والقرارات المطلوبة…"
          className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12px] font-semibold leading-5 text-ink"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          الجمهور
          <input
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
          />
        </label>
        <label className="grid gap-1 text-[11px] font-extrabold text-muted">
          الأقسام
          <select
            value={maxSections}
            onChange={(event) => setMaxSections(Number(event.target.value))}
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
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
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
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
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
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
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
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
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
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
            className="h-9 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
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
        <div className="grid gap-2 rounded-[8px] border border-line bg-surface-2 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-extrabold text-ink">
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
              className="inline-flex h-8 items-center justify-center gap-1 rounded-[7px] border border-line text-[10px] font-extrabold"
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
