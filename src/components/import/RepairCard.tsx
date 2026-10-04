import { CheckCircle2, Loader2, RotateCcw, Undo2, Wrench } from "lucide-react";
import {
  repairBreakdown,
  type RepairCounts,
  type RepairFix,
} from "@/lib/editor/import/repair";
import { cn } from "@/lib/utils";
import { ghost, goldBtn } from "./buttons";

/**
 * «إصلاح العناصر» card — the review surface for the repair engine.
 *
 * Shows the compact summary («تم إصلاح 14 عنصرًا» + kind chips), the
 * per-element before→after geometry details, undo, and re-run. Never mutates
 * anything itself; all actions are delegated so the page owns which project
 * variant is current.
 */
export function RepairCard({
  repair,
  busy,
  problemsCount,
  isSavedDoc,
  trustOrigin,
  onTrustOriginChange,
  onRepair,
  onUndo,
  showFixes,
  onToggleFixes,
}: {
  repair: { counts: RepairCounts; fixes: RepairFix[] } | null;
  busy: boolean;
  problemsCount: number;
  isSavedDoc: boolean;
  trustOrigin: boolean;
  onTrustOriginChange: (value: boolean) => void;
  onRepair: () => void;
  onUndo: () => void;
  showFixes: boolean;
  onToggleFixes: () => void;
}) {
  const breakdown = repair ? repairBreakdown(repair.counts) : [];
  return (
    <section className="rounded-2xl border-2 border-gold/50 bg-gold/[0.06] p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-black text-ink">
        <Wrench className="size-4 text-gold" aria-hidden />
        إصلاح العناصر
      </h2>

      {isSavedDoc && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] font-bold leading-5 text-muted">
          <input
            type="checkbox"
            checked={trustOrigin}
            onChange={(event) => onTrustOriginChange(event.target.checked)}
            className="mt-0.5 size-3.5 accent-[#006c35]"
          />
          <span>
            استرجاع الهندسة الأصلية من زمن الاستيراد
            <span className="block text-[10px] font-semibold text-muted">
              أوقفه إذا كنت عدّلت مواضع العناصر بنفسك بعد الاستيراد وتريد إبقاء تعديلاتك.
            </span>
          </span>
        </label>
      )}

      {!repair && (
        <>
          <p className="mt-3 text-[12px] font-semibold leading-6 text-muted">
            {problemsCount > 0
              ? `وجد الفحص ${problemsCount} ملاحظة محتملة في هذا المستند. الإصلاح يعتمد على هندسة الملف الأصلي وأبعاد الصفحة، ولا يغيّر ما هو سليم.`
              : "الفحص لا يجد مشكلات — يمكنك تشغيل الإصلاح للتأكد، فهو لا يغيّر ما هو سليم."}
          </p>
          <button type="button" className={cn(goldBtn, "mt-3 w-full")} disabled={busy} onClick={onRepair}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" aria-hidden />}
            إصلاح العناصر
          </button>
        </>
      )}

      {repair && (
        <div className="mt-3 grid gap-3">
          {repair.counts.total > 0 ? (
            <>
              <p className="flex items-center gap-2 text-[14px] font-black text-success">
                <CheckCircle2 className="size-5" aria-hidden />
                تم إصلاح {repair.counts.total} عنصرًا
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {breakdown.map((row) => (
                  <li key={row.kind} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-extrabold text-ink">
                    <span className="tabular-nums">{row.count}</span> {row.label}
                  </li>
                ))}
              </ul>
              <button type="button" className={cn(ghost, "w-full justify-self-stretch")} onClick={onToggleFixes} aria-expanded={showFixes}>
                {showFixes ? "إخفاء التفاصيل" : "تفاصيل ما أُصلح"}
              </button>
              {showFixes && (
                <ul className="grid max-h-56 gap-1 overflow-auto rounded-lg bg-surface p-2">
                  {repair.fixes.map((fix, index) => (
                    <li key={`${fix.name}-${index}`} className="border-b border-line/60 py-1.5 text-[11px] font-semibold last:border-0">
                      <p className="font-extrabold text-ink">{fix.name}</p>
                      <p className="text-muted">{fix.reason}</p>
                      <p dir="ltr" className="mt-0.5 text-[10px] tabular-nums text-muted">
                        {fix.before.w}×{fix.before.h} @ {fix.before.x},{fix.before.y} → {fix.after.w}×{fix.after.h} @ {fix.after.x},{fix.after.y}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="flex items-center gap-2 text-[13px] font-black text-success">
              <CheckCircle2 className="size-5" aria-hidden />
              المستند سليم — لم يحتج أي إصلاح
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={ghost} onClick={onUndo} disabled={repair.counts.total === 0}>
              <Undo2 className="size-3.5" aria-hidden />
              تراجع عن الإصلاح
            </button>
            <button type="button" className={ghost} onClick={onRepair} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" aria-hidden />}
              إعادة الإصلاح
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
