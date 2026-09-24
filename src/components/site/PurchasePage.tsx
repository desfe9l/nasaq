import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CreditCard,
  Download,
  Key,
  MessageCircle,
  ShieldCheck,
  Lock,
  Sparkles,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import {
  createPaylinkCheckout,
  getCheckoutAvailability,
} from "@/lib/commercial/functions";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  CENTRAL_PLANS,
  FREE_PLAN,
  BILLING_PERIODS,
  planSavings,
  paylinkPlanKey,
  type PaylinkPeriod,
  type PaylinkPlanFamily,
  type PaylinkPlanKey,
} from "@/lib/commercial/catalog";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { cardClass } from "@/components/site/cards";
import { useSiteSettings, whatsappLink } from "@/lib/admin/use-site-settings";

const FAQS: { q: string; a: string }[] = [
  {
    q: "كيف تُفعَّل التراخيص والهوية البصرية؟",
    a: "بعد إتمام الدفع عبر Paylink، يُنشئ النظام ترخيص Keygen رسميًا ويربطه بحسابك فورًا. كما يصلك كود الترخيص ويمكنك عرضه وإدارته في صفحة التراخيص أو إدخاله في التطبيق لفتح كافة المزايا المتقدمة.",
  },
  {
    q: "ما مدد الاشتراك المتاحة؟",
    a: "الاشتراك الشهري يمنحك وصولاً كاملاً لمدة 30 يومًا، بينما الاشتراك الربع سنوي يمنحك وصولاً لمدة 90 يومًا (3 أشهر) بسعر مخفّض مقارنة بالدفع الشهري المتكرر. وتتوفر باقة سنوية لمدة 365 يومًا.",
  },
  {
    q: "ما مستوى الأمان والسرية؟ وأين تُعالج ملفاتي؟",
    a: "يعمل المحرر وفق بنية محلية أولًا (Local-First): المشاريع والصور والهويات تُعالَج وتُحفظ داخل متصفحك عبر IndexedDB في الاستخدام المعتاد. يتصل التطبيق بخادم التراخيص للتحقق من الصلاحيات بأعلى معايير الأمان.",
  },
  {
    q: "هل يمكنني العمل بدون اتصال بالإنترنت؟",
    a: "نعم، بعد تحميل المحرر وتفعيل رخصتك تعمل أدوات التحرير والحفظ المحلي والتصدير داخل جهازك حتى عند انقطاع الشبكة، ويلزم الاتصال فقط عند التحقق والتفعيل.",
  },
  {
    q: "هل الخطة المجانية محدودة المدة؟",
    a: "لا، Free مجانية دائمة مع قيود المزايا الحالية، ويمكن الترقية إلى Pro أو Team حسب الحاجة.",
  },
];

