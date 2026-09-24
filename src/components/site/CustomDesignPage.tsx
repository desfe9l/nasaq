import { useEffect } from "react";
import { BadgeCheck, Clock3, Crown } from "lucide-react";
import { BRAND, CUSTOM_DESIGN } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { CustomDesignScopes, CustomDesignLogoSlot } from "./CustomDesignSections";

import { CustomDesignActions } from "./CustomDesignSections";

export function CustomDesignPage() {
  const hydrate = useEditor((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/custom-design" />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        <header className="max-w-3xl border-b border-line/70 pb-8 dark:border-white/10">
          <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">
            {BRAND.administration}
          </p>
          <h1 className="mt-3 text-[30px] font-extrabold sm:text-[34px]">
            {CUSTOM_DESIGN.title}
          </h1>
          <p className="mt-3 text-[15px] leading-8 text-muted">{CUSTOM_DESIGN.subtitle}</p>
        </header>

        <section className="mt-8 rounded-2xl border border-line bg-white p-5 shadow-[0_18px_45px_-38px_rgba(0,108,53,0.45)] sm:p-7 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.12em] text-muted">
                نطاق العمل
              </p>
              <h2 className="mt-2 flex items-center gap-2 text-[19px] font-extrabold">
                <Crown className="size-5 text-navy-2 dark:text-gold-2" aria-hidden />
                ماذا يشمل الطلب الخاص؟
              </h2>
            </div>
            <span className="rounded-full bg-navy/[0.08] px-3 py-1.5 text-[11px] font-extrabold text-navy-2 dark:bg-white/10 dark:text-gold-2">
              اختر التفاصيل ثم تواصل معنا
            </span>
          </div>
          <CustomDesignScopes />
        </section>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.05fr_.95fr]">
          <CustomDesignLogoSlot />
          <section className="rounded-2xl border border-line bg-white p-5 shadow-[0_18px_45px_-38px_rgba(0,108,53,0.45)] sm:p-6 dark:border-white/10 dark:bg-white/5">
            <div className="rounded-xl border border-emerald-600/25 bg-emerald-600/[0.07] p-4 sm:p-5">
              <p className="flex items-center gap-2 text-[14px] font-extrabold text-emerald-800 dark:text-emerald-300">
                <Clock3 className="size-4.5" aria-hidden />
                {CUSTOM_DESIGN.channelPlaceholder}
              </p>
              <p className="mt-2 text-[12px] leading-6 text-muted">
                {CUSTOM_DESIGN.channelHint}
              </p>
            </div>
            <div className="mt-5">
              <CustomDesignActions />
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-6 text-muted">
              <BadgeCheck className="mt-1 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {CUSTOM_DESIGN.turnaround}
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
