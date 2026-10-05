import { useEffect } from "react";
import { ArrowLeft, BadgeCheck, PenTool } from "lucide-react";
import { BRAND, CUSTOM_DESIGN } from "@/lib/brand";
import { useEditor } from "@/lib/editor/store";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { ClientRequestForm } from "./ClientRequestPanel";
import {
  CustomDesignAssurance,
  CustomDesignBrandArea,
  CustomDesignScopes,
  CustomDesignSteps,
  CustomDesignTurnaround,
} from "./CustomDesignSections";

/**
 * «طلب تصميم خاص» — a NASAQ service page, not the editor.
 *
 * What changed and why: the page used to read like a design surface and left the
 * visitor to guess whether it was the editor. It now states, in the first
 * paragraph, that the NASAQ team performs this work, keeps the editor's own door
 * one click away for people who wanted to design themselves, presents the
 * service's real scope and steps, and carries the platform's native request form
 * — so a request is submitted and tracked inside NASAQ instead of depending on a
 * displayed phone number.
 */
export function CustomDesignPage() {
  const hydrate = useEditor((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-full bg-paper">
      <SiteHeader current="/custom-design" />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        <header className="max-w-3xl border-b border-line/70 pb-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-[11.5px] font-extrabold text-brand">
            <PenTool className="size-3.5" aria-hidden />
            {CUSTOM_DESIGN.eyebrow}
          </p>
          <h1 className="mt-4 text-[30px] font-black leading-tight text-ink sm:text-[36px]">
            {CUSTOM_DESIGN.title}
          </h1>
          <p className="mt-3 text-[15px] leading-8 text-muted">{CUSTOM_DESIGN.subtitle}</p>
          {/* The editor's own door, named so the two are never confused. */}
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {CUSTOM_DESIGN.editorNote}
            <a
              href="/create"
              className="inline-flex items-center gap-1 font-extrabold text-brand-hover underline underline-offset-4"
            >
              {CUSTOM_DESIGN.editorCta}
              <ArrowLeft className="size-3.5" aria-hidden />
            </a>
          </p>
        </header>

        {/* The brand area: who designs, and whose identity it carries. */}
        <div className="mt-8">
          <CustomDesignBrandArea />
        </div>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold tracking-[0.12em] text-muted">
                نطاق العمل
              </p>
              <h2 className="mt-2 flex items-center gap-2 text-[20px] font-extrabold text-ink">
                ماذا يشمل الطلب الخاص؟
              </h2>
            </div>
            <span className="rounded-full bg-navy/[0.08] px-3 py-1.5 text-[11px] font-extrabold text-brand-hover">
              اختر النطاق ثم أرسل الطلب
            </span>
          </div>
          <CustomDesignScopes />
        </section>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.15fr_.85fr]">
          {/* The request itself — the platform's own, stored and tracked. */}
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
            <h2 className="text-[20px] font-extrabold text-ink">أرسل الطلب من داخل المنصة</h2>
            <p className="mt-2 text-[13px] leading-7 text-muted">
              اكتب التفاصيل هنا ويصل الطلب مباشرة إلى إدارة نَسَق مع رقم متابعة، دون الحاجة إلى
              مغادرة الموقع أو إرسال رسالة خارجية.
            </p>
            <div className="mt-5">
              <ClientRequestForm
                source="custom-design"
                defaultKind="design"
                serviceLabel="طلب تصميم خاص"
              />
            </div>
            <CustomDesignAssurance />
          </section>

          <aside className="grid gap-5">
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
              <h2 className="flex items-center gap-2 text-[16px] font-extrabold text-ink">
                <BadgeCheck className="size-4.5 text-brand" aria-hidden />
                كيف تعمل الخدمة؟
              </h2>
              <CustomDesignSteps />
              <CustomDesignTurnaround />
            </section>

            <section className="rounded-2xl border border-brand/25 bg-navy/[0.06] p-5 sm:p-6">
              <h2 className="text-[15px] font-extrabold text-ink">
                {CUSTOM_DESIGN.channelPlaceholder}
              </h2>
              <p className="mt-2 text-[12.5px] leading-7 text-muted">
                {CUSTOM_DESIGN.channelHint}
              </p>
              <p className="mt-3 text-[12px] font-bold text-ink">
                {BRAND.team} — {BRAND.platform}
              </p>
              <p className="mt-1 text-[11.5px] text-muted">
                أرقام التواصل الرسمية وبيانات الرد تظهر في نموذج الطلب وفي صفحة التواصل.
              </p>
              <a
                href="/contact"
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-[12.5px] font-bold text-ink transition hover:border-brand"
              >
                صفحة التواصل و القنوات المباشرة
              </a>
            </section>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
