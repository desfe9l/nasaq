/*
 * «محتوى خام ← مستند نَسَق» — the demonstration, on the real surfaces.
 *
 * The flow is three visible steps, each of which does one thing:
 *
 *   1. الصق محتواك  → the paste is MEASURED (words, headings, bullets, figures,
 *      a delimited table) and the measurement is shown. Nothing is generated.
 *   2. نظّمه        → either the existing AI draft server function (the same one
 *      «مسودات التقارير» uses in the editor, gated by `ai_report`), or a local,
 *      deterministic ordering of the author's own words when AI is unavailable.
 *   3. افتح المحرر → the draft becomes a real project (`buildDraftDocument`),
 *      gets the institutional identity when it is licensed, is saved through the
 *      store's own `importProject`, and opens at `/editor/<id>`.
 *
 * No new model, no new storage, no second editor: the outcome is the same
 * editable NASAQ document every other creation path produces.
 */

import { useMemo, useState } from "react";
import { ArrowLeft, FileText, Loader2, ScanText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useEditor } from "@/lib/editor/store";
import { useLicense } from "@/lib/license/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { exceedsSavedProjectLimit } from "@/lib/editor/access-limits";
import { buildDraftDocument } from "@/lib/editor/raw-document";
import {
  RAW_MAX_CHARS,
  RAW_MAX_SECTIONS,
  analyzeRawContent,
  draftFromRawContent,
  rawContentRetentionVerdict,
  rawBrief,
} from "@/lib/intelligence/raw-content";
import type { ReportDraft, ReportDetail, AiTone } from "@/lib/ai/contract";
import { generateReportDraftFn } from "@/lib/ai/functions";
import { aiCallErrorMessage } from "@/lib/ai/client-errors";
import { LICENSE_ROUTE, editorPathFor } from "@/lib/site-routes";
import { readBrandKit } from "@/lib/product/brand-kit";
import {
  applyBrandToProject,
  brandIsConfigured,
} from "@/lib/editor/brand-design";
import { cn } from "@/lib/utils";

const TONES: Array<{ id: AiTone; label: string }> = [
  { id: "official", label: "رسمية" },
  { id: "executive", label: "تنفيذية" },
  { id: "plain", label: "مباشرة" },
];

const DETAILS: Array<{ id: ReportDetail; label: string }> = [
  { id: "concise", label: "موجز" },
  { id: "standard", label: "متوازن" },
  { id: "detailed", label: "مفصّل" },
];

