/*
 * «من محتوى خام إلى مستند» — the public demonstration (`/ai`).
 *
 * WHY IT EXISTS
 * -------------
 * NASAQ already converts a PDF reference into a composed document and critiques
 * the result (`improveReference` → `composeReference` → `runLoop`), but that path
 * was only reachable from a test. The requirement is a *demonstration* a visitor
 * can run: paste real content, watch the platform measure it, compose it, and
 * show the before/after verdict — then open the result as a real editable NASAQ
 * document.
 *
 * It is deliberately the SAME pipeline, not a showcase version of it:
 *   · the composition is `composeText` (the generalized `composeReference`)
 *   · the improvement is `runLoop` (the critic + gated fixes used everywhere)
 *   · the save is `saveProject` + the editor's own address
 *
 * The page never claims the original file's structure was preserved: the copy
 * says exactly what happened, and the verdict lists the measured numbers.
 */

import { useState } from "react";
import { ArrowLeft, FileText, Gauge, Loader2, ScanText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { TemplatePreview } from "@/components/site/TemplatePreview";
import { useEditor } from "@/lib/editor/store";
import { useLicense } from "@/lib/license/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useBrandIdentity } from "@/lib/product/use-brand-identity";
import { applyBrandToProject } from "@/lib/editor/brand-design";
import { exceedsSavedProjectLimit } from "@/lib/editor/access-limits";
import {
  LICENSE_ROUTE,
  STUDIO_ROUTE,
  TEMPLATES_ROUTE,
  createPathFor,
  editorPathFor,
} from "@/lib/site-routes";
import {
  analyseRawText,
  improveRawText,
  type RawDocumentResult,
} from "@/lib/intelligence/raw-to-document";

const SAMPLE = `تقرير الأداء التشغيلي — الربع الثالث
عملت الفرق على ثلاث مبادرات: رقمنة الطلبات، وتقليل زمن المعالجة إلى 3 أيام، وتدريب 45 موظفًا.
بلغت نسبة الإنجاز 92٪ مقارنة بالخطة، وارتفع رضا المستفيدين إلى 4.7 من 5.
التوصيات: تثبيت الفريق على المبادرة الثانية، ورفع تقرير قياس بعد 30 يومًا.`;

export function RawToDocumentPage() {
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);
  const brand = useBrandIdentity();
  const hydrate = useEditor((s) => s.hydrate);

  const [raw, setRaw] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<RawDocumentResult | null>(null);

  const measured = raw.trim() ? analyseRawText(raw) : null;

  const run = async () => {
    if (raw.trim().length < 40) {
      toast.error("الصق نصًا أطول (٤٠ حرفًا على الأقل) ليُقاس ويُكوَّن.");
      return;
    }
    setBusy(true);
    try {
      setDemo(improveRawText({ text: raw, title: title.trim() || undefined }));
      toast.success("تم قياس المحتوى وتكوين المستند — راجع المقارنة");
    } catch {
      toast.error("تعذر تكوين المستند من هذا النص");
    } finally {
      setBusy(false);
    }
  };

  const openInEditor = async () => {
    if (!demo) return;
    const store = useEditor.getState();
    store.setEntitlements(entitlements);
    await hydrate();
    if (exceedsSavedProjectLimit(useEditor.getState().projects.length, entitlements)) {
      toast.error("اكتملت مساحة تجربة المحرر", {
        description: "يتضمن العرض مشروعًا واحدًا. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
      });
      return;
    }
    try {
      const project = brand.kit ? applyBrandToProject(demo.after, brand.kit) : demo.after;
      const created = await store.createDocument(project, { autoName: false });
      if (!created) {
        toast.error("تعذر تطبيق المستند الناتج؛ لم يتم حفظ أي تغيير.");
        return;
      }
      const id = useEditor.getState().id;
      if (!id) {
        toast.error("تعذر التحقق من المستند الناتج؛ لم يتم فتحه.");
        return;
      }
      window.location.assign(editorPathFor(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر حفظ المستند");
    }
  };

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/ai" />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold tracking-[0.2em] text-muted">NASAQ · AI</p>
            <h1 className="mt-1.5 text-[26px] font-extrabold text-ink">
              من محتوى خام إلى مستند مؤسسي
            </h1>
            <p className="mt-2 max-w-3xl text-[13.5px] leading-7 text-muted">
              الصق نصًا حقيقيًا — تقريرًا، محضرًا، ملاحظات أو جدولًا — ويرى المحرك ما
              يحتويه فعلًا: عدد الكلمات، العناوين، النقاط، الأرقام، والجداول. ثم يكوّن
              مستندًا بمقاس A4، ويشغّل المصحّح القياسي على الناتج، ويعرض «قبل/بعد»
              بالدرجة والمحاور — قبل أن تفتحه في المحرر كملف قابل للتحرير.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={createPathFor({ start: "raw" })}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              المسار داخل شاشة الإنشاء
            </a>
            <a
              href={TEMPLATES_ROUTE}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink transition hover:border-brand"
            >
              القوالب الجاهزة
            </a>
            <a
              href={STUDIO_ROUTE}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-navy px-3.5 text-[12.5px] font-extrabold text-on-brand transition hover:bg-navy-2"
            >
              <Sparkles className="size-4 text-gold" aria-hidden />
              استوديو التوليد
            </a>
          </div>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ── input + measurement ─────────────────────────────────────── */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-extrabold text-ink">المحتوى الخام</h2>
              <button
                type="button"
                onClick={() => {
                  setRaw(SAMPLE);
                  setTitle("تقرير الأداء التشغيلي");
                  setDemo(null);
                }}
                className="text-[11px] font-bold text-muted underline underline-offset-4 hover:text-brand"
              >
                تجربة بنص جاهز
              </button>
            </div>

            <textarea
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                setDemo(null);
              }}
              rows={14}
              dir="rtl"
              placeholder="الصق هنا النص الذي وصل إليك بصيغته الخام…"
              className="mt-2 w-full resize-y rounded-xl border border-line bg-page p-3 text-[13px] leading-7 focus:border-brand focus:outline-none"
            />

            <label className="mt-3 block text-[11px] font-bold text-muted">
              عنوان المستند (اختياري)
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="يُشتق من أول سطر إذا تركته فارغًا"
                className="mt-1 h-10 w-full rounded-[9px] border border-line bg-page px-2.5 text-[12.5px] font-semibold text-ink focus:border-brand focus:outline-none"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run()}
                className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-navy px-5 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanText className="size-4 text-gold" aria-hidden />}
                قِس المحتوى وكوّن المستند
              </button>
              {brand.kit && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-navy/5 px-2.5 py-1 text-[10.5px] font-bold text-brand">
                  تُطبَّق {brand.kit.organizationName?.trim() || "هوية جهتك"} عند الفتح
                </span>
              )}
            </div>

            {measured && (
              <div className="mt-4 rounded-xl border border-line bg-paper p-3">
                <p className="text-[11px] font-extrabold text-ink">ما وجده المحرك في نصك</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px] font-bold text-muted">
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5">{measured.words} كلمة</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5">{measured.lines} سطرًا</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5">{measured.headings.length} عنوانًا</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5">{measured.bullets.length} نقطة</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5">{measured.numbers.length} رقمًا</span>
                  {measured.tableRows.length > 0 && (
                    <span className="rounded-full border border-brand/40 bg-navy/5 px-2 py-0.5 text-brand">
                      جدول: {measured.tableRows.length} صفًا
                    </span>
                  )}
                </div>
                {measured.headings.length > 0 && (
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    العناوين: {measured.headings.slice(0, 5).join(" · ")}
                  </p>
                )}
              </div>
            )}

            <p className="mt-3 text-[11px] leading-5 text-muted">
              لا يستنتج المحرك معلومة غير موجودة في نصك: الأرقام والأسماء تبقى كما وردت،
              والنقص يُذكر ولا يُخمَّن.
            </p>
          </section>

          {/* ── verdict + open ──────────────────────────────────────────── */}
          <aside className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-[14px] font-extrabold text-ink">
              <Gauge className="size-4 text-brand" aria-hidden />
              نتيجة القياس
            </h2>

            {!demo && (
              <p className="mt-2 text-[12px] leading-6 text-muted">
                لم يُكوَّن مستند بعد. اضغط «قِس المحتوى وكوّن المستند» لعرض الدرجة قبل
                وبعد، والمحاور التي تحسّنت، وحجم النص المحفوظ.
              </p>
            )}

            {demo && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl border border-line bg-paper px-3 py-2">
                    <p className="text-[10px] font-bold text-muted">قبل (نقل حرفي)</p>
                    <p className="mt-1 text-[22px] font-black text-ink">{demo.verdict.scoreBefore}</p>
                  </div>
                  <div className="rounded-xl border border-brand/40 bg-navy/5 px-3 py-2">
                    <p className="text-[10px] font-bold text-brand">بعد (مستند مُكوَّن)</p>
                    <p className="mt-1 text-[22px] font-black text-brand">{demo.verdict.scoreAfter}</p>
                  </div>
                </div>

                <ul className="mt-3 grid gap-1.5 text-[11.5px] leading-5 text-muted">
                  <li>{demo.verdict.sizeKept ? "✔" : "✖"} المقاس وعدد الصفحات محفوظان</li>
                  <li>{demo.verdict.contentKept ? "✔" : "✖"} كل النص الأصلي ما زال في المستند</li>
                  <li>
                    {demo.verdict.realImprovement ? "✔" : "✖"} تحسّن حقيقي مقابل النسخة الحرفية
                  </li>
                  {demo.verdict.improvedAxes.length > 0 && (
                    <li>المحاور المتحسّنة: {demo.verdict.improvedAxes.join(" · ")}</li>
                  )}
                </ul>

                <div className="mt-3 rounded-xl border border-line bg-paper p-2">
                  <TemplatePreview
                    page={demo.after.pages[0]}
                    className="rounded-md border border-line"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void openInEditor()}
                  className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-navy px-4 text-[13px] font-extrabold text-on-brand transition hover:bg-navy-2"
                >
                  <FileText className="size-4" aria-hidden />
                  افتح المستند في المحرر
                  <ArrowLeft className="size-4" aria-hidden />
                </button>
                {!entitlements.brand_kit && (
                  <a
                    href={LICENSE_ROUTE}
                    className="mt-2 block text-center text-[11px] font-bold text-muted underline underline-offset-4 hover:text-brand"
                  >
                    تطبيق هوية جهتك على المستند يتطلب ترخيص «الهوية المؤسسية»
                  </a>
                )}
              </>
            )}
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
