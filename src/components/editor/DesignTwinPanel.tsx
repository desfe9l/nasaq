import { useEffect, useState } from "react";
import { Check, Loader2, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteDesignMemoryFn,
  listDesignMemoryFn,
  prepareDesignTwinFn,
  recordDesignMemoryFn,
} from "@/lib/ai/functions";
import { aiOperationErrorMessage, applyAIEditorOperations } from "@/lib/ai/editor-bridge";
import type { DesignMemoryView } from "@/lib/ai/design-memory";
import type { TwinDelivery } from "@/lib/ai/design-twin";
import { applicationPageLimit } from "@/lib/product/product";
import { projectAccessBlock } from "@/lib/editor/access-limits";
import { useEditor } from "@/lib/editor/store";
import { getProject, setSetting } from "@/lib/editor/storage";

const FORMATS = [
  { id: "", label: "حسب الموجز" },
  { id: "a4-book", label: "A4" },
  { id: "wide-slide", label: "عرض" },
  { id: "tall-story", label: "قصة" },
] as const;

/**
 * Editor entry for the design twin. Gemini is asked first. Editable elements
 * are created by the existing layout engine and opened with the editor's
 * document command — nothing here is a second canvas.
 */
export function DesignTwinPanel() {
  const entitlements = useEditor((s) => s.entitlements);
  const entitlementsResolved = useEditor((s) => s.entitlementsResolved);
  const [prompt, setPrompt] = useState("");
  const [audience, setAudience] = useState("");
  const [format, setFormat] = useState<"" | "a4-book" | "wide-slide" | "tall-story">("");
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<TwinDelivery | null>(null);
  const [memory, setMemory] = useState<DesignMemoryView[]>([]);
  const [reason, setReason] = useState("");
  const [recurring, setRecurring] = useState(false);

  useEffect(() => {
    let alive = true;
    void listDesignMemoryFn()
      .then((result) => {
        if (alive && result.ok) setMemory(result.memory);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const run = async () => {
    if (!prompt.trim() || busy) return;
    if (entitlementsResolved && !entitlements.ai_report) {
      toast.error("تحتاج هذه الميزة إلى ترخيص نشط. لم يُفتح مستند جديد.");
      return;
    }
    setBusy(true);
    setDelivery(null);
    try {
      const prepared = await prepareDesignTwinFn({
        data: {
          prompt,
          audience,
          mode: "professional",
          format: format || undefined,
        },
      });
      if (!prepared.ok) {
        toast.error(prepared.message);
        return;
      }
      if (prepared.memoryError) toast.message(prepared.memoryError);
      const { executeDesignTwin } = await import("@/lib/ai/design-twin");
      const next = executeDesignTwin({
        prompt,
        audience,
        format: format || undefined,
        pages: prepared.gemini.ok ? prepared.gemini.brief.pages : undefined,
        maxPages: entitlements.unlimited_pages ? undefined : applicationPageLimit(),
        geminiBrief: prepared.gemini.ok ? prepared.gemini.brief : null,
        memory: prepared.memory,
        providerMessage: prepared.gemini.ok ? undefined : prepared.gemini.message,
      });
      setDelivery(next);
      setMemory(prepared.memory);
      if (!prepared.gemini.ok) toast.message(prepared.gemini.message);
      else toast.success("اكتمل التوليد والمراجعة");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تنفيذ التوأم.");
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    if (!delivery) return;
    const block = projectAccessBlock(delivery.project, entitlements);
    if (block) {
      toast.error(block === "page-limit" ? "التصميم يتجاوز حد صفحات خطتك." : "هذا التصميم يحتاج ترخيصًا أعلى.");
      return;
    }
    const results = await applyAIEditorOperations(useEditor.getState(), [{
      type: "generate_document",
      project: delivery.project,
    }]);
    const result = results[0];
    if (!result?.ok) {
      toast.error(result ? aiOperationErrorMessage(result) : "لم يُفتح المستند.");
      return;
    }
    const savedId = useEditor.getState().id;
    const saved = savedId ? await getProject(savedId) : null;
    if (!saved) {
      toast.error("فُتح الأمر لكن تعذر التحقق من الحفظ.");
      return;
    }
    await setSetting("activeProjectId", saved.id);
    toast.success("المستند في المحرر ويمكن التراجع عنه.");
  };

  const remember = async (kind: "approved" | "rejected" | "correction") => {
    if (!delivery) return;
    if ((kind === "rejected" || kind === "correction") && reason.trim().length < 2) {
      toast.error("اكتب سبب الرفض أو التصحيح.");
      return;
    }
    const recorded = await recordDesignMemoryFn({
      data: {
        kind,
        category: delivery.plan.category,
        brief: prompt,
        reason: reason.trim(),
        recurring,
        ruleKey: "",
        ruleValue: "",
      },
    });
    if (!recorded.ok) {
      toast.error(recorded.message);
      return;
    }
    setMemory((rows) => [recorded.entry, ...rows].slice(0, 80));
    setReason("");
    toast.success(kind === "approved" ? "حُفظ الاعتماد في حسابك" : "حُفظت الملاحظة في حسابك");
  };

  const forget = async (id: string) => {
    const removed = await deleteDesignMemoryFn({ data: { id } });
    if (!removed.ok) {
      toast.error(removed.message);
      return;
    }
    setMemory((rows) => rows.filter((row) => row.id !== id));
  };

  return (
    <div className="grid gap-2">
      <p className="text-[10.5px] leading-5 text-muted">
        التوأم يقرأ الموجز، يطبّق دستور {delivery?.constitutionVersion ?? "2026.10.09"}، ثم ينشئ عناصر نَسَق قابلة للتعديل. المراجعة تتوقف بعد جولتين.
      </p>
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={4}
        maxLength={8000}
        placeholder="مثال: تقرير جاهزية من صفحتين للجمهور القيادي، بدون أرقام غير موثقة…"
        className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12px] font-semibold leading-5 text-ink"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={audience}
          onChange={(event) => setAudience(event.target.value)}
          placeholder="الجمهور"
          className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
        />
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as typeof format)}
          className="h-9 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-semibold text-ink"
        >
          {FORMATS.map((item) => (
            <option key={item.id || "auto"} value={item.id}>{item.label}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        disabled={busy || !prompt.trim()}
        onClick={() => void run()}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-navy px-3 text-[12px] font-extrabold text-on-brand disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
        نفّذ التصميم
      </button>
      {delivery && (
        <div className="grid gap-2 rounded-[8px] border border-line bg-surface-2/40 p-2">
          <p className="text-[10.5px] leading-5 text-ink">
            المصدر: {delivery.source === "gemini" ? "Gemini ثم محرك نَسَق" : "محرك نَسَق فقط — بدون نص من النموذج"}
            {" · "}
            {delivery.metrics.pages} صفحة · {delivery.metrics.elements} عنصر
            {" · "}
            مراجعة أولى: {delivery.metrics.firstPassIssues} ملاحظة
            {" · "}
            متبقٍ: {delivery.metrics.unresolved}
          </p>
          {delivery.providerMessage && (
            <p className="text-[10.5px] leading-5 text-muted">{delivery.providerMessage}</p>
          )}
          {delivery.unresolved.slice(0, 4).map((issue) => (
            <p key={`${issue.code}-${issue.elementId ?? issue.message}`} className="text-[10.5px] leading-5 text-muted">
              {issue.severity === "blocker" ? "عائق" : "ملاحظة"}: {issue.message}
            </p>
          ))}
          <button type="button" onClick={() => void open()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] border border-line bg-surface text-[12px] font-extrabold">
            <Check className="size-3.5" />
            فتح في المحرر
          </button>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="سبب الرفض أو التصحيح — اختياري عند الاعتماد"
            className="w-full resize-y rounded-[8px] border border-line bg-surface px-2.5 py-2 text-[12px] font-semibold text-ink"
          />
          <label className="flex items-center gap-2 text-[10.5px] font-bold text-muted">
            <input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} />
            قاعدة متكررة، لا ملاحظة لمرة واحدة
          </label>
          <div className="grid grid-cols-3 gap-1">
            <button type="button" className="h-8 rounded-[8px] border border-line text-[10px] font-extrabold" onClick={() => void remember("approved")}>اعتماد</button>
            <button type="button" className="h-8 rounded-[8px] border border-line text-[10px] font-extrabold" onClick={() => void remember("rejected")}>رفض</button>
            <button type="button" className="h-8 rounded-[8px] border border-line text-[10px] font-extrabold" onClick={() => void remember("correction")}>تصحيح</button>
          </div>
        </div>
      )}
      {memory.length > 0 && (
        <div className="grid gap-1">
          <p className="text-[10px] font-extrabold text-muted">ذاكرة هذا الحساب</p>
          {memory.slice(0, 6).map((row) => (
            <div key={row.id} className="flex items-start gap-2 text-[10px] leading-4 text-muted">
              <span className="min-w-0 flex-1">
                {row.recurring ? "متكرر" : "مرة"} · {row.kind}
                {row.reason ? ` — ${row.reason}` : ""}
              </span>
              <button type="button" aria-label="حذف الملاحظة" onClick={() => void forget(row.id)} className="grid size-6 shrink-0 place-items-center rounded-[6px] hover:bg-surface-2">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
