import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudCog, PlayCircle, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { verifyObjectStorage } from "@/lib/storage/functions";
import {
  storageVerifyView,
  type StorageVerifyResultInput,
} from "@/lib/storage/verify-report";
import { cn } from "@/lib/utils";

/**
 * Owner vault card: Cloudflare R2 · التخزين السحابي.
 *
 * Runs the admin-gated `verifyObjectStorage` server function INSIDE the
 * deployment that serves traffic — the same process, the same env the editor's
 * storage calls see. The check is production-safe by design: one object under
 * the caller's OWN user prefix plus one metadata row, both removed in the same
 * call, and the report carries statuses and variable NAMES only — never a
 * credential, an endpoint value, an account id or an object key. This card
 * renders that report and nothing else.
 */
export function StorageVerificationCard({ visible }: { visible: boolean }) {
  const [result, setResult] = useState<StorageVerifyResultInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await verifyObjectStorage();
      setResult(next);
      const view = storageVerifyView(next);
      if (view.state === "ready") toast.success("فحص التخزين: الدورة الكاملة نجحت داخل هذا النشر.");
      else if (view.state === "not_configured" && view.missingVariables.length)
        toast.error(`التخزين غير مهيأ — ينقص: ${view.missingVariables.join("، ")}`);
      else toast.error("فحص التخزين: فشل — راجع الخطوات أدناه.");
    } catch {
      setError("تعذر تشغيل الفحص (تحقق من تسجيل الدخول بحساب MASTER OWNER).");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, []);

  if (!visible) return null;

  const view = result ? storageVerifyView(result) : null;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]"
      aria-label="Cloudflare R2 التخزين السحابي"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-sky-300/30 bg-sky-300/10 text-sky-200">
            <CloudCog className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-black text-white">Cloudflare R2 · التخزين السحابي</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              فحص حقيقي داخل هذا النشر: رفع ← قراءة برابط موقّع ← قراءة مباشرة ← حذف
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-[11px] font-black text-slate-200 hover:border-sky-300/50 disabled:opacity-50"
          >
            {busy ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <PlayCircle className="size-3.5" />
            )}
            {result ? "إعادة الفحص" : "تشغيل الفحص"}
          </button>
        </div>
      </header>

      {error && (
        <p className="border-b border-white/10 bg-red-500/10 p-3 text-xs font-bold text-red-200">
          {error}
        </p>
      )}

      {!view ? (
        <p className="p-6 text-center text-xs text-slate-500">
          {busy ? "جارٍ تشغيل الفحص داخل النشر…" : "لم يُشغّل الفحص بعد."}
        </p>
      ) : (
        <div className="grid gap-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black",
                view.state === "ready"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                  : view.state === "failed"
                    ? "border-red-400/30 bg-red-400/10 text-red-200"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-200",
              )}
            >
              {view.state === "ready" ? (
                <CheckCircle2 className="size-3.5" />
              ) : view.state === "failed" ? (
                <XCircle className="size-3.5" />
              ) : (
                <AlertTriangle className="size-3.5" />
              )}
              {view.state === "ready" ? "التخزين يعمل" : view.state === "failed" ? "فحص فاشل" : "غير مهيأ"}
            </span>
            <p className="text-xs font-bold leading-6 text-slate-300">{view.headline}</p>
          </div>

          {view.summary.length > 0 && (
            <div className="grid gap-2 text-[11px] sm:grid-cols-3">
              {view.summary.map((chip) => (
                <div key={chip.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <span className="text-[10px] font-black tracking-wide text-slate-500">{chip.label}</span>
                  <p className="mt-1 font-bold leading-5 text-slate-300">{chip.value}</p>
                </div>
              ))}
            </div>
          )}

          {view.missingVariables.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[11px] leading-6 text-amber-200">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                متغيرات غير موجودة في هذا الـ runtime:{" "}
                <code className="font-mono" dir="ltr">
                  {view.missingVariables.join("، ")}
                </code>{" "}
                — تُضاف في Vercel (Production) ثم يُعاد النشر. أسماء فقط؛ لا قيم أبدًا.
              </span>
            </p>
          )}

          {view.rows.length > 0 && (
            <ol className="grid gap-1.5">
              {view.rows.map((row) => (
                <li
                  key={`${row.key}-${row.label}`}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5",
                    row.ok
                      ? "border-emerald-400/20 bg-emerald-400/[0.06]"
                      : "border-red-400/25 bg-red-400/[0.06]",
                  )}
                >
                  <span className="flex min-w-0 items-start gap-2">
                    {row.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-300" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-slate-200">{row.label}</span>
                      {row.detail && (
                        <span className="mt-0.5 block break-words font-mono text-[10px] leading-5 text-slate-400" dir="ltr">
                          {row.detail}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
