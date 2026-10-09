import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, FileImage, Loader2, RotateCcw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { RequireSignedIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useLicense } from "@/lib/license/client";
import { analyzeImageFn } from "@/lib/ai/image-functions";
import { uploadEditorAsset } from "@/lib/storage/functions";
import { prepareDesignTwinFn } from "@/lib/ai/functions";
import { applyAIEditorOperations, type AIEditorOperationResult } from "@/lib/ai/editor-bridge";
import { aiCallErrorMessage } from "@/lib/ai/client-errors";
import { useEditor } from "@/lib/editor/store";
import { getProject, setSetting } from "@/lib/editor/storage";
import { projectAccessBlock } from "@/lib/editor/access-limits";
import { applicationPageLimit } from "@/lib/product/product";
import { editorPathFor, trainingCenterPath } from "@/lib/site-routes";
import { listTrainingCenterFn, saveTrainingReferenceFn, deleteTrainingReferenceFn, updateTrainingMemoryFn, deleteTrainingMemoryFn, resetTrainingCenterFn, type TrainingReferenceView } from "@/lib/ai/training-functions";
import type { DesignMemoryView } from "@/lib/ai/design-memory";

/**
 * Arabic wording for the editor-bridge failure codes the training center can
 * hit when opening a generated design. The bridge messages are internal
 * English; the author gets a sentence that says what happened and that no
 * document was changed.
 */
function trainingOpenFailureMessage(result: AIEditorOperationResult): string {
  if (result.ok) return "";
  switch (result.code) {
    case "invalid_document":
      return "التصميم الناتج لم يجتز فحص الجودة الداخلي؛ لم يُفتح أي مستند.";
    case "persistence_failed":
      return "تعذر حفظ التصميم الناتج؛ لم يتم فتحه في المحرر.";
    case "invalid_operation":
    case "unsupported_operation":
      return "أمر فتح المستند غير مدعوم في هذا الإصدار من المحرر.";
    default:
      return "تعذر فتح التصميم الناتج في المحرر؛ لم يتغير أي مستند.";
  }
}

function TrainingCenterContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useCurrentUserState();
  const { entitlements } = useLicense(user?.id, user?.primaryEmail);
  const hydrate = useEditor((s) => s.hydrate);
  const [references, setReferences] = useState<TrainingReferenceView[]>([]);
  const [memory, setMemory] = useState<DesignMemoryView[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [scope, setScope] = useState<"global" | "project" | "task">("global");
  const [testPrompt, setTestPrompt] = useState("صمم موجزًا تنفيذيًا هادئًا مع مساحات بيضاء واضحة");
  useEffect(() => { void listTrainingCenterFn().then((r) => { if (r.ok) { setReferences(r.references); setMemory(r.memory); } }); }, []);
  const analyze = async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error("يدعم التدريب صور PNG أو JPEG أو WebP فقط."); return; }
    if (file.size > 1_500_000) { toast.error("حجم المرجع يجب ألا يتجاوز 1.5MB."); return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
      const result = await analyzeImageFn({ data: { imageData: dataUrl, language: "ar" } });
      if (!result.ok) throw new Error(result.message);
      const likes = window.prompt("ما الذي يعجبك في هذا المرجع؟", result.analysis.description) ?? "";
      const dislikes = window.prompt("ما الذي لا يناسب ذوقك؟", "") ?? "";
      let assetId: string | null = null;
      try {
        const uploaded = await uploadEditorAsset({ data: { kind: "image", fileName: file.name, contentType: file.type, base64: dataUrl.split(",")[1], width: null, height: null, projectId: null } });
        if (uploaded.ok) assetId = uploaded.asset.id;
      } catch { /* R2 is optional; the structured training record still persists. */ }
      const saved = await saveTrainingReferenceFn({ data: { fileName: file.name, contentType: file.type, assetId, analysis: result.analysis, likes, dislikes, scope } });
      if (!saved.ok) throw new Error(saved.message);
      setReferences((rows) => [saved.reference, ...rows]);
      const note = [likes && `أحب: ${likes}`, dislikes && `أتجنب: ${dislikes}`].filter(Boolean).join(" | ");
      if (note) {
        const remembered = await updateTrainingMemoryFn({ data: { kind: "preference", category: "", brief: file.name, reason: note, recurring: true, ruleKey: "", ruleValue: "" } });
        if (remembered.ok) setMemory((rows) => [remembered.entry, ...rows]);
      }
      toast.success("حُفظ المرجع وتحول إلى قاعدة قابلة لإعادة الاستخدام.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "تعذر تحليل المرجع."); }
    finally { setBusy(false); }
  };
  const saveFeedback = async (kind: "approved" | "rejected" | "correction") => {
    const reason = feedback.trim();
    if ((kind !== "approved") && reason.length < 2) { toast.error("اكتب الملاحظة التي تريد أن يتعلمها المساعد."); return; }
    const result = await updateTrainingMemoryFn({ data: { kind, category: "", brief: testPrompt, reason, recurring: true, ruleKey: "", ruleValue: "" } });
    if (!result.ok) { toast.error(result.message); return; }
    setMemory((rows) => [result.entry, ...rows]); setFeedback(""); toast.success("تم تحديث ذاكرة التصميم لهذا الحساب.");
  };
  const testLearned = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const prepared = await prepareDesignTwinFn({ data: { prompt: testPrompt, mode: "professional" } });
      if (!prepared.ok) throw new Error(prepared.message);
      const { executeDesignTwin } = await import("@/lib/ai/design-twin");
      const delivery = executeDesignTwin({ prompt: testPrompt, maxPages: applicationPageLimit(), geminiBrief: prepared.gemini.ok ? prepared.gemini.brief : null, memory: prepared.memory, providerMessage: prepared.gemini.ok ? undefined : prepared.gemini.message });
      /*
       * Boot the editor store exactly the way every other production entry
       * does (the raw-to-document page, the AI studio): resolve THIS
       * account's entitlements and hydrate the owner-scoped library. The
       * editor's document command refuses while access is unresolved, and an
       * un-booted store is precisely how the generated design used to fail
       * with «تعذر فتحه في المحرر» — a real document that was never created.
       */
      const store = useEditor.getState();
      store.setEntitlements(entitlements);
      await hydrate();
      const booted = useEditor.getState();
      if (user && booted.sessionOwner !== user.id) {
        throw new Error("انتهت جلسة التحرير أو تغيّر الحساب؛ سجّل الدخول من جديد ثم أعد المحاولة.");
      }
      if (projectAccessBlock(delivery.project, booted.entitlements)) throw new Error("التصميم يتجاوز حدود خطتك الحالية؛ لم يُفتح أي مستند.");
      const applied = await applyAIEditorOperations(useEditor.getState(), [{ type: "generate_document", project: delivery.project }]);
      if (!applied[0]?.ok) throw new Error(applied[0] ? trainingOpenFailureMessage(applied[0]) : "تعذر فتح التصميم الناتج في المحرر.");
      /*
       * Verify the row is REALLY persisted before navigating: `/editor/<id>`
       * resolves the address by reading that id back from storage, so a
       * missing row there would land on «هذا المستند غير متاح».
       */
      const projectId = useEditor.getState().id;
      const saved = projectId ? await getProject(projectId) : null;
      if (!saved?.id) throw new Error("تعذر حفظ المشروع الناتج؛ لم يتم الانتقال إلى المحرر.");
      await setSetting("activeProjectId", saved.id);
      toast.success("حُفظ التصميم في مشاريعك — جارٍ فتحه في المحرر…");
      window.location.assign(editorPathFor(saved.id));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      toast.error(aiCallErrorMessage(error, detail || "تعذر اختبار ما تعلمه المساعد."));
    }
    finally { setBusy(false); }
  };
  const reset = async () => { if (!window.confirm("سيحذف هذا كل مراجع التدريب وقواعد الذوق لهذا الحساب فقط. متابعة؟")) return; const r = await resetTrainingCenterFn(); if (r.ok) { setReferences([]); setMemory([]); toast.success("تمت إعادة ضبط ملف الذوق."); } };
  return <div dir="rtl" className="min-h-screen bg-paper text-ink"><SiteHeader current={trainingCenterPath()} /><main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 md:py-12">
    <section className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-9"><div className="absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-navy via-brand to-gold" /><div className="flex flex-wrap items-start justify-between gap-5"><div><span className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-navy/5 px-3 py-1 text-[11px] font-extrabold text-brand"><Sparkles className="size-3.5" /> الذاكرة الإبداعية</span><h1 className="mt-4 text-3xl font-black tracking-tight">تدريب مساعدي</h1><p className="mt-3 max-w-2xl text-[14px] leading-7 text-muted">علّم نَسَق ذوقك بالمرجع والملاحظة، ثم اختبر أثره على تصميم حقيقي قابل للتحرير. القواعد محفوظة لحسابك ولا تُستخدم لمستخدم آخر.</p></div><BookOpen className="size-12 text-brand/30" aria-hidden /></div></section>
    <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-black">تدريب بالمرجع</h2><p className="mt-1 text-xs font-semibold text-muted">ارفع صورة تصميم، اشرح ما يعجبك وما يجب تجنبه، وسيحللها Gemini عند تفعيله.</p></div><FileImage className="size-6 text-brand" /></div><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="grid gap-1 text-xs font-bold text-muted">نطاق القاعدة<select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className="h-10 rounded-lg border border-line bg-page px-2 text-sm font-bold text-ink"><option value="global">ذوقي العام</option><option value="project">هذا المشروع</option><option value="task">هذه المهمة</option></select></label><button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-xs font-black text-on-brand disabled:opacity-50"><Upload className="size-4" /> رفع وتحليل مرجع</button><input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void analyze(file); e.currentTarget.value = ""; }} /></div>{references.length === 0 ? <div className="rounded-xl border border-dashed border-line p-5 text-center text-xs font-semibold text-muted">لم تُحفظ مراجع بعد.</div> : <div className="grid gap-2">{references.map((ref) => <article key={ref.id} className="rounded-xl border border-line/80 bg-surface-2/40 p-3"><div className="flex items-start justify-between gap-2"><div><h3 className="text-sm font-black">{ref.fileName}</h3><p className="mt-1 text-xs leading-5 text-muted">{ref.analysis.description || "تم حفظ المرجع."}</p></div><button type="button" aria-label="حذف المرجع" onClick={() => void deleteTrainingReferenceFn({ data: { id: ref.id } }).then((r) => { if (r.ok) setReferences((rows) => rows.filter((x) => x.id !== ref.id)); })} className="text-muted hover:text-danger"><Trash2 className="size-4" /></button></div>{(ref.likes || ref.dislikes) && <p className="mt-2 text-[11px] font-bold text-brand">{ref.likes && `يعجبني: ${ref.likes}`} {ref.dislikes && ` · أتجنب: ${ref.dislikes}`}</p>}</article>)}</div>}</section>
      <section className="grid content-start gap-4 rounded-2xl border border-line bg-surface p-5 sm:p-6"><div><h2 className="text-lg font-black">تغذية مباشرة</h2><p className="mt-1 text-xs font-semibold leading-5 text-muted">أكد النتيجة أو اكتب تصحيحًا طبيعيًا. لا تصبح الملاحظة قاعدة دائمة إلا عند تأكيدك.</p></div><textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} placeholder="مثال: العنوان كبير جدًا، استخدم مساحة بيضاء أكبر…" className="resize-y rounded-lg border border-line bg-page p-3 text-sm font-semibold leading-6" /><div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => void saveFeedback("approved")} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-line text-[11px] font-black"><Check className="size-3.5" />هذا هو ذوقي</button><button type="button" onClick={() => void saveFeedback("rejected")} className="h-10 rounded-lg border border-line text-[11px] font-black">لا يناسب ذوقي</button><button type="button" onClick={() => void saveFeedback("correction")} className="h-10 rounded-lg border border-line text-[11px] font-black">عدّل هذا الجزء</button></div><button type="button" onClick={() => void saveFeedback("correction")} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-brand/30 bg-navy/5 text-xs font-black text-brand">احفظ هذه القاعدة</button></section>
    </div>
    <section className="grid gap-4 rounded-2xl border border-brand/20 bg-navy/[.04] p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black">اختبر ما تعلّمه</h2><p className="mt-1 text-xs font-semibold text-muted">سيُستدعى ملف الذوق المؤكد قبل التوليد، ثم تُفتح النتيجة كمستند قابل للتحرير.</p></div><button type="button" disabled={busy} onClick={() => void testLearned()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-xs font-black text-on-brand disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />} اختبار التعلّم</button></div><textarea value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} rows={2} className="rounded-lg border border-line bg-surface p-3 text-sm font-semibold leading-6" />{memory.length > 0 && <div className="grid gap-2"><h3 className="text-xs font-black text-muted">قواعد محفوظة لهذا الحساب ({memory.length})</h3>{memory.slice(0, 8).map((row) => <div key={row.id} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-xs"><span className="leading-5">{row.recurring ? "قاعدة دائمة" : "ملاحظة"} · {row.reason || row.brief}</span><button type="button" aria-label="حذف القاعدة" onClick={() => void deleteTrainingMemoryFn({ data: { id: row.id } }).then((r) => { if (r.ok) setMemory((rows) => rows.filter((x) => x.id !== row.id)); })} className="text-muted hover:text-danger"><Trash2 className="size-3.5" /></button></div>)}</div>}</section>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4"><p className="text-[11px] font-semibold text-muted">المعالجة تتم عبر المسار الآمن نفسه، مع عزل الحساب وحدود الاستخدام الحالية.</p><button type="button" onClick={() => void reset()} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted hover:text-danger"><RotateCcw className="size-3.5" />إعادة ضبط ملف الذوق</button></div>
  </main><SiteFooter /></div>;
}
export function TrainingCenterPage() { return <RequireSignedIn><TrainingCenterContent /></RequireSignedIn>; }
