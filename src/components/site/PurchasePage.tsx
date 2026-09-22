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
  Receipt,
} from "lucide-react";
import { BRAND, whatsappHref } from "@/lib/brand";
import { LEMON_SQUEEZY_WHATSAPP_URL, type BillingPeriod, type PaidPlan } from "@/lib/product/licensing";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";
import { cardClass } from "@/components/site/cards";

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
    title: "ترخيص فريق",
    body: "لفريق محتوى أو اتصال مؤسسي صغير.",
    items: [
      "جميع مزايا الفردي",
      "تفعيل لعدة مستخدمين",
      "تهيئة هوية الجهة كاملة",
      "مكتبة موارد مشتركة للمجلدات",
      "أولوية في الدعم الفني",
    ],
  },
} as const;

/** Monthly list prices in SAR; annual = 12 months with the −20% discount. */
const MONTHLY_PRICES: Record<PaidPlan, number> = {
  individual: 79,
  team: 199,
};

const annualPrice = (plan: PaidPlan) =>
  Math.round(MONTHLY_PRICES[plan] * 12 * 0.8);

type CheckoutMatrix = Record<
  PaidPlan,
  Record<BillingPeriod, { variantId: string | null; checkoutUrl: string | null }>
>;

type Billing = "monthly" | "annual";

const FAQS: { q: string; a: string }[] = [
  {
    q: "هل تُرفع ملفاتي إلى خادم عند الاشتراك؟",
    a: "لا. العمل local-first: المشاريع والصور والهوية تُحفظ داخل متصفحك فقط. الاشتراك يفتح الميزات داخل النسخة، ولا ينقل محتواك إلى أي خادم.",
  },
  {
    q: "هل تصدر فاتورة ضريبية (VAT)؟",
    a: "نعم — الفواتير تصدر نظاميًا وتشمل ضريبة القيمة المضافة 15%، ويمكن توجيهها لبيانات جهتك المحاسبية عند إتمام الطلب.",
  },
  {
    q: "نحتاج طلب شراء حكومي (PO / RFP) — هل يدعم ذلك؟",
    a: "نعم. نتعامل مع طلبات الشراء الرسمية وفواتير الجهات الحكومية: أرسل نموذج طلب الشراء عبر واتساب ونجهّز العرض المالي والعقد المناسبًا لإجراءات المشتريات لديكم.",
  },
];

export function PurchasePage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [checkouts, setCheckouts] = useState<CheckoutMatrix | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

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

  const whatsapp =
    LEMON_SQUEEZY_WHATSAPP_URL ||
    whatsappHref(`السلام عليكم، أرغب بالاستفسار عن الترخيص المؤسسي لمنصة ${BRAND.platform}.`);

  /** Paid CTA target: configured checkout for the monthly period, else a prepared WhatsApp inquiry. */
  const planCta = (
    id: PaidPlan,
  ): { href: string; external: boolean; checkout: boolean } => {
    if (billing === "monthly") {
      const url = checkouts?.[id].monthly?.checkoutUrl;
      if (url) return { href: url, external: true, checkout: true };
    }
    const label = id === "team" ? "ترخيص فريق" : "ترخيص فردي";
    return {
      href: whatsappHref(
        `السلام عليكم، أرغب بالاشتراك ${billing === "annual" ? "السنوي (وفر 20%)" : "الشهري"} في ${label} لمنصة ${BRAND.platform}.`,
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

        {/* Trust badges: VAT, secure payment, government purchase orders. */}
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            [Receipt, "مسجّل ضريبيًا · فاتورة نظامية بـ VAT"],
            [Lock, "دفع آمن عبر رابط Checkout محمي"],
            [ClipboardCheck, "نقبل طلبات الشراء الحكومية (PO)"],
          ].map(([Icon, label]) => {
            const BadgeIcon = Icon as typeof Receipt;
            return (
              <span
                key={String(label)}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-muted dark:border-white/10 dark:bg-white/5"
              >
                <BadgeIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {String(label)}
              </span>
            );
          })}
        </div>

        {/* Billing period: Monthly / Annual (save 20%). */}
        <div
          role="group"
          aria-label="فترة الاشتراك"
          className="mt-7 inline-flex items-center gap-1 rounded-[12px] border border-line bg-white p-1.5 dark:border-white/10 dark:bg-white/5"
        >
          {(
            [
              { id: "monthly", label: "شهري" },
              { id: "annual", label: "سنوي — وفر 20%" },
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
            اشتراك سنوي — وفر 20% مقارنة بالدفع الشهري (12 شهرًا).
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
                    يعادل {MONTHLY_PRICES[id]} ر.س شهريًا — وفّرت 20%
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
                    : `اطلب ${billing === "monthly" ? "الاشتراك الشهري" : "الاشتراك السنوي"} عبر واتساب`}
                </a>
              </section>
            );
          })}
          <section className={cardClass("p-5 text-right")}>
            <h2 className="text-[17px] font-extrabold">ترخيص مؤسسي</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              حل مخصص للجهات التي تحتاج إلى تهيئة وتسليم ودعم وسياسات استخدام خاصة.
            </p>
            <p className="mt-6 text-[24px] font-extrabold text-navy dark:text-white">
              حل مؤسسي مخصص
            </p>
            <ul className="mt-5 grid gap-2">
              {[
                "بيئة عمل مخصصة لجهتك",
                "تدريب للفريق وورشة تسليم",
                "دعم أولوية واتفاقية مستوى خدمة",
                "فاتورة وعقد رسمي للجهات",
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
              <MessageCircle className="size-4" />
              تواصل معنا
            </a>
          </section>
        </div>

        {/* FAQ accordion — storage privacy, VAT invoices, RFP purchase orders. */}
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
              [CreditCard, "2. تأكيد الاشتراك", "تُكمل الدفع عبر رابط آمن أو طلب شراء."],
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
