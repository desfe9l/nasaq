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
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import { LEMON_SQUEEZY_WHATSAPP_URL, type BillingPeriod, type PaidPlan } from "@/lib/product/licensing";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { cardClass } from "@/components/site/cards";
import { useSiteSettings, whatsappLink } from "@/lib/admin/use-site-settings";

const PLAN_CONTENT = {
  individual: {
    title: "ترخيص فردي",
    body: "للمصمم أو الموظف الذي يعمل على جهازه.",
    items: [
      "القوالب الكاملة",
      "تصدير حتى 300 DPI بلا علامة مائية",
      "عدة تطبيقات هوية (Brand Kit) كاملة",
      "قفل العناصر وحماية التصميم",
      "تحديثات النسخة المرخصة",
    ],
  },
  team: {
    title: "ترخيص الأعمال / الفريق",
    body: "لفريق محتوى أو اتصال مؤسسي يعمل على هوية واحدة.",
    items: [
      "جميع مزايا النسخة المتقدمة",
      "تفعيل التراخيص عبر أكواد سريعة",
      "استيراد وتصدير حزمة الهوية الموحدة",
      "تصدير PDF عالي الدقة 300 DPI بدون علامة مائية",
      "أولوية الدعم الفني",
    ],
  },
} as const;


type CheckoutMatrix = Record<
  PaidPlan,
  Record<BillingPeriod, { variantId: string | null; checkoutUrl: string | null }>
>;

type Billing = "monthly" | "annual";

const FAQS: { q: string; a: string }[] = [
  {
    q: "كيف تُفعَّل التراخيص والهوية البصرية؟",
    a: "بعد إتمام الطلب يصلك كود رخصة (NASAQ-…). أدخله في «إدخال كود الرخصة» داخل نافذة طلب النسخة الكاملة أو في صفحة التراخيص، فيتحقق منه خادم التراخيص ويفتح المزايا المرخّصة. بعدها يمكنك إعداد هوية جهتك (الشعارات والألوان والخطوط) من صفحة الهوية، وتصدير حزمة الهوية كملف واستيرادها على أجهزة الفريق.",
  },
  {
    q: "ما مستوى الأمان والسرية؟ وأين تُعالج ملفاتي؟",
    a: "يعمل المحرر وفق بنية محلية أولًا (Local-First): المشاريع والصور والهويات تُعالَج وتُحفظ داخل متصفحك عبر IndexedDB ولا تُرفع تصاميمك إلى خوادم نَسَق. ما يُرسَل إلى الخادم هو فقط ما يلزم للتحقق من الرخصة. تبقى حماية البيانات المحلية مرتبطة بأمان جهازك ومتصفحك، لذلك ننصح بأخذ نسخ احتياطية دورية بتصدير المشروع.",
  },
  {
    q: "هل يمكنني العمل بدون اتصال بالإنترنت؟",
    a: "نعم، بعد تحميل المحرر مرة واحدة تعمل أدوات التحرير والحفظ المحلي والتصدير داخل جهازك حتى عند انقطاع الشبكة. يلزم الاتصال عند تفعيل الرخصة لأول مرة، وعند إعادة التحقق الدورية منها، وعند تحميل الخطوط من الإنترنت إن لم تكن مخزّنة في المتصفح.",
  },
  {
    q: "كيف تعمل آلية التفعيل المباشر؟",
    a: "عند إدخال الكود يُرسَل إلى خادم التراخيص للتحقق من صلاحيته وحالته وعدد مرات التفعيل المسموح بها، ثم تُمنح الصلاحيات فورًا دون إعادة تثبيت. يُحفظ الكود في المتصفح لتسهيل الاستخدام فقط، ويُعاد التحقق منه تلقائيًا؛ ويمكن لإدارة المنصة إيقاف أي رخصة أو تمديدها أو إعادة تفعيلها من لوحة التحكم.",
  },
];