export function RawContentFlow() {
  const importProject = useEditor((s) => s.importProject);
  const hydrate = useEditor((s) => s.hydrate);
  const setEntitlements = useEditor((s) => s.setEntitlements);
  const theme = useEditor((s) => s.theme);
  const orgName = useEditor((s) => s.orgName);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);

  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<AiTone>("official");
  const [detail, setDetail] = useState<ReportDetail>("standard");
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [draftSource, setDraftSource] = useState<"ai" | "local" | null>(null);
  const [retention, setRetention] = useState<ReturnType<typeof rawContentRetentionVerdict> | null>(null);
  const [busy, setBusy] = useState<"ai" | "local" | "build" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analysis = useMemo(() => analyzeRawContent(raw), [raw]);
  const tooLarge = analysis.chars > RAW_MAX_CHARS;
  const ready = raw.trim().length >= 40 && !tooLarge;

  const acceptDraft = (next: ReportDraft, source: "ai" | "local") => {
    const verdict = rawContentRetentionVerdict(raw, next);
    setRetention(verdict);
    if (!verdict.ok) {
      setDraft(null);
      setDraftSource(null);
      setError(
        `لم تثبت المسودة الاحتفاظ بكل المحتوى (${verdict.retainedLines} من ${verdict.sourceLines} سطرًا). لم يُنشأ مستند؛ استخدم الترتيب المحلي أو راجع النص الناقص: ${verdict.missingLines.join(" · ")}`,
      );
      return;
    }
    setDraft(next);
    setDraftSource(source);
  };

  const organizeWithAi = async () => {
    if (!ready) return;
    setBusy("ai");
    setError(null);
    try {
      const result = await generateReportDraftFn({
        data: {
          brief: rawBrief(raw, title, audience),
          audience: audience || "الإدارة العليا",
          tone,
          language: "ar",
          maxSections: RAW_MAX_SECTIONS,
          reportType: "executive",
          detailLevel: detail,
          pageTarget: 1,
          documentTitle: title || analysis.suggestedTitle,
        },
      });
      if (!result.ok) {
        setError(
          result.code === "license_required"
            ? "التنظيم بالذكاء الاصطناعي متاح مع النسخة الكاملة — يمكنك الترتيب المحلي الآن، أو تفعيل الترخيص."
            : result.message,
        );
        return;
      }
      acceptDraft(result.draft, "ai");
      if (rawContentRetentionVerdict(raw, result.draft).ok) {
        toast.success("نُظّم المحتوى كمسودة — ثبت الاحتفاظ بالمحتوى قبل إنشاء المستند");
      }
    } catch (error) {
      setError(
        aiCallErrorMessage(error, "تعذّر الاتصال بخدمة الذكاء الاصطناعي. يمكنك الترتيب المحلي."),
      );
    } finally {
      setBusy(null);
    }
  };

  const organizeLocally = () => {
    if (!ready) return;
    setBusy("local");
    setError(null);
    try {
      const next = draftFromRawContent(raw, { title });
      acceptDraft(next, "local");
      if (rawContentRetentionVerdict(raw, next).ok) {
        toast.info("رُتّب النص كما هو، وثبت الاحتفاظ به قبل الإنشاء");
      }
    } finally {
      setBusy(null);
    }
  };

  const openInEditor = async () => {
    if (!draft) return;
    if (!retention?.ok) {
      setError("لا يمكن إنشاء المستند قبل نجاح تحقق الاحتفاظ الكامل بالمحتوى.");
      return;
    }
    setBusy("build");
    setError(null);
    try {
      setEntitlements(entitlements);
      await hydrate();
      if (exceedsSavedProjectLimit(useEditor.getState().projects.length, entitlements)) {
        toast.error("اكتملت مساحة تجربة المحرر", {
          description: "يتضمن العرض مشروعًا واحدًا. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
        });
        return;
      }
      let project = buildDraftDocument({
        draft,
        theme,
        orgName,
        title: title || analysis.suggestedTitle,
      });
      // The identity is applied to the document itself when it is licensed.
      if (entitlements.brand_kit) {
        try {
          const kit = await readBrandKit();
          if (brandIsConfigured(kit)) {
            project = applyBrandToProject(project, kit);
          }
        } catch {
          /* an unreadable kit must not block the document */
        }
      }
      const imported = await importProject(project, { successMessage: null });
      if (!imported) return;
      const id = useEditor.getState().id;
      window.location.assign(id ? editorPathFor(id) : "/create");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إنشاء المستند");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 text-ink lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Step 1 + 2: the paste and its organisation ───────────────────── */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-[10px] bg-navy/10 text-brand">
            <ScanText className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-[14px] font-extrabold">١ · الصق المحتوى الخام</h2>
            <p className="text-[11.5px] text-muted">
              نص من بريد، محضر، ملاحظات أو جدول — يُقاس أولًا قبل أي توليد.
            </p>
          </div>
        </div>

        <textarea
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            setDraft(null);
            setDraftSource(null);
            setRetention(null);
          }}
          rows={12}
          dir="rtl"
          placeholder={"مثال:\nتقرير الأداء التشغيلي\nمقدمة\nعملت الفرق خلال الربع على ثلاث مبادرات…\n\nالمبادرات\n- رقمنة الطلبات\n- تقليل زمن المعالجة إلى 3 أيام"}
          className="mt-3 w-full resize-y rounded-xl border border-line bg-page p-3 text-[13px] leading-7 focus:border-brand focus:outline-none"
        />

        <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] font-bold text-muted">
          <span className="rounded-full border border-line bg-paper px-2 py-0.5">{analysis.words} كلمة</span>
          <span className="rounded-full border border-line bg-paper px-2 py-0.5">{analysis.chars} حرفًا</span>
          <span className="rounded-full border border-line bg-paper px-2 py-0.5">{analysis.headings.length} عنوانًا</span>
          <span className="rounded-full border border-line bg-paper px-2 py-0.5">{analysis.bullets.length} نقطة</span>
          <span className="rounded-full border border-line bg-paper px-2 py-0.5">{analysis.numbers.length} رقمًا</span>
          <span className={cn("rounded-full border px-2 py-0.5", tooLarge ? "border-danger/30 bg-danger/10 text-error" : "border-line bg-paper")}>
            الحد: {RAW_MAX_CHARS.toLocaleString("ar-SA")} حرفًا
          </span>
          {analysis.tableRows.length > 0 && (
            <span className="rounded-full border border-brand/40 bg-navy/5 px-2 py-0.5 text-brand">
              جدول بمعرّف: {analysis.tableRows.length} صفًا
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-[11px] font-bold text-muted">
            عنوان المستند
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={analysis.suggestedTitle || "تقرير جديد"}
              className="mt-1 h-9 w-full rounded-[9px] border border-line bg-page px-2 text-[12px] font-semibold text-ink focus:border-brand focus:outline-none"
            />
          </label>
          <label className="text-[11px] font-bold text-muted">
            الجمهور
            <input
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="الإدارة العليا"
              className="mt-1 h-9 w-full rounded-[9px] border border-line bg-page px-2 text-[12px] font-semibold text-ink focus:border-brand focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-bold text-muted">
              النبرة
              <select
                value={tone}
                onChange={(event) => setTone(event.target.value as AiTone)}
                className="mt-1 h-9 w-full rounded-[9px] border border-line bg-page px-2 text-[12px] font-semibold text-ink focus:border-brand focus:outline-none"
              >
                {TONES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-bold text-muted">
              التفصيل
              <select
                value={detail}
                onChange={(event) => setDetail(event.target.value as ReportDetail)}
                className="mt-1 h-9 w-full rounded-[9px] border border-line bg-page px-2 text-[12px] font-semibold text-ink focus:border-brand focus:outline-none"
              >
                {DETAILS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!ready || busy !== null}
            onClick={() => void organizeWithAi()}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50"
          >
            {busy === "ai" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4 text-gold" aria-hidden />}
            ٢ · نظّم بالذكاء الاصطناعي
          </button>
          <button
            type="button"
            disabled={!ready || busy !== null}
            onClick={organizeLocally}
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand disabled:opacity-50"
          >
            {busy === "local" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            ترتيب محلي بدون ذكاء اصطناعي
          </button>
          {!entitlements.ai_report && (
            <a href={LICENSE_ROUTE} className="text-[11.5px] font-bold text-muted underline underline-offset-4 hover:text-brand">
              التنظيم بالذكاء الاصطناعي ضمن النسخة الكاملة
            </a>
          )}
        </div>

        {!ready && raw.length > 0 && (
          <p className={cn("mt-2 text-[11px]", tooLarge ? "text-error" : "text-muted")}>
            {tooLarge
              ? `المحتوى أطول من الحد الواضح (${RAW_MAX_CHARS.toLocaleString("ar-SA")} حرفًا). لم يُرسل أو يُقتطع؛ قسّمه إلى مستندات منفصلة أولًا.`
              : "اكتب ٤٠ حرفًا على الأقل ليقيس المحتوى ويُنظّمه."}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] leading-6 text-error">
            {error}
          </p>
        )}
      </section>

      {/* ── Step 3: the draft, then the real document ─────────────────────── */}
      <aside className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[14px] font-extrabold">٣ · راجع ثم افتح المحرر</h2>
        {!draft && (
          <p className="mt-2 text-[12px] leading-6 text-muted">
            لم تُنشأ مسودة بعد. القياس وحده لا ينشئ مستندًا — اختر «نظّم بالذكاء الاصطناعي»
            أو «ترتيب محلي»، ثم راجع العناوين هنا قبل فتح المحرر.
          </p>
        )}
        {draft && (
          <>
            <p
              className={cn(
                "mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10.5px] font-bold",
                draftSource === "ai"
                  ? "border-brand/40 bg-navy/5 text-brand"
                  : "border-line bg-paper text-muted",
              )}
            >
              {draftSource === "ai" ? "مسودة منظمة بالذكاء الاصطناعي" : "ترتيب محلي — النص كما هو"}
            </p>
            {retention && (
              <p className="mt-2 text-[10.5px] font-bold text-success">
                تحقق الاحتفاظ: {retention.retainedLines} من {retention.sourceLines} سطرًا
              </p>
            )}
            <h3 className="mt-3 text-[13px] font-extrabold text-ink">{draft.title}</h3>
            <ul className="mt-2 grid gap-1.5">
              {draft.sections.map((section, index) => (
                <li key={`${section.heading}-${index}`} className="rounded-[9px] border border-line bg-page px-2.5 py-1.5">
                  <p className="text-[11.5px] font-bold text-ink">{section.heading}</p>
                  {section.bullets.length > 0 && (
                    <p className="mt-0.5 text-[10.5px] text-muted">{section.bullets.length} نقطة</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10.5px] leading-5 text-muted">
              صفحة A4 واحدة بترويسة تحمل اسم الجهة، وكل نص فيها قابل للتحرير في المحرر.
            </p>
            <button
              type="button"
              disabled={busy !== null || !retention?.ok}
              onClick={() => void openInEditor()}
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50"
            >
              {busy === "build" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
              إنشاء المستند وفتح المحرر
              <ArrowLeft className="size-4" aria-hidden />
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
