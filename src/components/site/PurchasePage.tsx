import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, CreditCard, Key, ShieldCheck, Lock } from "lucide-react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getGumroadCheckoutLinksFn } from "@/lib/gumroad/functions";
import { CENTRAL_PLANS, FREE_PLAN, BILLING_PERIODS, planSavings, planKeyFor, type PlanPeriod, type PlanFamily, type PlanKey } from "@/lib/commercial/catalog";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { cardClass } from "@/components/site/cards";

const FAQS: { q: string; a: string }[] = [
  { q: "كيف تُفعَّل التراخيص؟", a: "بعد إتمام الدفع عبر Gumroad، يتحقق النظام من العملية خادميًا ثم يُنشئ ترخيصًا رقميًا عبر Keygen ويربطه بحسابك تلقائيًا بنفس بريد الشراء. تدير الترخيص من صفحة التراخيص." },
  { q: "ماذا لو لم أكن مسجلًا قبل الشراء؟", a: "لا مشكلة: أكمل الدفع عبر Gumroad بنفس البريد الذي ستسجّل به في نَسَق، وعند أول تسجيل دخول يُربط الاشتراك بحسابك تلقائيًا." },
  { q: "ما مدد الاشتراك المتاحة؟", a: "يتوفر اشتراك شهري (30 يومًا) وربع سنوي (90 يومًا) للفردي والفريق، بتجديد تلقائي يمكن إلغاء التجديد في أي وقت من حسابك في Gumroad. جميعها تراخيص رقمية فورية." },
  { q: "أين تُعالج ملفاتي؟", a: "المحرر يعمل بتخزين محلي أولًا: المشاريع والصور والهويات تُحفظ داخل المتصفح عبر IndexedDB. الاتصال مطلوب فقط للتحقق من الترخيص." },
  { q: "هل يمكنني العمل بدون اتصال؟", a: "نعم، بعد التفعيل تعمل أدوات التحرير والحفظ والتصدير محليًا حتى عند انقطاع الشبكة." },
  { q: "هل الخطة المجانية محدودة المدة؟", a: "لا، الخطة المجانية دائمة دون تاريخ انتهاء، مع قيود على المزايا المتقدمة." },
];

