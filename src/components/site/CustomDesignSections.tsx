import {
  ArrowLeft,
  BadgeCheck,
  Brush,
  Clock3,
  ImagePlus,
  Layers,
  Megaphone,
  Palette,
  PenTool,
  ShieldCheck,
} from "lucide-react";
import { BRAND, CUSTOM_DESIGN } from "@/lib/brand";
import { BrandMark } from "./BrandMark";

/*
 * «طلب تصميم خاص» — a SERVICE of NASAQ, never the editor.
 *
 * The distinction this file exists to make visible: creating a design yourself
 * happens in the editor («إنشاء تصميم»), while this page is how a customer asks
 * the NASAQ team to design something for them. Both are legitimate; confusing
 * them was the problem. Every block here says which one it is, and the primary
 * action is the platform's own request form.
 */

const SCOPE_ICONS = [Layers, Palette, Megaphone, Brush] as const;

/**
 * The brand area.
 *
 * A deliberate frame with two marks: NASAQ's own (the service provider, always
 * present) and the empty slot for the requesting entity's logo (filled after
 * the request is accepted). Nothing pretends the customer's logo already
 * exists — an empty, well-designed slot is the honest presentation, and it is
 * also what makes the purpose of the area obvious at a glance.
 */
export function CustomDesignBrandArea() {
  return (
    <section
      aria-label={CUSTOM_DESIGN.logoSlotLabel}
      className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line/70 bg-surface-2 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-[12px] font-extrabold text-ink">
          <PenTool className="size-4 text-brand" aria-hidden />
          {CUSTOM_DESIGN.eyebrow}
        </span>
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-[11px] font-extrabold text-brand">
          خدمة نَسَق
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
          {/* The provider's mark — who is doing the design. */}
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
            <BrandMark className="size-10" />
            <span className="min-w-0">
              <strong className="block text-[13px] font-extrabold text-ink">
                {BRAND.team}
              </strong>
              <span className="mt-0.5 block text-[11.5px] text-muted">
                مصممو {BRAND.platform} — ينفّذون الطلب
              </span>
            </span>
          </div>

          <span
            aria-hidden
            className="mx-auto grid size-8 place-items-center rounded-full border border-line bg-surface text-muted"
          >
            <ArrowLeft className="size-4" />
          </span>

          {/* The customer's slot — what the design will carry. */}
          <div className="grid place-items-center gap-1.5 rounded-xl border border-dashed border-line bg-line-2/40 p-3 text-center">
            <span className="grid size-9 place-items-center rounded-lg border border-line bg-surface">
              <ImagePlus className="size-4 text-muted" aria-hidden />
            </span>
            <strong className="text-[12.5px] font-extrabold text-ink">
              {CUSTOM_DESIGN.logoSlotLabel}
            </strong>
            <span className="max-w-[220px] text-[11px] leading-5 text-muted">
              {CUSTOM_DESIGN.logoSlotHint}
            </span>
          </div>
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-[11.5px] leading-6 text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
          {CUSTOM_DESIGN.serviceNote}
        </p>
      </div>
    </section>
  );
}

/** What a custom request covers — the service's real scope. */
export function CustomDesignScopes() {
  return (
    <ul className="mt-5 grid gap-3 sm:grid-cols-2">
      {CUSTOM_DESIGN.scopes.map((scope, i) => {
        const Icon = SCOPE_ICONS[i % SCOPE_ICONS.length];
        return (
          <li
            key={scope.id}
            className="group flex h-full items-start gap-3 rounded-xl border border-line bg-paper/60 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:bg-navy/[0.035] hover:shadow-[0_8px_24px_-18px_rgba(0,108,53,0.55)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-navy/10 text-brand transition-colors group-hover:bg-navy-2/15">
              <Icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <strong className="block text-[13px] font-extrabold">{scope.label}</strong>
              <span className="mt-1 block text-[12px] leading-6 text-muted">{scope.hint}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** How the service runs, as three numbered steps a customer can trust. */
export function CustomDesignSteps() {
  return (
    <ol className="mt-5 grid gap-3">
      {CUSTOM_DESIGN.steps.map((step, index) => (
        <li key={step.id} className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-full bg-navy text-[12.5px] font-extrabold text-on-brand"
          >
            {index + 1}
          </span>
          <span>
            <strong className="block text-[13px] font-extrabold text-ink">{step.label}</strong>
            <span className="mt-0.5 block text-[12px] leading-6 text-muted">{step.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The answer-window promise, stated where the customer decides. */
export function CustomDesignTurnaround() {
  return (
    <p className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12px] font-bold text-ink">
      <Clock3 className="size-4 shrink-0 text-brand" aria-hidden />
      {CUSTOM_DESIGN.turnaround}
    </p>
  );
}

/** A reassurance line for the request form block. */
export function CustomDesignAssurance() {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-6 text-muted">
      <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
      يُسجَّل الطلب داخل المنصة ويحصل على رقم متابعة، ويظهر لحسابك في «طلباتي» إن كنت مسجّلًا.
    </p>
  );
}
