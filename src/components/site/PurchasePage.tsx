import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ClipboardCheck, CreditCard, Download, Key, MessageCircle, ShieldCheck, Lock } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { createPaylinkCheckout, getCheckoutAvailability } from "@/lib/commercial/functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { CENTRAL_PLANS, FREE_PLAN, BILLING_PERIODS, planSavings, paylinkPlanKey, type PaylinkPeriod, type PaylinkPlanFamily, type PaylinkPlanKey } from "@/lib/commercial/catalog";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { cardClass } from "@/components/site/cards";
import { useSiteSettings, whatsappLink } from "@/lib/admin/use-site-settings";

const FAQS: { q: string; a: string }[] = [
  { q: "كيف تُفعَّل التراخيص؟", a: "بعد إتمام الدفع عبر Paylink، يُنشئ النظام ترخيصًا رقميًا عبر Keygen ويربطه بحسابك تلقائيًا. يصلك كود الترخيص ويمكنك إدارته من صفحة التراخيص." },
  { q: "ما مدد الاشتراك المتاحة؟", a: "تتوفر ثلاث مدد: شهري 30 يومًا، ربع سنوي 90 يومًا بسعر مخفض، وسنوي 365 يومًا. جميعها تراخيص رقمية فورية." },
  { q: "أين تُعالج ملفاتي؟", a: "المحرر يعمل بتخزين محلي أولًا: المشاريع والصور والهويات تُحفظ داخل المتصفح عبر IndexedDB. الاتصال مطلوب فقط للتحقق من الترخيص." },
  { q: "هل يمكنني العمل بدون اتصال؟", a: "نعم، بعد التفعيل تعمل أدوات التحرير والحفظ والتصدير محليًا حتى عند انقطاع الشبكة." },
  { q: "هل الخطة المجانية محدودة المدة؟", a: "لا، الخطة المجانية دائمة دون تاريخ انتهاء، مع قيود على المزايا المتقدمة." },
];

