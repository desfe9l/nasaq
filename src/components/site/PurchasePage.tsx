import { useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  Download,
  Key,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { BRAND, whatsappHref } from "@/lib/brand";
import {
  checkoutFor,
  isCheckoutConfigured,
  LEMON_SQUEEZY_WHATSAPP_URL,
  type BillingPeriod,
  type PaidPlan,
} from "@/lib/product/licensing";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

const PLAN_CONTENT = {
  individual: {
    title: "ترخيص فردي",
    body: "للمصمم أو الموظف الذي يعمل على جهازه.",
    items: ["القوالب الكاملة", "التصدير المتقدم", "تحديثات النسخة المرخصة"],
  },
  team: {
    title: "ترخيص فريق",
    body: "لفريق محتوى أو اتصال مؤسسي صغير.",
    items: ["جميع مزايا الفردي", "تفعيل لعدة مستخدمين", "تهيئة هوية الجهة"],
  },
} as const;

const PERIODS: { id: BillingPeriod; label: string; suffix: string; note?: string }[] = [
  { id: "monthly", label: "شهري", suffix: "شهريًا" },
  { id: "quarterly", label: "كل 3 أشهر", suffix: "كل 3 أشهر", note: "أوفر من الاشتراك الشهري" },
];

const PRICES: Record<PaidPlan, Record<BillingPeriod, string>> = {
  individual: { monthly: "79", quarterly: "199" },
  team: { monthly: "199", quarterly: "499" },
};

export function PurchasePage() {
  const [periods, setPeriods] = useState<Record<PaidPlan, BillingPeriod>>({
    individual: "monthly",
    team: "monthly",
  });
  const whatsapp =
    LEMON_SQUEEZY_WHATSAPP_URL ||
    whatsappHref(`السلام عليكم، أرغب بالاستفسار عن الترخيص المؤسسي لمنصة ${BRAND.platform}.`);

  return (
    <div className="min-h-full bg-paper dark:bg-[#111722]">
      <SiteHeader current="/purchase" />
      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-[12px] font-extrabold tracking-[0.16em] text-green dark:text-gold-2">
          نسخ وتراخيص
        </p>
        <h1 className="mt-3 text-[30px] font-extrabold sm:text-[40px]">
          احصل على نسخة {BRAND.platform} المناسبة لعملك
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-8 text-muted">
          اختر نوع الترخيص وفترة الفوترة المناسبة، ثم أكمل الاشتراك عبر رابط Lemon Squeezy المهيأ للمتغير المحدد.
        </p>
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {(["individual", "team"] as PaidPlan[]).map((id) => {
            const period = periods[id];
            const config = checkoutFor(id, period);
            const item = PLAN_CONTENT[id];

            return (
              <section
                key={id}
                className="border border-line bg-white p-5 text-right shadow-sm dark:border-white/10 dark:bg-white/5"
              >
                <h2 className="text-[17px] font-extrabold">{item.title}</h2>
                <p className="mt-2 text-[12px] leading-6 text-muted">{item.body}</p>
                <div className="mt-5 grid grid-cols-2 rounded-[8px] bg-line-2 p-1 dark:bg-white/10">
                  {PERIODS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setPeriods((current) => ({ ...current, [id]: option.id }))
                      }
                      className={`rounded-[6px] px-2 py-2 text-[11px] font-extrabold ${
                        period === option.id
                          ? "bg-white text-navy shadow-sm dark:bg-[#1b2431] dark:text-gold-2"
                          : "text-muted"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-5 text-[28px] font-extrabold text-navy dark:text-white">
                  <span className="text-[14px]">ر.س </span>
                  {PRICES[id][period]}{" "}
                  <span className="text-[12px] font-bold text-muted">
                    / {PERIODS.find((option) => option.id === period)?.suffix}
                  </span>
                </p>
                {period === "quarterly" && (
                  <p className="mt-1 text-[11px] font-bold text-green">{PERIODS[1].note}</p>
                )}
                <ul className="mt-5 grid gap-2">
                  {item.items.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-[12px] font-bold">
                      <CheckCircle2 className="size-3.5 text-ok" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {isCheckoutConfigured(id, period) ? (
                  <a
                    href={config.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-[8px] bg-navy px-5 text-[13px] font-extrabold text-white"
                  >
                    اشترك {period === "monthly" ? "شهريًا" : "كل 3 أشهر"}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="mt-6 h-11 w-full rounded-[8px] bg-navy/40 px-5 text-[13px] font-extrabold text-white"
                  >
                    رابط الاشتراك غير مهيأ
                  </button>
                )}
              </section>
            );
          })}
          <section className="border border-line bg-white p-5 text-right shadow-sm dark:border-white/10 dark:bg-white/5">
            <h2 className="text-[17px] font-extrabold">ترخيص مؤسسي</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              حل مخصص للجهات التي تحتاج إلى تهيئة وتسليم ودعم وسياسات استخدام خاصة.
            </p>
            <p className="mt-6 text-[24px] font-extrabold text-navy dark:text-white">
              حل مؤسسي مخصص
            </p>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-navy px-5 text-[13px] font-extrabold text-white"
            >
              <MessageCircle className="size-4" />
              تواصل معنا
            </a>
          </section>
        </div>

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
                className="mt-3 inline-flex items-center gap-2 rounded-[8px] border border-line bg-white px-4 py-2 text-[12px] font-bold dark:border-white/10 dark:bg-white/5 hover:bg-accent"
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
              [MessageCircle, "1. تحديد الاحتياج", "تختار الترخيص وفترة الفوترة."],
              [CreditCard, "2. تأكيد الاشتراك", "تُكمل الدفع عبر Checkout المهيأ."],
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
