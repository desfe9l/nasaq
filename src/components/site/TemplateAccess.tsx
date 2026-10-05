/*
 * «هل هذا القالب مجاني أم مرخّص؟» — answered the same way everywhere.
 *
 * A paid template must never be a lock with no price on it. Wherever a licensed
 * template appears, the reader gets three facts in one place: what it needs
 * (a licence), what that costs (from `PREMIUM_FROM_SAR`), and how to get it —
 * a direct door to the plan ladder, plus the sales conversation for an annual
 * or institutional arrangement. Nothing here reveals payment processors,
 * checkout providers or licence-key mechanics; those stay server-side.
 *
 * One component, two densities: `compact` is the chip that rides on a card,
 * the default is the bordered note that belongs on a detail page or a
 * quick-view dialog.
 */

import { BadgeCheck, ArrowUpRight, Building2 } from "lucide-react";
import { CENTRAL_PLANS } from "@/lib/commercial/catalog";
import { PURCHASE_ROUTE } from "@/lib/site-routes";
import { cn } from "@/lib/utils";

/**
 * The lowest monthly price of any plan that unlocks premium templates.
 *
 * Read from the catalogue rather than typed into copy, so a price change is one
 * edit in `catalog.ts` and every surface follows.
 */
export const PREMIUM_FROM_SAR = CENTRAL_PLANS["individual-monthly"].amount;

/** «نَسَق | فردي» — the plan family an individual licence belongs to. */
export const PREMIUM_PLAN_LABEL = "نَسَق | فردي";

/** Plain sentence for aria/title attributes and one-line contexts. */
export function premiumRequirementText(): string {
  return `يتطلب ترخيصًا — ${PREMIUM_PLAN_LABEL} من ${PREMIUM_FROM_SAR} ر.س شهريًا`;
}

export function PremiumAccessNote({
  compact = false,
  className,
  /** Hide the second door where the surrounding layout already offers contact. */
  hideSales = false,
  /** The full-page detail surfaces get the larger heading. */
  prominent = false,
}: {
  compact?: boolean;
  className?: string;
  hideSales?: boolean;
  prominent?: boolean;
}) {
  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-gold/60 bg-gold/15 px-2.5 py-1 text-[10.5px] font-extrabold text-ink",
          className,
        )}
        title={premiumRequirementText()}
      >
        <BadgeCheck className="size-3.5 shrink-0 text-gold" aria-hidden />
        يتطلب ترخيصًا · من {PREMIUM_FROM_SAR} ر.س شهريًا
      </span>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[14px] border border-gold/50 bg-gold/10 p-4",
        className,
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 font-extrabold text-ink",
          prominent ? "text-[15px]" : "text-[13.5px]",
        )}
      >
        <BadgeCheck className="size-4 shrink-0 text-gold" aria-hidden />
        قالب ضمن القوالب المتميزة
      </p>
      <p className="mt-1.5 text-[12.5px] leading-6 text-muted">
        {premiumRequirementText()} — ويفتح الترخيص كذلك كل القوالب المتميزة الأخرى
        والتصدير الكامل. لتراخيص الجهات والاشتراك السنوي: تواصل مع المبيعات.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`${PURCHASE_ROUTE}#plans`}
          className="inline-flex h-9.5 min-h-9 items-center gap-1.5 rounded-[10px] bg-navy px-4 text-[12.5px] font-extrabold text-on-brand transition hover:bg-ok"
        >
          احصل على الترخيص
          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
        </a>
        {!hideSales && (
          <a
            href="/contact"
            className="inline-flex h-9.5 min-h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-extrabold text-ink transition hover:border-brand"
          >
            <Building2 className="size-3.5 shrink-0" aria-hidden />
            تواصل مع المبيعات
          </a>
        )}
      </div>
    </div>
  );
}
