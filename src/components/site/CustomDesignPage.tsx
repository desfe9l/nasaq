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
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">
          {BRAND.administration}
        </p>
        <h1 className="mt-3 text-[30px] font-extrabold">{CUSTOM_DESIGN.title}</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-8 text-muted">
          {CUSTOM_DESIGN.subtitle}
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_.9fr]">
          <CustomDesignLogoSlot />
          <section className="rounded-2xl border border-line bg-white p-6 dark:border-white/10 dark:bg-white/5">
            <h2 className="flex items-center gap-2 text-[17px] font-extrabold">
              <Crown className="size-5 text-navy-2 dark:text-gold-2" aria-hidden />
              ماذا يشمل الطلب الخاص؟
            </h2>
            <CustomDesignScopes />
            <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="flex items-center gap-2 text-[13px] font-extrabold text-amber-700 dark:text-amber-300">
                <Clock3 className="size-4" aria-hidden />
                {CUSTOM_DESIGN.channelPlaceholder}
              </p>
              <p className="mt-1.5 text-[12px] leading-6 text-muted">
                {CUSTOM_DESIGN.channelHint}
              </p>
            </div>
            <CustomDesignActions />
            <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted">
              <BadgeCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {CUSTOM_DESIGN.turnaround}
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