export function PurchasePage() {
  const [billing, setBilling] = useState<PaylinkPeriod>("quarterly");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [mobile, setMobile] = useState("");
  const [busyPlan, setBusyPlan] = useState<PaylinkPlanKey | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  useEffect(() => {
    getCheckoutAvailability()
      .then(setAvailability)
      .catch(() => setAvailability({}));
  }, []);
  const { user } = useCurrentUserState();
  const { commercial } = useSiteSettings();

  const waHref = (message: string) =>
    whatsappLink(commercial.whatsappNumber, message);
  const whatsapp = waHref(commercial.whatsappEnterpriseMessage);

  async function startPaylink(planKey: PaylinkPlanKey) {
    if (!availability[planKey]) {
      setCheckoutError("الدفع قريبًا");
      return;
    }
    if (!user) {
      window.location.href = "/login";
      return;
    }
    const cleanMobile = mobile.replace(/\D/g, "");
    if (cleanMobile.length < 8 || cleanMobile.length > 20) {
      setCheckoutError(
        "يرجى إدخال رقم جوال صحيح لإتمام فاتورة Paylink (مثال: 0501234567).",
      );
      return;
    }
    setCheckoutError(null);
    setBusyPlan(planKey);
    try {
      const result = await createPaylinkCheckout({
        data: {
          planKey,
          clientMobile: cleanMobile,
        },
      });
      if (!result.ok) {
        setCheckoutError(result.error);
        return;
      }
      window.location.assign(result.paymentUrl);
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "تعذر بدء عملية الدفع.",
      );
    } finally {
      setBusyPlan(null);
    }
  }

  const families: PaylinkPlanFamily[] = ["individual", "team"];

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/purchase" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">
          نسخ وتراخيص معتمدة
        </p>
        <h1 className="mt-3 text-[30px] font-extrabold sm:text-[40px]">
          احصل على باقة {BRAND.platform} الرسمية
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-8 text-muted">
          اختر نوع الترخيص وفترة الاشتراك، وأكمل الدفع الإلكتروني المباشر عبر
          بوابة Paylink الآمنة. تُفعّل التراخيص الرقمية تلقائيًا فور تأكيد
          السداد.
        </p>

        {/* Trust badges */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            [Lock, "🔒 دفع آمن ومشفر عبر Paylink"],
            [Key, "⚡ ترخيص رقمي وتفعيل فوري (Keygen)"],
            [ShieldCheck, "💻 تخزين محلي أولًا (Local-First)"],
          ].map(([Icon, label]) => {
            const BadgeIcon = Icon as typeof Lock;
            return (
              <span
                key={String(label)}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-bold text-emerald-800 dark:border-emerald-400/30 dark:text-emerald-300"
              >
                <BadgeIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {String(label)}
              </span>
            );
          })}
        </div>

        {/* Period Selector: Monthly vs Quarterly */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="group"
            aria-label="فترة الاشتراك"
            className="inline-flex flex-wrap items-center gap-1 rounded-[12px] border border-line bg-white p-1.5 dark:border-white/10 dark:bg-white/5"
          >
            {BILLING_PERIODS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setBilling(option.id)}
                aria-pressed={billing === option.id}
                className={`cursor-pointer rounded-[9px] px-4 py-2.5 text-[13px] font-extrabold transition ${
                  billing === option.id
                    ? "bg-navy text-white shadow-sm"
                    : "text-muted hover:text-ink dark:hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="max-w-xs">
            <label className="text-[12px] font-bold text-muted">
              رقم الجوال لإصدار الفاتورة:
            </label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/[^\d+]/g, ""))}
              inputMode="tel"
              placeholder="05xxxxxxxx"
              className="mt-1 h-9 w-full rounded-[10px] border border-line bg-surface px-3 text-[13px] font-mono dark:border-white/10"
              dir="ltr"
            />
          </div>
        </div>

        {checkoutError && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-danger/40 bg-danger/10 p-3 text-[13px] font-bold text-danger"
          >
            {checkoutError}
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="mt-8 grid gap-4 md:gap-6 lg:grid-cols-3">
          {families.map((family) => {
            const planKey = paylinkPlanKey(family, billing);
            const plan = CENTRAL_PLANS[planKey];
            const isTeam = family === "team";
            const isQuarterly = billing === "quarterly";

            return (
              <section
                key={planKey}
                className={cardClass(
                  "relative flex flex-col justify-between p-6 text-right",
                  isTeam &&
                    "ring-2 ring-emerald-500/70 shadow-[0_18px_40px_-18px_rgba(16,185,129,0.45)] hover:-translate-y-1 dark:ring-emerald-400/60",
                )}
              >
                {isTeam && (
                  <span className="absolute -top-3 right-5 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-extrabold text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.8)]">
                    <Sparkles className="size-3" />
                    الأكثر طلباً 🌟
                  </span>
                )}

                <div>
                  <h2 className="text-[18px] font-extrabold">
                    {isTeam ? "Team — فريق" : "Pro — فردي"}
                  </h2>
                  <p className="mt-2 text-[12px] leading-6 text-muted">
                    {plan.description}
                  </p>

                  <div className="mt-5">
                    <p className="text-[32px] font-extrabold text-navy dark:text-white">
                      <span className="text-[16px]">ر.س </span>
                      {plan.amount.toLocaleString("en-US")}{" "}
                      <span className="text-[13px] font-bold text-muted">
                        /{" "}
                        {isQuarterly
                          ? "كل 3 أشهر"
                          : billing === "annual"
                            ? "سنويًا"
                            : "شهريًا"}
                      </span>
                    </p>
                    {billing !== "monthly" && (
                      <p className="mt-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        وفّر {planSavings(plan)} ر.س مقارنة بالدفع الشهري
                      </p>
                    )}
                  </div>

                  <div className="mt-4 border-t border-line/60 pt-4 dark:border-white/10">
                    <p className="text-[11px] font-extrabold text-muted">
                      المزايا المشمولة في الترخيص:
                    </p>
                    <ul className="mt-3 grid gap-2">
                      {plan.features.map((feature) => (
                        <li
                          key={feature}
                          className="flex items-center gap-2 text-[12px] font-bold"
                        >
                          <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 pt-4">
                  <button
                    type="button"
                    onClick={() => void startPaylink(planKey)}
                    disabled={busyPlan !== null || !availability[planKey]}
                    className={`inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-[13px] font-extrabold text-white transition disabled:cursor-wait disabled:opacity-60 ${
                      isTeam
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "bg-navy hover:bg-navy-2"
                    }`}
                  >
                    {!availability[planKey]
                      ? "الدفع قريبًا"
                      : busyPlan === planKey
                        ? "جارٍ إنشاء الفاتورة في Paylink…"
                        : `اشترك الآن (${plan.amount} ر.س) عبر Paylink`}
                  </button>
                  <p className="mt-2 text-center text-[10px] text-muted">
                    ترخيص رقمي فوري صالح لمدة {plan.durationDays} يومًا
                  </p>
                </div>
              </section>
            );
          })}

          <section
            className={cardClass(
              "flex flex-col justify-between p-6 text-right",
            )}
          >
            <div>
              <h2 className="text-[18px] font-extrabold">{FREE_PLAN.name}</h2>
              <p className="mt-2 text-[12px] leading-6 text-muted">
                خطة مجانية دائمة، دون دفع أو تاريخ انتهاء.
              </p>
              <p className="mt-5 text-[32px] font-extrabold text-navy dark:text-white">
                {FREE_PLAN.prices[billing]} ر.س
              </p>
              <ul className="mt-5 grid gap-2">
                {FREE_PLAN.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2 text-[12px] font-bold"
                  >
                    <CheckCircle2 className="size-3.5 text-ok" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href="/editor"
              className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-navy px-5 text-[13px] font-extrabold text-white"
            >
              ابدأ مجانًا
            </a>
          </section>
        </div>

        <p className="mt-5 text-[12px] text-muted">
          عند عدم اكتمال الربط تظهر حالة «الدفع قريبًا» ولا يتم إنشاء عملية دفع.{" "}
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            تواصل معنا لاحتياجات تجهيز القوالب والهوية
          </a>
        </p>
        {/* FAQ accordion */}
        <section className="mt-12 border-t border-line pt-8 dark:border-white/10">
          <h2 className="text-[20px] font-extrabold">الأسئلة الشائعة</h2>
          <div className="mt-5 grid gap-2">
            {FAQS.map((faq, index) => {
              const open = openFaq === index;
              return (
                <div
                  key={faq.q}
                  className="overflow-hidden rounded-[10px] border border-line bg-white dark:border-white/10 dark:bg-white/5"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : index)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-right text-[14px] font-extrabold"
                  >
                    {faq.q}
                    <ChevronDown
                      className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </button>
                  {open && (
                    <p className="border-t border-line px-4 py-3.5 text-[13px] leading-7 text-muted dark:border-white/10">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* License key activation prompt */}
        <section className="mt-10 border-t border-line pt-8 dark:border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-[15px] font-extrabold">
                لديك مفتاح ترخيص بالفعل؟
              </h2>
              <p className="mt-1 text-[12px] leading-6 text-muted">
                تفضل بزيارة صفحة التراخيص لتفعيل المفتاح أو الاطلاع على المزايا
                المرخصة لحسابك.
              </p>
            </div>
            <a
              href="/license"
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-[12px] font-bold transition hover:bg-accent dark:border-white/10 dark:bg-white/5"
            >
              <Key className="size-3.5" />
              إدارة وتفعيل الترخيص
            </a>
          </div>
        </section>

        {/* Steps */}
        <section className="mt-10">
          <h2 className="text-[20px] font-extrabold">
            من الدفع إلى تفعيل الترخيص
          </h2>
          <div className="mt-5 grid gap-5 md:grid-cols-4">
            {[
              [
                MessageCircle,
                "1. اختيار الباقة",
                "اختر الباقة الفردية أو باقة الفريق ومدتها.",
              ],
              [
                CreditCard,
                "2. سداد الفاتورة",
                "ادفع بأمان عبر بطاقة مدى أو البطاقات الائتمانية في Paylink.",
              ],
              [
                ClipboardCheck,
                "3. إصدار الترخيص",
                "يُصدر النظام ترخيص Keygen المعتمد فورًا.",
              ],
              [
                Download,
                "4. التفعيل الفوري",
                "تُفتح جميع المزايا المرخصة بحسابك فور اكتمال الدفع.",
              ],
            ].map(([Icon, title, body]) => {
              const StepIcon = Icon as typeof MessageCircle;
              return (
                <div
                  key={String(title)}
                  className="rounded-xl border border-line/60 p-4 dark:border-white/10"
                >
                  <StepIcon className="size-5 text-navy-2 dark:text-gold-2" />
                  <h3 className="mt-3 text-[14px] font-extrabold">
                    {String(title)}
                  </h3>
                  <p className="mt-1 text-[12px] leading-6 text-muted">
                    {String(body)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <p className="mt-10 flex items-start gap-2 text-[12px] leading-6 text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          التحقق يتم مركزيًا من خادم التراخيص (Keygen & NASAQ Server)، ولا يمكن
          التلاعب بالأسعار أو الصلاحيات من الواجهة.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