export function PurchasePage() {
  const [billing, setBilling] = useState<PaylinkPeriod>("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [mobile, setMobile] = useState("");
  const [busyPlan, setBusyPlan] = useState<PaylinkPlanKey | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  useEffect(() => {
    getCheckoutAvailability().then(setAvailability).catch(() => setAvailability({}));
  }, []);
  const { user } = useCurrentUserState();
  const { commercial } = useSiteSettings();

  const whatsapp = whatsappLink(commercial.whatsappNumber, commercial.whatsappEnterpriseMessage);

  async function startPaylink(planKey: PaylinkPlanKey) {
    if (!availability[planKey]) {
      setCheckoutError("خدمة الدفع غير متاحة حاليًا، يرجى التواصل عبر الواتساب.");
      return;
    }
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const cleanMobile = mobile.replace(/\D/g, "");
    if (cleanMobile.length < 8 || cleanMobile.length > 20) {
      setCheckoutError("يرجى إدخال رقم جوال صحيح لإصدار الفاتورة، مثال: 05xxxxxxxx");
      return;
    }
    setCheckoutError(null);
    setBusyPlan(planKey);
    try {
      const result = await createPaylinkCheckout({ data: { planKey, clientMobile: cleanMobile } });
      if (!result.ok) {
        setCheckoutError(result.error);
        return;
      }
      window.location.assign(result.paymentUrl);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "تعذر بدء عملية الدفع.");
    } finally {
      setBusyPlan(null);
    }
  }

  const families: PaylinkPlanFamily[] = ["individual", "team"];

  return (
    <div className="min-h-full bg-white dark:bg-[#111722]">
      <SiteHeader current="/purchase" />
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-12">
        {/* Header */}
        <div className="max-w-3xl">
          <p className="text-[11px] font-bold tracking-[0.14em] text-[#006C35]">النسخ والتراخيص</p>
          <h1 className="mt-2 text-[28px] font-extrabold leading-tight text-[#0F1E33] dark:text-white sm:text-[32px]">اختر الترخيص المناسب لاحتياج مؤسستك</h1>
          <p className="mt-3 text-[14px] leading-7 text-[#475467] dark:text-white/60">قارن الخطط أولًا، ثم اختر فترة الاشتراك وفعّل الترخيص عبر بوابة Paylink الآمنة. جميع التراخيص رقمية وتُفعّل فور تأكيد السداد.</p>
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
                <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">اختر شهري أو 3 أشهر أو سنوي، وأدخل رقم الجوال لإصدار الفاتورة عبر Paylink.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="grid size-7 place-items-center rounded-full bg-[#006C35] text-[11px] font-bold text-white">3</span>
              <div>
                <p className="text-[13px] font-bold text-[#0F1E33] dark:text-white">التفعيل الفوري</p>
                <p className="mt-1 text-[12px] leading-6 text-[#667085] dark:text-white/50">يُنشأ كود ترخيص رقمي عبر Keygen ويُربط بحسابك، وتُفتح المزايا فورًا.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Trust */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            [Lock, "دفع آمن ومشفر عبر Paylink"],
            [Key, "ترخيص رقمي وتفعيل فوري"],
            [ShieldCheck, "تخزين محلي أولًا"],
          ].map(([Icon, label]) => (
            <span key={String(label)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[#f8faf9] px-3 py-1 text-[11px] font-semibold text-[#344054] dark:border-white/10 dark:bg-white/5 dark:text-white/60">
              <Icon className="size-3.5 text-[#0F1E33]/60 dark:text-white/40" />
              {String(label)}
            </span>
          ))}
        </div>

        {/* Billing selector */}
        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 text-[12px] font-bold text-[#0F1E33] dark:text-white">فترة الاشتراك — قارن أولًا ثم اختر</p>
            <div role="group" aria-label="فترة الاشتراك" className="inline-flex rounded-[10px] border border-line bg-white p-1 dark:border-white/10 dark:bg-white/5">
              {BILLING_PERIODS.map((option) => (
                <button key={option.id} type="button" onClick={() => setBilling(option.id)} aria-pressed={billing === option.id} className={`rounded-[8px] px-4 py-2 text-[13px] font-bold transition ${billing === option.id ? "bg-[#0F1E33] text-white shadow-sm ring-1 ring-[#0F1E33] dark:bg-white dark:text-[#0F1E33] dark:ring-white/60" : "text-[#667085] hover:bg-[#f8faf9] hover:text-[#0F1E33] dark:text-white/50 dark:hover:bg-white/5"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full max-w-xs">
            <label className="text-[12px] font-bold text-[#0F1E33] dark:text-white">رقم الجوال لإصدار الفاتورة</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d+]/g, ""))} inputMode="tel" placeholder="05xxxxxxxx" className="mt-1.5 h-10 w-full rounded-[10px] border border-line bg-white px-3 text-[13px] font-mono dark:border-white/10 dark:bg-[#161c26]" dir="ltr" />
          </div>
        </div>

        {checkoutError && <div role="alert" className="mt-4 rounded-[10px] border border-red-200 bg-red-50 p-3 text-[13px] font-semibold text-[#b42318] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{checkoutError}</div>}

        {/* Cards — متوازنة */}
        <div className="mt-6 grid items-stretch gap-4 lg:grid-cols-3">
          {/* Free — deliberately quieter than the paid cards: muted tinted
              surface, no lift, small badge; reads free at a glance. */}
          <div className="flex flex-col rounded-xl border border-line/70 bg-[#f8faf9] p-5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[15px] font-bold text-[#0F1E33] dark:text-white">مجاني — Free</h2>
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
            const planKey = paylinkPlanKey(family, billing);
            const plan = CENTRAL_PLANS[planKey];
            const isTeam = family === "team";
            return (
              <div key={planKey} className={cardClass(`flex flex-col p-5 ${isTeam ? "border-[#006C35]/30 shadow-sm" : ""}`)}>
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-[15px] font-bold text-[#0F1E33] dark:text-white">{isTeam ? "فريق — Team" : "فردي — Pro"}</h2>
                      <p className="mt-1 text-[12px] leading-5 text-[#667085] dark:text-white/50">{plan.description}</p>
                    </div>
                    {plan.popular && <span className="shrink-0 rounded-full bg-[#0F1E33] px-2.5 py-1 text-[10px] font-bold text-white dark:bg-white dark:text-[#0F1E33]">الأكثر طلبًا</span>}
                  </div>
                  <p className="mt-4 text-[24px] font-extrabold text-[#0F1E33] dark:text-white">{plan.amount.toLocaleString("en-US")} <span className="text-[13px] font-bold text-[#667085]">ر.س</span> <span className="text-[12px] font-bold text-[#667085]">/ {billing === "quarterly" ? "3 أشهر" : billing === "annual" ? "سنوي" : "شهري"}</span></p>
                  <p className="text-[11px] text-[#98a2b3]">{plan.durationDays} يوم · {billing === "monthly" ? "شهري" : billing === "quarterly" ? "ربع سنوي" : "سنوي"}</p>
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
                  <button type="button" onClick={() => void startPaylink(planKey)} disabled={busyPlan !== null} className={`inline-flex h-9 w-full items-center justify-center rounded-[10px] text-[13px] font-bold text-white transition disabled:opacity-60 ${isTeam ? "bg-[#006C35] hover:bg-[#00542a]" : "bg-[#0F1E33] hover:bg-black dark:bg-white dark:text-[#0F1E33]"}`}>
                    {busyPlan === planKey ? "جارٍ إنشاء الفاتورة" : `اختيار ${isTeam ? "فريق" : "فردي"} — ${plan.amount} ر.س`}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-[#98a2b3]">ترخيص رقمي فوري · دفع آمن عبر Paylink</p>
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
