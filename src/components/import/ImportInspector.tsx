/**
 * Smart import inspector — a compact, product-facing readout of what the
 * import produced: composition numbers, fonts, and the problems the repair
 * engine can see. Deliberately NOT a debug console: no ids, no providers,
 * no paths — only what an author needs to trust the document.
 */

import { AlertTriangle, CheckCircle2, CircleAlert, Layers, Type } from "lucide-react";
import type { ImportInspection } from "@/lib/editor/import/inspect";
import { cn } from "@/lib/utils";

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-center">
      <p className="text-[16px] font-black leading-tight tabular-nums text-ink">{value}</p>
      <p className="mt-0.5 text-[10px] font-bold text-muted">{label}</p>
    </div>
  );
}

export function ImportInspector({
  inspection,
  className,
}: {
  inspection: ImportInspection;
  className?: string;
}) {
  const problems = inspection.problems;
  return (
    <div className={cn("grid gap-4", className)}>
      <dl className="grid grid-cols-4 gap-2">
        <Stat label="صفحات" value={inspection.pages.length} />
        <Stat label="عناصر" value={inspection.elements} />
        <Stat label="نصوص" value={inspection.texts} />
        <Stat label="صور" value={inspection.images} />
        <Stat label="أشكال" value={inspection.shapes} />
        <Stat label="مجموعات" value={inspection.groups} />
        <Stat label="جداول" value={inspection.tables} />
        <Stat label="خطوط" value={inspection.fonts.length} />
      </dl>

      <div className="grid gap-1.5 text-[11px] font-bold text-muted">
        {inspection.pages.map((page, index) => (
          <p key={page.name} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <span className="truncate text-ink">
              {index === 0 ? <Layers className="me-1 inline size-3.5 text-brand" aria-hidden /> : null}
              {page.name}
            </span>
            <span dir="ltr" className="shrink-0 tabular-nums">
              {Math.round(page.w)}×{Math.round(page.h)} مم
            </span>
          </p>
        ))}
        {inspection.fonts.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <Type className="size-3.5 text-brand" aria-hidden />
            {inspection.fonts.map((font) => (
              <span key={font.family} className="rounded-full bg-paper px-2 py-0.5 text-[10px] font-extrabold text-ink">
                {font.family}
              </span>
            ))}
          </p>
        )}
      </div>

      {problems.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-[12px] font-extrabold text-success">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          لا مشكلات محتملة — العناصر في مواضعها الصحيحة
        </p>
      ) : (
        <div className="grid gap-1.5">
          <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-warning">
            <AlertTriangle className="size-4" aria-hidden />
            مشكلات محتملة ({problems.length})
          </p>
          <ul className="grid max-h-44 gap-1 overflow-auto pe-1">
            {problems.slice(0, 40).map((problem, index) => (
              <li
                key={`${problem.name}-${index}`}
                className="flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold leading-5"
              >
                <CircleAlert
                  className={cn("mt-0.5 size-3.5 shrink-0", problem.severity === "error" ? "text-danger" : "text-warning")}
                  aria-hidden
                />
                <span>
                  <span className="font-extrabold text-ink">{problem.name}</span>
                  <span className="text-muted"> — {problem.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