export function PurchasePage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [checkouts, setCheckouts] = useState<CheckoutMatrix | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const { commercial } = useSiteSettings();
  /** Monthly list prices in SAR (admin-managed); annual = 12 months minus the discount. */
  const MONTHLY_PRICES: Record<PaidPlan, number> = {
    individual: commercial.priceIndividualMonthly,
    team: commercial.priceTeamMonthly,
  };
  const discount = commercial.annualDiscountPercent;
  const annualPrice = (plan: PaidPlan) => Math.round(MONTHLY_PRICES[plan] * 12 * (1 - discount / 100));
  const waHref = (message: string) => whatsappLink(commercial.whatsappNumber, message);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checkout/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: CheckoutMatrix | null) => {
        if (!cancelled && value) setCheckouts(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const whatsapp = LEMON_SQUEEZY_WHATSAPP_URL || waHref(commercial.whatsappEnterpriseMessage);

  /** Paid CTA target: configured checkout for the monthly period, else a prepared WhatsApp inquiry. */
  const planCta = (
    id: PaidPlan,
  ): { href: string; external: boolean; checkout: boolean } => {
    if (billing === "monthly") {
      const override = id === "team" ? commercial.checkoutTeamMonthly : commercial.checkoutIndividualMonthly;
      const url = override || checkouts?.[id].monthly?.checkoutUrl;
      if (url) return { href: url, external: true, checkout: true };
    }
    const label = id === "team" ? "ترخيص الأعمال / الفريق" : "ترخيص فردي";
    return {
      href: waHref(
        `السلام عليكم، أرغب بالاشتراك ${billing === "annual" ? `السنوي (وفر ${discount}%)` : "الشهري"} في ${label} لمنصة ${BRAND.platform}.`,
      ),
      external: true,
      checkout: false,
    };
  };

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/purchase" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">
          نسخ وتراخيص
        </p>
        <h1 className="mt-3 text-[30px] font-extrabold sm:text-[40px]">
          احصل على نسخة {BRAND.platform} المناسبة لعملك
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-8 text-muted">
          اختر نوع الترخيص وفترة الاشتراك، وأكمل الطلب عبر رابط الدفع الآمن أو رسالة واتساب
          الجاهزة — بدون أي مصطلحات تقنية.
        </p>

        {/* Trust badges: local-first, instant activation, secure payment */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            [Lock, "🔒 دفع آمن وفوري"],
            [Key, "⚡ تفعيل كود الرخصة"],
            [ShieldCheck, "💻 حفظ محلي 100%"],
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

        {/* Billing period: Monthly / Annual (admin-managed discount). */}
        <div
          role="group"
          aria-label="فترة الاشتراك"
          className="mt-7 inline-flex items-center gap-1 rounded-[12px] border border-line bg-white p-1.5 dark:border-white/10 dark:bg-white/5"
        >
          {(
            [
              { id: "monthly", label: "شهري" },
              { id: "annual", label: `سنوي — وفر ${discount}%` },
            ] as { id: Billing; label: string }[]
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setBilling(option.id)}
              aria-pressed={billing === option.id}
              className={`rounded-[9px] px-4 py-2.5 text-[13px] font-extrabold transition ${
                billing === option.id
                  ? "bg-navy text-white shadow-sm"
                  : "text-muted hover:text-ink dark:hover:text-white"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {billing === "annual" && (
          <p className="mt-2 text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
            اشتراك سنوي — وفر {discount}% مقارنة بالدفع الشهري (12 شهرًا).
          </p>
        )}

        <div className="mt-8 grid gap-4 md:gap-6 lg:grid-cols-3">
          {(["individual", "team"] as PaidPlan[]).map((id) => {
            const item = PLAN_CONTENT[id];
            const isTeam = id === "team";
            const price =
              billing === "monthly" ? MONTHLY_PRICES[id] : annualPrice(id);
            const cta = planCta(id);

            return (
              <section
                key={id}
                className={cardClass(
                  "relative p-5 text-right",
                  // Team tier: the requested «الأكثر طلباً» treatment —
                  // emerald glow, elevation, and a floating badge.
                  isTeam &&
                    "ring-2 ring-emerald-500/70 shadow-[0_18px_40px_-18px_rgba(16,185,129,0.55)] hover:-translate-y-1.5 dark:ring-emerald-400/60",
                )}
              >
                {isTeam && (
                  <span className="absolute -top-3 right-5 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-extrabold text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.8)]">
                    الأكثر طلباً 🌟
                  </span>
                )}
                <h2 className="text-[17px] font-extrabold">{item.title}</h2>
                <p className="mt-2 text-[12px] leading-6 text-muted">{item.body}</p>
                <p className="mt-5 text-[28px] font-extrabold text-navy dark:text-white">
                  <span className="text-[14px]">ر.س </span>
                  {price}{" "}
                  <span className="text-[12px] font-bold text-muted">
                    / {billing === "monthly" ? "شهريًا" : "سنويًا"}
                  </span>
                </p>
                {billing === "annual" && (
                  <p className="mt-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    يعادل {Math.round(annualPrice(id) / 12)} ر.س شهريًا — وفّرت {discount}%
                  </p>
                )}
                <ul className="mt-5 grid gap-2">
                  {item.items.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-[12px] font-bold">
                      <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href={cta.href}
                  target={cta.external ? "_blank" : undefined}
                  rel={cta.external ? "noopener noreferrer" : undefined}
                  className={`mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-[13px] font-extrabold text-white transition ${
                    isTeam
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-navy hover:bg-navy-2"
                  }`}
                >
                  {cta.checkout
                    ? `اشترك ${billing === "monthly" ? "شهريًا" : "سنويًا"}`
                    : isTeam
                      ? "⚡ طلب الترخيص عبر الواتساب"
                      : `اطلب ${billing === "monthly" ? "الاشتراك الشهري" : "الاشتراك السنوي"} عبر واتساب`}
                </a>
              </section>
            );
          })}
          <section className={cardClass("p-5 text-right")}>
            <h2 className="text-[17px] font-extrabold">ترخيص المخرجات المؤسسية</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              للجهات التي تحتاج إلى تجهيز قوالبها وهويتها وخيارات ترخيص مخصصة.
            </p>
            <p className="mt-6 text-[24px] font-extrabold text-navy dark:text-white">
              حل مؤسسي مخصص
            </p>
            <ul className="mt-5 grid gap-2">
              {[
                "تهيئة وتجهيز حزم القوالب الخاصة بالجهة",
                "حفظ محلي داخل أجهزة الجهة (Local-First)",
                "تفعيل مباشر للتراخيص من لوحة الإدارة",
                "موارد وخيارات مخصصة حسب احتياج الجهة",
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-2 text-[12px] font-bold">
                  <CheckCircle2 className="size-3.5 shrink-0 text-ok" />
                  {feature}
                </li>
              ))}
            </ul>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-navy px-5 text-[13px] font-extrabold text-white transition hover:bg-navy-2"
            >
              💬 تواصل معنا للترخيص المخصص
            </a>
          </section>
        </div>

        {/* FAQ accordion — activation, privacy, offline work, direct activation. */}
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

        <section className="mt-10 border-t border-line pt-8 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-[15px] font-extrabold">لديك مفتاح ترخيص بالفعل؟</h2>
              <p className="mt-1 text-[12px] leading-6 text-muted">
                إذا أرسل لك المنصّب مفتاح ترخيص (NASAQ-…)، فأدخله في صفحة التراخيص لفتح
                الميزات فورًا.
              </p>
              <a
                href="/license"
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-[12px] font-bold transition hover:bg-accent dark:border-white/10 dark:bg-white/5"
              >
                <Key className="size-3.5" />
                تفعيل مفتاح الترخيص
              </a>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[20px] font-extrabold">من الطلب إلى بدء الاستخدام</h2>
          <div className="mt-5 grid gap-5 md:grid-cols-4">
            {[
              [MessageCircle, "1. تحديد الاحتياج", "تختار الترخيص وفترة الاشتراك."],
              [CreditCard, "2. تأكيد الاشتراك", "تُكمل الدفع عبر رابط آمن أو بالتنسيق عبر واتساب."],
              [ClipboardCheck, "3. تفعيل الترخيص", "يدخل الترخيص في نظام التحقق الحالي."],
              [Download, "4. بدء العمل", "تصل الميزات حسب نطاق الترخيص."],
            ].map(([Icon, title, body]) => {
              const StepIcon = Icon as typeof MessageCircle;
              return (
                <div key={String(title)}>
                  <StepIcon className="size-5 text-navy-2 dark:text-gold-2" />
                  <h3 className="mt-3 text-[14px] font-extrabold">{String(title)}</h3>
                  <p className="mt-1 text-[12px] leading-6 text-muted">{String(body)}</p>
                </div>
              );
            })}
          </div>
        </section>

        <p className="mt-10 flex items-start gap-2 text-[12px] leading-6 text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
          يبقى التحقق الحقيقي من الخادم عبر نظام التراخيص الحالي، ولا توجد صلاحية Pro
          مخزنة في الواجهة فقط.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