export function PurchasePage() {
  const [billing, setBilling] = useState<PlanPeriod>("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [checkoutLinks, setCheckoutLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    getGumroadCheckoutLinksFn()
      .then((links) => setCheckoutLinks(Object.fromEntries(links.map((link) => [link.planKey, link.url]))))
      .catch(() => setCheckoutLinks({}));
  }, []);
  const { user } = useCurrentUserState();

  /**
   * Gumroad is the primary checkout: each card deep-links straight to the
   * correct tier + recurrence payment form (monthly by default). The buyer
   * pays on Gumroad; access is bound server-side by the verified buyer email —
   * never by redirect params — and Keygen issues the license.
   */
  function gumroadUrlFor(planKey: PlanKey): string | null {
    return checkoutLinks[planKey] ?? null;
  }

  const families: PlanFamily[] = ["individual", "team"];
  // Gumroad يبيع شهري وربع سنوي فقط حاليًا؛ تبقى الباقات السنوية في الكتالوج
  // غير قابلة للشراء إلى حين إضافة Tier خاص بها (سلوك مطابق لقاعدة التوفر).
  const purchasablePeriods = BILLING_PERIODS.filter((option) => option.id !== "annual");

  return (
    <div className="min-h-full bg-white dark:bg-[#111722]">
      <SiteHeader current="/purchase" />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-12">
        {/* Header */}
        <div className="max-w-3xl">
          <p className="text-[11px] font-bold tracking-[0.14em] text-[#006C35]">النسخ والتراخيص</p>
          <h1 className="mt-2 text-[28px] font-extrabold leading-tight text-[#0F1E33] dark:text-white sm:text-[32px]">اختر الترخيص المناسب لاحتياج مؤسستك</h1>
          <p className="mt-3 text-[14px] leading-7 text-[#475467] dark:text-white/60">قارن الخطط أولًا، ثم اختر فترة الاشتراك وأكمل الدفع بأمان عبر Gumroad. جميع التراخيص رقمية وتُفعَّل فور التحقق من السداد خادميًا.</p>
        </div>

        {/* كيف تعمل التراخيص */}
        <div className="mt-6 rounded-[12px] border border-line/70 bg-[#fcfdfc] p-5 dark:border-white/10 dark:bg-white/[0.02]">
          <h2 className="text-[13px] font-bold text-[#0F1E33] dark:text-white">كيف تعمل تراخيص نَسَق</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div className="flex gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-[#0F1E33] text-[11px] font-bold text-white dark:bg-white dark:text-[#0F1E33]">1</span>
              <div>
                <p className="text-[13px] font-bold text-[#0F1E33] dark:text-white">اختيار الباقة</p>
                <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">حدد نوع الترخيص: فردي للأفراد أو فريق لإدارات الاتصال.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-[#0F1E33] text-[11px] font-bold text-white dark:bg-white dark:text-[#0F1E33]">2</span>
              <div>
                <p className="text-[13px] font-bold text-[#0F1E33] dark:text-white">تحديد المدة والسداد</p>
                <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">اختر الدفع شهريًا أو كل 3 أشهر، ثم أكمل السداد مباشرة في Gumroad Checkout.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-[#006C35] text-[11px] font-bold text-white">3</span>
              <div>
                <p className="text-[13px] font-bold text-[#0F1E33] dark:text-white">التفعيل الفوري</p>
                <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">يُصدر النظام ترخيصًا رقميًا عبر Keygen ويربطه بحسابك، وتُفتح المزايا فورًا.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Trust */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            [Lock, "دفع آمن عبر Gumroad"],
            [CreditCard, "تجديد تلقائي قابل للإلغاء"],
            [Key, "ترخيص رقمي وتفعيل فوري"],
            [ShieldCheck, "تخزين محلي أولًا"],
          ].map(([Icon, label]) => (
            <span key={String(label)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[#f8faf9] px-3 py-1 text-[11px] font-semibold text-[#344054] dark:border-white/10 dark:bg-white/5 dark:text-white/60">
              <Icon className="size-3.5 text-[#0F1E33]/60 dark:text-white/40" />
              {String(label)}
            </span>
          ))}
        </div>

        {/* Billing selector — شهري افتراضيًا */}
        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-[12px] font-bold text-[#0F1E33] dark:text-white">فترة الاشتراك — الافتراضي شهري</p>
            <div role="group" aria-label="فترة الاشتراك" className="inline-flex rounded-[10px] border border-line bg-white p-1 dark:border-white/10 dark:bg-white/5">
              {purchasablePeriods.map((option) => (
                <button key={option.id} type="button" onClick={() => setBilling(option.id)} aria-pressed={billing === option.id} className={`rounded-[8px] px-4 py-2 text-[13px] font-bold transition ${billing === option.id ? "bg-[#0F1E33] text-white shadow-sm ring-1 ring-[#0F1E33] dark:bg-white dark:text-[#0F1E33] dark:ring-white/60" : "text-[#667085] hover:bg-[#f8faf9] hover:text-[#0F1E33] dark:text-white/50 dark:hover:bg-white/5"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-w-md text-[12px] leading-6 text-[#475467] dark:text-white/60">
            {user ? (
              <p>سيُربط الاشتراك تلقائيًا بحسابك الحالي (<span className="font-bold" dir="ltr">{user.primaryEmail}</span>). للشراء لحساب آخر استخدم بريد ذاك الحساب على Gumroad.</p>
            ) : (
              <p>أكمل الدفع عبر Gumroad بنفس البريد الذي ستسجّل به في نَسَق، وسيُربط الاشتراك بحسابك تلقائيًا عند أول تسجيل دخول — لا حاجة للتسجيل قبل الشراء.</p>
            )}
          </div>
        </div>

        {/* Cards — متوازنة */}
        <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-3">
          {/* Free — deliberately quieter than the paid cards: muted tinted
              surface, no lift, small badge; reads free at a glance. */}
          <div className="flex flex-col rounded-xl border border-line/70 bg-[#f8faf9] p-5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[15px] font-bold text-[#0F1E33] dark:text-white">مجاني</h2>
                <span className="shrink-0 rounded-full border border-line/70 bg-white px-2.5 py-1 text-[10px] font-bold text-[#667085] dark:border-white/15 dark:bg-white/5 dark:text-white/60">مجانية دائمًا</span>
              </div>
              <p className="mt-2 text-[12px] leading-6 text-[#667085] dark:text-white/50">خطة مجانية دائمة للتقييم والبدء، دون دفع أو تاريخ انتهاء.</p>
              <p className="mt-4 text-[24px] font-extrabold text-[#0F1E33] dark:text-white">0 <span className="text-[13px] font-bold text-[#667085]">ر.س</span></p>
              <p className="text-[11px] text-[#98a2b3]">المدة: دائمة</p>
              <div className="mt-4 border-t border-line/60 pt-3.5 dark:border-white/10">
                <ul className="grid gap-1.5">
                  {FREE_PLAN.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12px] leading-5 text-[#344054] dark:text-white/60">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#98a2b3]" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <a href="/editor" className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-[10px] border border-line bg-white text-[13px] font-bold text-[#0F1E33] hover:bg-[#f8faf9] dark:border-white/15 dark:bg-white/5 dark:text-white">ابدأ مجانًا</a>
          </div>

          {families.map((family) => {
            const planKey = planKeyFor(family, billing);
            const plan = CENTRAL_PLANS[planKey];
            const isTeam = family === "team";
            return (
              <div key={planKey} className={cardClass(`flex flex-col p-5 ${isTeam ? "border-[#006C35]/30 shadow-sm" : ""}`)}>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-[15px] font-bold text-[#0F1E33] dark:text-white">{isTeam ? "نَسَق | فريق" : "نَسَق | فردي"}</h2>
                      <p className="mt-1 text-[12px] leading-5 text-[#667085] dark:text-white/50">{plan.description}</p>
                    </div>
                    {plan.popular && <span className="shrink-0 rounded-full bg-[#0F1E33] px-2.5 py-1 text-[10px] font-bold text-white dark:bg-white dark:text-[#0F1E33]">الأكثر طلبًا</span>}
                  </div>
                  <p className="mt-4 text-[24px] font-extrabold text-[#0F1E33] dark:text-white">{plan.amount.toLocaleString("en-US")} <span className="text-[13px] font-bold text-[#667085]">ر.س</span> <span className="text-[12px] font-bold text-[#667085]">/ {billing === "quarterly" ? "كل 3 أشهر" : billing === "annual" ? "سنوي" : "شهري"}</span></p>
                  <p className="text-[11px] text-[#98a2b3]">مدة الترخيص {plan.durationDays} يومًا · {billing === "monthly" ? "تجديد شهري" : billing === "quarterly" ? "تجديد كل 3 أشهر" : "تجديد سنوي"}</p>
                  {billing !== "monthly" && <p className="mt-1 text-[11px] font-semibold text-[#006C35]">وفّر {planSavings(plan)} ر.س مقارنة بالشهري</p>}
                  <div className="mt-4 border-t border-line/60 pt-3.5 dark:border-white/10">
                    <p className="text-[11px] font-bold text-[#0F1E33] dark:text-white/70">المزايا المشمولة:</p>
                    <ul className="mt-2.5 grid gap-1.5">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[12px] leading-5 text-[#344054] dark:text-white/70">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#006C35]" /> {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-5">
                  {gumroadUrlFor(planKey) ? (
                    <a href={gumroadUrlFor(planKey)!} target="_blank" rel="noreferrer noopener" className={`inline-flex h-9 w-full items-center justify-center rounded-[10px] text-[13px] font-bold text-white transition ${isTeam ? "bg-[#006C35] hover:bg-[#00542a]" : "bg-[#0F1E33] hover:bg-black dark:bg-white dark:text-[#0F1E33]"}`}>
                      اشترك الآن
                    </a>
                  ) : (
                    <span aria-disabled="true" className="inline-flex h-9 w-full cursor-not-allowed items-center justify-center rounded-[10px] bg-[#0F1E33]/40 text-[13px] font-bold text-white/70 dark:bg-white/20">
                      جارٍ تجهيز بوابة الدفع…
                    </span>
                  )}
                  <p className="mt-2 text-center text-[11px] text-[#98a2b3]">ترخيص رقمي فوري · دفع آمن عبر Gumroad</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* FAQ */}
        <section className="mt-10 border-t border-line/60 pt-8 dark:border-white/10">
          <h2 className="text-[18px] font-bold text-[#0F1E33] dark:text-white">الأسئلة الشائعة</h2>
          <div className="mt-5 grid gap-2">
            {FAQS.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div key={faq.q} className="overflow-hidden rounded-[10px] border border-line/70 bg-white dark:border-white/10 dark:bg-white/[0.03]">
                  <button type="button" onClick={() => setOpenFaq(open ? null : i)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right text-[13px] font-bold text-[#0F1E33] dark:text-white">
                    {faq.q}
                    <ChevronDown className={`size-4 text-[#98a2b3] transition ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && <p className="border-t border-line/60 px-4 py-3 text-[13px] leading-7 text-[#475467] dark:border-white/10 dark:text-white/60">{faq.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-line/60 bg-[#f8faf9] p-4 dark:border-white/10 dark:bg-white/[0.02]">
          <div>
            <h3 className="text-[13px] font-bold text-[#0F1E33] dark:text-white">لديك مفتاح ترخيص بالفعل؟</h3>
            <p className="mt-1 text-[12px] text-[#667085] dark:text-white/50">انتقل إلى صفحة التراخيص لتفعيل المفتاح.</p>
          </div>
          <a href="/license" className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line bg-white px-4 text-[12px] font-bold text-[#0F1E33] hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white">
            <Key className="size-3.5" /> إدارة الترخيص
          </a>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
